// Diagnostic: compare the signed-in header between the two stacks.
//
// Not a test -- it asserts nothing. `/me`, `/account/profile`, `/credits` and
// `/credits/history` are all 7-43% different and the header is shared by all
// four, so the cheapest way to attribute that is to print what each side
// actually renders above `#content-container`, element by element, with the
// computed rect. Screenshots show that the new side's `#subnavi` overlaps the
// logo area; this reports the geometry rather than the appearance.
//
// Signs in as the `audituser` fixture when TARGET_PATH is a guarded route.
//
//   -e BASE_NEW=http://localhost:3000 -e TARGET_PATH=/account/profile
//   -e BASE_NEW=http://localhost:8081 -e TARGET_PATH=/account/profile
//
//   docker run --rm -i --network host \
//     -v "<repo>:/repo:ro" -v "<repo>/tests/e2e/.out:/out" \
//     -e BASE_NEW=http://localhost:8081 -e TARGET_PATH=/account/profile \
//     -e PLAYWRIGHT_ARGS=header-probe.spec.ts \
//     mcr.microsoft.com/playwright:v1.63.0-noble bash /repo/tests/e2e/run-in-container.sh

import { test } from '@playwright/test';
import { envOr } from './pages';
import { VIEWPORT } from './playwright.config';

const BASE = envOr('BASE_NEW', 'http://localhost:3000');
const TARGET = envOr('TARGET_PATH', '/account/profile');
const USER = process.env.PROBE_USER ?? 'audituser';
const PASS = process.env.PROBE_PASS ?? 'password123';
const SIGN_IN = process.env.PROBE_SIGN_IN !== '0';

test('header probe', async ({ browser }) => {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const p = await context.newPage();

  if (SIGN_IN) {
    // The two stacks do not share a sign-in form. The first version of this
    // probe only knew the React one, so on the legacy stack it silently did
    // nothing and the "legacy" column below was the ANONYMOUS header being
    // compared against the signed-in one. Same approach as `audit.spec.ts`.
    //
    // AND: point the legacy run at `http://localhost:8081`, not
    // `http://127.0.0.1:8081`. `login_header.php` writes the form's action as an
    // ABSOLUTE URL (`http://localhost:8081/account/submit`), so signing in from
    // `127.0.0.1` posts to a different origin, the session cookie is set for the
    // other host, and the next navigation is anonymous again — which looks
    // exactly like "the fixture's password is wrong".
    const isNew = BASE.includes(':3000');
    if (isNew) {
      await p.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
      const form = p.getByTestId('account-signin-form');
      await form.getByLabel('Username').fill(USER);
      await form.getByLabel('Password').fill(PASS);
      await p.getByTestId('login-submit').click();
      await p.getByTestId('me-username').waitFor({ timeout: 15_000 });
    } else {
      await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      const form = p.locator('form').filter({ has: p.locator('input[name="password"]') }).first();
      await form.locator('input[name="username"]').waitFor({ state: 'attached', timeout: 15_000 });
      await form.locator('input[name="username"]').fill(USER);
      await form.locator('input[name="password"]').fill(PASS);
      await form.evaluate((f: HTMLFormElement) => f.requestSubmit());
      await p.waitForLoadState('domcontentloaded').catch(() => {});
      await p.waitForTimeout(1200);
    }
  }

  await p.goto(BASE + TARGET, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(400);

  const report = await p.evaluate(() => {
    const lines: string[] = [];

    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    };
    const label = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${
        typeof el.className === 'string' && el.className.trim() !== ''
          ? '.' + el.className.trim().split(/\s+/).join('.')
          : ''
      }`;

    // A whole-header outline, so a missing or moved block is visible directly.
    for (const sel of ['#header-container', '#header', '#subnavi', '#navi2', '#habbos-online']) {
      const el = document.querySelector(sel);
      lines.push(`${sel}: ${el ? `rect=${rect(el)}` : '(absent)'}`);
      if (!el) continue;
      for (const child of Array.from(el.children)) {
        const text = (child.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
        lines.push(`    ${label(child)} rect=${rect(child)} text="${text}"`);
      }
    }

    // The signed-in identity block and every nav tab, wherever they live.
    for (const sel of [
      '#subnavi-user',
      '#subnavi-login',
      '#subnavi-help',
      '.subnavi-user-name',
      '#tab-register-now',
      '#tab-community',
      '#tab-credits',
      '#enter-hotel',
      'a.enter-hotel',
    ]) {
      const el = document.querySelector(sel);
      lines.push(`${sel}: ${el ? `rect=${rect(el)}` : '(absent)'}`);
    }

    // Any element whose visible text mentions these, with its rect -- finds a
    // control that exists but is rendered under a different selector.
    for (const needle of ['Sign Out', 'My Friends', 'My Rooms', 'Housekeeping', 'Enter ']) {
      const hits = Array.from(document.querySelectorAll('a, span, strong, li'))
        .filter((el) => (el.textContent ?? '').includes(needle))
        .slice(0, 3)
        .map((el) => `${label(el)} rect=${rect(el)}`);
      lines.push(`text "${needle}": ${hits.length ? hits.join(' | ') : '(none)'}`);
    }

    return lines;
  });

  // eslint-disable-next-line no-console
  console.log(`=== HEADER PROBE ${BASE}${TARGET} ===`);
  for (const line of report) {
    // eslint-disable-next-line no-console
    console.log(line);
  }

  await context.close();
});
