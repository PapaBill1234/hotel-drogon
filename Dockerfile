# syntax=docker/dockerfile:1

# Base image pinned BY DIGEST.
#
# `ubuntu:24.04` is a moving tag: the same Dockerfile can build against different
# package sets on different days. The digest below pins the multi-platform index
# that was in use when the package pins underneath were recorded, so the builder
# and runtime stages are the same image even months apart.
#
# This does NOT remove the need to take security updates — see
# docs/dependency-policy.md. It makes an update a deliberate, reviewable change
# instead of something that happens silently. That file also gives the exact
# procedure for moving the digest and the package versions together.
FROM ubuntu:24.04@sha256:008173c23f95b170204355c12626cb5a965d779a7e1283b09e9cffbb1bf33ca3 AS builder

ENV DEBIAN_FRONTEND=noninteractive

# Direct build dependencies, each pinned to an exact version and each verified to
# resolve in the pinned image's archive (see docs/dependency-policy.md for the
# verification command and the update procedure).
#
# Why exact pins rather than a dependency manager: recorded in
# docs/cpp-drogon-conversion-plan.md ("Build system") with the measurements behind
# it. Short version: this archive is the only source that supplies Drogon 1.8.7,
# which is the version this code is written and built against.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential=12.10ubuntu1 \
    cmake=3.28.3-1build7 \
    git=1:2.43.0-1ubuntu7.3 \
    ninja-build=1.11.1-2 \
    pkg-config=1.8.1-2build1 \
    libssl-dev=3.0.13-0ubuntu3.15 \
    zlib1g-dev=1:1.3.dfsg-3.1ubuntu2.2 \
    libbrotli-dev=1.1.0-2build2 \
    libc-ares-dev=1.27.0-1.0ubuntu1 \
    libyaml-cpp-dev=0.8.0+dfsg-6build1 \
    libjsoncpp-dev=1.9.5-6build1 \
    uuid-dev=2.39.3-9ubuntu6.6 \
    libmariadb-dev=1:10.11.14-0ubuntu0.24.04.1 \
    libpq-dev=16.15-0ubuntu0.24.04.1 \
    libsqlite3-dev=3.45.1-1ubuntu2.8 \
    libhiredis-dev=1.2.0-6ubuntu3 \
    libspdlog-dev=1:1.12.0+ds-2build1 \
    libcrypt-dev=1:4.4.36-4build1 \
    catch2=3.4.0-1build1 \
    libdrogon-dev=1.8.7+ds-1.1build1 \
    nlohmann-json3-dev=3.11.3-1 \
    ca-certificates=20260601~24.04.1 \
    curl=8.5.0-2ubuntu10.15 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy source tree
COPY . /app

# Configure and build with CMake
RUN cmake -B build -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_TESTING=ON \
    -DENABLE_SANITIZERS=OFF

RUN cmake --build build --parallel $(nproc)

# Run Catch2 tests during container build
RUN ctest --test-dir build --output-on-failure

# Stage 2: Minimal Runtime image
# Same digest as the builder: the runtime libraries must come from the archive
# the binaries were linked against.
FROM ubuntu:24.04@sha256:008173c23f95b170204355c12626cb5a965d779a7e1283b09e9cffbb1bf33ca3 AS runtime

ENV DEBIAN_FRONTEND=noninteractive

# Runtime libraries the binaries link against, pinned to the same archive
# versions as the builder's -dev packages.
#
# `libssl3` is NOT listed: in noble it is a virtual package provided by
# `libssl3t64`, and naming it fails the install. OpenSSL arrives as a dependency
# of libdrogon1t64.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libjsoncpp25=1.9.5-6build1 \
    libmariadb3=1:10.11.14-0ubuntu0.24.04.1 \
    libpq5=16.15-0ubuntu0.24.04.1 \
    libsqlite3-0=3.45.1-1ubuntu2.8 \
    libbrotli1=1.1.0-2build2 \
    libcares2=1.27.0-1.0ubuntu1 \
    libyaml-cpp0.8=0.8.0+dfsg-6build1 \
    libhiredis1.1.0=1.2.0-6ubuntu3 \
    libspdlog1.12=1:1.12.0+ds-2build1 \
    zlib1g=1:1.3.dfsg-3.1ubuntu2.2 \
    libuuid1=2.39.3-9ubuntu6.6 \
    libdrogon1t64=1.8.7+ds-1.1build1 \
    ca-certificates=20260601~24.04.1 \
    curl=8.5.0-2ubuntu10.15 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy compiled binaries from builder stage
COPY --from=builder /app/build/hotel_server /app/hotel_server
COPY --from=builder /app/build/hotel_worker /app/hotel_worker
COPY --from=builder /app/config /app/config

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["/app/hotel_server"]
