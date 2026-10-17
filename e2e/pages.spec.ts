// Every main page of each role opens without errors and, at phone width, without sideways
// scrolling. Screenshots land in test-results/ for a visual check.
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Acadex@123';
const ROLES: { email: string; pages: string[] }[] = [
  { email: 'ali.sheikh.t0@greenwood.edu', pages: ['/teacher', '/teach', '/attendance', '/attendance/leave', '/timetable', '/calendar', '/announcements', '/notifications', '/surveys', '/exams/marks', '/outcomes', '/success', '/help', '/messages', '/meetings', '/tickets', '/saved', '/hr/me', '/privacy', '/bookings', '/whats-new'] },
  { email: 'ali.butt.s0@greenwood.edu', pages: ['/student', '/learn', '/attendance', '/attendance/checkin', '/learn/achievements', '/timetable', '/calendar', '/fees', '/exams/me', '/learn/viva', '/help', '/messages', '/tickets', '/services', '/privacy'] },
  { email: 'parent1@greenwood.edu', pages: ['/parent', '/learn', '/timetable', '/attendance/leave', '/fees', '/exams/me', '/meetings', '/messages', '/tickets', '/services', '/privacy'] },
  { email: 'admin@greenwood.edu', pages: ['/admin', '/teach', '/attendance', '/attendance/staff', '/timetable', '/admin/blueprints', '/announcements', '/finance', '/exams/office', '/admissions', '/outcomes', '/ai/settings', '/success', '/ask', '/help', '/communication', '/safeguarding', '/tickets', '/meetings', '/messages', '/billing', '/reports', '/admin/data', '/admin/integrations', '/admin/modules', '/library', '/hr', '/transport', '/visitors', '/bookings', '/whats-new', '/admin/setup'] },
];

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('textbox', { name: 'Password' }).press('Enter');
  await expect(page).not.toHaveURL(/\/login/);
}

for (const role of ROLES) {
  test(`pages of ${role.email}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await signIn(page, role.email);
    for (const path of role.pages) {
      await page.goto(path);
      // wait for the page's own data, not just the shell
      await expect(page.locator('main h1').first()).toBeVisible();
      // the page's data has arrived when no loading spinner is showing
      await expect(page.locator('[role="status"] .animate-spin:visible')).toHaveCount(0, { timeout: 60_000 });
      await page.screenshot({ path: info.outputPath(`${path.replace(/\W+/g, '_')}.png`), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(1);
      expect(page.url(), `${path} redirected`).toContain(path.split('?')[0]);
    }
    expect(errors).toEqual([]);
  });
}
