// Starting an online payment: a checkout session with our own unguessable reference, handed to
// the provider with where to send the result (our webhook) and where to bring the payer back
// (the web app's return page, which polls the session's status).
import crypto from 'node:crypto';
import { getConfig } from '../../config';
import { db } from '../../db/context';
import { badRequest, conflict } from '../errors';
import { allowedProviders } from '../country';
import { balanceOf, loadAccount, round2 } from './ledger';
import { PROVIDERS, type CheckoutResult, type ProviderName } from './providers';

export async function startCheckout(
  inv: { id: number; institution_id: number; number: string; title: string; status: string; currency: string; total: string; paid: string },
  provider: Exclude<ProviderName, 'bank'>,
  amount: number | undefined,
  payer: { email?: string; phone?: string } = {}
): Promise<CheckoutResult & { reference: string; amount: number }> {
  if (provider === 'fake' && getConfig().env === 'production') throw badRequest('The test provider is not available in production');
  if (inv.status === 'cancelled') throw conflict('This invoice was cancelled', 'CANCELLED');
  const balance = balanceOf(inv);
  if (balance <= 0) throw conflict('This invoice is already paid', 'PAID');
  const pay = round2(amount ?? balance);
  if (pay > balance + 0.001) throw badRequest(`More than the balance due (${balance.toFixed(2)})`, { amount: 'too_much' });
  if (provider === 'jazzcash' && inv.currency !== 'PKR') throw badRequest('JazzCash takes payments in PKR only');
  if (provider === 'easypaisa' && inv.currency !== 'PKR') throw badRequest('Easypaisa takes payments in PKR only');
  if (!(await allowedProviders(inv.institution_id)).has(provider)) throw badRequest(`${PROVIDERS[provider].label} is not available in this institution's country`);
  const acct = await loadAccount(inv.institution_id, provider);
  if (!acct) throw badRequest(`${PROVIDERS[provider].label} is not set up for this institution`);
  // JazzCash allows 20 characters; keep every reference short and unguessable
  const reference = `AX${crypto.randomBytes(9).toString('hex').toUpperCase()}`;
  const cfg = getConfig();
  const result = await PROVIDERS[provider].createCheckout(acct, {
    reference,
    amount: pay,
    currency: inv.currency,
    title: inv.title,
    invoiceNumber: inv.number,
    payerEmail: payer.email,
    payerPhone: payer.phone,
    returnUrl: `${cfg.appUrl}/pay/return?ref=${reference}`,
    callbackUrl: `${cfg.apiPublicUrl}/payments/webhook/${provider}/${acct.id}`,
  });
  await db.query(
    `INSERT INTO checkout_sessions (institution_id, invoice_id, provider, reference, provider_session_id, amount, currency, return_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [inv.institution_id, inv.id, provider, reference, result.providerSessionId ?? null, pay, inv.currency, `${cfg.appUrl}/pay/return?ref=${reference}`]
  );
  return { ...result, reference, amount: pay };
}
