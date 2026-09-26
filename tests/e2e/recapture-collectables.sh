#!/usr/bin/env bash
# Re-capture the `collectables` visual baseline from the running legacy stack.
#
# The committed baseline was captured from a page state that no longer exists:
# it shows "Retro Club" as the selected top-level tab, whereas
# http://localhost:8081/credits/collectables now renders "Collectables
# [selected]". The parity spec compares /credits/collectables, so the old file
# was measuring the wrong page and diffed ~3%.
#
# Only this one page is captured, so no other baseline is touched. The capture
# spec refuses to write a baseline when the legacy app redirected away from the
# requested path, so a wrong-page capture fails loudly.
#
#   bash tests/e2e/recapture-collectables.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "${here}/../.." && pwd)"

if command -v cygpath >/dev/null 2>&1; then
  repo="$(cygpath -m "${repo}")"
fi

# MSYS_NO_PATHCONV stops Git Bash on Windows rewriting the container-side
# `/repo/tests/e2e/run-in-container.sh` argument into a `C:/Program Files/Git/...`
# host path, which the container then cannot find (exit 127).
MSYS_NO_PATHCONV=1 docker run --rm -i --network host \
  -v "${repo}:/repo:ro" \
  -v "${repo}/tests/e2e/.out:/out" \
  -v "${repo}/docs/reference-screenshots/baseline:/repo-baselines" \
  -e BASE_LEGACY=http://localhost:8081 \
  -e CAPTURE_ONLY=collectables \
  -e PLAYWRIGHT_ARGS=capture-references.spec.ts \
  -e PLAYWRIGHT_CONFIG=playwright.capture.config.ts \
  -e COPY_CAPTURED_TO=/repo-baselines \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  bash /repo/tests/e2e/run-in-container.sh
