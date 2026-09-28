import { expect, test } from '@playwright/test';
import { envOr } from './pages';

// Signed-in, read-only boundary check for the personal Homes Store catalogue.
// It exercises no purchase, inventory, placement, media load, or Homes layout
// route. The isolated browser stack supplies the seeded rank-1 catalogue rows.
//
//   PLAYWRIGHT_HOMES_STORE=1 npx playwright test homes-store.spec.ts
const BASE_NEW = envOr('BASE_NEW', 'http://127.0.0.1:3130');
const USER = envOr('PLAIN_USER', 'testuser');
const PASSWORD = envOr('PLAIN_PASS', 'password123');

if (process.env.PLAYWRIGHT_HOMES_STORE !== '1') {
  test.describe('Homes Store API (not enabled)', () => {
    test.skip('set PLAYWRIGHT_HOMES_STORE=1 to run the isolated API check', () => {});
  });
} else {
  test('catalogue browse requires sign-in and returns eligible typed metadata', async ({ page }) => {
    const anonymous = await page.request.get(
      `${BASE_NEW}/api/homes/store/categories?type=sticker`,
    );
    expect(anonymous.status(), await anonymous.text()).toBe(401);

    const login = await page.request.post(`${BASE_NEW}/api/auth/login`, {
      data: { username: USER, password: PASSWORD },
    });
    expect(login.status(), await login.text()).toBe(200);

    const unsupportedType = await page.request.get(
      `${BASE_NEW}/api/homes/store/categories?type=widget`,
    );
    expect(unsupportedType.status(), await unsupportedType.text()).toBe(400);

    const categoriesResponse = await page.request.get(
      `${BASE_NEW}/api/homes/store/categories?type=sticker`,
    );
    expect(categoriesResponse.status(), await categoriesResponse.text()).toBe(200);
    const categoryBody = await categoriesResponse.json();
    expect(categoryBody.status).toBe('ok');
    expect(categoryBody.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category_id: 102, category: 'Trax' }),
      ]),
    );

    const itemsResponse = await page.request.get(
      `${BASE_NEW}/api/homes/store/items?type=sticker&category_id=102`,
    );
    expect(itemsResponse.status(), await itemsResponse.text()).toBe(200);
    const itemBody = await itemsResponse.json();
    expect(itemBody.status).toBe('ok');
    expect(itemBody.items).toEqual([
      expect.objectContaining({
        id: 116,
        name: 'Trax Sfx',
        type: 'sticker',
        data_key: 'trax_sfx',
        category_id: 102,
        placement: 'anywhere',
      }),
    ]);
    expect(itemBody.items[0].data_key).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    expect(itemBody.items[0]).not.toHaveProperty('url');
    expect(itemBody.items[0]).not.toHaveProperty('html');

    const invalidCategory = await page.request.get(
      `${BASE_NEW}/api/homes/store/items?type=sticker&category_id=-1`,
    );
    expect(invalidCategory.status(), await invalidCategory.text()).toBe(400);
  });
}
