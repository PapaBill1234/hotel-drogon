# Playwright harness (Phase 4)

Four suites live here: one that captures legacy reference baselines, one that
compares the converted public pages against them, and one that drives the
converted housekeeping (admin) panel end to end.

## The canonical environment (one environment, three uses)

Legacy baseline capture, local reproduction and CI all run the parity suite
through `run-in-container.sh` inside the **same pinned image**:

| Pinned | Value | Why |
| --- | --- | --- |
| Package | `@playwright/test` from `package-lock.json` (currently **1.63.0**) | The lockfile decides it, so CI and a workstation cannot drift |
| Image | `mcr.microsoft.com/playwright:v1.63.0-noble` (`PLAYWRIGHT_IMAGE` in `playwright.config.ts`) | Pins the Chromium build (**chromium-1243**) *and* the font set. A runner's own Chromium plus distro fonts is a different rendering environment even on the same distro |
| Viewport | 1280×800, `deviceScaleFactor: 1` | framing must not vary |
| Locale / timezone | `en-US` / `UTC` (config *and* `TZ`/`LANG` in the runner) | date and number formatting reach the page; workstation and runner timezones differ |
| Colour scheme | `light`, `--force-color-profile=srgb` | otherwise capture and comparison can disagree on colour |
| Animations | `disabled`; `caret: 'hide'` | non-deterministic otherwise |
| Args | `--force-device-scale-factor=1 --hide-scrollbars` | scrollbars change layout |

Keep the image tag in step with the `@playwright/test` version. `npm ci` inside
the runner is what enforces the package half of that.

## 1. Visual parity — status: 6/6 pages passing at 2%

```sh
npm run test:visual:container     # authoritative: the pinned Linux container
BASE_NEW=http://localhost:3000 npm run test:visual   # host browser, convenience only
```

Baselines live in `../../docs/reference-screenshots/baseline/` and are committed.

### The tolerance is 2%, and why it needs no more

Inside the canonical environment the measured difference is **0 pixels on all
six pages**, so 2% is slack, not headroom. The suite previously failed on CI and
the threshold was briefly raised to 10% on a misdiagnosis — the failure was
attributed to Windows-versus-Linux text rasterisation. It was not that:

> **Root cause (proven).** `legacy/` is gitignored, so a CI workspace has no
> `legacy/phpretro-pdo/web-gallery`. compose.yaml bind-mounts it into the proxy,
> and Docker **creates a missing bind-mount source as an empty directory**, so the
> mount succeeds and every legacy stylesheet and image 404s. The converted pages
> reuse the legacy CSS verbatim, so they render as bare unstyled HTML: measured
> **landing 0.23, community 0.19, collectables 0.22, maintenance 0.96** differing
> pixels, against 0.00 for the two pages that need no legacy stylesheet. No
> tolerance can fix or should hide that. CI now sparse-clones the legacy
> `web-gallery` (901 files, 7.7 MB) into the workspace the stack expects, and a
> guard step fails fast with a named cause if the mount is ever empty again.

### Data preconditions (all three are wired into CI)

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
3. **The legacy `web-gallery` must be present in the workspace.** See the root
   cause above: without it every page renders unstyled.

Locally, reproduce all of it with:

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

Requires a running legacy stack — `docker compose -f tools/legacy-stack/compose.yaml
up -d --build`, answering on port 8081, with the same fixtures the new app is
given. Capture in the **canonical environment** so the baselines are reproducible:

```sh
# landing, community, articles, help, collectables (site open)
docker exec -i legacy_db mysql -uhotel -photel_secret polaris -e "UPDATE phpretro_site_settings SET setting_value='0' WHERE setting_key='site_closed';"
docker exec legacy_web sh -c 'rm -f /var/www/html/cache/*.cache'   # the app caches settings on disk
npm run capture:container

# maintenance, in its own pass (legacy redirects every other page while closed)
docker exec -i legacy_db mysql -uhotel -photel_secret polaris -e "UPDATE phpretro_site_settings SET setting_value='1' WHERE setting_key='site_closed';"
docker exec legacy_web sh -c 'rm -f /var/www/html/cache/*.cache'
CAPTURE_ONLY=maintenance npm run capture:container
```

`capture:container` runs the capture inside the pinned image and copies the PNGs
back into `../../docs/reference-screenshots/baseline/`.

**Baselines are captured from the LEGACY application only, never from the new
one.** Capturing the new app would make the suite compare the new app against
itself and pass unconditionally. The capture spec enforces what it can: it
refuses to save when the app returns >= 400, renders an empty body, or redirects
away from the requested path, so a wrong URL fails loudly instead of writing a
wrong baseline that later comparisons would "pass" against.

Provenance of the committed baselines: captured from `tools/legacy-stack/`
(`legacy_web` + `legacy_db`, fixtures from `99-seed.sql`) in the pinned
Playwright container, at the fixed viewport above, in two passes (site open for
five pages, `site_closed=1` for maintenance). No baseline has ever been captured
from the new application.

## Running the comparison

```sh
npm run test:visual:container                          # canonical (what CI runs)
BASE_NEW=http://localhost:3000 npm run test:visual      # host browser, convenience only
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
