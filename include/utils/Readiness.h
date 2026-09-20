#pragma once

namespace hotel::utils {

/**
 * Process-wide readiness signal.
 *
 * Drogon begins accepting connections as soon as the event loop starts, which
 * is BEFORE the database schema and seed have finished. `HealthController`
 * previously reported healthy on the basis that the DB *client object* existed,
 * which says nothing about the data being usable.
 *
 * The consequence was a real, measured window (~620ms on a fresh database, from
 * the backend logs: "Listening on 0.0.0.0:8080" at 32.386 and "Default test user
 * and admin seeded successfully" at 33.006) during which the stack answered
 * `/health` with 200 while `testuser` did not exist yet. Any client that treats
 * `/health` as readiness — the CI `integration-smoke` job does exactly that —
 * could then issue its first request inside that window and fail. That is the
 * cause of the intermittent CI failure: a race, so it passed or failed
 * depending on whether nginx became reachable before or after the seed.
 *
 * Readiness is therefore signalled explicitly by the bootstrap, once the schema
 * and seed have actually completed, and `/health` returns 503 until then so a
 * poll for HTTP 200 cannot pass early.
 *
 * Starts NOT ready; a process that never completes its bootstrap will never
 * report ready, which is the correct failure mode.
 */
class Readiness {
public:
    static void markReady();
    static void markNotReady();
    static bool isReady();
};

}  // namespace hotel::utils
