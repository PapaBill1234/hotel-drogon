# Phase 1 — Architecture baseline and parity inventory

Status: **draft, generated from a code read of `PapaBill1234/hotel@laravel-13-cms`
(commit `38c878f`) against `PapaBill1234/PHPRetro-PDO@master` (commit `56f2670`)
on 2026-09-17.** Not yet walked page-by-page in a browser. Treat every "Works"
below as "code exists and looks structurally correct," not "verified running."

This is the artifact Phase 1 of the conversion plan asks for: a route/feature
freeze, an owner for every table touched, and an explicit list of what is
replaced, in-progress-on-the-wrong-stack, or not started. Update this file
every time a page is converted — it is the thing that should catch stack
drift (Blade where the plan says Inertia/React, hand-rolled CRUD where it
says Filament) before it compounds.

## How to read the Status column

| Status | Meaning |
| --- | --- |
| **Not started** | No Laravel route/controller/view exists for this. |
| **Ported (Blade)** | A Laravel route+controller+view exists and looks functionally equivalent, but renders server-side Blade against the legacy `web-gallery` CSS — not the plan's Inertia+React target. Needs a second pass, not just a merge. |
| **Ported (Inertia)** | Matches the plan's intended stack for this layer. |
| **Refused / handoff** | Route exists, returns a message that the write isn't supported here (matches PHPRetro's own honest-501 pattern) — acceptable per plan rule 6, but means the feature isn't actually done. |
| **Read-only** | Displays Polaris/phpretro_ data but cannot write it. |
| **Wrong tool** | Built, but with a component the plan explicitly replaces (e.g. hand-rolled admin CRUD instead of Filament). |

## Table ownership (plan requirement: classify every query)

| Table family | Owner | Laravel access today |
| --- | --- | --- |
| `users`, `guilds`, `guilds_members`, `rooms`, `bans`, `catalog_items` (PolarIS core) | **PolarIS** | Read: unrestricted `holodb` query builder calls scattered across controllers (not a service layer — see gap below). Write: 4 hardcoded `UPDATE users` statements in `HolodbWriteGuard`; everything else throws `RuntimeException`. |
| `phpretro_news`, `phpretro_banners`, `phpretro_faq`, `phpretro_campaigns`, `phpretro_recommended`, `phpretro_homes_catalogue` | **Website/CMS (Laravel-owned per plan)** | Read via `HousekeepingToolsController`. Write allowed by `HolodbWriteGuard`'s `isWebsiteTableDml()` regex (any INSERT/UPDATE/DELETE against `phpretro_*`), but the controllers that would perform those writes are not yet built — see Phase 4 below. |
| `phpretro_user_reports`, `phpretro_helpdesk_tickets` | Website | Read + write implemented in `HousekeepingUsersController` (reports, help desk). |
| `sys` / `hotel_cms_sys` (Laravel `users`, sessions, jobs, passkeys) | **Laravel-owned, separate from PolarIS `users`** | Fully functional — this is the Fortify/starter-kit auth system. **Not connected to hotel identity at all.** Two parallel "users" concepts exist in this codebase right now. |

## Phase 2 / 2b — Drogon backend foundation and local delivery

