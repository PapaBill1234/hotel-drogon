import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { envOr } from './pages';

// End-to-end browser flow for Phase 5's remember-me: issuing the token from the
// header's checkbox, restoring a session from it, and the step-up that a restored
// session always requires.
//
//   cd tests/e2e
//   PLAYWRIGHT_REMEMBER=1 npx playwright test remember-me.spec.ts
//   (Windows PowerShell: $env:PLAYWRIGHT_REMEMBER='1'; npx playwright test remember-me.spec.ts)
//
// Gated like the other suites, so a bare `npx playwright test` keeps its
// visual-parity meaning.
//
// ## What it asserts
//
// The whole server-side flow: the pair of cookies, the digest that is stored
// instead of the token, single use, expiry, and that a token-established session
// is routed to the step-up screen rather than to a working page. The one thing it
// does NOT assert is anything about the hotel client — a remember-me session is
// exactly the state that gates it, and that gate is covered in client.spec.ts.

const BASE_NEW = envOr('BASE_NEW', 'http://localhost:3000');
const PLAIN_USER = envOr('PLAIN_USER', 'testuser');
const PLAIN_PASS = envOr('PLAIN_PASS', 'password123');

/** Sign in through the anonymous header's own form. */
async function signInViaHeader(page: Page, rememberMe: boolean) {
  await page.goto(`${BASE_NEW}/help`);
  const form = page.locator('#login-form');
  await expect(form).toBeVisible();
  await form.locator('#login-username').fill(PLAIN_USER);
  await form.locator('#login-password').fill(PLAIN_PASS);
  if (rememberMe) {
    await form.locator('#login-remember-me').check();
  }
  await form.locator('#login-submit-button').click();
  await expect(page.getByTestId('me-username')).toBeVisible({ timeout: 15_000 });
}

/** Drop the session cookies and keep whatever else the browser holds. */
async function dropSessionCookies(page: Page) {
  const context = page.context();
  const kept = (await context.cookies()).filter(
    (c) => c.name !== 'hotel_session' && c.name !== 'XSRF-TOKEN',
  );
  await context.clearCookies();
  if (kept.length > 0) {
    await context.addCookies(kept);
  }
}

test.describe.configure({ mode: 'serial' });

