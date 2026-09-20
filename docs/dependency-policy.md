# Dependency policy — pinned Ubuntu 24.04 archive packages

Decision recorded 2026-09-21, approved by the user, amending the conversion
plan's original "CMake + vcpkg (or Conan)" requirement. The plan carries the
one-line summary and the measurements; this file is the operating procedure.

## The decision

**CMake + Ninja against Ubuntu 24.04 archive packages, from a base image pinned
by digest, with every direct dependency pinned to an exact version.**

No dependency manager. No hybrid: vcpkg is not used for the toolchain, and is not
used for individual libraries either — mixing package ecosystems was explicitly
not approved.

## Why — the evidence

| | pinned apt (chosen) | vcpkg | Conan |
| --- | --- | --- | --- |
| Drogon version available | **1.8.7** (`1.8.7+ds-1.1build1`) | **1.9.13#2** | **1.9.13** |
| Builds this code under `-Werror`? | **Yes** | **No** | Not tested; same version |
| Full CI build step | **41s** | configure alone **317s** | not measured |
| Install cost | base image only | tool 316MB + tree 345MB | not measured |

The decisive point is the version. Supplying Drogon 1.8.7 through vcpkg or Conan
would need a historical baseline, an overlay port, or a custom recipe, each with
ongoing maintenance. Against 1.9.13 the current code and configuration do **not**
pass the project's required `-Werror` build: `HttpAppFramework::createDbClient` is
deprecated there and `-Werror` makes that fatal (`src/main.cpp:51`). With that one
warning class suppressed the build still fails, on `cannot find -lcrypto` — a
pre-existing static-link gap, unrelated to the version.

That is not a claim that migrating to 1.9.13 is impossible. It is possible, and it
is a **separate, currently unjustified work unit**: a Drogon minor-version
migration is a behaviour change of its own, and nothing this project needs today
requires it.

## What pinning does and does not do

Pinning the digest and the versions makes a build **repeatable**: the same commit
builds the same package set. It does **not** keep that set secure, and it is not a
substitute for updates. Ubuntu LTS ships security fixes by publishing a *new*
version of a package, which is exactly the event that breaks a pin — deliberately,
so that it is noticed. `scripts/check_dependency_pins.py` is what notices it, and
the correct response is to move the pin forward onto the fixed version, not to
remove it.

This is a trade, stated plainly: reproducibility on one axis, and a deliberate
human step on the other.

## Where the pins live

| File | What is pinned |
| --- | --- |
| `Dockerfile` | base image by digest (both stages) + 23 builder and 14 runtime packages |
| `.github/workflows/ci.yml` | the same 21 of the builder's packages that the runner does not already ship, in one job-level `PINS` variable that both the install step and the failure-diagnosis step read |

`scripts/check_dependency_pins.py` fails the build when:

- a pinned version is no longer the archive's candidate (the pin has rotted);
- the Dockerfile builder stage and CI disagree about which packages are installed;
- they agree on the name but not the version;
- CI installs anything other than `$PINS`, which would let the shared list be
  bypassed by a hand-written install elsewhere in the workflow;
- the `PINS` variable or the apt index could not be read at all — an unverified
  pin is a failure, not a pass.

Packages the two paths deliberately differ on are listed in the script with a
reason (`CI_ONLY`, `BUILDER_NOT_IN_CI`), so the exception is reviewable rather
than implicit.

### Diagnosing a failed pinned install

Exact-version pins fail fast and say little: apt exits 100 and the job log is the
only place the reason appears. Two different causes look identical from outside —
a pin that has left the archive, and an index that is not the one the pins were
read from (mirrors lag the archive by hours) — so CI carries an
`if: failure()` step that re-runs the install, then reports the apt error, the
sources actually in use, and every pin whose candidate disagrees, as check-run
annotations. That makes the failure readable from the API without the job log,
which matters because the log archive is not reachable with a read-only
credential.

A failing `apt-get update` from a repository unrelated to this build (the runner
image carries several third-party lists) is downgraded to a warning annotation
rather than aborting the step. That is not a weakening: the pinned install still
has to succeed against the index that exists, and the linter re-reads the index
afterwards and fails on any pin the archive no longer offers.

