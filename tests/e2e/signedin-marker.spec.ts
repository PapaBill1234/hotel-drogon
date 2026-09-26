// Diagnostic: which DOM marker reliably distinguishes a signed-in legacy page?
//
// The audit's sign-in guard needs one invariant that holds on EVERY legacy page.
// Two guesses have already been wrong (`#tab-register-now` is present on the
// signed-in header too; a logout link is absent on profile.php), so this reports
// the candidates on a signed-in page instead of guessing a third time.
//
//   -e BASE_LEGACY=http://localhost:8081 -e AUDIT_USER=audituser -e TARGET_PATH=/me

import { test } from '@playwright/test';
import { envOr } from './pages';

const BASE = envOr('BASE_LEGACY', 'http://localhost:8081');
const TARGET = envOr('TARGET_PATH', '/me');
const USER = process.env.AUDIT_USER ?? 'audituser';
const PASS = process.env.AUDIT_PASS ?? 'password123';

test('signed-in marker probe', async ({ browser }) => {
  const context = await browser.newContext();
  const p = await context.newPage();
  p.on('dialog', (d) => void d.dismiss().catch(() => {}));

  await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const form = p.locator('form').filter({ has: p.locator('input[name="password"]') }).first();
  await form.locator('input[name="username"]').fill(USER);
  await form.locator('input[name="password"]').fill(PASS);
  await form.evaluate((f: HTMLFormElement) => f.requestSubmit());
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  await p.waitForTimeout(1200);

  for (const path of [TARGET]) {
    await p.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(500);

    const info = await p.evaluate(() => {
      const bodyText = document.body.innerText;
      const ids = [
        'subnavi-user',
        'subnavi-login',
        'subnavi-logout',
        'subnavi',
        'myhabbo',
        'tab-register-now',
        'login-form',
        'login-username',
      ];
      const presence: Record<string, boolean> = {};
      for (const id of ids) presence[id] = document.getElementById(id) !== null;

      // Every anchor whose text mentions sign out / log out / register.
      const anchors = Array.from(document.querySelectorAll('a'))
        .map((a) => (a.textContent || '').trim())
        .filter((t) => /sign\s?out|log\s?out|register|housekeeping/i.test(t))
        .slice(0, 8);

      return {
        presence,
        hasSignOutText: /sign\s?out/i.test(bodyText),
        hasRegisterNowText: /register now/i.test(bodyText),
        anchors,
      };
    });

    // eslint-disable-next-line no-console
    console.log(`=== SIGNED-IN MARKERS ${BASE}${path} ===`);
    // eslint-disable-next-line no-console
    console.log(`ids: ${JSON.stringify(info.presence)}`);
    // eslint-disable-next-line no-console
    console.log(`body has "sign out": ${info.hasSignOutText}`);
    // eslint-disable-next-line no-console
    console.log(`body has "register now": ${info.hasRegisterNowText}`);
    // eslint-disable-next-line no-console
    console.log(`anchors: ${JSON.stringify(info.anchors)}`);
  }

  await context.close();
});
