#include <catch2/catch_test_macros.hpp>

#include "services/HomeStoreService.h"

#include <chrono>
#include <cstdlib>
#include <future>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

using hotel::services::HomeStoreCode;
using hotel::services::HomeStoreResult;
using hotel::services::HomeStoreService;

constexpr auto kCallbackTimeout = std::chrono::seconds(15);
constexpr uint32_t kLowRankUser = 910101;
constexpr uint32_t kHighRankUser = 910102;
constexpr uint32_t kFirstCatalogueId = 910201;
constexpr uint32_t kLastCatalogueId = 910209;

std::vector<drogon::orm::DbClientPtr>& retainedTestDbClients() {
    static std::vector<drogon::orm::DbClientPtr> clients;
    return clients;
}

HomeStoreResult waitForResult(std::future<HomeStoreResult>& future) {
    if (future.wait_for(kCallbackTimeout) != std::future_status::ready)
        throw std::runtime_error("home store callback timed out");
    return future.get();
}

std::future<HomeStoreResult> categories(const drogon::orm::DbClientPtr& db,
                                        uint32_t userId,
                                        std::string type) {
    auto promise = std::make_shared<std::promise<HomeStoreResult>>();
    auto future = promise->get_future();
    HomeStoreService::getCategories(
        db, userId, type, [promise](HomeStoreResult result) {
            promise->set_value(std::move(result));
        });
    return future;
}

std::future<HomeStoreResult> items(const drogon::orm::DbClientPtr& db,
                                   uint32_t userId,
                                   std::string type,
                                   uint32_t categoryId = 0) {
    auto promise = std::make_shared<std::promise<HomeStoreResult>>();
    auto future = promise->get_future();
    HomeStoreService::getItems(
        db, userId, type, categoryId, [promise](HomeStoreResult result) {
            promise->set_value(std::move(result));
        });
    return future;
}

struct FixtureCleanup {
    drogon::orm::DbClientPtr db;

    explicit FixtureCleanup(drogon::orm::DbClientPtr client) : db(std::move(client)) {}

    ~FixtureCleanup() { (void)cleanupRows(); }

    bool cleanupRows() noexcept {
        try {
            db->execSqlSync("DELETE FROM phpretro_homes_catalogue WHERE id BETWEEN ? AND ?",
                            kFirstCatalogueId, kLastCatalogueId);
            db->execSqlSync("DELETE FROM users WHERE id IN (?, ?)",
                            kLowRankUser, kHighRankUser);
            const auto catalogue = db->execSqlSync(
                "SELECT COUNT(*) AS total FROM phpretro_homes_catalogue "
                "WHERE id BETWEEN ? AND ?",
                kFirstCatalogueId, kLastCatalogueId);
            const auto users = db->execSqlSync(
                "SELECT COUNT(*) AS total FROM users WHERE id IN (?, ?)",
                kLowRankUser, kHighRankUser);
            return catalogue[0]["total"].as<uint64_t>() == 0 &&
                   users[0]["total"].as<uint64_t>() == 0;
        } catch (...) {
            return false;
        }
    }
};

}  // namespace

