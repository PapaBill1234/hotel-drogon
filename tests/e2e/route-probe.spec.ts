// Diagnostic: does /account/password/forgot route to the recovery page?
//
// The user's screenshot shows that URL rendering the LANDING page (with the
// "Welcome to the hotel" hero), while /forgot works. Both routes exist in the
// bundle and the server returns the same SPA shell for both, so this reports the
// final URL, the rendered shape, and any client-side redirect.
//
//   -e BASE_NEW=http://127.0.0.1:3204 -e PLAYWRIGHT_ARGS=route-probe.spec.ts

import { test } from '@playwright/test';
import { envOr } from './pages';

const BASE = envOr('BASE_NEW', 'http://127.0.0.1:3204');

const PATHS = ['/forgot', '/account/password/forgot', '/account/password/reset'];

test('route probe', async ({ browser }) => {
  const context = await browser.newContext();
  for (const path of PATHS) {
    const p = await context.newPage();
    const navs: string[] = [];
    p.on('framenavigated', (f) => {
      if (f === p.mainFrame()) navs.push(f.url());
    });
    await p.goto(BASE + path, { waitUntil: 'networkidle' });
    await p.waitForTimeout(800);

    const info = await p.evaluate(() => ({
      headings: Array.from(document.querySelectorAll('h2.title')).map((h) =>
        (h.textContent || '').trim(),
      ),
      hasProcessBox: document.querySelector('.process-template-box') !== null,
      hasLandingHero: document.querySelector('#create-habbo') !== null,
      bodyClass: document.body.className,
    }));

    // eslint-disable-next-line no-console
    console.log(`=== ROUTE PROBE ${BASE}${path} ===`);
    // eslint-disable-next-line no-console
    console.log(`  final url: ${p.url()}`);
    // eslint-disable-next-line no-console
    console.log(`  navigations: ${JSON.stringify(navs)}`);
    // eslint-disable-next-line no-console
    console.log(`  body class: ${JSON.stringify(info.bodyClass)}`);
    // eslint-disable-next-line no-console
    console.log(`  process-template-box=${info.hasProcessBox} landing-hero=${info.hasLandingHero}`);
    // eslint-disable-next-line no-console
    console.log(`  h2.title: ${JSON.stringify(info.headings)}`);

    await p.close();
  }
  await context.close();
});
