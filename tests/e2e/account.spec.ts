import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { envOr } from './pages';

// End-to-end browser flow for the Phase 5 existing-user account journey.
//
//   cd tests/e2e
//   PLAYWRIGHT_ACCOUNT=1 npx playwright test account.spec.ts
//   (Windows PowerShell: $env:PLAYWRIGHT_ACCOUNT='1'; npx playwright test account.spec.ts)
//
// This is the check the Phase 5 exit condition names: an existing user completes
// the journey *through React*. `scripts/check_account_contract.py` already
// proves the API contracts; this proves the UI reaches them, with the real
// session cookies and the real double-submit CSRF token.
//
// Gated on PLAYWRIGHT_ACCOUNT=1 for the same reason admin.spec.ts is gated on
// PLAYWRIGHT_ADMIN: a bare `npx playwright test` must keep exactly its previous
// meaning (the visual-parity run recorded in the inventory), including on a
// machine with no stack running.
//
// One seeded fixture is used, from main.cpp:
//   - `testuser` / `password123` — rank 1, the existing (non-staff) user
//
// The suite is serial and each test signs in for itself, so a failure does not
// cascade into unrelated assertions.

const BASE_NEW = envOr('BASE_NEW', 'http://localhost:3000');
const PLAIN_USER = envOr('PLAIN_USER', 'testuser');
const PLAIN_PASS = envOr('PLAIN_PASS', 'password123');

/** A figure string; the seeded row's own `look` is not assumed to be non-empty. */
const TEST_LOOK = 'hr-100-61.hd-180-1.ch-210-66.lg-270-82.sh-290-80';

/** Unique-ish suffix so repeated runs do not collide on stored values. */
const STAMP = Date.now();

/** Fill and submit the account sign-in form. */
async function submitSignIn(page: Page, username: string, password: string) {
  await page.goto(`${BASE_NEW}/account`);

  // Wait for the React form before filling it. `goto` resolves on the document
  // load event, which for a client-rendered SPA is *before* React has mounted:
  // filling too early writes into the pre-hydration DOM, React then replaces
  // those nodes, and the submit reads its own (empty) state. That is not
  // hypothetical — it is how this suite first failed, reporting the client-side
  // "Username and password are required." for a form whose fields had been
  // filled.
  const submit = page.getByTestId('login-submit');
  await expect(submit).toBeVisible();

  // Scoped to the sign-in form, because the anonymous page header renders a
  // SECOND sign-in form (`#login-form`) on this same page. An unscoped
  // `getByLabel('Username')` resolves to the header's input, fills that, and
  // leaves this form empty — which is what the first failure actually was.
  const form = page.getByTestId('account-signin-form');
  await form.getByLabel('Username').fill(username);
  await form.getByLabel('Password').fill(password);
  await submit.click();
}

/** Sign in expecting success, landing on the account page. */
async function signIn(page: Page, username: string, password: string) {
  await submitSignIn(page, username, password);
  await expect(page.getByTestId('me-username')).toBeVisible({ timeout: 15_000 });
}

/**
 * Navigate and wait for React to have rendered `testId`.
 *
 * See `submitSignIn`: `goto` resolves before hydration, so every direct
 * navigation in this suite waits for one element it is about to use.
 */
async function gotoRendered(page: Page, path: string, testId: string) {
  await page.goto(`${BASE_NEW}${path}`);
  await expect(page.getByTestId(testId)).toBeVisible();
}

/** A direct API call in the page's own cookie jar, for the paths the UI blocks. */
async function apiPost(page: Page, path: string, body: unknown) {
  const cookies = await page.context().cookies();
  const token = cookies.find((c) => c.name === 'XSRF-TOKEN')?.value ?? '';
  return page.request.post(`${BASE_NEW}${path}`, {
    data: body,
    headers: { 'X-XSRF-TOKEN': token },
  });
}

