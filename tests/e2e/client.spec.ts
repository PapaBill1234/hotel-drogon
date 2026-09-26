import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { envOr } from './pages';

// End-to-end browser flow for the Phase 5 client-entry handoff — the converted
// `client.php`.
//
//   cd tests/e2e
//   PLAYWRIGHT_CLIENT=1 npx playwright test client.spec.ts
//   (Windows PowerShell: $env:PLAYWRIGHT_CLIENT='1'; npx playwright test client.spec.ts)
//
// Gated exactly like the other suites, so a bare `npx playwright test` keeps its
// visual-parity meaning.
//
// ## What this suite deliberately does NOT assert
//
// It does not assert that a hotel client accepts the ticket. The legacy entry was
// a Shockwave/Director embed that modern browsers cannot run, the browser-native
// client is a separate milestone, and no PolarIS/Nitro source or running emulator
// is available here. Claiming otherwise in a test would be inventing the exact
// emulator capability the plan forbids inventing. What is asserted is everything
// the website itself can be held to: authorization, the ticket's format and
// storage, the settings being reported honestly, and the absence of a control
// that pretends to work.

const BASE_NEW = envOr('BASE_NEW', 'http://localhost:3000');
const PLAIN_USER = envOr('PLAIN_USER', 'testuser');
const PLAIN_PASS = envOr('PLAIN_PASS', 'password123');

/** A ticket in the legacy `GenerateTicket("sso")` shape. */
const SSO_TICKET_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function submitSignIn(page: Page, username: string, password: string) {
  await page.goto(`${BASE_NEW}/account`);
  const submit = page.getByTestId('login-submit');
  await expect(submit).toBeVisible();
  // Scoped to the account form: the anonymous header renders a second sign-in
  // form on this page, so an unscoped label lookup is ambiguous.
  const form = page.getByTestId('account-signin-form');
  await form.getByLabel('Username').fill(username);
  await form.getByLabel('Password').fill(password);
  await submit.click();
}

async function signIn(page: Page, username: string, password: string) {
  await submitSignIn(page, username, password);
  await expect(page.getByTestId('me-username')).toBeVisible({ timeout: 15_000 });
}

/**
 * Dump what the page actually shows, for a failure that only happens in CI.
 *
 * The client suite passed locally in every configuration tried while failing on a
 * CI runner, and the job log is not reachable with the available credential, so
 * the failure carried no evidence beyond "exit code 1". This prints the URL and
 * the visible text to the test output, which *is* reachable, so the next run
 * explains itself instead of inviting another guess. It is attached for the whole
 * file rather than to one test because the failing assertion has not been
 * identified with certainty.
 */
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const text = (await page.locator('body').innerText().catch(() => '<unreadable>'))
    .replace(/\s+/g, ' ')
    .slice(0, 400);
  console.log(`[client.spec diagnostic] url=${page.url()} body="${text}"`);
});

test.describe.configure({ mode: 'serial' });

if (process.env.PLAYWRIGHT_CLIENT !== '1') {
  test.describe('client entry (not enabled)', () => {
    test.skip('set PLAYWRIGHT_CLIENT=1 to run the client-entry handoff flow', () => {});
  });
} else {
  test('a signed-out visitor to /client gets the sign-in form', async ({ page }) => {
    await page.goto(`${BASE_NEW}/client`);

    await expect(page.getByTestId('login-submit')).toBeVisible();
    await expect(page.getByTestId('client-open')).toHaveCount(0);
  });

  test('the anonymous client-entry API is refused', async ({ page }) => {
    const anonymous = await page.context().browser()?.newContext();
    expect(anonymous).toBeTruthy();
    if (!anonymous) return;

    const response = await anonymous.request.get(`${BASE_NEW}/api/account/client-entry`);
    expect(response.status()).toBe(401);

    await anonymous.close();
  });

  test('/client is a real route, not a redirect to the front page', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);
    await page.goto(`${BASE_NEW}/client`);

    // Before this route existed, `/client` fell through the SPA catch-all to `/`,
    // so every "Enter PHPRetro" link on the site silently went to the front page.
    // The URL is asserted first because that regression is invisible otherwise.
    await expect(page).toHaveURL(`${BASE_NEW}/client`);
    await expect(page.getByTestId('client-ticket-state')).toBeVisible();
  });

  test('the server issues a ticket in the legacy format', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);

    const response = await page.request.get(`${BASE_NEW}/api/account/client-entry`);
    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.sso_ticket).toMatch(SSO_TICKET_RE);
    expect(body.sso_ticket.length).toBeLessThanOrEqual(256);
    expect(body.notes).toBeTruthy();

    // Each request rotates the ticket, so a cached one would be stale.
    const second = await (await page.request.get(`${BASE_NEW}/api/account/client-entry`)).json();
    expect(second.sso_ticket).not.toBe(body.sso_ticket);
  });

  test('an unconfigured stack says so instead of offering a dead control', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);

    const body = await (
      await page.request.get(`${BASE_NEW}/api/account/client-entry`)
    ).json();

    // This stack has never had a client configured: none of `hotel_ip`,
    // `hotel_port`, `hotel_mus` or `client_dcr` exists in `phpretro_site_settings`.
    // The honest answer is "not configured", so that is what is asserted, and the
    // missing keys are named rather than left for the reader to guess.
    expect(body.handoff_ready).toBe(false);
    expect(body.handoff_available).toBe(false);
    for (const key of ['hotel_ip', 'hotel_port', 'hotel_mus', 'client_dcr']) {
      expect(body.missing_settings).toContain(key);
    }

    // And the page reflects that: no launch control, an explicit notice, and the
    // list of what is missing.
    await page.goto(`${BASE_NEW}/client`);
    await expect(page.getByTestId('client-unavailable')).toBeVisible();
    await expect(page.getByTestId('client-open')).toHaveCount(0);
    await expect(page.getByTestId('client-missing-settings')).toContainText('hotel_ip');
  });

  test('the page offers no control that would silently do nothing', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);
    await page.goto(`${BASE_NEW}/client`);
    await expect(page.getByTestId('client-ticket-state')).toBeVisible();

    // The legacy page embedded a Shockwave <object>; modern browsers cannot run
    // it, and the plan forbids shipping a control that no-ops. Assert the
    // converted page carries no plugin embed and no `hotel://` launch link while
    // the handoff is unavailable.
    const objectTags = await page.locator('object, embed').count();
    expect(objectTags).toBe(0);
    await expect(page.locator('a[href^="hotel://"]')).toHaveCount(0);
  });
}
