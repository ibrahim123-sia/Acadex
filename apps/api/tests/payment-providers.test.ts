// The real providers' formats, without calling them: Stripe webhook signatures (and a Stripe
// event applied end to end), JazzCash's secure hash on the checkout form and on its browser
// return, and Easypaisa's hashed request.
import crypto from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture, request, app } from './helpers/http';
import { pool } from './helpers/fixture';
import { easypaisaHash, jazzcashHash, verifyStripeSignature } from '../src/lib/finance/providers';

const stripeSig = (body: string, secret: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

describe('signatures', () => {
  it('Stripe: accepts a fresh correct signature only', () => {
    const body = Buffer.from('{"id":"evt_1"}');
    expect(verifyStripeSignature(body, stripeSig(body.toString(), 'whsec'), 'whsec')).toBe(true);
    expect(verifyStripeSignature(body, stripeSig(body.toString(), 'other'), 'whsec')).toBe(false);
    expect(verifyStripeSignature(body, stripeSig(body.toString(), 'whsec', Math.floor(Date.now() / 1000) - 3600), 'whsec')).toBe(false);
    expect(verifyStripeSignature(body, undefined, 'whsec')).toBe(false);
  });

  it('JazzCash: the hash covers the sorted non-empty pp fields, salted', () => {
    const salt = 'abc123';
    const fields = { pp_Amount: '100', pp_TxnRefNo: 'T1', pp_BankID: '', pp_Version: '1.1' };
    const expected = crypto.createHmac('sha256', salt).update(`${salt}&100&T1&1.1`).digest('hex').toUpperCase();
    expect(jazzcashHash(fields, salt)).toBe(expected);
    expect(jazzcashHash({ ...fields, pp_SecureHash: 'ignored' }, salt)).toBe(expected);
  });

  it('Easypaisa: AES-ECB of the sorted request with the store key', () => {
    const key = '0123456789ABCDEF';
    const enc = easypaisaHash({ storeId: '1', amount: '10.0' }, key);
    const d = crypto.createDecipheriv('aes-128-ecb', Buffer.from(key), null);
    expect(Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString()).toBe('amount=10.0&storeId=1');
  });
});

describe('end to end with the real formats', () => {
  let f: Awaited<ReturnType<typeof fixture.resetDb>>;
  let admin: ReturnType<typeof as>;
  const accounts: Record<string, number> = {};

  beforeAll(async () => {
    f = await fixture.resetDb();
    admin = as(f.tokens.adminA);
    await admin.put('/api/finance/accounts/stripe', { secrets: { secret_key: 'sk_test_x', webhook_secret: 'whsec_stripe' } });
    await admin.put('/api/finance/accounts/jazzcash', { secrets: { merchant_id: 'MC123', password: 'pw', integrity_salt: 'salt42' } });
    const list = (await admin.get('/api/finance/accounts')).body as { provider: string; webhook_url: string | null }[];
    for (const a of list) if (a.webhook_url) accounts[a.provider] = Number(a.webhook_url.split('/').pop());
  });

  it('a Stripe "checkout.session.completed" event pays the invoice, once', async () => {
    const inv = f.fees.F1;
    // the session Stripe would have created (creating it calls Stripe, so it's inserted here)
    await pool.query(`INSERT INTO checkout_sessions (institution_id, invoice_id, provider, reference, amount, currency) VALUES ($1,$2,'stripe','AXSTRIPE00000000000001',500,'PKR')`, [f.institutions.A.id, inv.id]);
    const body = JSON.stringify({
      id: 'evt_stripe_1',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', client_reference_id: 'AXSTRIPE00000000000001', payment_status: 'paid', payment_intent: 'pi_1', amount_total: 50000 } },
    });
    const send = (sig: string) => request(app).post(`/api/payments/webhook/stripe/${accounts.stripe}`).set('Content-Type', 'application/json').set('Stripe-Signature', sig).send(body);
    expect((await send(stripeSig(body, 'wrong'))).status).toBe(400);
    expect((await send(stripeSig(body, 'whsec_stripe'))).body.result).toBe('processed');
    expect((await send(stripeSig(body, 'whsec_stripe'))).body.result).toBe('duplicate');
    const { rows } = await pool.query(`SELECT status, paid FROM invoices WHERE id = $1`, [inv.id]);
    expect(rows[0]).toEqual({ status: 'paid', paid: '1000.00' });
  });

  it('JazzCash: the checkout form is signed, and a signed browser return records the payment', async () => {
    const inv = f.fees.F3;
    const start = await as(f.tokens.s3).post(`/api/finance/invoices/${inv.id}/checkout`, { provider: 'jazzcash' });
    expect(start.status).toBe(201);
    const fields = start.body.form.fields as Record<string, string>;
    expect(start.body.form.action).toContain('sandbox.jazzcash.com.pk');
    expect(fields.pp_SecureHash).toBe(jazzcashHash(fields, 'salt42'));
    expect(fields.pp_Amount).toBe('50000'); // paisa
    // JazzCash posts the result back with the payer's browser
    const result: Record<string, string> = { pp_TxnRefNo: fields.pp_TxnRefNo!, ppmpf_1: start.body.reference, pp_Amount: '50000', pp_ResponseCode: '000', pp_RetreivalReferenceNo: '990011', pp_TxnCurrency: 'PKR' };
    const tampered = { ...result, pp_SecureHash: jazzcashHash({ ...result, pp_Amount: '1' }, 'salt42') };
    const bad = await request(app).post(`/api/payments/webhook/jazzcash/${accounts.jazzcash}`).type('form').send(tampered);
    expect(bad.status).toBe(303);
    expect(bad.headers.location).toContain('error=unverified');
    const good = await request(app).post(`/api/payments/webhook/jazzcash/${accounts.jazzcash}`).type('form').send({ ...result, pp_SecureHash: jazzcashHash(result, 'salt42') });
    expect(good.status).toBe(303);
    expect(good.headers.location).toContain(`/pay/return?ref=${start.body.reference}`);
    const { rows } = await pool.query(`SELECT method, provider, provider_ref, amount FROM payments WHERE invoice_id = $1 AND method = 'online'`, [inv.id]);
    expect(rows).toEqual([{ method: 'online', provider: 'jazzcash', provider_ref: '990011', amount: '500.00' }]);
  });

  it('JazzCash refuses currencies other than PKR', async () => {
    await pool.query(`UPDATE invoices SET currency = 'USD' WHERE id = $1`, [f.fees.F3.id]);
    await pool.query(`UPDATE invoices SET paid = 0, status = 'issued' WHERE id = $1`, [f.fees.F3.id]);
    expect((await admin.post(`/api/finance/invoices/${f.fees.F3.id}/checkout`, { provider: 'jazzcash' })).status).toBe(400);
  });
});
