import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { PAGES, envOr } from './pages';
import { BASELINE_DIR, VIEWPORT } from './playwright.config';

// Report the pixel ratio for every page that has a committed legacy baseline,
// as a NUMBER, so two builds can be compared instead of merely "pass/fail".
//
//   BASE_NEW=http://127.0.0.1:3204 SCORE_LABEL=rounder-on \
//     npx playwright test parity-score.spec.ts
//
// `visual-parity.spec.ts` answers "is this page within the 2% budget". That is
// the right gate, but it cannot answer "did this change make the page better or
// worse" — a build that moves a page from 0.2% to 1.9% still passes, and a build
// that moves it from 2.1% to 2.0% still fails. Both questions came up while
// fixing the Rounder/DOM-ownership defect, so this measures the ratio directly.
//
// Masks are applied exactly as `visual-parity.spec.ts` applies them, otherwise
// the two harnesses would disagree about the same page. The PNG decode is the
// same decoder `audit-diff.spec.ts` uses, for the same reason: the parity config
// rewrites any path handed to `toHaveScreenshot`.

const BASE_NEW = envOr('BASE_NEW', 'http://127.0.0.1:3204');
const LABEL = process.env.SCORE_LABEL ?? 'run';
const baselineDir = path.resolve(__dirname, BASELINE_DIR);
const OUT = path.resolve(__dirname, `.out/scores/${LABEL}`);

interface Decoded {
  width: number;
  height: number;
  rgba: Uint8Array;
}

function decodePng(buf: Buffer): Decoded {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNG unsupported');
  if (colorType !== 6 && colorType !== 2) throw new Error(`unsupported color type ${colorType}`);

  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);

  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  let rawPos = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[rawPos++];
    for (let i = 0; i < stride; i++) {
      const x = raw[rawPos + i];
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter}`);
      }
      line[i] = v & 0xff;
    }
    rawPos += stride;

    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = line[s];
      out[d + 1] = line[s + 1];
      out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    prev.set(line);
  }

  return { width, height, rgba: out };
}

const rows: { name: string; ratio: number; detail: string }[] = [];

test.describe.configure({ mode: 'serial' });

for (const page of PAGES) {
  const baseline = path.join(baselineDir, `${page.name}.png`);
  test.skip(!fs.existsSync(baseline), `no baseline for ${page.name}`);

  test(`score: ${page.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const p = await context.newPage();

    await p.goto(BASE_NEW + page.newPath, { waitUntil: 'networkidle' });
    await p.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('link[rel="stylesheet"]')).every(
          (l) => (l as HTMLLinkElement).sheet !== null,
        ),
      undefined,
      { timeout: 10_000 },
    );
    await p.evaluate(() => document.fonts.ready);

    for (const sel of page.mask) {
      await p.locator(sel).evaluateAll((els) =>
        els.forEach((el) => ((el as HTMLElement).style.visibility = 'hidden')),
      );
    }
    await p.waitForTimeout(300);

    fs.mkdirSync(OUT, { recursive: true });
    await p.screenshot({ path: path.join(OUT, `${page.name}.png`) });

    const a = decodePng(fs.readFileSync(baseline));
    const b = decodePng(fs.readFileSync(path.join(OUT, `${page.name}.png`)));

    let row: { name: string; ratio: number; detail: string };
    if (a.width !== b.width || a.height !== b.height) {
      row = {
        name: page.name,
        ratio: 1,
        detail: `size differs: baseline ${a.width}x${a.height} vs new ${b.width}x${b.height}`,
      };
    } else {
      let diff = 0;
      const total = a.width * a.height;
      for (let i = 0; i < total; i++) {
        const o = i * 4;
        if (
          a.rgba[o] !== b.rgba[o] ||
          a.rgba[o + 1] !== b.rgba[o + 1] ||
          a.rgba[o + 2] !== b.rgba[o + 2]
        ) {
          diff++;
        }
      }
      row = {
        name: page.name,
        ratio: diff / total,
        detail: diff === 0 ? 'identical' : `${diff} px differ`,
      };
    }

    rows.push(row);
    // eslint-disable-next-line no-console
    console.log(`[score:${LABEL}] ${row.name.padEnd(16)} ${(row.ratio * 100).toFixed(2)}%  ${row.detail}`);

    await context.close();
  });
}

test.afterAll(() => {
  if (!rows.length) return;
  fs.mkdirSync(OUT, { recursive: true });
  const sorted = [...rows].sort((x, y) => y.ratio - x.ratio);
  fs.writeFileSync(
    path.join(OUT, 'score.md'),
    [
      `# Parity score: ${LABEL}`,
      '',
      `BASE_NEW=${BASE_NEW}`,
      '',
      '| page | differing | detail |',
      '| --- | --- | --- |',
      ...sorted.map((r) => `| ${r.name} | ${(r.ratio * 100).toFixed(2)}% | ${r.detail} |`),
      '',
    ].join('\n'),
  );
  // eslint-disable-next-line no-console
  console.log(`[score:${LABEL}] wrote ${path.join(OUT, 'score.md')}`);
});
