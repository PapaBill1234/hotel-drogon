import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { envOr } from './pages';

// End-to-end browser flow for the converted housekeeping panel.
//
//   cd tests/e2e
//   PLAYWRIGHT_ADMIN=1 npx playwright test admin.spec.ts
//   (Windows PowerShell: $env:PLAYWRIGHT_ADMIN='1'; npx playwright test admin.spec.ts)
//
// This is the check the Phase 4 exit condition actually names: staff must be
// able to manage public content *through the new admin UI*. `scripts/
// smoke_phase4_admin.sh` already proves the API; this proves the UI reaches it,
// with both sessions, CSRF, the rank gate and the high-trust boundary.
//
// It is gated on PLAYWRIGHT_ADMIN=1 so a bare `npx playwright test` (the
// visual-parity run recorded in the inventory) keeps exactly its previous
// meaning, including on machines with no stack running.
//
// Two fixtures, both seeded by main.cpp:
//   - `admin`    / `password123` — rank 7
//   - `testuser` / `password123` — rank 1

const BASE_NEW = envOr('BASE_NEW', 'http://localhost:3000');
const ADMIN_USER = envOr('ADMIN_USER', 'admin');
const ADMIN_PASS = envOr('ADMIN_PASS', 'password123');
const PLAIN_USER = envOr('PLAIN_USER', 'testuser');
const PLAIN_PASS = envOr('PLAIN_PASS', 'password123');

/** Unique-ish suffix so repeated runs do not collide on seeded content. */
const STAMP = `E2E ${Date.now()}`;

