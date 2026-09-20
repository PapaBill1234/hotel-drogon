import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { PAGES, envOr } from './pages';
import { BASELINE_DIR, VIEWPORT } from './playwright.config';

// Captures legacy baselines. Run this against a RUNNING legacy PHPRetro stack
// before the parity suite means anything:
//
//   BASE_LEGACY=http://localhost:8081 npx playwright test capture-references.spec.ts
//
// See tools/legacy-stack/README.md for bringing that stack up. The hand-taken
// PNGs in docs/reference-screenshots/ are design references only -- different
// window sizes, browser chrome, no fixed viewport.
//
// These are intentionally NOT tests: they are a capture tool. The assertions
// guard that the legacy app answered with the RIGHT page, so a misconfigured
// URL or an intervening redirect fails loudly instead of writing a wrong
// baseline that later comparisons would "pass" against.
//
// Two passes are required because the pages are mutually exclusive:
//   site_closed=0 -> landing, community, articles, help, collectables
//   site_closed=1 -> maintenance   (and with it set, everything else redirects)
//   CAPTURE_ONLY=landing,community,... selects a subset.

const BASE_LEGACY = envOr('BASE_LEGACY', 'http://127.0.0.1');
const outDir = path.resolve(__dirname, BASELINE_DIR);

const only = (process.env.CAPTURE_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const selected = only.length ? PAGES.filter((p) => only.includes(p.name)) : PAGES;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  fs.mkdirSync(outDir, { recursive: true });
});

const norm = (p: string) => p.replace(/\/+$/, '') || '/';

for (const page of selected) {
  test(`capture legacy baseline: ${page.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const p = await context.newPage();

    const response = await p.goto(BASE_LEGACY + page.legacyPath, {
      waitUntil: 'networkidle',
    });

    expect(response, `no response from ${BASE_LEGACY}${page.legacyPath}`).toBeTruthy();
    expect(
      response!.status(),
      `legacy app returned ${response!.status()} for ${page.legacyPath}`,
    ).toBeLessThan(400);

    // Redirect guard. The app redirects in several normal situations --
    // maintenance.php sends guests to "/" while the site is open, session.php
    // bounces guests when site_allow_guests is unset, core.php redirects to
    // /maintenance while closed. Playwright follows redirects transparently, so
    // without this check we would happily save the WRONG page under this
    // page's name and every later comparison would be measured against it.
    expect(
      norm(new URL(p.url()).pathname),
      `redirected to ${p.url()} — that is not ${page.legacyPath}; refusing to ` +
        `write a baseline from the wrong page`,
    ).toBe(norm(page.legacyPath));

    const bodyText = (await p.textContent('body')) ?? '';
    expect(bodyText.trim().length, `legacy page ${page.legacyPath} rendered empty`)
      .toBeGreaterThan(0);

    // Mask dynamic regions so the baseline does not bake in a live counter.
    for (const sel of page.mask) {
      await p.locator(sel).evaluateAll((els) =>
        els.forEach((el) => ((el as HTMLElement).style.visibility = 'hidden')),
      );
    }
    await p.waitForTimeout(300);

    const file = path.join(outDir, `${page.name}.png`);
    await p.screenshot({ path: file, fullPage: false });

    console.log(
      `captured ${page.name}: ${BASE_LEGACY}${page.legacyPath} -> ${file}` +
        (page.knownDivergence ? `\n  NOTE: ${page.knownDivergence}` : ''),
    );

    await context.close();
  });
}
