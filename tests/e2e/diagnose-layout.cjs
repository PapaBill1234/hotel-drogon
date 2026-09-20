const { chromium } = require('@playwright/test');

const SELS = ['#header', '#subnavi', '#subnavi-user', '#subnavi-login', '#habbos-online',
              '#container', '#content', '#column1', '#column3', '#footer', '.cbb'];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const measure = async (base, path) => {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    const out = {};
    for (const s of SELS) {
      const el = page.locator(s).first();
      if (await el.count()) {
        const b = await el.boundingBox();
        out[s] = b ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] : null;
      } else {
        out[s] = 'ABSENT';
      }
    }
    // page height and body attributes
    out['__body'] = await page.evaluate(() => ({
      id: document.body.id, cls: document.body.className,
      scrollH: document.body.scrollHeight, docH: document.documentElement.scrollHeight,
    }));
    return out;
  };

  for (const path of ['/help', '/articles']) {
    const legacy = await measure('http://localhost:8081', path);
    const modern = await measure('http://localhost:3000', path);
    console.log(`\n===== ${path} =====`);
    for (const s of SELS) {
      const l = JSON.stringify(legacy[s]);
      const m = JSON.stringify(modern[s]);
      console.log(`${(l === m ? 'ok  ' : 'DIFF')} ${s.padEnd(18)} legacy=${l.padEnd(26)} new=${m}`);
    }
    console.log(`body legacy=${JSON.stringify(legacy['__body'])}`);
    console.log(`body new   =${JSON.stringify(modern['__body'])}`);
  }

  await browser.close();
})();
