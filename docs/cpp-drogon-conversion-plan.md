# C++ (Drogon) + React conversion plan

<!-- AI_CONTEXT_ID: hotel-drogon-plan-v2 -->

## AI context and prompt-cache contract

This is the single, stable source of truth for architecture, safety rules,
outcome milestones, phase scope, decision gates, and exit conditions. It
deliberately contains no current phase, latest commit, completed-work log, or
other mutable state. Normal implementation work must not edit this file. Record
progress in `phase1-parity-inventory.md` and `ai-run-state.md` instead.

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
finished page." For each new vertical slice, document the API contract and
auth cookie flow before extending the frontend. Where routes already exist,
derive the contract from their actual request, response, and failure behavior;
do not invent a specification and call it implemented.

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
| Auth | Custom session-cookie service: opaque random tokens in HttpOnly public and staff cookies, validated against separate Redis session keyspaces | Replaces Fortify. Must independently implement: login throttling, remember-me, password reset tokens, staff 2FA/step-up, CSRF protection (double-submit cookie or per-request token, since there's no framework default). |
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
8. A read-only PHPRetro-PDO checkout is the behavioral source of truth. This
   repository's Compose file mounts assets from `../legacy/phpretro-pdo`;
   verify the actual host path and checkout before using it. Before
   implementing a feature, locate and read its legacy PHP
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

## Failure escalation and data safety

These standing rules apply to every work unit:

- Stop and request review after two consecutive attempted fixes produce
  materially the same failing step, assertion, or error signature. Do not make
  a third implementation change for that signature.
- Stop when one work unit reaches five failed CI or verification iterations in
  total, even if signatures differ. A distinct failure supported by logs or
  artifacts can reset the same-signature count, never the total.
- Stop immediately if required evidence is inaccessible, credentials or
  authority are missing, a destructive action appears necessary, or the next
  action is a plan-defined decision gate. Preserve safe work and report the
  run IDs, exact failing step and log excerpt, attempted commits and fixes,
  disproved hypotheses, Git/working-tree state, and one focused request.
- Never hide, bypass, or mark a failing check as passed. Do not increase waits,
  retries, timeouts, or tolerances without direct evidence that timing or
  tolerance caused the failure.
- Never run a destructive operation on the primary hotel or legacy stack
  without the user's explicit prior approval. This includes
  `docker compose down -v` or `down --volumes`, `docker volume rm` or
  `docker volume prune`, `docker system prune --volumes`, raw
  `DROP`/`TRUNCATE`, and deleting bind-mounted data. Reproduce CI failures
  only in an isolated, disposable Compose project with its own name, network,
  and volumes. Verify isolation before running and again before teardown;
  tear down only that disposable project.

## Outcome milestones and completion rules

The numbered phases below retain their technical scope and already verified
phase exits. These milestones define what must work for users and for release;
passing a narrower phase check never proves a broader milestone.

1. **Reproducible existing application.** Complete the Compose frontend build
   service, give the worker a truthful health state, document the implemented
   auth/`me`/profile API in OpenAPI, and verify CI and a fresh-checkout start.
   Compose reads legacy CSS/images from a sibling read-only checkout. Document
   that prerequisite until there is a permitted, versioned
   asset source or a reproducible acquisition step. Verify redistribution
   rights before packaging legacy assets.
2. **Complete existing-user journey.** Sign in, fetch `/api/me`, view and edit
   supported profile fields, inspect credits/history, and enter Nitro through
   a verified PolarIS/Nitro handoff. Cover logout, expiry, and unauthorized
   paths. Password reset and registration are separate work units. The
   PolarIS `users` registration write remains a decision gate. Staff actions
   cannot be accepted for release until step-up validates a real enrolled
   per-staff secret and is tested end to end.
3. **Finished public pages and content panel.** Keep the six measured public
   screenshot baselines. Review the actual housekeeping pages separately in a
   browser for visual fidelity, keyboard use, and each existing CMS flow;
   record intentional differences and fix material ones. Public screenshot
   parity does not certify admin appearance or usability.
4. **Feature families in vertical slices.** Deliver minimail (list, read,
   send, ownership and spam tests), then friend requests/presence, then
   groups/discussions, then user Homes and group Homes, then remaining
   housekeeping operations. Each slice uses verified legacy and emulator
   behavior, only the required schema, named service methods, routes, React
   UI, authorization, CSRF, audit, focused tests, and inventory updates.
   Add realtime push after a basic flow produces a real event; do not build
   generic repository machinery or emulator writes ahead of evidence.
5. **Cutover and hardening.** Exercise a fresh install, backup and recovery,
   asset provenance, public/admin UI acceptance, measured performance, and a
   supported/unsupported operation list. Obtain an independent security
   review including C++ memory-safety risks before retiring PHP. Sentry
   remains the Phase 10 decision gate.
6. **Separate browser-native Flash replacement.** Inventory and decompile
   each SWF, document behavior, assets, and protocols, then implement HTML5
   interfaces without Ruffle. Trax save/play requires verified PolarIS/Nitro
   capability. This milestone is tracked separately from the first CMS
   release and never silently counted as complete.

## Development and verification loop

Before changing build tooling, record wall time for cold and warm clean C++
builds, one `.cpp` edit, a widely included header edit, each executable link,
a docs-only `docker compose build`, the frontend build, and all three CI
jobs. The recorded clean-build time does not measure the incremental edit
loop. Audit Docker build inputs before trying a small `.dockerignore` or a
narrower `COPY`; verify the resulting image, Catch2 suite, and integration.
Hosted CI needs a persistent cache before claiming reuse across runs.

During a coding work unit, use an incremental CMake/Ninja build and the
relevant focused unit, API, or browser check. At the coherent work-unit
boundary, run every applicable sanitizer, security lint, integration/browser,
and CI gate before claiming verification or pushing a claimed pass. Never
weaken CSRF, ownership checks, ASan/UBSan, or the data-safety rules for speed.
Track cache-miss tokens, cost, and elapsed time per completed work unit, not
only cache-hit percentage.

Consider ccache only if repeated compilation and a persistent cache justify
it; mold only if linking is slow; PCH only if header parsing dominates and the
chosen CMake target actually exists (for example `hotel_core`). Compare any
tool against the same cold/warm build and representative work unit before and
after. Do not assume Clang is faster than GCC. `drogon_ctl` may generate
boilerplate, but cannot prove behavior. A watcher for this Ninja project must
invoke `cmake --build build --parallel` and fit the host workflow. Add a tool
to the pinned build only when measured gain exceeds dependency and maintenance
cost, subject to rule 9.

## Phase 1 — Architecture baseline (carried over, re-verified)

**Outcome:** table ownership and the current C++/React inventory are explicit,
and the first account API contract describes the implementation that exists.

- Keep PolarIS and website/CMS table ownership unchanged. Retain the
  superseded Laravel read in the archive; current status must describe Drogon
  and React, including explicit unsupported and unverified operations.
- Write the OpenAPI slice for implemented auth, `/api/me` as the existing
  profile read, and the current profile mutation routes. Verify request bodies,
  responses, cookies, status codes,
  and failure behavior against controllers and live routes before using it for
  the next frontend unit. Do not document an unimplemented route as working.
- For later slices, agree a contract before adding backend and frontend code.

**Exit condition:** an OpenAPI document matching the implemented first slice,
validated against live behavior, and a current per-feature inventory.

## Phase 2 — Repository and reference setup

**Outcome:** the existing `hotel-drogon` repository has a documented source
layout, and the legacy implementation is available locally as a read-only
behavioral reference. Build tooling remains an explicit Phase 2b gap.

- Use the existing repository at
  `https://github.com/PapaBill1234/hotel-drogon`; do not create a replacement.
  Confirm fetch and push access before making implementation changes.
- Clone `https://github.com/PapaBill1234/PHPRetro-PDO` as a read-only
  reference at the sibling asset path configured in `compose.yaml`
  (`../legacy/phpretro-pdo` in a normal local checkout), or document the
  host's equivalent resolved path. Do not make it a submodule and do not
  commit its contents into `hotel-drogon`.
- Create and document a consistent project skeleton, including `src/`,
  `src/services/`, `src/controllers/`, and `include/` (or the chosen
  equivalents). Empty directories need a tracked placeholder if Git must
  preserve them.
- Do not add CMake, vcpkg/Conan, Docker, CI, or proxy/cutover configuration in
  this phase. Record that verification is deferred to Phase 2b.

**Exit condition:** the configured read-only PHPRetro-PDO checkout is browsable; the
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
- The worker's health report must test the worker or be disabled when no
  meaningful probe exists; an inherited HTTP server probe is not evidence
  that the worker failed. Verify the Compose frontend build supplies the
  bundle nginx serves without an out-of-band host build.
- Add CI for the sanitizer-enabled CMake build and tests, TypeScript build,
  and Playwright smoke tests. CI runs on hosted runners even when the VPS
  cannot run Docker.
- Implement a route-switch/proxy map and demonstrate both cutover and rollback
  for one real test route. Wire a basic metrics endpoint (done:
  `/metrics`). **Sentry is a Phase 10 decision gate**, not a Phase 2b
  deliverable — see that phase for why.

**Exit condition:** everything written so far compiles without warnings under
the sanitizer configuration, passes CI, runs through either Compose or native
systemd services with a truthful worker health state and reproducible frontend
bundle, and a real test route can be switched to Drogon and rolled back.
Report every change needed to repair deferred write-first code.

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
  public user session and verify a real enrolled per-staff secret. A code's
  presence or format alone is never successful 2FA.
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
new service method or the still-blocking reason. This narrow exit does not
certify password reset, remember-me, or genuine staff 2FA; track those
separately and require real enrolled-secret step-up before staff release.

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
- Public landing, community, articles, FAQ, collectables, and maintenance
  become React pages fetching from `/api/public/*` endpoints; RSS remains an
  XML endpoint.
- Playwright screenshot tests against the legacy PHP pages as the visual
  baseline, run in CI before any route cuts over. If reference screenshots do
  not exist, stop the comparison work and capture/approve them first.

**Exit condition:** staff can manage public content through the new admin UI,
and converted public pages match legacy screenshots within tolerance. This
checks the existing CMS flows and public visual baselines only. The separate
admin visual, keyboard, and usability review in milestone 3 remains required
before calling the panel finished.

## Phase 5 — Account, profile, credits, Club, client entry

**Outcome:** supported account journeys work end to end through the API and
React, beginning with an existing user.

- Before coding, read the legacy `account.php`, `register.php`, `profile.php`,
  `me.php`, `history.php`, `client.php`, `clientutils.php`, and
  `intermediate.php` behavior.
- First complete the existing-user path: login, `/api/me`, profile read and
  supported edits, credits/history read, and client-entry handoff verified
  against PolarIS/Nitro. Test logout, expired sessions, and unauthorized
  requests. Read and document the actual route contracts before adding React
  screens; existing service methods alone are not a finished journey.
- Implement forgot/reset password and reauthentication in a separate slice,
  with their own token, expiry, and failure tests.
- Registration: this plan doesn't change the underlying fact that
  registration writing directly into PolarIS `users` is a real, auditable
  operation — implement it as a named `UserAccountService::registerAccount`
  method with full validation, not a refusal, only after an explicit decision
  to trust that write path. If that decision has not been recorded, stop and
  ask. Until then, mark it explicitly refused in the inventory rather than
  silently stubbing it.
- Club display, voucher redemption, native purchase: explicit handoffs unless
  a verified PolarIS/Nitro integration exists — same non-goal as before.
- Add Playwright coverage for each supported journey, including its error and
  unauthorized paths. Registration coverage is required only if its write
  path is approved and enabled.

**Exit condition:** an existing user can complete the full supported journey
through React with Playwright coverage; reset and registration each have a
separately verified outcome or an explicit unsupported/decision-gated entry.
Do not describe a refusal, placeholder, or unverified client handoff as a
working account operation.

## Phase 6 — Messaging and friend management

**Outcome:** minimail and friend flows as real JSON APIs, not HTML fragments.

- Before coding, search the legacy `includes/` and `habblet/` trees (and the
  rest of the checkout as needed) for minimail and friend behavior, including
  rate-limit constants and ownership checks.
- Complete a minimail list/read/send slice first, then deletion and mark-read,
  with ownership and spam tests. Add friend requests, search, categories, and
  presence as the next slice.
- Add new-mail and presence WebSocket events through Drogon's native support
  after the basic flows generate real events.
- Rate-limiting and anti-spam as explicit service-layer checks (Redis-backed
  counters), tested for the "send 100 mails a second" case specifically.
- Test attempts to read or delete another user's mail and to send as another
  account; each must be rejected.

**Exit condition:** each named slice works through React with its relevant
authorization and abuse tests; the full minimail/friends phase is complete
only after the remaining operations and WebSocket push work.

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
  staff sessions, settings — each backed by a named service method for its
  owning table family, with confirmation flows for destructive actions.
  Bans and credit changes require a second explicit server-side confirmation,
  not only a UI dialog.
- RCON/API integration for alerts and any live-emulator commands, implemented
  against a verified PolarIS/Nitro interface — do not ship a control that
  silently no-ops.
- Load, authorization, audit-log, and failure-mode tests for every admin
  action, including partial write failure and its database/audit consistency.
- Before staff actions are accepted for release, require enrolled-secret
  step-up/2FA rather than a code-format check. Review the actual admin pages
  for visual fidelity, keyboard use, and intentional differences from legacy.

**Exit condition:** staff operate every supported function through the new
admin UI, every action attributed and reversible where possible, and real
staff step-up plus admin usability checks pass.

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
- Test installation from a fresh checkout, including the frontend bundle and
  the declared legacy asset prerequisite or its approved replacement. Verify
  asset provenance and redistribution rights before packaging assets.
- Obtain user acceptance of both public and admin UI, including the separate
  admin visual and keyboard review. Publish a concrete supported/unsupported
  operation list; a numbered phase or screenshot count is not release
  acceptance.
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

**Exit condition:** a fresh installation, backup/recovery, supported-operation
list, public/admin acceptance, and independent security review are evidenced;
all planned routes serve the C++/React stack; legacy PHP is retired only after
stable operation; remaining hotel-side work is tracked separately against
PolarIS/Nitro; and the user has reviewed the security-review results before
the phase is marked complete.

## Work-unit sequencing

Use the mutable inventory and run state to select the smallest unfinished
work unit; do not restart a phase whose stated checks already passed. Establish
the measured development-loop baseline before tool experiments. Finish
reproducible delivery and the observed account API contract before expanding
the existing-user journey. Keep each later feature family vertical and
reviewable, with its own evidence and gap update.

## Deliberate non-goals for the first CMS release

- Treating the separate browser-native Flash milestone as hidden first-release
  scope, or using Ruffle as its implementation.
- Changing PolarIS schema ownership for convenience.
- A visual redesign during parity work.
- Declaring emulator-limited actions complete without verified PolarIS/Nitro
  support.
- Treating this as a performance project. There is no measured
  throughput problem in the current site that justifies the language switch;
  don't let "C++ is fast" become an excuse to skip validation, sanitization,
  or the service-layer discipline in Phase 3. The website's job is I/O-bound
  (DB and cache round-trips), not compute-bound — Drogon's async model
  covers that; hand-tuned C++ hot loops are not where this project's risk or
  reward lives.
