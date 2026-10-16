// The full fee cycle: fee structure with instalments and a late fine → discounts → invoices
// generated (once) → the guardian pays online (test provider): checkout → signed webhook,
// applied exactly once → receipt → counter and bank payments → late fines → defaulters and
// reminders over SMS → refund → reconciliation (provider and bank statement) → reports and
// accounting exports. Plus who may see what, and webhook forgeries.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture, request, app } from './helpers/http';
import { pool } from './helpers/fixture';
import { runJob } from '../src/jobs';
import { signFake } from '../src/lib/finance/providers';
import { sentMessages } from '../src/lib/messaging';

let f: Awaited<ReturnType<typeof fixture.resetDb>>;
let admin: ReturnType<typeof as>;
let structureId = 0;
let accountId = 0;
const SECRET = 'whsec_test_123';
const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
const invoiceOf = async (studentId: number, label: string) =>
  (await q(`SELECT i.* FROM invoices i JOIN fee_installments x ON x.id = i.installment_id WHERE i.student_id = $1 AND x.label = $2`, [studentId, label]))[0];

const webhook = (body: object, secret = SECRET, acct = accountId) => {
  const raw = JSON.stringify(body);
  return request(app).post(`/api/payments/webhook/fake/${acct}`).set('Content-Type', 'application/json').set('X-Fake-Signature', signFake(raw, secret)).send(raw);
};

beforeAll(async () => {
  f = await fixture.resetDb();
  admin = as(f.tokens.adminA);
});

describe('setting up fees', () => {
  it('creates a fee structure with heads, instalments and a late fine', async () => {
    const res = await admin.post('/api/finance/structures', {
      name: 'Class fees 2026',
      items: [
        { head: 'Tuition', amount: 5000 },
        { head: 'Admission', amount: 2000, frequency: 'once' },
      ],
      installments: [
        { label: 'August', due_date: '2026-08-10' },
        { label: 'September', due_date: '2026-09-10' },
      ],
      late_fine: { kind: 'per_day', amount: 50, max: 500 },
    });
    expect(res.status).toBe(201);
    structureId = res.body.id;
    expect(res.body.items).toHaveLength(2);
    expect(res.body.installments.map((i: { label: string }) => i.label)).toEqual(['August', 'September']);
  });

  it('validates the structure and refuses other people', async () => {
    expect((await admin.post('/api/finance/structures', { name: 'x', items: [], installments: [] })).status).toBe(400);
    expect((await admin.post('/api/finance/structures', { name: 'x', items: [{ head: 'A', amount: 1 }, { head: 'a', amount: 2 }], installments: [{ label: 'x', due_date: '2026-01-01' }] })).status).toBe(400);
    for (const who of ['t1', 's1', 'p1', 'adminB'] as const) {
      expect((await as(f.tokens[who]).get(`/api/finance/structures/${structureId}`)).status, who).toBe(who === 'adminB' ? 404 : 403);
    }
  });

  it('gives a scholarship to one student', async () => {
    const d = await admin.post('/api/finance/discounts', { name: 'Merit scholarship', kind: 'scholarship', method: 'percent', value: 50, heads: ['Tuition'] });
    expect(d.status).toBe(201);
    expect((await admin.post('/api/finance/discounts', { name: 'Too much', value: 150 })).status).toBe(400);
    expect((await admin.post('/api/finance/student-discounts', { student_id: f.students.S2.id, discount_id: d.body.id, reason: 'Top of class' })).status).toBe(201);
    expect((await admin.post('/api/finance/student-discounts', { student_id: f.students.SB.id, discount_id: d.body.id })).status).toBe(400); // other institution
  });

  it('previews, then generates the invoices exactly once', async () => {
    const preview = await admin.post(`/api/finance/structures/${structureId}/generate`, {});
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ students: 3, invoices: 6 });
    // August: tuition + admission; Sara 7000, Sam 7000 - 50% of tuition = 4500
    const sam = preview.body.preview.find((p: { student_id: number; label: string }) => p.student_id === f.students.S2.id && p.label === 'August');
    expect(sam.total).toBe(4500);
    const made = await admin.post(`/api/finance/structures/${structureId}/generate`, { commit: true, issue_date: '2026-08-01' });
    expect(made.status).toBe(201);
    expect(made.body.created).toBe(6);
    const again = await admin.post(`/api/finance/structures/${structureId}/generate`, { commit: true });
    expect(again.body.created).toBe(0);
    expect(Number((await invoiceOf(f.students.S1.id, 'August')).total)).toBe(7000);
    expect(Number((await invoiceOf(f.students.S1.id, 'September')).total)).toBe(5000);
    expect(Number((await invoiceOf(f.students.S2.id, 'August')).total)).toBe(4500);
  });

  it("an instalment with invoices can't be removed, and the structure can't be deleted", async () => {
    const res = await admin.put(`/api/finance/structures/${structureId}`, {
      name: 'Class fees 2026',
      items: [{ head: 'Tuition', amount: 5000 }],
      installments: [{ label: 'October', due_date: '2026-10-10' }],
    });
    expect(res.status).toBe(409);
    expect((await admin.delete(`/api/finance/structures/${structureId}`)).status).toBe(409);
  });
});

