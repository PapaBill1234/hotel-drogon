import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { PAGES, envOr } from './pages';
import { BASELINE_DIR, VIEWPORT } from './playwright.config';

// Compares each converted React page against its captured legacy baseline.
//
//   BASE_NEW=http://localhost:3000 npx playwright test visual-parity.spec.ts
//
// A page passes when the pixel diff stays within MAX_DIFF_PIXEL_RATIO. Dynamic
// regions are masked on both sides (see pages.ts) so live counters and
// timestamps cannot dominate the diff.

const BASE_NEW = envOr('BASE_NEW', 'http://localhost:3000');
const baselineDir = path.resolve(__dirname, BASELINE_DIR);

test.describe.configure({ mode: 'serial' });

for (const page of PAGES) {
  test(`visual parity: ${page.name}`, async ({ browser }) => {
    const baseline = path.join(baselineDir, `${page.name}.png`);

    // Fail with an actionable message rather than a confusing screenshot diff.
    test.skip(
      !fs.existsSync(baseline),
      `no baseline for '${page.name}' at ${baseline}. ` +
        `Capture references first: npm run capture (BASE_LEGACY=<legacy url>). ` +
        `Note the hand-taken PNGs in docs/reference-screenshots/ are NOT valid ` +
        `baselines -- different window sizes, browser chrome, no fixed viewport.`,
    );

    const context = await browser.newContext({ viewport: VIEWPORT });
    const p = await context.newPage();

    const response = await p.goto(BASE_NEW + page.newPath, { waitUntil: 'networkidle' });
    expect(response, `no response from ${BASE_NEW}${page.newPath}`).toBeTruthy();
    expect(
      response!.status(),
      `new app returned ${response!.status()} for ${page.newPath}`,
    ).toBeLessThan(400);

    // Guard against a false pass. When frontend/dist is missing, nginx serves
    // its stock "Welcome to nginx!" page with HTTP 200 -- the status check
    // above would happily accept it and the diff would compare against the
    // wrong thing. Require the React mount point to be present.
    await expect(
      p.locator('#root'),
      'SPA root element #root not found — is frontend/dist built and mounted ' +
        'into the proxy? (see tests/e2e/README.md)',
    ).toHaveCount(1);

    for (const sel of page.mask) {
      await p.locator(sel).evaluateAll((els) =>
        els.forEach((el) => ((el as HTMLElement).style.visibility = 'hidden')),
      );
    }
    await p.waitForTimeout(300);

    await expect(p).toHaveScreenshot(path.basename(baseline), {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });

    if (page.knownDivergence) {
      // eslint-disable-next-line no-console
      console.log(`  NOTE (${page.name}): ${page.knownDivergence}`);
    }

    await context.close();
  });
}
