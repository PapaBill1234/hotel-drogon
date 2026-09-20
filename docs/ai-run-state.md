# AI run state

<!--
Mutable state. `cpp-drogon-conversion-plan.md` is the authoritative, byte-stable
plan and must not be edited during normal implementation work (AI_CONTEXT_ID:
hotel-drogon-plan-v1). Record phase, progress and gaps here and in
`phase1-parity-inventory.md`.
-->

**active_phase: 2b**

Reconciled 2026-09-20 against the repository, tests, CI and Git history at
commit `77f7c87`. Plan installed at
`docs/cpp-drogon-conversion-plan.md`, sha256
`7f01bcd7bc3c58070ffdfcb7f2208c0701ddcab48ebd310ac3bdb421d609e5a7` (verified
byte-for-byte against the supplied attachment).

## Why 2b is the selected phase

Phase 2b's exit condition has four parts. Three are unmet and the fourth is
unproven, and CI is currently red — so "build/container/test verification
remains incomplete" is true in the strongest sense available. Phase 2b is also
the gate the plan places before Phases 3–4 may be trusted.

Work already completed in Phases 3 and 4 is **not** being restarted. Phase 4
does, however, also have an unmet exit check (see below) — that is recorded, not
papered over, and the phase label can be switched to 4 if preferred.

## Phase 2b — verification matrix

| Requirement (plan lines 179–205) | State | Evidence |
| --- | --- | --- |
| Preflight: compiler/cmake/git/docker versions reported | **Not recorded** | No artifact in the repo |
| vcpkg or Conan chosen and explained | **Deviation** | Dependencies come from Ubuntu 24.04 apt packages, not vcpkg/Conan. Works, but the plan's choice was never made or explained |
| Everything compiles | **Yes** | CMake + Ninja build succeeds; CI job "C++ Drogon (Sanitizers + Tests)" success on `77f7c87` |
| Warnings-as-errors enabled | **Not done** | `CMakeLists.txt` sets `-Wall -Wextra` but no `-Werror`; CI does not fail on warnings |
| ASan/UBSan on every test run | **Yes** | CI configures `-DENABLE_SANITIZERS=ON`; CTest passes |
| Structured logging, `/health`, graceful shutdown, env config | **Yes** | spdlog JSON logging, `HealthController`, SIGTERM handler, `AppConfig::loadFromEnv` |
| Async MariaDB + Redis clients, proven against real data | **Yes** | Live stack serves real queries; smoke suites exercise them |
| Compose services (backend, MariaDB, Redis, worker, nginx, frontend build) | **Partial** | All present except a frontend build service; `frontend/dist` is built out-of-band and bind-mounted |
| CI covers CMake + sanitizers + tests | **Yes** | `.github/workflows/ci.yml` job `cpp-build-and-test` |
| CI covers TypeScript build | **No** | No npm/vite/tsc step anywhere in CI |
| CI covers Playwright | **No** | The visual-parity suite exists but never runs in CI |
| **CI passes** | **No** | Job "Phase 3 Integration Smoke (live stack)" **FAILED** on `77f7c87` |
| Route switch/proxy map with cutover **and rollback** demonstrated | **Not done** | `proxy/cutover.map` is orphaned: `nginx.conf` never includes it, has its own inline map, and `compose.yaml` has no legacy PHP upstream. `cutover.map` says `default legacy` while nginx actually defaults to the SPA. Rollback is not demonstrable |
| Sentry wired | **Not wired** | `cfg.sentry_dsn` is read from env into `AppConfig` but no SDK is linked and nothing is reported. The inventory's "Sentry DSN configuration wired into AppConfig" overstates this |
| Basic metrics endpoint | **Yes** | `/metrics` serves Prometheus text |

### The CI failure

Run `35512912865`, commit `77f7c87`:

- Job **"C++ Drogon (Sanitizers + Tests)"** — success (all 7 steps)
- Job **"Phase 3 Integration Smoke (live stack)"** — failure at step
  **"Run Phase 3 smoke suite"**; every later step (Phase 4 admin, Phase 4
  public/RSS) was skipped
- Check-run annotation: `Process completed with exit code 1.` at
  `.github/workflows/ci.yml:39`, with no assertion text

**Root cause not isolated.** The job log is not retrievable through the API
(`/actions/jobs/{id}/logs` returns a non-followed redirect). What has been ruled
out:

- Not a fresh-database problem. Reproduced CI's condition exactly locally —
  `docker compose down -v`, `up -d --build`, health-poll, immediate smoke run —
  and Phase 3 passed **12/12** on a clean volume.
