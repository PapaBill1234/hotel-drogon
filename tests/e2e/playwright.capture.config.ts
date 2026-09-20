import { defineConfig, devices } from '@playwright/test';
import { VIEWPORT } from './playwright.config';

// Separate config for the baseline CAPTURE tool.
//
// This lives apart from playwright.config.ts so that a bare
// `npx playwright test` runs only the parity comparison. Capturing needs a live
// legacy app; if it shared the default config, a plain test run would report a
// capture failure that says nothing about whether the converted pages match.
//
// Usage:  BASE_LEGACY=http://localhost:8081 npm run capture
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  use: { ...devices['Desktop Chrome'], viewport: VIEWPORT },
  projects: [
    {
      name: 'capture',
      testMatch: '**/capture-references.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORT },
    },
  ],
});
