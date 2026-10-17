// Phase 6 — the platform and the ecosystem: plans and modules, the Library and HR & payroll
// modules (and transport / hostel billing, inventory, visitors), tenant invoices with tax and
// dunning, usage metering, support sign-in with consent, data exports and deletion, the public
// API with keys and scopes, webhooks, LTI 1.3 launches, Google sign-in, consents and privacy
// requests, retention, reports with schedules, the public site and OneRoster export.
import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { app, as, fixture, request } from './helpers/http';
import { clearJobs, drainJobs, runJob } from '../src/jobs';
import { readZip } from '../src/lib/zip';
import { webhookTransport } from '../src/lib/webhooks';
import { verifyJwt } from '../src/lib/lti';
import { ssoTransport } from '../src/lib/sso';
import { dnsLookup } from '../src/routes/tenant-saas';
import { runAsSystem } from '../src/db/context';
import { emitWebhook } from '../src/lib/webhooks';

let f;
const cookies = (r: { headers: Record<string, unknown> }) => (r.headers['set-cookie'] ?? []) as string[];
const q = async (sql: string, p: unknown[] = []) => (await fixture.pool.query(sql, p)).rows;
const A = () => f.institutions.A.id;
const setPlan = (plan: string, inst = A()) => q(`UPDATE institutions SET plan = $2, trial_ends_at = NULL WHERE id = $1`, [inst, plan]);
const binary = (res: { body: unknown }) => res.body as Buffer;
const getBinary = (path: string, token: string) =>
  request(app)
    .get(path)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Acadex-Client', 'web')
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });

beforeAll(async () => {
  f = await fixture.resetDb();
});
beforeEach(() => clearJobs());

describe('plans and modules', () => {
  it('a module needs the plan and the switch', async () => {
    await setPlan('free');
    const admin = as(f.tokens.adminA);
    expect((await admin.get('/api/library/books')).status).toBe(403);
    expect((await admin.put('/api/modules', { modules: { library: true } })).status).toBe(403); // not in the free plan
    await setPlan('pro');
    expect((await admin.get('/api/library/books')).body.code).toBe('MODULE_OFF');
    const on = await admin.put('/api/modules', { modules: { library: true, hr: true, transport: true, hostel: true, inventory: true, visitors: true } });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body.enabled).toEqual(expect.arrayContaining(['library', 'hr']));
    expect((await as(f.tokens.t1).put('/api/modules', { modules: { library: false } })).status).toBe(403);
    expect((await as(f.tokens.tb).get('/api/library/books')).status).toBe(403); // B is on the free plan
  });
});

describe('library', () => {
  it('catalogue → issue → late return with a fine → renew rules', async () => {
    const admin = as(f.tokens.adminA);
    const b = await admin.post('/api/library/books', { title: 'Things Fall Apart', authors: 'Chinua Achebe', copies: ['LIB-001', 'LIB-002'] });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect((await admin.post('/api/library/books', { title: 'X', copies: ['LIB-001'] })).status).toBe(409);
    const issue = await admin.post('/api/library/issue', { barcode: 'LIB-001', borrower_id: f.users.s1.id });
    expect(issue.status, JSON.stringify(issue.body)).toBe(201);
    expect((await admin.post('/api/library/issue', { barcode: 'LIB-001', borrower_id: f.users.s2.id })).status).toBe(409);
    expect((await admin.post('/api/library/issue', { barcode: 'LIB-002', borrower_id: f.users.sb.id })).status).toBe(400); // another institution
    expect((await as(f.tokens.s1).post('/api/library/issue', { barcode: 'LIB-002', borrower_id: f.users.s1.id })).status).toBe(403);
    const mine = await as(f.tokens.s1).get('/api/library/my-loans');
    expect(mine.body.map((l) => l.title)).toEqual(['Things Fall Apart']);
    expect((await as(f.tokens.p1).get('/api/library/my-loans')).body).toHaveLength(1); // Sara's guardian
    await q(`UPDATE library_loans SET due_on = CURRENT_DATE - 3 WHERE id = $1`, [issue.body.id]);
    expect((await as(f.tokens.s1).post(`/api/library/loans/${issue.body.id}/renew`, {})).status).toBe(409); // overdue
    const back = await admin.post('/api/library/return', { barcode: 'LIB-001' });
    expect(back.body.days_late).toBe(3);
    expect(back.body.fine).toBe(30);
    const fines = await admin.get('/api/library/loans?status=fines');
    expect(fines.body[0].fine).toBe(30);
    expect((await admin.post(`/api/library/loans/${issue.body.id}/pay-fine`, {})).status).toBe(200);
  });
});

