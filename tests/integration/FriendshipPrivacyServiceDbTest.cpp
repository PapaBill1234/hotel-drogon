#include <catch2/catch_test_macros.hpp>

#include "services/FriendshipPrivacyService.h"

#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <future>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
using hotel::services::FriendshipPrivacyCode;
using hotel::services::FriendshipPrivacyResult;
using hotel::services::FriendshipPrivacyService;
constexpr uint32_t kOwner = 930101;
constexpr uint32_t kFriend = 930102;
constexpr uint32_t kStranger = 930103;

std::vector<drogon::orm::DbClientPtr>& clients() {
    static std::vector<drogon::orm::DbClientPtr> value;
    return value;
}

FriendshipPrivacyResult wait(std::future<FriendshipPrivacyResult>& future) {
    if (future.wait_for(std::chrono::seconds(15)) != std::future_status::ready)
        throw std::runtime_error("friendship privacy callback timed out");
    return future.get();
}

FriendshipPrivacyResult check(const drogon::orm::DbClientPtr& db,
                              uint32_t actor,
                              bool privateHome) {
    auto promise = std::make_shared<std::promise<FriendshipPrivacyResult>>();
    auto future = promise->get_future();
    FriendshipPrivacyService::canPostPersonalGuestbook(
        db, kOwner, actor, privateHome,
        [promise](FriendshipPrivacyResult result) {
            promise->set_value(std::move(result));
        });
    return wait(future);
}
}  // namespace

TEST_CASE("personal guestbook friendship privacy reads a directed legacy friendship",
          "[homes-guestbook-privacy-db]") {
    const char* host = std::getenv("HOMES_GUESTBOOK_TEST_DB_HOST");
    const char* database = std::getenv("HOMES_GUESTBOOK_TEST_DB_DATABASE");
    if (host == nullptr || *host == '\0' || database == nullptr || *database == '\0') {
        SKIP("Set HOMES_GUESTBOOK_TEST_DB_HOST and HOMES_GUESTBOOK_TEST_DB_DATABASE for disposable DB checks");
    }
    REQUIRE(std::string(database) == "homes_guestbook_test");
    const char* portText = std::getenv("HOMES_GUESTBOOK_TEST_DB_PORT");
    const int port = portText == nullptr ? 3306 : std::stoi(portText);
    const char* userText = std::getenv("HOMES_GUESTBOOK_TEST_DB_USERNAME");
    const char* passwordText = std::getenv("HOMES_GUESTBOOK_TEST_DB_PASSWORD");
    const auto user = std::string(userText == nullptr ? "hotel" : userText);
    const auto password = std::string(passwordText == nullptr ? "hotel_secret" : passwordText);
    const auto connection = "host=" + std::string(host) + " port=" + std::to_string(port) +
                            " dbname=" + database + " user=" + user + " password=" + password;
    const auto db = drogon::orm::DbClient::newMysqlClient(connection, 2);
    REQUIRE(db != nullptr);
    clients().push_back(db);
    db->setTimeout(5.0);
    db->execSqlSync("CREATE TABLE IF NOT EXISTS messenger_friendships ("
                    "id INT NOT NULL AUTO_INCREMENT, user_one_id INT NOT NULL, "
                    "user_two_id INT NOT NULL, PRIMARY KEY(id), "
                    "INDEX pair_idx(user_one_id,user_two_id)) ENGINE=InnoDB");
    const auto existing = db->execSqlSync(
        "SELECT COUNT(*) AS total FROM messenger_friendships WHERE user_one_id IN (?,?) OR user_two_id IN (?,?)",
        kOwner, kFriend, kOwner, kFriend);
    REQUIRE(existing[0]["total"].as<uint64_t>() == 0);
    db->execSqlSync("INSERT INTO messenger_friendships (user_one_id,user_two_id) VALUES (?,?)",
                    kOwner, kFriend);

    const auto publicResult = check(db, kStranger, false);
    CHECK(publicResult.code == FriendshipPrivacyCode::Allowed);
    CHECK_FALSE(publicResult.friends);
    const auto friendResult = check(db, kFriend, true);
    CHECK(friendResult.code == FriendshipPrivacyCode::Allowed);
    CHECK(friendResult.friends);
    const auto strangerResult = check(db, kStranger, true);
    CHECK(strangerResult.code == FriendshipPrivacyCode::Forbidden);
    CHECK_FALSE(strangerResult.friends);
    const auto selfResult = check(db, kOwner, true);
    CHECK(selfResult.code == FriendshipPrivacyCode::Allowed);
    CHECK(selfResult.friends);

    db->execSqlSync("DELETE FROM messenger_friendships WHERE user_one_id = ? AND user_two_id = ?",
                    kOwner, kFriend);
    const auto remaining = db->execSqlSync(
        "SELECT COUNT(*) AS total FROM messenger_friendships WHERE user_one_id IN (?,?) OR user_two_id IN (?,?)",
        kOwner, kFriend, kOwner, kFriend);
    CHECK(remaining[0]["total"].as<uint64_t>() == 0);
}
