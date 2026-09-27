// Diagnostic: character-level dump of the recovery headings.
//
// "Forgotten Your  Name?" reads as if `${shortname}` interpolated empty, but the
// settings endpoint returns it and the same hook resolves it in ProcessShell. A
// zero-width or non-breaking character would look identical in textContent, so
// this reports the exact code points.
//
//   -e BASE_NEW=http://localhost:3000 -e PLAYWRIGHT_ARGS=forgot-chars.spec.ts

import { test } from '@playwright/test';
import { envOr } from './pages';

const BASE = envOr('BASE_NEW', 'http://localhost:3000');

test('forgot chars', async ({ browser }) => {
  const context = await browser.newContext();
  const p = await context.newPage();
  await p.goto(BASE + '/forgot', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);

  const out = await p.evaluate(() => {
    const results: string[] = [];
    document.querySelectorAll('h2.title').forEach((h, i) => {
      const text = h.textContent ?? '';
      const codes = Array.from(text)
        .map((c) => `${c}(${c.codePointAt(0)?.toString(16)})`)
        .join(' ');
      results.push(`h2[${i}] len=${text.length} :: ${codes}`);
      // The child nodes show how React split the interpolation.
      results.push(
        `h2[${i}] childNodes: ${JSON.stringify(
          Array.from(h.childNodes).map((n) => `${n.nodeType}:${n.nodeValue ?? ''}`),
        )}`,
      );
    });
    return results;
  });

  // eslint-disable-next-line no-console
  console.log(`=== FORGOT CHARS ${BASE} ===`);
  for (const line of out) {
    // eslint-disable-next-line no-console
    console.log(line);
  }

  await context.close();
});
