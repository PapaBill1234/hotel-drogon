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
| CI (CMake build with ASan/UBSan, Catch2 unit tests) | Yes | **Green.** Run `35524678557` (commit `66ba2d8`): both jobs success. `cpp-build-and-test` builds with GCC, ASan/UBSan, `-Werror` and CTest. `integration-smoke` runs the Python lints, all three smoke suites, a TypeScript frontend build, the admin UI suite on the runner's Chromium, and the parity suite in the pinned container — which now passes because the legacy `web-gallery` is sparse-cloned into the workspace the Compose project directory expects. |
| Redis cache/sessions/queues/locks | Yes | **Done.** Async Redis client configured with database routing, health check verified. |
| Background Worker | Minimal worker binary | **Done.** `hotel_worker` binary building and running in container. |
| Structured logging, /health, /metrics | Yes | **Done.** spdlog JSON logging, `/health` and `/metrics` controllers verified live. |
| Sentry / Metrics | Before public cutover | **Not wired (previous claim overstated).** `/metrics` Prometheus endpoint is live. `AppConfig` reads `SENTRY_DSN` into `cfg.sentry_dsn`, but no Sentry SDK is linked and nothing is ever reported — the field is inert. |

### Phase 2b — build, containerize, verify (status at the admin-UI commit)

The plan's Phase 2b exit condition has four parts. Two are met, one is partially
met, and one remains unmet. **Phase 2b is still not complete**, and nothing below
should be read as claiming it is.

| Requirement | State |
| --- | --- |
| Compiles; sanitizers on every test run | **Yes** — `cpp-build-and-test` green; and re-verified locally for this change with the sanitizer configuration (`-DENABLE_SANITIZERS=ON`, Debug, GCC, Ninja), `-Werror` active, zero warnings from this repository's sources, CTest 1/1 passed |
| Warnings-as-errors enabled, all warnings cleared | **Yes** — `-Werror`; the 7 `-Wunused-parameter` findings in `PublicContentController.cpp` cleared; clean builds warning-free in both Release and Debug+ASan/UBSan |
| CI covers TypeScript build and Playwright | **Added; first CI run failed and the cause is fixed, not yet re-observed** — the steps were added and run `35519492373` failed at exactly one step, **"Build the React frontend (TypeScript + Vite)"**, so every Playwright step was skipped. Cause: `frontend/dist` is a bind-mount source that Docker auto-creates as **root** on a fresh checkout, so Vite's output-directory emptying hit EACCES as the unprivileged runner. Fixed three ways: `frontend/dist/.gitignore` is committed so the directory exists and is runner-owned before `docker compose up`; the proxy is now **reloaded** (`nginx -s reload`) instead of restarted, because a restart briefly moved the container address that the variable-based `proxy_pass` had resolved; and a check for the exact failure re-runs locally against a fresh tree. **Unproven until the next CI run.** |
| **CI passes** | **FAILED on the last run, cause fixed, re-verification pending** — run `35519492373` (commit `869a4ef`) concluded `failure`: job `cpp-build-and-test` **success**, job `integration-smoke` **failure** at the frontend-build step above. The readiness flake from `77f7c87` remains fixed and did not recur (Phase 3 and both Phase 4 smoke suites passed in that run). |
| Cutover **and rollback** demonstrated for a real route | **No** — see the cutover row above |
| Sentry wired | **No** — inert config field only |
| Compose services incl. a frontend build | **Partial** — no frontend build service; `frontend/dist` is built out-of-band and bind-mounted (locally and now in CI). The proxy additionally mounts the legacy `housekeeping/images/` tree read-only so `/housekeeping/images/…` resolves instead of being answered with the SPA shell. |
| Preflight host checks recorded | **No artifact** |
| vcpkg/Conan chosen and explained | **Deviation** — dependencies come from Ubuntu apt packages; the plan's choice was never made or explained |

**CI integration-smoke: isolated to an intermittent readiness race.**
`integration-smoke` failed at "Run Phase 3 smoke suite" on `77f7c87`
(run `35512912865`) and then **passed every step** on `9684e3a`
(run `35514365424`) — a commit that changed docs only. Same code, different
outcome: the job is flaky, not broken.