describe('HR and payroll', () => {
  it('structures, salaries, payroll with unpaid days, approval and payslips', async () => {
    const admin = as(f.tokens.adminA);
    const st = await admin.post('/api/hr/structures', { name: 'Teaching', components: [{ name: 'House rent', kind: 'earning', calc: 'percent_of_basic', value: 40 }, { name: 'Tax', kind: 'deduction', calc: 'fixed', value: 1000 }] });
    expect(st.status).toBe(201);
    expect((await admin.put('/api/hr/salaries', { teacher_id: f.teachers.T1.id, structure_id: st.body.id, basic: 52000, effective_from: '2026-01-01' })).status).toBe(200);
    expect((await admin.put('/api/hr/salaries', { teacher_id: f.teachers.TB.id, basic: 1, effective_from: '2026-01-01' })).status).toBe(400);
    // two days of approved unpaid leave in March
    const leave = await as(f.tokens.t1).post('/api/hr/leaves', { kind: 'unpaid', from_date: '2026-03-10', to_date: '2026-03-11' });
    expect(leave.status).toBe(201);
    expect((await as(f.tokens.t1).patch(`/api/hr/leaves/${leave.body.id}`, { status: 'approved' })).status).toBe(403);
    expect((await admin.patch(`/api/hr/leaves/${leave.body.id}`, { status: 'approved' })).status).toBe(200);
    const run = await admin.post('/api/hr/payroll', { month: '2026-03' });
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    expect((await admin.post('/api/hr/payroll', { month: '2026-03' })).status).toBe(409);
    const detail = await admin.get(`/api/hr/payroll/${run.body.id}`);
    const slip = detail.body.payslips.find((p) => p.teacher_id === f.teachers.T1.id);
    // 52000 + 40% = 72800 gross; − 1000 tax − 52000/26 × 2 = 4000 → 67800
    expect(slip.gross).toBe(72800);
    expect(slip.net).toBe(67800);
    expect((await as(f.tokens.t1).get('/api/hr/payslips/mine')).body).toEqual([]); // not approved yet
    expect((await admin.post(`/api/hr/payroll/${run.body.id}/approve`, {})).status).toBe(200);
    expect((await as(f.tokens.t1).get('/api/hr/payslips/mine')).body[0].net).toBe(67800);
    const pdf = await getBinary(`/api/hr/payslips/${slip.id}/pdf`, f.tokens.t1);
    expect(pdf.status).toBe(200);
    expect(binary(pdf).subarray(0, 4).toString()).toBe('%PDF');
    expect((await getBinary(`/api/hr/payslips/${slip.id}/pdf`, f.tokens.t2)).status).toBe(404);
    const bal = await as(f.tokens.t1).get('/api/hr/leave-balances');
    expect(bal.body.find((b) => b.kind === 'casual').left).toBe(10);
  });
});