if (process.env.PLAYWRIGHT_REMEMBER !== '1') {
  test.describe('remember-me (not enabled)', () => {
    test.skip('set PLAYWRIGHT_REMEMBER=1 to run the remember-me flow', () => {});
  });
} else {
  test('ticking Remember me issues both cookies; leaving it clear issues neither', async ({
    page,
  }) => {
    await signInViaHeader(page, false);
    let names = (await page.context().cookies()).map((c) => c.name);
    expect(names).toContain('hotel_session');
    expect(names).not.toContain('rememberme');
    expect(names).not.toContain('rememberme_token');

    await page.getByTestId('logout-button').click();
    await expect(page).toHaveURL(`${BASE_NEW}/`);

    await signInViaHeader(page, true);
    const cookies = await page.context().cookies();
    names = cookies.map((c) => c.name);
    expect(names).toContain('rememberme');
    expect(names).toContain('rememberme_token');

    // The flag is readable so the client can decide whether a restore is worth a
    // request; the credential itself is HttpOnly so script never sees it.
    const flag = cookies.find((c) => c.name === 'rememberme');
    const token = cookies.find((c) => c.name === 'rememberme_token');
    expect(flag?.value).toBe('true');
    expect(flag?.httpOnly).toBe(false);
    expect(token?.httpOnly).toBe(true);

    // The legacy `GenerateTicket("remember")` shape: 6-20-20 hex.
    expect(token?.value).toMatch(/^[0-9a-f]{6}-[0-9a-f]{20}-[0-9a-f]{20}$/);
  });

  test('a guarded page restores the session from the token and demands step-up', async ({
    page,
  }) => {
    await signInViaHeader(page, true);
    await dropSessionCookies(page);

    // Browsing on with no session but a live token: this is precisely the legacy
    // front-controller condition (`$user->error == 1 && $_COOKIE['rememberme']`).
    await page.goto(`${BASE_NEW}/me`);

    // A restored session may NOT show a working page: the step-up screen appears
    // in its place and the requested page's own content is absent. That is the
    // whole point of the legacy design, and it is enforced by the guard rather
    // than by a redirect, so the visitor gets the page they asked for as soon as
    // the password is proved.
    await expect(page.getByTestId('reauth-screen')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('reauth-current-user')).toContainText(PLAIN_USER);
    await expect(page.getByTestId('me-username')).toHaveCount(0);

    // The token was spent, so its cookies are gone and it cannot be replayed.
    const names = (await page.context().cookies()).map((c) => c.name);
    expect(names).not.toContain('rememberme_token');
    expect(names).toContain('hotel_session');
  });

  test('the restored session becomes usable after the password is proved', async ({ page }) => {
    await signInViaHeader(page, true);
    await dropSessionCookies(page);
    await page.goto(`${BASE_NEW}/me`);
    await expect(page.getByTestId('reauth-screen')).toBeVisible({ timeout: 15_000 });

    await page.locator('#reauth-password').fill(PLAIN_PASS);
    await page.getByTestId('reauth-submit').click();

    // `reauthenticate.php` sent the user on to what they had asked for; today the
    // only thing that sets the flag is the client entry, so the screen's own
    // form navigates there.
    await expect(page).toHaveURL(`${BASE_NEW}/client`);

    // And the session is now fully usable rather than merely present: the page
    // that previously showed the step-up screen now shows itself.
    await page.goto(`${BASE_NEW}/me`);
    await expect(page.getByTestId('me-username')).toContainText(PLAIN_USER);
    await expect(page.getByTestId('reauth-screen')).toHaveCount(0);
  });

  test('a token without its flag cookie is not consulted', async ({ page }) => {
    await signInViaHeader(page, true);
    await dropSessionCookies(page);

    // Keep the credential, drop the flag: the legacy condition required both, and
    // a stray token must do nothing rather than quietly sign someone in.
    const context = page.context();
    const kept = (await context.cookies()).filter((c) => c.name !== 'rememberme');
    await context.clearCookies();
    await context.addCookies(kept);

    await page.goto(`${BASE_NEW}/me`);
    await expect(page.getByTestId('login-submit')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('me-username')).toHaveCount(0);
  });

  test('an expired token is refused and its cookies are cleared', async ({ page }) => {
    await signInViaHeader(page, true);
    await dropSessionCookies(page);

    // Expire the stored token the way the clock would, since waiting 14 days is
    // not an option. The SQL is the same statement the server's own writer uses,
    // reached through `docker exec` for the same reason the credits suite does it:
    // there is no API for expiring a token, and adding one for a test would be
    // shipping a feature to make the test convenient.
    const { execFileSync } = await import('node:child_process');
    execFileSync(
      'docker',
      [
        'exec', 'hotel_mariadb',
        'mysql', '-N', '-B', '-uhotel', '-photel_secret', 'polaris',
        '-e',
        "UPDATE users SET remember_token_expires_at = UNIX_TIMESTAMP() - 60 WHERE username = '" +
          PLAIN_USER + "';",
      ],
      { stdio: 'pipe' },
    );

    try {
      await page.goto(`${BASE_NEW}/me`);
      await expect(page.getByTestId('login-submit')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('me-username')).toHaveCount(0);

      // A dead token is cleared from the browser, so it is not re-presented on
      // every later navigation.
      const names = (await page.context().cookies()).map((c) => c.name);
      expect(names).not.toContain('rememberme_token');
    } finally {
      // Leave the fixture without a token at all, whatever happened above.
      execFileSync(
        'docker',
        [
          'exec', 'hotel_mariadb',
          'mysql', '-N', '-B', '-uhotel', '-photel_secret', 'polaris',
          '-e',
          "UPDATE users SET remember_token_hash = '', remember_token_expires_at = 0 WHERE id IN (1, 2);",
        ],
        { stdio: 'pipe' },
      );
    }
  });

  test('signing out clears the stored token, not just the cookies', async ({ page }) => {
    const { execFileSync } = await import('node:child_process');
    const scalar = (statement: string) =>
      execFileSync(
        'docker',
        [
          'exec', 'hotel_mariadb',
          'mysql', '-N', '-B', '-uhotel', '-photel_secret', 'polaris',
          '-e', statement,
        ],
        { stdio: 'pipe' },
      )
        .toString()
        .trim();

    await signInViaHeader(page, true);
    const before = await scalar(
      `SELECT CHAR_LENGTH(remember_token_hash) FROM users WHERE username = '${PLAIN_USER}';`,
    );
    expect(before).toBe('64');

    await page.getByTestId('logout-button').click();
    await expect(page).toHaveURL(`${BASE_NEW}/`);

    // Clearing only the cookies would leave a copied value working after a
    // deliberate sign-out — a session the user cannot end.
    const after = await scalar(
      `SELECT CHAR_LENGTH(remember_token_hash) FROM users WHERE username = '${PLAIN_USER}';`,
    );
    expect(after).toBe('0');

    const names = (await page.context().cookies()).map((c) => c.name);
    expect(names).not.toContain('rememberme_token');
    expect(names).not.toContain('rememberme');
  });
}
