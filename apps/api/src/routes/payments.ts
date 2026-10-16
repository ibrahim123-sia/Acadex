// Public payment endpoints under /api/payments (no sign-in):
//   webhook/:provider/:accountId  provider results (Stripe webhooks; JazzCash / Easypaisa browser
//                                 returns), verified, recorded once, then applied
//   status/:reference             the return page polls this after paying
//   pay/:token                    a payer's own link (in vouchers, reminders and to applicants):
//                                 what is owed, and starting a payment
//   fake/checkout, fake/complete  the test provider's checkout page (never in production)
// Each lookup is by an unguessable token or reference, so these run with RLS bypassed.
import crypto from 'node:crypto';
import express, { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getConfig } from '../config';
import { db, systemContext } from '../db/context';
import { badRequest, notFound } from '../lib/errors';
import { startCheckout } from '../lib/finance/checkout';
import { applyProviderEvent, balanceOf, loadAccountById } from '../lib/finance/ledger';
import { sendVoucherPdf } from '../lib/finance/pdf';
import { PROVIDERS, SignatureError, signFake, type CallbackRequest, type ProviderName } from '../lib/finance/providers';
import { logger } from '../lib/logger';

const router = Router();
router.use(systemContext);

const providerParam = z.enum(['stripe', 'jazzcash', 'easypaisa', 'fake']);
/** Providers whose result arrives with the payer's browser (answer with a redirect). */
const BROWSER_RETURN = new Set<ProviderName>(['jazzcash', 'easypaisa']);
const returnPage = (reference: string, error?: string) => `${getConfig().appUrl}/pay/return?ref=${encodeURIComponent(reference)}${error ? `&error=${error}` : ''}`;

