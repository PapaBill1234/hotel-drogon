# C++ (Drogon) + React conversion plan

<!-- AI_CONTEXT_ID: hotel-drogon-plan-v1 -->

## AI context and prompt-cache contract

This is the single, stable source of truth for architecture, safety rules,
phase scope, decision gates, and exit conditions. It deliberately contains no
current phase, timestamps, latest commit, completed-work log, or other mutable
state. Normal implementation work must not edit this file. Record progress in
`phase1-parity-inventory.md` (and, if present, `ai-run-state.md`) instead.

For a deliberate architecture change, edit this file once, change
`AI_CONTEXT_ID`, commit the new version, and expect the prompt cache to be cold
until the new prefix is persisted. Do not make cosmetic edits, reorder
sections, rewrite whitespace, or inject generated metadata into this file.

For clients that support project/system instructions, assemble every request
in this exact order:

1. pinned client system text and a pinned, consistently ordered tool schema;
2. this file, byte-for-byte;
3. the byte-stable runner from `cpp-conversion-prompts.md`;
4. mutable inventory/state, repository status, tool results, and conversation;
5. the smallest possible task-specific suffix.

A file that is merely available in the repository is not automatically part
of the API prompt prefix. If the coding client only exposes it after the model
chooses a file-read tool, cross-session cache reuse of this document is
best-effort. Configure the client to inject this document before mutable user
content when possible. Never pad the document just to improve a percentage;
measure cache-miss tokens, cost per completed task, and time to first token as
well as the hit ratio.

## Status relative to prior plans

This supersedes the Laravel + Inertia plan for the **application layer only**.
It does not change table ownership: PolarIS still owns hotel users, rooms,
guilds, inventory, catalog, balances, and hotel-side permissions. The website
still owns `phpretro_*` tables. What changes is the language and framework
serving the website/CMS, and the frontend integration model.

**After reading this plan, read `phase1-parity-inventory.md` before taking any
action.** Nothing in the existing `hotel` Laravel repo is reusable as code
under this plan — no Eloquent, no Blade, no Filament, no Inertia. What is
reusable is *knowledge*: the route/feature list, the table-ownership
classification, and the business rules encoded in `Support/Homes.php` and
`HolodbWriteGuard`. Port the rules, not the PHP.

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
| Build system | **CMake + Ninja against Ubuntu 24.04 archive packages, from a base image pinned by digest, with direct dependency versions pinned** | Reproducible without a dependency manager, and the only source that supplies Drogon **1.8.7**, the version this code is written and built against. Chosen 2026-09-21 over vcpkg/Conan on evidence: both registries now resolve Drogon **1.9.13**, against which this code does not pass its required `-Werror` build, and a vcpkg dependency/toolchain resolution alone measured 317s against a 41s full CI build. Supplying 1.8.7 through either manager would need a historical baseline, overlay port or custom recipe with ongoing maintenance. Pins make a build repeatable; they do **not** remove the need for security updates — updating is a documented, deliberate step. Procedure: `docs/dependency-policy.md`. |
| Database access | Typed data-access structs behind named-method service classes (e.g. `ContentService`, `UserAccountService`), backed by parameterized SQL or Drogon's lightweight query builder | One consistent access idiom for all tables, not just PolarIS-owned ones. Do not generate `drogon::orm::DrogonModel` subclasses and expose them directly to controllers — that introduces a second, inconsistent data-access pattern. PolarIS tables are accessed only through named service classes (see Phase 3); `phpretro_*` CMS tables follow the same pattern for consistency, even though their risk profile is lower. |
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
| Monitoring | Sentry, Prometheus-format metrics (Drogon supports exposing these) | Same intent as before. Sentry does ship a C/C++ SDK (`sentry-native`), but **no such package exists in the Ubuntu 24.04 archive**, so obtaining it is a dependency decision — see the Phase 10 observability gate. Metrics are already implemented. |
| Delivery | Docker Compose when supported; otherwise native systemd services + nginx; GitHub Actions for CMake build/tests | Preserve the same service boundaries on either host path; the backend runs as a compiled binary rather than PHP-FPM. |

