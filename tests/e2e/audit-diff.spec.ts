import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

// Measure the pixel difference between the two sides captured by `audit.spec.ts`.
//
//   AUDIT_OUT=/out/audit npx playwright test audit-diff.spec.ts
//
// `audit.spec.ts` writes `<name>--legacy.png` and `<name>--new.png`. This turns
// each pair into a NUMBER, so the audit report can be ranked by how wrong a page
// is rather than by how it looked to whoever opened the images.
//
// ## Why this decodes PNGs itself
//
// The obvious implementation is `expect(page).toHaveScreenshot(legacyPng)`, but
// `playwright.config.ts` sets `snapshotPathTemplate` to the committed baselines
// directory, which rewrites any path given to it (an absolute `/out/audit/x.png`
// came back as `docs/reference-screenshots/baseline/-out-audit-x.png`). Decoding
// directly avoids depending on that config at all, and it reports per-pixel
// differences rather than a black-box ratio.
//
// Scope: the 8-bit PNGs Chromium writes for these captures. Anything else
// (16-bit, palette, interlaced) is reported as "unsupported" for that page
// instead of being silently scored as identical — a wrong "identical" is the one
// result that would make this audit lie.

const OUT = process.env.AUDIT_OUT ?? path.resolve(__dirname, '.out/audit');

interface Decoded {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
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
  if (colorType !== 6 && colorType !== 2) {
    throw new Error(`unsupported color type ${colorType}`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);

  // Undo the per-scanline filters (PNG spec 9.2).
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

interface Row {
  name: string;
  ratio: number;
  detail: string;
}

const rows: Row[] = [];

function comparable(): string[] {
  if (!fs.existsSync(OUT)) return [];
  const names = new Set<string>();
  for (const f of fs.readdirSync(OUT)) {
    const m = /^(.*)--legacy\.png$/.exec(f);
    if (m) names.add(m[1]);
  }
  return [...names]
    .filter((n) => fs.existsSync(path.join(OUT, `${n}--new.png`)))
    .sort();
}

test.describe.configure({ mode: 'serial' });

for (const name of comparable()) {
  test(`diff: ${name}`, async () => {
    const a = decodePng(fs.readFileSync(path.join(OUT, `${name}--legacy.png`)));
    const b = decodePng(fs.readFileSync(path.join(OUT, `${name}--new.png`)));

    let row: Row;
    if (a.width !== b.width || a.height !== b.height) {
      row = {
        name,
        ratio: 1,
        detail: `size differs: legacy ${a.width}x${a.height} vs new ${b.width}x${b.height}`,
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
        name,
        ratio: diff / total,
        detail: diff === 0 ? 'identical' : `${diff} px differ`,
      };
    }

    rows.push(row);
    console.log(`[diff] ${name.padEnd(22)} ratio=${row.ratio.toFixed(4)}  ${row.detail}`);
  });
}

test.afterAll(() => {
  if (!rows.length) return;
  rows.sort((x, y) => y.ratio - x.ratio);
  const lines = [
    '# Pixel difference: legacy vs new',
    '',
    'Ranked worst first. `ratio` is the fraction of the frame whose RGB differs,',
    'computed by decoding both captures written by `audit.spec.ts`.',
    '',
    '| page | differing | detail |',
    '| --- | --- | --- |',
  ];
  for (const r of rows) {
    lines.push(`| ${r.name} | ${(r.ratio * 100).toFixed(2)}% | ${r.detail} |`);
  }
  lines.push('');
  fs.writeFileSync(path.join(OUT, 'diff.md'), lines.join('\n'));
  console.log(`\n[diff] wrote ${path.join(OUT, 'diff.md')}`);
});
