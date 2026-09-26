import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { AUDIT_PAGES } from './pages';
import type { AuditPage } from './pages';
import { VIEWPORT } from './playwright.config';

// Visual AUDIT across the whole migration — not the parity gate.
//
//   BASE_NEW=http://localhost:3000 BASE_LEGACY=http://localhost:8081 \
//     npx playwright test audit.spec.ts
//
// `visual-parity.spec.ts` answers "do the converted pages still match their
// approved baselines?" and gates CI. This answers a different question: "which
// pages differ, which are missing, and by how much?" — over every page that
// exists on either stack, including the legacy pages that were never converted.
//
// It writes PNGs for both sides plus `report.md`, and NEVER fails on a visual
// difference: a difference is the finding, not a regression. It fails only when
// a page it was asked to capture could not be captured at all.
//
// Screenshots land in `AUDIT_OUT` (default `tests/e2e/.out/audit`). That path is
// gitignored via `tests/e2e/.out/`.

const BASE_NEW = process.env.BASE_NEW ?? 'http://localhost:3000';
const BASE_LEGACY = process.env.BASE_LEGACY ?? 'http://localhost:8081';
const OUT = process.env.AUDIT_OUT ?? path.resolve(__dirname, '.out/audit');
const USER = process.env.AUDIT_USER ?? 'testuser';
const PASS = process.env.AUDIT_PASS ?? 'password123';

/** Only audit these names, for iterating on one page. */
const only = (process.env.AUDIT_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const selected = only.length ? AUDIT_PAGES.filter((p) => only.includes(p.name)) : AUDIT_PAGES;

interface Finding {
  name: string;
  newPath: string | null;
  legacyPath: string | null;
  newStatus: string;
  legacyStatus: string;
  verdict: string;
  note: string;
}

const findings: Finding[] = [];

/**
 * Did the sign-in actually take?
 *
 * Without this the audit lies: a failed legacy sign-in still returns 200 and the
 * page renders its PUBLIC fallback (me.php sends a guest to "/"), so the capture
 * looks successful and the diff compares a signed-in page against the landing
 * page. That is worse than not capturing at all, because it reads as a finding.
 */
async function isSignedIn(p: Page, base: string): Promise<boolean> {
  if (base === BASE_NEW) {
    return p
      .getByTestId('me-username')
      .isVisible()
      .catch(() => false);
  }
  // Legacy. Verified against /me, /credits and /profile with a real session:
  // the signed-in community header renders `#subnavi-user` and does NOT render
  // `#subnavi-login`; a guest gets the exact inverse. Two other candidates were
  // measured and rejected — `#tab-register-now` is present on the SIGNED-IN
  // header too (it becomes the Housekeeping tab for rank > 4), and a "logout"
  // link is absent on profile.php and credits.php.
  return p.evaluate(() => {
    const user = document.getElementById('subnavi-user') !== null;
    const guest = document.getElementById('subnavi-login') !== null;
    return user && !guest;
  });
}

/**
 * Sign in, when the page needs it.
 *
 * The two stacks could not be more different here, so each gets its own path:
 *
 *  - **New**: `POST /api/auth/login` driven through the `/account` form.
 *  - **Legacy**: `index.php`'s `form.login-habblet` posts to
 *    `/account/submit` with a hidden `csrf_token`, and `account.php` runs
 *    `Csrf::requireValid()` on it. The visible button is the styled anchor; the
 *    real `<input type=submit>` is pushed to `margin-left:-10000px` by
 *    `LoginFormUI.init()`, so this submits the form directly rather than
 *    clicking an element that is deliberately off-screen.
 */
async function signIn(p: Page, base: string, kind: 'user' | 'staff') {
  const username = kind === 'staff' ? (process.env.AUDIT_STAFF_USER ?? 'admin') : USER;
  const password = kind === 'staff' ? (process.env.AUDIT_STAFF_PASS ?? PASS) : PASS;

  if (base === BASE_NEW) {
    await p.goto(`${base}/account`, { waitUntil: 'domcontentloaded' });
    const form = p.getByTestId('account-signin-form');
    await form.getByLabel('Username').fill(username);
    await form.getByLabel('Password').fill(password);
    await p.getByTestId('login-submit').click();
    await p.getByTestId('me-username').waitFor({ timeout: 15_000 });
    return;
  }

  // Legacy. The staff panel has its own login page and its own form.
  await p.goto(kind === 'staff' ? `${base}/housekeeping/` : `${base}/`, {
    waitUntil: 'domcontentloaded',
  });
  const form = p.locator('form').filter({ has: p.locator('input[name="password"]') }).first();
  await form.locator('input[name="username"]').waitFor({ state: 'attached', timeout: 15_000 });
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="password"]').fill(password);
  // `requestSubmit()` fires the submit event and runs validation, unlike
  // `form.submit()`, which bypasses both.
  await form.evaluate((f: HTMLFormElement) => f.requestSubmit());
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  await p.waitForTimeout(1200);
}

test.describe.configure({ mode: 'serial' });