The defect behind it is real and unfixed. Started fresh in isolation, the
backend logs show:

```
Listing on 0.0.0.0:8080...            <- serving
Default test user and admin seeded... <- 620ms later
```

`/health` reports ready from the DB *client object existing*, not from the
schema/seed having completed, so there is a ~620ms window where the stack
answers 200 while `testuser` does not exist — and the smoke's first assertion is
`login testuser` expecting 200. `main.cpp` compounds this by dispatching its
CREATE TABLE statements and user seed asynchronously and unordered, unlike
`ContentService::ensureSchema`, which is sequential precisely because that race
was seen before.

Ruled out non-destructively via the isolated `tools/ci-repro/` project (fresh
disposable volumes, no `frontend/dist`, no `web-gallery`, Linux client using
CI's exact poll-then-smoke pattern): the missing mounts, fresh-database state by
itself, shell compatibility, and client latency — an in-network client detected
health after 3 polls (~150ms) and still passed.

The fix (make readiness mean readiness; make the bootstrap sequential) is
**implemented and verified**: `utils/Readiness` signals readiness explicitly,
`main.cpp`'s CREATE statements and user seed run strictly in order with
`markReady()` only on successful seed, and `/health` returns **503** until then.
A probe polling the backend directly — bypassing nginx, whose startup was
masking the window — shows `000 -> 503 -> 200` with login succeeding at the
first 200, against a violated invariant on the pre-fix image.

Caveat: this removes the mechanism and proves the invariant locally; only green
CI runs confirm the flake is gone.

**Warning inventory for the warnings-as-errors item:** a clean compile emits
exactly 7 warnings, all `-Wunused-parameter` in
`src/controllers/PublicContentController.cpp` (168, 191, 213, 235, 257, 281,
300). No other compiler warnings.

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

**Exit condition status: MET at 2026-09-21, on the second attempt.** The plan
requires *"staff can manage public content through the new admin UI, and converted
public pages match legacy screenshots within tolerance."* Both halves now have
evidence: screenshot parity **6/6**, and the admin UI drives every resource
through the browser in **10/10** Playwright assertions
(`tests/e2e/admin.spec.ts`).

The first version of this claim was **wrong and has been withdrawn**. It was made
while `/api/admin/collectibles` had no update endpoint, so staff could create and
delete collectables but not edit them — even though `housekeeping/collectables.php`
had a full update branch and this plan's Phase 4 bullet requires "CRUD with
validation, audit history, and role gates". That was not a scope judgement; it was
an exit condition marked met with work outstanding. `PUT /api/admin/collectibles/
{id}` and an Edit action now exist and are verified, so the claim rests on the CRUD
the plan actually names.

Ported from `legacy/phpretro-pdo` at the reviewed commit. The Laravel rows above
are historical; these are the live statuses.

| Page/feature | Legacy source | Status |
| --- | --- | --- |
| Content models (`phpretro_*`) | `migrations/001`, `008` | **Done.** Typed structs + `ContentService` named methods (not Drogon ORM classes — one data-access idiom with Phase 3). Schema bootstrapped at startup for `phpretro_news`, `phpretro_collectibles`, `phpretro_faq`, `phpretro_banners`, `phpretro_campaigns`, `phpretro_site_settings`. |
| Admin CMS API | legacy `housekeeping/*` | **Done.** `/api/admin/{news,faq,collectibles,banners,campaigns,settings}` — now including `PUT /api/admin/collectibles/{id}` — staff rank ≥ 5, per-field validation, audit-logged, CSRF-enforced. **33/33** smoke assertions (19 at the first pass, 23 after the session endpoint, 33 with the collectibles CRUD block). |
| Admin CMS **UI** | legacy `housekeeping/*` | **Done.** `frontend/src/pages/admin/*` — a React panel at the legacy `/housekeeping/*` URL shape with sign-in, a nav of only-implemented sections, and one screen per resource, each with create, edit (where the API supports it) and delete. **10/10** Playwright assertions: news create→edit→validate→delete, collectible create→edit→month-collision→delete, both-session sign-in, the CSRF-header requirement, the high-trust warning, settings, and logout. See "Admin UI" below. |
| High-trust raw-HTML gating | not gated in legacy | **Done, and stricter than legacy.** `AuthPolicy::requireHighTrust` (rank ≥ 7), enforced in controller *and* service, visible warning in the UI **before** submit and in the API response, `X-High-Trust-Required` on denial, high-trust writes distinctly audit-labelled. Public API never exposes `html`. The legacy `housekeeping/banners.php` let any rank-5 member of staff write markup into a field the public pages echo unescaped; that write is now rank-gated. |
| Public content API | the `*.php` pages | **Done.** `/api/public/{landing,news,news/{id},faq,collectibles,banners,campaigns,maintenance,settings}`. |
| RSS | `xml/rss.php` | **Done, with bug fixed.** See "RSS double-escaping" below. |
| React pages (landing, community, articles, FAQ, collectables, maintenance) | the `*.php` pages | **Done and visually verified.** `frontend/` (Vite + React 18 + TS + TanStack Query); all six pages render the legacy markup and classes verbatim. `tsc -b && vite build` clean. |
| Screenshot parity tests | n/a | **Done — 6/6 pages pass at 2%.** Capture, local reproduction and CI all run in the pinned `mcr.microsoft.com/playwright:v1.63.0-noble` container with the lockfile's `@playwright/test`, so one Chromium build and one font set serve all three; measured difference inside it is 0 pixels per page. Baselines are legacy captures, never new-app captures. See "Why the parity suite failed on CI" below. |

#### Admin UI (the half that was missing)

Built as a decoupled React panel at the legacy path, so existing links and
bookmarks survive. Entry points: `/housekeeping` (dashboard), `/housekeeping/
{news,faq,banners,campaigns,collectables,settings}`, `/housekeeping/login`.

- **Both sessions are required, and the UI establishes both.** `AuthPolicy::
  requireStaff` reads `hotel_staff_session`; `CsrfFilter` validates the submitted
  token against the `csrf_token` of the **user** session in `hotel_session`
  (`StaffSessionData` has no `csrf_token` field at all). The sign-in screen
  therefore performs `POST /api/auth/login` **and** `POST /api/auth/staff-login`,
  exactly as `scripts/smoke_phase4_admin.sh` does, so the browser path and the
  smoke path cannot drift apart.
- **New endpoint: `GET /api/admin/session`.** The legacy panel re-checked the
  staff session server-side on every request (`includes/hksession.php`); a
  decoupled SPA has no such hook. This endpoint reports the staff session the
  caller actually holds (`username`, `rank`, `2fa_verified`, `high_trust`),
  passwordless and idempotent, gated at `requireStaff(5)`. A signed-in non-staff
  user gets 403, asserted in the smoke suite so it cannot become an
  enumeration surface.
- **The three refusal states are distinguished.** `admin-blocked` renders
  `signed-out`, `not-staff` (naming the required rank) or `no-staff-session`
  (signed in at rank ≥ 5 but the 2h staff session is absent or expired) — three
  different next actions, rather than one generic "access denied".
- **Navigation lists only implemented sections.** The legacy menu had catalogue,
  newsletter, vouchers, users, bans, alerts, help desk, reports, staff sessions,
  2FA, logs, cache and maintenance; none has an endpoint, so none is linked, and
  the dashboard says so explicitly (plan rule 6).
- **Per-field validation, not one flat notice.** `ContentService` returns the
  exact rejected column in `field`; the form attaches the server's message to
  that input. Legacy `news.php` had a single fixed sentence for every failure.
- **`%path%` tokens are still rewritten to `/`** on banner and campaign
  save/load, as the legacy page did with `str_replace('%path%', PATH, …)`.

#### Deliberate divergences from the legacy housekeeping pages

Recorded rather than silently absorbed, as plan rule 8 requires:

| Area | Legacy | Port | Why |
| --- | --- | --- | --- |
| Raw-HTML banner writes | rank 5 | rank 7 (`requireHighTrust`) | Legacy let ordinary staff write markup the public pages echo unescaped. Stricter is deliberate; the denial is reported in the UI and in `X-High-Trust-Required`. |
| Site settings writes | whole page gated at rank 7; every key posted at once; `generateCache()` after | endpoint gated at rank 5, escalating to rank 7 only when a *value* carries markup; one key per call | One rejected raw-HTML key no longer discards the other keys' saves. The backend reads `phpretro_site_settings` per request, so there is no cache to regenerate. |
| Collectibles | full create/edit/delete | **create + edit + delete** | Was create+delete only, which made the earlier "exit condition met" claim false. `PUT /api/admin/collectibles/{id}` with the legacy required-field set (name, description, image, positive month), audited as `content_collectible_update`. |
| Campaigns | "Name and image are required." | only `name` is required | The server is the authority; the form does not invent a client rule that contradicts it. Recorded as a deliberate difference. |
| "Month timestamp" number box | raw epoch `<input type="number">` | `<input type="month">` writing the same epoch | First instant of the chosen month, local time — the same value the legacy default produced. Column unchanged. |
| Banners list | Order / Data / Visible | Order / Text / Data / Visible | Legacy showed only the word "HTML" for an advanced banner, so its text was invisible in the list and "which row am I deleting" was unanswerable. |
| Panel chrome | `housekeeping/images/styles/style.css` | `frontend/src/styles/admin.css`, palette copied from that file | Measured and rejected: its `* { font-size:10px; letter-spacing:-1px }` fights React's form controls, and `.panel_header` positions the menu absolutely with a hover-only flyout that has no keyboard path. The legacy assets are still served read-only at `/housekeeping/images/` for reference and reuse. |
| Row deletion | form POST per row | `DELETE /api/admin/<res>/{id}` | The API shape; CSRF still required on every mutation. |

#### Static agreement check between the API and the UI

`scripts/check_admin_ui_coverage.py` (in CI) fails the build when:

- a registered `/api/admin/*` route has no call in `frontend/src/services/apiAdmin.ts`
  and is not listed in `ALLOWED_UNWIRED` with a written reason (currently
  `test-gate`, `bans`, `bans/revoke` — Phase 9 surface);
- a mutating route is "covered" by a call with the wrong HTTP method;
- any module outside the two service clients calls `fetch()` directly;
- `GET /api/admin/session` is not served or not used;
- no admin page renders the `<HighTrustWarning>` component the plan requires.

Current output: *26 admin routes, 27 client calls, 23 wired, 3 explicitly
unwired* — exit 0. Its failure modes were verified by seeding three defects
(a renamed route, the warning removed from both pages, a raw `fetch()` added to a
page); each produced exit 1, and the tree was restored to exit 0.


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

#### Why the parity suite failed on CI: an empty legacy mount, not rendering drift

**Root cause, proven from the CI log and artifact, then confirmed fixed on CI.**
`legacy/` is gitignored, so a CI workspace contained no
`legacy/phpretro-pdo/web-gallery`. `compose.yaml` bind-mounts that path into the
proxy, and **Docker creates a missing bind-mount source as an empty directory**,
so the mount succeeded and every legacy stylesheet and image 404'd. The converted
pages reuse the legacy CSS verbatim, so they rendered as bare unstyled HTML.

| Evidence | Value |
| --- | --- |
| Proxy log for one run | **162** `open() "/var/www/web-gallery/..." failed (2: No such file or directory)`, and **0** successful `/web-gallery/**` responses |
| `frontend/dist` mount | `/assets/index-*.css` and `*.js` served **200** — so only the legacy mount was empty |
| Artifact `*-actual.png` | the pages with no CSS applied at all |
| Diff ratios | landing **0.23**, community **0.19**, collectables **0.22**, maintenance **0.96**; articles and help **0.00** (those two need no legacy stylesheet) |
| Local reproduction, isolated stack with the mount deliberately absent | landing **225352** differing pixels — the identical number CI reported |

A second, subtler defect surfaced while fixing it: the Compose **project
directory** on a GitHub runner is the *parent* of the checkout
(`/home/runner/work/hotel-drogon`), not the checkout itself, so a sparse clone
placed at `<checkout>/legacy/...` left the mount pointing at an empty directory
while looking correct. The assets are now placed at both candidate roots and the
guard asserts against the mount Docker resolved (`docker inspect`) rather than the
path anyone assumed.

An earlier diagnosis in this file blamed Windows-versus-Linux text rasterisation
and raised the tolerance to 10% on that basis. **That was wrong and is
withdrawn**: the ratios were the size of each page's missing CSS, not a
rasterisation signature, and no threshold could have fixed or should have hidden
a page with no stylesheet.

What is true now:

- CI sparse-clones the legacy `web-gallery` (901 files, 7.7 MB) into the
  workspace the Compose project directory expects, and a guard fails fast with
  the resolved mount, the file counts on both sides and the error message if the
  mount is ever empty again;
- the parity comparison runs in the pinned Playwright container, and viewport,
  locale, timezone, colour scheme, device scale factor and animations are pinned
  in `playwright.config.ts`, so capture, local reproduction and CI share one
  environment;
- `MAX_DIFF_PIXEL_RATIO` is back to **2%**. Inside the canonical environment the
  measured difference is **0 pixels on all six pages**, so 2% is slack rather
  than headroom;
- **CI is green**: run `35524678557` on `66ba2d8`, both jobs success, parity
  6/6 and the admin UI flow 10/10 in the same job.

Baseline provenance is unchanged and was **not** re-captured: all six were
captured from the legacy application in the pinned container, and inspection
confirms they are the fully styled legacy renders. Capturing from the new
application is prohibited and did not happen.

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
- **Done in the C++ stack (Phase 4b):** the content service layer, the `/api/admin/*` CMS API (including collectible updates), high-trust gating for raw-HTML banner fields, the public `/api/public/*` API, the RSS feed (with the `xml/rss.php` double-escaping defect fixed), all six public pages as React components — visually verified 6/6 against captured legacy baselines — and the **admin UI** that makes the Phase 4 exit condition's first half true: a React panel at `/housekeeping/*` driving every implemented `/api/admin/*` resource, verified 10/10 through the browser.
- **Still not started:** Reverb/live notifications, the dnd-kit/TanStack Query Homes rebuild, monitoring/Sentry (the config field is inert), the versioned JSON layout API, and any actual cutover. Screenshot parity testing and the admin UI are **no longer** on this list.
- **Phase 2b remains incomplete, for one reason only:** cutover/rollback is undemonstrable (`cutover.map` is orphaned and there is no legacy upstream), Sentry is unwired, the preflight host checks were never recorded, and the vcpkg/Conan deviation was never resolved or explicitly accepted. The build, warnings-as-errors and sanitizer requirements are met. The CI TypeScript and Playwright steps now exist but have not yet run on CI, so they are wired rather than verified.
- **Phase 1 is still outstanding:** the plan's Phase 1 exit condition requires an OpenAPI document for the first slice, and none exists anywhere in the repository. Rules 7 and 10 make that an explicit foundation gap, not a pass. It is the next work unit after Phase 2b's remaining items, ahead of Phase 5.
- **Phase 4's exit condition is met, having been wrongly claimed once.** The admin UI now drives every implemented `/api/admin/*` resource, including collectible editing — the operation whose absence made the first claim false. Two things are deliberately *not* claimed as complete: the CI steps that run the frontend build and browser suites failed on their first run for an environmental reason that has been fixed but not yet re-observed, and Phase 5 remains gated because Phase 1's OpenAPI document and the rest of Phase 2b are still outstanding.
- **The service layer remains narrow in breadth:** it covers identity, bans, guilds, reports and CMS content. Registration, credit/pixel edits, badge saves, and group create/purchase are still unimplemented, so the "refused" rows in Phases 5–9 stay refused until each gets its own named, audited service method. The pattern is established; the breadth is not.
