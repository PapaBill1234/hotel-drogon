// Diagnostic: why does the legacy /forgot screenshot show the community page?
//
// The raw HTML from curl contains `forgottenpw-form`, `process-template` and a
// `#process-content` container, but the Playwright capture renders something
// else entirely. This reports what the browser actually ends up with, so the
// difference is attributed rather than guessed at.
//
//   -e BASE_NEW=http://localhost:8081 -e TARGET_PATH=/forgot

import { test } from '@playwright/test';
import { envOr } from './pages';

const BASE_NEW = envOr('BASE_NEW', 'http://localhost:8081');
const TARGET = envOr('TARGET_PATH', '/forgot');

test('page debug', async ({ browser }) => {
  const context = await browser.newContext();
  const p = await context.newPage();

  const resp = await p.goto(BASE_NEW + TARGET, { waitUntil: 'load' });
  await p.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log(`=== DEBUG ${BASE_NEW}${TARGET} ===`);
  // eslint-disable-next-line no-console
  console.log(`status=${resp?.status()} finalUrl=${p.url()}`);

  const info = await p.evaluate(() => {
    const out: string[] = [];
    out.push(`body.className=${JSON.stringify(document.body.className)}`);
    out.push(`body.innerHTML length=${document.body.innerHTML.length}`);

    for (const id of ['forgottenpw-form', 'process-content', 'overlay', 'container']) {
      const el = document.getElementById(id);
      if (!el) {
        out.push(`#${id}: ABSENT`);
        continue;
      }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out.push(
        `#${id}: rect=${Math.round(r.x)},${Math.round(r.y)} ` +
          `${Math.round(r.width)}x${Math.round(r.height)} ` +
          `display=${cs.display} visibility=${cs.visibility} opacity=${cs.opacity} z=${cs.zIndex}`,
      );
    }

    // What is painted at the centre of the viewport?
    const hit = document.elementFromPoint(500, 300);
    out.push(`elementFromPoint(500,300)=${hit ? `${hit.tagName}#${hit.id}.${hit.className}` : 'null'}`);
    return out;
  });

  for (const line of info) {
    // eslint-disable-next-line no-console
    console.log(line);
  }

  const text = ((await p.locator('body').innerText().catch(() => '')) ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
  // eslint-disable-next-line no-console
  console.log(`visible text: "${text}"`);

  await context.close();
});
