// Diagnostic: can the harness reach a legacy housekeeping page with TOTP?
//
// `housekeeping/index.php:59-66` requires a valid TOTP for any account at or
// above `staff_2fa_rank` (5), so this reports each step — the code generated,
// the POST status, and where it lands — instead of only "UNAUTH".
//
//   -e BASE_LEGACY=http://localhost:8081 -e PLAYWRIGHT_ARGS=hk-login-probe.spec.ts

import { test } from '@playwright/test';
import { envOr } from './pages';
import { totp } from './totp';

const BASE = envOr('BASE_LEGACY', 'http://localhost:8081');
const USER = process.env.AUDIT_STAFF_USER ?? 'hkstaff';
const PASS = process.env.AUDIT_STAFF_PASS ?? 'password123';
const SECRET = process.env.AUDIT_STAFF_TOTP_SECRET ?? 'JBSWY3DPEHPK3PXP';

test('hk login probe', async ({ browser }) => {
  const context = await browser.newContext();
  const p = await context.newPage();
  p.on('dialog', (d) => void d.dismiss().catch(() => {}));

  const posts: string[] = [];
  p.on('response', (r) => {
    if (r.request().method() === 'POST') {
      posts.push(`${r.status()} ${r.url()} -> ${r.headers()['location'] ?? ''}`);
    }
  });

  await p.goto(`${BASE}/housekeeping/`, { waitUntil: 'domcontentloaded' });
  const code = totp(SECRET);
  // eslint-disable-next-line no-console
  console.log(`=== HK LOGIN PROBE ${BASE} ===`);
  // eslint-disable-next-line no-console
  console.log(`generated TOTP: ${code} (secret len ${SECRET.length})`);

  const form = p.locator('form').filter({ has: p.locator('input[name="password"]') }).first();
  await form.locator('input[name="username"]').fill(USER);
  await form.locator('input[name="password"]').fill(PASS);
  const totpField = form.locator('input[name="totp_code"]');
  // eslint-disable-next-line no-console
  console.log(`totp field present: ${(await totpField.count()) > 0}`);
  if ((await totpField.count()) > 0) await totpField.fill(code);

  await form.evaluate((f: HTMLFormElement) => f.requestSubmit());
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  await p.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log(`POSTs: ${JSON.stringify(posts)}`);
  // eslint-disable-next-line no-console
  console.log(`url after submit: ${p.url()}`);

  await p.goto(`${BASE}/housekeeping/dashboard`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(600);
  // eslint-disable-next-line no-console
  console.log(`/housekeeping/dashboard -> ${p.url()}`);

  const info = await p.evaluate(() => {
    const text = document.body.innerText.replace(/\s+/g, ' ');
    return {
      hasPanel: document.querySelector('.panel') !== null,
      hasLoginForm: document.getElementById('loginform') !== null,
      hasNav: document.getElementById('item') !== null,
      head: text.slice(0, 180),
    };
  });
  // eslint-disable-next-line no-console
  console.log(`panel=${info.hasPanel} loginform=${info.hasLoginForm} nav=${info.hasNav}`);
  // eslint-disable-next-line no-console
  console.log(`body: "${info.head}"`);

  await context.close();
});
