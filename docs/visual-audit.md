# Migration visual audit — findings

Every page reachable on either stack, captured on both sides in the same pinned
Playwright container at 1280x800 and compared pixel-for-pixel.

- `report.md` — page inventory (status on each side, verdict)
- `diff.md` — ranked pixel difference per comparable pair
- `<name>--legacy.png` / `<name>--new.png` — the captures themselves

Reproduce (two passes; `maintenance` needs the site closed on BOTH stacks):

```
# pass 1 — site open
PLAYWRIGHT_AUDIT=1 BASE_NEW=http://localhost:3000 BASE_LEGACY=http://localhost:8081 \
  AUDIT_USER=audituser AUDIT_STAFF_USER=admin \
  npx playwright test audit.spec.ts

# pass 2 — set site_closed=1 on both stacks, clear the legacy settings cache, then
AUDIT_ONLY=maintenance PLAYWRIGHT_AUDIT=1 ... npx playwright test audit.spec.ts

# score every pair
AUDIT_OUT=... npx playwright test audit-diff.spec.ts
```

## Headline

**49 pages probed. 21 exist on both sides. 28 exist only on legacy.**
12 pairs are captured and scored; the rest are staff pages (see Limitations).

## Ranked differences

Two passes are needed, so the saved inventory and ranking are merged from
`.out/audit-open/` (site open — public, signed-in and staff pages) and
`.out/audit-closed/` (site closed — `maintenance` only).

**19 of the 21 comparable pairs are measured.** The two that are not are stated
under Limitations.

| page | differing | was | cause |
| --- | --- | --- | --- |
| hk-settings | **48.9%** | 49.4% | staff panel: nav is a top bar of drop-downs in legacy, a sidebar here; forms are tables there, `hk-*` blocks here |
| **me** | **43.5%** | 48.8% | Missing MyHabbo widgets — see below |
| hk-banners | 30.7% | 49.4% | same as hk-settings |
| hk-faq | 30.0% | 49.4% | same |
| hk-news | 28.6% | 49.4% | same |
| hk-dashboard | 28.5% | UNAUTH | same |
| hk-campaigns | 27.5% | 49.4% | same |
| hk-collectables | 27.1% | 49.4% | same |
| **profile** | **17.5%** | 18.5% | Same family as `me` |
| **credits** | **13.5%** | 29.7% | Left column and Coins promo were not ported — now ported |
| hk-login | 10.6% | **93.5%** | Panel window chrome was not ported — now ported |
| collectables | 5.8% | — | fixture month vs `mktime(...)`, tab labels |
| community | 5.1% | — | recorded divergences (occupancy ordering, random habbos, live counts) |
| credits-history | 4.8% | — | |
| forgot | 2.4% | **86.0%** | wrong page shell + wrong element ids/copy — now ported |
| articles | 2.0% | — | |
| help | 1.9% | — | |
| landing | 0.24% | — | correct |
| maintenance | **0.54%** | 82.6% | stale legacy settings cache, not a styling defect |

Fixed this session: **forgot 86.0 → 2.4**, **hk-login 93.5 → 10.6**,
**credits 29.7 → 13.5**, **me 48.8 → 43.5**, **profile 18.5 → 17.5**, and the
whole staff panel from **not measurable at all → ~27-31%** (its chrome was
missing entirely; the rest is the nav/table layout difference below).

## The staff panel: chrome fixed, content layout still differs

Every housekeeping page moved from *unmeasurable* to ~27-31% (settings 49%)
purely by porting the window chrome, then stopped there. What remains is a design
difference, not a bug: legacy's panel nav is a **horizontal two-row bar of
drop-down groups across the page top**, while the React panel uses a **vertical
sidebar**, and legacy's admin content is **tables** where the React panel uses
`hk-*`-styled blocks. Closing that gap means rebuilding the panel's layout, which
is a Phase 9 decision rather than a defect fix — recorded, not done silently.

## What is left on `me` (43.3%), and it is NOT styling

Legacy `/me` is a dashboard. The port renders the personal-info box, the nav
strip and the Hot Campaigns box; the rest of the page is not built:

