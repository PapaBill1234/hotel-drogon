// Diagnostic: which marker identifies a signed-in page on EACH stack?
//
// The audit's guard must hold on every signed-in page, not just /me. The current
// new-stack check looks for `me-username`, which only exists on /me itself, so
// /profile and /credits were reported UNAUTH while /me passed.
//
//   -e BASE=http://localhost:3000 -e USER_FIELD=new|legacy

import { test } from '@playwright/test';
import { envOr } from './pages';

const BASE = envOr('BASE', 'http://localhost:3000');
const KIND = envOr('USER_FIELD', 'new');
const USER = process.env.AUDIT_USER ?? 'audituser';
const PASS = process.env.AUDIT_PASS ?? 'password123';
const PATHS = (process.env.PATHS ?? '/me,/profile,/credits,/credits/history,/account/profile')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

test('signed-in marker matrix', async ({ browser }) => {
  const context = await browser.newContext();
  const p = await context.newPage();
  p.on('dialog', (d) => void d.dismiss().catch(() => {}));

  if (KIND === 'new') {
    await p.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
    const form = p.getByTestId('account-signin-form');
    await form.getByLabel('Username').fill(USER);
    await form.getByLabel('Password').fill(PASS);
    await p.getByTestId('login-submit').click();
    await p.getByTestId('me-username').waitFor({ timeout: 15_000 });
  } else {
    await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const form = p.locator('form').filter({ has: p.locator('input[name="password"]') }).first();
    await form.locator('input[name="username"]').fill(USER);
    await form.locator('input[name="password"]').fill(PASS);
    await form.evaluate((f: HTMLFormElement) => f.requestSubmit());
    await p.waitForLoadState('domcontentloaded').catch(() => {});
    await p.waitForTimeout(1200);
  }

  // eslint-disable-next-line no-console
  console.log(`=== MARKER MATRIX ${BASE} (${KIND}) ===`);
  for (const path of PATHS) {
    await p.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(400);
    const info = await p.evaluate(() => {
      const has = (id: string) => document.getElementById(id) !== null;
      const text = document.body.innerText;
      return {
        final: location.pathname,
        subnaviUser: has('subnavi-user'),
        myhabbo: has('myhabbo'),
        subnavi: has('subnavi'),
        loginForm: has('login-form'),
        meUsername: document.querySelector('[data-testid="me-username"]') !== null,
        signOutText: /sign\s?out|log\s?out/i.test(text),
        loginSubmit: document.querySelector('form[data-testid="account-signin-form"]') !== null,
      };
    });
    // eslint-disable-next-line no-console
    console.log(
      `${path.padEnd(20)} final=${info.final.padEnd(20)} subnaviUser=${info.subnaviUser} ` +
        `myhabbo=${info.myhabbo} meUsername=${info.meUsername} loginForm=${info.loginForm} ` +
        `signOutText=${info.signOutText} signinForm=${info.loginSubmit}`,
    );
  }

  await context.close();
});