## Rules that apply to every phase

1. Do not alter the schema of a PolarIS-owned table unless a verified PolarIS
   extension or emulator change explicitly requires it. Data writes are
   allowed only through the named, authorized, audited service methods defined
   below.
2. Preserve a legacy page's visual output (CSS classes, dimensions, copy)
   before attempting visual improvement.
3. Put every PolarIS query behind a named service class with explicit,
   individually authorized methods — never a generic model or blocklist.
4. Validate every request, authorize every action, apply CSRF protection on
   every mutating endpoint, use prepared statements everywhere, encode output
   by context, and write an audit record for sensitive actions from the first
   route, not retrofitted later.
5. Add a backend test and a Playwright flow before any production route moves
   off legacy PHP.
6. Record every unsupported hotel operation as an explicit feature gap in the
   inventory doc; never simulate success or invent a PolarIS table/column.
7. **New for this stack:** no raw pointer ownership across component
   boundaries — use RAII and smart pointers throughout; a memory-safety bug in
   a web-facing C++ service is a worse failure mode than the XSS bugs the
   PHPRetro audit already found. Enable sanitizers (ASan/UBSan) in CI for
   every backend test run without exception.
8. The read-only checkout at `/legacy/phpretro-pdo` is the behavioral source
   of truth. Before implementing a feature, locate and read its legacy PHP
   implementation. Match validation, authorization, edge cases, messages, and
   database effects, but port the behavior idiomatically rather than copying
   PHP syntax. Flag buggy or unsafe legacy behavior instead of silently
   copying or changing it.
9. Do not introduce a dependency or external service that is not already in
   the stack table without approval. State the candidate and why it is needed
   before installing it.
10. Before claiming a phase or work unit complete, update
    `phase1-parity-inventory.md`, check the applicable exit condition line by
    line, run every available verification, and report commands plus results.
    A deferred or unavailable build/test is an explicit gap, never a pass.
11. Commit and push after each meaningful, verified step with a phase-specific
    message. Do not overwrite unrelated user changes, rewrite shared history,
    or leave known work uncommitted at the end of a session. If credentials or
    remote access prevent a push, preserve the local commit and report the
    blocker exactly.
12. At the start of a run, read this file completely, then read the mutable
    inventory/state. State the selected phase, the smallest work unit, its
    relevant exit checks, and any blocking decision before editing code.

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

## Phase 2 — Repository and reference setup

**Outcome:** the existing `hotel-drogon` repository has a documented source
layout, and the legacy implementation is available locally as a read-only
behavioral reference. Build tooling remains an explicit Phase 2b gap.

- Use the existing repository at
  `https://github.com/PapaBill1234/hotel-drogon`; do not create a replacement.
  Confirm fetch and push access before making implementation changes.
- Clone `https://github.com/PapaBill1234/PHPRetro-PDO` to
  `/legacy/phpretro-pdo` as a read-only reference. Do not make it a submodule
  and do not commit its contents into `hotel-drogon`.
- Create and document a consistent project skeleton, including `src/`,
  `src/services/`, `src/controllers/`, and `include/` (or the chosen
  equivalents). Empty directories need a tracked placeholder if Git must
  preserve them.
- Do not add CMake, vcpkg/Conan, Docker, CI, or proxy/cutover configuration in
  this phase. Record that verification is deferred to Phase 2b.

**Exit condition:** `/legacy/phpretro-pdo` is cloned and browsable; the
documented directory skeleton exists in `hotel-drogon`, is committed, and is
pushed; the inventory clearly records the Phase 2b build-verification gap.

## Phase 2b — Build, containerize, and verify

**Timing:** run after enough real application code exists to exercise the
architecture, but before trusting or deploying that code. Deferral is allowed;
silent omission is not.

**Outcome:** all code written so far builds, runs, and is verified in the
actual host environment, with accumulated write-first defects made explicit.

- Preflight first: run `g++ --version` (or Clang), `cmake --version`,
  `git --version`, `systemd-detect-virt`, `docker --version`, and `docker ps`.
  Report the results before infrastructure changes. If virtualization is
  OpenVZ/LXC or Docker cannot access its socket, stop Docker work and use the
  native path; do not spend the phase trying to bypass host restrictions.
