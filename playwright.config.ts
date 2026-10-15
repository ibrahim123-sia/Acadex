// End-to-end tests of the acceptance journeys, in a desktop browser and at phone width (360 px).
// They run against the dev servers (started here unless already running) and the database in
// apps/api/.env with the demo data (npm run db:seed).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 360_000,
  // generous: the demo database may be far away (a remote Neon round trip is ~0.25 s)
  expect: { timeout: 40_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } } },
    { name: 'phone-360', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 760 } } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        { command: 'npm run dev -w @acadex/api', url: 'http://localhost:5000/api/health', reuseExistingServer: true, timeout: 120_000 },
        { command: 'npm run dev -w @acadex/web', url: 'http://localhost:3000', reuseExistingServer: true, timeout: 120_000 },
      ],
});