if (process.env.PLAYWRIGHT_AUDIT !== '1') {
  test.describe('migration audit (not enabled)', () => {
    test.skip('set PLAYWRIGHT_AUDIT=1 to run the whole-site visual audit', () => {});
  });
} else {

test.beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
});

for (const page of selected) {
  test(`audit: ${page.name}`, async ({ browser }) => {
    // Capturing two sides, with a sign-in on each, does not fit the 30s default.
    // Override with AUDIT_TIMEOUT_MS; a page that still cannot be captured is
    // recorded as a finding rather than failing the whole audit.
    test.setTimeout(Number(process.env.AUDIT_TIMEOUT_MS ?? 90_000));
    const finding: Finding = {
      name: page.name,
      newPath: page.newPath,
      legacyPath: page.legacyPath,
      newStatus: '-',
      legacyStatus: '-',
      verdict: '',
      note: page.note ?? '',
    };

    for (const side of ['legacy', 'new'] as const) {
      const rel = side === 'legacy' ? page.legacyPath : page.newPath;
      const base = side === 'legacy' ? BASE_LEGACY : BASE_NEW;
      if (rel === null) {
        if (side === 'new') finding.newStatus = 'ABSENT';
        else finding.legacyStatus = 'ABSENT';
        continue;
      }

      const context = await browser.newContext({ viewport: VIEWPORT });
      const p = await context.newPage();
      p.on('dialog', (d) => void d.dismiss().catch(() => {}));
      let status = '-';
      try {
        // Sign-in is best-effort: a stack where it does not work is a finding
        // ("could not authenticate"), not a reason to lose the whole audit.
        if (page.auth) {
          try {
            await signIn(p, base, page.auth);
          } catch (err) {
            finding.note = `${finding.note} [${side} sign-in threw: ${String(err).slice(0, 60)}]`.trim();
          }
        }
        const resp = await p.goto(base + rel, {
          waitUntil: 'domcontentloaded',
          timeout: 20_000,
        });
        status = String(resp?.status() ?? '-');
        await p.waitForLoadState('load').catch(() => {});
        await p.evaluate(() => document.fonts.ready).catch(() => {});
        await p.waitForTimeout(400);

        // The guard is checked ON THE TARGET PAGE, not on the sign-in page.
        // Checking it before navigating measured the login screen, which is
        // "not signed in" for the wrong reason and passed for a guest — so
        // me.php's guest redirect to "/" was captured under `me`'s name and
        // scored as a visual difference. Verify where it matters.
        if (page.auth && !(await isSignedIn(p, base))) {
          if (side === 'legacy') finding.legacyStatus = 'UNAUTH';
          else finding.newStatus = 'UNAUTH';
          finding.note = `${finding.note} [${side}: sign-in did not take; not captured]`.trim();
          continue;
        }

        await p.screenshot({ path: path.join(OUT, `${page.name}--${side}.png`) });
      } catch (err) {
        status = `ERR`;
        finding.note = `${finding.note} [${side}: ${String(err).slice(0, 80)}]`.trim();
      } finally {
        await context.close().catch(() => {});
      }

      if (side === 'legacy') finding.legacyStatus = status;
      else finding.newStatus = status;
    }

    // Verdict. Deliberately coarse: this is an inventory, not a measurement.
    if (page.legacyPath === null) finding.verdict = 'new-only';
    else if (page.newPath === null) finding.verdict = 'NOT CONVERTED';
    else finding.verdict = 'compare';

    findings.push(finding);
    console.log(
      `[audit] ${page.name.padEnd(22)} legacy=${finding.legacyStatus.padEnd(5)} ` +
        `new=${finding.newStatus.padEnd(5)} ${finding.verdict}`,
    );
  });
}

test.afterAll(() => {
  const lines = [
    '# Migration visual audit',
    '',
    `- new stack: \`${BASE_NEW}\``,
    `- legacy stack: \`${BASE_LEGACY}\``,
    `- screenshots: \`${OUT}\` (\`<name>--legacy.png\`, \`<name>--new.png\`)`,
    '',
    '| page | legacy path | new path | legacy | new | verdict |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const f of findings.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(
      `| ${f.name} | ${f.legacyPath ?? '—'} | ${f.newPath ?? '—'} | ` +
        `${f.legacyStatus} | ${f.newStatus} | ${f.verdict} |`,
    );
  }
  lines.push('');
  fs.writeFileSync(path.join(OUT, 'report.md'), lines.join('\n'));

  const missing = findings.filter((f) => f.verdict === 'NOT CONVERTED').length;
  const comparable = findings.filter((f) => f.verdict === 'compare').length;
  console.log(
    `\n[audit] ${findings.length} pages probed: ${comparable} comparable, ` +
      `${missing} not converted, ` +
      `${findings.filter((f) => f.verdict === 'new-only').length} new-only`,
  );
  console.log(`[audit] report: ${path.join(OUT, 'report.md')}`);

  // A capture that could not run at all is a broken harness, not a finding.
  const broken = findings.filter((f) => f.note.includes('ERR'));
  expect(broken, `pages that failed to capture:\n${JSON.stringify(broken, null, 2)}`).toEqual([]);
});

}  // PLAYWRIGHT_AUDIT
