import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { envOr } from './pages';

// End-to-end browser flow for the Phase 5 credits surface: `/credits` (the
// converted credits.php purse) and `/credits/history` (the converted
// history.php ledger).
//
//   cd tests/e2e
//   PLAYWRIGHT_CREDITS=1 npx playwright test credits.spec.ts
//   (Windows PowerShell: $env:PLAYWRIGHT_CREDITS='1'; npx playwright test credits.spec.ts)
//
// Gated exactly like the admin and account suites, so a bare
// `npx playwright test` keeps its visual-parity meaning.
//
// ## The ledger fixture
//
// Only two legacy paths ever wrote a ledger row — the housekeeping credit
// adjustment (`admin_grant`) and the MyHabbo Homes store (`homes_store`) — and
// neither is ported yet, so a normal stack has an empty ledger and the page
// correctly renders its empty state. To exercise the populated path this suite
// installs its own two rows, with the exact column values those legacy writers
// produce, and removes them afterwards. Both rows carry a fixed `id` and use
// `ON DUPLICATE KEY UPDATE`, so repeated runs neither accumulate rows nor leave
// the ledger altered.
//
// The empty-state assertion runs BEFORE the fixture is installed, so it is a real
// observation of an empty ledger rather than an assertion about a filtered view.

const BASE_NEW = envOr('BASE_NEW', 'http://localhost:3000');
const PLAIN_USER = envOr('PLAIN_USER', 'testuser');
const PLAIN_PASS = envOr('PLAIN_PASS', 'password123');
const ADMIN_USER = envOr('ADMIN_USER', 'admin');
const ADMIN_PASS = envOr('ADMIN_PASS', 'password123');

/** Seeded user ids from main.cpp; the ledger rows below belong to `testuser`. */
const TESTUSER_ID = 2;
const ADMIN_ID = 1;

/** Fixed ids so the fixture is idempotent across runs. */
const GRANT_ID = 900002;
const STORE_ID = 900001;

/**
 * Install the two ledger rows, in the shapes the legacy writers produce.
 *
 * `admin_grant` mirrors housekeeping/users.php: amount is the signed delta, the
 * description is its fixed string, `reference_id` is the affected user id.
 * `homes_store` mirrors includes/PhpretroHomes.php: amount is negative, the
 * description is `MyHabbo store: <item>`, `reference_id` is the catalogue id.
 * The older `created_at` belongs to the larger id on purpose, so the ordering
 * assertion is about `created_at DESC`, not about insertion order.
 */
const FIXTURE_SQL = `
INSERT INTO phpretro_transactions
  (id, user_id, type, amount, balance_after, description, reference_id, created_at)
VALUES
  (${STORE_ID}, ${TESTUSER_ID}, 'homes_store', -30, 470, 'MyHabbo store: e2e ledger marker', '42', 1700000000),
  (${GRANT_ID}, ${TESTUSER_ID}, 'admin_grant', 50, 500, 'Housekeeping credit adjustment', '${TESTUSER_ID}', 1700003600)
ON DUPLICATE KEY UPDATE
  user_id=VALUES(user_id), type=VALUES(type), amount=VALUES(amount),
  balance_after=VALUES(balance_after), description=VALUES(description),
  reference_id=VALUES(reference_id), created_at=VALUES(created_at);
`;

/**
 * Run one statement against the stack's MariaDB through the running container.
 *
 * `docker exec` rather than `page.request`: the ledger has no write route by
 * design (both its writers belong to later phases), and inventing an
 * admin-only test endpoint to seed it would be shipping a feature to make a test
 * convenient. The equivalent statement is what a legacy install's own writers
 * would have produced.
 */
async function sql(statement: string): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  execFileSync(
    'docker',
    [
      'exec', 'hotel_mariadb',
      'mysql', '-uhotel', '-photel_secret', 'polaris',
      '-e', statement,
    ],
    { stdio: 'pipe' },
  );
}

async function submitSignIn(page: Page, username: string, password: string) {
  await page.goto(`${BASE_NEW}/account`);

  // Wait for React before filling: `goto` resolves on the document load event,
  // which for an SPA is before the form exists. The sign-in form is scoped by
  // test id because the anonymous header renders a second form on this page.
  const submit = page.getByTestId('login-submit');
  await expect(submit).toBeVisible();
  const form = page.getByTestId('account-signin-form');
  await form.getByLabel('Username').fill(username);
  await form.getByLabel('Password').fill(password);
  await submit.click();
}

async function signIn(page: Page, username: string, password: string) {
  await submitSignIn(page, username, password);
  await expect(page.getByTestId('me-username')).toBeVisible({ timeout: 15_000 });
}

/** Navigate to a credits page as a signed-in user and wait for it to render. */
async function gotoCredits(page: Page, path: string, testId: string) {
  await signIn(page, PLAIN_USER, PLAIN_PASS);
  await page.goto(`${BASE_NEW}${path}`);
  await expect(page.getByTestId(testId)).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  // Remove the fixture through the same path that installed it. Without this a
  // later run's empty-state assertion would be testing nothing.
  await sql(
    `DELETE FROM phpretro_transactions WHERE id IN (${GRANT_ID}, ${STORE_ID});`,
  );
});

