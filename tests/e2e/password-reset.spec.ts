import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { envOr } from './pages';

// End-to-end browser flow for the Phase 5 password-recovery and step-up slice:
// the converted `forgot.php` (both actions), the reset-token page, and
// `reauthenticate.php`.
//
//   cd tests/e2e
//   PLAYWRIGHT_RESET=1 npx playwright test password-reset.spec.ts
//   (Windows PowerShell: $env:PLAYWRIGHT_RESET='1'; npx playwright test password-reset.spec.ts)
//
// Gated like the other suites, so a bare `npx playwright test` keeps its
// visual-parity meaning.
//
// ## What this asserts, and what it cannot
//
// The reset flow's *logic* is fully verifiable here: a token is issued, it is
// single-use, it expires, and spending it sets a password that then works. What
// is NOT asserted is that an email arrived — this project has no mail transport
// at all (no SMTP client, no Mailpit, no mail setting), so the only transport
// logs and reports `logged`, never `delivered`. Asserting delivery would be
// inventing the one capability that does not exist.
//
// ## The fixture
//
// `main.cpp` seeds `testuser` with `mail_verified = 0`, and legacy `forgot.php`
// only acts on a **verified** address, so the suite marks the seeded address
// verified for its duration and restores it afterwards — the same technique the
// credits suite uses for its ledger rows, and for the same reason: this state has
// no API route (the email route deliberately resets verification), and adding one
// to make a test convenient would be shipping a feature for the test.

const BASE_NEW = envOr('BASE_NEW', 'http://localhost:3000');
const PLAIN_USER = envOr('PLAIN_USER', 'testuser');
const PLAIN_PASS = envOr('PLAIN_PASS', 'password123');
const TESTUSER_ID = 2;

/** A token this suite chooses, so it can seed the Redis key the server would. */
const KNOWN_TOKEN = 'e2e-reset-token-0123456789abcdef';
const SHA256_KNOWN_TOKEN = createHash('sha256').update(KNOWN_TOKEN).digest('hex');
const REDIS_KEY = `password_reset:${SHA256_KNOWN_TOKEN}`;

async function sql(statement: string): Promise<void> {
  execFileSync(
    'docker',
    ['exec', 'hotel_mariadb', 'mysql', '-uhotel', '-photel_secret', 'polaris', '-e', statement],
    { stdio: 'pipe' },
  );
}

/** Read one scalar from the stack's database, trimming the mysql table chrome. */
async function sqlScalar(statement: string): Promise<string> {
  const out = execFileSync(
    'docker',
    [
      'exec', 'hotel_mariadb',
      'mysql', '-N', '-B', '-uhotel', '-photel_secret', 'polaris',
      '-e', statement,
    ],
    { stdio: 'pipe' },
  ).toString();
  return out.split('\n')[0]?.trim() ?? '';
}

async function redis(...args: string[]): Promise<string> {
  return execFileSync('docker', ['exec', 'hotel_redis', 'redis-cli', ...args], {
    stdio: 'pipe',
  }).toString();
}

/**
 * The address the suite works against, read from the database rather than assumed.
 *
 * `main.cpp` seeds `test@hotel.local`, but another suite moves the address and
 * puts it back, so the value differs between a developer's database and a fresh
 * CI one. Hard-coding it made this suite pass locally and fail in CI, where the
 * seeded value is `main.cpp`'s. Reading it also lets the suite restore exactly
 * what it found.
 */
let userMail = '';
/** The verification state this suite found, restored on the way out. */
let mailWasVerified = false;

/** Mark the seeded address verified, as legacy's flow requires. */
async function verifyFixtureMail(): Promise<void> {
  await sql(`UPDATE users SET mail_verified = 1 WHERE id = ${TESTUSER_ID};`);
}

async function restoreFixture(): Promise<void> {
  // Restore the verification state that was found, not a hard-coded one: a fresh
  // CI database has `mail_verified = 0`, but a developer's may not, and the
  // difference is exactly what made this suite environment-dependent.
  await sql(
    `UPDATE users SET mail_verified = ${mailWasVerified ? 1 : 0}, ` +
      `password = '023f158f3fa0cfe32dfdd8a9884b8e1b1f07a1bd' ` +
      `WHERE id = ${TESTUSER_ID};`,
  );
  await redis('DEL', REDIS_KEY);
}

