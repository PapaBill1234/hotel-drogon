#include <catch2/catch_test_macros.hpp>

#include "services/PersonalGuestbookWidgetService.h"

#include <chrono>
#include <cstdlib>
#include <future>
#include <memory>
#include <string>
#include <vector>

namespace {
using hotel::services::PersonalGuestbookWidgetCode;
using hotel::services::PersonalGuestbookWidgetResult;
using hotel::services::PersonalGuestbookWidgetService;
constexpr uint32_t kOwner = 931101;
constexpr uint32_t kOther = 931102;
constexpr uint32_t kPersonalWidget = 931201;
constexpr uint32_t kGroupWidget = 931202;
constexpr uint32_t kForeignWidget = 931203;
std::vector<drogon::orm::DbClientPtr>& clients() { static std::vector<drogon::orm::DbClientPtr> value; return value; }
PersonalGuestbookWidgetResult wait(std::future<PersonalGuestbookWidgetResult>& future) {
    REQUIRE(future.wait_for(std::chrono::seconds(15)) == std::future_status::ready);
    return future.get();
}
PersonalGuestbookWidgetResult find(const drogon::orm::DbClientPtr& db, uint32_t actor, uint32_t widget) {
    auto promise = std::make_shared<std::promise<PersonalGuestbookWidgetResult>>();
    auto future = promise->get_future();
    PersonalGuestbookWidgetService::findOwnedWidget(db, actor, widget, [promise](auto result) { promise->set_value(std::move(result)); });
    return wait(future);
}
}

TEST_CASE("personal guestbook widget read boundary excludes groups and foreign owners", "[homes-guestbook-widget-db]") {
    const char* host = std::getenv("HOMES_GUESTBOOK_TEST_DB_HOST");
    const char* database = std::getenv("HOMES_GUESTBOOK_TEST_DB_DATABASE");
    if (host == nullptr || *host == '\0' || database == nullptr || *database == '\0')
        SKIP("Set HOMES_GUESTBOOK_TEST_DB_HOST and HOMES_GUESTBOOK_TEST_DB_DATABASE for disposable DB checks");
    REQUIRE(std::string(database) == "homes_guestbook_test");
    const char* portText = std::getenv("HOMES_GUESTBOOK_TEST_DB_PORT");
    const int port = portText == nullptr ? 3306 : std::stoi(portText);
    const char* userText = std::getenv("HOMES_GUESTBOOK_TEST_DB_USERNAME");
    const char* passwordText = std::getenv("HOMES_GUESTBOOK_TEST_DB_PASSWORD");
    const auto user = std::string(userText == nullptr ? "hotel" : userText);
    const auto password = std::string(passwordText == nullptr ? "hotel_secret" : passwordText);
    const auto connection = "host=" + std::string(host) + " port=" + std::to_string(port) + " dbname=" + database + " user=" + user + " password=" + password;
    const auto db = drogon::orm::DbClient::newMysqlClient(connection, 2);
    REQUIRE(db != nullptr);
    clients().push_back(db);
    db->setTimeout(5.0);
    db->execSqlSync("CREATE TABLE IF NOT EXISTS phpretro_myhabbo_layouts (id INT NOT NULL, user_id INT NOT NULL, guild_id INT NOT NULL, widget_key VARCHAR(50) NOT NULL, visible TINYINT NOT NULL, privacy VARCHAR(16) NOT NULL, PRIMARY KEY(id)) ENGINE=InnoDB");
    const auto existing = db->execSqlSync("SELECT COUNT(*) AS total FROM phpretro_myhabbo_layouts WHERE id IN (?,?,?)", kPersonalWidget, kGroupWidget, kForeignWidget);
    REQUIRE(existing[0]["total"].as<uint64_t>() == 0);
    db->execSqlSync("INSERT INTO phpretro_myhabbo_layouts VALUES (?,?,?,?,?,?), (?,?,?,?,?,?), (?,?,?,?,?,?)",
                    kPersonalWidget, kOwner, 0, "guestbookwidget", 1, "private",
                    kGroupWidget, kOwner, 44, "guestbookwidget", 1, "private",
                    kForeignWidget, kOther, 0, "guestbookwidget", 1, "public");
    const auto found = find(db, kOwner, kPersonalWidget);
    REQUIRE(found.code == PersonalGuestbookWidgetCode::Found);
    CHECK(found.widget.user_id == kOwner);
    CHECK(found.widget.guild_id == 0);
    CHECK(found.widget.privacy == "private");
    CHECK(find(db, kOwner, kGroupWidget).code == PersonalGuestbookWidgetCode::NotFound);
    CHECK(find(db, kOwner, kForeignWidget).code == PersonalGuestbookWidgetCode::NotFound);
    CHECK(find(db, 0, kPersonalWidget).code == PersonalGuestbookWidgetCode::InvalidInput);
    db->execSqlSync("DELETE FROM phpretro_myhabbo_layouts WHERE id IN (?,?,?)", kPersonalWidget, kGroupWidget, kForeignWidget);
    const auto remaining = db->execSqlSync("SELECT COUNT(*) AS total FROM phpretro_myhabbo_layouts WHERE id IN (?,?,?)", kPersonalWidget, kGroupWidget, kForeignWidget);
    CHECK(remaining[0]["total"].as<uint64_t>() == 0);
}
