// WCAG 2.2 AA audit with axe-core: every main page of each role (the interface is in English),
// light theme. Violations fail the test and are written to
// test-results/ as JSON for review.
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PASSWORD = 'Acadex@123';
const ROLES: { email: string; pages: string[] }[] = [
  { email: 'ali.sheikh.t0@greenwood.edu', pages: ['/teacher', '/teach', '/attendance', '/timetable', '/calendar', '/announcements', '/notifications', '/messages', '/meetings', '/tickets', '/exams/marks', '/success', '/help', '/saved'] },
  { email: 'ali.butt.s0@greenwood.edu', pages: ['/student', '/learn', '/attendance', '/fees', '/exams/me', '/messages', '/tickets', '/learn/viva'] },
  { email: 'parent1@greenwood.edu', pages: ['/parent', '/learn', '/fees', '/meetings', '/messages', '/tickets'] },
  { email: 'admin@greenwood.edu', pages: ['/admin', '/admin/students', '/admin/settings', '/finance', '/exams/office', '/admissions', '/ai/settings', '/communication', '/safeguarding', '/tickets', '/meetings', '/ask'] },
];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function signIn(page: Page, email: string, lang: string) {
  await page.addInitScript((l) => {
    try {
      localStorage.setItem('acadex.lang', l);
      localStorage.setItem('acadex.theme', 'light');
    } catch {
      /* ignore */
    }
  }, lang);
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('input[type="password"]').press('Enter');
  await expect(page).not.toHaveURL(/\/login/);
}

for (const lang of ['en']) {
  for (const role of ROLES) {
    test(`WCAG 2.2 AA — ${role.email} (${lang})`, async ({ page }, info) => {
      await signIn(page, role.email, lang);
      const found: { page: string; id: string; impact: string | null | undefined; help: string; targets: string[] }[] = [];
      for (const path of role.pages) {
        await page.goto(path);
        await expect(page.locator('main h1').first()).toBeVisible();
        await expect(page.locator('[role="status"] .animate-spin:visible')).toHaveCount(0, { timeout: 60_000 });
        const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        for (const v of r.violations) found.push({ page: path, id: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) });
      }
      await info.attach('axe-violations.json', { body: JSON.stringify(found, null, 2), contentType: 'application/json' });
      expect(found, JSON.stringify(found, null, 2)).toEqual([]);
    });
  }
}
