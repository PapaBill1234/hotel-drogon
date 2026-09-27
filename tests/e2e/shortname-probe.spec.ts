// Diagnostic: is `site_shortname` reaching the rendered page?
//
// The lab stack's `phpretro_site_settings` had no `site_shortname` row, so every
// string built from SHORTNAME rendered with a hole in it ("Forgotten Your  Name?",
// "What are  Coins?"). The row has been added and `/api/public/settings` reports
// it, but the heading still rendered empty — so this reports the API value and
// the rendered text side by side.
//
//   -e BASE=http://127.0.0.1:3204 -e PLAYWRIGHT_ARGS=shortname-probe.spec.ts

import { test } from '@playwright/test';
import { envOr } from './pages';

const BASE = envOr('BASE_NEW', 'http://127.0.0.1:3204');
const TARGET = envOr('TARGET_PATH', '/forgot');

test('shortname probe', async ({ browser }) => {
  const context = await browser.newContext();
  const p = await context.newPage();

  const api = await p.request.get(`${BASE}/api/public/settings`);
  const body = await api.text();
  const m = /"site_shortname":"([^"]*)"/.exec(body);
  // eslint-disable-next-line no-console
  console.log(`=== SHORTNAME PROBE ${BASE}${TARGET} ===`);
  // eslint-disable-next-line no-console
  console.log(`api status=${api.status()} site_shortname=${JSON.stringify(m ? m[1] : '<absent>')}`);

  await p.goto(BASE + TARGET, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready).catch(() => {});
  await p.waitForTimeout(800);

  const headings = await p.evaluate(() =>
    Array.from(document.querySelectorAll('h2.title')).map((h) => (h.textContent || '').trim()),
  );
  // eslint-disable-next-line no-console
  console.log(`h2.title: ${JSON.stringify(headings)}`);
  const title = await p.title();
  // eslint-disable-next-line no-console
  console.log(`<title>: ${JSON.stringify(title)}`);

  await context.close();
});
