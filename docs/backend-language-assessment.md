# Backend language assessment (2026-09-27)

This is an estimate, not a decision to replace Drogon. Plan v4 keeps the
C++/Drogon backend and React frontend. The user removed the proposed in-game
furniture catalog editor; PHPRetro's website-owned MyHabbo Homes store remains
in parity scope.

## Starting point and measurement

- The repository has roughly 10,000 lines across 54 C++ source/header files,
  64 registered controller routes, and a separate React frontend. These are
  rough source counts, not an estimate of remaining work.
- The measured pinned-container C++ loop was 7.07 seconds for one source edit,
  26.53 seconds for a common-header edit, and 41.82 seconds for a cold build.
  The frontend build was 3.30 seconds. Hosted CI jobs took 84 seconds for
  sanitizer/tests, 162 seconds for live integration, and 104 seconds for
  isolated cutover. See `phase2b-build-loop-measurements.md` for conditions.
- Phase 8 still has Homes interactions to port, and the modular CMS work has
  contracts but no presentation controls, second theme, localization or
  Pixel63 adapter. Existing auth, CSRF, audit, ownership and data isolation
  behavior must survive any backend rewrite.
- The latest recorded Phase 8 backend fix has not yet had its full local stack,
  browser and CI verification rerun because Docker Desktop's VM was down.
  Nothing in this assessment treats that gap as a pass.

## Schedule judgment for one experienced full-time developer

| Option | Added work before parity with today's backend | Likely schedule effect on completing the whole project |
| --- | --- | --- |
| Keep Drogon/React | No migration tax; continue the verified contract gate and Phase 8. | Fastest credible route from the current state. Backend compile time is already a small part of the measured integration loop. |
| Rewrite backend in Go, keep React | Roughly **4–8 developer-weeks** to reimplement and verify routes, sessions/CSRF, named database services, Redis/locks, worker, migrations and all applicable tests/CI. This is a planning range, not a measured quote. | Go may speed later backend CRUD work, but does not remove React, legacy parity, client/emulator integration, visual, browser or release work. A net schedule gain is unproven and depends on how much backend work remains after the rewrite. |
| Rewrite backend in Rust, keep React | Roughly **6–12 developer-weeks** for the same parity work, allowing for async/database integration and ownership model adaptation. This is a planning range, not a measured quote. | Memory safety can be valuable, but no evidence in this project supports a faster finish than retaining Drogon. |

The ranges assume one developer already productive in the target language,
reuse of the React frontend and schemas, preserved behavior, and full
verification. A new framework or database library would itself need the plan's
dependency decision. The estimates may move substantially after a real spike.

An optimistic Go case illustrates the break-even test: if subsequent *backend*
feature work were 25% faster, a 4–8 week rewrite would need roughly 20–40
weeks of otherwise comparable backend work to repay itself. This is arithmetic
on an assumed productivity gain, not an observed project speedup. The
remaining work includes substantial frontend, emulator, visual and release
tasks, which that gain would not accelerate.

Go provides a native test/race-detector workflow (`go test -race`), though the
detector only finds races on executed paths: [Go race detector](https://go.dev/doc/articles/race_detector).
Rust SQLx supports MySQL/MariaDB and checked SQL queries, with build-time DB
or offline metadata requirements for its query macros:
[database support](https://docs.rs/sqlx/latest/sqlx/database/),
[query macro](https://docs.rs/sqlx/latest/sqlx/macro.query.html).
These capabilities help implementation quality; neither replaces this
project's integration, browser, provenance or data-safety gates.

**Recommendation:** finish the current Drogon/React plan. Consider Go only
if a later, authorized vertical-slice spike (session + CSRF + one read/write
service + Redis + end-to-end test) shows a measurable end-to-end gain and a
credible migration path. No language rewrite, new dependency or feature work
was started by this assessment.