| Item | Plan asks for | Status |
| --- | --- | --- |
| Docker Compose (backend binary, MariaDB, Redis, worker binary, nginx proxy) | Yes | **Done.** `compose.yaml` running Drogon C++ server, MariaDB 10.11, Redis 7, worker process, and nginx reverse proxy. |
| `web-gallery` served without copying/hashing | Yes | **Done.** nginx `alias` mount directly in `proxy/nginx.conf`. |
| Route switch/proxy with instant rollback | Yes | **NOT DONE — the previous "Done, tested and verified live" claim was wrong.** `proxy/cutover.map` is **orphaned**: `proxy/nginx.conf` never includes it and defines its own inline `map $uri $target_backend`. The two disagree — `cutover.map` says `default legacy`, while nginx actually sends unmatched routes to the React SPA. There is no legacy PHP service in `compose.yaml`, so no `legacy` upstream exists and **rollback cannot be demonstrated**. Either wire the map up with a real legacy upstream and prove cutover + rollback, or delete it and correct this row. |
| CI (CMake build with ASan/UBSan, Catch2 unit tests) | Yes | **Partial.** Job `cpp-build-and-test` builds on Ubuntu 24.04 with GCC, ASan/UBSan and CTest — green. But there is **no warnings-as-errors** (`-Wall -Wextra` only, no `-Werror`), **no TypeScript build job** and **no Playwright job**; the visual-parity suite never runs in CI. The live-stack job `integration-smoke` was **FAILING** on `77f7c87` — see Phase 2b below. |
| Redis cache/sessions/queues/locks | Yes | **Done.** Async Redis client configured with database routing, health check verified. |
| Background Worker | Minimal worker binary | **Done.** `hotel_worker` binary building and running in container. |
| Structured logging, /health, /metrics | Yes | **Done.** spdlog JSON logging, `/health` and `/metrics` controllers verified live. |
| Sentry / Metrics | Before public cutover | **Not wired (previous claim overstated).** `/metrics` Prometheus endpoint is live. `AppConfig` reads `SENTRY_DSN` into `cfg.sentry_dsn`, but no Sentry SDK is linked and nothing is ever reported — the field is inert. |

### Phase 2b — build, containerize, verify (status at `77f7c87`)

The plan's Phase 2b exit condition has four parts; three are unmet and the
fourth is unproven. **Verification is incomplete, so Phase 2b is not complete.**

| Requirement | State |
| --- | --- |
| Compiles; sanitizers on every test run | **Yes** — CI `cpp-build-and-test` green; CTest passes under ASan/UBSan |
| Warnings-as-errors enabled, all warnings cleared | **No** — no `-Werror`; warnings are not gating |
| CI covers TypeScript build and Playwright | **No** — neither exists in CI |
| **CI passes** | **No** — `integration-smoke` FAILED at "Run Phase 3 smoke suite" |
| Cutover **and rollback** demonstrated for a real route | **No** — see the cutover row above |
| Sentry wired | **No** — inert config field only |
| Compose services incl. a frontend build | **Partial** — no frontend build service; `frontend/dist` is built out-of-band and bind-mounted |
| Preflight host checks recorded | **No artifact** |
| vcpkg/Conan chosen and explained | **Deviation** — dependencies come from Ubuntu apt packages; the plan's choice was never made or explained |

**CI failure detail.** Run `35512912865` on `77f7c87`: the C++ job succeeded;
`integration-smoke` failed at step "Run Phase 3 smoke suite", and every later
step (both Phase 4 suites) was skipped. The check-run annotation gives only
`Process completed with exit code 1.` at `.github/workflows/ci.yml:39` with no
assertion text, and job logs are not retrievable through the API.

**Root cause not isolated.** Ruled out locally: fresh-database behaviour
(reproduced CI exactly — `down -v`, `up -d --build`, health-poll, immediate
smoke — Phase 3 passed **12/12** on a clean volume) and the schema/seed race
observed earlier in this project for the content tables (six backend restarts
against a fresh database produced zero `1146` errors). The same script passed on
earlier commits, so it is not a shell-compatibility problem.

**Latent defect worth noting regardless:** `main.cpp` still dispatches its
Phase 3 `CREATE TABLE` statements and the user seed **asynchronously and
unordered**, unlike `ContentService::ensureSchema`, which was made sequential
precisely because that race had already been seen.

### Phase 1 gap

The plan's Phase 1 exit condition also requires **an OpenAPI document for the
first slice**. No OpenAPI document exists anywhere in the repository. Recorded
here as an outstanding foundation gap; Phase 1 is not being restarted.


## Phase 3 — Auth, authorization, Polaris access layer

### 3a — Laravel attempt (superseded; kept for history)

