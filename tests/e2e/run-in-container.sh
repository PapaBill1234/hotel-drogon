#!/usr/bin/env bash
#
# Canonical visual-parity runner.
#
# Legacy baseline capture, local reproduction and CI all execute the suite
# through this script, inside the pinned Playwright image, so "same environment"
# is literally the same environment: one Chromium build and one font set.
#
# Usage (host side):
#
#   docker run --rm -i \
#     -v "$PWD:/repo:ro" \
#     -v "$PWD/tests/e2e/.out:/out" \
#     -e BASE_NEW=http://localhost:3000 \
#     -e PLAYWRIGHT_ARGS="visual-parity.spec.ts" \
#     --network host \
#     mcr.microsoft.com/playwright:v1.63.0-noble \
#     bash /repo/tests/e2e/run-in-container.sh
#
# Environment:
#   BASE_NEW            base URL of the app under comparison (default localhost:3000)
#   BASE_LEGACY         base URL of the legacy app (capture run only)
#   PLAYWRIGHT_ARGS     arguments passed to `npx playwright test`
#   PLAYWRIGHT_CONFIG   optional --config=... value
#   CAPTURE_ONLY        comma-separated page subset for the capture spec
#   PLAYWRIGHT_REPORTER reporter list (default: list)
#   OUT_DIR             where test-results and the HTML report are copied (default /out)
#   COPY_CAPTURED_TO    if set, captured baselines are copied here (capture run only)
#
# The repository is mounted read-only and copied into the container. Writing into
# the mount is deliberately avoided: a build would empty `frontend/dist` in the
# caller's tree.
set -eu

SRC=/repo
WORK=/tmp/parity
OUT_DIR="${OUT_DIR:-/out}"

rm -rf "$WORK"
mkdir -p "$WORK"

# Only what the suite needs, and without node_modules: copying a host
# node_modules into the container would be both slow and wrong (host binaries),
# and `npm ci` below reinstalls it from the committed lockfile.
mkdir -p "$WORK/tests"
tar -C "$SRC/tests" --exclude=node_modules --exclude=.out --exclude=test-results \
    --exclude=playwright-report -cf - . | tar -C "$WORK/tests" -xf -
mkdir -p "$WORK/docs"
cp -r "$SRC/docs/reference-screenshots" "$WORK/docs/reference-screenshots"

cd "$WORK/tests/e2e"
rm -rf node_modules playwright-report test-results

# `npm ci` so the committed lockfile decides the Playwright version. A floating
# install could pull a browser revision the image does not provide, which is the
# exact class of drift this script exists to remove.
npm ci --no-audit --no-fund

# Fixed environment so capture and comparison agree.
export TZ=UTC
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
export BASE_NEW="${BASE_NEW:-http://localhost:3000}"
if [ -n "${BASE_LEGACY:-}" ]; then export BASE_LEGACY; fi
if [ -n "${CAPTURE_ONLY:-}" ]; then export CAPTURE_ONLY; fi

CONFIG_ARG=""
if [ -n "${PLAYWRIGHT_CONFIG:-}" ]; then CONFIG_ARG="--config=${PLAYWRIGHT_CONFIG}"; fi

set +e
# shellcheck disable=SC2086
npx playwright test ${PLAYWRIGHT_ARGS:-visual-parity.spec.ts} \
  ${CONFIG_ARG} \
  --reporter="${PLAYWRIGHT_REPORTER:-list}"
STATUS=$?
set -e

echo
echo "=== playwright exit status: ${STATUS} ==="
echo "=== playwright package: $(node -p "require('@playwright/test/package.json').version") ==="
echo "=== chromium build: $(ls /ms-playwright | grep -E '^chromium-' | head -1) ==="

# Hand the artifacts back to the host so CI can upload them with `if: always()`.
if [ -d "$OUT_DIR" ]; then
  rm -rf "${OUT_DIR:?}/test-results" "${OUT_DIR:?}/playwright-report"
  if [ -d test-results ]; then cp -r test-results "$OUT_DIR/"; fi
  if [ -d playwright-report ]; then cp -r playwright-report "$OUT_DIR/"; fi
  echo "=== artifacts copied to ${OUT_DIR} ==="
fi

# Capture runs only: hand the freshly captured baselines back, so re-capturing
# does not require the caller to reach into the container.
if [ -n "${COPY_CAPTURED_TO:-}" ] && [ -d "$WORK/docs/reference-screenshots/baseline" ]; then
  mkdir -p "$COPY_CAPTURED_TO"
  cp "$WORK/docs/reference-screenshots/baseline"/*.png "$COPY_CAPTURED_TO/"
  echo "=== captured baselines copied to ${COPY_CAPTURED_TO} ==="
fi

exit "$STATUS"
