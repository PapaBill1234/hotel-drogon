import { test, expect } from '@playwright/test';
import { VIEWPORT } from './playwright.config';

// TEMPORARY probe: forces a failure at zero tolerance so Playwright prints the
// exact pixel-diff ratio for the landing page. Deleted after use.
const MASK = [
  '.stats-fig',
  '#hotel-stats',
  '.newsitem-date',
  '.article-meta',
  '.active-habbo-data',
  '.active-habbo-image',
  '.tracker',
  '#frontpage-image .speech-bubble',
  '.bottom-bubble',
];

test('ratio probe: landing', async ({ browser }) => {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const p = await context.newPage();
  await p.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  for (const sel of MASK) {
    await p
      .locator(sel)
      .evaluateAll((els) => els.forEach((el) => ((el as HTMLElement).style.visibility = 'hidden')));
  }
  await p.waitForTimeout(300);
  await expect(p).toHaveScreenshot('landing.png', { maxDiffPixelRatio: 0, animations: 'disabled' });
  await context.close();
});
