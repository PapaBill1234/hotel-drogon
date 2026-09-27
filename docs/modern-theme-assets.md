# Modern theme reference assets

Status: **captured locally, deliberately not in this repository.** This file
records what was taken, where it lives, how to reproduce it, and the licensing
decision that has to be made before any of it is shipped.

## What was captured

`tools/modern-theme/fetch-assets.mjs` mirrors the reference site's front-end into
a directory **outside** the repository (`../modern-assets` by default):

| | |
| --- | --- |
| Files | 55 |
| Size | 3.8 MB |
| Stylesheet | `app.d6ee7c02.css` (253 KB) |
| Scripts | `vendor.2760a1d4.js` (707 KB), `scripts.f34a8c32.js` (1.19 MB) |
| Images | 26 PNG (sprites, teasers, shop price tags) |
| Fonts | 19 woff2 + 1 woff (Ubuntu / Ubuntu Condensed) |
| Pages | the home page, `/community` and `/shop` HTML |

Reproduce with:

```sh
node tools/modern-theme/fetch-assets.mjs --out ../modern-assets
```

The script reads `tools/modern-theme/assets.manifest.json`, fetches each page and
its named bundles, then follows every asset those reference (`url(...)` in CSS,
`src`/`href` in HTML) breadth-first. It writes a `manifest.lock.json` beside the
mirror recording, per URL: local path, byte count, sha256, content type. Re-runs
are idempotent — a file whose hash already matches is kept, not re-downloaded —
and anything already present on disk is verified by hash rather than trusted.
It refuses to write inside the repository, which is the one mistake that would
turn a local mirror into a redistribution.

## Why it is not committed

These are Sulake's assets, not ours: the site's own footer reads "HABBO is a
registered trademark of Sulake Corporation. All rights reserved to their
respective owner(s)." Plan v3 requires file-level provenance, licensing and
redistribution rights to be established **before** an asset is imported, and the
plan's rule 9 makes an unapproved source a stop rather than a convenience.

The repository already solves this exact problem for the legacy theme, and the
modern theme follows the same pattern: the legacy `web-gallery` CSS and imagery
are **not** committed either — `compose.yaml` mounts them read-only from a
sibling checkout, CI fetches them into position, `legacy/` is gitignored, and the
inventory records redistribution rights as unresolved. What the repository keeps
is the script, the seed manifest and the lock file: enough to reproduce the
mirror anywhere, nothing that redistributes it.

## What the modern theme will actually do with it

**Yes — it gets ported into React; the reference JavaScript is never shipped.**
The captured bundles are an AngularJS application (`ng-click`, `ng-hide`,
`ng-animate` and `habbo-tabs` element hooks are all over `app.d6ee7c02.css`), and
plan v3 is explicit that the second theme is a React implementation of the
*appearance*, not the upstream application running beside ours. Concretely:

1. **The CSS is the specification.** Class names, spacing, breakpoints, colour
   tokens and sprites are read out of `app.d6ee7c02.css` and re-expressed as a
   scoped stylesheet for the React components — the same way the legacy theme
   reuses `web-gallery/v2/styles/*.css` verbatim, except that legacy CSS can be
   linked as-is and this one cannot be (see the licensing gate below).
2. **The markup shapes are read from the captured HTML**, per page.
3. **The typed contracts already exist** (`frontend/src/types/cms.ts`,
   `docs/modular-cms-contracts.md`): `ThemeId = 'legacy' | 'modern'`, a
   `ThemeDescriptor` with a published revision, and page slots whose blocks are
   an allow-listed union — so "switch theme in housekeeping" is a revision change
   against a closed set, never a code deploy and never a game-database change.
4. **Baselines are captured per theme.** Plan v3 unit 3 requires a measured
   page-by-page comparison in both themes, so the existing pinned-image parity
   harness (`tests/e2e/visual-parity.spec.ts` and the `docs/reference-screenshots`
   baselines) gains a second set rather than the first set being reinterpreted.

## The gate this does not pass yet

**Redistribution rights for the captured assets are unresolved.** Three ways
forward, and this is the operator's call, not the implementer's:

| Option | What it means | Consequence |
| --- | --- | --- |
| **A. Local mirror only** (the legacy pattern) | assets stay outside git; the modern theme's stylesheet is *derived* by hand into our own React CSS, and the mirror is only ever a design reference | safe to proceed now; the port is more work and cannot ship their fonts or sprites |
| **B. Licensed open-source source** | build the modern look from a source whose licence permits redistribution — plan v3 names Chocolatey (GPL-3.0 / Apache-2.0, file-level review still required) | needs the licence review plan v3 already asks for; assets can be committed |
| **C. Operator accepts habbo.com assets** | vendor the captured CSS/images/fonts directly and ship them | a rights decision this repository cannot make for the operator; the trademark footer and any takedown risk move to the operator |

Until one is chosen, the work that is safe under all three proceeds: the
contracts, the theme switch mechanics, and reading the appearance out of the
captured files. The one thing that must not happen quietly is committing the
mirror.
