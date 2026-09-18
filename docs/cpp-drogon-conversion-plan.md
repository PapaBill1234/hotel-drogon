# C++ (Drogon) + React conversion plan

## Status relative to prior plans

This supersedes the Laravel + Inertia plan for the **application layer only**.
It does not change table ownership: PolarIS still owns hotel users, rooms,
guilds, inventory, catalog, balances, and hotel-side permissions. The website
still owns `phpretro_*` tables. What changes is the language and framework
serving the website/CMS, and the frontend integration model.

**Read `phase1-parity-inventory.md` first.** Nothing in the existing `hotel`
Laravel repo is reusable as code under this plan — no Eloquent, no Blade, no
Filament, no Inertia. What is reusable is *knowledge*: the route/feature list,
the table-ownership classification, and the business rules encoded in
`Support/Homes.php` and `HolodbWriteGuard`. Port the rules, not the PHP.

## Why the frontend model changes

Inertia requires a server-side package that hands React fully-formed props on
each navigation. No such package exists for C++. The frontend becomes a
**decoupled single-page application**: React with its own client-side router
(React Router), calling the C++ backend as a pure JSON API over HTTP. Session
state is carried via a cookie issued by the API (not a framework convenience),
validated on every request. This is a real architectural shift, not a detail —
every page becomes "fetch JSON, render React," rather than "server hands you a
finished page." Build the API contract and the auth cookie flow before
porting any page content.

## Proposed stack