if (process.env.PLAYWRIGHT_ACCOUNT !== '1') {
  test.describe('account journey (not enabled)', () => {
    test.skip('set PLAYWRIGHT_ACCOUNT=1 to run the existing-user account flow', () => {});
  });
} else {
  test.describe.configure({ mode: 'serial' });

  test('a signed-out visitor to /me gets the sign-in form, not a redirect error', async ({
    page,
  }) => {
    await page.goto(`${BASE_NEW}/me`);

    // The guard renders the form in place, so the URL is unchanged and there is
    // no client-side bounce to follow.
    await expect(page).toHaveURL(`${BASE_NEW}/me`);
    await expect(page.getByTestId('login-submit')).toBeVisible();
    await expect(page.getByTestId('me-username')).toHaveCount(0);
  });

  test('a signed-out visitor to /account/profile gets the sign-in form', async ({ page }) => {
    await gotoRendered(page, '/account/profile', 'login-submit');
    await expect(page.getByTestId('profile-save')).toHaveCount(0);
  });

  test('wrong password is refused and establishes no session', async ({ page }) => {
    await submitSignIn(page, PLAIN_USER, 'definitely-not-the-password');

    await expect(page.getByTestId('login-error')).toContainText('Wrong username or password');
    await expect(page.getByTestId('me-username')).toHaveCount(0);

    const names = (await page.context().cookies()).map((c) => c.name);
    expect(names).not.toContain('hotel_session');
  });

  test('sign in with the seeded user opens /me with the real profile', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);

    await expect(page).toHaveURL(`${BASE_NEW}/me`);
    await expect(page.getByTestId('me-username')).toContainText(PLAIN_USER);

    // Credits and pixels come from the PolarIS row, so they must be integers.
    await expect(page.getByTestId('me-credits')).toHaveText(/^\d+$/);
    await expect(page.getByTestId('me-pixels')).toHaveText(/^\d+$/);

    // Signing in records last_login server side, so this must no longer be the
    // "Never" placeholder me.php printed for an account that never signed in.
    await expect(page.getByTestId('me-last-login')).not.toHaveText('Never');

    // All three cookies: the session, the readable CSRF token, and nothing else.
    const names = (await page.context().cookies()).map((c) => c.name);
    expect(names).toContain('hotel_session');
    expect(names).toContain('XSRF-TOKEN');
    expect(names).not.toContain('hotel_staff_session');
  });

  test('the profile page shows the stored account values', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);
    await gotoRendered(page, '/account/profile', 'profile-save');

    await expect(page.getByTestId('profile-username')).toHaveText(PLAIN_USER);
    await expect(page.getByTestId('profile-current-email')).toContainText('@');
  });

  test('saving a motto trims it and persists across a reload', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);
    await gotoRendered(page, '/account/profile', 'profile-save');

    // Deliberately padded: legacy profile.php ran trim() before measuring and
    // storing, so the stored value must come back without the padding.
    const motto = `  e2e motto ${STAMP}  `;
    await page.getByLabel('Motto').fill(motto);
    await page.getByTestId('profile-save').click();

    await expect(page.getByTestId('profile-notice')).toHaveText('Profile updated.');

    // Reload and re-read through GET /api/me: the assertion must be about what
    // the server stored, not about the form's own state.
    await gotoRendered(page, '/me', 'me-username');
    await expect(page.getByTestId('me-motto')).toHaveText(`e2e motto ${STAMP}`);
  });

  test('saving a figure and gender persists', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);
    await gotoRendered(page, '/account/profile', 'profile-save');

    await page.getByLabel('Figure').fill(TEST_LOOK);
    await page.getByLabel('Gender').selectOption('F');
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-notice')).toHaveText('Profile updated.');

    // Re-open the page: the stored figure and gender must be what the form now
    // shows. Writing `look` to a column with no length limit is precisely the
    // divergence the API contract used to carry, so this checks the write landed.
    await gotoRendered(page, '/account/profile', 'profile-save');
    await expect(page.getByLabel('Figure')).toHaveValue(TEST_LOOK);
    await expect(page.getByLabel('Gender')).toHaveValue('F');

    // Restore the original gender so the fixture is not left altered for other
    // suites; the figure is a valid Habbo look and is left in place.
    await page.getByLabel('Gender').selectOption('M');
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-notice')).toHaveText('Profile updated.');
  });

  test('the API rejects an overlong motto that the form cannot submit', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);

    // The form's maxlength stops a human typing 200 characters, so the rejection
    // this asserts is the server's own — the authority the form mirrors. Before
    // this work unit the handler truncated to 128 bytes instead, silently and
    // potentially mid-character; legacy profile.php rejected.
    const response = await apiPost(page, '/api/account/motto', { motto: 'x'.repeat(200) });
    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ status: 400 });

    // The same request one character inside the limit succeeds, so the previous
    // assertion is about the limit rather than about the route being broken.
    const ok = await apiPost(page, '/api/account/motto', { motto: 'y'.repeat(127) });
    expect(ok.status()).toBe(200);
  });

  test('the API rejects an overlong figure', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);

    // 256 characters is legacy profile.php's limit, and it also exceeds the
    // PolarIS column: `users.look` is `varchar(255)`, so a figure that long
    // cannot be stored whatever the handler does. The handler now rejects it
    // explicitly (400) instead of letting the write fail at the database.
    const response = await apiPost(page, '/api/account/look', {
      look: 'l'.repeat(256),
      gender: 'M',
    });
    expect(response.status()).toBe(400);

    // One character inside what the column holds must succeed, so the
    // assertion above is about the boundary and not about a broken route.
    const ok = await apiPost(page, '/api/account/look', {
      look: 'l'.repeat(255),
      gender: 'M',
    });
    expect(ok.status()).toBe(200);
  });

  test('the API rejects a gender that is not M or F instead of coercing it', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);

    // Legacy profile.php: !in_array($gender, ['M','F'], true) -> 'Invalid profile details.'
    const response = await apiPost(page, '/api/account/look', { look: 'hr-100-61', gender: 'X' });
    expect(response.status()).toBe(400);
  });

  test('an email without an @ is refused by the form', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);
    await gotoRendered(page, '/account/profile', 'profile-save');

    await page.getByLabel('Email address').fill('not-an-email');
    await page.getByTestId('email-save').click();

    await expect(page.getByTestId('profile-error')).toContainText('Invalid email format');
  });

  test('changing the email resets mail_verified and persists', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);
    await gotoRendered(page, '/account/profile', 'profile-save');

    // Read the current address so it can be restored at the end.
    const original = (await page.getByTestId('profile-current-email').textContent())?.trim() ?? '';
    const updated = `e2e-${STAMP}@hotel.local`;

    await page.getByLabel('Email address').fill(updated);
    await page.getByTestId('email-save').click();
    await expect(page.getByTestId('profile-notice')).toContainText('Email updated');

    await gotoRendered(page, '/account/profile', 'profile-save');
    await expect(page.getByTestId('profile-current-email')).toHaveText(updated);
    await expect(page.getByTestId('profile-email-unverified')).toBeVisible();

    if (original !== '' && original !== updated) {
      // Restore the address. Known side effect, stated rather than hidden:
      // `mail_verified` stays false after this test, because resetting it is
      // exactly what a successful email change does server side, and no route
      // sets it back — adding one would be a feature, not a test utility. The
      // fixture stays usable for every other suite; only the "verified" badge
      // differs. Repair with:
      //   UPDATE users SET mail_verified=1 WHERE username='testuser';
      await page.getByLabel('Email address').fill(original);
      await page.getByTestId('email-save').click();
      await expect(page.getByTestId('profile-notice')).toContainText('Email updated');
    }
  });

  test('a wrong current password is refused', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);
    await gotoRendered(page, '/account/profile', 'profile-save');

    await page.getByLabel('Current password').fill('not-the-current-password');
    await page.getByLabel('New password').fill('something-new-123');
    await page.getByTestId('password-save').click();

    await expect(page.getByTestId('profile-error')).toContainText(
      'Current password does not match',
    );
  });

  test('logging out from /me returns to the front page and ends the session', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);

    // `me.php`'s own logout control, on the page a signed-in user lands on.
    await page.getByTestId('logout-button').click();
    await expect(page).toHaveURL(`${BASE_NEW}/`);

    const names = (await page.context().cookies()).map((c) => c.name);
    expect(names).not.toContain('hotel_session');

    await page.goto(`${BASE_NEW}/me`);
    await expect(page.getByTestId('login-submit')).toBeVisible();
    await expect(page.getByTestId('me-username')).toHaveCount(0);
  });

  test('a password change succeeds and is immediately usable', async ({ page }) => {
    const temporary = `e2e-pass-${STAMP}`;
    let changed = false;

    try {
      await signIn(page, PLAIN_USER, PLAIN_PASS);
      await gotoRendered(page, '/account/profile', 'profile-save');

      await page.getByLabel('Current password').fill(PLAIN_PASS);
      await page.getByLabel('New password').fill(temporary);
      await page.getByTestId('password-save').click();
      await expect(page.getByTestId('profile-notice')).toContainText(
        'Password successfully changed',
      );
      changed = true;

      // The handler keeps the existing session valid, so the visitor stays
      // signed in — assert that rather than assuming it.
      await gotoRendered(page, '/me', 'me-username');
      await expect(page.getByTestId('me-username')).toContainText(PLAIN_USER);

      // Sign out from /me, then back in with the NEW password. Signing in again
      // is the assertion that proves the write landed, rather than only that the
      // response said "ok".
      await page.getByTestId('logout-button').click();
      await expect(page).toHaveURL(`${BASE_NEW}/`);
      await signIn(page, PLAIN_USER, temporary);
    } finally {
      // The fixture MUST end this test with the seeded password, including when
      // an assertion above fails: `main.cpp` seeds `testuser`/`password123`
      // (sha1('password123testuser')), and `scripts/smoke_phase3.sh` plus
      // `admin.spec.ts` both sign in with it. Leaving it changed once already
      // broke every later test in this suite with a genuine-looking 401, which
      // is a far worse failure than a red test.
      if (changed) {
        await signIn(page, PLAIN_USER, temporary);
        await gotoRendered(page, '/account/profile', 'profile-save');
        await page.getByLabel('Current password').fill(temporary);
        await page.getByLabel('New password').fill(PLAIN_PASS);
        await page.getByTestId('password-save').click();
        await expect(page.getByTestId('profile-notice')).toContainText(
          'Password successfully changed',
        );
        changed = false;
      }
    }

    expect(changed).toBe(false);
  });

  test('an expired session cookie sends the visitor back to the sign-in form', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);

    // Remove ONLY the session cookie, leaving XSRF-TOKEN in place. That is what
    // an expired session looks like to the application: /api/me answers 401,
    // which is the case the guard treats as signed out. Removing both would test
    // a different thing (a visitor who was never signed in).
    const context = page.context();
    const kept = (await context.cookies()).filter((c) => c.name !== 'hotel_session');
    await context.clearCookies();
    await context.addCookies(kept);

    await page.goto(`${BASE_NEW}/me`);
    await expect(page.getByTestId('login-submit')).toBeVisible();
    await expect(page.getByTestId('me-username')).toHaveCount(0);
  });

  test('anonymous API calls are refused, not served empty', async ({ page }) => {
    // A fresh context with no cookies at all: the browser-equivalent of a
    // stranger hitting the API directly.
    const anonymous = await page.context().browser()?.newContext();
    expect(anonymous).toBeTruthy();
    if (!anonymous) return;

    const me = await anonymous.request.get(`${BASE_NEW}/api/me`);
    expect(me.status()).toBe(401);

    // The write is refused by the CSRF filter first: with no session there is no
    // token to compare against, and AuthController documents that ordering. The
    // meaningful claim is that it is refused, not that a particular layer did it.
    const motto = await anonymous.request.post(`${BASE_NEW}/api/account/motto`, {
      data: { motto: 'should not be stored' },
    });
    expect([401, 403]).toContain(motto.status());

    await anonymous.close();
  });

  test('a mutation without the CSRF token is refused even when signed in', async ({ page }) => {
    await signIn(page, PLAIN_USER, PLAIN_PASS);

    // Same cookie jar, deliberately no X-XSRF-TOKEN header. This is the
    // double-submit check doing its job rather than the route being exempt.
    const response = await page.request.post(`${BASE_NEW}/api/account/motto`, {
      data: { motto: 'no token sent' },
    });
    expect(response.status()).toBe(403);

    // And the signed-in session is untouched by the refusal.
    await gotoRendered(page, '/me', 'me-username');
    await expect(page.getByTestId('me-username')).toContainText(PLAIN_USER);
  });
}
