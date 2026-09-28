import { expect, test } from '@playwright/test';

const BASE_NEW = process.env.BASE_NEW ?? 'http://127.0.0.1:3130';

test('article slug route requests and renders the matching article', async ({ page }) => {
  const detailRequests: string[] = [];

  await page.route('**/api/public/news**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/public/news/1') {
      detailRequests.push(url.pathname);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          id: 1,
          title: 'Route parameter detail fixture',
          summary: 'Loaded from the article path.',
          story: 'The detail endpoint was selected from the URL parameter.',
          author: 'Playwright',
          categories: '',
          images: '',
          time: 1700000000,
        }),
      });
      return;
    }

    if (url.pathname === '/api/public/news') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', items: [], count: 0 }),
      });
      return;
    }

    await route.continue();
  });

  await page.goto(`${BASE_NEW}/articles/1-title-safe`);
  await expect(page.locator('#article-wrapper h2')).toHaveText(
    'Route parameter detail fixture',
  );
  expect(detailRequests).toEqual(['/api/public/news/1']);
});
