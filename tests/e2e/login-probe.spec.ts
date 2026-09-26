// Diagnostic: does the legacy sign-in actually establish a session?
//
// The audit's signed-in captures of the LEGACY stack came back as the landing
// page, which is what me.php does for a guest -- so either the sign-in failed or
// /me is gated on something else. This reports the post-submit URL, the cookies,
// and whether the header shows a signed-in state, so the cause is attributed.
//
//   -e BASE_LEGACY=http://localhost:8081 -e PLAYWRIGHT_ARGS=login-probe.spec.ts

import { test } from '@playwright/test';
import { envOr } from './pages';

const BASE = envOr('BASE_LEGACY', 'http://localhost:8081');
const USER = process.env.AUDIT_USER ?? 'testuser';
const PASS = process.env.AUDIT_PASS ?? 'password123';

test('legacy login probe', async ({ browser }) => {
  const context = await browser.newContext();
  const p = await context.newPage();
  p.on('dialog', (d) => void d.dismiss().catch(() => {}));

  const posts: string[] = [];
  p.on('response', (r) => {
    if (r.request().method() === 'POST') posts.push(`${r.status()} ${r.url()}`);
  });

  await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const form = p.locator('form').filter({ has: p.locator('input[name="password"]') }).first();
  await form.locator('input[name="username"]').fill(USER);
  await form.locator('input[name="password"]').fill(PASS);
  await form.evaluate((f: HTMLFormElement) => f.requestSubmit());
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  await p.waitForTimeout(2000);

  // eslint-disable-next-line no-console
  console.log(`=== LEGACY LOGIN PROBE ${BASE} ===`);
  // eslint-disable-next-line no-console
  console.log(`url after submit: ${p.url()}`);
  // eslint-disable-next-line no-console
  console.log(`POSTs: ${JSON.stringify(posts)}`);

  const cookies = await context.cookies();
  // eslint-disable-next-line no-console
  console.log(`cookies: ${JSON.stringify(cookies.map((c) => `${c.name}@${c.domain}`))}`);

  const state = await p.evaluate(() => {
    const text = document.body.innerText.replace(/\s+/g, ' ');
    return {
      hasLoginField: document.querySelector('input[name="password"]') !== null,
      hasLogoutLink: /log ?out/i.test(text),
      // The signed-in header shows the account name instead of "Register now!".
      hasRegisterTab: document.getElementById('tab-register-now') !== null,
      head: text.slice(0, 200),
    };
  });
  // eslint-disable-next-line no-console
  console.log(`still shows a password field (i.e. NOT signed in): ${state.hasLoginField}`);
  // eslint-disable-next-line no-console
  console.log(`has logout link: ${state.hasLogoutLink}`);
  // eslint-disable-next-line no-console
  console.log(`has #tab-register-now (guest tab): ${state.hasRegisterTab}`);
  // eslint-disable-next-line no-console
  console.log(`body head: "${state.head}"`);

  // And can the session reach /me?
  const meResp = await p.goto(`${BASE}/me`, { waitUntil: 'domcontentloaded' });
  // eslint-disable-next-line no-console
  console.log(`/me -> ${meResp?.status()} final=${p.url()}`);

  await context.close();
});
