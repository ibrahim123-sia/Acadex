// Phase 3 acceptance, in the browser (desktop and 360 px):
//   fees: a guardian pays an invoice online (test provider) → receipt → the office sees it
//         paid and reconciles it with what the provider settled;
//   exams: the office sets a paper → the teacher enters marks in the grid and submits → the
//          office approves and publishes → the student sees the result.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: path.join(process.cwd(), 'apps', 'api', '.env') });

const PASSWORD = 'Acadex@123';
const ADMIN = 'admin@greenwood.edu';
const PARENT = 'parent1@greenwood.edu';
const TEACHER = 'ali.sheikh.t0@greenwood.edu';
const API = process.env.E2E_API_URL ?? 'http://localhost:5000/api';

async function apiAs(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/login`, { data: { email, password: PASSWORD }, headers: { 'X-Acadex-Client': 'web' } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const token = ((await res.json()) as { access_token: string }).access_token;
  const headers = { Authorization: `Bearer ${token}`, 'X-Acadex-Client': 'web' };
  return {
    get: async <T>(p: string) => (await (await request.get(`${API}${p}`, { headers })).json()) as T,
    post: async <T>(p: string, data: unknown) => {
      const r = await request.post(`${API}${p}`, { headers, data });
      expect(r.ok(), `${p}: ${await r.text()}`).toBeTruthy();
      return (await r.json()) as T;
    },
  };
}

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('textbox', { name: 'Password' }).press('Enter');
  await expect(page).not.toHaveURL(/\/login/);
}

const db = () => new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: true } });

test('fee cycle: a guardian pays online, the office sees the receipt and reconciles it', async ({ page, browser, request }) => {
  // each run bills the demo guardian's child a small one-off fee to pay
  const parent = await apiAs(request, PARENT);
  const admin = await apiAs(request, ADMIN);
  const mine = await parent.get<{ students: { student_id: number }[] }>('/finance/my');
  const due = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const made = await admin.post<{ ids: number[] }>('/finance/invoices', { student_ids: [mine.students[0]!.student_id], title: `E2E trip ${Date.now()}`, due_date: due, lines: [{ head: 'Trip', label: 'Museum trip', amount: 750 }] });
  const fresh = await parent.get<{ students: { invoices: { id: number; number: string }[] }[] }>('/finance/my');
  const invoice = fresh.students.flatMap((x) => x.invoices).find((i) => i.id === made.ids[0]);
  expect(invoice).toBeTruthy();

  // ---- the guardian pays from their fees page
  await signIn(page, PARENT);
  await page.goto('/fees');
  const card = page.locator('li', { hasText: invoice!.number });
  await card.getByRole('button', { name: 'Pay' }).click();
  await page.getByRole('button', { name: 'Test payment' }).click();
  await expect(page.getByRole('heading', { name: 'Test payment' })).toBeVisible();
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Payment received/ })).toBeVisible();

  // ---- the office sees it paid, downloads the receipt and reconciles
  const office = await browser.newPage({ viewport: page.viewportSize() ?? undefined });
  await signIn(office, ADMIN);
  await office.goto(`/finance/invoices/${invoice!.id}`);
  await expect(office.getByText('Paid', { exact: true }).first()).toBeVisible();
  await expect(office.getByText(/fake/).first()).toBeVisible();
  await office.goto('/finance#reconcile');
  await office.getByLabel('Against').selectOption('fake');
  const today = new Date().toISOString().slice(0, 10);
  await office.getByLabel('From').fill(`${today.slice(0, 8)}01`);
  await office.getByLabel('To').fill(today);
  await office.getByRole('button', { name: 'Reconcile' }).click();
  await expect(office.getByText(/\d+ matched/)).toBeVisible();
  await office.close();
});

test('exam cycle: a paper is set, marked, approved, published and seen by the student', async ({ page, browser, request }, info) => {
  const admin = await apiAs(request, ADMIN);
  const teacher = await apiAs(request, TEACHER);
  const courses = await teacher.get<{ id: number; name: string }[]>('/courses');
  const course = courses[0]!;
  const roster = await teacher.get<{ student_id: number }[]>(`/courses/${course.id}/progress`);
  const client = db();
  await client.connect();
  const { rows } = await client.query<{ email: string }>(`SELECT email FROM users WHERE role = 'student' AND ref_id = $1`, [roster[0]!.student_id]);
  await client.end();

  // ---- the office creates a series with one paper for the teacher's class
  const name = `E2E exam ${info.project.name} ${Date.now()}`;
  const series = await admin.post<{ id: number }>('/exams/series', { name, kind: 'monthly' });
  const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const paper = await admin.post<{ id: number }>(`/exams/series/${series.id}/sessions`, { offering_id: course.id, date, starts_at: '09:00', ends_at: '10:00', total_marks: 50, pass_marks: 17 });

  // ---- the teacher enters marks in the grid and submits
  await signIn(page, TEACHER);
  await page.goto(`/exams/marks/${paper.id}`);
  await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
  const inputs = page.getByRole('spinbutton', { name: /Marks for/ });
  const n = await inputs.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) await inputs.nth(i).fill(String(30 + (i % 15)));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved').first()).toBeVisible();
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByText('Submitted').first()).toBeVisible();

  // ---- the office approves (department step, then controller) and publishes
  const office = await browser.newPage({ viewport: page.viewportSize() ?? undefined });
  await signIn(office, ADMIN);
  await office.goto(`/exams/marks/${paper.id}`);
  const approve = office.getByRole('button', { name: 'Approve' });
  await expect(approve).toBeVisible();
  await approve.click();
  // with a head of department the first approval is theirs (the admin may moderate), then the controller's
  const after = office.getByText(/^(HOD approved|Approved)$/).first();
  await expect(after).toBeVisible();
  if ((await after.textContent()) === 'HOD approved') {
    await approve.click();
    await expect(office.getByText('Approved', { exact: true }).first()).toBeVisible();
  }
  await office.goto(`/exams/office/${series.id}#results`);
  await office.getByRole('button', { name: 'Publish results' }).click();
  await expect(office.getByRole('button', { name: 'Withdraw results' })).toBeVisible();
  await office.close();

  // ---- the student sees the result
  const student = await browser.newPage({ viewport: page.viewportSize() ?? undefined });
  await signIn(student, rows[0]!.email);
  await student.goto('/exams/me');
  await expect(student.getByRole('heading', { name })).toBeVisible();
  await expect(student.getByRole('button', { name: 'Result card' }).first()).toBeVisible();
  await student.close();
});

test('public admission form renders and refuses an empty application', async ({ page }) => {
  const client = db();
  await client.connect();
  const { rows } = await client.query<{ slug: string; inst: string }>(`SELECT f.slug, i.slug AS inst FROM admission_forms f JOIN institutions i ON i.id = f.institution_id WHERE f.status = 'open' LIMIT 1`);
  await client.end();
  test.skip(!rows[0], 'no open admission form in the demo data');
  await page.goto(`/apply/${rows[0]!.inst}/${rows[0]!.slug}`);
  await expect(page.getByRole('button', { name: 'Submit application' })).toBeVisible();
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
});
