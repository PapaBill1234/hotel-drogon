#!/usr/bin/env bash
# Run the dependency-pin check against the UBUNTU 24.04 archive, which is the
# archive the pins are written for and the one CI's ubuntu-24.04 runner has.
#
# Why this exists: scripts/check_dependency_pins.py shells out to `apt-cache
# policy` and compares the result with the Dockerfile pins. Run it in a
# Debian-based image (python:3.12-slim, for instance) and apt answers from the
# Debian 13 archive, where every Ubuntu version string is "missing" and the
# check reports all ~23 packages as moved. That failure is the invocation, not
# the pins -- it reads as a genuine pin-drift alarm and cost a round of false
# diagnosis, so the correct invocation is worth having as a script.
#
#   bash scripts/run_pin_check.sh
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"

# Git Bash hands Docker a POSIX path (/c/Users/...) that Docker Desktop cannot
# bind-mount; it needs the native form (C:/Users/...). Convert when possible.
if command -v cygpath >/dev/null 2>&1; then
  repo="$(cygpath -m "${repo}")"
fi

docker run --rm -v "${repo}:/repo:ro" ubuntu:24.04 bash -lc '
  set -e
  apt-get update -qq
  apt-get install -y -qq python3 >/dev/null
  # The Dockerfile pins are resolved against a populated Ubuntu index.
  apt-get update -qq
  python3 /repo/scripts/check_dependency_pins.py
'
