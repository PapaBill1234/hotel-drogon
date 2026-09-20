# Phase 2b preflight — host and toolchain checks

Required by the plan's Phase 2b bullet: *"Preflight first: run `g++ --version`
(or Clang), `cmake --version`, `git --version`, `systemd-detect-virt`,
`docker --version`, and `docker ps`. Report the results before infrastructure
changes."*

Recorded because the plan asks for the results to be **reported**, and without a
captured artifact there is nothing to report. `scripts/preflight.sh` reproduces
every line below and CI runs it as a visible step, so this file can be checked
against a live run rather than trusted.

## Development host (this workstation)

| Check | Result |
| --- | --- |
| Date (UTC) | 2026-09-20 17:14 |
| Host OS | Microsoft Windows 11 Pro, build 10.0.26200 |
| `git --version` | `git version 2.55.0.windows.5` |
| `docker --version` | `Docker version 29.8.0, build 88096ef` |
| `docker compose version` | `5.5.1` |
| `node --version` | `v24.21.0` |
| `npm --version` | `10.9.9` |
| Hypervisor present | `True` (Docker Desktop, overlayfs storage driver) |
| `systemd-detect-virt` | `wsl` — run inside the Linux build image, which is the only Linux context this host has |

The development host is **not** where the service runs: the stack is built and
run in containers, and CI builds on Linux. The Linux-side rows below are the
ones that determine the deliverable.

## Linux build environment (Ubuntu 24.04)

Run in `ubuntu:24.04` with the same package set the `Dockerfile` installs, which
is also the CI runner's base image:

| Check | Result |
| --- | --- |
| `g++ --version` | `g++ (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0` |
| `cmake --version` | `cmake version 3.28.3` |
| `git --version` | `git version 2.43.0` |
| `systemd-detect-virt` | `wsl` on this host; the GitHub runner is a hosted VM, and CI prints its own result |

## Docker availability

`docker ps` reaches the daemon on this host: the primary stack
(`hotel_backend`, `hotel_proxy`, `hotel_mariadb`, `hotel_redis`, `hotel_worker`)
and the legacy capture stack (`legacy_web`, `legacy_db`) run under it, and the
isolated reproduction projects (`ci-repro`, `ci-parity`, `ci-noweb`) were created
and destroyed under it. Docker is therefore **available**, not restricted, and
the plan's "stop Docker work and use the native path" branch does not apply here.

## CI runner

The `ubuntu-24.04` hosted runner runs the same check as its first job step; the
job log is the authoritative record for CI. Last verified green run:
`35524678557` (then `35524944450`), both jobs `success`.

## What this changes

Nothing. This is an evidence artifact for a plan requirement that previously had
none; it confirms the toolchain assumptions the Dockerfile, `CMakeLists.txt` and
CI already rely on rather than introducing new infrastructure.