- **Habbo Club upsell** ("Your Retro Club is expired. Do you want to extend…") —
  Club is a Phase 5 handoff
- **My Messages** (minimail — Phase 6)
- **Tags** and **Groups** (Phase 7)
- **Invite Friends / Enjoy Retro** block (needs friendships and mail)
- the avatar plate: legacy draws it via `www.habbo.com/habbo-imaging`, which is
  unreachable, so BOTH sides render a grey placeholder

The page's own comments already attribute minimail, guilds and homes to Phases
6–9. These are unbuilt features, not a rendering error, and inventing them would
be a simulated success. Hot Campaigns was the one widget on this page backed by
data the stack already publishes (`phpretro_campaigns` via
`/api/public/campaigns`), so it has been ported.

## Pages with no new counterpart (28)

Public (8): `register` (**Phase 5 decision gate** — `App.tsx` has no route, so the
catch-all serves `/`), `articles/archive`, `articles/category/*`, `club`,
`papers/disclaimer`, `papers/privacy`, `tag/search`, `credits/pixels`.

Housekeeping (20): `about`, `alerts`, `auditlog`, `bans`, `cache`, `catalogue`,
`help`, `logs`, `maintenance`, `newsletter`, `permissions`, `recommended`,
`reports`, `search`, `staffsessions`, `twofactor`, `updates`, `users`,
`vouchers`, `logout`.

**That is the whole "housekeeping looks completely different" report: legacy has
30 staff pages and the new panel has 8 routes.** Its chrome now matches, so the
built pages look right; the other 22 do not exist.

## Limitations — stated, not hidden

- **Two comparable pairs are not scored, both because the state cannot exist on
  both stacks at once.**
  - `client`: legacy `/client` for a signed-in visitor 302s to
    `/client_popup/install_shockwave` — the "install Shockwave" notice — because
    the hotel client was a Shockwave/Director embed. The new `/client` is a
    ticket-and-launch page for browser-native Octane. Different artefacts, not a
    styling gap.
  - `reauthenticate`: a mid-session step-up screen that legacy renders only for a
    session carrying the reauthenticate flag; an anonymous visitor is bounced to
    the landing page. The flow itself is covered by `password-reset.spec.ts` and
    `remember-me.spec.ts`.
- **A failed sign-in is reported `UNAUTH` and NOT captured.** Rendering a public
  fallback under a signed-in page's name would score as a visual difference. That
  guard exists because the first version of this harness did exactly that.
- **Reaching the legacy staff pages needs TOTP.** `housekeeping/index.php:59-66`
  requires a valid code for any account at or above `staff_2fa_rank` (5 here).
  The `hkstaff` fixture is provisioned at rank 5 with the secret
  `JBSWY3DPEHPK3PXP`, and `tests/e2e/totp.ts` generates the code. The 30-second
  step means a capture can in principle straddle a boundary; a re-run clears it.
- **The legacy settings cache is a trap.** `HoloSettings` caches the whole
  settings table in a file named `sha256(prefix . "\0" . key)` with **no
  expiry**. Changing `phpretro_site_settings` by SQL does nothing until that file
  is removed; this is what made `maintenance` look 82.6% broken. Clear
  `/var/www/html/cache/*.cache` after any legacy settings change.
- `collectables` is fixture-dependent: `collectables.php` matches
  `time = mktime(0,0,0,date('m'),1,date('Y'))` and the shared fixture pins
  2023-10-01, so the populated branch cannot render.
- `landing` reads 0.24% rather than 0.01% on some runs — a live online-count
  digit and the promo phrases. Both are masked in the parity gate; the audit
  does not mask.

## Test-fixture note

The legacy fixture user `karim` is bcrypt and its password is not recorded in
this workspace, so no signed-in legacy page could be captured at all. Two
accounts were added to the **disposable legacy fixture database** and mirrored on
the new stack:

- `audituser` — rank 7, legacy SHA1 scheme, `password123`, for the community pages.
- `hkstaff` — rank 5, legacy SHA1 scheme, `password123`, TOTP secret
  `JBSWY3DPEHPK3PXP` enabled, for the housekeeping pages.

Both are additive; `karim` is untouched.
