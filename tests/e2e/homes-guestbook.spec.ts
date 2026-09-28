import { expect, test } from '@playwright/test';
import { envOr } from './pages';

// Public, read-only personal Homes guestbook API check. This calls no layout,
// group guestbook, write, rendering, or asset route.
//
//   PLAYWRIGHT_HOMES_GUESTBOOK=1 npx playwright test homes-guestbook.spec.ts
const BASE_NEW = envOr('BASE_NEW', 'http://127.0.0.1:3130');
const SEEDED_PROFILE_ID = process.env.HOMES_GUESTBOOK_PROFILE_ID;
const EXPECTED_MESSAGE = process.env.HOMES_GUESTBOOK_EXPECT_MESSAGE;

if (process.env.PLAYWRIGHT_HOMES_GUESTBOOK !== '1') {
  test.describe('Homes guestbook API (not enabled)', () => {
    test.skip('set PLAYWRIGHT_HOMES_GUESTBOOK=1 to run the isolated API check', () => {});
  });
} else {
  test('guestbook rows are publicly readable as raw JSON text', async ({ page }) => {
    const response = await page.request.get(
      `${BASE_NEW}/api/homes/2147483000/guestbook`,
    );
    expect(response.status(), await response.text()).toBe(200);
    expect(await response.json()).toEqual([]);

    const plusPrefixedProfile = await page.request.get(
      `${BASE_NEW}/api/homes/+2147483000/guestbook`,
    );
    expect(plusPrefixedProfile.status(), await plusPrefixedProfile.text()).toBe(200);
    expect(await plusPrefixedProfile.json()).toEqual([]);

    const largeProfile = await page.request.get(
      `${BASE_NEW}/api/homes/4294967296/guestbook`,
    );
    expect(largeProfile.status(), await largeProfile.text()).toBe(200);
    expect(await largeProfile.json()).toEqual([]);

    const int64MaxProfile = await page.request.get(
      `${BASE_NEW}/api/homes/9223372036854775807/guestbook`,
    );
    expect(int64MaxProfile.status(), await int64MaxProfile.text()).toBe(200);
    expect(await int64MaxProfile.json()).toEqual([]);

    const int64OverflowProfile = await page.request.get(
      `${BASE_NEW}/api/homes/9223372036854775808/guestbook`,
    );
    expect(int64OverflowProfile.status(), await int64OverflowProfile.text()).toBe(422);

    const leadingZeroProfile = await page.request.get(
      `${BASE_NEW}/api/homes/02147483000/guestbook`,
    );
    expect(leadingZeroProfile.status(), await leadingZeroProfile.text()).toBe(422);

    const invalidProfile = await page.request.get(
      `${BASE_NEW}/api/homes/0/guestbook`,
    );
    expect(invalidProfile.status(), await invalidProfile.text()).toBe(422);
    expect(await invalidProfile.text()).toBe('Invalid profile.');

    const negativeProfile = await page.request.get(
      `${BASE_NEW}/api/homes/-1/guestbook`,
    );
    expect(negativeProfile.status(), await negativeProfile.text()).toBe(422);

    const malformedProfile = await page.request.get(
      `${BASE_NEW}/api/homes/not-an-id/guestbook`,
    );
    expect(malformedProfile.status(), await malformedProfile.text()).toBe(422);

    if (SEEDED_PROFILE_ID && EXPECTED_MESSAGE) {
      const seeded = await page.request.get(
        `${BASE_NEW}/api/homes/${SEEDED_PROFILE_ID}/guestbook`,
      );
      expect(seeded.status(), await seeded.text()).toBe(200);
      const seededEntries = await seeded.json();
      expect(seededEntries[0]).toMatchObject({
        profile_user_id: Number(SEEDED_PROFILE_ID),
        author_user_id: 2,
        message: EXPECTED_MESSAGE,
        username: 'testuser',
        created_at: expect.any(Number),
        look: expect.any(String),
        online: '0',
      });
    }
  });
}
