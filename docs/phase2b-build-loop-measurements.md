# Phase 2b development-loop baseline

Measured 2026-09-26 on the unchanged C++ source from `cf38fdf` through `e014cae`. These are single wall-clock observations, not throughput benchmarks. The local Docker Desktop Linux builder had 4 CPUs, Ubuntu 24.04, GCC 13.3, CMake 3.28.3, and Ninja 1.11.1. No build tool or dependency was installed into the project.

## C++ edit loop

In a disposable container from the pinned Dockerfile builder stage, the source was copied to `/tmp/bench-src` without its prior build tree. CMake used `Release`, `BUILD_TESTING=ON`, and `--parallel $(nproc)`. The warm clean build ran after Ninja `clean`; incremental timings used `touch` on a copied source file, never the repository. Each link timing removed only the named executable in that disposable build tree. CTest passed before and after the edit/link sequence.

| Operation | Wall time |
| --- | ---: |
| Configure fresh tree | 1.20 s |
| Cold clean compile and link | 41.82 s |
| Warm clean compile and link | 37.07 s |
| Touch `src/services/ContentService.cpp`, rebuild (4 steps including 3 links) | 7.07 s |
| Touch widely included `include/utils/Logger.h`, rebuild (20 steps) | 26.53 s |
| Relink `hotel_server` only | 0.178 s |
| Relink `hotel_worker` only | 0.147 s |
| Relink `hotel_tests` only | 0.170 s |

The measured edit cost is compilation, especially after a shared-header edit; linking is under 0.2 seconds here. These numbers alone do not justify mold, PCH, ccache, or a new package. Any future tool experiment needs the same baseline and a persistent cache if cross-run reuse is claimed.

## Docker and frontend

`docker compose -p measure-phase2b build --progress plain backend` used an isolated project name and did not start or modify the primary services. Without `.dockerignore`, the first build transferred 73.79 MB and took 45.43 s. A change only to a temporary file under `docs/` took 38.82 s: `COPY .` invalidated CMake and rebuilt all 27 steps, although BuildKit transferred only 312 kB of changed context. The checkout contained 77 MB of `frontend/node_modules`, 2.2 MB of docs, and 293 kB of generated `frontend/dist`; none is needed to compile the backend. `CMakeLists.txt` compiles `src/`, `include/`, and `tests/*.cpp`, and the runtime stage copies `config/` and the two binaries.

The new `.dockerignore` omits local Git state, docs, frontend, browser files, proxy/scripts/tools, generated build trees, and environment files while retaining the C++ sources, unit tests, CMake file, and runtime config. The first filtered build took 36.87 s and passed the image's CTest. A second docs-only probe took **2.86 s**, with every build layer cached. BuildKit's 4.00 kB and 3.60 kB transfer readings for those two filtered runs are incremental transfers, not claims about total context size. The temporary probe file was removed.

In `node:20-bookworm` (Node 20.20.2, npm 10.8.2), using a disposable frontend copy, `npm ci --no-audit --no-fund` took 2.37 s and `npm run build` took 3.30 s. TypeScript and Vite completed; 104 modules were transformed. The host's generated bundle was not overwritten for this timing.

## Hosted CI baseline

[Green run 36221358776](https://github.com/PapaBill1234/hotel-drogon/actions/runs/36221358776) supplied these GitHub job wall times before the Docker input change. Hosted runners have no demonstrated persistent cache across runs.

| Job | Wall time | Result |
| --- | ---: | --- |
| C++ Drogon (Sanitizers + Tests) | 84 s | Pass |
| Phase 3 Integration Smoke (live stack) | 162 s | Pass |
| Route Cutover and Rollback (isolated stack) | 104 s | Pass |

Within the integration job, stack build/start took 72 s, frontend build 7 s, admin browser flow 12 s, and pinned-container visual parity 35 s. These job times include setup and waits, so they are not directly comparable to the isolated local build times.

## Verification and limits

The filtered image contained both executables and config, without docs, frontend files, or `.git`; Dockerfile CTest passed. The four security/dependency lints passed in the pinned Ubuntu image. A fresh Debug ASan/UBSan build passed CTest with zero compiler warnings. Against a verified disposable `ci-cutover` project, Phase 3 smoke passed 12/12, admin API smoke 33/33, public API/RSS smoke 17/17, admin Playwright 10/10, full visual parity 6/6 on rerun, and real RSS cutover/rollback 8/8. The first local visual run had a community screenshot at 3% difference; it passed a focused rerun and then the full suite with no fixture, code, or tolerance change. That intermittent local screenshot difference remains unexplained. The isolated project and its volumes were removed; primary hotel and legacy data were untouched.

Phase 2b still lacks a Compose frontend build service and truthful worker health state. This measurement does not close that phase or the separate Phase 1 OpenAPI gap.
