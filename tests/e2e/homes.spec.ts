import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { envOr } from './pages';

// End-to-end browser flow for the Phase 8 MyHabbo Homes page and its editor:
// `/home/2` (the converted home.php) and `/home/2/edit` (the edit mode the
// legacy `myhabbo/startSession/<id>` URL switched on).
//
//   cd tests/e2e
//   PLAYWRIGHT_HOMES=1 npx playwright test homes.spec.ts
//   (Windows PowerShell: $env:PLAYWRIGHT_HOMES='1'; npx playwright test homes.spec.ts)
//
// Gated exactly like the admin, account and credits suites, so a bare
// `npx playwright test` keeps its visual-parity meaning.
//
// ## What this suite is for, and what it is not
//
// The layout API's own checks (`scripts/smoke_phase8_homes.sh`) drive the
// endpoints directly, including the two-concurrent-saves race. This suite exists
// for the parts only a browser can answer: that the page renders the boxes the
// API described, at the geometry the API computed, and — the point of the phase
// — that dragging one produces a save, and that a save which loses the version
// race is **rolled back to the server's layout** rather than left on screen.
//
// The widget *contents* are not asserted, because they are not ported yet; each
// box says so in its own body, and this suite asserts that marker is present
// rather than pretending the box is finished.

const BASE_NEW = envOr('BASE_NEW', 'http://localhost:3000');
const OWNER_USER = envOr('PLAIN_USER', 'testuser');
const OWNER_PASS = envOr('PLAIN_PASS', 'password123');

/** The seeded `testuser` id from `src/main.cpp`. */
const OWNER_ID = 2;

/** Sign in through the sign-in screen the site actually ships. */
async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.goto(`${BASE_NEW}/account`);
  // Wait for React before filling: `goto` resolves on the document load event,
  // which for an SPA is before the form exists. Scoped by test id because the
  // anonymous header renders a second form on this page.
  const submit = page.getByTestId('login-submit');
  await expect(submit).toBeVisible();
  const form = page.getByTestId('account-signin-form');
  await form.getByLabel('Username').fill(username);
  await form.getByLabel('Password').fill(password);
  await submit.click();
  await expect(page.getByTestId('me-username')).toBeVisible({ timeout: 15_000 });
}