| Item | Plan asks for | Status |
| --- | --- | --- |
| Login/logout/remember/reset for hotel identity | Yes | **Ported (Blade).** `HotelController::login/logout/forgot/forgotSubmit`. Uses `PolarisAuthService` — password_verify with sha1 legacy upgrade, matches PHPRetro's own approach. |
| Session regeneration, email verification | Yes | Login regenerates; email verification route (`/email`) exists and is honest about invalid tokens (per its own test). |
| Staff step-up auth (2FA) | Yes | **Not started.** `HotelStaff` middleware reuses the same `hotel.user_id` session as public users — no separate staff session, no step-up. PHPRetro had `phpretro_staff_sessions` + TOTP pages; nothing equivalent exists here. |
| Policies per role (visitor/user/group member/mod/owner/staff rank) | Yes, as Laravel policies | **Not started as policies.** Authorization is ad hoc `if ($guild->user_id !== $user->id)` checks inside controller methods, not `Illuminate\Auth\Access\Response`/policy classes. |
| Explicit Polaris service layer, "behind a service with explicit allowed operations" | **Central requirement of this phase** | **Not built.** What exists is `HolodbWriteGuard`: a regex blocklist on the DB connection, not named service methods. Controllers call `$this->holodb()->table('users')->...` directly. This is the single largest gap between the plan and the repo — nearly everything else in Phases 4–9 depends on this existing first. |
| Client SSO handoff from verified fields only | Yes | `HotelController::client`, `clientUtils` exist; not independently verified against "documented emulator behavior" in this read. |
| Audit logging for staff/sensitive actions | Yes | `Support/AdminAudit.php` exists (29 lines) — present but thin; only wired into a couple of write paths (report status changes), not staff logins or bulk actions generally. |

### 3b — Drogon C++ implementation (current stack)

Phase 3 is re-implemented in the C++ service. The Laravel gaps above are the
exact failures the C++ layer was built to avoid — note in particular that the
service layer is named methods, **not** a write blocklist.

| Item | Plan asks for | Status |
| --- | --- | --- |
| Redis-backed sessions | Yes | **Done.** `SessionManager` uses `session:user:<token>` and `session:staff:<token>` keys, distinct TTLs (user 7d / staff 2h). |
| Separate cookies for public vs staff | Yes | **Done.** `hotel_session` (HttpOnly, SameSite=Lax) and `hotel_staff_session` (HttpOnly, SameSite=Strict). Verified distinct on the wire. |
| Password verification incl. legacy upgrade | Yes | **Done.** `Crypto::verifyPassword` handles bcrypt/`$2y$` via `crypt_r` plus legacy `sha1(password . strtolower(username))`, flagging `needsRehash`. Verified: a legacy-hashed user migrated to `$2y$12$...` on first login and still authenticates afterwards. |
| Staff step-up auth (2FA/TOTP) | Yes | **Partial.** `hotel_staff_session` is separate and rank-gated; `Crypto::verifyTotp` implements RFC 6238. The step-up gate currently requires a 6-digit code *format* when supplied but does not yet enforce a per-staff TOTP secret from the database — that needs a `phpretro_staff`-style secret column. |
| Policies per role, as explicit functions | Yes | **Done.** `filters::AuthPolicy::{requireUser, requireStaff, requireGroupOwner, requireGroupAdmin}` — explicit functions, no ad hoc inline checks in controllers. |
| Explicit Polaris service layer with named methods | **Central requirement of this phase** | **Done.** `UserAccountService`, `GuildService`, `BanService`, `ReportService` expose only named operations (`updateMotto`, `banUser`, `joinGuild`, …). There is deliberately **no** generic `update(table, column, value)`. Enforced by `scripts/check_polaris_access.py`, which passes. |
| CSRF on all mutating endpoints | Yes | **Done.** `filters::CsrfFilter` validates a double-submit token against the Redis session; `XSRF-TOKEN` is issued as a non-HttpOnly cookie for the frontend. Enforced by `scripts/check_csrf_rules.py`, which passes. |
| Audit logging for staff/sensitive actions | Yes | **Done.** `AuditService::logAction` writes to `phpretro_admin_action_log`; wired into login and ban/unban paths. |

