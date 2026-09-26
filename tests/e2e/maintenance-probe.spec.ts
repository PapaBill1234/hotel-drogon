// Diagnostic: why does legacy /maintenance serve the landing page?
//
// maintenance.php redirects to "/" only when site_closed == "0", and the DB has
// it at "1" -- so this reports the response chain and what actually renders,
// with redirects NOT followed.
//
//   -e BASE_LEGACY=http://localhost:8081 -e TARGET_PATH=/maintenance

import { test } from '@playwright/test';
import { envOr } from './pages';

const BASE = envOr('BASE_LEGACY', 'http://localhost:8081');
const TARGET = envOr('TARGET_PATH', '/maintenance');

test('maintenance probe', async ({ browser }) => {
  const context = await browser.newContext();
  const p = await context.newPage();
  p.on('dialog', (d) => void d.dismiss().catch(() => {}));

  const chain: string[] = [];
  p.on('response', (r) => {
    if (r.request().isNavigationRequest()) {
      chain.push(`${r.status()} ${r.url()} -> ${r.headers()['location'] ?? ''}`);
    }
  });

  // `maxRedirects: 0` via a raw request first: the status and Location header
  // are the whole answer here.
  const raw = await p.request.get(`${BASE}${TARGET}`, { maxRedirects: 0 });
  // eslint-disable-next-line no-console
  console.log(`=== MAINTENANCE PROBE ${BASE}${TARGET} ===`);
  // eslint-disable-next-line no-console
  console.log(`raw status: ${raw.status()}`);
  // eslint-disable-next-line no-console
  console.log(`raw location: ${raw.headers()['location'] ?? '(none)'}`);
  const body = await raw.text();
  // eslint-disable-next-line no-console
  console.log(`raw body length: ${body.length}`);
  // eslint-disable-next-line no-console
  console.log(`raw body has maintenance-container: ${body.includes('maintenance-container')}`);
  // eslint-disable-next-line no-console
  console.log(`raw body has page-container: ${body.includes('page-container')}`);

  await p.goto(`${BASE}${TARGET}`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(500);
  // eslint-disable-next-line no-console
  console.log(`browser navigation chain: ${JSON.stringify(chain)}`);
  // eslint-disable-next-line no-console
  console.log(`final url: ${p.url()}`);
  const title = await p.title();
  // eslint-disable-next-line no-console
  console.log(`title: ${title}`);
  const text = ((await p.locator('body').innerText().catch(() => '')) ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, 200);
  // eslint-disable-next-line no-console
  console.log(`visible text: "${text}"`);

  await context.close();
});
