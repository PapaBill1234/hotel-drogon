# Current AI run state

This mutable state follows [plan v2](cpp-drogon-conversion-plan.md) (`AI_CONTEXT_ID: hotel-drogon-plan-v2`). Read the plan and [current inventory](phase1-parity-inventory.md) first. The pre-v2 investigation diary and safety-policy wording remain in [the state archive](archive/ai-run-state-v1.md); the standing failure-escalation and data-safety rules now live in the stable plan.

- **active_phase:** 2b
- **selected_next_work_unit:** diagnose the new CI lint failure and restore a green verification run
- **code baseline reviewed:** `84c825702faf5875512f4e9f1855b5d8dd50a501` (public `main` and the newest local checkout matched on 2026-09-25)

## Current phase and evidence

| Area | State | Evidence or limit |
| --- | --- | --- |
| Phase 1 | **Unmet:** OpenAPI first slice absent. | Existing `/api/auth/*`, `/api/me` and profile-write routes must define the truthful contract. |
| Phase 2 | Skeleton established in earlier work. | Fresh clone here lacks the sibling read-only PHPRetro asset checkout; do not claim a self-contained local start. |
| Phase 2b | **Incomplete:** Compose frontend build service absent; worker inherits an HTTP health check it cannot satisfy. | `compose.yaml` bind-mounts out-of-band `frontend/dist`; `Dockerfile` probes `/health` for both binaries. The latest CI run stopped at the lint step before builds; earlier build/cutover checks passed. |
| Phase 3 | **Narrow exit met.** | Recorded Phase 3 smoke 12/12 and PolarIS isolation lint; separate staff cookie/rank gate. Staff login does not validate an enrolled TOTP secret, so staff 2FA remains a release gap. |
| Phase 4 | **Narrow exit met.** | Recorded admin API 33/33, public API 17/17, admin browser 10/10, public visual parity 6/6 at 2%. These checks do not review admin visual fidelity or keyboard usability. |
| Phases 5–10 | Not complete. | No React account journey, later feature-family UI, full cutover or release acceptance. See inventory. |

[CI run 35539158338](https://github.com/PapaBill1234/hotel-drogon/actions/runs/35539158338) succeeded on the reviewed code baseline `84c8257`: C++ sanitizer/tests, live integration, and isolated cutover jobs. This is recorded evidence, not a new local build. The prior detailed measurements, failure diagnoses, and exact smoke results are in the archives and Git history.

**CI failure after v2:** [run 36167432687](https://github.com/PapaBill1234/hotel-drogon/actions/runs/36167432687) on the docs-only v2 commit `91d7f1c` failed in the C++ job at “Run CSRF Route and PolarIS Isolation Linters” (exit 1). The state-only follow-up [run 36167884952](https://github.com/PapaBill1234/hotel-drogon/actions/runs/36167884952) on `a29d9af` failed at the same step; no implementation fix was attempted between them. Dependency installation and preflight passed; configure/build/tests did not run, and integration/cutover were skipped. The public job-log endpoint returned 403, so the exact failing lint output is unavailable. With the bundled Python runtime, `check_csrf_rules.py`, `check_polaris_access.py`, and `check_admin_ui_coverage.py` each pass locally. The fourth command, `check_dependency_pins.py`, needs a populated Linux apt index; its failure is a **hypothesis**, not a confirmed cause. No speculative fix was made.

## Current workspace limits and decision gates

- This clone has no sibling `legacy/phpretro-pdo` assets, built `frontend/dist`, CMake build tree, or installed frontend dependencies. No runtime or browser check was rerun in this docs-only revision.
- Registration into PolarIS `users` requires the Phase 5 audited-write decision and verified schema; do not present it as enabled.
- Real staff step-up requires verified enrollment/secret data and end-to-end tests before staff release. The existing six-character check is not 2FA.
- Homes API/conflict shape, rich-text renderer dependency, Sentry source, and legacy asset redistribution each retain their plan-defined decision gates at their respective milestones.

## Exact next work unit

Obtain the failing lint output for run `36167432687`, or reproduce its four-command lint step in a verified isolated Ubuntu environment with the CI apt index. Identify the exact failing check and evidence-backed cause. If a pinned dependency has left the archive, update it through `docs/dependency-policy.md` without loosening pins; otherwise repair only the demonstrated defect. Rerun the lints and all three CI jobs to restore a green verification run. Do not change features or install build tools in this diagnosis unit. Keep the primary hotel and legacy data intact; use only a verified isolated disposable project for reproduction.

After CI is green, measure the cold/warm and incremental build loop, docs-only Docker rebuild, frontend build, and CI job times; audit Docker build inputs and try `.dockerignore` or narrower `COPY` only if evidence supports it. Then finish the Compose frontend build service and truthful worker health state, document the implemented OpenAPI slice, and begin the existing-user journey. Keep the plan and reusable runner byte-stable during normal units.
