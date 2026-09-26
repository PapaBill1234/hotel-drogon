# syntax=docker/dockerfile:1
FROM node:24.13.0-bookworm@sha256:1de022d8459f896fff2e7b865823699dc7a8d5567507e8b87b14a7442e07f206
WORKDIR /workspace
RUN corepack enable
COPY --from=renderer_src / /workspace/Octane-Renderer/
COPY --from=octane_src / /workspace/Octane/
COPY prepare-octane-config.mjs /workspace/Octane/prepare-octane-config.mjs
WORKDIR /workspace/Octane
# The pinned upstream ships a JSONC example but its installer still expects a
# differently named strict-JSON example. Vite resolves renderer source by alias;
# Yarn 4's legacy global link command is unnecessary here.
RUN yarn install --immutable && node prepare-octane-config.mjs
RUN node install.mjs --non-interactive --skip-clone --skip-link \
    --renderer-dir=/workspace/Octane-Renderer --json-mode=jsonc \
    --socket-url=ws://127.0.0.1:3202 \
    --api-url=http://127.0.0.1:3201 \
    --asset-url=http://127.0.0.1:3201/nitro-assets/bundled \
    --image-library-url=http://127.0.0.1:3201/swf/c_images/ \
    --hof-furni-url=http://127.0.0.1:3201/swf/dcr/hof_furni \
    --camera-url=http://127.0.0.1:3201/camera \
    --thumbnails-url=http://127.0.0.1:3201/thumbnails \
    --habbopages-url=/habbopages \
    --api-base-url=http://127.0.0.1:3201 \
    --plain-config-base-url=http://127.0.0.1:3201/configuration \
    --plain-gamedata-base-url=http://127.0.0.1:3201/nitro-assets/gamedata \
    --skip-build
RUN yarn build
EXPOSE 5173
ENV AUTH_PROXY_TARGET=http://emulator:2096
CMD ["yarn", "start", "--host", "0.0.0.0", "--port", "5173"]
