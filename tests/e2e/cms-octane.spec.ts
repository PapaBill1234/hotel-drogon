import { expect, test } from '@playwright/test';

// The CMS proxy and Octane point at the SAME disposable PolarIS lab database.
// No primary hotel or legacy database is used here.
test('CMS sign-in launches Octane with a Drogon ticket and renders a room', async ({ page }, testInfo) => {
  await page.goto('http://127.0.0.1:3204/client');
  await expect(page.getByTestId('login-submit')).toBeVisible();
  await expect(page.getByTestId('client-open')).toHaveCount(0);

  await page.goto('http://127.0.0.1:3204/account');
  const form = page.getByTestId('account-signin-form');
  await form.getByLabel('Username').fill('testuser');
  await form.getByLabel('Password').fill('password123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('me-username')).toBeVisible({ timeout: 15_000 });

  await page.goto('http://127.0.0.1:3204/client');
  const launch = page.getByTestId('client-open');
  await expect(launch).toBeVisible();
  const target = await launch.getAttribute('href');
  expect(target).toMatch(/^http:\/\/127\.0\.0\.1:3201\/\?sso=/);
  const popupPromise = page.waitForEvent('popup');
  await launch.click();
  const client = await popupPromise;
  await expect(client.getByRole('button', { name: /log in/i })).toHaveCount(0);
  await expect(client.locator('.hotelview')).toBeVisible({ timeout: 60_000 });
  await client.locator('.hotelview').getByText('Open Navigator', { exact: true }).click();
  await client.locator('.octane-navigator-air__action--create').click();
  await expect(client.locator('.octane-room-creator-air')).toBeVisible();
  await client.locator('.octane-room-creator-air__field--name input').fill('CMS ticket room');
  await client.locator('.octane-room-creator-air__button--create').click();
  await expect(client.locator('.hotelview')).not.toBeVisible({ timeout: 30_000 });
  await expect(client.locator('canvas')).toBeVisible();
  await client.screenshot({ path: testInfo.outputPath('cms-octane-room.png') });
});
