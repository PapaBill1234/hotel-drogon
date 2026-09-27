#!/usr/bin/env node
/**
 * Capture the modern-theme reference assets (habbo.com) into a local mirror.
 *
 * ## Why this is a fetch script and not a folder of committed files
 *
 * The reference site's CSS, JavaScript, images and fonts are Sulake's
 * proprietary material — the site's own footer says "HABBO is a registered
 * trademark of Sulake Corporation. All rights reserved." Plan v3 requires
 * provenance, licensing and redistribution rights to be verified **before** any
 * asset is imported, so nothing here is committed to the repository. This script
 * mirrors them into a directory *outside* the repo, exactly the way the legacy
 * `web-gallery` assets already work: `compose.yaml` mounts them read-only from a
 * sibling checkout and CI fetches them, and `legacy/` is gitignored.
 *
 * The repository keeps only this script, the seed manifest and the resulting
 * lock file — enough to reproduce the mirror on any machine, and nothing that
 * redistributes someone else's assets.
 *
 * ## What it captures
 *
 *   1. every entry in `assets.manifest.json` (per page: stylesheets, scripts),
 *   2. every asset those reference — `url(...)` in CSS, `src`/`href` in HTML —
 *      resolved against the referring file and queued breadth-first,
 *   3. a `manifest.lock.json` recording, per URL: local path, byte count, sha256
 *      and content type.
 *
 * Re-running is idempotent: a file whose hash already matches is not downloaded
 * again. Nothing is fetched from anywhere except the hosts named in the seed
 * manifest, and the script refuses to write inside the repository.
 *
 * Usage:
 *   node tools/modern-theme/fetch-assets.mjs [--out DIR] [--page NAME]... [--dry-run]
 *
 * Exit codes: 0 captured (or already present), 1 refused/failed.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

// ---- arguments -------------------------------------------------------------
const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}
const outDir = resolve(argValue('--out', join(repoRoot, '..', 'modern-assets')));
const dryRun = args.includes('--dry-run');
const onlyPages = args.reduce((acc, arg, i) => {
  if (arg === '--page' && args[i + 1]) acc.push(args[i + 1]);
  return acc;
}, []);

// The mirror must never land inside the repository: a fetch that writes into the
// working tree is one `git add -A` away from redistributing the assets.
if (outDir === repoRoot || outDir.startsWith(repoRoot + sep)) {
  console.error(
    `refusing to write inside the repository (${outDir}).\n` +
      `Use --out to point at a directory outside it, e.g. ${join(repoRoot, '..', 'modern-assets')}`,
  );
  process.exit(1);
}

const seed = JSON.parse(readFileSync(join(here, 'assets.manifest.json'), 'utf8'));
const allowedHosts = new Set(seed.allowedHosts);

// ---- capture ---------------------------------------------------------------
const lock = [];
const seen = new Map(); // url -> local path
const queue = [];
let failures = 0;

function localPathFor(url) {
  const parsed = new URL(url);
  let clean = parsed.pathname.replace(/^\/+/, '');
  // A directory-shaped URL (`/`, `/community/`) must become a FILE, or the
  // first one written occupies the name the next one needs as a directory.
  if (clean === '' || clean.endsWith('/')) clean += 'index.html';
  // The CDN already namespaces by locale; keep the path shape so a stylesheet's
  // relative references still resolve if the mirror is ever served statically.
  return join(outDir, parsed.host, clean);
}

function enqueue(url, referrer) {
  if (!url || seen.has(url)) return;
  let parsed;
  try {
    parsed = new URL(url, referrer);
  } catch {
    return;
  }
  if (parsed.protocol !== 'https:') return;
  if (!allowedHosts.has(parsed.host)) return;
  parsed.hash = '';
  const key = parsed.toString();
  if (seen.has(key)) return;
  seen.set(key, localPathFor(key));
  queue.push({ url: key, referrer });
}

/** Every asset reference in a stylesheet, resolved against its own URL. */
function cssReferences(text, baseUrl) {
  const found = [];
  for (const match of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    found.push(match[1]);
  }
  // `@import url(...)` is already covered; bare `@import "..."` is not.
  for (const match of text.matchAll(/@import\s+['"]([^'"]+)['"]/g)) found.push(match[1]);
  return found.map((ref) => new URL(ref, baseUrl).toString());
}

/** Every stylesheet, script and image reference in a page. */
function htmlReferences(text, baseUrl) {
  const found = [];
  for (const match of text.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)) found.push(match[1]);
  for (const match of text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) found.push(match[1]);
  for (const match of text.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) found.push(match[1]);
  for (const match of text.matchAll(/<source[^>]+srcset=["']([^"'\s]+)/gi)) found.push(match[1]);
  return found.map((ref) => new URL(ref, baseUrl).toString());
}

async function capture({ url, referrer }) {
  const target = seen.get(url) ?? localPathFor(url);
  let response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'hotel-drogon theme reference capture (local development)' },
    });
  } catch (error) {
    console.error(`  FAIL  ${url} — ${error.message}`);
    failures += 1;
    return;
  }
  if (!response.ok) {
    console.error(`  FAIL  ${url} — HTTP ${response.status}`);
    failures += 1;
    return;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const contentType = response.headers.get('content-type') ?? '';

  // Idempotent: an identical file already on disk is left alone.
  let status = 'fetched';
  if (existsSync(target) && statSync(target).isFile()) {
    const existing = createHash('sha256').update(readFileSync(target)).digest('hex');
    if (existing === sha256) status = 'present';
  }
  if (!dryRun && status === 'fetched') {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, buffer);
  }
  console.log(`  ${status === 'present' ? 'KEEP ' : 'SAVE '} ${url} (${buffer.length} bytes)`);

  lock.push({ url, path: target, bytes: buffer.length, sha256, contentType, status, referrer: referrer ?? null });

  const text = /text\/css|javascript|text\/html/.test(contentType) ? buffer.toString('utf8') : '';
  if (contentType.includes('text/css')) {
    for (const ref of cssReferences(text, url)) enqueue(ref, url);
  } else if (contentType.includes('text/html')) {
    for (const ref of htmlReferences(text, url)) enqueue(ref, url);
  }
}

const pages = seed.pages.filter((page) => onlyPages.length === 0 || onlyPages.includes(page.name));

console.log(`Capturing modern-theme reference assets into ${outDir}`);
if (dryRun) console.log('(dry run: nothing will be written)');
console.log(`Allowed hosts: ${[...allowedHosts].join(', ')}`);
console.log('');

for (const page of pages) {
  console.log(`[${page.name}] ${page.url}`);
  enqueue(page.url, undefined);
  for (const asset of page.assets ?? []) enqueue(asset, page.url);
}

while (queue.length > 0) {
  await capture(queue.shift());
}

if (!dryRun) {
  mkdirSync(outDir, { recursive: true });
  const lockPath = join(outDir, 'manifest.lock.json');
  writeFileSync(
    lockPath,
    `${JSON.stringify(
      {
        note:
          'Mirror of third-party reference assets for local theme development. ' +
          'Not redistributable: see docs/modern-theme-assets.md before committing any of it.',
        capturedAt: new Date().toISOString(),
        entries: lock,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nLock file: ${lockPath}`);
}

const unique = new Set(lock.map((entry) => entry.url)).size;
console.log(`\n${unique} URLs, ${lock.filter((e) => e.status === 'fetched').length} written, ${failures} failed.`);
process.exit(failures > 0 ? 1 : 0);