### 3c — Verification (run 2026-09-20)

`scripts/smoke_phase3.sh` — 12/12 assertions pass:

| Check | Result |
| --- | --- |
| `POST /api/auth/login` (valid) | 200 |
| login rejects wrong password / unknown user | 401, 401 |
| `GET /api/me` with session / without | 200 / 401 |
| `GET /api/admin/test-gate` as non-staff | 403 |
| `POST /api/auth/staff-login` as admin | 200 |
| staff cookie is `hotel_staff_session` | distinct from `hotel_session` |
| `GET /api/admin/test-gate` as staff | 200 |
| `POST /api/account/motto` without CSRF token | 403 |
| removed debug route | 404 |

Static enforcement (both exit 0):

- `scripts/check_csrf_rules.py` — 14 routes, 9 mutating, all protected or on the
  verified auth exemption list.
- `scripts/check_polaris_access.py` — 11 non-service files scanned, zero direct
  Polaris table access outside `src/services/`.

### 3d — Defects found and fixed during verification

1. **Username-dependent password hashing seeded wrong.** PHPRetro's scheme is
   `sha1(password . strtolower(username))`, so each account needs its *own*
   digest. The seed initially gave `admin` and `testuser` the same hash, which
   only validates for one of them. Corrected to per-user digests
   (`admin` → `688a8dac…`, `testuser` → `023f158f…`). Because the seed is
   `INSERT IGNORE`, pre-existing volumes keep the bad row — a fresh volume now
   seeds correctly, verified by wiping `users` and letting the app re-seed.
2. **Stale upstream DNS in nginx.** Recreating the backend container made every
   request 502 permanently. The cause is subtler than "nginx caches DNS": the
   cutover map returns the name `drogon_backend`, which **matched a declared
   `upstream` block**, and nginx resolves a variable `proxy_pass` target by
   searching server groups *before* falling back to a resolver — so the address
   pinned at startup was used forever regardless of resolver config. Adding
   `resolver 127.0.0.11 valid=10s ipv6=off;` alone did **not** fix it; the
   `upstream` block had to be removed and the map values changed to literal
   `backend:8080`, which cannot match a server group and therefore always goes
   through the resolver. The `/ws` location was converted to the same
   variable-based form.
   *Verified properly:* the first attempt at proof was worthless because Docker
   handed the recreated container the same IP. The real test parks a blocker
   container on the backend's old address to force a genuine IP change
   (`.7` → `.8`) with the proxy left running — nginx then serves 200. Trade-off:
   no `upstream keepalive` pooling, since Open-Source nginx cannot re-resolve a
   server group at runtime. Dynamic routing was worth more than the pooling.
3. **Removed a debug endpoint.** `/api/test/echo` (added while wrongly
   diagnosing a JSON failure) was an unauthenticated POST surface; the CSRF
   lint correctly flagged it. Deleted along with the stray `test_debug.cpp`.

A note on that misdiagnosis, because it cost the most time: the original
symptom was `getJsonObject()` returning null. The actual causes were (a) the
Windows PowerShell `curl` alias and `docker exec` stripping quotes out of JSON
literals before they left the shell — so the body arrived as `{test:hello}` —
and (b) failing to attach a body at all in later attempts. The request layer was
never at fault. The real, permanent constraint discovered along the way is that
**Drogon 1.8.7 on Ubuntu 24.04 links jsoncpp, not nlohmann** — controllers must
use `Json::Value`/`isMember`/`asString`.


## Phase 4 — CMS and public content

