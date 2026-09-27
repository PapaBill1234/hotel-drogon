# Build the exact lockfile's React bundle inside Compose, without host Node tools.
FROM node:20-bookworm@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# This one-shot service publishes the built files to nginx's generated-assets
# volume. nginx starts only after it exits 0, so the volume is never read while
# a deployment is half-applied.
#
# The publisher is a checked-in script, not an inline `sh -c`, for two reasons:
# the three ordering properties it guarantees (new bundles first, entry point
# last and by rename, old hashes retained for a grace period) are spelled out
# where they can be tested — scripts/check_frontend_publish_order.sh runs the
# real script against a real directory tree and needs no Docker — and the grace
# period becomes a documented knob instead of a magic number in a CMD.
COPY publish-dist.sh /usr/local/bin/publish-dist.sh

# How long a replaced build's hashed files stay in the volume. A visitor who
# loaded index.html seconds before a deploy must still be able to fetch the
# chunks that shell names; 15 minutes covers a page left open across a deploy
# without letting dead hashes accumulate. Expiry is per asset and is measured
# from the last deployment that shipped it, so a long-quiet volume converges to
# exactly one build's files.
ENV PUBLISH_GRACE_SECONDS=900

CMD ["sh", "/usr/local/bin/publish-dist.sh"]