describe('who sees fees', () => {
  it('guardians and the student see their own; teachers and others do not', async () => {
    const inv = await invoiceOf(f.students.S1.id, 'August');
    expect((await as(f.tokens.p1).get(`/api/finance/invoices/${inv.id}`)).status).toBe(200);
    expect((await as(f.tokens.s1).get(`/api/finance/invoices/${inv.id}`)).status).toBe(200);
    expect((await as(f.tokens.s2).get(`/api/finance/invoices/${inv.id}`)).status).toBe(403);
    expect((await as(f.tokens.t1).get(`/api/finance/invoices/${inv.id}`)).status).toBe(403);
    expect((await as(f.tokens.adminB).get(`/api/finance/invoices/${inv.id}`)).status).toBe(404);
    expect((await as(f.tokens.t1).get('/api/finance/invoices')).status).toBe(403);
    const mine = await as(f.tokens.p1).get('/api/finance/my');
    expect(mine.body.students[0].invoices.length).toBeGreaterThanOrEqual(2);
    // the pay token is for staff (and the payer's link), not in the payer's API view
    expect((await as(f.tokens.p1).get(`/api/finance/invoices/${inv.id}`)).body.pay_token).toBeUndefined();
  });

  it('an institution can hide fees from students (guardians still see them)', async () => {
    expect((await admin.put('/api/finance/settings', { show_to_students: false })).status).toBe(200);
    const inv = await invoiceOf(f.students.S1.id, 'August');
    expect((await as(f.tokens.s1).get(`/api/finance/invoices/${inv.id}`)).status).toBe(403);
    expect((await as(f.tokens.s1).get('/api/finance/my')).body.hidden).toBe(true);
    expect((await as(f.tokens.s1).get('/api/me/student/overview')).body.fee).toBeNull();
    expect((await as(f.tokens.p1).get(`/api/finance/invoices/${inv.id}`)).status).toBe(200);
    await admin.put('/api/finance/settings', { show_to_students: true, reminder_channels: ['in_app', 'sms'], remind_after_days: [1] });
  });
});