| Page/feature | Plan target | Status |
| --- | --- | --- |
| Filament CMS (news, campaigns, collectables, banners, FAQ, settings, maintenance) | Filament resources | **Wrong tool.** `HousekeepingToolsController` (503 lines) is hand-written Blade CRUD — no Filament anywhere in `composer.json`. |
| Public: landing, community, articles, FAQ, collectables, maintenance, RSS | React/Inertia | **Ported (Blade), wrong stack.** All 29 `return view(...)` calls in `HotelController`; zero `Inertia::render` for hotel pages. RSS (`/articles/rss.xml`) exists as Blade emitting XML. |
| Raw-HTML/script settings as gated high-trust features | Explicit permission gates + warnings | **Not implemented as a gate.** Legacy PHPRetro's raw-output settings (`site_tracking`, banner HTML) were flagged in its own XSS audit as "deliberate staff code execution" needing documented trust boundaries; Laravel side doesn't yet reproduce or gate this at all — it's simply not read/write here yet. |
| Screenshot parity tests vs. original pages | Yes | **Not found.** `tests/Feature/VisualContractTest.php` checks file/route hygiene (no `web-gallery` copy, correct nginx alias), not visual screenshot diffing against the legacy page. |

### Phase 4b — Drogon C++ implementation (current stack)

**Exit condition status: NOT MET.** The plan requires *"staff can manage public
content through the new admin UI, and converted public pages match legacy
screenshots within tolerance."* The screenshot half is fully met (6/6). The
admin-UI half is not: the API exists and is verified, but there is no UI. See
the "Admin CMS UI" row below.

Ported from `legacy/phpretro-pdo` at the reviewed commit. The Laravel rows above
are historical; these are the live statuses.

| Page/feature | Legacy source | Status |
| --- | --- | --- |
| Content models (`phpretro_*`) | `migrations/001`, `008` | **Done.** Typed structs + `ContentService` named methods (not Drogon ORM classes — one data-access idiom with Phase 3). Schema bootstrapped at startup for `phpretro_news`, `phpretro_collectibles`, `phpretro_faq`, `phpretro_banners`, `phpretro_campaigns`, `phpretro_site_settings`. |
| Admin CMS API | legacy `housekeeping/*` | **Done.** `/api/admin/{news,faq,collectibles,banners,campaigns,settings}`, staff rank ≥ 5, per-field validation, audit-logged, CSRF-enforced. 19/19 smoke assertions. |
| Admin CMS **UI** | legacy `housekeeping/*` | **NOT STARTED — this is the unmet half of the Phase 4 exit condition.** The plan requires staff to manage content "through the new admin UI" and calls the admin section "real UI + backend work, not configuration". The frontend contains only the six public pages: no admin route, page or component, and nothing under `frontend/src` references admin. The API is complete and tested; the UI that would let staff use it does not exist. |
| High-trust raw-HTML gating | not gated in legacy | **Done.** `AuthPolicy::requireHighTrust` (rank ≥ 7), enforced in controller *and* service, visible warning in responses, `X-High-Trust-Required` on denial, high-trust writes distinctly audit-labelled. Public API never exposes `html`. |
| Public content API | the `*.php` pages | **Done.** `/api/public/{landing,news,news/{id},faq,collectibles,banners,campaigns,maintenance,settings}`. |
| RSS | `xml/rss.php` | **Done, with bug fixed.** See "RSS double-escaping" below. |
| React pages (landing, community, articles, FAQ, collectables, maintenance) | the `*.php` pages | **Done and visually verified.** `frontend/` (Vite + React 18 + TS + TanStack Query); all six pages render the legacy markup and classes verbatim. `tsc -b && vite build` clean. |
| Screenshot parity tests | n/a | **Done — 6/6 pages pass** at a 2% pixel tolerance. Baselines are captured from a real legacy stack (`tools/legacy-stack/`) at a fixed 1280×800 viewport. |

#### Per-page parity status

All six converted pages pass `tests/e2e/visual-parity.spec.ts`:

| Page | Legacy source | Result |
| --- | --- | --- |
| landing (`/`) | **`index.php`** — *not* `landing.php` | pass |
| community | `community.php` | pass |
| articles | `articles.php` | pass |
| help / FAQ | `help.php` | pass |
| collectables | `collectables.php` | pass |
| maintenance | `maintenance.php` (classic, `maintenance_style=0`) | pass |

