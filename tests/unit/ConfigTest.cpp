#include <catch2/catch_test_macros.hpp>
#include "utils/Config.h"

TEST_CASE("AppConfig loads default values correctly", "[config]") {
    auto cfg = hotel::utils::AppConfig::loadFromEnv();
    
    // Check defaults
    REQUIRE_FALSE(cfg.host.empty());
    REQUIRE(cfg.port > 0);
    REQUIRE_FALSE(cfg.db_host.empty());
    REQUIRE(cfg.db_port == 3306);
    REQUIRE_FALSE(cfg.redis_host.empty());
    REQUIRE(cfg.redis_port == 6379);
}
