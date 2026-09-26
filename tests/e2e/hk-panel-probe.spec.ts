// Diagnostic: is the admin panel's logout control actually clickable?
//
// The admin suite's logout test hangs on `getByTestId('admin-logout').click()`
// after the panel was moved onto the ported housekeeping chrome, which is the
// classic signature of an element that exists but is covered or zero-sized.
//
//   -e BASE_NEW=http://localhost:3000 -e PLAYWRIGHT_ARGS=hk-panel-probe.spec.ts

import { test } from '@playwright/test';
import { envOr } from './pages';

const BASE = envOr('BASE_NEW', 'http://localhost:3000');
const USER = process.env.AUDIT_STAFF_USER ?? 'hkstaff';
const PASS = process.env.AUDIT_STAFF_PASS ?? 'password123';

test('hk panel probe', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await context.newPage();
  p.on('dialog', (d) => void d.dismiss().catch(() => {}));

  await p.goto(`${BASE}/housekeeping/login`, { waitUntil: 'domcontentloaded' });
  await p.locator('input[name="username"]').fill(USER);
  await p.locator('input[name="password"]').fill(PASS);
  await p.getByTestId('login-submit').click();
  await p.getByTestId('admin-session').waitFor({ timeout: 15_000 });
  await p.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log(`=== HK PANEL PROBE ${BASE} ===`);
  // eslint-disable-next-line no-console
  console.log(`url: ${p.url()}`);

  const report = await p.evaluate(() => {
    const out: string[] = [];
    const describe = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return `${sel}: ABSENT`;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return (
        `${sel}: rect=${Math.round(r.x)},${Math.round(r.y)} ` +
        `${Math.round(r.width)}x${Math.round(r.height)} ` +
        `disp=${cs.display} vis=${cs.visibility} z=${cs.zIndex} ov=${cs.overflow}`
      );
    };
    out.push(describe('.panel'));
    out.push(describe('.page_main'));
    out.push(describe('.hk-session-bar'));
    out.push(describe('[data-testid="admin-session"]'));
    out.push(describe('[data-testid="admin-logout"]'));
    out.push(describe('.hk-body'));
    out.push(describe('.hk-nav'));
    out.push(describe('.hk-main'));

    // What actually receives a click at the logout button's centre?
    const btn = document.querySelector<HTMLElement>('[data-testid="admin-logout"]');
    if (btn) {
      const r = btn.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const top = document.elementFromPoint(cx, cy) as HTMLElement | null;
      out.push(
        `logout centre=${Math.round(cx)},${Math.round(cy)} ` +
          `elementFromPoint=${top ? `${top.tagName}#${top.id}.${top.className}` : '(null)'}`,
      );
    }
    return out;
  });

  for (const line of report) {
    // eslint-disable-next-line no-console
    console.log(line);
  }

  await context.close();
});