describe('paying online (test provider)', () => {
  let reference = '';

  it('the admin connects the provider; secrets are never shown back', async () => {
    expect((await as(f.tokens.t1).put('/api/finance/accounts/fake', {})).status).toBe(403);
    expect((await admin.put('/api/finance/accounts/fake', { secrets: { nope: 'x' } })).status).toBe(400);
    expect((await admin.put('/api/finance/accounts/fake', { secrets: { webhook_secret: SECRET } })).status).toBe(200);
    expect((await admin.put('/api/finance/accounts/bank', { public_config: { bank_name: 'Meezan Bank', account_title: 'Alpha School', iban: 'PK36MEZN0000000102345678' } })).status).toBe(200);
    const list = await admin.get('/api/finance/accounts');
    const fake = list.body.find((a: { provider: string }) => a.provider === 'fake');
    expect(fake.secrets).toEqual([{ key: 'webhook_secret', set: true }]);
    expect(JSON.stringify(list.body)).not.toContain(SECRET);
    accountId = Number(fake.webhook_url.split('/').pop());
    const opts = await as(f.tokens.p1).get('/api/finance/payment-options');
    expect(opts.body.map((o: { provider: string }) => o.provider).sort()).toEqual(['bank', 'fake']);
  });

  it('the guardian starts a checkout', async () => {
    const inv = await invoiceOf(f.students.S1.id, 'August');
    expect((await as(f.tokens.p1).post(`/api/finance/invoices/${inv.id}/checkout`, { provider: 'fake', amount: 99999 })).status).toBe(400);
    expect((await as(f.tokens.p1).post(`/api/finance/invoices/${inv.id}/checkout`, { provider: 'stripe' })).status).toBe(400); // not connected
    const res = await as(f.tokens.p1).post(`/api/finance/invoices/${inv.id}/checkout`, { provider: 'fake' });
    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(7000);
    expect(res.body.redirectUrl).toContain('/api/payments/fake/checkout');
    reference = res.body.reference;
    expect((await request(app).get(`/api/payments/status/${reference}`)).body.status).toBe('pending');
    // the test checkout page renders
    const page = await request(app).get(res.body.redirectUrl);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Test payment');
  });

  it('rejects forged and mismatched webhooks', async () => {
    const forged = await webhook({ id: 'evt_forged', type: 'payment.succeeded', reference, provider_ref: 'pi_x', amount: 7000 }, 'wrong-secret');
    expect(forged.status).toBe(400);
    const cheap = await webhook({ id: 'evt_cheap', type: 'payment.succeeded', reference, provider_ref: 'pi_cheap', amount: 1 });
    expect(cheap.body.result).toBe('amount_mismatch');
    expect(Number((await invoiceOf(f.students.S1.id, 'August')).paid)).toBe(0);
  });

  it('applies the signed webhook exactly once and issues a receipt', async () => {
    const ev = { id: 'evt_paid_1', type: 'payment.succeeded', reference, provider_ref: 'fake_pi_1', amount: 7000 };
    expect((await webhook(ev)).body.result).toBe('processed');
    expect((await webhook(ev)).body.result).toBe('duplicate'); // same event delivered again
    expect((await webhook({ ...ev, id: 'evt_paid_2' })).body.result).toBe('duplicate'); // another event for the same checkout
    const inv = await invoiceOf(f.students.S1.id, 'August');
    expect(inv.status).toBe('paid');
    const pays = await q(`SELECT * FROM payments WHERE invoice_id = $1`, [inv.id]);
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ method: 'online', provider: 'fake', provider_ref: 'fake_pi_1' });
    const status = await request(app).get(`/api/payments/status/${reference}`);
    expect(status.body).toMatchObject({ status: 'succeeded', receipt_no: pays[0].receipt_no });
    const receipt = await as(f.tokens.p1).get(`/api/finance/payments/${pays[0].id}/receipt.pdf`);
    expect(receipt.status).toBe(200);
    expect(receipt.headers['content-type']).toBe('application/pdf');
    expect((await as(f.tokens.s2).get(`/api/finance/payments/${pays[0].id}/receipt.pdf`)).status).toBe(403);
    // the guardian was told
    expect((await q(`SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'payment_received'`, [f.users.p1.id])).length).toBe(1);
    // paying again is refused
    expect((await as(f.tokens.p1).post(`/api/finance/invoices/${inv.id}/checkout`, { provider: 'fake' })).status).toBe(409);
  });

  it("another institution's account can't settle this institution's checkout", async () => {
    const other = await as(f.tokens.adminB).put('/api/finance/accounts/fake', { secrets: { webhook_secret: 'b-secret' } });
    expect(other.status).toBe(200);
    const bAcct = Number((await as(f.tokens.adminB).get('/api/finance/accounts')).body.find((a: { provider: string }) => a.provider === 'fake').webhook_url.split('/').pop());
    const inv = await invoiceOf(f.students.S1.id, 'September');
    const start = await as(f.tokens.p1).post(`/api/finance/invoices/${inv.id}/checkout`, { provider: 'fake' });
    const res = await webhook({ id: 'evt_cross', type: 'payment.succeeded', reference: start.body.reference, provider_ref: 'pi_cross', amount: 5000 }, 'b-secret', bAcct);
    expect(res.body.result).toBe('unknown_reference');
    expect(Number((await invoiceOf(f.students.S1.id, 'September')).paid)).toBe(0);
  });

  it('a public pay link shows what is owed without private details, and can pay', async () => {
    const inv = await invoiceOf(f.students.S3.id, 'August');
    expect((await request(app).get('/api/payments/pay/not-a-real-token-at-all')).status).toBe(404);
    const page = await request(app).get(`/api/payments/pay/${inv.pay_token}`);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ number: inv.number, balance: 7000, payer: 'Saad S' });
    expect(page.body.id).toBeUndefined();
    expect(page.body.options.find((o: { provider: string }) => o.provider === 'bank').details.iban).toBe('PK36MEZN0000000102345678');
    const start = await request(app).post(`/api/payments/pay/${inv.pay_token}/checkout`).send({ provider: 'fake', amount: 1000 });
    expect(start.status).toBe(201);
    // the test page's own "Pay" button completes it
    const done = await request(app).post('/api/payments/fake/complete').type('form').send({ reference: start.body.reference, outcome: 'succeeded' });
    expect(done.status).toBe(303);
    expect(done.headers.location).toContain(`/pay/return?ref=${start.body.reference}`);
    expect(Number((await invoiceOf(f.students.S3.id, 'August')).paid)).toBe(1000);
    const voucher = await request(app).get(`/api/payments/pay/${inv.pay_token}/voucher.pdf`);
    expect(voucher.headers['content-type']).toBe('application/pdf');
  });
});

