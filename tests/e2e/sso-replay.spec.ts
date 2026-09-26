import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { envOr } from './pages';

// The replay bound for website-issued SSO tickets, exercised against the
// isolated PolarIS/Octane lab.
//
//   cd tests/e2e
//   PLAYWRIGHT_SSO_REPLAY=1 npx playwright test sso-replay.spec.ts --config=playwright.emulator.config.ts
//
// Five paths, in the order the emulator meets them:
//
//   1. login            the CMS issues a ticket and Octane accepts it
//   2. reconnect        the same ticket is accepted again inside the window, which
//                       is where Polaris parks the first session and resumes it
//   3. full disconnect  the consumed ticket is not replayable afterwards
//   4. after the void   a disconnect cannot make the emulator restore it
//   5. logout           signing out voids the ticket immediately
//   6. expired          a ticket past its window is refused
//
// Paths 3, 4, 5 and 6 are the replay bound, and each is asserted twice over:
// against the emulator's own SSO endpoint and against the client, because those
// are two different doors in Polaris (`SessionEndpoints.handleSsoToken` and the
// `SecureLoginEvent` handshake) and the bound has to hold at both.
//
// The CMS proxy and Octane point at the SAME disposable lab database. No primary
// hotel or legacy database is reachable from here.
//
// Gated like the other suites so a bare `npx playwright test` keeps its
// visual-parity meaning.

const CMS = envOr('CMS_BASE', 'http://127.0.0.1:3204');
const OCTANE = envOr('OCTANE_BASE', 'http://127.0.0.1:3201');
const USER = envOr('PLAIN_USER', 'testuser');
const PASS = envOr('PLAIN_PASS', 'password123');

/**
 * `sso_ticket_void_at` is the CMS's own deadline for the ticket it just issued.
 * The suite also has to run against a stack that does not have that field yet —
 * that pre-fix run is what documents the defect — so the configured TTL is the
 * fallback.
 */
const TTL_FALLBACK_SECONDS = Number(envOr('SSO_TICKET_TTL_SECONDS', '120'));
/** The emulator's `session.reconnect.grace.seconds` is 5; leave room for it. */
const GRACE_MS = Number(envOr('SSO_GRACE_MS', '12000'));
/** Sweep interval plus room for the tombstone write. */
const SWEEP_SLACK_MS = Number(envOr('SSO_SWEEP_SLACK_MS', '15000'));
/** How long a refused ticket is given to prove it will not enter. */
const REFUSAL_WINDOW_MS = Number(envOr('SSO_REFUSAL_WINDOW_MS', '20000'));

interface Issued {
  ticket: string;
  voidAtMs: number;
}

