# syntax=docker/dockerfile:1

# Stage 1: Build environment
FROM ubuntu:24.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    ninja-build \
    pkg-config \
    libssl-dev \
    zlib1g-dev \
    libbrotli-dev \
    libc-ares-dev \
    libyaml-cpp-dev \
    libjsoncpp-dev \
    uuid-dev \
    libmariadb-dev \
    libpq-dev \
    libsqlite3-dev \
    libhiredis-dev \
    libspdlog-dev \
    libcrypt-dev \
    catch2 \
    libdrogon-dev \
    nlohmann-json3-dev \
    ca-certificates \
    curl \
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
FROM ubuntu:24.04 AS runtime

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    libjsoncpp25 \
    libjsoncpp-dev \
    libmariadb3 \
    libpq5 \
    libsqlite3-0 \
    libbrotli1 \
    libcares2 \
    libyaml-cpp0.8 \
    libhiredis1.1.0 \
    libspdlog1.12 \
    libssl3 \
    zlib1g \
    libuuid1 \
    libdrogon1t64 \
    ca-certificates \
    curl \
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
