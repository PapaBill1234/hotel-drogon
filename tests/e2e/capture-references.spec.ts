import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { PAGES, envOr } from './pages';
import { BASELINE_DIR, VIEWPORT } from './playwright.config';

// Captures legacy baselines. Run this against a RUNNING legacy PHPRetro stack
// before the parity suite means anything:
//
//   BASE_LEGACY=http://127.0.0.1 npx playwright test capture-references.spec.ts
//
// Until this has been run at the fixed viewport below, visual-parity.spec.ts
// has nothing valid to compare against. The hand-taken PNGs in
// docs/reference-screenshots/ are design references only -- different window
// sizes, browser chrome, no fixed viewport.
//
// These are intentionally NOT tests: they are a capture tool. The assertions
// only guard that the legacy app answered with something renderable, so a
// misconfigured BASE_LEGACY fails loudly instead of writing blank baselines.

const BASE_LEGACY = envOr('BASE_LEGACY', 'http://127.0.0.1');
const outDir = path.resolve(__dirname, BASELINE_DIR);

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  fs.mkdirSync(outDir, { recursive: true });
});

for (const page of PAGES) {
  test(`capture legacy baseline: ${page.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const p = await context.newPage();

    const response = await p.goto(BASE_LEGACY + page.legacyPath, {
      waitUntil: 'networkidle',
    });

    // A blank or error page would otherwise be saved as a "baseline" and every
    // later comparison would be meaningless.
    expect(response, `no response from ${BASE_LEGACY}${page.legacyPath}`).toBeTruthy();
    expect(
      response!.status(),
      `legacy app returned ${response!.status()} for ${page.legacyPath}`,
    ).toBeLessThan(400);

    const bodyText = (await p.textContent('body')) ?? '';
    expect(
      bodyText.trim().length,
      `legacy page ${page.legacyPath} rendered empty`,
    ).toBeGreaterThan(0);

    // Mask dynamic regions so the baseline does not bake in a live counter.
    for (const sel of page.mask) {
      await p.locator(sel).evaluateAll((els) =>
        els.forEach((el) => ((el as HTMLElement).style.visibility = 'hidden')),
      );
    }
    await p.waitForTimeout(300);

    const file = path.join(outDir, `${page.name}.png`);
    await p.screenshot({ path: file, fullPage: false });

    // eslint-disable-next-line no-console
    console.log(
      `captured ${page.name}: ${BASE_LEGACY}${page.legacyPath} -> ${file}` +
        (page.knownDivergence ? `\n  NOTE: ${page.knownDivergence}` : ''),
    );

    await context.close();
  });
}