| Area | Choice | Why |
| --- | --- | --- |
| Backend framework | **Drogon** | Async C++ framework closest to Laravel's shape: routing, ORM, sessions, filters (middleware), JSON, WebSockets, a code generator (`drogon_ctl`). The only C++ option complete enough to avoid hand-building most of the stack. |
| Build system | CMake + vcpkg (or Conan) | Standard, reproducible dependency management; Drogon ships CMake integration. |
| Database access | Drogon ORM against MariaDB/MySQL, raw prepared statements where the ORM's query builder is insufficient | Drogon's ORM generates models from schema (`drogon_ctl create model`) and supports async queries; use it for `phpretro_*` tables. PolarIS tables are accessed only through named service classes (see Phase 3), never through generic model CRUD. |
| Sessions/cache/queues/locks | Redis (Drogon's built-in async Redis client) | Same role as in the Laravel plan — sessions, cache, rate-limit counters, job queue, distributed locks for Homes edits. |
| Background jobs | Hand-built worker process(es) consuming a Redis list/stream, or a lightweight library (e.g. Taskflow for in-process concurrency) | No Horizon equivalent exists; build a minimal worker binary that dequeues jobs (mail, media processing, cleanup) — small, but must be built, not adopted. |
| Realtime | Drogon's native WebSocket support | Replaces Reverb; same event set (minimail notifications, friend-presence, staff alerts). |
| Frontend | React + TypeScript, React Router, TanStack Query, React Hook Form + Zod | Same client-side choices as before, minus Inertia. TanStack Query now does more work than originally planned, since every page fetch is a manual API call rather than an Inertia prop. |
| API contract | JSON:API-style or a hand-defined schema, documented with OpenAPI | Needed because there's no framework gluing frontend/backend types together automatically the way Inertia did. Consider generating TypeScript types from the OpenAPI spec to avoid drift. |
| Staff CMS | Hand-built React admin section calling dedicated `/api/admin/*` endpoints | No Filament equivalent. Budget real time for this — it's a full admin app, not a config file. |
| Auth | Custom session-cookie service: server-issued signed cookie, validated per request, backed by Redis session store | Replaces Fortify. Must independently implement: login throttling, remember-me, password reset tokens, staff 2FA/step-up, CSRF protection (double-submit cookie or per-request token, since there's no framework default). |
| Styling | Existing `web-gallery` CSS/assets, served statically (nginx or Drogon's static file handler) | Unchanged from the original plan. |
| Object storage | S3-compatible (MinIO locally) | Unchanged; Drogon doesn't need to touch this directly if the frontend/CDN handles delivery and only presigned URLs are generated server-side. |
| Search | Meilisearch, called directly over its HTTP API | Unchanged intent; no Laravel Scout equivalent, so the backend calls Meilisearch's REST API directly — a thin wrapper, not a big lift. |
| Tests | Catch2 or GoogleTest (C++ backend), Vitest (React), Playwright (browser flows) | Replaces Pest; conceptually equivalent coverage. |
| Monitoring | Sentry (has a C++ SDK), Prometheus-format metrics (Drogon supports exposing these) | Same intent as before. |
| Delivery | Docker Compose (backend binary, MariaDB, Redis, worker, nginx, frontend build) + GitHub Actions (CMake build + tests) | Same shape as the Laravel Compose setup; the backend service now runs a compiled binary instead of PHP-FPM. |

## Rules that apply to every phase (unchanged from the original plan, restated)

1. Do not alter a Polaris-owned table unless a verified Polaris extension or
   emulator change explicitly requires it.
2. Preserve a legacy page's visual output (CSS classes, dimensions, copy)
   before attempting visual improvement.
3. Put every Polaris query behind a named service class with explicit,
   individually authorized methods — never a generic model or blocklist.
4. Validate every request, authorize every action, apply CSRF protection on
   every mutating endpoint, use prepared statements everywhere, encode output
   by context, and write an audit record for sensitive actions from the first
   route, not retrofitted later.
5. Add a backend test and a Playwright flow before any production route moves
   off legacy PHP.
6. Record every unsupported hotel operation as an explicit feature gap in the
   inventory doc; never simulate success or invent a Polaris table/column.
7. **New for this stack:** no raw pointer ownership across component
   boundaries — use RAII and smart pointers throughout; a memory-safety bug in
   a web-facing C++ service is a worse failure mode than the XSS bugs the
   PHPRetro audit already found. Enable sanitizers (ASan/UBSan) in CI for
   every backend test run without exception.

## Phase 1 — Architecture baseline (carried over, re-verified)

**Outcome:** the existing parity inventory re-confirmed against the new stack;
no new page inventory work needed, just re-tagging status against C++/React
instead of Laravel/Blade.

- Re-run `phase1-parity-inventory.md`'s table-ownership section unchanged —
  ownership doesn't move with the language.
- Re-tag every "Ported (Blade)" row as "Not started" under this plan, since no
  PHP code carries over. Re-tag "Refused / handoff" rows as-is — those gaps
  are about PolarIS support, not language.
- Define the OpenAPI schema skeleton for the first vertical slice (auth, `me`,
  profile) before writing any backend code, so frontend and backend can be
  built in parallel against an agreed contract.

**Exit condition:** an OpenAPI document for the first slice, and an updated
inventory table with every row re-tagged for the new stack.

## Phase 2 — Backend foundation and local delivery

**Outcome:** a Drogon binary running beside the legacy PHP site, serving
health checks and static assets, with CI compiling and testing it.

- Scaffold the Drogon project (`drogon_ctl create project`), configure
  structured logging, health-check endpoints, graceful shutdown, and
  environment-based config loading (dev/staging/prod).
- Configure Redis (sessions, cache, queue, locks) and MariaDB connections
  through Drogon's async DB client.
- Docker Compose services: backend binary, MariaDB, Redis, worker binary,
  nginx (serving `web-gallery` statics + fronting both legacy PHP and the new
  backend during cutover), frontend build container.
- CI: CMake build with sanitizers enabled, Catch2/GoogleTest run, TypeScript
  build, Playwright smoke run.
- Route switch/proxy plan identical in spirit to the Laravel version:
  `cutover.map`-style routing so individual endpoints move one at a time with
  instant rollback.
- Sentry + basic metrics wired before any public route moves.

**Exit condition:** a `/health` endpoint compiles, runs, and passes CI; the
proxy can route a single test path to the new backend and back.

## Phase 3 — Auth, authorization, Polaris access layer

**Outcome:** safe shared identity and a real, named service boundary around
PolarIS data — the single gap that blocked the Laravel attempt, rebuilt
correctly from the start this time.

- Implement session-cookie issuance/validation, password verify against
  PolarIS's existing hash format (with upgrade path if legacy hashes are
  weaker than desired), password reset tokens, remember-me, and staff
  step-up/2FA — all as explicit, testable service methods, not middleware
  side effects.
- Implement authorization as explicit policy functions per role (visitor,
  user, group member, group moderator, group owner, staff rank/capability),
  called at the top of every handler — Drogon filters can enforce "must be
  logged in," but role-specific authorization should be an explicit function
  call in each handler, checked in a test.
- Build the Polaris access layer as one class per bounded context —
  `UserAccountService`, `GuildService`, `BanService`, `ReportService` — each
  exposing only named, individually authorized methods (`recordLogin`,
  `updateMotto`, `banUser`, never a generic `update(table, data)`). This
  replaces `HolodbWriteGuard`'s blocklist entirely; the previous attempt's
  core mistake was building a blocklist instead of this.
- CSRF: implement double-submit-cookie or synchronizer-token CSRF on every
  mutating endpoint from day one — do not repeat the Laravel branch's
  blanket-exemption mistake. Write a test that fails the build if a POST/PUT/
  DELETE route lacks CSRF enforcement.
- Audit logging as a cross-cutting service, called explicitly from every
  service method that mutates state — not bolted onto one or two paths.

**Exit condition:** a user can authenticate via the API, the frontend can
fetch `/api/me`, a staff-only endpoint rejects non-staff correctly under test,
and grepping the codebase shows zero direct PolarIS table access outside the
named service classes.

## Phase 4 — CMS and public content

**Outcome:** staff manage content through a hand-built admin API + React
admin UI; public pages served as JSON from Drogon, rendered by React.

- `phpretro_*` models via Drogon ORM for news, campaigns, collectables,
  banners, FAQ, site settings, maintenance, page content.
- Build `/api/admin/*` endpoints for CRUD with validation, audit history, and
  role gates — this is the Filament replacement, and it is real UI + backend
  work, not configuration. Budget accordingly.
- Raw-HTML/script content fields (banner HTML, tracking snippets) get
  dedicated high-trust permission checks and a visible warning in the admin
  UI, same as the original plan intended.
- Public landing, community, articles, FAQ, collectables, maintenance, and RSS
  become React pages fetching from `/api/public/*` endpoints.
- Playwright screenshot tests against the legacy PHP pages as the visual
  baseline, run in CI before any route cuts over.

**Exit condition:** staff can manage public content through the new admin UI,
and converted public pages match legacy screenshots within tolerance.

## Phase 5 — Account, profile, credits, Club, client entry

**Outcome:** core user journeys work end-to-end through the API + React.

- `/api/account/*` endpoints: register (if/when supported — see gap below),
  login, logout, forgot/reset password, reauthenticate, profile read/update,
  `me`, credits/history read, client-entry handoff.
- Registration: this plan doesn't change the underlying fact that
  registration writing directly into PolarIS `users` is a real, auditable
  operation — implement it as a named `UserAccountService::registerAccount`
  method with full validation, not a refusal, once you're ready to trust
  writes through the new service layer. Until then, mark it explicitly
  refused in the inventory rather than silently stubbed.
- Club display, voucher redemption, native purchase: explicit handoffs unless
  a verified Polaris/Nitro integration exists — same non-goal as before.

**Exit condition:** a new or existing user can complete every supported
account journey through the React frontend, with Playwright coverage.

## Phase 6 — Messaging and friend management

**Outcome:** minimail and friend flows as real JSON APIs, not HTML fragments.

- `/api/minimail/*` endpoints: list, thread, compose, delete, mark-read.
- `/api/friends/*`: requests, search, categories, presence.
- WebSocket channel for new-mail and presence events via Drogon's native
  WebSocket support.
- Rate-limiting and anti-spam as explicit service-layer checks (Redis-backed
  counters), tested for the "send 100 mails a second" case specifically.

**Exit condition:** full minimail/friends flow works through React + WebSocket
push, with tests covering unauthorized read/delete attempts.

## Phase 7 — Groups, discussions, group profile

**Outcome:** group browsing/administration against real PolarIS guild data,
through named service methods.

- `GuildService` methods: join, leave, create, settings update, member list,
  moderation actions — each individually authorized and audited.
- Forum topics/posts/moderation via `/api/discussions/*`.
- BBCode/rich-text rendering through a defined allowlist library (a small,
  well-audited C++ component or a call out to a sandboxed renderer — do not
  hand-roll HTML sanitization).
- Badge editing, room transfer: explicit client handoffs, unchanged from the
  original plan's non-goals.

**Exit condition:** owner/moderator/member/visitor flows pass authorization
and Playwright tests.

## Phase 8 — MyHabbo Homes editor

**Outcome:** the interactive editor, rebuilt deliberately as the original plan
intended — this phase's scope doesn't change, only its implementation
language.

- Versioned JSON layout API (`/api/homes/{id}/layout`, with optimistic
  concurrency via a version field) served by Drogon, backed by
  `phpretro_myhabbo_*` tables.
- React + dnd-kit for the canvas/drag-drop, TanStack Query for cached layout
  state and optimistic updates with rollback on version conflict.
- Redis-backed distributed lock per home during an active edit session to
  prevent two staff/users corrupting one layout simultaneously.
- Group Homes only after user Homes passes all interaction and concurrency
  tests, per the original sequencing.

**Exit condition:** concurrent edits don't silently overwrite each other,
and drag/drop interaction plus screenshot tests match the legacy experience.

## Phase 9 — Housekeeping replacement

**Outcome:** all supported staff workflows run through the new admin API and
React admin UI — no PHP anywhere.

- `/api/admin/*` resources for user management, moderation, bans, alerts,
  news, banners, campaigns, catalogue, collectables, vouchers, reports, logs,
  staff sessions, settings — each backed by a named PolarIS service method
  with confirmation flows for destructive actions.
- RCON/API integration for alerts and any live-emulator commands, implemented
  against a verified Polaris/Nitro interface — do not ship a control that
  silently no-ops.
- Load, authorization, audit-log, and failure-mode tests for every admin
  action.

**Exit condition:** staff operate every supported function through the new
admin UI, every action attributed and reversible where possible.

## Phase 10 — Cutover, hardening, and legacy retirement

**Outcome:** the C++/React stack becomes the production website.

- Route-by-route parallel verification against production-like traffic,
  comparing responses, logs, and database effects to the legacy PHP behavior.
- Full security review: SQLi (should be structurally hard given prepared
  statements throughout), XSS, CSRF, IDOR, session fixation, memory-safety
  review with sanitizers/fuzzing on any endpoint parsing untrusted input
  (this replaces the "PHP audit" step with a C++-specific one — memory bugs
  are the new category of risk this stack introduces).
- Accessibility, performance, cache, queue, backup/recovery, and
  observability checks.
- Gradual cutover via the proxy map, tested rollback path, legacy PHP
  archived only after stable operation.
- Publish/update the unsupported-feature register (Trax, native Club
  purchase, voucher redemption, room transfer, badge editing — unchanged from
  the original plan, since these are emulator-bound, not language-bound).

**Exit condition:** all planned routes serve the C++/React stack, legacy PHP
is retired, remaining hotel-side work tracked separately against
Polaris/Nitro.

## Suggested first delivery slice

Phase 2 in full, plus the smallest safe slice of Phase 3 and Phase 5: backend
foundation, auth service with real session cookies, `/api/me`, profile read,
client-entry handoff, and the React shell rendering them. This proves the
decoupled-API architecture actually works end-to-end — auth cookie flow,
CSRF, CORS if the frontend is served from a different origin — before any
high-complexity work (Homes, admin CMS) begins.

## Deliberate non-goals (unchanged from the original plan)

- Rebuilding Flash assets as React components.
- Changing Polaris schema ownership for convenience.
- A visual redesign during parity work.
- Declaring emulator-limited actions complete without verified Polaris/Nitro
  support.
- **New:** treating this as a performance project. There is no measured
  throughput problem in the current site that justifies the language switch;
  don't let "C++ is fast" become an excuse to skip validation, sanitization,
  or the service-layer discipline in Phase 3. The website's job is I/O-bound
  (DB and cache round-trips), not compute-bound — Drogon's async model
  covers that; hand-tuned C++ hot loops are not where this project's risk or
  reward lives.
