#include <catch2/catch_test_macros.hpp>

#include "services/HomeRatingService.h"

#include <chrono>
#include <cstdlib>
#include <future>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

using hotel::services::HomeRatingCode;
using hotel::services::HomeRatingResult;
using hotel::services::HomeRatingService;

constexpr auto kCallbackTimeout = std::chrono::seconds(15);

std::vector<drogon::orm::DbClientPtr>& retainedTestDbClients() {
    static std::vector<drogon::orm::DbClientPtr> clients;
    return clients;
}

template <typename Result>
Result waitForResult(std::future<Result>& future) {
    if (future.wait_for(kCallbackTimeout) != std::future_status::ready)
        throw std::runtime_error("home rating callback timed out");
    return future.get();
}

std::future<HomeRatingResult> summary(const drogon::orm::DbClientPtr& db,
                                      uint32_t ownerId,
                                      uint32_t viewerId) {
    auto promise = std::make_shared<std::promise<HomeRatingResult>>();
    auto future = promise->get_future();
    HomeRatingService::getSummary(db, ownerId, viewerId,
                                  [promise](HomeRatingResult result) {
                                      promise->set_value(std::move(result));
                                  });
    return future;
}

std::future<HomeRatingResult> castVote(const drogon::orm::DbClientPtr& db,
                                       uint32_t ownerId,
                                       uint32_t widgetId,
                                       uint32_t voterId,
                                       int rating) {
    auto promise = std::make_shared<std::promise<HomeRatingResult>>();
    auto future = promise->get_future();
    HomeRatingService::castVote(db, ownerId, widgetId, voterId, rating, "192.0.2.40",
                                [promise](HomeRatingResult result) {
                                    promise->set_value(std::move(result));
                                });
    return future;
}

struct FixtureCleanup {
    drogon::orm::DbClientPtr db;
    uint32_t ownerId = 0;
    std::vector<uint32_t> raterIds;
    std::vector<uint32_t> widgetIds;

    explicit FixtureCleanup(drogon::orm::DbClientPtr client) : db(std::move(client)) {}

    ~FixtureCleanup() {
        if (!cleaned_) (void)cleanupRows();
    }

    bool cleanupRows() noexcept {
        if (!db) {
            cleaned_ = true;
            return true;
        }
        bool succeeded = true;
        try {
            db->execSqlSync("DROP TRIGGER IF EXISTS trg_homes_rating_test_audit_failure");
            db->execSqlSync(
                "DELETE FROM phpretro_admin_action_log WHERE action_type = 'homes_rated' "
                "AND target_id = ? AND admin_id IN (?, ?, ?, ?, ?)",
                ownerId, raterIds[0], raterIds[1], raterIds[2], raterIds[3], raterIds[4]);
            db->execSqlSync(
                "DELETE FROM phpretro_emulator_outbox WHERE event_type = 'homes.rated' "
                "AND JSON_EXTRACT(payload_json, '$.profile_user_id') = ?",
                ownerId);
            db->execSqlSync("DELETE FROM phpretro_home_ratings WHERE profile_user_id = ?", ownerId);
            for (const auto widgetId : widgetIds)
                db->execSqlSync("DELETE FROM phpretro_myhabbo_layouts WHERE id = ?", widgetId);
            for (const auto raterId : raterIds)
                db->execSqlSync("DELETE FROM users WHERE id = ?", raterId);
            db->execSqlSync("DELETE FROM users WHERE id = ?", ownerId);

            const auto ratings = db->execSqlSync(
                "SELECT COUNT(*) AS total FROM phpretro_home_ratings WHERE profile_user_id = ?",
                ownerId);
            const auto outbox = db->execSqlSync(
                "SELECT COUNT(*) AS total FROM phpretro_emulator_outbox "
                "WHERE event_type = 'homes.rated' "
                "AND JSON_EXTRACT(payload_json, '$.profile_user_id') = ?",
                ownerId);
            const auto audit = db->execSqlSync(
                "SELECT COUNT(*) AS total FROM phpretro_admin_action_log "
                "WHERE action_type = 'homes_rated' AND target_id = ?",
                ownerId);
            const auto layouts = db->execSqlSync(
                "SELECT COUNT(*) AS total FROM phpretro_myhabbo_layouts WHERE user_id = ?",
                ownerId);
            const auto users = db->execSqlSync(
                "SELECT COUNT(*) AS total FROM users WHERE id = ?", ownerId);
            succeeded = ratings[0]["total"].as<uint64_t>() == 0 &&
                        outbox[0]["total"].as<uint64_t>() == 0 &&
                        audit[0]["total"].as<uint64_t>() == 0 &&
                        layouts[0]["total"].as<uint64_t>() == 0 &&
                        users[0]["total"].as<uint64_t>() == 0;
        } catch (...) {
            succeeded = false;
        }
        cleaned_ = succeeded;
        return succeeded;
    }

private:
    bool cleaned_ = false;
};

}  // namespace

