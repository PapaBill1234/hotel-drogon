#pragma once

#include <drogon/orm/DbClient.h>

#include <cstdint>
#include <functional>
#include <string>

namespace hotel::services {

enum class HomeRatingCode {
    None,
    InvalidInput,
    NotFound,
    Unavailable,
};

/** The rating widget summary, with the legacy field names used by its template. */
struct HomeRatingSummary {
    uint64_t total = 0;
    uint64_t high = 0;
    double average = 0.0;
    uint32_t px = 0;
    bool mine = false;
    bool owner = false;
};

struct HomeRatingResult {
    HomeRatingCode code = HomeRatingCode::Unavailable;
    std::string message;
    HomeRatingSummary summary;

    bool ok() const { return code == HomeRatingCode::None; }
};

/**
 * Named read/write boundary for the website-owned MyHabbo ratings table.
 * Accepted first votes and their legacy outbox/audit records commit together.
 */
class HomeRatingService {
public:
    static HomeRatingSummary summarize(uint64_t total,
                                       uint64_t tally,
                                       uint64_t high,
                                       bool viewerHasVoted,
                                       bool viewerIsOwner);

    static HomeRatingCode validateVote(uint32_t ownerId,
                                       uint32_t widgetId,
                                       uint32_t voterId,
                                       int rating);

    static void getSummary(
        const drogon::orm::DbClientPtr& db,
        uint32_t ownerId,
        uint32_t viewerId,
        std::function<void(HomeRatingResult)> callback);

    static void castVote(
        const drogon::orm::DbClientPtr& db,
        uint32_t ownerId,
        uint32_t widgetId,
        uint32_t voterId,
        int rating,
        std::string ipAddress,
        std::function<void(HomeRatingResult)> callback);
};

}  // namespace hotel::services