describe('transport, hostel, inventory, visitors', () => {
  it('assigns riders and bills a month once', async () => {
    const admin = as(f.tokens.adminA);
    const v = await admin.post('/api/transport/vehicles', { registration: 'LEA-1234', capacity: 1 });
    const r = await admin.post('/api/transport/routes', { name: 'Route 1', vehicle_id: v.body.id, fee: 3000, stops: [{ name: 'Gate', time: '07:10' }] });
    expect((await admin.post('/api/transport/assignments', { student_id: f.students.S1.id, route_id: r.body.id, from_date: '2026-01-01' })).status).toBe(201);
    expect((await admin.post('/api/transport/assignments', { student_id: f.students.S2.id, route_id: r.body.id, from_date: '2026-01-01' })).body.code).toBe('FULL');
    expect((await as(f.tokens.p1).get('/api/transport/mine')).body[0].route).toBe('Route 1');
    const bill = await admin.post('/api/modules/bill', { kind: 'transport', month: '2026-04', due_date: '2026-04-10' });
    expect(bill.status, JSON.stringify(bill.body)).toBe(201);
    expect(bill.body.invoices).toBe(1);
    expect((await admin.post('/api/modules/bill', { kind: 'transport', month: '2026-04', due_date: '2026-04-10' })).body).toEqual({ invoices: 0, skipped: 1 });
    const room = await admin.post('/api/hostel/rooms', { hostel: 'Boys', name: '101', capacity: 1, fee: 8000 });
    expect((await admin.post('/api/hostel/allocations', { room_id: room.body.id, student_id: f.students.S2.id, from_date: '2026-01-01' })).status).toBe(201);
    expect((await admin.post('/api/hostel/allocations', { room_id: room.body.id, student_id: f.students.S3.id, from_date: '2026-01-01' })).status).toBe(409);
  });

  it('stock cannot go negative; visitors check in and out', async () => {
    const admin = as(f.tokens.adminA);
    const item = await admin.post('/api/inventory/items', { name: 'Chalk boxes', quantity: 5, reorder_level: 2 });
    expect((await admin.post(`/api/inventory/items/${item.body.id}/move`, { change: -6 })).status).toBe(409);
    expect((await admin.post(`/api/inventory/items/${item.body.id}/move`, { change: -4, reason: 'Class 1' })).body.quantity).toBe(1);
    expect((await admin.get('/api/inventory/items?low=true')).body.map((i) => i.id)).toContain(item.body.id);
    const v = await admin.post('/api/visitors', { name: 'Courier', purpose: 'Delivery', host_user_id: f.users.t1.id });
    expect(v.body.pass_code).toMatch(/^\d{6}$/);
    expect((await admin.post(`/api/visitors/${v.body.id}/checkout`, {})).status).toBe(200);
  });
});

describe('billing, metering and dunning', () => {
  it('invoices the plan with tax, reminds, suspends and reopens on payment', async () => {
    await setPlan('pro');
    await setPlan('free', f.institutions.B.id); // B stays out of this billing run
    await q(`UPDATE institutions SET country = 'PK', currency = 'PKR' WHERE id = $1`, [A()]);
    await runJob('billing.monthly', { month: '2026-05' });
    const inv = (await q(`SELECT * FROM platform_invoices WHERE institution_id = $1 AND period_start = '2026-05-01'`, [A()]))[0];
    expect(inv.currency).toBe('PKR');
    expect(Number(inv.tax_rate)).toBe(16);
    expect(Number(inv.total)).toBeCloseTo(Number(inv.subtotal) * 1.16, 2);
    await runJob('billing.monthly', { month: '2026-05' }); // once
    expect((await q(`SELECT count(*)::int AS n FROM platform_invoices WHERE institution_id = $1`, [A()]))[0].n).toBe(1);
    const billing = await as(f.tokens.adminA).get('/api/billing');
    expect(billing.body.invoices[0].number).toBe(inv.number);
    expect((await as(f.tokens.t1).get('/api/billing')).status).toBe(403);
    await runJob('billing.dunning', { today: '2026-05-12' });
    expect((await q(`SELECT status, reminders_sent FROM platform_invoices WHERE id = $1`, [inv.id]))[0]).toEqual({ status: 'overdue', reminders_sent: 1 });
    await runJob('billing.dunning', { today: '2026-06-02' });
    expect((await q(`SELECT status, suspended_reason FROM institutions WHERE id = $1`, [A()]))[0]).toEqual({ status: 'suspended', suspended_reason: 'billing' });
    const paid = await as(f.tokens.super).post(`/api/platform/billing/invoices/${inv.id}/paid`, { method: 'bank', reference: 'HBL-998' });
    expect(paid.status).toBe(200);
    expect((await q(`SELECT status FROM institutions WHERE id = $1`, [A()]))[0].status).toBe('active');
  });

  it('records daily usage and shows cost per institution', async () => {
    await runJob('usage.daily', { day: new Date().toISOString().slice(0, 10) });
    const snap = (await q(`SELECT students FROM usage_snapshots WHERE institution_id = $1`, [A()]))[0];
    expect(snap.students).toBeGreaterThan(0);
    const usage = await as(f.tokens.super).get(`/api/platform/usage?month=${new Date().toISOString().slice(0, 7)}`);
    expect(usage.body.find((r) => r.id === A()).cost_usd).toBeGreaterThanOrEqual(0);
    expect((await as(f.tokens.adminA).get('/api/platform/usage')).status).toBe(403);
    expect((await as(f.tokens.super).get('/api/platform/health')).body.length).toBeGreaterThan(1);
  });

  it('plan limits: students and downgrades', async () => {
    await q(`UPDATE plans SET limits = jsonb_set(limits, '{students}', '2') WHERE key = 'free'`);
    const down = await as(f.tokens.adminA).post('/api/billing/plan', { plan: 'free' });
    expect(down.status).toBe(409);
    await q(`UPDATE plans SET limits = jsonb_set(limits, '{students}', '50') WHERE key = 'free'`);
  });
});

