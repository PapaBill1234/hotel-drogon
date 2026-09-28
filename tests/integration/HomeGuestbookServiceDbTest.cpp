#include <catch2/catch_test_macros.hpp>

#include "services/HomeGuestbookService.h"

#include <chrono>
#include <cstdlib>
#include <future>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

using hotel::services::HomeGuestbookCode;
using hotel::services::HomeGuestbookResult;
using hotel::services::HomeGuestbookService;

constexpr auto kCallbackTimeout = std::chrono::seconds(15);
constexpr uint32_t kProfileId = 920101;
constexpr uint32_t kOtherProfileId = 920102;
constexpr uint32_t kAuthorId = 920103;
constexpr uint32_t kFirstEntryId = 920201;
constexpr uint32_t kLastEntryId = 920254;

std::vector<drogon::orm::DbClientPtr>& retainedTestDbClients() {
    static std::vector<drogon::orm::DbClientPtr> clients;
    return clients;
}

HomeGuestbookResult waitForResult(std::future<HomeGuestbookResult>& future) {
    if (future.wait_for(kCallbackTimeout) != std::future_status::ready)
        throw std::runtime_error("home guestbook callback timed out");
    return future.get();
}

std::future<HomeGuestbookResult> entries(const drogon::orm::DbClientPtr& db,
                                         uint32_t profileId) {
    auto promise = std::make_shared<std::promise<HomeGuestbookResult>>();
    auto future = promise->get_future();
    HomeGuestbookService::getEntries(
        db, std::to_string(profileId), [promise](HomeGuestbookResult result) {
            promise->set_value(std::move(result));
        });
    return future;
}

struct FixtureCleanup {
    drogon::orm::DbClientPtr db;
    bool armed = false;

    explicit FixtureCleanup(drogon::orm::DbClientPtr client) : db(std::move(client)) {}

    ~FixtureCleanup() {
        if (armed) (void)cleanupRows();
    }

    bool rowsAbsent() noexcept {
        try {
            const auto guestbook = db->execSqlSync(
                "SELECT COUNT(*) AS total FROM phpretro_myhabbo_guestbook "
                "WHERE id BETWEEN ? AND ?",
                kFirstEntryId, kLastEntryId);
            const auto users = db->execSqlSync(
                "SELECT COUNT(*) AS total FROM users WHERE id = ?", kAuthorId);
            return guestbook[0]["total"].as<uint64_t>() == 0 &&
                   users[0]["total"].as<uint64_t>() == 0;
        } catch (...) {
            return false;
        }
    }

    void arm() { armed = true; }

    bool cleanupRows() noexcept {
        try {
            db->execSqlSync(
                "DELETE FROM phpretro_myhabbo_guestbook WHERE id BETWEEN ? AND ?",
                kFirstEntryId, kLastEntryId);
            db->execSqlSync("DELETE FROM users WHERE id = ?", kAuthorId);
            const auto guestbook = db->execSqlSync(
                "SELECT COUNT(*) AS total FROM phpretro_myhabbo_guestbook "
                "WHERE id BETWEEN ? AND ?",
                kFirstEntryId, kLastEntryId);
            const auto users = db->execSqlSync(
                "SELECT COUNT(*) AS total FROM users WHERE id = ?", kAuthorId);
            return guestbook[0]["total"].as<uint64_t>() == 0 &&
                   users[0]["total"].as<uint64_t>() == 0;
        } catch (...) {
            return false;
        }
    }
};

}  // namespace