async function signIn(api: APIRequestContext) {
  const response = await api.post(`${CMS}/api/auth/login`, {
    data: { username: USER, password: PASS },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function csrfToken(api: APIRequestContext): Promise<string> {
  const state = await api.storageState();
  return state.cookies.find(cookie => cookie.name === 'XSRF-TOKEN')?.value ?? '';
}

async function issueTicket(api: APIRequestContext): Promise<Issued> {
  const response = await api.post(`${CMS}/api/account/client-entry`, {
    headers: { 'X-XSRF-TOKEN': await csrfToken(api) },
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();
  expect(body.sso_ticket).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  );
  const voidAtSeconds =
    typeof body.sso_ticket_void_at === 'number'
      ? body.sso_ticket_void_at
      : Math.floor(Date.now() / 1000) + TTL_FALLBACK_SECONDS;
  return { ticket: body.sso_ticket, voidAtMs: voidAtSeconds * 1000 };
}

/** The emulator's SSO door: 200 means the ticket is still honoured. */
async function ssoTokenStatus(api: APIRequestContext, ticket: string): Promise<number> {
  const response = await api.post(`${OCTANE}/api/auth/sso-token`, {
    data: { ssoTicket: ticket },
  });
  return response.status();
}

/** Open the client with a ticket and say whether it reached the hotel view. */
async function entersWith(page: Page, ticket: string, timeout = 60_000): Promise<boolean> {
  await page.goto(`${OCTANE}/?sso=${encodeURIComponent(ticket)}`, {
    waitUntil: 'domcontentloaded',
  });
  try {
    await expect(page.locator('.hotelview')).toBeVisible({ timeout });
    return true;
  } catch {
    return false;
  }
}

/** A fresh browser context, so nothing is inherited from a previous connection. */
async function openClient(browser: Browser, ticket: string, timeout?: number) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const entered = await entersWith(page, ticket, timeout);
  return { context, page, entered };
}

// Serial, and with its own budget: the bound is a *window*, so the cases that
// assert it have to wait one out — a client launch, the deadline, a sweep, and a
// refusal window each. The emulator config's 120 s default is shorter than one of
// those cases.
test.describe.configure({ mode: 'serial', timeout: 300_000 });

if (process.env.PLAYWRIGHT_SSO_REPLAY !== '1') {
  test.describe('SSO replay bound (not enabled)', () => {
    test.skip('set PLAYWRIGHT_SSO_REPLAY=1 to exercise the replay bound', () => {});
  });
} else {
  test('login: a website-issued ticket enters Octane', async ({ browser, request }) => {
    await signIn(request);
    const issued = await issueTicket(request);

    const client = await openClient(browser, issued.ticket);
    try {
      expect(client.entered, 'the website ticket did not enter the hotel').toBe(true);
      // Octane's own login screen stays disabled: entering through the website
      // ticket is the only door this lab offers.
      await expect(client.page.getByRole('button', { name: /log in/i })).toHaveCount(0);
    } finally {
      await client.context.close();
    }
  });

  test('reconnect: the same ticket is accepted again inside the window', async ({
    browser,
    request,
  }) => {
    await signIn(request);
    const issued = await issueTicket(request);

    // This path disposes the first connection (which parks and restores the
    // ticket), and the second connection then has to boot and present the same
    // ticket before the deadline. A window shorter than a launch turns that into
    // a flake, so it is refused up front with the fix in the message rather than
    // reported as a product failure.
    const windowMs = issued.voidAtMs - Date.now();
    expect(
      windowMs,
      `the ticket window (${Math.round(windowMs / 1000)}s) is too short for two client launches; raise SSO_TICKET_TTL_SECONDS (the lab overlay defaults to 90)`
    ).toBeGreaterThan(Number(envOr('SSO_RECONNECT_WINDOW_MS', '60000')));

    const first = await openClient(browser, issued.ticket);
    expect(first.entered, 'the first connection did not enter the hotel').toBe(true);

    // The second connection presents the same ticket, which is what makes Polaris
    // dispose (and park) the first one and resume the parked habbo. That resume
    // path is what `SessionResumeManager` exists for, and it must keep working
    // inside the window.
    const second = await openClient(browser, issued.ticket);
    try {
      expect(second.entered, 'the same ticket was not accepted inside its window').toBe(true);
    } finally {
      await second.context.close();
      await first.context.close();
    }
  });

  test('full disconnect: the consumed ticket is not replayable afterwards', async ({
    browser,
    request,
  }) => {
    await signIn(request);
    const issued = await issueTicket(request);

    const client = await openClient(browser, issued.ticket);
    expect(client.entered, 'the ticket did not enter the hotel').toBe(true);
    // A closed context is a full disconnect, not a parked connection.
    await client.context.close();

    // The disconnect alone is not the bound: Polaris restores the consumed
    // ticket during its grace period, so what has to make the later replay
    // impossible is the website's deadline. Both are waited out — this is the
    // case that would pass if only the grace period were respected.
    const untilVoidMs = Math.max(0, issued.voidAtMs - Date.now()) + SWEEP_SLACK_MS;
    await new Promise(resolve =>
      setTimeout(resolve, Math.max(GRACE_MS + SWEEP_SLACK_MS, untilVoidMs))
    );

    expect(
      await ssoTokenStatus(request, issued.ticket),
      'the emulator SSO endpoint still honours the consumed ticket'
    ).toBe(401);

    const replay = await openClient(browser, issued.ticket, REFUSAL_WINDOW_MS);
    try {
      expect(replay.entered, 'the game handshake still accepts the consumed ticket').toBe(false);
    } finally {
      await replay.context.close();
    }
  });

  test('full disconnect after the window: the restore cannot resurrect it', async ({
    browser,
    request,
  }) => {
    await signIn(request);
    const issued = await issueTicket(request);

    const client = await openClient(browser, issued.ticket);
    expect(client.entered, 'the ticket did not enter the hotel').toBe(true);

    // Wait out the window while the client is STILL CONNECTED, so the void lands
    // before the disconnect. Only then close it, which is what makes Polaris park
    // the session and try to write the ticket back.
    await new Promise(resolve =>
      setTimeout(resolve, Math.max(0, issued.voidAtMs - Date.now()) + SWEEP_SLACK_MS)
    );
    await client.context.close();
    await new Promise(resolve => setTimeout(resolve, GRACE_MS));

    // The emulator restores a consumed ticket with
    // `WHERE id = ? AND (auth_ticket = '' OR auth_ticket IS NULL)`. Clearing the
    // column would therefore hand the dead ticket straight back to anyone holding
    // the URL; a tombstone is what makes the void final. This case is the one
    // that distinguishes the two.
    expect(
      await ssoTokenStatus(request, issued.ticket),
      'the disconnect restored a ticket that had already been voided'
    ).toBe(401);

    const replay = await openClient(browser, issued.ticket, REFUSAL_WINDOW_MS);
    try {
      expect(replay.entered, 'the restored ticket still opens the hotel').toBe(false);
    } finally {
      await replay.context.close();
    }
  });

  test('logout: signing out voids the ticket immediately', async ({ browser, request }) => {
    await signIn(request);
    const issued = await issueTicket(request);

    const logout = await request.post(`${CMS}/api/auth/logout`, {
      headers: { 'X-XSRF-TOKEN': await csrfToken(request) },
    });
    expect(logout.status(), await logout.text()).toBe(200);

    expect(await ssoTokenStatus(request, issued.ticket), 'the ticket survived the sign-out').toBe(
      401
    );

    const replay = await openClient(browser, issued.ticket, REFUSAL_WINDOW_MS);
    try {
      expect(
        replay.entered,
        'the game handshake accepted a ticket the user revoked by signing out'
      ).toBe(false);
    } finally {
      await replay.context.close();
    }
  });

  test('expired: a ticket past its window is refused', async ({ browser, request }) => {
    await signIn(request);
    const issued = await issueTicket(request);

    // Never used, only aged: the case an emulator restore cannot even be blamed
    // for, and the one a TTL alone does not close, because the game lookup in
    // Polaris ignores `auth_ticket_expires_at`.
    await new Promise(resolve =>
      setTimeout(resolve, Math.max(0, issued.voidAtMs - Date.now()) + SWEEP_SLACK_MS)
    );

    expect(
      await ssoTokenStatus(request, issued.ticket),
      'an unused ticket past its window is still honoured'
    ).toBe(401);

    const replay = await openClient(browser, issued.ticket, REFUSAL_WINDOW_MS);
    try {
      expect(replay.entered, 'the game handshake accepted a ticket past its window').toBe(false);
    } finally {
      await replay.context.close();
    }
  });
}
