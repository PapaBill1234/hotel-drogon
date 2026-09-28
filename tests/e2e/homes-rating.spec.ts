import { expect, test } from '@playwright/test';
import { envOr } from './pages';

// Focused route boundary check for the independent rating API. It never opens a
// Homes page or calls the layout endpoint, and the invalid widget id is rejected
// before the service opens a database transaction.
//
//   PLAYWRIGHT_HOMES_RATING=1 npx playwright test homes-rating.spec.ts
//
// Run against the disposable `ci-browser` Compose project on port 3130.
const BASE_NEW = envOr('BASE_NEW', 'http://127.0.0.1:3130');
const USER = envOr('PLAIN_USER', 'testuser');
const PASSWORD = envOr('PLAIN_PASS', 'password123');

if (process.env.PLAYWRIGHT_HOMES_RATING !== '1') {
  test.describe('Homes rating API (not enabled)', () => {
    test.skip('set PLAYWRIGHT_HOMES_RATING=1 to run the isolated API check', () => {});
  });
} else {
  test('public summary and first-vote route enforce auth and CSRF', async ({ page }) => {
    const summary = await page.request.get(`${BASE_NEW}/api/homes/1/rating`);
    expect(summary.status(), await summary.text()).toBe(200);
    const summaryBody = await summary.json();
    expect(summaryBody).toMatchObject({
      status: 'ok',
      total: 0,
      high: 0,
      average: 0,
      px: 0,
      mine: false,
      owner: false,
    });

    const anonymousPost = await page.request.post(`${BASE_NEW}/api/homes/1/rating/0`, {
      data: { rating: 4 },
    });
    expect(anonymousPost.status(), await anonymousPost.text()).toBe(403);

    const login = await page.request.post(`${BASE_NEW}/api/auth/login`, {
      data: { username: USER, password: PASSWORD },
    });
    expect(login.status(), await login.text()).toBe(200);

    const missingCsrf = await page.request.post(`${BASE_NEW}/api/homes/1/rating/0`, {
      data: { rating: 4 },
    });
    expect(missingCsrf.status(), await missingCsrf.text()).toBe(403);

    const csrf = (await page.context().cookies(BASE_NEW)).find(
      cookie => cookie.name === 'XSRF-TOKEN'
    )?.value;
    expect(csrf).toBeTruthy();
    const invalidWidget = await page.request.post(`${BASE_NEW}/api/homes/1/rating/0`, {
      data: { rating: 4 },
      headers: { 'X-XSRF-TOKEN': csrf! },
    });
    expect(invalidWidget.status(), await invalidWidget.text()).toBe(400);
  });
}
