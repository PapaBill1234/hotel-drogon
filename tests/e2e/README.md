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

### Data preconditions (both are wired into CI)

1. **The shared content fixtures must be applied to the NEW app too.** The
   legacy stack imports `tools/legacy-stack/init/99-seed.sql` at database init;
   the Drogon app has no equivalent hook, so a fresh database starts with empty
   `phpretro_news`, `phpretro_faq` and `phpretro_collectibles`. Comparing a
   seeded legacy baseline against an empty new app fails on content, not markup.
   CI therefore pipes that same file into the new app's MariaDB, and clears
   `phpretro_banners` afterwards — the admin smoke suite runs earlier in the same
   job and creates banners it does not delete, while the baselines have none.
2. **`maintenance` needs `site_closed=1` on the NEW app.** Legacy redirects to
   `/` while the site is open, so its baseline could only be captured closed, and
   the comparison needs the same state. The seed above restores `site_closed` to
   `'0'`, so CI sets it back to `'1'` before running this suite. The comparison
   itself is against captured PNGs, so the flag does not affect the other five
   pages.

Locally, reproduce all three steps with:

```sh
get-content tools/legacy-stack/init/99-seed.sql -raw | docker exec -i hotel_mariadb mysql -uhotel -photel_secret polaris
docker exec hotel_mariadb mysql -uhotel -photel_secret polaris -e "DELETE FROM phpretro_banners;"
docker exec hotel_mariadb mysql -uhotel -photel_secret polaris -e "UPDATE phpretro_site_settings SET setting_value='1' WHERE setting_key='site_closed';"
```

The admin UI suite (`admin.spec.ts`) deletes everything it creates and asserts
the removal rather than just the success notice, so it does not need the banner
cleanup step.

## 2. Admin UI flow — the Phase 4 exit condition

`admin.spec.ts` proves staff can manage content **through the admin UI**, which
is the half of the Phase 4 exit condition the API-only smoke suite could not
cover.

```sh
PLAYWRIGHT_ADMIN=1 npx playwright test admin.spec.ts   # 10 passed
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
| 6 | create → edit → duplicate-month rejection → delete a collectible through the forms |
| 7 | a mutation stripped of `X-XSRF-TOKEN` is refused with 403 |
| 8 | raw-HTML banner content shows the high-trust warning before submit, is written, and never renders as markup |
| 9 | settings list existing keys and save a change, then restore it |
| 10 | logout returns to the gate |

Fixtures: `admin` / `password123` (rank 7) and `testuser` / `password123`
(rank 1), both seeded by `src/main.cpp`.

The collectible test uses 2037-02 deliberately: `phpretro_collectibles.time` is a
signed `INT`, so 2038 months are out of range for the column. That bound was
found by writing such a row, and the resulting error is now reported distinctly
from a duplicate month (see `ContentService::collectibleWriteError`).

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
