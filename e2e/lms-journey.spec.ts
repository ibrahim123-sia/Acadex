// Phase 2 acceptance: a teacher builds → assigns → collects → grades → releases, and a student
// works through the course and hands in — on a desktop and at 360 px.
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: path.join(process.cwd(), 'apps', 'api', '.env') });

const PASSWORD = 'Acadex@123';
const TEACHER = process.env.E2E_TEACHER ?? 'ali.sheikh.t0@greenwood.edu';
const API = process.env.E2E_API_URL ?? 'http://localhost:5000/api';

async function apiLogin(request: APIRequestContext, email: string) {
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

/** On phones the sidebar is behind the menu button; the pages themselves are reached by URL. */
const stamp = () => new Date().toISOString().slice(11, 19).replace(/:/g, '');

test('teacher builds, assigns, grades and releases; a student finishes the work', async ({ page, browser, request }, info) => {
  const run = `${info.project.name}-${stamp()}`;
  // which course does the teacher teach, and who is in it?
  const token = await apiLogin(request, TEACHER);
  const auth = { headers: { Authorization: `Bearer ${token}`, 'X-Acadex-Client': 'web' } };
  const courses = (await (await request.get(`${API}/courses`, auth)).json()) as { id: number; name: string }[];
  expect(courses.length).toBeGreaterThan(0);
  const course = courses[0]!;
  const roster = (await (await request.get(`${API}/courses/${course.id}/progress`, auth)).json()) as { student_id: number; name: string }[];
  expect(roster.length).toBeGreaterThan(0);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: true } });
  await db.connect();
  const { rows } = await db.query<{ email: string }>(`SELECT email FROM users WHERE role = 'student' AND ref_id = $1`, [roster[0]!.student_id]);
  await db.end();
  const studentEmail = rows[0]!.email;
  const studentName = roster[0]!.name;

  // ---- the teacher builds a module with a page, and sets work
  await signIn(page, TEACHER);
  await page.goto(`/teach/courses/${course.id}`);
  await expect(page.getByRole('heading', { name: course.name })).toBeVisible();
  await page.getByLabel('New module').fill(`E2E ${run}`);
  await page.getByRole('button', { name: 'Add module' }).click();
  const module = page.locator('div.rounded-xl', { has: page.getByRole('heading', { name: `E2E ${run}` }) }).first();
  await expect(module).toBeVisible();
  await module.getByRole('button', { name: 'Publish' }).click();
  await expect(module.getByRole('button', { name: 'Published' })).toBeVisible();
  await module.getByRole('button', { name: 'Add content' }).click();
  await page.getByLabel('Title').fill(`Reading ${run}`);
  await page.getByRole('textbox', { name: 'Page' }).click();
  await page.keyboard.type('Fractions are parts of a whole. $\\frac{1}{2}$ is a half.');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(module.getByText(`Reading ${run}`)).toBeVisible();

  await page.goto(`/teach/courses/${course.id}/work/new`);
  await page.getByLabel('Title').fill(`Homework ${run}`);
  await page.getByRole('textbox', { name: 'Instructions' }).click();
  await page.keyboard.type('Explain what a half is.');
  await page.getByRole('button', { name: 'Publish and tell students' }).click();
  await expect(page).toHaveURL(/\/work\/\d+$/);
  const workUrl = page.url();
  const workId = Number(workUrl.split('/').pop());

  // ---- the student reads the page and hands in
  const sctx = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const s = await sctx.newPage();
  await signIn(s, studentEmail);
  await s.goto(`/learn/courses/${course.id}`);
  await s.getByRole('link', { name: new RegExp(`Reading ${run}`) }).click();
  await expect(s.getByText('Fractions are parts of a whole.')).toBeVisible();
  await expect(s.locator('.katex').first()).toBeVisible(); // maths rendered
  await s.goto(`/learn/courses/${course.id}/work/${workId}`);
  await expect(s.getByRole('heading', { name: `Homework ${run}` })).toBeVisible();
  await s.getByRole('textbox', { name: 'Your answer' }).click();
  await s.keyboard.type('A half is one of two equal parts.');
  await s.getByRole('button', { name: 'Hand in', exact: true }).click();
  await expect(s.getByText('What you handed in')).toBeVisible();

  // ---- the teacher grades and releases
  await page.goto(`${workUrl}?student=${roster[0]!.student_id}`);
  await expect(page.getByText('A half is one of two equal parts.')).toBeVisible();
  await page.getByLabel(/Points \(out of/).fill('90');
  await page.getByRole('textbox', { name: 'Feedback' }).click();
  await page.keyboard.type('Well explained.');
  await page.getByRole('button', { name: /Save grade/ }).click();
  await expect(page.getByText('Grade saved')).toBeVisible();
  await page.getByRole('button', { name: 'Release grades' }).click();
  await expect(page.getByText('Done')).toBeVisible();

  // ---- the student sees the grade and feedback (and was notified)
  await s.reload();
  await expect(s.getByText('Your grade')).toBeVisible();
  await expect(s.getByText('90 / 100')).toBeVisible();
  await expect(s.getByText('Well explained.')).toBeVisible();
  // no horizontal scrolling at phone width
  const overflow = await s.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await sctx.close();
  expect(studentName).toBeTruthy();
});
