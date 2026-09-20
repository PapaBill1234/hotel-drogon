const { chromium } = require('@playwright/test');

// Text-level comparison of the main content columns on both apps.
const SELS = process.argv[3] ? process.argv[3].split(',') : ['#column1', '#column2'];

(async () => {
  const path = process.argv[2] || '/credits/collectables';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const grab = async (base) => {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    const out = {};
    for (const s of SELS) {
      const el = page.locator(s).first();
      out[s] = (await el.count())
        ? (await el.evaluate((n) => n.innerText)).replace(/\s+/g, ' ').trim()
        : 'ABSENT';
    }
    return out;
  };

  const legacy = await grab('http://localhost:8081');
  const modern = await grab('http://localhost:3000');

  for (const s of SELS) {
    console.log(`\n########## ${s} ##########`);
    console.log(`LEGACY: ${legacy[s]}`);
    console.log(`NEW   : ${modern[s]}`);
    console.log(`SAME  : ${legacy[s] === modern[s]}`);
  }
  await browser.close();
})();