- Choose the dependency strategy and explain it, then set up CMake and compile all
  existing code. Syntax-only fixes may proceed; stop for a real behavior or
  design decision. **Decided 2026-09-21: pinned Ubuntu 24.04 archive packages**,
  with the base image pinned by digest and direct dependencies pinned by version
  (`docs/dependency-policy.md` carries the procedure and the measurements, and
  the "Build system" row above carries the rationale). vcpkg and Conan are not
  used for the toolchain: both resolve Drogon 1.9.13, against which this code does
  not pass the required `-Werror` build. Migrating to 1.9.13 is a separate,
  currently unjustified work unit, not an impossibility. Do not mix package
  ecosystems by adding vcpkg for individual libraries.
- Enable warnings-as-errors plus ASan/UBSan for the test build. Fix every
  warning and sanitizer finding, and report the complete list rather than
  absorbing it silently.
- Add structured logging, `/health`, graceful shutdown, and environment-based
  configuration. Connect Drogon's async MariaDB and Redis clients and prove
  the existing service methods work against real test data.
- If Docker works, provide Compose services for the backend, MariaDB, Redis,
  worker, nginx, and frontend build. Otherwise install/configure native
  MariaDB, Redis, and nginx services plus a restartable systemd unit for the
  Drogon binary, and document the native-deployment limitation.
- Add CI for the sanitizer-enabled CMake build and tests, TypeScript build,
  and Playwright smoke tests. CI runs on hosted runners even when the VPS
  cannot run Docker.
- Implement a route-switch/proxy map and demonstrate both cutover and rollback
  for one real test route. Wire a basic metrics endpoint (done:
  `/metrics`). **Sentry is a Phase 10 decision gate**, not a Phase 2b
  deliverable — see that phase for why.

**Exit condition:** everything written so far compiles without warnings under
the sanitizer configuration, passes CI, runs through either Compose or native
systemd services, and a real test route can be switched to Drogon and rolled
back. Report every change needed to repair deferred write-first code.

## Phase 3 — Auth, authorization, PolarIS access layer

**Outcome:** safe shared identity and a real, named service boundary around
PolarIS data — the single gap that blocked the Laravel attempt, rebuilt
correctly from the start this time.

- Before coding, locate and read the legacy login entry point plus
  `account.php`, `forgot.php`, `reauthenticate.php`, `security_check.php`, and
  any housekeeping staff-session or two-factor files. Determine the real
  password-hash format from code/data rather than guessing. The inventory
  flags legacy session IP-lock behavior as a usability issue; treat whether
  to preserve it as a decision gate.
- Implement session-cookie issuance/validation, password verify against
  PolarIS's existing hash format (with upgrade path if legacy hashes are
  weaker than desired), password reset tokens, remember-me, and staff
  step-up/2FA — all as explicit, testable service methods, not middleware
  side effects. Staff step-up must use a separate cookie/session from the
  public user session.
- Implement authorization as explicit policy functions per role (visitor,
  user, group member, group moderator, group owner, staff rank/capability),
  called at the top of every handler — Drogon filters can enforce "must be
  logged in," but role-specific authorization should be an explicit function
  call in each handler, checked in a test.
- Build the PolarIS access layer as one class per bounded context —
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
named service classes. Include the grep command and its output in the report,
and update every affected refused/gap row in the inventory with either the
new service method or the still-blocking reason.

## Phase 4 — CMS and public content

**Outcome:** staff manage content through a hand-built admin API + React
admin UI; public pages served as JSON from Drogon, rendered by React.

- Before coding, read the legacy implementations of `landing.php`,
  `community.php`, `articles.php`, `help.php`, `collectables.php`,
  `maintenance.php`, `maintenance_new.php`, and `xml/rss.php`. The known RSS
  double-escaping defect must be fixed deliberately and documented, not
  reproduced as parity.
