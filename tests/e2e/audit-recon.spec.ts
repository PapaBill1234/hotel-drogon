// Audit recon: which candidate routes exist on each stack?
//
// Not a test. It probes a list of candidate paths on the new app and reports the
// HTTP status, the final URL after redirects, and a short content fingerprint,
// so the audit manifest can be built from what actually exists rather than from
// what the cutover map or the legacy file list implies.
//
//   -e BASE_NEW=http://localhost:3000 -e PLAYWRIGHT_ARGS=audit-recon.spec.ts
//   -e BASE_NEW=http://localhost:8081 -e TARGET_PATHS='/,/community,...'

import { test } from '@playwright/test';
import { envOr } from './pages';

const BASE_NEW = envOr('BASE_NEW', 'http://localhost:3000');

/**
 * Candidate paths. Kept as a single list so the same probe can be pointed at
 * either stack; a path that 404s on legacy simply has no legacy counterpart.
 */
const DEFAULT_PATHS = [
  '/',
  '/community',
  '/articles',
  '/articles/archive',
  '/articles/category/announcements',
  '/help',
  '/credits/collectables',
  '/credits',
  '/credits/history',
  '/credits/pixels',
  '/club',
  '/account',
  '/account/password/forgot',
  '/account/password/reset',
  '/account/profile',
  '/account/reauthenticate',
  '/me',
  '/profile',
  '/register',
  '/login',
  '/logout',
  '/client',
  '/papers/disclaimer',
  '/papers/privacy',
  '/maintenance',
  '/groups',
  '/discussions',
  '/tag/search',
  '/home',
  '/housekeeping/',
  '/housekeeping/dashboard',
];

const paths = (process.env.TARGET_PATHS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

test('audit recon', async ({ browser }) => {
  const context = await browser.newContext();
  const p = await context.newPage();
  // A dialog (e.g. a JS confirm on a legacy page) must not hang the probe.
  p.on('dialog', (d) => void d.dismiss().catch(() => {}));

  // eslint-disable-next-line no-console
  console.log(`=== ROUTE RECON ${BASE_NEW} ===`);
  for (const path of paths.length ? paths : DEFAULT_PATHS) {
    let status = '-';
    let finalUrl = '';
    let title = '';
    let bodyLen = 0;
    try {
      const resp = await p.goto(BASE_NEW + path, {
        waitUntil: 'domcontentloaded',
        timeout: 12_000,
      });
      status = String(resp?.status() ?? '-');
      finalUrl = new URL(p.url()).pathname;
      title = (await p.title().catch(() => '')).slice(0, 60);
      bodyLen = ((await p.locator('body').innerText().catch(() => '')) ?? '').length;
    } catch (err) {
      status = `ERR ${String(err).slice(0, 40)}`;
    }
    // eslint-disable-next-line no-console
    console.log(
      `${path.padEnd(34)} ${status.padEnd(5)} -> ${finalUrl.padEnd(30)} ` +
        `text=${String(bodyLen).padEnd(6)} title="${title}"`,
    );
  }

  await context.close();
});
