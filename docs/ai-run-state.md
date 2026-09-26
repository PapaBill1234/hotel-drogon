# Current AI run state

This mutable state follows [plan v2](cpp-drogon-conversion-plan.md) (`AI_CONTEXT_ID: hotel-drogon-plan-v2`). Read the plan and [current inventory](phase1-parity-inventory.md) first. The pre-v2 investigation diary and safety-policy wording remain in [the state archive](archive/ai-run-state-v1.md); the standing failure-escalation and data-safety rules now live in the stable plan.

- **active_phase:** 2b
- **selected_next_work_unit:** measure the development and verification loop before changing build tooling
- **code baseline reviewed:** `cf38fdf2dde1308a1593c9add48fffa237bee72d` (curl pin repair; all three CI jobs green)

## Current phase and evidence

| Area | State | Evidence or limit |
| --- | --- | --- |
| Phase 1 | **Unmet:** OpenAPI first slice absent. | Existing `/api/auth/*`, `/api/me` and profile-write routes must define the truthful contract. |
| Phase 2 | Skeleton established in earlier work. | This workspace now has a read-only sibling PHPRetro checkout for local verification; a fresh clone still needs that external asset checkout. |
| Phase 2b | **Incomplete:** Compose frontend build service absent; worker inherits an HTTP health check it cannot satisfy. | `compose.yaml` bind-mounts out-of-band `frontend/dist`; `Dockerfile` probes `/health` for both binaries. Current CI build, integration and cutover checks are green. |
| Phase 3 | **Narrow exit met.** | Recorded Phase 3 smoke 12/12 and PolarIS isolation lint; separate staff cookie/rank gate. Staff login does not validate an enrolled TOTP secret, so staff 2FA remains a release gap. |
| Phase 4 | **Narrow exit met.** | Recorded admin API 33/33, public API 17/17, admin browser 10/10, public visual parity 6/6 at 2%. These checks do not review admin visual fidelity or keyboard usability. |
| Phases 5–10 | Not complete. | No React account journey, later feature-family UI, full cutover or release acceptance. See inventory. |

[CI run 36173602579](https://github.com/PapaBill1234/hotel-drogon/actions/runs/36173602579) on `cf38fdf` passed all three jobs: C++ sanitizers and tests, live integration, and isolated cutover. The prior [run 36168056003](https://github.com/PapaBill1234/hotel-drogon/actions/runs/36168056003) established the cause: CSRF, PolarIS isolation and admin UI lints passed, while `check_dependency_pins.py` reported curl pinned at `8.5.0-2ubuntu10.13` versus archive candidate `8.5.0-2ubuntu10.15`. In the pinned Ubuntu image, all 23 builder and 14 runtime direct pins were checked; only curl drifted. Both Dockerfile stages now pin `8.5.0-2ubuntu10.15`. CI intentionally has no curl pin because its runner already ships curl; the strict checker remains unchanged. Local verification passed the four lints, image CTest, sanitizer CTest, Phase 3 smoke 12/12, admin API smoke 33/33, public API smoke 17/17, admin browser 10/10, and isolated cutover/rollback 8/8. Local visual parity passed 5/6 after a host Node 24 build; the collectables page passed on rerun after rebuilding with CI's Node 20. CI ran the full browser suite on Node 20 and passed.

## Current workspace limits and decision gates

- This workspace has a read-only sibling `legacy/phpretro-pdo` checkout and locally built `frontend/dist`; they are external or generated prerequisites, not tracked release artifacts. The primary hotel and legacy data were not reset; local integration used a disposable `ci-cutover` project.
- Registration into PolarIS `users` requires the Phase 5 audited-write decision and verified schema; do not present it as enabled.
- Real staff step-up requires verified enrollment/secret data and end-to-end tests before staff release. The existing six-character check is not 2FA.
- Homes API/conflict shape, rich-text renderer dependency, Sentry source, and legacy asset redistribution each retain their plan-defined decision gates at their respective milestones.

## Exact next work unit

Measure the development and verification loop before changing build tooling: cold and warm clean C++ builds, one `.cpp` edit, a widely included header edit, each executable link, a docs-only Docker rebuild, the frontend build, and each of the three CI job times. Audit Docker build inputs; try `.dockerignore` or narrower `COPY` only if measurements support it, then rerun image CTest and integration checks. Keep the plan and reusable runner byte-stable. After that, finish the Compose frontend build service and truthful worker health state, document the implemented OpenAPI slice, and begin the existing-user journey. Preserve primary hotel and legacy data.