describe('support sign-in', () => {
  it('needs the institution\'s consent, opens a recorded session', async () => {
    const sup = as(f.tokens.super);
    expect((await sup.post(`/api/platform/institutions/${A()}/impersonate`, { reason: 'Help with fees' })).body.code).toBe('NO_CONSENT');
    expect((await as(f.tokens.adminA).put('/api/privacy/retention', { support_access: true })).status).toBe(200);
    const s = await sup.post(`/api/platform/institutions/${A()}/impersonate`, { reason: 'Help with fees' });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.user.id).toBe(f.users.adminA.id);
    expect(s.body.user.impersonated_by).toBe('Super');
    const audit = await q(`SELECT institution_id FROM audit_log WHERE action = 'support_sign_in'`);
    expect(audit.map((a) => a.institution_id)).toEqual(expect.arrayContaining([null, A()]));
    expect((await as(f.tokens.adminA).post(`/api/platform/institutions/${A()}/impersonate`, { reason: 'x x x' })).status).toBe(403);
  });
});

describe('exports and deletion', () => {
  it('exports every table without secrets; only the office downloads', async () => {
    const admin = as(f.tokens.adminA);
    const ex = await admin.post('/api/institution/exports', {});
    expect(ex.status).toBe(202);
    await drainJobs();
    const list = await admin.get('/api/institution/exports');
    expect(list.body[0].status).toBe('done');
    const res = await getBinary(`/api/institution/exports/${ex.body.id}/download`, f.tokens.adminA);
    const files = readZip(binary(res));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['data/students.csv', 'data/users.csv', 'README.txt']));
    expect(files['data/users.csv']!.toString()).not.toMatch(/password_hash/);
    expect(files['data/students.csv']!.toString()).toMatch(/Sara/);
    expect(files['data/students.csv']!.toString()).not.toMatch(/Bina/);
    expect((await getBinary(`/api/institution/exports/${ex.body.id}/download`, f.tokens.t1)).status).toBe(404);
  });

  it('closing the account erases it after the grace period', async () => {
    const b = as(f.tokens.adminB);
    expect((await b.post('/api/institution/deletion', { confirm: 'nope' })).status).toBe(400);
    const r = await b.post('/api/institution/deletion', { confirm: 'beta' });
    expect(r.status).toBe(200);
    await runJob('tenants.cleanup', {});
    expect((await q(`SELECT 1 FROM institutions WHERE id = $1`, [f.institutions.B.id])).length).toBe(1); // still in grace
    await runJob('tenants.cleanup', { now: new Date(Date.now() + 31 * 86_400_000).toISOString() });
    expect((await q(`SELECT 1 FROM institutions WHERE id = $1`, [f.institutions.B.id])).length).toBe(0);
    f = await fixture.resetDb();
    await setPlan('pro');
    await as(f.tokens.adminA).put('/api/modules', { modules: { library: true } });
  });
});

