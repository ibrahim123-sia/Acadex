// The public site (no sign-in): landing, pricing from the plans, demo booking, legal pages and
// the help center open without errors, pass the WCAG 2.2 AA audit and fit a 360 px screen;
// the platform owner's Business screen opens.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PAGES = ['/', '/pricing', '/demo', '/signup', '/legal/privacy', '/legal/dpa', '/legal/subprocessors', '/legal/compliance', '/docs'];

test('public pages', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    try {
      localStorage.setItem('acadex.cookies', 'ok');
      localStorage.setItem('acadex.theme', 'light');
    } catch {
      /* ignore */
    }
  });
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.locator('main h1').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(1);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(r.violations.map((v) => `${path}: ${v.id} ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
  }
  await page.goto('/pricing');
  await expect(page.getByRole('heading', { name: 'Pro' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('the platform owner sees the business screen', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('superadmin@acadex.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('Acadex@123');
  await page.getByRole('textbox', { name: 'Password' }).press('Enter');
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/platform/business');
  await expect(page.getByRole('heading', { name: 'Business' })).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();

  // API management: every AI feature with a model dropdown
  await page.goto('/platform/ai');
  await expect(page.getByRole('heading', { name: 'API management' })).toBeVisible();
  await expect(page.getByLabel(/^Model for /)).toHaveCount(9);
  await expect(page.getByText('Provider keys')).toBeVisible();
  // AI usage: filters and the breakdown
  await page.goto('/platform/ai/usage');
  await expect(page.getByRole('heading', { name: 'AI usage' })).toBeVisible();
  await expect(page.getByLabel('Institution', { exact: true })).toBeVisible();
  await expect(page.getByText('Estimated cost').first()).toBeVisible();
});

test('sign-up: the country sets the payment gateways', async ({ page }) => {
  await page.goto('/signup');
  const country = page.getByLabel('Country');
  await expect(country).toHaveValue('PK');
  await expect(page.getByText(/JazzCash, Easypaisa/)).toBeVisible();
  await country.selectOption('AE');
  await expect(page.getByText(/online payments \(Stripe\)/)).toBeVisible();
  expect(await country.locator('option').count()).toBeGreaterThan(180);
  // no language picker: the interface is English
  await expect(page.locator('html[lang="en"]')).toHaveCount(1);
});
