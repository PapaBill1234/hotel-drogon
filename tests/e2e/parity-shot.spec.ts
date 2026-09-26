// Diagnostic: capture the current /community page at the exact parity viewport,
// using the same pinned Chromium and font set as the visual baselines:
//
//   docker run --rm -i --network host \
//     -v "$PWD:/repo:ro" -v "$PWD/tests/e2e/.out:/out" \
//     -e BASE_NEW=http://localhost:3000 \
//     -e PLAYWRIGHT_ARGS=parity-shot.spec.ts \
//     -e SHOT_NAME=community-after.png \
//     mcr.microsoft.com/playwright:v1.63.0-noble bash /repo/tests/e2e/run-in-container.sh
//
// NOT a parity test: it asserts nothing. It exists so a change can be eyeballed
// against the committed baseline under identical rendering conditions, instead
// of by taking a browser screenshot on the host (different engine, different
// fonts, window chrome, unknown zoom).

import { test } from '@playwright/test';
import { envOr } from './pages';
import { VIEWPORT } from './playwright.config';

const BASE_NEW = envOr('BASE_NEW', 'http://localhost:3000');
const SHOT_NAME = envOr('SHOT_NAME', 'community-after.png');
// `TARGET_PATH` is the name every other diagnostic in this directory uses;
// `SHOT_PATH` is accepted as an alias because this spec shipped with it. Passing
// neither silently captures the default below, which is how an audit shot of
// /forgot once came back as /community without anything failing.
const SHOT_PATH = process.env.TARGET_PATH ?? envOr('SHOT_PATH', '/community');
// Optional: sign in first, so an authenticated page can be captured too. A
// signed-out context reaches /me only as the sign-in form, which is not what
// most of these shots are for.
const LOGIN_USER = process.env.SHOT_LOGIN_USER ?? '';
const LOGIN_PASS = process.env.SHOT_LOGIN_PASS ?? '';

test('parity shot', async ({ browser }) => {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const p = await context.newPage();

  if (LOGIN_USER !== '') {
    await p.goto(`${BASE_NEW}/account`, { waitUntil: 'networkidle' });
    const form = p.getByTestId('account-signin-form');
    await form.getByLabel('Username').fill(LOGIN_USER);
    await form.getByLabel('Password').fill(LOGIN_PASS);
    await p.getByTestId('login-submit').click();
    await p.getByTestId('me-username').waitFor({ timeout: 15_000 });
  }

  await p.goto(BASE_NEW + SHOT_PATH, { waitUntil: 'networkidle' });

  await p.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('link[rel="stylesheet"]')).every(
        (l) => (l as HTMLLinkElement).sheet !== null,
      ),
    undefined,
    { timeout: 10_000 },
  );
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(400);

  await p.screenshot({ path: `/out/${SHOT_NAME}`, fullPage: false });
  // eslint-disable-next-line no-console
  console.log(`wrote /out/${SHOT_NAME}`);

  await context.close();
});
