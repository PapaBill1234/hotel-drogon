# Current AI run state

This mutable state follows [plan v2](cpp-drogon-conversion-plan.md) (`AI_CONTEXT_ID: hotel-drogon-plan-v2`). Read the plan and [current inventory](phase1-parity-inventory.md) first. The pre-v2 investigation diary and safety-policy wording remain in [the state archive](archive/ai-run-state-v1.md); the standing failure-escalation and data-safety rules now live in the stable plan.

- **active_phase:** 2b
- **selected_next_work_unit:** make Compose supply the frontend bundle and give the worker a truthful health state
- **code baseline reviewed:** `e014caeb1e47314b0199421d37294f3602add768` (C++ source unchanged during the Phase 2b build-loop measurement)

## Current phase and evidence

| Area | State | Evidence or limit |
| --- | --- | --- |
| Phase 1 | **Unmet:** OpenAPI first slice absent. | Existing `/api/auth/*`, `/api/me` and profile-write routes must define the truthful contract. |
| Phase 2 | Skeleton established in earlier work. | This workspace now has a read-only sibling PHPRetro checkout for local verification; a fresh clone still needs that external asset checkout. |
| Phase 2b | **Incomplete:** Compose frontend build service absent; worker inherits an HTTP health check it cannot satisfy. | The development loop is measured and a small `.dockerignore` prevents docs, frontend dependencies, and local artifacts from invalidating the backend image. `compose.yaml` still bind-mounts out-of-band `frontend/dist`; `Dockerfile` probes `/health` for both binaries. |
| Phase 3 | **Narrow exit met.** | Recorded Phase 3 smoke 12/12 and PolarIS isolation lint; separate staff cookie/rank gate. Staff login does not validate an enrolled TOTP secret, so staff 2FA remains a release gap. |
| Phase 4 | **Narrow exit met.** | Recorded admin API 33/33, public API 17/17, admin browser 10/10, public visual parity 6/6 at 2%. These checks do not review admin visual fidelity or keyboard usability. |
| Phases 5–10 | Not complete. | No React account journey, later feature-family UI, full cutover or release acceptance. See inventory. |

[CI run 36173602579](https://github.com/PapaBill1234/hotel-drogon/actions/runs/36173602579) on `cf38fdf` passed all three jobs: C++ sanitizers and tests, live integration, and isolated cutover. The prior [run 36168056003](https://github.com/PapaBill1234/hotel-drogon/actions/runs/36168056003) established the cause: CSRF, PolarIS isolation and admin UI lints passed, while `check_dependency_pins.py` reported curl pinned at `8.5.0-2ubuntu10.13` versus archive candidate `8.5.0-2ubuntu10.15`. In the pinned Ubuntu image, all 23 builder and 14 runtime direct pins were checked; only curl drifted. Both Dockerfile stages now pin `8.5.0-2ubuntu10.15`. CI intentionally has no curl pin because its runner already ships curl; the strict checker remains unchanged. Local verification passed the four lints, image CTest, sanitizer CTest, Phase 3 smoke 12/12, admin API smoke 33/33, public API smoke 17/17, admin browser 10/10, and isolated cutover/rollback 8/8. Local visual parity passed 5/6 after a host Node 24 build; the collectables page passed on rerun after rebuilding with CI's Node 20. CI ran the full browser suite on Node 20 and passed.

**Measured build loop:** [the Phase 2b report](phase2b-build-loop-measurements.md) records a 41.82 s cold and 37.07 s warm clean C++ build, 7.07 s `.cpp` edit, 26.53 s shared-header edit, sub-0.2 s executable links, 3.30 s Node 20 frontend build, and 84/162/104 s for the three jobs of [green run 36221358776](https://github.com/PapaBill1234/hotel-drogon/actions/runs/36221358776). The unfiltered docs-only Docker rebuild took 38.82 s; with `.dockerignore` it took 2.86 s and all layers were cached. The filtered image, four lints, ASan/UBSan CTest with zero compiler warnings, isolated API smokes, admin browser, full visual parity on rerun, and cutover/rollback passed locally. The first local visual pass had an unexplained community screenshot difference of 3%; no tolerance or product code changed before the passing rerun. No new build tool was added.

## Current workspace limits and decision gates

- This workspace has a read-only sibling `legacy/phpretro-pdo` checkout and locally built `frontend/dist`; they are external or generated prerequisites, not tracked release artifacts. The primary hotel and legacy data were not reset; local integration used a disposable `ci-cutover` project, verified before start and teardown. Pre-existing untracked browser artifacts under `tests/e2e/.out/` were preserved.
- Registration into PolarIS `users` requires the Phase 5 audited-write decision and verified schema; do not present it as enabled.
- Real staff step-up requires verified enrollment/secret data and end-to-end tests before staff release. The existing six-character check is not 2FA.
- Homes API/conflict shape, rich-text renderer dependency, Sentry source, and legacy asset redistribution each retain their plan-defined decision gates at their respective milestones.

## Exact next work unit

Make Compose build the React bundle that nginx serves without an out-of-band host build, and give the worker a truthful health state by disabling the inherited HTTP server probe or supplying a real worker probe. Verify with a clean isolated project, the declared read-only legacy assets, image CTest, ASan/UBSan, security lints, integration and browser checks, cutover/rollback, and all three CI jobs. Keep the stable plan and reusable runner byte-stable. After reproducible delivery, document the implemented OpenAPI first slice before starting the existing-user journey. Preserve primary hotel and legacy data.