Three things were needed before any page could match, all found by measuring
rather than eyeballing:

1. **The legacy page scripts were never loaded.** `Rounder.init()` rewrites
   `.rounded` elements into the nested `.rounded-container` gradient markup the
   legacy pages actually render; without it every rounded box was ~16px short on
   every page.
2. **Each page family loads a different stylesheet set.** `community_header.php`,
   `login_header.php` and `maintenance_header.php` disagree, and declaring one
   global set made maintenance inherit community padding it should never have.
   Each page now declares its own set via `frontend/src/components/LegacyStyles.tsx`.
   The sets were read from the *rendered* pages, not the templates — grepping
   `login_header.php` suggests a larger set than the page actually requests, and
   loading `frontpage.css` on landing broke the two-column layout.
3. **`/` is served by `index.php`, not `landing.php`.** The latter only runs when
   `site_new_landing_page=1`. The React page had been built from the wrong file,
   including `#fp-container` and speech bubbles that do not exist on the real
   page.

Two preconditions the parity run depends on, both data rather than markup:

- **Both apps must hold identical content.** The fixtures live in
  `tools/legacy-stack/init/99-seed.sql` and are applied to both databases.
  Divergent data shows up as a markup diff. In particular the admin smoke suite
  creates banners and does not delete them; clear `phpretro_banners` before
  running parity.
- **`maintenance` requires `site_closed=1` on both sides.** Legacy redirects to
  `/` when the site is open, so its baseline can only be captured closed. With
  the flag set, every other legacy page redirects to `/maintenance` — so parity
  for maintenance and for the other five cannot be measured in the same pass
  unless the baselines are static (they are; the comparison is against captured
  PNGs, not the live legacy app).

#### RSS double-escaping — fixed

`xml/rss.php` escaped the article title **twice**: once when reading the row
(`$row['title'] = $input->HoloText($row['title'])`, line 34) and again on output
(`<title><?php echo $input->HoloText($row['title']); ?></title>`, line 41). A
title containing `&` therefore rendered as the double-escaped entity.
`$row['summary']` was escaped once and echoed raw, so it was correct — the bug
was title-specific.

The port escapes exactly once, centralised in `xmlEscape()`, with every call
site passing raw data. Verified by round-trip rather than by string matching:
parsing the feed returns the original title verbatim and the raw feed contains
no double-escaped entity. A double-escaped implementation fails both.

#### Reference screenshots are not baselines

The 11 captures in `docs/reference-screenshots/` were taken by hand from the
running XAMPP instance at `127.0.0.1`. They cover landing, articles/news and
collectables (of the Phase 4 pages) plus Club, Pixels, housekeeping login,
forgot-password, registration, `/me` and profile. They are useful as design
references but **cannot** serve as comparison baselines: window widths range
658–1312px, several include browser chrome and the OS taskbar, and none is a
fixed viewport. A tolerance comparison against them would fail on framing
alone. Baselines must be re-captured by the test harness at one fixed viewport
against a running legacy stack.

## Phase 5 — Account, profile, credits, Club, client entry

| Page/feature | Status |
| --- | --- |
| `/me`, `/profile`, `/welcome`, `/client` | Ported (Blade). Reads Polaris `users` fields directly. |
| Registration | **Refused / handoff.** `registerSubmit()` returns "Website registration is not enabled... Use an existing hotel account." Fails this phase's own exit condition ("a new... user can complete the supported account journeys"). |
| Reauthenticate, security check | Ported (Blade). |
| Club display / subscribe | **Refused / handoff**, matching PHPRetro's own honest client-handoff pattern (correctly, per plan rule 6) — `HabbletController::clubSubscribe` returns "This website cannot take coins or grant club membership." |
| Credits / history | Ported (Blade), read-only. |

## Phase 6 — Messaging and friend management

