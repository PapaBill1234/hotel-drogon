// Diagnostic: element-level comparison of the recovery form on both stacks.
//
// The remaining /forgot difference looked like "labels beside vs above inputs",
// but the page ships its own `label { display: block }`, so the cause has to be
// measured rather than inferred. Reports geometry, text and computed style for
// the same ids on each side.
//
//   -e BASE=http://localhost:8081 -e PLAYWRIGHT_ARGS=forgot-compare.spec.ts

import { test } from '@playwright/test';
import { envOr } from './pages';

const BASE = envOr('BASE', 'http://localhost:8081');
const TARGET = envOr('TARGET_PATH', '/forgot');

const IDS = [
  'forgottenpw-form',
  'forgottenpw-username',
  'forgottenpw-email',
  'forgottenpw-submit',
  'accountlist-form',
  'accountlist-owner-email',
  'accountlist-submit',
];

test('forgot element compare', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await context.newPage();
  p.on('dialog', (d) => void d.dismiss().catch(() => {}));
  await p.goto(BASE + TARGET, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(600);

  // eslint-disable-next-line no-console
  console.log(`=== FORGOT ELEMENTS ${BASE}${TARGET} ===`);

  for (const id of IDS) {
    const info = await p.evaluate((elId) => {
      const el = document.getElementById(elId) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // The label that precedes this field, if any.
      const prev = el.previousElementSibling as HTMLElement | null;
      const prevRect = prev ? prev.getBoundingClientRect() : null;
      return {
        rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        display: cs.display,
        width: cs.width,
        float: cs.float,
        text: (el.textContent || (el as HTMLInputElement).value || '').trim().slice(0, 40),
        prevTag: prev ? `${prev.tagName}${prev.id ? '#' + prev.id : ''}` : null,
        prevRect: prevRect
          ? `${Math.round(prevRect.x)},${Math.round(prevRect.y)} ${Math.round(prevRect.width)}x${Math.round(prevRect.height)}`
          : null,
        prevDisplay: prev ? getComputedStyle(prev).display : null,
      };
    }, id);
    // eslint-disable-next-line no-console
    console.log(
      info
        ? `#${id.padEnd(24)} ${info.rect.padEnd(22)} display=${String(info.display).padEnd(6)} ` +
            `w=${String(info.width).padEnd(8)} float=${String(info.float).padEnd(5)} ` +
            `text="${info.text}" prev=${info.prevTag}@${info.prevRect}(${info.prevDisplay})`
        : `#${id.padEnd(24)} ABSENT`,
    );
  }

  // The heading text of each box, to catch copy drift.
  const headings = await p.evaluate(() =>
    Array.from(document.querySelectorAll('h2.title')).map((h) =>
      (h.textContent || '').trim(),
    ),
  );
  // eslint-disable-next-line no-console
  console.log(`h2.title list: ${JSON.stringify(headings)}`);

  await context.close();
});
