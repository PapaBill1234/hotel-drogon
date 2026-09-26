import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('disposable PolarIS SSO ticket enters and renders a room in Octane', async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  const username = `Lab${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const password = `Lab-${randomUUID()}!`;
  page.on('pageerror', error => errors.push(`page: ${error.message}`));
  page.on('response', response => {
    if (response.status() >= 400 && errors.length < 30)
      errors.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', request => {
    if (errors.length < 30) errors.push(`request: ${request.url()} ${request.failure()?.errorText}`);
  });
  try {
    const registration = await request.post('http://127.0.0.1:3201/api/auth/register', {
      data: { username, email: `${username.toLowerCase()}@example.invalid`, password, gender: 'M' }
    });
    expect(registration.status(), await registration.text()).toBe(200);
    const login = await request.post('http://127.0.0.1:3201/api/auth/login', {
      data: { username, password }
    });
    expect(login.status(), await login.text()).toBe(200);
    const { ssoTicket } = await login.json();
    expect(typeof ssoTicket).toBe('string');
    expect(ssoTicket.length).toBeGreaterThan(10);
    await page.goto(`/?sso=${encodeURIComponent(ssoTicket)}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /log in/i })).toHaveCount(0);
    await expect(page.locator('.hotelview')).toBeVisible({ timeout: 60_000 });
    await page.locator('.hotelview').getByText('Open Navigator', { exact: true }).click();
    await expect(page.locator('.octane-navigator-air__action--create')).toBeVisible();
    await page.locator('.octane-navigator-air__action--create').click();
    await expect(page.locator('.octane-room-creator-air')).toBeVisible();
    await page.locator('.octane-room-creator-air__field--name input').fill(`Lab room ${username.slice(-6)}`);
    await page.locator('.octane-room-creator-air__button--create').click();
    await expect(page.locator('.hotelview')).not.toBeVisible({ timeout: 30_000 });
    await expect(page.locator('canvas')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('room.png') });
  } finally {
    console.log(`Octane path: ${new URL(page.url()).pathname}`);
    console.log(`Octane body: ${(await page.locator('body').innerText()).slice(0, 1200)}`);
    console.log(`Octane load errors: ${JSON.stringify(errors)}`);
  }
});
