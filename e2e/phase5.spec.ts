// Phase 5 acceptance in the browser (desktop and 360 px): a parent books a parent–teacher
// meeting and messages the teacher (who replies), raises a help-desk ticket the office
// resolves; the office sends an emergency broadcast; low-bandwidth mode works.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const PASSWORD = 'Acadex@123';
const TEACHER = 'ali.sheikh.t0@greenwood.edu';
const PARENT = 'parent1@greenwood.edu';
const ADMIN = 'admin@greenwood.edu';

const API = process.env.E2E_API_URL ?? 'http://localhost:5000/api';

/** A meeting day next week for every section (the test makes its own). */
async function meetingDay(request: APIRequestContext): Promise<number> {
  const login = await request.post(`${API}/auth/login`, { data: { email: ADMIN, password: PASSWORD }, headers: { 'X-Acadex-Client': 'web' } });
  const headers = { Authorization: `Bearer ${(await login.json()).access_token}`, 'X-Acadex-Client': 'web' };
  const sections = (await (await request.get(`${API}/institution/sections?pageSize=100`, { headers })).json()) as { id: number }[];
  const date = new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10);
  const r = await request.post(`${API}/ptm`, { headers, data: { title: `E2E meetings ${Date.now().toString(36)}`, date, start_time: '14:00', end_time: '15:00', slot_minutes: 15, section_ids: sections.map((x) => x.id) } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).id;
}

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('textbox', { name: 'Password' }).press('Enter');
  await expect(page).not.toHaveURL(/\/login/);
}

test('a parent books a meeting, messages the teacher and raises a ticket', async ({ page, browser, request }) => {
  const stamp = Date.now().toString(36);
  const eventId = await meetingDay(request);
  await signIn(page, PARENT);

  // parent–teacher meeting: book the first free slot (or keep the existing booking)
  await page.goto(`/meetings/${eventId}`);
  await page.locator('main button:has-text(":")').first().click();
  await expect(page.getByText(/Your meeting/).first()).toBeVisible();

  // message the teacher
  await page.goto('/messages');
  await page.getByRole('button', { name: 'New message' }).click();
  await page.getByLabel('To').fill('Sheikh');
  await page.locator('dialog li button').first().click();
  await page.getByLabel('Message').fill(`Question about homework ${stamp}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText(`Question about homework ${stamp}`)).toBeVisible();

  // a ticket
  await page.goto('/tickets');
  await page.getByRole('button', { name: 'New ticket' }).click();
  await page.getByLabel('Subject').fill(`Bus timing ${stamp}`);
  await page.getByLabel('Details').fill('The bus came 20 minutes late twice this week.');
  await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Bus timing ${stamp}` })).toBeVisible();

  // the teacher replies
  const teacher = await browser.newPage({ viewport: page.viewportSize() ?? undefined });
  await signIn(teacher, TEACHER);
  await teacher.goto('/messages');
  await teacher.getByText(`Question about homework ${stamp}`).first().click();
  await teacher.getByLabel('Write a message').fill(`Please see page 12 (${stamp}).`);
  await teacher.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(teacher.locator('ol p').getByText(`Please see page 12 (${stamp}).`)).toBeVisible();
  await teacher.close();

  // the office resolves the ticket
  const office = await browser.newPage({ viewport: page.viewportSize() ?? undefined });
  await signIn(office, ADMIN);
  await office.goto('/tickets');
  await office.getByRole('link', { name: `Bus timing ${stamp}` }).click();
  await office.getByLabel('Status').selectOption('resolved');
  await expect(office.getByText('Saved', { exact: true }).first()).toBeVisible();
  await office.close();

  await page.reload();
  await expect(page.getByText('How did we do?')).toBeVisible();
});

test('the office broadcasts; low-bandwidth mode', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto('/communication');
  await page.getByLabel('Title').fill('Test broadcast — please ignore');
  await page.getByLabel('Message').fill('This is a test of the emergency broadcast.');
  await page.getByRole('button', { name: 'Send now' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send now' }).click();
  await expect(page.getByText('Broadcast is on its way')).toBeVisible();

  // the saved preference may be on (an earlier run can close the page before "off" is saved)
  const toggle = page.getByRole('button', { name: /Low-bandwidth mode/ });
  const saved = () => page.waitForResponse((r) => r.url().includes('/notifications/account-preferences') && r.request().method() === 'PUT');
  if (await page.locator('html[data-low-bandwidth]').count()) await Promise.all([saved(), toggle.click()]);
  await expect(page.locator('html[data-low-bandwidth]')).toHaveCount(0);
  await toggle.click();
  await expect(page.locator('html[data-low-bandwidth]')).toHaveCount(1);
  await Promise.all([saved(), toggle.click()]); // leave it off, saved, for the next run
  await expect(page.locator('html[data-low-bandwidth]')).toHaveCount(0);

  // the interface is English only: no language picker
  await page.goto('/admin');
  await expect(page.locator('html[lang="en"][dir="ltr"]')).toHaveCount(1);
  await expect(page.locator('header select:has(option[value="ur"])')).toHaveCount(0);
});
