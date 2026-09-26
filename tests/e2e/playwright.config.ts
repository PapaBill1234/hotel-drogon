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
// viewport, from a running legacy stack, via `npm run capture:container`. See
// README.md in this directory.

/** Deterministic capture size. Both the reference capture and the comparison
 *  use this exact viewport so framing differences cannot masquerade as markup
 *  differences. */
export const VIEWPORT = { width: 1280, height: 800 };

/** Where captured legacy baselines live. */
export const BASELINE_DIR = '../../docs/reference-screenshots/baseline';

/**
 * Fraction of differing pixels tolerated before a page fails.
 *
 * ## Why 2%
 *
 * The canonical environment — the pinned Playwright container, used for legacy
 * capture, local reproduction and CI — reproduces a page exactly, so the
 * tolerance only has to absorb genuine non-determinism, not platform drift. This
 * value predates the container work and has been kept: against the canonical
 * environment the measured difference is **0** pixels on all six pages, so 2% is
 * slack rather than headroom, and tightening it would prove nothing.
 *
 * It was briefly raised to 10% during a misdiagnosis: the parity failure was
 * attributed to Windows-versus-Linux text rasterisation, and the threshold was
 * calibrated to that "measurement". It was not the cause. The real cause was
 * that the CI workspace had no `legacy/` directory, so the compose bind-mount
 * source did not exist, Docker created an empty `/var/www/web-gallery`, and
 * every legacy stylesheet 404'd — pages rendered as bare HTML (0.19-0.96 diff)
 * while two pages that need no legacy CSS passed at 0.00. Raising the threshold
 * never could have fixed that, and it would have hidden it. See
 * docs/ai-run-state.md.
 */
export const MAX_DIFF_PIXEL_RATIO = 0.02;

/**
 * The canonical comparison environment.
 *
 * Legacy baseline capture, local reproduction and CI all run in this exact
 * image, with the browser revision that matches the committed
 * `@playwright/test` version. Pinning the image is what makes "same
 * environment" true: the image ships a specific Chromium build *and* a specific
 * font set, and a runner's own Chromium plus distro fonts is a different
 * rendering environment even on the same distro.
 *
 * Keep the tag in step with the `@playwright/test` version in package.json.
 */
export const PLAYWRIGHT_IMAGE = 'mcr.microsoft.com/playwright:v1.63.0-noble';

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  // Baselines live alongside the other reference imagery, and must NOT carry
  // Playwright's default `-<project>-<platform>` suffix: they are captured from
  // the legacy app by capture-references.spec.ts, not auto-generated per
  // platform, so both sides have to agree on one exact filename.
  snapshotPathTemplate: '{testDir}/../../docs/reference-screenshots/baseline/{arg}{ext}',
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
    // Pinned beyond the viewport, so the rendering environment is fully
    // specified rather than inherited from whatever host runs the comparison.
    // Locale and timezone also affect date/number formatting that reaches the
    // page, and GitHub runners are UTC while a workstation usually is not.
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    deviceScaleFactor: 1,
    // Animations and transitions must settle or captures are non-deterministic.
    launchOptions: {
      args: [
        '--force-device-scale-factor=1',
        '--hide-scrollbars',
        // Force a known colour profile: without it, capture and comparison can
        // disagree on colour for reasons unrelated to the page.
        '--force-color-profile=srgb',
      ],
    },
  },
  projects: [
    {
      // The parity comparison only. capture-references.spec.ts is a capture
      // TOOL that needs a live legacy app; it lives in its own config
      // (playwright.capture.config.ts) so a bare `npx playwright test` never
      // reports a capture failure as a parity failure.
      name: 'chromium',
      testIgnore: ['**/capture-references.spec.ts', '**/emulator-lab.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: VIEWPORT,
        locale: 'en-US',
        timezoneId: 'UTC',
        colorScheme: 'light',
        deviceScaleFactor: 1,
      },
    },
  ],
});