## Update procedure

Run this whenever a security update lands, when moving the base image, or when the
lint reports rot. It is deliberately manual and ends with the full verification
suite.

1. **Choose the new base image digest.**

   ```sh
   docker buildx imagetools inspect ubuntu:24.04
   ```

   Take the top-level `Digest:` (the multi-platform index) and put it in *both*
   `FROM` lines of `Dockerfile`. Using the index rather than a platform manifest
   keeps the image usable on arm64 build hosts as well as the amd64 runners.

2. **Re-read the archive's candidate versions for every pinned package.**

   ```sh
   docker run --rm ubuntu:24.04@<new-digest> sh -c '
     apt-get update -qq
     for p in build-essential cmake ninja-build pkg-config git libssl-dev zlib1g-dev \
              libbrotli-dev libc-ares-dev libyaml-cpp-dev libjsoncpp-dev uuid-dev \
              libmariadb-dev libpq-dev libsqlite3-dev libhiredis-dev libspdlog-dev \
              libcrypt-dev catch2 libdrogon-dev nlohmann-json3-dev \
              ca-certificates curl python3; do
       printf "%-22s %s\n" "$p" "$(apt-cache policy "$p" | awk "/Candidate:/{print \$2}")"
     done'
   ```

   Do the same for the runtime packages in the second stage (`libjsoncpp25`,
   `libmariadb3`, `libpq5`, `libsqlite3-0`, `libbrotli1`, `libcares2`,
   `libyaml-cpp0.8`, `libhiredis1.1.0`, `libspdlog1.12`, `zlib1g`, `libuuid1`,
   `libdrogon1t64`).

3. **Update the pins in `Dockerfile` and `.github/workflows/ci.yml` together.**
   They must match; the lint enforces it.

4. **Check for a Drogon change specifically.** If `libdrogon-dev` moves off
   `1.8.7+ds-*`, stop: that is the migration work unit, not a routine update, and
   the code must be adapted and re-verified against the new API first.

5. **Run the full verification suite** (all of it — a dependency change can affect
   any of it):

   ```sh
   # lints, including the new pin check
   python3 scripts/check_csrf_rules.py
   python3 scripts/check_polaris_access.py
   python3 scripts/check_admin_ui_coverage.py
   python3 scripts/check_dependency_pins.py

   # image build (runs ctest inside the build)
   docker build -t hotel-drogon-backend:pinned .

   # stack, with the new image
   docker compose up -d --build

   # smokes
   sh scripts/smoke_phase3.sh http://localhost:3000
   sh scripts/smoke_phase4_admin.sh http://localhost:3000
   python3 scripts/smoke_phase4_public.py http://localhost:3000

   # frontend + browser suites
   cd frontend && npm ci && npm run build && cd ..
   docker compose exec -T proxy nginx -s reload
   cd tests/e2e && PLAYWRIGHT_ADMIN=1 npx playwright test admin.spec.ts
   npm run test:visual:container

   # cutover harness
   docker compose -p ci-cutover -f tools/ci-repro/compose-cutover.yaml up -d --build
   # seed both databases from tools/ci-repro/cutover-fixtures.sql, then:
   COMPOSE_ARGS="-p ci-cutover -f tools/ci-repro/compose-cutover.yaml" sh scripts/check_cutover.sh http://localhost:3500
   docker compose -p ci-cutover -f tools/ci-repro/compose-cutover.yaml down -v
   ```

6. **Sanitizer configuration**, which CI runs and a local image build does not:

   ```sh
   cmake -B build-asan -G Ninja -DCMAKE_BUILD_TYPE=Debug -DENABLE_SANITIZERS=ON -DBUILD_TESTING=ON
   cmake --build build-asan --parallel
   ctest --test-dir build-asan --output-on-failure
   ```

7. **Push and require a green CI run** before treating the update as done.

## Revisit this decision if

- the target distribution changes (a different archive is a different package
  set), or
- a dependency is needed that the archive does not carry. Note that the Ubuntu
  archive has no Sentry C++ SDK at all; that is recorded as a Phase 10 decision
  gate in the plan rather than solved here, because solving it by bolting vcpkg
  onto an apt build is the ecosystem mixing that was not approved.