/** Fill and submit the sign-in form. Resolves once the click is dispatched. */
async function submitSignIn(page: Page, username: string, password: string) {
  await page.goto(`${BASE_NEW}/housekeeping/login`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByTestId('login-submit').click();
}

/** Sign in expecting success: also waits for the panel to finish re-checking both sessions. */
async function signIn(page: Page, username: string, password: string) {
  await submitSignIn(page, username, password);

  // The click resolves once the SPA has navigated, which is before the panel
  // has finished re-checking the two sessions. Waiting on a visible element
  // here keeps every caller from re-deriving that wait, and gives a far better
  // failure message than a timeout on whatever the test clicks next.
  await expect(page.getByTestId('admin-session')).toBeVisible({ timeout: 15_000 });
}

if (process.env.PLAYWRIGHT_ADMIN !== '1') {
  // Declared but skipped: a bare `npx playwright test` reports the same result
  // set it reported before this file existed, with an explicit reason.
  test.describe('admin UI (not enabled)', () => {
    test.skip('set PLAYWRIGHT_ADMIN=1 to run the housekeeping UI flow', () => {});
  });
} else {
  test.describe.configure({ mode: 'serial' });

  test('anonymous visitor is sent to the staff sign-in screen', async ({ page }) => {
    await page.goto(`${BASE_NEW}/housekeeping/news`);

    // The layout is the gate; without either session it must not render content.
    await expect(page.getByTestId('admin-blocked')).toBeVisible();
    await expect(page.getByTestId('admin-blocked')).toHaveAttribute(
      'data-reason',
      'signed-out',
    );
    await expect(page.getByTestId('page-title')).toHaveCount(0);
  });

  test('non-staff account is refused', async ({ page }) => {
    await submitSignIn(page, PLAIN_USER, PLAIN_PASS);

    await expect(page.getByTestId('login-error')).toContainText('rank 5 or above');
  });

  test('wrong password is refused', async ({ page }) => {
    await submitSignIn(page, ADMIN_USER, 'definitely-not-the-password');

    await expect(page.getByTestId('login-error')).toContainText(
      'Wrong username or password',
    );
    await expect(page.getByTestId('admin-session')).toHaveCount(0);
  });

  test('staff sign-in establishes both sessions and the panel renders', async ({ page }) => {
    await signIn(page, ADMIN_USER, ADMIN_PASS);

    await expect(page).toHaveURL(`${BASE_NEW}/housekeeping`);
    const session = page.getByTestId('admin-session');
    await expect(session).toBeVisible();
    await expect(session).toContainText(ADMIN_USER);
    await expect(session).toContainText('high-trust content enabled');

    // Both cookies must exist: the staff session authorizes, and the *user*
    // session's token is what CSRF is validated against. Asserting only one
    // would pass on a half-working sign-in that then fails every write.
    const cookies = await page.context().cookies();
    const names = cookies.map((c) => c.name);
    expect(names).toContain('hotel_session');
    expect(names).toContain('hotel_staff_session');
    expect(names).toContain('XSRF-TOKEN');
  });

  test('staff can create, edit and delete a news article through the UI', async ({ page }) => {
    await signIn(page, ADMIN_USER, ADMIN_PASS);
    await page.goto(`${BASE_NEW}/housekeeping/news`);

    // --- create ---------------------------------------------------------
    await page.getByTestId('news-new').click();
    await page.getByLabel('Title').fill(`${STAMP} title`);
    await page.getByLabel('Summary').fill('summary from the browser flow');
    await page.getByLabel('Story').fill('story from the browser flow');
    await page.getByLabel('Author').fill('e2e');
    await page.getByTestId('news-save').click();

    await expect(page.getByTestId('admin-notice')).toContainText('published');

    let row = page.getByRole('row', { name: new RegExp(`${STAMP} title`) }).first();
    await expect(row).toBeVisible();

    // --- update ---------------------------------------------------------
    await row.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Title').fill(`${STAMP} title (edited)`);
    await page.getByTestId('news-save').click();

    await expect(page.getByTestId('admin-notice')).toContainText('updated');
    row = page
      .getByRole('row', { name: new RegExp(`${STAMP} title \\(edited\\)`) })
      .first();
    await expect(row).toBeVisible();

    // --- the server's per-field validation reaches the right input -------
    await row.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Title').fill('');
    await page.getByTestId('news-save').click();

    await expect(page.getByTestId('admin-notice')).toContainText('Article not updated');
    await expect(page.getByTestId('field-error-title')).toContainText('title is required');
    await page.getByRole('button', { name: 'Cancel' }).click();

    // --- delete, leaving the fixture set as it was found -----------------
    row = page
      .getByRole('row', { name: new RegExp(`${STAMP} title \\(edited\\)`) })
      .first();
    await row.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByTestId('admin-notice')).toContainText('deleted');
    await expect(page.getByRole('row', { name: new RegExp(STAMP) })).toHaveCount(0);
  });

  test('a mutation without the CSRF header is refused', async ({ page }) => {
    await signIn(page, ADMIN_USER, ADMIN_PASS);
    await page.goto(`${BASE_NEW}/housekeeping/news`);

    // The panel's own calls carry X-XSRF-TOKEN (read from the readable cookie).
    // Stripping it proves the header is actually required, rather than the
    // staff session cookie alone being sufficient.
    await page.route('**/api/admin/news', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      const headers = { ...route.request().headers() };
      delete headers['x-xsrf-token'];
      await route.continue({ headers });
    });

    const result = await page.evaluate(async () => {
      const response = await fetch('/api/admin/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          title: 'csrf probe',
          summary: 's',
          story: 's',
          author: 'e2e',
        }),
      });
      return { status: response.status, body: await response.text() };
    });

    expect(result.status, `expected 403, body was ${result.body}`).toBe(403);
    await page.unroute('**/api/admin/news');
  });

  test('raw-HTML banner content warns before submit and never renders as markup', async ({
    page,
  }) => {
    await signIn(page, ADMIN_USER, ADMIN_PASS);
    await page.goto(`${BASE_NEW}/housekeeping/banners`);

    await page.getByTestId('banner-new').click();

    // The warning must not appear for an ordinary banner...
    await expect(page.getByTestId('high-trust-warning')).toHaveCount(0);

    const raw = `<script>/* ${STAMP} */</script>`;
    await page.getByLabel('Text').fill(`${STAMP} banner`);
    await page.getByLabel('HTML (advanced)').fill(raw);

    // ...and must appear as soon as the value carries raw markup, before submit.
    await expect(page.getByTestId('high-trust-warning')).toBeVisible();
    await expect(page.getByTestId('high-trust-warning')).toContainText('without escaping');

    await page.getByTestId('banner-save').click();
    await expect(page.getByTestId('admin-notice')).toContainText('Banner created');

    // The panel must never render the raw markup as markup. React emits no
    // inline scripts and the Vite entry is a module with a src attribute.
    const inlineScripts = await page.evaluate(
      () => document.querySelectorAll('script:not([src])').length,
    );
    expect(inlineScripts).toBe(0);

    // The value may exist only as a form-control value, never as DOM text.
    const leaked = await page.evaluate(
      (needle) => document.body.innerText.includes(needle),
      raw,
    );
    expect(leaked, 'raw markup leaked into rendered text').toBe(false);

    // Clean up through the UI, locating the row by this run's unique text so a
    // banner left behind by an earlier smoke run cannot be deleted by mistake.
    const row = page.getByRole('row').filter({ hasText: `${STAMP} banner` }).first();
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('admin-notice')).toContainText('deleted');

    // Assert the removal, not just the notice. `phpretro_banners` feeds the
    // public pages' ad slots, so a banner this suite creates and fails to delete
    // changes the markup the visual-parity baselines were captured against.
    await expect(page.getByRole('row').filter({ hasText: `${STAMP} banner` })).toHaveCount(0);
  });

  test('site settings list existing keys and save a change', async ({ page }) => {
    await signIn(page, ADMIN_USER, ADMIN_PASS);
    await page.goto(`${BASE_NEW}/housekeeping/settings`);

    // `site_promo_phrases` is chosen deliberately: it is editable through this
    // screen but is NOT rendered by the currently converted public pages, so a
    // failed restore cannot silently break the visual-parity baselines the way
    // a change to `site_name` would.
    const field = page.getByLabel('site_promo_phrases');
    await expect(field).toBeVisible();

    const original = await field.inputValue();
    await field.fill(`${original}|e2e-probe`);
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('admin-notice')).toContainText('Settings saved');
    await expect(page.getByLabel('site_promo_phrases')).toHaveValue(`${original}|e2e-probe`);

    // Restore the original value.
    await page.getByLabel('site_promo_phrases').fill(original);
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('admin-notice')).toContainText('Settings saved');
    await expect(page.getByLabel('site_promo_phrases')).toHaveValue(original);
  });

  test('logging out returns the panel to the sign-in gate', async ({ page }) => {
    await signIn(page, ADMIN_USER, ADMIN_PASS);
    await page.goto(`${BASE_NEW}/housekeeping`);
    await page.getByTestId('admin-logout').click();

    await expect(page).toHaveURL(`${BASE_NEW}/housekeeping/login`);
    await page.goto(`${BASE_NEW}/housekeeping/news`);
    await expect(page.getByTestId('admin-blocked')).toBeVisible();
  });
}
