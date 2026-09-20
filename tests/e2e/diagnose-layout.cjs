const { chromium } = require('@playwright/test');

// Usage: node diagnose-layout.cjs [path] [selectors,csv]
//
// Compares element bounding boxes between the legacy app (localhost:8081) and
// the new React app (localhost:3000) at the harness viewport, turning
// "N% of pixels differ" into a concrete list of layout differences.
//
// Both apps must be running with matching data; see tools/legacy-stack/README.md
// for the settings that change which template each side renders.
const path = process.argv[2] || '/help';
const SELS = (
  process.argv[3] ||
  '#header,#subnavi,#habbos-online,#container,#content,#column1,#column3,#footer'
).split(',');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const measure = async (base) => {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    const out = {};
    for (const s of SELS) {
      const el = page.locator(s).first();
      if (await el.count()) {
        const b = await el.boundingBox();
        out[s] = b
          ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]
          : null;
      } else {
        out[s] = 'ABSENT';
      }
    }
    out['__body'] = await page.evaluate(() => ({
      id: document.body.id,
      cls: document.body.className,
      scrollH: document.body.scrollHeight,
    }));
    return out;
  };

  const legacy = await measure('http://localhost:8081');
  const modern = await measure('http://localhost:3000');

  console.log(`===== ${path} =====`);
  for (const s of SELS) {
    const l = JSON.stringify(legacy[s]);
    const m = JSON.stringify(modern[s]);
    console.log(`${l === m ? 'ok  ' : 'DIFF'} ${s.padEnd(22)} legacy=${l.padEnd(26)} new=${m}`);
  }
  console.log(`body legacy=${JSON.stringify(legacy['__body'])}`);
  console.log(`body new   =${JSON.stringify(modern['__body'])}`);

  await browser.close();
})();