describe('public API and webhooks', () => {
  it('keys with scopes read only their institution', async () => {
    await setPlan('free');
    expect((await as(f.tokens.adminA).post('/api/institution/api-keys', { name: 'BI', scopes: ['students:read'] })).body.code).toBe('PLAN_FEATURE');
    await setPlan('pro');
    const k = await as(f.tokens.adminA).post('/api/institution/api-keys', { name: 'BI', scopes: ['students:read'] });
    expect(k.status).toBe(201);
    expect(k.body.key).toMatch(/^acx_/);
    const api = (path: string, key = k.body.key) => request(app).get(path).set('Authorization', `Bearer ${key}`);
    const s = await api('/api/v1/students');
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.map((x) => x.first_name)).toEqual(expect.arrayContaining(['Sara', 'Sam']));
    expect(JSON.stringify(s.body)).not.toMatch(/Bina/);
    expect(s.headers['x-total-count']).toBeDefined();
    expect((await api('/api/v1/grades')).status).toBe(403);
    expect((await api('/api/v1/students', 'acx_' + 'x'.repeat(30))).status).toBe(401);
    expect((await request(app).get('/api/v1/students')).status).toBe(401);
    expect((await as(f.tokens.t1).get('/api/institution/api-keys')).status).toBe(403);
    await as(f.tokens.adminA).delete(`/api/institution/api-keys/${k.body.id}`);
    expect((await api('/api/v1/students')).status).toBe(401);
  });

  it('webhooks are signed, retried, and pinged', async () => {
    const sent: { url: string; body: string; sig: string }[] = [];
    let fail = true;
    webhookTransport.fetch = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: String(init.body), sig: String((init.headers as Record<string, string>)['Acadex-Signature']) });
      return new Response('', { status: fail ? 500 : 200 });
    }) as typeof fetch;
    const hook = await as(f.tokens.adminA).post('/api/institution/webhooks', { url: 'https://hooks.example/acadex', events: ['payment.received'] });
    expect(hook.status).toBe(201);
    await runAsSystem(() => emitWebhook(A(), 'payment.received', { amount: 500 }));
    await drainJobs();
    expect(sent).toHaveLength(1);
    const [, t, v1] = /t=(\d+),v1=([0-9a-f]+)/.exec(sent[0]!.sig)!;
    expect(crypto.createHmac('sha256', hook.body.secret).update(`${t}.${sent[0]!.body}`).digest('hex')).toBe(v1);
    const d = (await q(`SELECT status, attempts, next_attempt_at FROM webhook_deliveries WHERE event = 'payment.received'`))[0];
    expect(d).toMatchObject({ status: 'pending', attempts: 1 });
    expect(d.next_attempt_at).toBeTruthy();
    fail = false;
    const ping = await as(f.tokens.adminA).post(`/api/institution/webhooks/${hook.body.id}/test`, {});
    expect(ping.body.result).toBe('delivered');
    expect((await runAsSystem(() => emitWebhook(f.institutions.B.id, 'payment.received', {})))).toBe(0);
  });
});