TEST_CASE("Home ratings keep one vote per user and commit the event with audit",
          "[homes-rating-db]") {
    const char* host = std::getenv("HOMES_RATING_TEST_DB_HOST");
    const char* database = std::getenv("HOMES_RATING_TEST_DB_DATABASE");
    if (host == nullptr || *host == '\0' || database == nullptr || *database == '\0') {
        SKIP("Set HOMES_RATING_TEST_DB_HOST and HOMES_RATING_TEST_DB_DATABASE to use disposable MariaDB");
    }
    REQUIRE(std::string(database) == "homes_rating_test");

    const char* portText = std::getenv("HOMES_RATING_TEST_DB_PORT");
    const int port = portText == nullptr ? 3306 : std::stoi(portText);
    const char* username = std::getenv("HOMES_RATING_TEST_DB_USERNAME");
    const char* password = std::getenv("HOMES_RATING_TEST_DB_PASSWORD");
    const std::string dbUser = username == nullptr ? "hotel" : username;
    const std::string dbPassword = password == nullptr ? "hotel_secret" : password;
    const std::string connectionInfo =
        "host=" + std::string(host) + " port=" + std::to_string(port) +
        " dbname=" + database + " user=" + dbUser + " password=" + dbPassword;
    const auto db = drogon::orm::DbClient::newMysqlClient(connectionInfo, 4);
    REQUIRE(db != nullptr);
    retainedTestDbClients().push_back(db);
    db->setTimeout(5.0);
    const auto selectedDatabase = db->execSqlSync("SELECT DATABASE() AS name");
    REQUIRE(selectedDatabase[0]["name"].as<std::string>() == "homes_rating_test");

    db->execSqlSync(
        "CREATE TABLE IF NOT EXISTS users (id INT NOT NULL PRIMARY KEY) "
        "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    db->execSqlSync(
        "CREATE TABLE IF NOT EXISTS phpretro_myhabbo_layouts ("
        "id INT NOT NULL AUTO_INCREMENT, user_id INT NOT NULL, guild_id INT NOT NULL DEFAULT 0, "
        "widget_key VARCHAR(50) NOT NULL, PRIMARY KEY (id), INDEX idx_user_id (user_id), "
        "INDEX idx_guild_id (guild_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    db->execSqlSync(
        "CREATE TABLE IF NOT EXISTS phpretro_home_ratings ("
        "id INT NOT NULL AUTO_INCREMENT, profile_user_id INT NOT NULL, rater_id INT NOT NULL, "
        "rating TINYINT NOT NULL, created_at INT NOT NULL, synced_at TIMESTAMP NULL DEFAULT NULL, "
        "PRIMARY KEY (id), UNIQUE INDEX idx_profile_rater (profile_user_id, rater_id), "
        "INDEX idx_profile (profile_user_id), "
        "CONSTRAINT fk_rating_test_profile FOREIGN KEY (profile_user_id) REFERENCES users(id) "
        "ON DELETE CASCADE, CONSTRAINT fk_rating_test_rater FOREIGN KEY (rater_id) REFERENCES users(id) "
        "ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    db->execSqlSync(
        "CREATE TABLE IF NOT EXISTS phpretro_emulator_outbox ("
        "id INT NOT NULL AUTO_INCREMENT, event_type VARCHAR(64) NOT NULL, payload_json JSON NOT NULL, "
        "status ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending', "
        "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, processed_at DATETIME NULL, "
        "PRIMARY KEY (id), INDEX idx_status_created (status, created_at)) "
        "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    db->execSqlSync(
        "CREATE TABLE IF NOT EXISTS phpretro_admin_action_log ("
        "id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, admin_id INT, action_type VARCHAR(64), "
        "target_type VARCHAR(64), target_id INT DEFAULT 0, details TEXT, ip VARCHAR(50) DEFAULT '', "
        "created_at BIGINT DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    const auto marker = static_cast<uint32_t>(
        1800000000U + static_cast<uint32_t>(
            std::chrono::duration_cast<std::chrono::microseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count() % 100000000));
    const auto staleRows = db->execSqlSync(
        "SELECT COUNT(*) AS total FROM users WHERE id IN (?, ?, ?, ?, ?, ?)",
        marker, marker + 1, marker + 2, marker + 3, marker + 4, marker + 5);
    REQUIRE(staleRows[0]["total"].as<uint64_t>() == 0);

    FixtureCleanup cleanup(db);
    cleanup.ownerId = marker;
    cleanup.raterIds = {marker + 1, marker + 2, marker + 3, marker + 4, marker + 5};

    db->execSqlSync("INSERT INTO users (id) VALUES (?), (?), (?), (?), (?), (?)",
                    marker, cleanup.raterIds[0], cleanup.raterIds[1], cleanup.raterIds[2],
                    cleanup.raterIds[3], cleanup.raterIds[4]);
    const auto ratingWidget = db->execSqlSync(
        "INSERT INTO phpretro_myhabbo_layouts (user_id, guild_id, widget_key) "
        "VALUES (?, 0, 'ratingwidget')", marker);
    const auto profileWidget = db->execSqlSync(
        "INSERT INTO phpretro_myhabbo_layouts (user_id, guild_id, widget_key) "
        "VALUES (?, 0, 'profilewidget')", marker);
    cleanup.widgetIds = {static_cast<uint32_t>(ratingWidget.insertId()),
                         static_cast<uint32_t>(profileWidget.insertId())};

    auto missingOwnerFuture = summary(db, marker + 98, 0);
    const auto missingOwner = waitForResult(missingOwnerFuture);
    REQUIRE(missingOwner.code == HomeRatingCode::NotFound);

    auto initialFuture = summary(db, marker, 0);
    const auto initial = waitForResult(initialFuture);
    REQUIRE(initial.ok());
    REQUIRE(initial.summary.total == 0);
    REQUIRE(initial.summary.average == 0.0);
    REQUIRE(initial.summary.px == 0);
    REQUIRE_FALSE(initial.summary.mine);
    REQUIRE_FALSE(initial.summary.owner);

    auto firstFuture = castVote(db, marker, cleanup.widgetIds[0], cleanup.raterIds[0], 4);
    const auto first = waitForResult(firstFuture);
    REQUIRE(first.ok());
    REQUIRE(first.summary.total == 1);
    REQUIRE(first.summary.high == 1);
    REQUIRE(first.summary.average == 4.0);
    REQUIRE(first.summary.px == 120);
    REQUIRE(first.summary.mine);
    REQUIRE_FALSE(first.summary.owner);

    auto repeatFuture = castVote(db, marker, cleanup.widgetIds[0], cleanup.raterIds[0], 1);
    const auto repeat = waitForResult(repeatFuture);
    REQUIRE(repeat.ok());
    REQUIRE(repeat.summary.total == 1);
    REQUIRE(repeat.summary.average == 4.0);
    REQUIRE(repeat.summary.px == 120);

    auto secondFuture = castVote(db, marker, cleanup.widgetIds[0], cleanup.raterIds[1], 5);
    const auto second = waitForResult(secondFuture);
    REQUIRE(second.ok());
    REQUIRE(second.summary.total == 2);
    REQUIRE(second.summary.high == 2);
    REQUIRE(second.summary.average == 4.5);
    REQUIRE(second.summary.px == 135);

    auto ownerFuture = summary(db, marker, marker);
    const auto ownerView = waitForResult(ownerFuture);
    REQUIRE(ownerView.ok());
    REQUIRE(ownerView.summary.owner);
    REQUIRE_FALSE(ownerView.summary.mine);

    auto selfVoteFuture = castVote(db, marker, cleanup.widgetIds[0], marker, 5);
    const auto selfVote = waitForResult(selfVoteFuture);
    REQUIRE(selfVote.code == HomeRatingCode::InvalidInput);
    auto wrongWidgetFuture = castVote(db, marker, cleanup.widgetIds[1], cleanup.raterIds[2], 5);
    const auto wrongWidget = waitForResult(wrongWidgetFuture);
    REQUIRE(wrongWidget.code == HomeRatingCode::InvalidInput);
    auto invalidRangeFuture = castVote(db, marker, cleanup.widgetIds[0], cleanup.raterIds[2], 6);
    const auto invalidRange = waitForResult(invalidRangeFuture);
    REQUIRE(invalidRange.code == HomeRatingCode::InvalidInput);

    auto concurrentA = castVote(db, marker, cleanup.widgetIds[0], cleanup.raterIds[2], 2);
    auto concurrentB = castVote(db, marker, cleanup.widgetIds[0], cleanup.raterIds[2], 5);
    const auto concurrentResultA = waitForResult(concurrentA);
    const auto concurrentResultB = waitForResult(concurrentB);
    REQUIRE(concurrentResultA.ok());
    REQUIRE(concurrentResultB.ok());
    REQUIRE(concurrentResultA.summary.total == 3);
    REQUIRE(concurrentResultB.summary.total == 3);

    // A real foreign-key failure must not be mistaken for a duplicate vote.
    auto missingVoterFuture = castVote(db, marker, cleanup.widgetIds[0], marker + 99, 5);
    const auto missingVoter = waitForResult(missingVoterFuture);
    REQUIRE(missingVoter.code == HomeRatingCode::Unavailable);

    const std::string triggerName = "trg_homes_rating_test_audit_failure";
    db->execSqlSync("DROP TRIGGER IF EXISTS " + triggerName);
    db->execSqlSync(
        "CREATE TRIGGER " + triggerName +
        " BEFORE INSERT ON phpretro_admin_action_log FOR EACH ROW "
        "BEGIN IF NEW.action_type = 'homes_rated' THEN "
        "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced Homes audit failure'; END IF; END");
    auto rollbackFuture = castVote(db, marker, cleanup.widgetIds[0], cleanup.raterIds[3], 5);
    const auto rollbackResult = waitForResult(rollbackFuture);
    REQUIRE(rollbackResult.code == HomeRatingCode::Unavailable);
    db->execSqlSync("DROP TRIGGER IF EXISTS " + triggerName);

    const auto counts = db->execSqlSync(
        "SELECT (SELECT COUNT(*) FROM phpretro_home_ratings WHERE profile_user_id = ?) AS votes, "
        "(SELECT COUNT(*) FROM phpretro_emulator_outbox WHERE event_type = 'homes.rated' "
        "AND JSON_EXTRACT(payload_json, '$.profile_user_id') = ?) AS outbox, "
        "(SELECT COUNT(*) FROM phpretro_admin_action_log WHERE action_type = 'homes_rated' "
        "AND target_id = ?) AS audit",
        marker, marker, marker);
    REQUIRE(counts[0]["votes"].as<uint64_t>() == 3);
    REQUIRE(counts[0]["outbox"].as<uint64_t>() == 3);
    REQUIRE(counts[0]["audit"].as<uint64_t>() == 3);

    const auto recordedRating = db->execSqlSync(
        "SELECT rating FROM phpretro_home_ratings WHERE profile_user_id = ? AND rater_id = ?",
        marker, cleanup.raterIds[0]);
    REQUIRE(recordedRating.size() == 1);
    REQUIRE(recordedRating[0]["rating"].as<int>() == 4);
    const auto recordedOutbox = db->execSqlSync(
        "SELECT JSON_EXTRACT(payload_json, '$.rating') AS rating FROM phpretro_emulator_outbox "
        "WHERE event_type = 'homes.rated' "
        "AND JSON_EXTRACT(payload_json, '$.rater_id') = ?",
        cleanup.raterIds[0]);
    REQUIRE(recordedOutbox.size() == 1);
    REQUIRE(recordedOutbox[0]["rating"].as<int>() == 4);

    REQUIRE(cleanup.cleanupRows());
}