function parseBody(raw: Buffer, contentType: string | undefined): Record<string, unknown> {
  const text = raw.toString('utf8');
  if (!text) return {};
  if ((contentType ?? '').includes('application/json')) {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

async function handleCallback(provider: ProviderName, accountId: number, cb: CallbackRequest) {
  const found = await loadAccountById(accountId);
  if (!found?.account || found.account.provider !== provider) throw notFound('Unknown payment account');
  const ev = await PROVIDERS[provider].parseCallback(found.account, cb);
  const result = await applyProviderEvent(provider, found.institutionId, ev, provider === 'stripe' ? JSON.parse(cb.rawBody.toString('utf8') || '{}') : { ...cb.body, ...cb.query });
  return { ev, result };
}

/** A provider's result for a payment (Stripe webhook; JazzCash POST and Easypaisa GET browser returns). */
async function webhookHandler(req: Request, res: Response) {
  const provider = providerParam.parse(req.params.provider);
  const accountId = z.coerce.number().int().positive().parse(req.params.accountId);
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const cb: CallbackRequest = { headers: req.headers, rawBody, body: parseBody(rawBody, req.headers['content-type']), query: req.query as Record<string, unknown> };
  const ref = String(cb.body.ppmpf_1 ?? cb.body.pp_TxnRefNo ?? cb.query.orderRefNumber ?? cb.body.orderRefNumber ?? '');
  try {
    const { ev, result } = await handleCallback(provider, accountId, cb);
    logger.info({ provider, event: ev.eventId, type: ev.type, result }, 'payment provider event');
    if (BROWSER_RETURN.has(provider)) return void res.redirect(303, returnPage(ev.reference ?? ref));
    res.json({ received: true, result });
  } catch (e) {
    if (!(e instanceof SignatureError)) throw e;
    logger.warn({ provider, accountId, err: e.message }, 'payment callback rejected');
    if (BROWSER_RETURN.has(provider) && ref) return void res.redirect(303, returnPage(ref, 'unverified'));
    res.status(400).json({ error: 'Signature verification failed' });
  }
}
router.post('/webhook/:provider/:accountId', webhookHandler);
router.get('/webhook/:provider/:accountId', webhookHandler);

router.get('/status/:reference', async (req, res) => {
  const reference = z.string().regex(/^AX[0-9A-F]{18}$/).parse(req.params.reference);
  const { rows } = await db.query(
    `SELECT c.status, c.amount, c.currency, c.provider, i.number AS invoice_number, i.title, ins.name AS institution, p.receipt_no, i.pay_token
       FROM checkout_sessions c JOIN invoices i ON i.id = c.invoice_id JOIN institutions ins ON ins.id = c.institution_id LEFT JOIN payments p ON p.id = c.payment_id
      WHERE c.reference = $1`,
    [reference]
  );
  if (!rows[0]) throw notFound('Payment not found');
  res.json(rows[0]);
});

// ---------------------------------------------------------------- pay links

const tokenParam = z.string().regex(/^[A-Za-z0-9_-]{20,40}$/);

async function invoiceByToken(token: string) {
  const { rows } = await db.query(
    `SELECT i.id, i.institution_id, i.number, i.title, i.issue_date, i.due_date, i.status, i.currency, i.total, i.paid,
            COALESCE(st.first_name || ' ' || left(st.last_name, 1), a.first_name || ' ' || left(a.last_name, 1)) AS payer,
            ins.name AS institution, ins.primary_color, ins.logo_url
       FROM invoices i JOIN institutions ins ON ins.id = i.institution_id
       LEFT JOIN students st ON st.id = i.student_id LEFT JOIN applications a ON a.id = i.application_id
      WHERE i.pay_token = $1 AND i.status <> 'draft'`,
    [token]
  );
  if (!rows[0]) throw notFound('This payment link is not valid');
  return rows[0];
}

router.get('/pay/:token', async (req, res) => {
  const inv = await invoiceByToken(tokenParam.parse(req.params.token));
  const [lines, options] = await Promise.all([
    db.query(`SELECT label, amount FROM invoice_items WHERE invoice_id = $1 ORDER BY (kind = 'fee') DESC, id`, [inv.id]),
    db.query<{ provider: ProviderName; public_config: Record<string, string> }>(`SELECT provider, public_config FROM payment_accounts WHERE institution_id = $1 AND enabled ORDER BY provider`, [inv.institution_id]),
  ]);
  res.json({
    ...inv,
    id: undefined,
    institution_id: undefined,
    balance: balanceOf(inv),
    lines: lines.rows,
    options: options.rows
      .filter((o) => o.provider !== 'fake' || getConfig().env !== 'production')
      .map((o) => ({ provider: o.provider, label: PROVIDERS[o.provider].label, online: PROVIDERS[o.provider].online, details: o.provider === 'bank' ? o.public_config : undefined })),
  });
});

router.post('/pay/:token/checkout', async (req, res) => {
  const inv = await invoiceByToken(tokenParam.parse(req.params.token));
  const b = z.object({ provider: providerParam, amount: z.coerce.number().positive().optional() }).parse(req.body);
  res.status(201).json(await startCheckout(inv, b.provider, b.amount));
});

router.get('/pay/:token/voucher.pdf', async (req, res) => {
  const inv = await invoiceByToken(tokenParam.parse(req.params.token));
  await sendVoucherPdf(res, inv.id, inv.institution_id);
});

// ---------------------------------------------------------------- the test provider

const notInProduction = (_req: Request, _res: Response, next: () => void) => {
  if (getConfig().env === 'production') throw notFound();
  next();
};

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!);

router.get('/fake/checkout', notInProduction, async (req, res) => {
  const q = z.object({ reference: z.string().regex(/^AX[0-9A-F]{18}$/), amount: z.string().max(20) }).parse(req.query);
  const { rows } = await db.query(`SELECT c.amount, c.currency, i.number, i.title FROM checkout_sessions c JOIN invoices i ON i.id = c.invoice_id WHERE c.reference = $1 AND c.provider = 'fake'`, [q.reference]);
  if (!rows[0]) throw notFound();
  const r = rows[0];
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test payment</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px;color:#111827}h1{font-size:20px}.box{border:1px solid #e5e7eb;border-radius:12px;padding:20px}
button{display:block;width:100%;padding:12px;margin-top:12px;border-radius:8px;border:0;font-size:16px;cursor:pointer}.pay{background:#4f46e5;color:#fff}.fail{background:#f3f4f6}</style></head>
<body><h1>Test payment</h1><p>This is the test provider: no money moves.</p><div class="box"><p><b>${esc(r.title)}</b><br>Invoice ${esc(r.number)}</p><p style="font-size:24px"><b>${esc(r.currency)} ${esc(String(r.amount))}</b></p>
<form method="post" action="/api/payments/fake/complete"><input type="hidden" name="reference" value="${esc(q.reference)}"><button class="pay" name="outcome" value="succeeded">Pay</button><button class="fail" name="outcome" value="failed">Decline</button></form></div></body></html>`);
});

router.post('/fake/complete', notInProduction, express.urlencoded({ extended: false, limit: '10kb' }), async (req, res) => {
  const b = z.object({ reference: z.string().regex(/^AX[0-9A-F]{18}$/), outcome: z.enum(['succeeded', 'failed']) }).parse(req.body);
  const { rows } = await db.query<{ amount: string; account_id: number }>(
    `SELECT c.amount, a.id AS account_id FROM checkout_sessions c JOIN payment_accounts a ON a.institution_id = c.institution_id AND a.provider = 'fake' WHERE c.reference = $1 AND c.provider = 'fake'`,
    [b.reference]
  );
  if (!rows[0]) throw badRequest('Unknown payment');
  const found = await loadAccountById(rows[0].account_id);
  const body = JSON.stringify({ id: `evt_${crypto.randomBytes(8).toString('hex')}`, type: `payment.${b.outcome}`, reference: b.reference, provider_ref: `fake_pi_${crypto.randomBytes(8).toString('hex')}`, amount: Number(rows[0].amount) });
  const sig = signFake(body, found?.account?.secrets.webhook_secret ?? 'fake-secret');
  await handleCallback('fake', rows[0].account_id, { headers: { 'x-fake-signature': sig }, rawBody: Buffer.from(body), body: JSON.parse(body), query: {} });
  res.redirect(303, returnPage(b.reference));
});

export default router;