- `phpretro_*` data accessed via a `ContentService`-style class with named
  methods (`publishNews`, `updateBanner`, etc.), matching the Phase 3 pattern
  — not generated Drogon ORM model classes — for news, campaigns, collectables,
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
  baseline, run in CI before any route cuts over. If reference screenshots do
  not exist, stop the comparison work and capture/approve them first.

**Exit condition:** staff can manage public content through the new admin UI,
and converted public pages match legacy screenshots within tolerance.

## Phase 5 — Account, profile, credits, Club, client entry

**Outcome:** core user journeys work end-to-end through the API + React.

- Before coding, read the legacy `account.php`, `register.php`, `profile.php`,
  `me.php`, `history.php`, `client.php`, `clientutils.php`, and
  `intermediate.php` behavior.
- `/api/account/*` endpoints: register (if/when supported — see gap below),
  login, logout, forgot/reset password, reauthenticate, profile read/update,
  `me`, credits/history read, client-entry handoff.
- Registration: this plan doesn't change the underlying fact that
  registration writing directly into PolarIS `users` is a real, auditable
  operation — implement it as a named `UserAccountService::registerAccount`
  method with full validation, not a refusal, only after an explicit decision
  to trust that write path. If that decision has not been recorded, stop and
  ask. Until then, mark it explicitly refused in the inventory rather than
  silently stubbing it.
- Club display, voucher redemption, native purchase: explicit handoffs unless
  a verified PolarIS/Nitro integration exists — same non-goal as before.
- Add Playwright coverage for existing-user login, password reset, and client
  entry, plus new-user registration only when registration is enabled.

**Exit condition:** a new or existing user can complete every supported
account journey through the React frontend, with Playwright coverage.

## Phase 6 — Messaging and friend management

**Outcome:** minimail and friend flows as real JSON APIs, not HTML fragments.

- Before coding, search the legacy `includes/` and `habblet/` trees (and the
  rest of the checkout as needed) for minimail and friend behavior, including
  rate-limit constants and ownership checks.
- `/api/minimail/*` endpoints: list, thread, compose, delete, mark-read.
- `/api/friends/*`: requests, search, categories, presence.
- WebSocket channel for new-mail and presence events via Drogon's native
  WebSocket support.
- Rate-limiting and anti-spam as explicit service-layer checks (Redis-backed
  counters), tested for the "send 100 mails a second" case specifically.
- Test attempts to read or delete another user's mail and to send as another
  account; each must be rejected.

**Exit condition:** full minimail/friends flow works through React + WebSocket
push, with tests covering unauthorized read/delete attempts.

## Phase 7 — Groups, discussions, group profile

**Outcome:** group browsing/administration against real PolarIS guild data,
through named service methods.

- Before coding, read legacy `club.php`, `discussions.php`, and every relevant
  guild/group implementation found under `includes/`.
- `GuildService` methods: join, leave, create, settings update, member list,
  moderation actions — each individually authorized and audited.
- Forum topics/posts/moderation via `/api/discussions/*`.
- BBCode/rich-text rendering through a defined allowlist library (a small,
  well-audited C++ component or a call out to a sandboxed renderer — do not
  hand-roll HTML sanitization). This is a dependency decision gate: present
  the chosen library and rationale before installing it.
- Badge editing, room transfer: explicit client handoffs, unchanged from the
  original plan's non-goals.

**Exit condition:** owner/moderator/member/visitor flows pass authorization
and Playwright tests.

## Phase 8 — MyHabbo Homes editor

**Outcome:** the interactive editor, rebuilt deliberately as the original plan
intended — this phase's scope doesn't change, only its implementation
language.

- Before designing the API, read every Homes/MyHabbo legacy file and inventory
  the widget types, layout model, ratings, guestbook behavior, and permission
  rules. Transport changes to JSON; feature behavior does not silently change.
- Versioned JSON layout API (`/api/homes/{id}/layout`, with optimistic
  concurrency via a version field) served by Drogon, backed by
  `phpretro_myhabbo_*` tables. Present the request/response and conflict schema
  for approval before implementation.
- React + dnd-kit for the canvas/drag-drop, TanStack Query for cached layout
  state and optimistic updates with rollback on version conflict.
