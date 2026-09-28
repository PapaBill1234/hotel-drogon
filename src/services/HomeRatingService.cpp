#include "services/HomeRatingService.h"

#include "utils/Logger.h"

#include <drogon/drogon.h>
#include <drogon/orm/Result.h>
#include <nlohmann/json.hpp>

#include <cmath>
#include <ctime>
#include <memory>
#include <string>
#include <utility>

namespace hotel::services {
namespace {

HomeRatingResult failure(HomeRatingCode code, std::string message) {
    HomeRatingResult result;
    result.code = code;
    result.message = std::move(message);
    return result;
}

bool isDuplicateVote(const std::string& message) {
    return message.find("Duplicate entry") != std::string::npos &&
           message.find("idx_profile_rater") != std::string::npos;
}

/**
 * A first-vote transaction. The legacy unique owner/rater index makes concurrent
 * duplicate votes harmless: only the inserted row gets an outbox event and
 * audit record. Other insert errors still fail the request.
 */
class HomeRatingVoteTransaction
    : public std::enable_shared_from_this<HomeRatingVoteTransaction> {
public:
    HomeRatingVoteTransaction(
        drogon::orm::DbClientPtr db,
        uint32_t ownerId,
        uint32_t widgetId,
        uint32_t voterId,
        int rating,
        std::string ipAddress,
        std::function<void(HomeRatingResult)> callback)
        : db_(std::move(db)),
          owner_id_(ownerId),
          widget_id_(widgetId),
          voter_id_(voterId),
          rating_(rating),
          ip_address_(std::move(ipAddress)),
          callback_(std::move(callback)) {}

    void start() {
        self_keep_alive_ = shared_from_this();
        const std::weak_ptr<HomeRatingVoteTransaction> weak = shared_from_this();
        try {
            transaction_ = db_->newTransaction([weak](bool committed) {
                if (const auto operation = weak.lock())
                    operation->transactionFinished(committed);
            });
        } catch (const std::exception& e) {
            HOTEL_LOG_ERROR("HomeRatingService::castVote: no transaction: {}", e.what());
            finish(failure(HomeRatingCode::Unavailable, "The rating could not be saved."));
            return;
        }
        if (!transaction_) {
            finish(failure(HomeRatingCode::Unavailable, "The rating could not be saved."));
            return;
        }
        checkOwner();
    }

private:
    void checkOwner() {
        const auto self = shared_from_this();
        *transaction_ << "SELECT id FROM users WHERE id = ? LIMIT 1" << owner_id_
                      >> [self](const drogon::orm::Result& rows) {
                             if (rows.empty()) {
                                 self->abort(HomeRatingCode::NotFound,
                                             "The home owner does not exist.");
                                 return;
                             }
                             self->checkWidget();
                         }
                      >> [self](const drogon::orm::DrogonDbException& e) {
                             self->databaseFailure("owner lookup", e);
                         };
    }

    void checkWidget() {
        const auto self = shared_from_this();
        *transaction_ << "SELECT id, user_id, guild_id, widget_key "
                         "FROM phpretro_myhabbo_layouts WHERE id = ? LIMIT 1"
                      << widget_id_
                      >> [self](const drogon::orm::Result& rows) {
                             if (rows.empty()) {
                                 self->abort(HomeRatingCode::NotFound,
                                             "The rating widget does not exist.");
                                 return;
                             }
                             const auto& row = rows[0];
                             if (row["user_id"].as<uint32_t>() != self->owner_id_ ||
                                 row["guild_id"].as<uint32_t>() != 0 ||
                                 row["widget_key"].as<std::string>() != "ratingwidget") {
                                 self->abort(HomeRatingCode::InvalidInput,
                                             "The widget is not this user's rating widget.");
                                 return;
                             }
                             self->insertVote();
                         }
                      >> [self](const drogon::orm::DrogonDbException& e) {
                             self->databaseFailure("widget lookup", e);
                         };
    }

    void insertVote() {
        const auto self = shared_from_this();
        const auto createdAt = static_cast<uint64_t>(std::time(nullptr));
        *transaction_ << "INSERT INTO phpretro_home_ratings "
                         "(profile_user_id, rater_id, rating, created_at) VALUES (?, ?, ?, ?)"
                      << owner_id_ << voter_id_ << rating_ << createdAt
                      >> [self](const drogon::orm::Result& result) {
                             if (result.affectedRows() == 0) {
                                 self->commit();
                                 return;
                             }
                             self->insertOutboxEvent();
                         }
                      >> [self](const drogon::orm::DrogonDbException& e) {
                             if (isDuplicateVote(e.base().what())) {
                                 self->abort(HomeRatingCode::None, "");
                             } else {
                                 self->databaseFailure("vote insert", e);
                             }
                         };
    }

    void insertOutboxEvent() {
        const nlohmann::json payload = {
            {"profile_user_id", owner_id_}, {"rater_id", voter_id_}, {"rating", rating_}};
        const auto json = payload.dump();
        const auto self = shared_from_this();
        *transaction_ << "INSERT INTO phpretro_emulator_outbox (event_type, payload_json) "
                         "VALUES ('homes.rated', ?)"
                      << json
                      >> [self](const drogon::orm::Result&) { self->insertAuditRecord(); }
                      >> [self](const drogon::orm::DrogonDbException& e) {
                             self->databaseFailure("outbox insert", e);
                         };
    }

    void insertAuditRecord() {
        const std::string details =
            "Recorded first home rating of " + std::to_string(rating_) +
            " for user " + std::to_string(owner_id_);
        const auto createdAt = static_cast<uint64_t>(std::time(nullptr));
        const auto self = shared_from_this();
        *transaction_ << "INSERT INTO phpretro_admin_action_log "
                         "(admin_id, action_type, target_type, target_id, details, ip, created_at) "
                         "VALUES (?, 'homes_rated', 'user', ?, ?, ?, ?)"
                      << voter_id_ << owner_id_ << details << ip_address_ << createdAt
                      >> [self](const drogon::orm::Result&) { self->commit(); }
                      >> [self](const drogon::orm::DrogonDbException& e) {
                             self->databaseFailure("audit insert", e);
                         };
    }

    void commit() {
        if (settled_ || aborting_) return;
        // Drogon's Transaction commits when the final shared pointer is released.
        // The callback registered in start() keeps this operation alive until it
        // can report the commit result.
        transaction_.reset();
    }

    void abort(HomeRatingCode code, const std::string& message) {
        if (settled_ || aborting_) return;
        aborting_ = true;
        failure_code_ = code;
        failure_message_ = message;
        if (!transaction_) {
            finish(failure(code, message));
            return;
        }

        const auto self = shared_from_this();
        try {
            // Queue ROLLBACK through the transaction so its connection can drain
            // normally before the last shared pointer is released.
            *transaction_ << "ROLLBACK"
                          >> [self](const drogon::orm::Result&) { self->finishFailure(); }
                      >> [self](const drogon::orm::DrogonDbException& e) {
                             if (std::string(e.base().what()) ==
                                 "The transaction has been rolled back") {
                                 HOTEL_LOG_DEBUG(
                                     "HomeRatingService::castVote: transaction already rolled back");
                             } else {
                                 HOTEL_LOG_WARN(
                                     "HomeRatingService::castVote: rollback failed: {}",
                                     e.base().what());
                             }
                             self->finishFailure();
                         };
        } catch (const std::exception& e) {
            HOTEL_LOG_WARN("HomeRatingService::castVote: could not queue rollback: {}", e.what());
            finishFailure();
        }
    }

    void finishFailure() {
        if (settled_) return;
        if (failure_code_ == HomeRatingCode::None) {
            const auto self = shared_from_this();
            transaction_.reset();
            HomeRatingService::getSummary(
                db_, owner_id_, voter_id_, [self](HomeRatingResult result) {
                    self->finish(std::move(result));
                });
            return;
        }
        finish(failure(failure_code_, failure_message_));
    }

    void transactionFinished(bool committed) {
        if (settled_ || aborting_) return;
        if (!committed) {
            finish(failure(HomeRatingCode::Unavailable, "The rating could not be saved."));
            return;
        }

        const auto self = shared_from_this();
        HomeRatingService::getSummary(
            db_, owner_id_, voter_id_, [self](HomeRatingResult result) {
                self->finish(std::move(result));
            });
    }

    void databaseFailure(const char* operation, const drogon::orm::DrogonDbException& error) {
        HOTEL_LOG_ERROR("HomeRatingService::castVote {}: {}", operation, error.base().what());
        abort(HomeRatingCode::Unavailable, "The rating could not be saved.");
    }

    void finish(HomeRatingResult result) {
        if (settled_) return;
        settled_ = true;
        const auto keepAlive = self_keep_alive_;
        self_keep_alive_.reset();
        transaction_.reset();
        auto callback = std::move(callback_);
        if (callback) callback(std::move(result));
        (void)keepAlive;
    }

    drogon::orm::DbClientPtr db_;
    std::shared_ptr<drogon::orm::Transaction> transaction_;
    uint32_t owner_id_;
    uint32_t widget_id_;
    uint32_t voter_id_;
    int rating_;
    std::string ip_address_;
    std::function<void(HomeRatingResult)> callback_;
    std::shared_ptr<HomeRatingVoteTransaction> self_keep_alive_;
    HomeRatingCode failure_code_ = HomeRatingCode::Unavailable;
    std::string failure_message_ = "The rating could not be saved.";
    bool aborting_ = false;
    bool settled_ = false;
};

}  // namespace

HomeRatingSummary HomeRatingService::summarize(uint64_t total,
                                               uint64_t tally,
                                               uint64_t high,
                                               bool viewerHasVoted,
                                               bool viewerIsOwner) {
    HomeRatingSummary summary;
    summary.total = total;
    summary.high = high;
    summary.average = total == 0 ? 0.0 : std::round((static_cast<double>(tally) / total) * 10.0) / 10.0;
    summary.px = static_cast<uint32_t>(std::ceil((summary.average * 150.0) / 5.0));
    summary.mine = viewerHasVoted;
    summary.owner = viewerIsOwner;
    return summary;
}

HomeRatingCode HomeRatingService::validateVote(uint32_t ownerId,
                                               uint32_t widgetId,
                                               uint32_t voterId,
                                               int rating) {
    if (ownerId == 0 || widgetId == 0 || voterId == 0 || ownerId == voterId || rating < 1 ||
        rating > 5) {
        return HomeRatingCode::InvalidInput;
    }
    return HomeRatingCode::None;
}

void HomeRatingService::getSummary(
    const drogon::orm::DbClientPtr& db,
    uint32_t ownerId,
    uint32_t viewerId,
    std::function<void(HomeRatingResult)> callback) {
    if (!callback) return;
    if (ownerId == 0) {
        callback(failure(HomeRatingCode::InvalidInput, "Invalid home owner."));
        return;
    }
    if (!db) {
        callback(failure(HomeRatingCode::Unavailable, "The rating could not be loaded."));
        return;
    }

    auto resultCallback =
        std::make_shared<std::function<void(HomeRatingResult)>>(std::move(callback));
    const auto deliver = [resultCallback](HomeRatingResult result) {
        if (!*resultCallback) return;
        auto callbackOnce = std::move(*resultCallback);
        callbackOnce(std::move(result));
    };

    *db << "SELECT COUNT(r.id) AS total, COALESCE(SUM(r.rating), 0) AS tally, "
           "COALESCE(SUM(CASE WHEN r.rating > 3 THEN 1 ELSE 0 END), 0) AS high, "
           "COALESCE(SUM(CASE WHEN r.rater_id = ? THEN 1 ELSE 0 END), 0) AS mine "
           "FROM users AS u LEFT JOIN phpretro_home_ratings AS r "
           "ON r.profile_user_id = u.id WHERE u.id = ? GROUP BY u.id"
        << viewerId << ownerId
        >> [deliver, ownerId, viewerId](const drogon::orm::Result& rows) {
               if (rows.empty()) {
                   deliver(failure(HomeRatingCode::NotFound,
                                   "The home owner does not exist."));
                   return;
               }
               const auto& row = rows[0];
               HomeRatingResult result;
               result.code = HomeRatingCode::None;
               result.summary = summarize(row["total"].as<uint64_t>(),
                                          row["tally"].as<uint64_t>(),
                                          row["high"].as<uint64_t>(),
                                          row["mine"].as<uint64_t>() > 0,
                                          viewerId != 0 && viewerId == ownerId);
               deliver(std::move(result));
           }
        >> [deliver](const drogon::orm::DrogonDbException& e) {
               HOTEL_LOG_ERROR("HomeRatingService::getSummary: {}", e.base().what());
               deliver(failure(HomeRatingCode::Unavailable,
                               "The rating could not be loaded."));
           };
}

void HomeRatingService::castVote(
    const drogon::orm::DbClientPtr& db,
    uint32_t ownerId,
    uint32_t widgetId,
    uint32_t voterId,
    int rating,
    std::string ipAddress,
    std::function<void(HomeRatingResult)> callback) {
    if (!callback) return;
    const auto validation = validateVote(ownerId, widgetId, voterId, rating);
    if (validation != HomeRatingCode::None) {
        if (ownerId == 0 || widgetId == 0)
            callback(failure(validation, "Invalid rating widget."));
        else if (voterId == 0)
            callback(failure(validation, "Sign in required."));
        else if (ownerId == voterId)
            callback(failure(validation, "You cannot vote for yourself."));
        else
            callback(failure(validation, "Rating must be between 1 and 5."));
        return;
    }
    if (!db) {
        callback(failure(HomeRatingCode::Unavailable, "The rating could not be saved."));
        return;
    }

    auto operation = std::make_shared<HomeRatingVoteTransaction>(
        db, ownerId, widgetId, voterId, rating, std::move(ipAddress), std::move(callback));
    operation->start();
}

}  // namespace hotel::services