describe('LTI 1.3 launches', () => {
  it('login initiation → signed id_token posted to the tool, once', async () => {
    const admin = as(f.tokens.adminA);
    const tool = await admin.post('/api/lti/tools', { name: 'Quizlet-like', client_id: 'tool-123', login_url: 'https://tool.example/login', launch_url: 'https://tool.example/launch', deployment_id: 'dep-1' });
    expect(tool.status, JSON.stringify(tool.body)).toBe(201);
    const start = await as(f.tokens.s1).post(`/api/courses/${f.subjects.A1math.id}/lti-tools/${tool.body.id}/launch`, {});
    const url = new URL(start.body.url);
    expect(url.origin + url.pathname).toBe('https://tool.example/login');
    const hint = url.searchParams.get('login_hint')!;
    expect((await as(f.tokens.s3).post(`/api/courses/${f.subjects.A1math.id}/lti-tools/${tool.body.id}/launch`, {})).status).toBe(403);
    const auth = (redirect = 'https://tool.example/launch') => request(app).get('/api/lti/authorize').query({ client_id: 'tool-123', redirect_uri: redirect, login_hint: hint, nonce: 'n-1', state: 'st', response_type: 'id_token' });
    expect((await auth('https://evil.example/launch')).status).toBe(400);
    // the wrong redirect used up nothing? the hint is consumed only by a matching request
    const ok = await auth();
    expect(ok.status).toBe(400); // consumed by the first attempt: a launch is single-use
    const start2 = await as(f.tokens.s1).post(`/api/courses/${f.subjects.A1math.id}/lti-tools/${tool.body.id}/launch`, {});
    const hint2 = new URL(start2.body.url).searchParams.get('login_hint')!;
    const good = await request(app).get('/api/lti/authorize').query({ client_id: 'tool-123', redirect_uri: 'https://tool.example/launch', login_hint: hint2, nonce: 'n-2', state: 'st2', response_type: 'id_token' });
    expect(good.status).toBe(200);
    expect(good.headers['content-security-policy']).toMatch(/form-action https:\/\/tool.example/);
    const token = /name="id_token" value="([^"]+)"/.exec(good.text)![1]!;
    const jwks = await request(app).get('/api/lti/jwks');
    const claims = verifyJwt(token, jwks.body.keys[0]);
    expect(claims).toMatchObject({ aud: 'tool-123', nonce: 'n-2', sub: String(f.users.s1.id) });
    expect(claims!['https://purl.imsglobal.org/spec/lti/claim/roles']).toEqual(['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner']);
    expect(claims!.email).toBeUndefined(); // no PII unless allowed
  });
});

describe('Google sign-in', () => {
  it('existing accounts on a plan with SSO only', async () => {
    const start = await request(app).get('/api/auth/sso/google/start');
    expect(start.status).toBe(302);
    const cookie = cookies(start)[0]!.split(';')[0]!;
    const state = new URL(String(start.headers.location)).searchParams.get('state');
    ssoTransport.fetch = (async (url: string) => {
      if (String(url).includes('token')) return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
      return new Response(JSON.stringify({ email: 't1@alpha.test', email_verified: true }), { status: 200 });
    }) as typeof fetch;
    await setPlan('free');
    const denied = await request(app).get(`/api/auth/sso/google/callback?code=c&state=${state}`).set('Cookie', cookie);
    expect(denied.headers.location).toMatch(/sso=not_in_plan/);
    await setPlan('pro');
    const again = await request(app).get('/api/auth/sso/google/start');
    const c2 = cookies(again)[0]!.split(';')[0]!;
    const s2 = new URL(String(again.headers.location)).searchParams.get('state');
    const ok = await request(app).get(`/api/auth/sso/google/callback?code=c&state=${s2}`).set('Cookie', c2);
    expect(ok.headers.location).toMatch(/sso=ok/);
    expect(cookies(ok).some((c: string) => c.startsWith('acadex_rt='))).toBe(true);
    const bad = await request(app).get(`/api/auth/sso/google/callback?code=c&state=forged`).set('Cookie', c2);
    expect(bad.headers.location).toMatch(/sso=expired/);
  });
});

