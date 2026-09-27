import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { envOr } from './pages';

// Regression guard: React must own every node it renders.
//
//   PLAYWRIGHT_ROUNDER=1 npx playwright test react-ownership.spec.ts
//
// ## What this protects
//
// The legacy `Rounder` (`web-gallery/static/js/visual.js`) rewrites the flat
// `.cbb` boxes into the sprite-backed border markup the stylesheets actually
// style, and it does so destructively:
//
//   - `addCorners` clones the node and `parentNode.replaceChild`s it, so React's
//     node is thrown away and every later React update goes to a detached node;
//   - `B` moves React's node under a wrapper React knows nothing about.
//
// That silently froze `/forgot`'s second heading at its pre-query value
// ("Forgotten Your  Name?" with a double space) while the settings API returned
// `site_shortname: "Retro"`, and it orphaned 106 of 167 React nodes on that page
// and 183 of 316 on `/credits/collectables`.
//
// The markup is now rendered by React (`src/components/Rounder.tsx`) and the
// legacy global is neutered before either of its two call sites can run —
// `App.tsx` calls `Rounder.init()` for parity and `visual.js:228` registers a
// SECOND call through `HabboView.add`, so skipping only our own call leaves it
// running.
//
// ## Why an orphan count is the right assertion
//
// React stamps every DOM node it creates with an own `__reactFiber$…` property.
// A node in the document without one was either created by something else or
// replaced by something else — either way React has lost ownership of it and
// cannot update it. Counting them detects the whole class of defect, including
// a re-introduced `Rounder.init()` and any future script that rewrites markup
// React owns, without having to know which script did it.
//
// `.rounded-container` counts are asserted alongside it because they prove the
// ported markup is actually being produced: a page that kept React ownership by
// simply dropping the box chrome would pass the orphan check and fail this one.

const BASE = envOr('BASE_NEW', 'http://127.0.0.1:3000');

// Gated like every other suite that needs a running stack, so a plain
// `npx playwright test` does not depend on one.
if (process.env.PLAYWRIGHT_ROUNDER !== '1') {
  test.skip('set PLAYWRIGHT_ROUNDER=1 to check React DOM ownership', () => {});
}

/**
 * `rounded` is the number of `.rounded-container` elements the legacy rewrite
 * produced on that page — measured from the live legacy site before the port
 * (`/` 1, `/community` 3, `/articles` 2, `/help` 2, `/credits/collectables` 5,
 * `/forgot` 3, `/tag` 2). `/papers/disclaimer` is 0 on purpose: `papers.php`
 * renders `#terms > .tos-header`, not a `.cbb` box with an `h2.title`.
 */
const PAGES: { path: string; rounded: number; auth?: 'user' }[] = [
  { path: '/', rounded: 1 },
  { path: '/community', rounded: 3 },
  { path: '/articles', rounded: 2 },
  { path: '/help', rounded: 2 },
  { path: '/credits/collectables', rounded: 5 },
  { path: '/forgot', rounded: 3 },
  { path: '/papers/disclaimer', rounded: 0 },
  { path: '/papers/privacy', rounded: 0 },
  { path: '/tag', rounded: 2 },
  { path: '/register', rounded: 1 },
  { path: '/credits/club', rounded: 1 },
  { path: '/credits/pixels', rounded: 1 },
  // Signed-in pages, because that is where the OTHER legacy DOM scripts run:
  // `common.js` builds the `#subnavi-user` QuickMenu and `fullcontent.js`
  // installs tab-ajax handlers, both registered through `HabboView.run()`.
  // The counts include the one `.rounded-container` `CommunityShell` renders
  // for `#habbos-online .rounded`, which is why they are one higher than the
  // page's own box-title count.
  { path: '/me', rounded: 2, auth: 'user' },
  { path: '/credits', rounded: 4, auth: 'user' },
  { path: '/credits/history', rounded: 2, auth: 'user' },
  { path: '/account/profile', rounded: 5, auth: 'user' },
];

const USER = process.env.ROUNDER_USER ?? 'audituser';
const PASS = process.env.ROUNDER_PASS ?? 'password123';

/** Sign in through the real form, so the page has a genuine session cookie. */
async function signIn(p: Page, base: string): Promise<void> {
  await p.goto(`${base}/account`, { waitUntil: 'networkidle' });
  const form = p.getByTestId('account-signin-form');
  await form.getByLabel('Username').fill(USER);
  await form.getByLabel('Password').fill(PASS);
  await p.getByTestId('login-submit').click();
  await p.waitForURL((url) => !url.pathname.startsWith('/account'), { timeout: 15_000 });
}

for (const page of PAGES) {
  test(`react owns its DOM: ${page.path}`, async ({ browser }) => {
    const context = await browser.newContext();
    const p = await context.newPage();

    if (page.auth === 'user') await signIn(p, BASE);

    const response = await p.goto(BASE + page.path, { waitUntil: 'networkidle' });
    expect(response?.status(), `GET ${page.path}`).toBeLessThan(400);
    await p.waitForTimeout(600);

    const info = await p.evaluate(() => {
      const root = document.getElementById('root');
      if (root === null) return null;

      const hasFiber = (n: Element) =>
        Object.getOwnPropertyNames(n).some((k) => k.startsWith('__reactFiber$'));

      const all = Array.from(root.querySelectorAll('*'));
      const orphaned = all.filter((n) => !hasFiber(n));

      const describe = (n: Element) => {
        const cls =
          typeof n.className === 'string' && n.className.trim() !== ''
            ? '.' + n.className.trim().split(/\s+/).join('.')
            : '';
        return `${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''}${cls}`;
      };

      return {
        total: all.length,
        orphaned: orphaned.length,
        // A few examples, so a failure names the culprit instead of a count.
        examples: orphaned.slice(0, 8).map((n) => {
          let a: Element | null = n.parentElement;
          while (a !== null && !hasFiber(a) && a !== root) a = a.parentElement;
          return `${describe(n)} (under ${a === null ? 'none' : describe(a)})`;
        }),
        roundedContainers: document.querySelectorAll('.rounded-container').length,
        // The legacy global must never touch React's DOM again.
        rounderNeutered: (window as unknown as { Rounder?: { init?: () => void } }).Rounder
          ? true
          : false,
      };
    });

    expect(info, '#root missing — the SPA did not mount').not.toBeNull();

    expect(
      info!.orphaned,
      `${info!.orphaned} of ${info!.total} React nodes on ${page.path} have no ` +
        `__reactFiber$ key, so React cannot update them. Something rewrote DOM ` +
        `React owns (the legacy Rounder does exactly this).\n` +
        info!.examples.map((e) => `  - ${e}`).join('\n'),
    ).toBe(0);

    expect(
      info!.roundedContainers,
      `${page.path} rendered ${info!.roundedContainers} .rounded-container ` +
        `elements; legacy's Rounder produced ${page.rounded}. Either the box ` +
        `title markup stopped being rendered or a box was added/removed.`,
    ).toBe(page.rounded);

    await context.close();
  });
}