if (process.env.PLAYWRIGHT_CREDITS !== '1') {
  test.describe('credits surface (not enabled)', () => {
    test.skip('set PLAYWRIGHT_CREDITS=1 to run the credits and ledger flow', () => {});
  });
} else {
  test('a signed-out visitor to /credits gets the sign-in form', async ({ page }) => {
    await page.goto(`${BASE_NEW}/credits`);

    // `AccountPage` renders the form in place rather than redirecting.
    await expect(page.getByTestId('login-submit')).toBeVisible();
    await expect(page.getByTestId('purse-credits')).toHaveCount(0);
  });

  test('a signed-out visitor to /credits/history gets the sign-in form', async ({ page }) => {
    await page.goto(`${BASE_NEW}/credits/history`);
    await expect(page.getByTestId('login-submit')).toBeVisible();
    await expect(page.getByTestId('history-table')).toHaveCount(0);
  });

  test('the purse shows the balance from the live user row', async ({ page }) => {
    await gotoCredits(page, '/credits', 'purse-credits');

    // `credits.php` rendered `$user->user("credits")`; the API reads the same
    // PolarIS column, so the value is a plain integer and the copy keeps the
    // legacy " Coins" suffix.
    await expect(page.getByTestId('purse-credits')).toHaveText(/^\d+ Coins$/);
    await expect(page.getByTestId('purse-pixels')).toHaveText(/^\d+ Pixels$/);

    // The legacy purse linked to `/credits/history`; that path is kept verbatim.
    await expect(page.getByTestId('purse-history-link')).toHaveAttribute(
      'href',
      '/credits/history',
    );
  });

  test('an empty ledger renders the legacy empty-state sentence', async ({ page }) => {
    // Run before the fixture is installed, so this observes a genuinely empty
    // ledger rather than a filtered one.
    await sql(`DELETE FROM phpretro_transactions WHERE id IN (${GRANT_ID}, ${STORE_ID});`);
    await gotoCredits(page, '/credits/history', 'history-empty');

    await expect(page.getByTestId('history-empty')).toHaveText(
      'No transactions have been recorded yet.',
    );
    await expect(page.getByTestId('history-row')).toHaveCount(0);
  });

  test('the ledger renders both legacy row shapes, newest first', async ({ page }) => {
    await sql(FIXTURE_SQL);
    try {
      await gotoCredits(page, '/credits/history', 'history-table');

      const rows = page.getByTestId('history-row');
      await expect(rows).toHaveCount(2);

      // Newest first by `created_at DESC`: the grant (t=1700003600) precedes the
      // store purchase (t=1700000000), even though the store row was inserted
      // first and has the higher id.
      await expect(rows.nth(0)).toContainText('admin_grant');
      await expect(rows.nth(0)).toContainText('50');
      await expect(rows.nth(0)).toContainText('500');
      await expect(rows.nth(0)).toContainText('Housekeeping credit adjustment');

      await expect(rows.nth(1)).toContainText('homes_store');
      // A debit is negative in the ledger; the legacy page cast it to int and
      // printed the sign, so `-30` must survive rather than be shown as a
      // magnitude with a separate direction.
      await expect(rows.nth(1)).toContainText('-30');
      await expect(rows.nth(1)).toContainText('470');
      await expect(rows.nth(1)).toContainText('MyHabbo store: e2e ledger marker');

      // `date('Y-m-d H:i', ...)` — the legacy format, not a locale format.
      await expect(rows.nth(0)).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    } finally {
      await sql(`DELETE FROM phpretro_transactions WHERE id IN (${GRANT_ID}, ${STORE_ID});`);
    }
  });

  test('the ledger is scoped to the signed-in account only', async ({ page }) => {
    // The ledger is scoped by the session server-side and takes no user id, so
    // there is nothing to tamper with. This asserts that directly: the admin's
    // own ledger must not contain the testuser's seeded rows.
    await sql(FIXTURE_SQL);
    try {
      await signIn(page, ADMIN_USER, ADMIN_PASS);
      await page.goto(`${BASE_NEW}/credits/history`);
      await expect(page.getByTestId('history-empty')).toBeVisible();

      // And the API agrees, for the same session: a query parameter cannot widen
      // the scope either.
      const withParam = await page.request.get(
        `${BASE_NEW}/api/account/transactions?user_id=${TESTUSER_ID}`,
      );
      expect(withParam.status()).toBe(200);
      await expect(withParam.json()).resolves.toMatchObject({ count: 0, items: [] });
    } finally {
      await sql(`DELETE FROM phpretro_transactions WHERE id IN (${GRANT_ID}, ${STORE_ID});`);
    }
    expect(ADMIN_ID).not.toBe(TESTUSER_ID);
  });

  test('anonymous API calls to the credits surface are refused', async ({ page }) => {
    const anonymous = await page.context().browser()?.newContext();
    expect(anonymous).toBeTruthy();
    if (!anonymous) return;

    for (const path of ['/api/account/purse', '/api/account/transactions']) {
      const response = await anonymous.request.get(`${BASE_NEW}${path}`);
      expect(response.status()).toBe(401);
    }

    await anonymous.close();
  });
}
