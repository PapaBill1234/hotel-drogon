import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { PAGES, envOr } from './pages';
import { BASELINE_DIR, MAX_DIFF_PIXEL_RATIO, VIEWPORT } from './playwright.config';

// Compares each converted React page against its captured legacy baseline.
//
//   BASE_NEW=http://localhost:3000 npx playwright test visual-parity.spec.ts
//
// A page passes when the pixel diff stays within MAX_DIFF_PIXEL_RATIO. Dynamic
// regions are masked on both sides (see pages.ts) so live counters and
// timestamps cannot dominate the diff.
//
// A pixel ratio alone is NOT sufficient evidence, and pages.ts can require an
// extra check for exactly that reason: a single missing paragraph is a few
// thousand pixels, well inside a 2% budget, so a page can lose real content and
// still "pass". See the `assertRendered` hook below.

const BASE_NEW = envOr('BASE_NEW', 'http://localhost:3000');
const baselineDir = path.resolve(__dirname, BASELINE_DIR);

/**
 * `/community` had no `hotelview_news` endpoint, so the "Latest news" promo
 * rendered the wrong table and then blank filler — and the page still passed at
 * a 2% tolerance, because the missing paragraph is smaller than the budget.
 *
 * This asserts the widget is really wired up by crossing the DOM against the
 * API payload: every promo slot the API returns must appear as rendered text in
 * `#topstories`, with a visible summary and the row's background sprite. It
 * fails loudly if the promo silently empties again.
 */
async function assertCommunityPromoRendered(p: Page): Promise<void> {
  const res = await p.request.get(`${BASE_NEW}/api/public/community-news`);
  expect(res.status(), 'GET /api/public/community-news').toBe(200);
  const payload = (await res.json()) as {
    items?: { id: number; title: string; image: string }[];
  };
  const items = payload.items ?? [];
  expect(
    items.length,
    'the parity fixtures must publish at least one hotelview_news row, ' +
      'otherwise this check cannot distinguish "empty promo" from "no data"',
  ).toBeGreaterThan(0);

  const promo = p.locator('#topstories');
  await expect(promo, '#topstories promo widget missing').toHaveCount(1);

  for (const item of items) {
    await expect(
      p.locator('#topstories .topstory h3 a', { hasText: item.title }).first(),
      `promo slot for "${item.title}" did not render its title`,
    ).toHaveCount(1);
  }

  const firstSummary = p.locator('#topstories .topstory').first().locator('p.summary');
  await expect(firstSummary, 'promo summary rendered empty').not.toBeEmpty();
  await expect(firstSummary, 'promo summary is not visible').toBeVisible();

  if (items[0].image) {
    const backgroundImage = await p
      .locator('#topstories .topstory')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(
      backgroundImage,
      `promo sprite for "${items[0].title}" is not applied to .topstory`,
    ).toContain(items[0].image);
  }
}

// NOT serial: a failure on one page must not skip the remaining pages, or a
// single bad page hides the parity status of every other one.
test.describe.configure({ mode: 'default' });

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

    // Wait for every stylesheet to be APPLIED, not merely requested.
    // Page-specific sheets are injected by React after mount (maintenance and
    // landing use different sets from the community pages), so `networkidle`
    // can fire while they are still parsing. Screenshotting then captures
    // half-styled DOM and reports phantom layout differences.
    await p.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('link[rel="stylesheet"]')).every(
          (l) => (l as HTMLLinkElement).sheet !== null,
        ),
      undefined,
      { timeout: 10_000 },
    );
    await p.evaluate(() => document.fonts.ready);

    for (const sel of page.mask) {
      await p.locator(sel).evaluateAll((els) =>
        els.forEach((el) => ((el as HTMLElement).style.visibility = 'hidden')),
      );
    }
    await p.waitForTimeout(300);

    // Content-level guard, run BEFORE the screenshot so a page that lost real
    // content fails with a specific message instead of a pixel ratio.
    if (page.name === 'community') {
      await assertCommunityPromoRendered(p);
    }

    await expect(p).toHaveScreenshot(path.basename(baseline), {
      // From MAX_DIFF_PIXEL_RATIO, which carries the platform measurement behind
      // the number. Kept as a literal here because Playwright reads this option
      // per assertion.
      maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
      animations: 'disabled',
    });

    if (page.knownDivergence) {
      // eslint-disable-next-line no-console
      console.log(`  NOTE (${page.name}): ${page.knownDivergence}`);
    }

    await context.close();
  });
}
