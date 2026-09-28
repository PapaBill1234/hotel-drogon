#include <catch2/catch_test_macros.hpp>
#include "services/HomeInventoryService.h"
#include <future>
#include <cstdlib>
#include <stdexcept>

TEST_CASE("Homes inventory excludes group rows and groups personal quantities", "[homes-inventory-db]") {
    const char* host = std::getenv("HOMES_INVENTORY_TEST_DB_HOST");
    const char* database = std::getenv("HOMES_INVENTORY_TEST_DB_DATABASE");
    if (!host || !*host || !database || !*database) SKIP("Set HOMES_INVENTORY_TEST_DB_HOST and HOMES_INVENTORY_TEST_DB_DATABASE");
    REQUIRE(std::string(database) == "homes_inventory_test");
    const auto db = drogon::orm::DbClient::newMysqlClient(
        "host=" + std::string(host) + " dbname=" + database + " user=hotel password=hotel_secret", 2);
    REQUIRE(db != nullptr);
    db->execSqlSync("CREATE TABLE IF NOT EXISTS users (id INT PRIMARY KEY)");
    db->execSqlSync("CREATE TABLE IF NOT EXISTS phpretro_homes_catalogue (id INT PRIMARY KEY, name VARCHAR(255), description VARCHAR(255), category VARCHAR(255), category_id INT, amount INT)");
    db->execSqlSync("CREATE TABLE IF NOT EXISTS phpretro_homes_items (id INT PRIMARY KEY, user_id INT, guild_id INT NOT NULL DEFAULT 0, catalogue_id INT, item_type VARCHAR(32), skin VARCHAR(64), data TEXT, placed TINYINT DEFAULT 0)");
    db->execSqlSync("DELETE FROM phpretro_homes_items WHERE user_id=990901");
    db->execSqlSync("DELETE FROM phpretro_homes_catalogue WHERE id=990902");
    db->execSqlSync("INSERT INTO users VALUES (990901)");
    db->execSqlSync("INSERT INTO phpretro_homes_catalogue VALUES (990902,'Sticker','','Default',1,1)");
    db->execSqlSync("INSERT INTO phpretro_homes_items VALUES (990903,990901,0,990902,'sticker','skin','data',0),(990904,990901,0,990902,'sticker','skin','data',0),(990905,990901,7,990902,'sticker','skin','data',0)");
    std::promise<hotel::services::HomeInventoryResult> promise;
    auto future = promise.get_future();
    hotel::services::HomeInventoryService::getPersonalItems(db, 990901, [&promise](auto result) { promise.set_value(std::move(result)); });
    auto result = future.get();
    REQUIRE(result.ok());
    REQUIRE(result.items.size() == 1);
    CHECK(result.items[0].quantity == 2);
    db->execSqlSync("DELETE FROM phpretro_homes_items WHERE user_id=990901");
    db->execSqlSync("DELETE FROM phpretro_homes_catalogue WHERE id=990902");
    db->execSqlSync("DELETE FROM users WHERE id=990901");
}
