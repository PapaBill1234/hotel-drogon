#include <catch2/catch_test_macros.hpp>

#include "services/HomeInventoryService.h"

using hotel::services::HomeInventoryCode;
using hotel::services::HomeInventoryService;

TEST_CASE("Homes inventory has a named personal read boundary", "[homes-inventory]") {
    HomeInventoryService::getPersonalItems(nullptr, 0, [](auto result) {
        REQUIRE(result.code == HomeInventoryCode::InvalidInput);
    });
    HomeInventoryService::getPersonalItems(nullptr, 42, [](auto result) {
        REQUIRE(result.code == HomeInventoryCode::Unavailable);
    });
}
