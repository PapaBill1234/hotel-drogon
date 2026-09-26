import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/emulator-lab.spec.ts', '**/cms-octane.spec.ts', '**/sso-replay.spec.ts'],
  workers: 1,
  timeout: 120_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.BASE_NEW || 'http://127.0.0.1:3201',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