describe('at the counter, fines, defaulters and reminders', () => {
  it('records cash and bank payments, never more than the balance', async () => {
    const inv = await invoiceOf(f.students.S3.id, 'August');
    expect((await as(f.tokens.t1).post(`/api/finance/invoices/${inv.id}/payments`, { amount: 100 })).status).toBe(403);
    expect((await admin.post(`/api/finance/invoices/${inv.id}/payments`, { amount: 999999 })).status).toBe(400);
    const cash = await admin.post(`/api/finance/invoices/${inv.id}/payments`, { amount: 2000 });
    expect(cash.status).toBe(201);
    expect(cash.body.invoice.status).toBe('partially_paid');
    const bank = await admin.post(`/api/finance/invoices/${inv.id}/payments`, { amount: 1500, method: 'bank', reference: 'TRX-778' });
    expect(bank.status).toBe(201);
    expect((await admin.post(`/api/finance/invoices/${inv.id}/payments`, { amount: 10, method: 'bank', reference: 'TRX-778' })).status).toBe(409);
    const statement = await as(f.tokens.s3).get(`/api/finance/students/${f.students.S3.id}/statement`);
    expect(statement.status).toBe(200);
    // two instalments and the fixture's own invoice (1000, 500 paid)
    expect(statement.body.balance).toBe(7000 + 5000 + 1000 - 500 - 1000 - 2000 - 1500);
  });

  it('charges late fines once per day, up to the cap', async () => {
    await runJob('fees.daily', { today: '2026-08-15', institutionId: f.institutions.A.id });
    await runJob('fees.daily', { today: '2026-08-15', institutionId: f.institutions.A.id });
    const sam = await invoiceOf(f.students.S2.id, 'August');
    expect(Number(sam.total)).toBe(4500 + 50);
    await runJob('fees.daily', { today: '2026-08-16', institutionId: f.institutions.A.id });
    expect(Number((await invoiceOf(f.students.S2.id, 'August')).total)).toBe(4600);
    // the paid invoice gets no fine
    expect(Number((await invoiceOf(f.students.S1.id, 'August')).total)).toBe(7000);
  });

  it('lists defaulters and reminds their guardians by SMS with a pay link', async () => {
    const d = await admin.get('/api/finance/defaulters');
    expect(d.status).toBe(200);
    const ids = d.body.map((r: { student_id: number }) => r.student_id);
    expect(ids).toContain(f.students.S2.id);
    // Sara paid August; only September (5000) is overdue
    expect(Number(d.body.find((r: { student_id: number }) => r.student_id === f.students.S1.id).overdue)).toBe(5000);
    const csv = await admin.get('/api/finance/defaulters?format=csv');
    expect(csv.headers['content-type']).toContain('text/csv');
    // Sam's guardian, with a local mobile number
    const g = (await q(`INSERT INTO guardians (institution_id, first_name, last_name, phone) VALUES ($1, 'Father', 'of Sam', '0300 1234567') RETURNING id`, [f.institutions.A.id]))[0];
    await q(`INSERT INTO guardianships (institution_id, guardian_id, student_id, relationship) VALUES ($1, $2, $3, 'father')`, [f.institutions.A.id, g.id, f.students.S2.id]);
    sentMessages.length = 0;
    const sam = await invoiceOf(f.students.S2.id, 'August');
    const r = await admin.post('/api/finance/reminders', { invoice_ids: [sam.id], channels: ['sms', 'whatsapp'] });
    expect(r.body).toEqual({ invoices: 1, reminded: 1 });
    expect(sentMessages.map((m) => m.channel).sort()).toEqual(['sms', 'whatsapp']);
    expect(sentMessages[0]!.to).toBe('+923001234567');
    expect(sentMessages[0]!.text).toContain(`/pay/${sam.pay_token}`);
    expect((await q(`SELECT count(*)::int n FROM delivery_logs WHERE channel = 'sms' AND status = 'sent'`))[0].n).toBe(1);
  });

  it('scheduled reminders go out once after the due date', async () => {
    sentMessages.length = 0;
    await runJob('fees.daily', { today: '2026-08-11', institutionId: f.institutions.A.id });
    const first = sentMessages.length;
    expect(first).toBeGreaterThan(0);
    await runJob('fees.daily', { today: '2026-08-11', institutionId: f.institutions.A.id });
    expect(sentMessages.length).toBe(first);
  });

  it('waives part of a balance, adjusts and cancels with reasons', async () => {
    const sam = await invoiceOf(f.students.S2.id, 'September');
    expect((await admin.post(`/api/finance/invoices/${sam.id}/waive`, { amount: 500, reason: 'Hardship' })).status).toBe(201);
    expect(Number((await invoiceOf(f.students.S2.id, 'September')).total)).toBe(2500 - 500);
    expect((await admin.post(`/api/finance/invoices/${sam.id}/waive`, { amount: 99999, reason: 'x' })).status).toBe(400);
    expect((await admin.post(`/api/finance/invoices/${sam.id}/cancel`, { reason: 'Left school' })).status).toBe(200);
    const s3 = await invoiceOf(f.students.S3.id, 'August');
    expect((await admin.post(`/api/finance/invoices/${s3.id}/cancel`, { reason: 'x' })).status).toBe(409); // has payments
  });
});