| Feature | Status |
| --- | --- |
| Minimail (load/send/delete/trash/report) | **Ported (Blade), wrong output contract.** `MinimailController` (240 lines) implements the full flow but returns HTML fragments (`resources/views/hotel/habblet/minimail-*.blade.php`) — exactly the pattern the plan says to replace with "typed React form/action results." |
| Friend requests / search / management | **Refused for mutation.** `friendManagementRefuse()`, `friendAddRefuse()`, `confirmAddFriend`/`addFriend` exist as routes but several are explicit refusal stubs. |
| Reverb / live notifications | **Not started.** Not installed. |
| Anti-spam / rate-limit checks | Partial — `throttle:20,1` applied at the route level on several `habblet/ajax/*` endpoints; no dedicated anti-spam service. |

## Phase 7 — Groups, discussions, group profile

| Feature | Status |
| --- | --- |
| Group show/discussions/settings pages | Ported (Blade). `GroupController` (379 lines). |
| Join / leave | **Refused.** "PolarIS guilds_members is not written from this website." |
| Badge editor | **Refused / handoff**, matching PHPRetro's client-handoff design — correctly labeled, not faked. |
| Group create/purchase | Exists (`HabbletController::groupCreateForm/groupConfirm/groupPurchase`) but gated behind a "sign in / club required" wall; not confirmed to complete a real purchase (PolarIS write not allowlisted). |
| BBCode/rich-text allowlist for member content | **Not verified in this read** — not found as a distinct rendering component. |
| Discussions/forum moderation | Mostly **refused** (`discussionsRefuse`, `discussionsConfirmDelete` present but many discussion actions route to a generic refusal). |

## Phase 8 — MyHabbo Homes editor

| Item | Plan target | Status |
| --- | --- | --- |
| Versioned JSON layout API | Explicit requirement | **Not started.** No JSON API; `HomesController` (571 lines) + `Support/Homes.php` (942 lines) return Blade partials per widget type, same shape as legacy AJAX responses. |
| React canvas/drag-drop via dnd-kit | Explicit requirement | **Not started.** `dnd-kit` not in `package.json`. No interactive frontend for Homes exists — server renders static widget markup. |
| TanStack Query for optimistic updates | Explicit requirement | Not installed. |
| Store/inventory/stickers/notes | Legacy feature parity | Routes exist (`storeMain`, `storeItems`, `placeSticker`, `stickieEdit`, etc.) and appear functionally ported at the data level, but through the same server-rendered-fragment pattern the plan wants retired. |
| Ratings, guestbook | Ported (Blade) | Present, including `resetRatings`/`rate` and guestbook add/list/remove/configure. |
| Group Homes | "Port only after user Homes passes all interaction tests" | Group editing session routes exist (`groupStart`, `groupCancel`, `groupSave`) — being built in parallel with user Homes, ahead of the plan's stated sequencing. |

**This phase, as specified, has not been started.** What exists is a faithful data-layer port of the old behavior, which is real and reusable, but the interactive/versioned-API rebuild the plan explicitly calls for ("rebuilt deliberately, rather than copied through a compatibility layer") hasn't begun.

## Phase 9 — Housekeeping replacement

| Item | Plan target | Status |
| --- | --- | --- |
| Filament resources for users/bans/news/etc. | Filament | **Wrong tool.** `HousekeepingController` (382 lines) + `HousekeepingToolsController` (503) + `HousekeepingUsersController` (218) are hand-rolled Blade admin screens. |
| User management writes (rank/credits/mail/pixels) | Working, audited | **Refused.** "PolarIS users.rank / credits / mail / pixels / points are not written from this website." |
| Bans | Working, audited | **Refused.** "PolarIS bans are not written from this website." |
| Alerts | Working via RCON/CMS API | **Refused** unless RCON configured, and even then hardcoded to `'PolarIS rejected the alert.'` — no real RCON call implemented yet. |
| Reports, help desk | Working | **Actually functional** — real reads/writes against `phpretro_user_reports` and `phpretro_helpdesk_tickets`. This is the most complete piece of Phase 9. |
| Staff sessions / 2FA pages | Working | Blade views exist (`staffsessions.blade.php`, `twofactor.blade.php`) — not confirmed functional against real session-pinning logic (Phase 3 gap above). |
| Audit trail on all destructive actions | Required | Only wired into the report-status write path. |

