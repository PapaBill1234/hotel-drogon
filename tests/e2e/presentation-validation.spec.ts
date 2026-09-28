import { expect, test } from '@playwright/test';

const BASE = process.env.BASE_NEW ?? 'http://localhost:3000';
const ADMIN_USER = process.env.ADMIN_USER ?? 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS ?? 'password123';

function parseCookies(header: string | undefined): string {
  return (header ?? '')
    .split(/,(?=[^;]+?=)/)
    .map((part) => part.trim().split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
}

test.describe('presentation validation API', () => {
  test('requires staff session and CSRF before accepting a typed document', async ({ request }) => {
    const payload = {
      kind: 'navigation',
      document: {
        revision: 1,
        items: [{
          key: 'home',
          label: 'Home',
          visibility: 'everyone',
          order: 0,
          target: { kind: 'route', path: '/' },
        }],
      },
    };

    const anonymous = await request.post(`${BASE}/api/admin/presentation/validate`, {
      data: payload,
    });
    expect(anonymous.status()).toBe(403);

    const userLogin = await request.post(`${BASE}/api/auth/login`, {
      data: {
        username: ADMIN_USER,
        password: ADMIN_PASS,
      },
    });
    expect(userLogin.status()).toBe(200);
    const userJson = await userLogin.json();
    const xsrf = userJson.csrf_token as string;
    const userCookies = parseCookies(userLogin.headers()['set-cookie']);
    expect(xsrf).toBeTruthy();

    const staffLogin = await request.post(`${BASE}/api/auth/staff-login`, {
      data: {
        username: ADMIN_USER,
        password: ADMIN_PASS,
      },
    });
    expect(staffLogin.status()).toBe(200);
    const cookies = `${userCookies}; ${parseCookies(staffLogin.headers()['set-cookie'])}`;

    const csrfDenied = await request.post(`${BASE}/api/admin/presentation/validate`, {
      data: payload,
      headers: { Cookie: cookies },
    });
    expect([400, 403]).toContain(csrfDenied.status());

    const validated = await request.post(`${BASE}/api/admin/presentation/validate`, {
      data: payload,
      headers: { Cookie: cookies, 'X-XSRF-TOKEN': xsrf },
    });
    expect(validated.status()).toBe(200);
    expect(await validated.json()).toMatchObject({ read_only: true });
  });
});