async function signIn(page: Page, username: string, password: string) {
  await page.goto(`${BASE_NEW}/account`);
  const submit = page.getByTestId('login-submit');
  await expect(submit).toBeVisible();
  const form = page.getByTestId('account-signin-form');
  await form.getByLabel('Username').fill(username);
  await form.getByLabel('Password').fill(password);
  await submit.click();
  await expect(page.getByTestId('me-username')).toBeVisible({ timeout: 15_000 });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userMail = await sqlScalar(`SELECT mail FROM users WHERE id = ${TESTUSER_ID};`);
  mailWasVerified = (await sqlScalar(`SELECT mail_verified FROM users WHERE id = ${TESTUSER_ID};`)) === '1';
  expect(userMail, 'the seeded account must have an email address to recover to').toContain('@');
  await verifyFixtureMail();
});

test.afterAll(async () => {
  await restoreFixture();
});

if (process.env.PLAYWRIGHT_RESET !== '1') {
  test.describe('password recovery (not enabled)', () => {
    test.skip('set PLAYWRIGHT_RESET=1 to run the recall and step-up flow', () => {});
  });
} else {
  test('the recovery page is reachable from the header link the site renders', async ({
    page,
  }) => {
    // The link lives in the COMMUNITY header (`community_header.php`), which the
    // landing page does not use — `/` renders `login_header.php`, whose markup
    // has no such link. `/help` is a community-shell page, so that is where the
    // link under test actually is.
    await page.goto(`${BASE_NEW}/help`);
    const link = page.locator('#forgot-password');
    await expect(link).toHaveAttribute('href', '/account/password/forgot');
    await link.click();

    await expect(page).toHaveURL(`${BASE_NEW}/account/password/forgot`);
    await expect(page.getByTestId('forgot-submit')).toBeVisible();
  });

  test('the legacy second form is present as well', async ({ page }) => {
    await page.goto(`${BASE_NEW}/forgot`);
    // `forgot.php` answered at /forgot too; both URL shapes stay alive.
    await expect(page.getByTestId('username-submit')).toBeVisible();
  });

  test('an unmatched account and a matched one are indistinguishable', async ({ page }) => {
    await page.goto(`${BASE_NEW}/account/password/forgot`);

    // Located by id, not by label text: the field's label is the LEGACY copy
    // ("Username", `en.php:514` `$loc['forgot.username']`), restored for visual
    // parity after the audit measured this page at 86% different. A label-based
    // lookup silently encodes whatever wording the port happened to use.
    await page.locator('#forgottenpw-username').fill('nobody-at-all');
    await page.locator('#forgottenpw-email').fill('nobody@example.test');
    await page.getByTestId('forgot-submit').click();
    const unmatched = await page.getByTestId('forgot-notice').textContent();

    await page.locator('#forgottenpw-username').fill(PLAIN_USER);
    await page.locator('#forgottenpw-email').fill(userMail);
    await page.getByTestId('forgot-submit').click();
    await expect(page.getByTestId('forgot-notice')).toHaveText(unmatched ?? '');

    // The matching request issued a token; find it by the key the server writes.
    const keys = await redis('--scan', '--pattern', 'password_reset:*');
    expect(keys.trim().length).toBeGreaterThan(0);
    // Clean up the token this test caused, so the suite leaves no state behind.
    for (const key of keys.split('\n').map((k) => k.trim()).filter(Boolean)) {
      await redis('DEL', key);
    }
  });

  test('username recovery lists the account on the address and states the transport', async ({
    page,
  }) => {
    await page.goto(`${BASE_NEW}/account/password/forgot`);

    await page.locator('#accountlist-owner-email').fill(userMail);
    await page.getByTestId('username-submit').click();

    await expect(page.getByTestId('username-results')).toContainText(PLAIN_USER);
    // No transport exists, and the page must say so rather than implying an
    // email was sent.
    await expect(page.getByTestId('username-transport-note')).toBeVisible();
  });

  test('an address with no accounts lists nothing', async ({ page }) => {
    await page.goto(`${BASE_NEW}/account/password/forgot`);

    await page.locator('#accountlist-owner-email').fill('nobody@example.test');
    await page.getByTestId('username-submit').click();

    await expect(page.getByTestId('username-none')).toBeVisible();
  });

  test('a reset link with no token explains itself instead of failing', async ({ page }) => {
    await page.goto(`${BASE_NEW}/account/password/reset`);
    await expect(page.getByTestId('reset-no-token')).toBeVisible();
    await expect(page.getByTestId('reset-submit')).toHaveCount(0);
  });

  test('an unknown token is refused, and the same token cannot be used twice', async ({ page }) => {
    await page.goto(`${BASE_NEW}/account/password/reset?token=00000000000000000000000000000000`);
    await page.getByLabel('New password').fill('whatever123');
    await page.getByTestId('reset-submit').click();
    await expect(page.getByTestId('reset-error')).toBeVisible();
    // The page also explains the single-use/expiry rule rather than leaving the
    // visitor to guess why their link failed.
    await expect(page.getByTestId('reset-expired')).toBeVisible();

    // Now a token the server would have issued: seed the exact Redis key it
    // writes, then spend it. This exercises the real consume path (GETDEL,
    // password write, audit) rather than a mock.
    await redis('SETEX', REDIS_KEY, '1800', String(TESTUSER_ID));

    await page.goto(`${BASE_NEW}/account/password/reset?token=${KNOWN_TOKEN}`);
    await page.getByLabel('New password').fill('e2e-reset-pass-123');
    await page.getByTestId('reset-submit').click();
    await expect(page.getByTestId('reset-done')).toContainText('successfully changed');

    // Second use of the same link: the key is gone, so this must fail.
    await page.goto(`${BASE_NEW}/account/password/reset?token=${KNOWN_TOKEN}`);
    await page.getByLabel('New password').fill('second-attempt-123');
    await page.getByTestId('reset-submit').click();
    await expect(page.getByTestId('reset-error')).toBeVisible();

    // And the new password is the one that works, which is what proves the write
    // landed rather than that the response said "ok".
    await signIn(page, PLAIN_USER, 'e2e-reset-pass-123');

    // Restore the seeded credential. `afterAll` also does this, but doing it here
    // means a later test in this file cannot be left without a usable account.
    await restoreFixture();
    await verifyFixtureMail();
    await expect.poll(async () => (await redis('EXISTS', REDIS_KEY)).trim()).toBe('0');
  });

  test('the step-up screen asks for the password and refuses a wrong one', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);

    // The flag cannot be set through any route yet — `security_check.php`'s
    // remember-me branch is a later slice — so this asserts the screen's own
    // behaviour: it renders for a signed-in user and rejects a bad password.
    await page.goto(`${BASE_NEW}/account/reauthenticate`);
    await expect(page.getByTestId('reauth-current-user')).toContainText(PLAIN_USER);

    await page.locator('#reauth-password').fill('definitely-not-the-password');
    await page.getByTestId('reauth-submit').click();
    await expect(page.getByTestId('reauth-error')).toContainText('does not match');
  });

  test('a correct password clears the step-up requirement', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);

    // Seed the flag the way `security_check.php` would, so the round trip is
    // tested rather than assumed. The session token is the cookie the browser
    // holds; the server stores the flag inside that session document.
    const cookies = await page.context().cookies();
    const sessionToken = cookies.find((c) => c.name === 'hotel_session')?.value ?? '';
    expect(sessionToken).not.toBe('');

    const sessionJson = (
      await redis('GET', `session:user:${sessionToken}`)
    ).trim();
    expect(sessionJson.length).toBeGreaterThan(0);
    // Rewrite the document with the flag set, preserving every other field: this
    // is the same shape `SessionManager` reads.
    const withFlag = sessionJson.replace(/\}$/, ',"reauth_required":true}');
    await redis('SET', `session:user:${sessionToken}`, withFlag, 'KEEPTTL');

    // `/api/account/session` now reports it.
    const state = await (await page.request.get(`${BASE_NEW}/api/account/session`)).json();
    expect(state.reauth_required).toBe(true);

    // And the client entry refuses to offer the handoff until it is cleared —
    // `client.php` checked this flag before anything else on the page ran.
    await page.goto(`${BASE_NEW}/client`);
    await expect(page).toHaveURL(`${BASE_NEW}/account/reauthenticate`);

    await page.locator('#reauth-password').fill(PLAIN_PASS);
    await page.getByTestId('reauth-submit').click();
    await expect(page).toHaveURL(`${BASE_NEW}/client`);

    const cleared = await (await page.request.get(`${BASE_NEW}/api/account/session`)).json();
    expect(cleared.reauth_required).toBe(false);
  });

  test('the recovery endpoints require the CSRF header', async ({ page }) => {
    // Same-origin request WITHOUT the header: `CsrfPublicFilter` refuses it. The
    // header requirement is what stands in for a session-bound token on a route
    // that has no session.
    for (const path of [
      '/api/auth/password/forgot',
      '/api/auth/password/reset',
      '/api/auth/username/forgot',
    ]) {
      const response = await page.request.post(`${BASE_NEW}${path}`, {
        data: { username: 'x', email: 'y@z.test', token: 'x', new_password: 'abcdef' },
      });
      expect(response.status(), `${path} without the CSRF header`).toBe(403);
    }
  });
}
