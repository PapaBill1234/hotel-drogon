import { defineConfig, devices } from '@playwright/test';

// Visual-parity harness for the Phase 4 page conversions.
//
// WHY A FIXED VIEWPORT MATTERS
// The 11 hand-taken screenshots in docs/reference-screenshots/ were captured
// from a browser window at whatever size it happened to be (658-1312px wide,
// several including browser chrome and the OS taskbar). They are useful as
// design references but are NOT valid comparison baselines: a tolerance
// comparison against them would fail on framing alone, before any markup
// difference is considered.
//
// Baselines therefore have to be captured by THIS harness at one fixed
// viewport, from a running legacy stack, via `npm run capture`. See README.md
// in this directory.

/** Deterministic capture size. Both the reference capture and the comparison
 *  use this exact viewport so framing differences cannot masquerade as markup
 *  differences. */
export const VIEWPORT = { width: 1280, height: 800 };

/** Where captured legacy baselines live. */
export const BASELINE_DIR = '../../docs/reference-screenshots/baseline';

/** Fraction of differing pixels tolerated before a page fails. */
export const MAX_DIFF_PIXEL_RATIO = 0.02;

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    ...devices['Desktop Chrome'],
    viewport: VIEWPORT,
    // Animations and transitions must settle or captures are non-deterministic.
    launchOptions: {
      args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORT },
    },
  ],
});
