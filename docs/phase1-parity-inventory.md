# Current parity and release-gap inventory

Checked 2026-09-26 against code baseline `cf38fdf2dde1308a1593c9add48fffa237bee72d` and [green CI run 36173602579](https://github.com/PapaBill1234/hotel-drogon/actions/runs/36173602579). This file tracks the Drogon/React application. The former 50 KB inventory, including the Laravel attempt and the investigation diary, is preserved verbatim in [the v1 archive](archive/phase1-parity-inventory-v1.md) and in Git history. The [stable plan](cpp-drogon-conversion-plan.md) owns architecture and safety rules; [run state](ai-run-state.md) owns the active unit.

**Status terms:** *Verified* means the cited check passed for its stated scope; *implemented* means code exists without the complete user journey; *gap* means no working current-stack path; *decision gate* means the named approval or emulator evidence is required. A passing phase exit does not imply release readiness.

## Ownership and source of truth

| Data family | Owner and rule | Source/evidence |
| --- | --- | --- |
| PolarIS hotel `users`, guilds/members, rooms, inventory, catalog, balances, bans, and hotel permissions | PolarIS. Keep its schema unchanged absent a verified emulator extension. Reads and writes go through individually authorized, audited named service methods; no generic table write or raw controller SQL. | Plan rules 1, 3–4; `src/services/{UserAccount,Guild,Ban,Report}Service.cpp`; `scripts/check_polaris_access.py` |
| Website `phpretro_*` content, reports, help desk, homes data, and audit tables | Website/CMS, using the same named-service access style and prepared statements. | `src/services/ContentService.cpp`; plan stack and Phases 4, 8–9 |
| Historical Laravel `sys`/Fortify identity | Superseded; it is not the hotel login in this repository. | [v1 archive](archive/phase1-parity-inventory-v1.md) |

The read-only PHPRetro PHP implementation is the behavioral reference before any feature work. This workspace now has the sibling `legacy/phpretro-pdo` checkout used for local verification; a fresh clone still needs that external checkout to supply legacy assets.

## Foundation and delivery

| Feature | Current status | Source and evidence | Gap / next step |
| --- | --- | --- | --- |
| C++ backend, worker binary, MariaDB, Redis, nginx | **Verified for existing scope.** Pinned Ubuntu 24.04/Drogon 1.8.7 build; sanitizers, `-Werror`, CTest, live integration, and isolated cutover passed after updating curl to `8.5.0-2ubuntu10.15` in both Dockerfile stages. | `Dockerfile`, `CMakeLists.txt`, `compose.yaml`; [run 36173602579](https://github.com/PapaBill1234/hotel-drogon/actions/runs/36173602579) on `cf38fdf` passed all three jobs. The strict pin checker was not changed. | Measure the build and verification loop before editing build tooling. Fresh-clone asset acquisition remains external. |
| Phase 2b frontend delivery | **Gap.** React build is out of band; nginx bind-mounts `frontend/dist`. | `compose.yaml` proxy service and `.github/workflows/ci.yml` frontend build step. | Add and verify a Compose frontend build service after the measured build-loop unit. |
| Worker health | **Gap.** Worker runs no HTTP server but inherits the image's `/health` HTTP probe, so Compose reports it unhealthy. | `Dockerfile` `HEALTHCHECK`; `compose.yaml` worker entrypoint; `src/worker/worker_main.cpp`. | Disable the inherited check or provide a real worker probe when editing Compose for Phase 2b. |
| Legacy static assets | **Conditional.** Six public pages depend on legacy `web-gallery` and admin images; CI fetches them, and this workspace has a read-only sibling checkout. | `compose.yaml` sibling mounts; `.github/workflows/ci.yml` legacy fetch and guard; `proxy/nginx.conf`. | Document fresh-install acquisition and check rights before redistribution. |
| OpenAPI first slice | **Gap.** No OpenAPI document is tracked, although auth, `/api/me`, and profile-write routes exist. | `include/controllers/{Auth,Account}Controller.h`; `rg --files` found no OpenAPI file. | Describe actual request/response/error/cookie behavior and validate against live routes before account frontend work. |
| Cutover and rollback | **Verified for one test route.** `/articles/rss.xml` switches to legacy and back through the real map in an isolated stack. | `scripts/check_cutover.sh` 8/8 recorded; `cutover-check` job in run 35539158338 succeeded. | Full route-by-route cutover is future Phase 10 work. |
| Metrics and error reporting | `/metrics` implemented; Sentry not wired. | `include/controllers/HealthController.h`; plan Phase 10 gate. | Decide Sentry source or record an observability gap at Phase 10. |

## Current public, CMS, and account surface

| Feature | Current status | Source and evidence | Gap / next step |
| --- | --- | --- | --- |
| Public content API and RSS | **Verified for current routes.** Landing, news, FAQ, collectables, banners, campaigns, maintenance, settings, and RSS. The legacy RSS title double-escape is intentionally corrected. | `include/controllers/PublicContentController.h`; `scripts/smoke_phase4_public.py` recorded 17/17 locally; `integration-smoke` job green on `cf38fdf`. | Extend only with a verified legacy behavior read. |
| Six public React pages | **Verified for measured parity.** Landing, community, articles, help, collectables, maintenance: 6/6 captured legacy baselines within 2% (0 differing pixels in the pinned comparison environment). | `frontend/src/App.tsx`; `docs/reference-screenshots/baseline/`; `tests/e2e/visual-parity.spec.ts`; `integration-smoke` job green. | This does not establish admin visual fidelity or a complete product. |
| Phase 4 CMS API | **Verified for existing content resources.** News, FAQ, collectables, banners, campaigns CRUD and settings; high-trust raw HTML gate. | `include/controllers/AdminContentController.h`; `scripts/smoke_phase4_admin.sh` recorded 33/33; `scripts/check_admin_ui_coverage.py`. | Broader Phase 9 staff resources are separate. |
| Phase 4 React content panel | **Verified for its narrow flows.** Dashboard/login plus news, FAQ, banners, campaigns, collectables, settings; 10/10 browser assertions. | `frontend/src/App.tsx`; `tests/e2e/admin.spec.ts`; `integration-smoke` job green. Coverage lint intentionally excludes diagnostic `test-gate` and Phase 9 bans routes, so “every admin route” is too broad. | Compare actual legacy admin screens with user expectations, review keyboard use, record intentional differences, and fix material issues. |
| Public auth/session and `/api/me` | **Verified for narrow Phase 3 checks.** Login, logout route, Redis-backed public/staff cookies, rank gate, CSRF and named PolarIS access layer. | `include/controllers/AuthController.h`; `scripts/smoke_phase3.sh` recorded 12/12; `scripts/check_csrf_rules.py` and `scripts/check_polaris_access.py` in green CI. | Narrow smoke does not prove all account journeys or staff 2FA. |
| Staff step-up / TOTP | **Release gap.** Separate rank-gated staff session exists, but staff login marks 2FA verified with no code and checks only six-character length if a code is supplied; no enrolled secret is read. | `src/controllers/AuthController.cpp` staff login; `src/utils/Crypto.cpp` has a TOTP verifier that this path does not use. | Verify legacy/emulator enrollment data, implement and test real per-staff secret validation before staff release. |
| Supported profile edits | **Implemented API only.** Motto, look, email, password routes exist through named methods and CSRF. | `include/controllers/AccountController.h`; `src/services/UserAccountService.cpp`. | Document/verify contract and build React profile flow; no account/profile React route exists. |
| Credits/history and Nitro client entry | **Gap as user journeys.** No React account, credits/history, or client-entry pages/routes; a service method alone is not a verified handoff. | `frontend/src/App.tsx`; controller route inventory. | Read legacy and verified PolarIS/Nitro behavior, then implement the existing-user vertical slice. |
| Password reset and remember-me | **Gap as user journeys.** No reset HTTP/frontend flow. Some service primitives exist but are not a complete route. | `include/controllers/AuthController.h` and `AccountController.h`; `src/services/UserAccountService.cpp`. | Separate slice with token expiry, errors, and browser coverage. |
| Registration | **Decision gate.** No current registration route or React journey. | Controller route inventory; plan Phase 5. | Approve and test the audited named PolarIS `users` write path before enabling. Until then report unsupported. |
| Club purchase, vouchers, badge/room actions | **Unsupported until verified emulator integration.** | Plan Phases 5, 7, 10; no matching current React journey. | Explicit handoff/gap, never a simulated success. |

## Later feature families and release

| Family | Current status | Source/evidence | Required next slice or gate |
| --- | --- | --- | --- |
| Minimail, friends, presence, WebSockets | **Gap in current Drogon/React UI/API.** | `frontend/src/App.tsx` and controller route inventory. | Minimail list/read/send with ownership/spam tests first; friend requests/presence and real event push later. |
| Groups and discussions | **Gap beyond service groundwork.** | `src/services/GuildService.cpp` exists; no matching React pages or routes. | Verify guild/forum behavior and implement authorized vertical slices. |
| User and group Homes | **Gap.** | No Homes controller or React editor in current tree. | Verify legacy model, approved version/conflict contract, user Homes before group Homes. |
| Remaining housekeeping | **Gap.** Bans API groundwork exists, but no bans UI; user management, alerts, reports, logs, vouchers and other supported actions are not current panel flows. | `include/controllers/StaffTestController.h`; `frontend/src/App.tsx`; `scripts/check_admin_ui_coverage.py` exclusions. | Named authorized/audited methods, server-side confirmations, UI and failure tests per slice; real staff 2FA gate. |
| Release/cutover | **Not met.** | Plan Phase 10 and the narrow evidence above. | Fresh install, recovery, rights, UI acceptance, performance, supported-operation list, independent security review, Sentry decision, then PHP retirement. |
| Browser-native Flash assets | **Separate later milestone.** | Plan milestone 6. | Inventory/decompile SWFs; HTML5 without Ruffle; Trax save/play only with verified PolarIS/Nitro capability. |

## Phase exits and next unit

| Phase | Accurate state |
| --- | --- |
| 1 | **Unmet:** current inventory exists, OpenAPI first slice still absent. |
| 2 | Repository skeleton and legacy reference were established in earlier work; this workspace now has the sibling assets for local verification, while fresh installation still needs acquisition instructions. |
| 2b | **Incomplete:** Compose frontend build and truthful worker health remain; all three CI jobs passed on `cf38fdf`. |
| 3 | **Narrow exit met:** 12/12 smoke, staff rank rejection and service isolation. Password reset, remember-me and real staff TOTP remain explicit gaps. |
| 4 | **Narrow exit met:** current CMS flows in React and six public screenshot comparisons. Admin appearance/usability remains an outcome/release review. |
| 5–10 | User journeys, later feature families, and release gates are not complete; individual service methods do not change that status. |

**Exact next work unit:** measure the cold and warm clean C++ builds, incremental `.cpp` and widely included header builds, each executable link, docs-only Docker rebuild, frontend build, and each of the three CI job times. Audit Docker inputs and test `.dockerignore` or narrower `COPY` only if measurements support them; then verify image CTest and integration. Do not start feature work or install a new build tool in this unit. Never reset the primary data.