TEST_CASE("Homes Store reads filter rank, placement, type and category",
          "[homes-store-db]") {
    const char* host = std::getenv("HOMES_STORE_TEST_DB_HOST");
    const char* database = std::getenv("HOMES_STORE_TEST_DB_DATABASE");
    if (host == nullptr || *host == '\0' || database == nullptr || *database == '\0') {
        SKIP("Set HOMES_STORE_TEST_DB_HOST and HOMES_STORE_TEST_DB_DATABASE to run disposable MariaDB integration checks");
    }
    REQUIRE(std::string(database) == "homes_store_test");

    const char* portText = std::getenv("HOMES_STORE_TEST_DB_PORT");
    const int port = portText == nullptr ? 3306 : std::stoi(portText);
    const char* username = std::getenv("HOMES_STORE_TEST_DB_USERNAME");
    const char* password = std::getenv("HOMES_STORE_TEST_DB_PASSWORD");
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
        "id INT NOT NULL, rank INT NOT NULL DEFAULT 1, PRIMARY KEY (id)"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    db->execSqlSync(
        "CREATE TABLE IF NOT EXISTS phpretro_homes_catalogue ("
        "id INT NOT NULL, name VARCHAR(255) NOT NULL, "
        "description VARCHAR(255) NOT NULL DEFAULT '', "
        "type ENUM('sticker','widget','note','background') NOT NULL, "
        "data VARCHAR(255) NOT NULL, price INT NOT NULL DEFAULT 0, "
        "amount INT NOT NULL DEFAULT 1, category VARCHAR(255) NOT NULL DEFAULT 'Default', "
        "category_id INT NOT NULL DEFAULT 0, min_rank INT NOT NULL DEFAULT 1, "
        "placement ENUM('homes','groups','anywhere') NOT NULL DEFAULT 'anywhere', "
        "PRIMARY KEY (id), INDEX idx_type_category (type, category_id)"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    FixtureCleanup cleanup(db);
    REQUIRE(cleanup.cleanupRows());
    db->execSqlSync("INSERT INTO users (id, rank) VALUES (?, 1), (?, 7)",
                    kLowRankUser, kHighRankUser);
    db->execSqlSync(
        "INSERT INTO phpretro_homes_catalogue "
        "(id, name, description, type, data, price, amount, category, category_id, min_rank, placement) "
        "VALUES "
        "(910201, 'Low Zeta', 'plain text', 'sticker', 'safe_zeta', 1, 1, 'Zeta', 30, 1, 'homes'),"
        "(910202, 'Low Alpha Anywhere', '', 'sticker', 'alpha_low', 2, 2, 'Alpha', 20, 1, 'anywhere'),"
        "(910203, 'High Alpha', '', 'sticker', 'alpha_high', 3, 1, 'Alpha', 10, 7, 'homes'),"
        "(910204, 'Group Alpha', '', 'sticker', 'alpha_group', 4, 1, 'Alpha', 15, 1, 'groups'),"
        "(910205, 'Low Alpha Home', '', 'sticker', 'alpha_home', 5, 1, 'Alpha', 5, 1, 'homes'),"
        "(910206, 'Background', '', 'background', 'bg_wood', 3, 1, 'Wood', 40, 1, 'anywhere'),"
        "(910207, 'Note', '', 'note', 'stickienote', 2, 5, 'Notes', 50, 1, 'anywhere'),"
        "(910208, 'Widget', '', 'widget', 'profilewidget', 0, 1, 'Widgets', 60, 1, 'homes'),"
        "(910209, 'Unsafe key', '', 'sticker', '../unsafe', 1, 1, 'Zeta', 30, 1, 'homes')");

    auto lowCategoriesFuture = categories(db, kLowRankUser, "sticker");
    auto lowCategories = waitForResult(lowCategoriesFuture);
    REQUIRE(lowCategories.code == HomeStoreCode::None);
    REQUIRE(lowCategories.categories.size() == 3);
    CHECK(lowCategories.categories[0].category == "Alpha");
    CHECK(lowCategories.categories[0].category_id == 5);
    CHECK(lowCategories.categories[1].category == "Alpha");
    CHECK(lowCategories.categories[1].category_id == 20);
    CHECK(lowCategories.categories[2].category == "Zeta");

    auto lowItemsFuture = items(db, kLowRankUser, "sticker");
    auto lowItems = waitForResult(lowItemsFuture);
    REQUIRE(lowItems.code == HomeStoreCode::None);
    REQUIRE(lowItems.items.size() == 4);
    CHECK(lowItems.items[0].id == 910209);
    CHECK_FALSE(lowItems.items[0].data_key.has_value());
    CHECK(lowItems.items[1].id == 910205);
    CHECK(lowItems.items[2].id == 910202);
    REQUIRE(lowItems.items[2].data_key.has_value());
    CHECK(*lowItems.items[2].data_key == "alpha_low");
    CHECK(lowItems.items[2].placement == "anywhere");
    CHECK(lowItems.items[2].amount == 2);

    auto filteredFuture = items(db, kLowRankUser, "sticker", 20);
    auto filtered = waitForResult(filteredFuture);
    REQUIRE(filtered.code == HomeStoreCode::None);
    REQUIRE(filtered.items.size() == 1);
    CHECK(filtered.items[0].id == 910202);

    auto backgroundFuture = items(db, kLowRankUser, "background");
    auto backgrounds = waitForResult(backgroundFuture);
    REQUIRE(backgrounds.code == HomeStoreCode::None);
    REQUIRE(backgrounds.items.size() == 1);
    CHECK(backgrounds.items[0].id == 910206);

    auto noteFuture = items(db, kLowRankUser, "note");
    auto notes = waitForResult(noteFuture);
    REQUIRE(notes.code == HomeStoreCode::None);
    REQUIRE(notes.items.size() == 1);
    CHECK(notes.items[0].id == 910207);

    auto highCategoriesFuture = categories(db, kHighRankUser, "sticker");
    auto highCategories = waitForResult(highCategoriesFuture);
    REQUIRE(highCategories.code == HomeStoreCode::None);
    REQUIRE(highCategories.categories.size() == 4);
    CHECK(highCategories.categories[0].category_id == 5);
    CHECK(highCategories.categories[1].category_id == 10);
    CHECK(highCategories.categories[2].category_id == 20);
    CHECK(highCategories.categories[3].category_id == 30);

    auto highItemsFuture = items(db, kHighRankUser, "sticker");
    auto highItems = waitForResult(highItemsFuture);
    REQUIRE(highItems.code == HomeStoreCode::None);
    REQUIRE(highItems.items.size() == 5);
    CHECK(highItems.items[0].id == 910209);
    CHECK_FALSE(highItems.items[0].data_key.has_value());
    CHECK(highItems.items[1].id == 910205);
    CHECK(highItems.items[2].id == 910203);

    auto badTypeFuture = categories(db, kLowRankUser, "widget");
    auto badType = waitForResult(badTypeFuture);
    CHECK(badType.code == HomeStoreCode::InvalidInput);

    auto missingUserFuture = categories(db, 919999, "sticker");
    auto missingUser = waitForResult(missingUserFuture);
    CHECK(missingUser.code == HomeStoreCode::NotFound);

    const auto catalogueCount = db->execSqlSync(
        "SELECT COUNT(*) AS total FROM phpretro_homes_catalogue "
        "WHERE id BETWEEN ? AND ?",
        kFirstCatalogueId, kLastCatalogueId);
    const auto lowRank = db->execSqlSync("SELECT rank FROM users WHERE id = ?", kLowRankUser);
    CHECK(catalogueCount[0]["total"].as<uint64_t>() == 9);
    CHECK(lowRank[0]["rank"].as<uint32_t>() == 1);

    REQUIRE(cleanup.cleanupRows());
}
