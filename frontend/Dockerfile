# Build the exact lockfile's React bundle inside Compose, without host Node tools.
FROM node:20-bookworm@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# This one-shot service publishes the built files to nginx's generated-assets
# volume. nginx starts only after the copy succeeds.
#
# ORDER MATTERS, which is why this is a script and not a bare `cp`:
#
#   1. copy the new build in — index.html is replaced and the new hashed bundles
#      appear;
#   2. only then delete the hashed files the new build does not contain.
#
# Pruning first would leave the volume holding an index.html that names files it
# no longer has: a window in which every visitor gets a 404 for the bundle.
# Pruning second means the worst case is a client on an *old* shell asking for a
# hash this deployment just removed — which is exactly what the entry point's
# `no-cache` revalidation in proxy/nginx.conf answers.
#
# Before this, nothing was ever pruned: every distinct build left its hash in the
# volume for good (recorded as a gap in docs/ai-run-state.md).
CMD ["sh", "-c", "cp -a /app/dist/. /out/ && find /out/assets -maxdepth 1 -type f ! -exec sh -c 'test -e \"/app/dist/assets/$(basename \"$1\")\"' _ {} \\; -delete && echo \"published $(ls /app/dist/assets | wc -l) assets; volume holds $(ls /out/assets | wc -l)\""]
