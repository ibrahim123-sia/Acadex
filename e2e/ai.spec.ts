// AI in the browser (desktop and 360 px), on the demo data with the offline
// fake provider: a student asks the tutor; a teacher drafts quiz questions and applies them;
// the office sees AI usage, early-warning scores and asks a question about its data.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: path.join(process.cwd(), 'apps', 'api', '.env') });

const PASSWORD = 'Acadex@123';
const TEACHER = 'ali.sheikh.t0@greenwood.edu';
const ADMIN = 'admin@greenwood.edu';
const API = process.env.E2E_API_URL ?? 'http://localhost:5000/api';

async function token(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/login`, { data: { email, password: PASSWORD }, headers: { 'X-Acadex-Client': 'web' } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { access_token: string }).access_token;
}

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('textbox', { name: 'Password' }).press('Enter');
  await expect(page).not.toHaveURL(/\/login/);
}

test('a student asks the tutor and a teacher applies copilot questions', async ({ page, browser, request }) => {
  const t = await token(request, TEACHER);
  const headers = { Authorization: `Bearer ${t}`, 'X-Acadex-Client': 'web' };
  const courses = (await (await request.get(`${API}/courses`, { headers })).json()) as { id: number; name: string }[];
  const course = courses[0]!;
  const roster = (await (await request.get(`${API}/courses/${course.id}/progress`, { headers })).json()) as { student_id: number }[];
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: true } });
  await db.connect();
  const { rows } = await db.query<{ email: string }>(`SELECT email FROM users WHERE role = 'student' AND ref_id = $1`, [roster[0]!.student_id]);
  await db.end();

  // ---- the student
  await signIn(page, rows[0]!.email);
  await page.goto(`/learn/courses/${course.id}#tutor`);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await page.getByRole('textbox', { name: 'Your question' }).fill('How should I revise the first topic of this course?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('AI-generated').first()).toBeVisible();

  // ---- the teacher
  const teacher = await browser.newPage({ viewport: page.viewportSize() ?? undefined });
  await signIn(teacher, TEACHER);
  await teacher.goto(`/teach/courses/${course.id}#copilot`);
  const firstPage = teacher.locator('label:has(input[type="checkbox"])').first();
  await expect(firstPage).toBeVisible();
  await firstPage.click();
  await teacher.getByRole('button', { name: 'Draft it' }).click();
  await expect(teacher.getByRole('heading', { name: 'Proposal' })).toBeVisible();
  await teacher.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(teacher.getByText('Applied').first()).toBeVisible();
  await teacher.close();
});

test('the office: AI settings, early warning and Ask Acadex', async ({ page, request }) => {
  const t = await token(request, ADMIN);
  await request.post(`${API}/ai/risk/run`, { headers: { Authorization: `Bearer ${t}`, 'X-Acadex-Client': 'web' } });
  await signIn(page, ADMIN);
  await page.goto('/ai/settings');
  await expect(page.getByText('Coach-don’t-answer tutor for students')).toBeVisible();
  await page.goto('/success');
  await page.getByRole('button', { name: 'All' }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await page.goto('/ask');
  await page.getByRole('button', { name: 'How many active students do we have?' }).click();
  await expect(page.getByText('Show the query')).toBeVisible();
  await expect(page.locator('table td').first()).toBeVisible();
});
