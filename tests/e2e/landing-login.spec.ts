// Verification: the landing page's sign-in box actually signs a visitor in.
//
// This is a regression test with a specific history: the form carried the legacy
// `action="/account/submit" method="post"`, and the legacy `LoginFormUI` submit
// path calls Prototype's `Form.submit()`, which fires no submit event — so
// React's `onSubmit` never ran and the browser POSTed to the SPA catch-all (a
// static file), which nginx answers with **405 Not Allowed**. Nothing asserted
// the form worked, so it shipped broken.
//
//   cd tests/e2e
//   PLAYWRIGHT_LANDING_LOGIN=1 npx playwright test landing-login.spec.ts
//   (Windows PowerShell: $env:PLAYWRIGHT_LANDING_LOGIN='1'; npx playwright test landing-login.spec.ts)
//
// Gated like the admin, account, credits, client, reset and remember-me suites,
// so a bare `npx playwright test` keeps its visual-parity meaning.
//
//   docker run --rm -i --network host \
//     -v "<repo>:/repo:ro" -v "<repo>/tests/e2e/.out:/out" \
//     -e BASE_NEW=http://localhost:3000 \
//     -e PLAYWRIGHT_ARGS=landing-login.spec.ts \
//     mcr.microsoft.com/playwright:v1.63.0-noble bash /repo/tests/e2e/run-in-container.sh

import { test, expect } from '@playwright/test';
import { envOr } from './pages';
import { VIEWPORT } from './playwright.config';

const BASE_NEW = envOr('BASE_NEW', 'http://localhost:3000');
const USERNAME = envOr('LOGIN_USERNAME', 'testuser');
const PASSWORD = envOr('LOGIN_PASSWORD', 'password123');

if (process.env.PLAYWRIGHT_LANDING_LOGIN !== '1') {
  test.skip('set PLAYWRIGHT_LANDING_LOGIN=1 to run the landing sign-in flow', () => {});
}

test('landing sign-in form authenticates instead of 405ing', async ({ browser }) => {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const p = await context.newPage();

  const failures: string[] = [];
  p.on('response', (r) => {
    if (r.status() >= 400) failures.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });

  await p.goto(`${BASE_NEW}/`, { waitUntil: 'networkidle' });

  // The form must not still target the legacy PHP entry point.
  const action = await p.locator('#login-habblet form').getAttribute('action');
  expect(action, 'landing form still posts to the legacy PHP route').not.toBe(
    '/account/submit',
  );

  await p.fill('#login-username', USERNAME);
  await p.fill('#login-password', PASSWORD);

  // The VISIBLE button is `#login-submit-new-button`, not `#login-submit-button`:
  // the legacy `LoginFormUI.init()` pushes the plain input off-screen
  // (`margin-left: -10000px`) and reveals the styled anchor. Clicking the hidden
  // input is what a hand-written test does and what the page never does.
  const styled = p.locator('#login-submit-new-button');
  await expect(styled, 'styled sign-in button is not visible').toBeVisible();
  await styled.click();

  // A successful sign-in lands on the account page and renders the live user.
  await expect(p).toHaveURL(/\/me/, { timeout: 10_000 });
  await expect(p.locator('body')).toContainText(USERNAME);

  const bad = failures.filter((f) => !f.includes('favicon'));
  expect(bad, `unexpected error responses:\n${bad.join('\n')}`).toEqual([]);

  await context.close();
});