describe('privacy', () => {
  it('consents, requests (access → a personal export; deletion → account closed), retention', async () => {
    const p1 = as(f.tokens.p1);
    expect((await p1.post('/api/privacy/consents', { kind: 'photos', granted: true, student_id: f.students.S3.id })).status).toBe(400);
    expect((await p1.post('/api/privacy/consents', { kind: 'photos', granted: true, student_id: f.students.S1.id })).status).toBe(201);
    const report = await as(f.tokens.adminA).get('/api/privacy/consents/report');
    expect(report.body.find((r) => r.kind === 'photos').granted).toBe(1);
    const reqA = await as(f.tokens.s2).post('/api/privacy/requests', { kind: 'access' });
    const done = await as(f.tokens.adminA).patch(`/api/privacy/requests/${reqA.body.id}`, { status: 'done' });
    expect(done.body.export_id).toBeTruthy();
    await drainJobs();
    const zip = readZip(binary(await getBinary(`/api/institution/exports/${done.body.export_id}/download`, f.tokens.s2)));
    expect(Object.keys(zip)).toEqual(expect.arrayContaining(['data/account.csv', 'data/student.csv']));
    expect((await getBinary(`/api/institution/exports/${done.body.export_id}/download`, f.tokens.s1)).status).toBe(404);
    const del = await as(f.tokens.s3).post('/api/privacy/requests', { kind: 'deletion' });
    await as(f.tokens.adminA).patch(`/api/privacy/requests/${del.body.id}`, { status: 'done' });
    expect((await q(`SELECT full_name, is_active FROM users WHERE id = $1`, [f.users.s3.id]))[0]).toEqual({ full_name: 'Deleted user', is_active: false });
    // retention: messages older than 6 months go
    const c = (await q(`INSERT INTO conversations (institution_id, kind) VALUES ($1,'direct') RETURNING id`, [A()]))[0];
    await q(`INSERT INTO messages (institution_id, conversation_id, body, created_at) VALUES ($1,$2,'old',now() - interval '8 months'),($1,$2,'new',now())`, [A(), c.id]);
    await as(f.tokens.adminA).put('/api/privacy/retention', { messages_months: 6, support_access: false });
    await runJob('privacy.retention', {});
    expect((await q(`SELECT body FROM messages WHERE conversation_id = $1`, [c.id])).map((m) => m.body)).toEqual(['new']);
  });
});

describe('reports', () => {
  it('every report runs; downloads; schedules send a signed link', async () => {
    const admin = as(f.tokens.adminA);
    for (const key of (await admin.get('/api/reports')).body.map((r) => r.key)) {
      const r = await admin.get(`/api/reports/${key}`);
      expect(r.status, `${key}: ${JSON.stringify(r.body)}`).toBe(200);
      expect(Array.isArray(r.body.columns)).toBe(true);
    }
    const xlsx = await getBinary('/api/reports/defaulters?format=xlsx', f.tokens.adminA);
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    const pdf = await getBinary('/api/reports/attendance?format=pdf', f.tokens.adminA);
    expect(binary(pdf).subarray(0, 4).toString()).toBe('%PDF');
    expect((await as(f.tokens.t1).get('/api/reports/attendance')).status).toBe(403);
    const sch = await admin.post('/api/report-schedules', { report: 'defaulters', frequency: 'weekly', format: 'csv', recipients: ['bursar@alpha.test'] });
    expect(sch.status).toBe(201);
    await admin.post(`/api/report-schedules/${sch.body.id}/send`, {});
    const mail = (await fixture.outbox('bursar@alpha.test'))[0];
    const link = /(https?:\/\/\S+\/public\/reports\/download\S+)/.exec(mail.text_body ?? mail.text)![1]!;
    const u = new URL(link);
    const dl = await request(app).get(`/api/public/reports/download${u.search}`);
    expect(dl.status).toBe(200);
    expect(dl.text).toMatch(/Roll no/);
    u.searchParams.set('sig', 'x' + u.searchParams.get('sig')!.slice(1));
    expect((await request(app).get(`/api/public/reports/download${u.search}`)).status).toBe(404);
  });
});

