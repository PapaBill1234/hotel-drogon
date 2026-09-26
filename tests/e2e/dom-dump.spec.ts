// Diagnostic: report the geometry of the /community "Random Habbos" widget.
//
// Not a test -- it asserts nothing. It exists because two rounds of this work
// were spent inferring layout from screenshots when the computed geometry
// answers the question directly. Point it at either app and compare:
//
//   docker run --rm -i --network host \
//     -v "<repo>:/repo:ro" -v "<repo>/tests/e2e/.out:/out" \
//     -e BASE_NEW=http://localhost:3000 \
//     -e PLAYWRIGHT_ARGS=dom-dump.spec.ts \
//     mcr.microsoft.com/playwright:v1.63.0-noble bash /repo/tests/e2e/run-in-container.sh
//
//   # same against the legacy stack
//   -e BASE_NEW=http://localhost:8081
//
// `elementFromPoint` is the load-bearing line: it reports which element is
// actually painted at the point where the habbo_skeleton.gif appeared, which
// distinguishes "the placeholder is visible" from "something else covers it".

import { test } from '@playwright/test';
import { envOr } from './pages';
import { VIEWPORT } from './playwright.config';

const BASE_NEW = envOr('BASE_NEW', 'http://localhost:3000');
const TARGET = envOr('TARGET_PATH', '/community');

test('dom dump', async ({ browser }) => {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const p = await context.newPage();
  await p.goto(BASE_NEW + TARGET, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(400);

  const report = await p.evaluate(() => {
    const describe = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return `${sel}: (absent)`;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return (
        `${sel}: rect=${Math.round(r.x)},${Math.round(r.y)} ` +
        `${Math.round(r.width)}x${Math.round(r.height)} ` +
        `pos=${cs.position} z=${cs.zIndex} overflow=${cs.overflow} ` +
        `vis=${cs.visibility} disp=${cs.display}`
      );
    };
    const container = document.querySelector<HTMLElement>('#homes-habblet-list-container');
    const placeholders = document.querySelectorAll('.active-habbo-image-placeholder');
    const first = placeholders[0] as HTMLElement | undefined;

    // Which element actually sits at the point where the skeleton rendered?
    const hit = document.elementFromPoint(180, 590);
    const hitDesc = hit ? `${hit.tagName}#${hit.id}.${hit.className}` : '(nothing)';

    return [
      describe('.cbb.activehomes'),
      describe('#homes-habblet-list-container'),
      describe('.active-habbo-imagemap'),
      describe('#placeholder-container'),
      describe('#active-habbo-image-placeholder-0'),
      `placeholder count: ${placeholders.length}`,
      `first placeholder parent: ${first?.parentElement?.id || first?.parentElement?.className}`,
      `first placeholder inline style: ${first?.getAttribute('style') ?? '(none)'}`,
      `elementFromPoint(180,590): ${hitDesc}`,
      `container style attr: ${container?.getAttribute('style') ?? '(none)'}`,
    ];
  });

  // eslint-disable-next-line no-console
  console.log(`=== RANDOM HABBOS GEOMETRY (${BASE_NEW}${TARGET}) ===`);
  for (const line of report) {
    // eslint-disable-next-line no-console
    console.log(line);
  }

  await context.close();
});