- Redis-backed distributed lock per home during an active edit session to
  prevent two staff/users corrupting one layout simultaneously. Test two
  concurrent edits and prove that the loser is rejected or safely merged,
  never silently overwritten.
- Group Homes only after user Homes passes all interaction and concurrency
  tests, per the original sequencing.

**Exit condition:** concurrent edits don't silently overwrite each other,
and drag/drop interaction plus screenshot tests match the legacy experience.

## Phase 9 — Housekeeping replacement

**Outcome:** all supported staff workflows run through the new admin API and
React admin UI — no PHP anywhere.

- Before coding, read every file under legacy `housekeeping/`. Convert any
  safety check that existed only as a form or JavaScript confirmation into an
  enforceable server-side API rule.
- `/api/admin/*` resources for user management, moderation, bans, alerts,
  news, banners, campaigns, catalogue, collectables, vouchers, reports, logs,
  staff sessions, settings — each backed by a named PolarIS service method
  with confirmation flows for destructive actions. Bans and credit changes
  require a second explicit server-side confirmation, not only a UI dialog.
- RCON/API integration for alerts and any live-emulator commands, implemented
  against a verified PolarIS/Nitro interface — do not ship a control that
  silently no-ops.
- Load, authorization, audit-log, and failure-mode tests for every admin
  action, including partial write failure and its database/audit consistency.

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
  observability checks, reported with measured latency, memory, and error
  rates rather than qualitative claims.
- **Observability decision gate — Sentry.** Moved here from Phase 2b on
  2026-09-21, because it is a dependency decision rather than build verification,
  and because it cannot be satisfied the way Phase 2b's other items were. State of
  the evidence: `/metrics` (Prometheus text) is already implemented;
  `AppConfig::sentry_dsn` exists but is inert, with no SDK linked and nothing ever
  reported; **no Sentry C++ SDK was found in the Ubuntu 24.04 archive** (the
  archive carries Go, Python, Rust and JavaScript clients only); and a measured
  x64-linux `sentry-native` vcpkg probe failed while building `libunwind`. That
  probe does not establish that the port is universally broken — only that it did
  not build in this environment on this date. Resolve it deliberately at cutover:
  either approve a dependency source for `sentry-native` (a pinned vcpkg baseline
  is the obvious candidate, and it is the one place mixing ecosystems would be
  considered on its merits), or downgrade the requirement and record the
  resulting observability gap. Do not infer a pass from the fact that the config
  field exists.
- Gradual cutover via the proxy map, tested rollback path, legacy PHP
  archived only after stable operation.
- Publish/update the unsupported-feature register (Trax, native Club
  purchase, voucher redemption, room transfer, badge editing — unchanged from
  the original plan, since these are emulator-bound, not language-bound).

**Exit condition:** all planned routes serve the C++/React stack, legacy PHP
is retired, remaining hotel-side work tracked separately against
PolarIS/Nitro, and the user has reviewed the security-review results before
the phase is marked complete.

## Suggested first delivery slice

Phase 2, then the smallest safe slice of Phase 3 and Phase 5: an auth service
with real session cookies, `/api/me`, profile read, client-entry handoff, and
the React shell rendering them. Run Phase 2b as soon as this slice is large
enough to exercise the architecture. This proves the decoupled API end to end
— build/link integrity, auth cookie flow, CSRF, and CORS if the frontend is on
a different origin — before high-complexity work such as Homes or the admin
CMS compounds an unverified foundation.

## Deliberate non-goals (unchanged from the original plan)

- Rebuilding Flash assets as React components.
- Changing PolarIS schema ownership for convenience.
- A visual redesign during parity work.
- Declaring emulator-limited actions complete without verified PolarIS/Nitro
  support.
- **New:** treating this as a performance project. There is no measured
  throughput problem in the current site that justifies the language switch;
  don't let "C++ is fast" become an excuse to skip validation, sanitization,
  or the service-layer discipline in Phase 3. The website's job is I/O-bound
  (DB and cache round-trips), not compute-bound — Drogon's async model
  covers that; hand-tuned C++ hot loops are not where this project's risk or
  reward lives.