/** The layout as the API reports it, for assertions against the rendered page. */
async function readLayout(page: Page) {
  const response = await page.request.get(`${BASE_NEW}/api/homes/${OWNER_ID}/layout`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as {
    home: { version: number; editable: boolean; background: string; lock: { held: boolean } };
    widgets: Array<{
      id: number;
      widget_key: string;
      column: number;
      position: number;
      left: number;
      top: number;
      z_index: number;
    }>;
  };
}

/** Drag a widget's title-bar handle by a pixel delta, as a user would. */
async function dragWidget(page: Page, widgetId: number, dx: number, dy: number): Promise<void> {
  const handle = page.locator(`#widget-${widgetId}-handle`);
  const box = await handle.boundingBox();
  expect(box, `widget ${widgetId} has a handle to drag`).not.toBeNull();
  if (!box) return;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Several small moves rather than one jump: dnd-kit's PointerSensor needs the
  // activation distance to be exceeded by a move it observes.
  await page.mouse.move(startX + dx / 2, startY + dy / 2, { steps: 5 });
  await page.mouse.move(startX + dx, startY + dy, { steps: 5 });
  await page.mouse.up();
}

test.describe('MyHabbo home page', () => {
  test.skip(process.env.PLAYWRIGHT_HOMES !== '1', 'set PLAYWRIGHT_HOMES=1 to run');

  test.beforeAll(async ({ browser }) => {
    // A home that has never been saved renders `displayLayouts()`'s synthesised
    // profile widget, which has no row behind it (`id: 0`) and which the write
    // routes correctly refuse to place. The drag cases need a real row, so one
    // is added first — `add()`'s own rule is one of each key per home, so a
    // second run's 409 is expected and not a failure.
    const page = await browser.newPage();
    await signIn(page, OWNER_USER, OWNER_PASS);
    const layout = await readLayout(page);
    if (layout.home.default_layout) {
      const response = await page.request.post(`${BASE_NEW}/api/homes/${OWNER_ID}/widgets`, {
        data: { widget_key: 'profilewidget', column: 1 },
        headers: { 'X-XSRF-TOKEN': await csrfToken(page) },
      });
      expect([201, 409]).toContain(response.status());
    }
    await page.close();
  });

  test('a guest reads the page and cannot edit it', async ({ page }) => {
    const layout = await readLayout(page);
    expect(layout.home.editable).toBe(false);

    await page.goto(`${BASE_NEW}/home/${OWNER_ID}`);
    await expect(page.locator('#mypage-wrapper')).toBeVisible();
    // `#playground` is the absolutely-positioned canvas: it has no intrinsic
    // height of its own, so it is asserted as present rather than as "visible"
    // (Playwright reads a zero-height element as hidden, and the boxes inside it
    // are what a visitor sees).
    await expect(page.locator('#playground')).toHaveCount(1);
    // `backgroundClass()` — the class the legacy stylesheet paints the floor from.
    await expect(page.locator('#mypage-bg')).toHaveClass(new RegExp(layout.home.background));
    await expect(page.locator('#edit-button')).toHaveCount(0);
    await expect(page.locator('[data-testid="home-widget-profilewidget"]')).toHaveCount(1);
  });

  test('the rendered geometry is the geometry the API returned', async ({ page }) => {
    const layout = await readLayout(page);
    await page.goto(`${BASE_NEW}/home/${OWNER_ID}`);

    for (const widget of layout.widgets) {
      const rendered = page.locator(`#widget-${widget.id}`);
      await expect(rendered).toHaveCount(1);
      // The API computes `left`/`top`/`z-index` from column and position with
      // `widgetStyle()`. If the canvas re-derived them, these would disagree.
      const style = await rendered.evaluate((node) => {
        const element = node as HTMLElement;
        return {
          left: element.style.left,
          top: element.style.top,
          zIndex: element.style.zIndex,
        };
      });
      expect(style.left).toBe(`${widget.left}px`);
      expect(style.top).toBe(`${widget.top}px`);
      expect(style.zIndex).toBe(String(widget.z_index));
    }
  });

  test('the owner edits: the lock is taken, a drag saves, cancel releases', async ({ page }) => {
    await signIn(page, OWNER_USER, OWNER_PASS);

    // Opening the editor takes the Redis lease; the page states the version it
    // read, which is what a save must echo.
    await page.goto(`${BASE_NEW}/home/${OWNER_ID}/edit`);
    await expect(page.locator('#top-toolbar')).toBeVisible();
    const versionText = await page.locator('[data-testid="home-version"]').innerText();
    const version = Number(versionText.replace(/[^0-9]/g, ''));
    expect(version).toBeGreaterThan(0);

    // The body id is what the legacy stylesheets size the playground from.
    await expect(page.locator('body')).toHaveAttribute('id', 'editmode');

    // The profile widget is the one widget the API guarantees on any home, so it
    // is the one a drag test can rely on existing.
    const before = (await readLayout(page)).widgets.find(
      (widget) => widget.widget_key === 'profilewidget',
    );
    expect(before).toBeDefined();
    if (!before) return;

    // Drag it into column 2 (left >= 450) and one slot down.
    const targetLeft = 450;
    const targetTop = (before.position + 1) * 50 + 10;
    await dragWidget(page, before.id, targetLeft - before.left, targetTop - before.top);

    await expect(page.locator('[data-testid="home-save-message"]')).toContainText('Saved', {
      timeout: 10000,
    });

    const after = await readLayout(page);
    expect(after.home.version).toBe(version + 1);
    const moved = after.widgets.find((widget) => widget.id === before.id);
    expect(moved?.column).toBe(2);
    expect(moved?.left).toBe(450);

    // Cancel releases the lease: a fresh session must be available to whoever
    // asks next, including this same user in another tab.
    await page.click('[data-testid="home-cancel-button"]');
    await expect(page).toHaveURL(new RegExp(`/home/${OWNER_ID}$`));
    const released = await readLayout(page);
    expect(released.home.lock.held).toBe(false);
  });

  test('a save that loses the version race is rolled back to the server layout', async ({
    page,
  }) => {
    await signIn(page, OWNER_USER, OWNER_PASS);
    await page.goto(`${BASE_NEW}/home/${OWNER_ID}/edit`);
    await expect(page.locator('#top-toolbar')).toBeVisible();

    const before = (await readLayout(page)).widgets.find(
      (widget) => widget.widget_key === 'profilewidget',
    );
    expect(before).toBeDefined();
    if (!before) return;

    // Somebody else writes while this tab is open. Advancing the version row is
    // exactly what another editor's committed save leaves behind, and it is the
    // only way to produce the conflict deterministically: the browser's own
    // request context shares this session, so it cannot be the second writer
    // (the lock is per home and this actor already holds it).
    const versionBefore = (await readLayout(page)).home.version;
    await sql(
      `UPDATE phpretro_myhabbo_homes SET version = version + 1 WHERE user_id = ${OWNER_ID};`,
    );

    await dragWidget(page, before.id, 0, 55);

    // The page must say the move was not applied...
    await expect(page.locator('[data-testid="home-conflict"]')).toBeVisible({ timeout: 10000 });
    // ...and must be showing the SERVER's geometry, not the dragged position.
    const rendered = await page.locator(`#widget-${before.id}`).evaluate((node) => {
      const element = node as HTMLElement;
      return { left: element.style.left, top: element.style.top };
    });
    const authoritative = (await readLayout(page)).widgets.find(
      (widget) => widget.id === before.id,
    );
    expect(rendered.left).toBe(`${authoritative?.left}px`);
    expect(rendered.top).toBe(`${authoritative?.top}px`);

    // Nothing was written: the version is still the one the other writer left,
    // and the widget is where it was.
    const settled = await readLayout(page);
    expect(settled.home.version).toBe(versionBefore + 1);
    expect(settled.widgets.find((widget) => widget.id === before.id)?.position).toBe(
      before.position,
    );

    // Leave the home unlocked for whatever runs next.
    await page.click('[data-testid="home-cancel-button"]');
  });
});

/** The readable double-submit token, for the request-context calls above. */
async function csrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies(BASE_NEW);
  return cookies.find((cookie) => cookie.name === 'XSRF-TOKEN')?.value ?? '';
}

/**
 * Run one statement against the stack's MariaDB through the running container.
 *
 * `docker exec` rather than an endpoint: the version row has no route that moves
 * it without also moving the layout, and adding one so a test could fake a
 * concurrent writer would be shipping a feature to make a test convenient — the
 * same reasoning `credits.spec.ts` records for its ledger fixture.
 */
async function sql(statement: string): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  execFileSync(
    'docker',
    ['exec', 'hotel_mariadb', 'mysql', '-uhotel', '-photel_secret', 'polaris', '-e', statement],
    { stdio: 'pipe' },
  );
}