describe('refunds, reconciliation and reports', () => {
  it('refunds part of the online payment', async () => {
    const inv = await invoiceOf(f.students.S1.id, 'August');
    const pay = (await q(`SELECT id FROM payments WHERE invoice_id = $1`, [inv.id]))[0];
    expect((await as(f.tokens.p1).post(`/api/finance/payments/${pay.id}/refund`, { amount: 1, reason: 'x' })).status).toBe(403);
    expect((await admin.post(`/api/finance/payments/${pay.id}/refund`, { amount: 8000, reason: 'Too much' })).status).toBe(400);
    const r = await admin.post(`/api/finance/payments/${pay.id}/refund`, { amount: 2000, reason: 'Admission fee returned' });
    expect(r.status).toBe(201);
    const after = await invoiceOf(f.students.S1.id, 'August');
    expect(after).toMatchObject({ status: 'partially_paid', paid: '5000.00' });
  });

  it('reconciles online payments with what the provider settled', async () => {
    const res = await admin.post('/api/finance/reconcile', { provider: 'fake', from: '2026-01-01', to: '2027-12-31' });
    expect(res.status).toBe(201);
    expect(res.body.counts.matched).toBe(2);
    expect(res.body.counts.missing_at_provider).toBe(0);
    expect((await q(`SELECT count(*)::int n FROM payments WHERE provider = 'fake' AND reconciled_at IS NOT NULL`))[0].n).toBe(2);
  });

  it('reconciles bank payments against an uploaded statement', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const csv = `Date,Narration,Reference,Credit\n${day},Fee deposit,TRX-778,1500\n${day},Unknown deposit,TRX-999,800\n`;
    const res = await admin.upload('post', '/api/finance/reconcile', { buffer: Buffer.from(csv), name: 'statement.csv' }, { provider: 'bank', from: '2026-01-01', to: '2027-12-31' });
    expect(res.status).toBe(201);
    expect(res.body.counts).toMatchObject({ matched: 1, missing_in_acadex: 1 });
    expect((await as(f.tokens.t1).post('/api/finance/reconcile', { provider: 'fake', from: '2026-01-01', to: '2026-12-31' })).status).toBe(403);
  });

  it('records expenses and reports income against them', async () => {
    expect((await admin.post('/api/finance/expenses', { date: '2026-08-05', category: 'Utilities', amount: 1200, vendor: 'K-Electric' })).status).toBe(201);
    expect((await admin.post('/api/finance/expenses', { date: '2026-08-05', category: 'Utilities', amount: -5 })).status).toBe(400);
    expect((await as(f.tokens.p1).get('/api/finance/expenses')).status).toBe(403);
    const day = new Date().toISOString().slice(0, 10);
    const s = await admin.get(`/api/finance/summary?from=2026-01-01&to=${day > '2026-12-31' ? day : '2026-12-31'}`);
    expect(s.status).toBe(200);
    expect(Number(s.body.collected)).toBe(7000 + 1000 + 2000 + 1500 + 1000 /* the fixture's two payments */);
    expect(Number(s.body.refunded)).toBe(2000);
    expect(Number(s.body.expenses)).toBe(1200);
    const ie = await admin.get('/api/finance/reports/income-expense?from=2026-01-01&to=2027-12-31&format=xlsx');
    expect(ie.headers['content-type']).toContain('spreadsheetml');
  });

  it('exports receipts for Tally and QuickBooks', async () => {
    const tally = await admin.get('/api/finance/export/tally?from=2026-01-01&to=2027-12-31');
    expect(tally.headers['content-type']).toContain('xml');
    expect(tally.text).toContain('<VOUCHER VCHTYPE="Receipt"');
    const qb = await admin.get('/api/finance/export/quickbooks?from=2026-01-01&to=2027-12-31');
    expect(qb.text.split('\n')[0]).toContain('SalesReceiptNo,Customer,SalesReceiptDate');
    expect((await as(f.tokens.s1).get('/api/finance/export/tally?from=2026-01-01&to=2027-12-31')).status).toBe(403);
  });

  it('the old quick-collect endpoint now creates an invoice with its payment', async () => {
    const res = await admin.post('/api/institution/fees', { student_id: f.students.S1.id, total_fee: 300, paid_amount: 100 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'partially_paid', total_fee: '300.00', paid_amount: '100.00', remaining_balance: '200.00' });
    expect(res.body.receipt_id).toMatch(/^RCT-/);
  });
});
