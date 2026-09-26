# Build the exact lockfile's React bundle inside Compose, without host Node tools.
FROM node:20-bookworm@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# This one-shot service publishes the built files to nginx's generated-assets
# volume. nginx starts only after the copy succeeds.
CMD ["sh", "-c", "cp -a /app/dist/. /out/"]