- Not the schema/seed race seen earlier in this project for the content tables.
  Restarting the backend six times against a freshly created database produced
  zero `1146 / doesn't exist` errors.
- The same script and the same step passed on earlier commits (`4ee575a`,
  `1f1ec68`), so it is not a shell-compatibility problem with `/bin/sh`.

Suspects worth ruling out next, in order: the nginx SPA-routing change
(`nginx.conf` now `try_files`-es to `/index.html`, and in CI the bind-mounted
`frontend/dist` does not exist so that file is absent); the `web-gallery` bind
mount source `../legacy/phpretro-pdo` also not existing on the runner; and
whether `docker compose up` genuinely brings up every service when both mount
sources are missing.

Note that `main.cpp` still dispatches its Phase 3 `CREATE TABLE` statements and
the user seed **asynchronously and unordered** (fire-and-forget), unlike
`ContentService::ensureSchema`, which was made sequential precisely because that
race had already been observed. That remains a latent defect even though it did
not reproduce here.

## Phase 4 — exit condition

Plan exit condition: *"staff can manage public content through the new admin
UI, and converted public pages match legacy screenshots within tolerance."*

| Half | State |
| --- | --- |
| Converted public pages match legacy screenshots within tolerance | **Met** — 6/6 pages pass at a 2% pixel tolerance, reproduced on a freshly built stack |
| Staff can manage public content through the new **admin UI** | **UNMET — no admin UI exists** |

`/api/admin/*` is complete and verified (19/19 assertions: CRUD, per-field
validation, audit rows, CSRF, rank gates, and the high-trust raw-HTML boundary
at rank 5 vs 7). But the plan changed this requirement from the earlier wording
"through the new admin API" to "through the new **admin UI**" and states the
admin section is "real UI + backend work, not configuration". The frontend
contains only six public pages — there is no admin route, page, or component,
and nothing under `frontend/src` references admin. The admin UI is therefore
missing implementation, not a verification gap.

## Phase 1 — exit condition

*"an OpenAPI document for the first slice, and an updated inventory table with
every row re-tagged for the new stack."*

- **No OpenAPI document exists** anywhere in the repository (only `ci.yml` and
  the two compose files are YAML). This is unmet.
- The inventory's rows for Phases 2–4 are re-tagged for the new stack; rows for
  Phases 5–10 are still Laravel-era.

Phase 1 is not being restarted; recorded here because it is an outstanding
foundation gap, and the plan's rules require an API contract before page work.

## Verified state at this commit

| Check | Command | Result |
| --- | --- | --- |
| Visual parity (6 pages) | `npx playwright test` in `tests/e2e` | **6 passed** |
| Phase 3 auth/session/authz | `scripts/smoke_phase3.sh http://proxy` | **12 passed, 0 failed** |
| Phase 4 admin CMS | `scripts/smoke_phase4_admin.sh http://proxy` | **19 passed, 0 failed** |
| Phase 4 public API + RSS | `scripts/smoke_phase4_public.py http://proxy` | **17 passed, 0 failed** |
| CSRF route lint | `scripts/check_csrf_rules.py` | exit 0 — 46 routes, 24 mutating, all protected |
| PolarIS isolation lint | `scripts/check_polaris_access.py` | exit 0 — zero direct access outside `src/services/` |
| C++ build + sanitizers + CTest | CI job `cpp-build-and-tests` on `77f7c87` | success |
| Live-stack integration smoke | CI job `integration-smoke` on `77f7c87` | **FAILURE** |

Parity requires two data preconditions, both documented in
`tests/e2e/README.md`: both apps must hold identical content
(`tools/legacy-stack/init/99-seed.sql`), and the new app needs
`site_closed='1'` for the maintenance page to render against its baseline.

## Next work unit (do not start until instructed)

Smallest unit that moves Phase 2b forward: **isolate the CI integration-smoke
failure and make the live-stack job green**, since every other Phase 2b
verification claim sits behind it. Deliverable: root cause plus a fix, and the
CI run URL showing success.

After that, still within Phase 2b and in rough order: enable warnings-as-errors
and clear any findings; add TypeScript-build and Playwright jobs to CI; make the
cutover map real (include it, add a legacy upstream, and demonstrate cutover
*and* rollback for one route) or delete it and correct the inventory; wire
Sentry or downgrade that claim.

Not in scope without a decision from the user: the Phase 4 admin UI, and the
OpenAPI document.