TEST_CASE("Homes guestbook reads the public newest 50 rows as plain data",
          "[homes-guestbook-db]") {
    const char* host = std::getenv("HOMES_GUESTBOOK_TEST_DB_HOST");
    const char* database = std::getenv("HOMES_GUESTBOOK_TEST_DB_DATABASE");
    if (host == nullptr || *host == '\0' || database == nullptr || *database == '\0') {
        SKIP("Set HOMES_GUESTBOOK_TEST_DB_HOST and HOMES_GUESTBOOK_TEST_DB_DATABASE to run disposable MariaDB integration checks");
    }
    REQUIRE(std::string(database) == "homes_guestbook_test");

    const char* portText = std::getenv("HOMES_GUESTBOOK_TEST_DB_PORT");
    const int port = portText == nullptr ? 3306 : std::stoi(portText);
    const char* username = std::getenv("HOMES_GUESTBOOK_TEST_DB_USERNAME");
    const char* password = std::getenv("HOMES_GUESTBOOK_TEST_DB_PASSWORD");
    const std::string dbUser = username == nullptr ? "hotel" : username;
    const std::string dbPassword = password == nullptr ? "hotel_secret" : password;
    const std::string connectionInfo =
        "host=" + std::string(host) + " port=" + std::to_string(port) +
        " dbname=" + database + " user=" + dbUser + " password=" + dbPassword;
    const auto db = drogon::orm::DbClient::newMysqlClient(connectionInfo, 4);
    REQUIRE(db != nullptr);
    retainedTestDbClients().push_back(db);
    db->setTimeout(5.0);

    db->execSqlSync(
        "CREATE TABLE IF NOT EXISTS users ("
        "id INT NOT NULL, username VARCHAR(255) NOT NULL, "
        "look VARCHAR(255) NOT NULL DEFAULT '', online ENUM('0','1','2') NOT NULL DEFAULT '0', "
        "PRIMARY KEY (id)"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    db->execSqlSync(
        "CREATE TABLE IF NOT EXISTS phpretro_myhabbo_guestbook ("
        "id INT NOT NULL, profile_user_id INT NOT NULL, author_user_id INT NOT NULL, "
        "message TEXT NOT NULL, created_at INT NOT NULL, synced_at TIMESTAMP NULL DEFAULT NULL, "
        "PRIMARY KEY (id), INDEX idx_profile_user_id (profile_user_id, created_at)"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    FixtureCleanup cleanup(db);
    // Never delete a pre-existing row, even in a database with the expected
    // disposable name. Only arm teardown after proving every reserved key is free.
    REQUIRE(cleanup.rowsAbsent());
    cleanup.arm();
    db->execSqlSync("INSERT INTO users (id, username, look, online) VALUES (?, ?, ?, ?)",
                    kAuthorId, "guestbook-author", "look-opaque-1", "1");

    for (uint32_t index = 0; index < 52; ++index) {
        const uint32_t entryId = kFirstEntryId + index;
        const std::string message = index == 51
                                        ? "<script>alert(1)</script> [b]raw[/b]"
                                        : "entry-" + std::to_string(index);
        db->execSqlSync(
            "INSERT INTO phpretro_myhabbo_guestbook "
            "(id, profile_user_id, author_user_id, message, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            entryId, kProfileId, kAuthorId, message, 1700000000 + index);
    }
    db->execSqlSync(
        "INSERT INTO phpretro_myhabbo_guestbook "
        "(id, profile_user_id, author_user_id, message, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        kLastEntryId - 1, kOtherProfileId, kAuthorId, "other-profile", 1700000099);
    // Legacy's INNER JOIN excludes entries whose author row no longer exists.
    db->execSqlSync(
        "INSERT INTO phpretro_myhabbo_guestbook "
        "(id, profile_user_id, author_user_id, message, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        kLastEntryId, kProfileId, kAuthorId + 1, "missing-author", 1700000100);

    auto invalidFuture = entries(db, 0);
    const auto invalid = waitForResult(invalidFuture);
    CHECK(invalid.code == HomeGuestbookCode::InvalidInput);

    auto resultFuture = entries(db, kProfileId);
    const auto result = waitForResult(resultFuture);
    REQUIRE(result.code == HomeGuestbookCode::None);
    REQUIRE(result.entries.size() == HomeGuestbookService::kMaxEntries);
    CHECK(result.entries.front().id == kFirstEntryId + 51);
    CHECK(result.entries.back().id == kFirstEntryId + 2);
    CHECK(result.entries.front().profile_user_id == kProfileId);
    CHECK(result.entries.front().author_user_id == kAuthorId);
    CHECK(result.entries.front().message == "<script>alert(1)</script> [b]raw[/b]");
    CHECK(result.entries.front().created_at == 1700000051);
    CHECK(result.entries.front().username == "guestbook-author");
    CHECK(result.entries.front().look == "look-opaque-1");
    CHECK(result.entries.front().online == "1");

    auto otherProfileFuture = entries(db, kOtherProfileId);
    const auto otherProfile = waitForResult(otherProfileFuture);
    REQUIRE(otherProfile.code == HomeGuestbookCode::None);
    REQUIRE(otherProfile.entries.size() == 1);
    CHECK(otherProfile.entries.front().message == "other-profile");

    auto unknownProfileFuture = entries(db, kProfileId + 1000);
    const auto unknownProfile = waitForResult(unknownProfileFuture);
    REQUIRE(unknownProfile.code == HomeGuestbookCode::None);
    CHECK(unknownProfile.entries.empty());

    const auto rowCount = db->execSqlSync(
        "SELECT COUNT(*) AS total FROM phpretro_myhabbo_guestbook "
        "WHERE id BETWEEN ? AND ?",
        kFirstEntryId, kLastEntryId);
    CHECK(rowCount[0]["total"].as<uint64_t>() == 54);
    CHECK(cleanup.cleanupRows());
}
