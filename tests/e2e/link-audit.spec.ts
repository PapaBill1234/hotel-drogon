// Audit: do the site's internal links point at routes that exist?
//
// The user reported a link "to the wrong page". One confirmed case was
// `/account/password/forgot` serving the landing page under an older bundle. This
// walks the public pages, collects every same-origin <a href>, and checks each
// one against the React router's route table (read from the SPA itself by
// navigating and comparing the rendered page against the requested path).
//
//   -e BASE_NEW=http://localhost:3000 -e PLAYWRIGHT_ARGS=link-audit.spec.ts

import { test } from '@playwright/test';
import { envOr } from './pages';

const BASE = envOr('BASE_NEW', 'http://localhost:3000');
const PAGES = (process.env.LINK_PAGES ?? '/,/community,/forgot,/help,/credits/collectables')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

interface Found {
  from: string;
  href: string;
}

const found: Found[] = [];

test.describe.configure({ mode: 'serial' });

test('collect links', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext();
  for (const path of PAGES) {
    const p = await context.newPage();
    await p.goto(BASE + path, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    const hrefs = await p.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map((a) => a.getAttribute('href') ?? '')
        // Only usable hrefs: skip fragments, absolute URLs, and anything that is
        // not a root-relative path. A bare "" or a template that resolved to an
        // empty value would throw "Cannot navigate to invalid URL" in goto().
        .filter((h) => h.startsWith('/') && !h.startsWith('//')),
    );
    for (const href of hrefs) {
      if (!found.some((f) => f.from === path && f.href === href)) {
        found.push({ from: path, href });
      }
    }
    await p.close();
  }
  await context.close();

  const unique = [...new Set(found.map((f) => f.href))].sort();
  // eslint-disable-next-line no-console
  console.log(`=== LINK AUDIT collected ${unique.length} unique internal hrefs ===`);
  for (const h of unique) {
    // eslint-disable-next-line no-console
    console.log(`  ${h}`);
  }
});

test('check each link lands on a real route', async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext();
  const unique = [...new Set(found.map((f) => f.href))].sort();

  // eslint-disable-next-line no-console
  console.log(`=== LINK TARGETS ${BASE} ===`);
  for (const href of unique) {
    const p = await context.newPage();
    await p.goto(BASE + href, { waitUntil: 'networkidle' });
    await p.waitForTimeout(250);
    const info = await p.evaluate(() => ({
      path: location.pathname,
      headings: Array.from(document.querySelectorAll('h2.title'))
        .map((h) => (h.textContent || '').trim())
        .slice(0, 2),
      hasLandingHero: document.querySelector('#create-habbo') !== null,
      hasProcessBox: document.querySelector('.process-template-box') !== null,
    }));
    // A link whose path was rewritten by the router landed somewhere else.
    const redirected = info.path !== href.split('?')[0];
    // eslint-disable-next-line no-console
    console.log(
      `  ${href.padEnd(34)} -> final=${info.path.padEnd(30)} ` +
        `${redirected ? 'REDIRECTED ' : ''}` +
        `landing=${info.hasLandingHero} process=${info.hasProcessBox} ` +
        `h2=${JSON.stringify(info.headings)}`,
    );
    await p.close();
  }
  await context.close();
});
