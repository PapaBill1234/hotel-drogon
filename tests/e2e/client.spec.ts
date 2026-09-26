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
// This default-stack suite checks ticket issuance and refusal paths. The
// isolated emulator-lab suite checks whether the issued ticket enters Octane.
//
// ## Stack assumptions
//
// One test below — "an unconfigured stack says so…" — asserts that the DEFAULT
// stack has no client configured, which is true of `localhost:3000` and false of
// the emulator lab. It runs last, and the suite is `serial`, so a stack-specific
// failure cannot mask the stack-agnostic assertions above it.

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

async function postClientEntry(page: Page) {
  const csrf = (await page.context().cookies()).find(cookie => cookie.name === 'XSRF-TOKEN');
  return page.request.post(`${BASE_NEW}/api/account/client-entry`, {
    headers: csrf ? { 'X-XSRF-TOKEN': csrf.value } : {},
  });
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
    await expect(page.getByTestId('account-signin-form')).toBeVisible();
  });

  test('the anonymous client-entry API is refused', async ({ page }) => {
    await page.goto(`${BASE_NEW}/client`);
    const response = await postClientEntry(page);
    expect([401, 403]).toContain(response.status());
  });

  test('a signed-in ticket request without CSRF is refused', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);
    const response = await page.request.post(`${BASE_NEW}/api/account/client-entry`);
    expect(response.status()).toBe(403);
  });

  test('/client is a real route, not a redirect to the front page', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);
    await page.goto(`${BASE_NEW}/client`);
    // The route resolved and rendered the entry habblet instead of bouncing to
    // "/". Asserted on the container, not on visibility: `#enter-hotel` wraps
    // either the launch button (configured stack) or the unavailable notice, and
    // a wrapper with only absolutely-positioned children can have no box of its
    // own — which is the case on a configured stack.
    await expect(page).toHaveURL(/\/client$/);
    await expect(page.locator('#enter-hotel')).toHaveCount(1);
    await expect(page.getByTestId('client-ticket-state')).toBeVisible();
  });

  test('the server issues a ticket in the legacy format', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);
    const response = await postClientEntry(page);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.sso_ticket).toMatch(SSO_TICKET_RE);
    expect(body.sso_ticket_void_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    // `users.auth_ticket` is varchar(256); the tombstone is longer than any
    // ticket a PolarIS door accepts.
    expect(body.sso_ticket.length).toBeLessThanOrEqual(256);
    expect(body.notes).toBeTruthy();

    // Each request rotates the ticket, so a cached one would be stale.
    const second = await (await postClientEntry(page)).json();
    expect(second.sso_ticket).not.toBe(body.sso_ticket);
  });

  // --- the /me Enter button and the register tab --------------------------
  //
  // Reported by a user, both on /me:
  //   * "im logged in and I still see register" — the register tab rendered
  //     unconditionally. `community_header.php:327-334` renders EITHER the
  //     username tab OR the register tab, never both.
  //   * "clicking on enter does nothing" — the handler called the legacy
  //     `openOrFocusHabbo(this)`, which does `window.open(...)` and is killed by
  //     a popup blocker, while `preventDefault()` stopped the link's own href
  //     from navigating. A silent no-op.
  //
  // These sit above the stack-specific test at the end so that a stack-specific
  // failure cannot skip them: the /me Enter path is exactly the one worth
  // exercising on a CONFIGURED stack like the lab.

  test('a signed-in visitor is not offered the register tab', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);
    await page.goto(`${BASE_NEW}/me`);

    await expect(page.locator('#tab-register-now')).toHaveCount(0);
    // The username tab is the one legacy renders *instead* of the register tab:
    // `<li id="myhabbo" class="selected"><strong>name</strong>` in #subnavi-user.
    await expect(page.locator('#myhabbo')).toContainText(PLAIN_USER);
  });

  test('the anonymous front page still offers the register tab', async ({ page }) => {
    // The gate must not have removed it for visitors, which is the case it
    // exists for (`$user->name != "Guest"` is false there).
    await page.goto(`${BASE_NEW}/community`);
    await expect(page.locator('#tab-register-now')).toHaveCount(1);
    await expect(page.locator('#tab-register-now')).toContainText('Register now!');
  });

  test('pressing Enter on /me issues the entry and acts on it in one press', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);

    const entries: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/account/client-entry')) entries.push(r.method());
    });

    await page.goto(`${BASE_NEW}/me`);
    const enter = page.getByTestId('me-enter');
    await expect(enter).toBeVisible();

    // One press. Not merely a navigation to /client — that page only prepares a
    // ticket and renders a second button, which is the "press twice" reported.
    const navigated = page.waitForURL(
      (url) => !url.pathname.startsWith('/me') || url.pathname === '/client',
      { timeout: 15_000 },
    );
    await enter.click();
    await navigated;

    expect(entries, 'the Enter button did not request a client entry').toContain('POST');

    // With a client configured (the lab) the press leaves for the client URL;
    // with none, it lands on /client, which states that plainly. Both prove the
    // press did something, which is the point of the fix.
    if (page.url().includes('/client')) {
      await expect(page.getByTestId('client-ticket-state')).toBeVisible();
    } else {
      expect(page.url()).not.toContain('/me');
    }
  });

  test('an unconfigured stack says so instead of offering a dead control', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);

    const body = await (await postClientEntry(page)).json();

    // This test is about the DEFAULT stack, which has never had a client
    // configured: none of `hotel_ip`, `hotel_port`, `hotel_mus` or `client_dcr`
    // exists in `phpretro_site_settings`. Skip rather than fail on a stack that
    // IS configured (the emulator lab), because there the assertion would be
    // reporting a correct configuration as a defect.
    test.skip(
      body.handoff_available === true,
      'this stack has a client configured, so the unconfigured path does not apply',
    );

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
    // converted page carries no plugin embed and no `hotel://` launch link on a
    // stack where the handoff is unavailable.
    const objectTags = await page.locator('object, embed').count();
    expect(objectTags).toBe(0);
    await expect(page.locator('a[href^="hotel://"]')).toHaveCount(0);
  });
}