## Phase 10 — Cutover

| Item | Status |
| --- | --- |
| Route-by-route parallel verification | Not started — nothing hotel-facing is behind the proxy yet. |
| Security review (SQLi/XSS/CSRF/IDOR) | Not started. Notably, `bootstrap/app.php` currently **exempts CSRF validation** on `habblet/ajax/*`, `myhabbo/*`, `minimail/*`, `groups/actions/*`, `discussions/*`, `mod/*`, `habboclub/*`, `friendmanagement/*` — the inverse of what this phase requires, and a real gap the moment any of those refused writes gets un-refused. |
| `cutover.map` scope | **Actively blocked by the repo's own guardrail.** `scripts/visual-contract.sh` fails the build if the map contains a line matching `habblet` or `housekeeping`. |
| Unsupported-feature register | Not written as a standalone doc; PHPRetro's own `docs/phase-reports/phase10-final-status.md` covers the *legacy* app's version of this list, not Laravel's. |

## What this inventory says, plainly

- **Genuinely reusable now:** middleware boundary (`hotel.auth`/`optional`/`staff`/`guest`), `PolarisAuthService`, the Homes/Hotel data-layer logic, Docker/nginx scaffolding, the `phpretro_*` migrations, reports/help-desk (the one fully-functional Laravel-era admin feature). The "routing map" and "cutover scaffolding" are **not** reusable as they stand — `cutover.map` is orphaned and rollback is undemonstrable.
- **Needs replacing, not extending:** every Blade template for a hotel page (→ Inertia+React), `HousekeepingController`/`HousekeepingToolsController` (→ Filament), the CSRF exemption list (→ real token bridging). `HolodbWriteGuard` has been **replaced in the C++ stack** by named service classes; the Laravel-era guard is now historical.
- **Done in the C++ stack (Phase 3b):** the named Polaris service layer, explicit authorization policy functions, CSRF enforcement on mutating routes, Redis sessions with separate public/staff cookies, audit logging. These were the "not started" items in the Laravel-era read.
- **Done in the C++ stack (Phase 4b):** the content service layer, the `/api/admin/*` CMS API, high-trust gating for raw-HTML banner fields, the public `/api/public/*` API, the RSS feed (with the `xml/rss.php` double-escaping defect fixed), and all six public pages as React components — visually verified 6/6 against captured legacy baselines.
- **Still not started:** Reverb/live notifications, the dnd-kit/TanStack Query Homes rebuild, monitoring/Sentry (the config field is inert), the versioned JSON layout API, and any actual cutover. Screenshot parity testing is **no longer** on this list — it is done.
- **The next blocker is verification, not features.** Phase 2b's exit condition is unmet: CI does not pass (the `integration-smoke` job failed on `77f7c87`), warnings-as-errors is not enabled, CI has no TypeScript or Playwright job, Sentry is unwired, and the cutover/rollback path cannot be demonstrated. Rules 7 and 10 make an unverified foundation an explicit gap rather than a pass, so this comes before new feature work.
- **The Phase 4 exit condition is only half met.** Screenshot parity passes 6/6, but the plan requires staff to manage content *through the new admin UI* and no admin UI exists — only the API. The plan also names an OpenAPI document in Phase 1's exit condition and none exists. Both are missing implementation, not verification. The user has since authorised the order of work: finish Phase 2b, then the OpenAPI document, then the admin UI, and do not advance to Phase 5 until all three are complete. See `ai-run-state.md`.
- **The service layer remains narrow in breadth:** it covers identity, bans, guilds, reports and CMS content. Registration, credit/pixel edits, badge saves, and group create/purchase are still unimplemented, so the "refused" rows in Phases 5–9 stay refused until each gets its own named, audited service method. The pattern is established; the breadth is not.
