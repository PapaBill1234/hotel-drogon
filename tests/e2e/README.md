# Playwright harness (Phase 4)

Four suites live here: one that captures legacy reference baselines, one that
compares the converted public pages against them, and one that drives the
converted housekeeping (admin) panel end to end.

## 1. Visual parity — status: 6/6 pages passing

`visual-parity.spec.ts` compares all six converted public pages against
baselines captured from a real legacy stack, within a 2% pixel tolerance. All
six pass.

```sh
BASE_NEW=http://localhost:3000 npm run test:visual   # 6 passed
```

Baselines live in `../../docs/reference-screenshots/baseline/` and are committed.
To re-capture them, bring up `tools/legacy-stack/` and run `npm run capture`.

### Two preconditions

1. **Identical content on both sides.** Fixtures come from
   `tools/legacy-stack/init/99-seed.sql` and are applied to both databases.
   Differing data shows up as a markup diff. Note the admin smoke suite creates
   banners and does not clean up after itself — clear `phpretro_banners` before
   running parity, or the new app renders ad slots legacy has no rows for.
2. **`maintenance` needs `site_closed=1` on both apps.** Legacy redirects to `/`
   while the site is open, so its baseline can only be captured closed. The
   comparison itself runs against captured PNGs, so flipping the flag does not
   affect the other five pages.

The admin UI suite (`admin.spec.ts`) deletes everything it creates, so it does
not need that cleanup step; it asserts the removal rather than just the success
notice, precisely because a leftover banner would change the public markup the
baselines were captured against.

## 2. Admin UI flow — the Phase 4 exit condition

`admin.spec.ts` proves staff can manage content **through the admin UI**, which
is the half of the Phase 4 exit condition the API-only smoke suite could not
cover.

```sh
PLAYWRIGHT_ADMIN=1 npx playwright test admin.spec.ts   # 9 passed
# PowerShell: $env:PLAYWRIGHT_ADMIN='1'; npx playwright test admin.spec.ts
```

It is gated on `PLAYWRIGHT_ADMIN=1` so a bare `npx playwright test` keeps
exactly its previous meaning (the six parity tests) on machines with no stack
running. What it covers:

| # | Assertion |
| --- | --- |
| 1 | an anonymous visitor sees the staff gate, not panel content |
| 2 | a rank-1 account is refused with the rank requirement named |
| 3 | a wrong password is refused |
| 4 | successful sign-in yields **both** cookies (`hotel_session` *and* `hotel_staff_session`) |
| 5 | create → edit → per-field validation error → delete a news article through the forms |
| 6 | a mutation stripped of `X-XSRF-TOKEN` is refused with 403 |
| 7 | raw-HTML banner content shows the high-trust warning before submit, is written, and never renders as markup |
| 8 | settings list existing keys and save a change, then restore it |
| 9 | logout returns to the gate |

Fixtures: `admin` / `password123` (rank 7) and `testuser` / `password123`
(rank 1), both seeded by `src/main.cpp`.

## Diagnostics

Two scripts make failures tractable — a bare "N% of pixels differ" is not
actionable:

```sh
node diagnose-layout.cjs /help '#header,#column1,#footer'   # bounding-box diff
node diff-text.cjs /credits/collectables '#column1,#column2' # text diff
```

Both compare the live legacy app (8081) against the new app (3000), so both must
be running with matching content for the output to mean anything.


## Why the existing screenshots are not baselines

`../../docs/reference-screenshots/*.png` are hand-taken captures of the legacy
site. They are useful as **design references** but are not valid comparison
baselines:

- window widths range 658–1312px, so framing differs per image;
- several include browser chrome, and some include the Windows taskbar;
- none uses a fixed viewport, so text wrapping is not reproducible;
- device scale factor is unknown.

A tolerance diff against them fails on framing alone, before any markup
difference is considered. Baselines must be captured by this harness at the
single fixed `VIEWPORT` (1280×800, scale factor 1, scrollbars hidden).

## Capturing baselines

Requires a running legacy stack (the reviewed instance was XAMPP serving
`C:\xampp\htdocs\PHPRetro-PDO` on port 80, with MySQL and the legacy schema
applied). From this directory:

```sh
npm install
npx playwright install chromium

BASE_LEGACY=http://127.0.0.1 npm run capture
```

That writes `../../docs/reference-screenshots/baseline/<page>.png`.

The capture spec refuses to save a baseline when the legacy app returns >= 400
or an empty body, so a misconfigured URL fails loudly instead of silently
writing blank baselines that everything would later "pass" against.

## Running the comparison

```sh
BASE_NEW=http://localhost:3000 npm run test:visual
```

Failures write expected/actual/diff images into `test-results/`.

## Dynamic content is masked

Live counters, timestamps and randomised widgets cannot match across runs and
would otherwise dominate every diff. `pages.ts` lists per-page mask selectors
(online counts, `.newsitem-date`, the collectables countdown, the randomised
habbo map). Anything that legitimately differs between the two apps is recorded
as `knownDivergence` on that page rather than silently excluded.

## Known divergences

| Page | Divergence |
| --- | --- |
| `community` | Legacy orders featured rooms by live occupancy and selects habbos with `ORDER BY RAND()`; the new API serves neither yet. |
| `maintenance` | Both apps must be captured with `site_closed=1`. Legacy redirects to `/` when `site_closed=0`, so the baseline is otherwise the front page. |
