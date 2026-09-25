# Current AI run state

This mutable state follows [plan v2](cpp-drogon-conversion-plan.md) (`AI_CONTEXT_ID: hotel-drogon-plan-v2`). Read the plan and [current inventory](phase1-parity-inventory.md) first. The pre-v2 investigation diary and safety-policy wording remain in [the state archive](archive/ai-run-state-v1.md); the standing failure-escalation and data-safety rules now live in the stable plan.

- **active_phase:** 2b
- **selected_next_work_unit:** measure the build/development loop and audit Docker build inputs
- **code baseline reviewed:** `84c825702faf5875512f4e9f1855b5d8dd50a501` (public `main` and the newest local checkout matched on 2026-09-25)

## Current phase and evidence

| Area | State | Evidence or limit |
| --- | --- | --- |
| Phase 1 | **Unmet:** OpenAPI first slice absent. | Existing `/api/auth/*`, `/api/me` and profile-write routes must define the truthful contract. |
| Phase 2 | Skeleton established in earlier work. | Fresh clone here lacks the sibling read-only PHPRetro asset checkout; do not claim a self-contained local start. |
| Phase 2b | **Incomplete:** Compose frontend build service absent; worker inherits an HTTP health check it cannot satisfy. | `compose.yaml` bind-mounts out-of-band `frontend/dist`; `Dockerfile` probes `/health` for both binaries. Other build/cutover checks passed in CI. |
| Phase 3 | **Narrow exit met.** | Recorded Phase 3 smoke 12/12 and PolarIS isolation lint; separate staff cookie/rank gate. Staff login does not validate an enrolled TOTP secret, so staff 2FA remains a release gap. |
| Phase 4 | **Narrow exit met.** | Recorded admin API 33/33, public API 17/17, admin browser 10/10, public visual parity 6/6 at 2%. These checks do not review admin visual fidelity or keyboard usability. |
| Phases 5–10 | Not complete. | No React account journey, later feature-family UI, full cutover or release acceptance. See inventory. |

[CI run 35539158338](https://github.com/PapaBill1234/hotel-drogon/actions/runs/35539158338) succeeded on the reviewed code baseline `84c8257`: C++ sanitizer/tests, live integration, and isolated cutover jobs. This is recorded evidence, not a new local build. The prior detailed measurements, failure diagnoses, and exact smoke results are in the archives and Git history.

## Current workspace limits and decision gates

- This clone has no sibling `legacy/phpretro-pdo` assets, built `frontend/dist`, CMake build tree, or installed frontend dependencies. No runtime or browser check was rerun in this docs-only revision.
- Registration into PolarIS `users` requires the Phase 5 audited-write decision and verified schema; do not present it as enabled.
- Real staff step-up requires verified enrollment/secret data and end-to-end tests before staff release. The existing six-character check is not 2FA.
- Homes API/conflict shape, rich-text renderer dependency, Sentry source, and legacy asset redistribution each retain their plan-defined decision gates at their respective milestones.

## Exact next work unit

Measure and record wall time for cold and warm clean C++ builds, one `.cpp` rebuild, one widely included-header rebuild, linking each executable, a docs-only `docker compose build`, the frontend build, and each of the three CI jobs. Record commands, host/container environment, and Docker build inputs. If evidence shows avoidable context invalidation, make a small `.dockerignore` or narrower `COPY` change, then verify the image, Catch2/sanitizers, security lints, integration/browser checks, and CI before reporting a gain. Do not install build tools on assumption. Keep the primary hotel and legacy data intact; use only a verified isolated disposable project for reproduction.

After that unit, finish the Compose frontend build service and truthful worker health state, then document the implemented OpenAPI slice and begin the existing-user journey. Keep the plan and reusable runner byte-stable during normal units.