describe('the public site', () => {
  it('plans, sign-up with a trial, demo requests, branding of a verified domain', async () => {
    const plans = await request(app).get('/api/public/plans');
    expect(plans.body.map((p) => p.key)).toEqual(expect.arrayContaining(['free', 'pro']));
    const s = await request(app).post('/api/public/signup').send({ institution: 'Crescent Model School', name: 'Hina Shah', email: 'hina@crescent.test', plan: 'pro', accept_terms: true });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const inst = (await q(`SELECT plan, trial_ends_at FROM institutions WHERE slug = $1`, [s.body.slug]))[0];
    expect(inst.plan).toBe('pro');
    expect(inst.trial_ends_at).toBeTruthy();
    expect((await fixture.outbox('hina@crescent.test')).length).toBe(1);
    expect((await request(app).post('/api/public/signup').send({ institution: 'X', name: 'Y', email: 'hina@crescent.test', accept_terms: true })).status).toBe(409);
    expect((await request(app).post('/api/public/signup').send({ institution: 'X', name: 'Y', email: 'z@z.test' })).status).toBe(400);
    expect((await request(app).post('/api/public/demo').send({ name: 'Ali', email: 'ali@x.test', institution: 'X Academy' })).status).toBe(201);
    expect((await as(f.tokens.super).get('/api/platform/demo-requests')).body[0].institution).toBe('X Academy');
    // white-label domain
    await setPlan('enterprise');
    const d = await as(f.tokens.adminA).post('/api/institution/domains', { domain: 'portal.alpha.test' });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    dnsLookup.txt = async () => [];
    expect((await as(f.tokens.adminA).post(`/api/institution/domains/${d.body.id}/verify`, {})).status).toBe(409);
    dnsLookup.txt = async () => [[d.body.token]];
    expect((await as(f.tokens.adminA).post(`/api/institution/domains/${d.body.id}/verify`, {})).status).toBe(200);
    expect((await as(f.tokens.adminA).put('/api/institution/branding', { primary_color: '#0055AA', app_name: 'Alpha App' })).status).toBe(200);
    const brand = await request(app).get('/api/public/brand?host=portal.alpha.test');
    expect(brand.body).toMatchObject({ app_name: 'Alpha App', primary_color: '#0055AA' });
    expect((await request(app).get('/api/public/manifest.webmanifest?host=portal.alpha.test')).body.name).toBe('Alpha App');
    expect((await request(app).get('/api/public/brand?host=unknown.test')).status).toBe(404);
  });
});

describe('platform owner tools', () => {
  it('plans, announcements, overrides; only platform staff', async () => {
    const sup = as(f.tokens.super);
    expect((await sup.put('/api/platform/plans', { key: 'school-plus', name: 'School Plus', prices: { PKR: 9000 }, features: { modules: ['library'] } })).status).toBe(200);
    expect((await as(f.tokens.adminA).put('/api/platform/plans', { key: 'x1', name: 'X' })).status).toBe(403);
    const ann = await sup.post('/api/platform/announcements', { title: 'Maintenance Sunday 2am', level: 'warning' });
    expect(ann.status).toBe(201);
    expect((await as(f.tokens.adminA).get('/api/platform-announcements')).body.map((a) => a.title)).toContain('Maintenance Sunday 2am');
    expect((await as(f.tokens.s1).get('/api/platform-announcements')).body).toEqual([]);
    await setPlan('free');
    expect((await sup.patch(`/api/platform/institutions/${A()}/overrides`, { features: { library: true } })).status).toBe(200);
    expect((await as(f.tokens.adminA).get('/api/modules')).body.allowed).toContain('library');
    await sup.patch(`/api/platform/institutions/${A()}/overrides`, { features: {} });
  });

  it('feedback, tours, sample data, OneRoster export', async () => {
    expect((await as(f.tokens.t1).post('/api/feedback', { message: 'Love the attendance screen', rating: 5 })).status).toBe(201);
    expect((await as(f.tokens.super).get('/api/platform/feedback')).body[0].message).toBe('Love the attendance screen');
    await as(f.tokens.t1).put('/api/me/tours', { done: ['teacher'] });
    expect((await as(f.tokens.t1).get('/api/me/tours')).body.done).toEqual(['teacher']);
    const admin = as(f.tokens.adminA);
    const load = await admin.post('/api/institution/sample-data', { action: 'load' });
    expect(load.status, JSON.stringify(load.body)).toBe(201);
    expect(load.body.students).toBe(10);
    expect((await admin.post('/api/institution/sample-data', { action: 'load' })).status).toBe(409);
    expect((await admin.post('/api/institution/sample-data', { action: 'remove' })).body.students).toBe(10);
    const zip = readZip(binary(await getBinary('/api/institution/oneroster/export', f.tokens.adminA)));
    expect(Object.keys(zip)).toEqual(expect.arrayContaining(['users.csv', 'classes.csv', 'enrollments.csv', 'manifest.csv']));
    expect(zip['users.csv']!.toString()).toMatch(/Sara/);
  });
});
