#include <catch2/catch_test_macros.hpp>

#include "services/HomeStoreService.h"

#include <limits>
#include <string>

using hotel::services::HomeStoreService;

TEST_CASE("Homes Store accepts only the three user-store types", "[homes-store]") {
    REQUIRE(HomeStoreService::supportsType("sticker"));
    REQUIRE(HomeStoreService::supportsType("background"));
    REQUIRE(HomeStoreService::supportsType("note"));
    REQUIRE_FALSE(HomeStoreService::supportsType("widget"));
    REQUIRE_FALSE(HomeStoreService::supportsType("1"));
    REQUIRE_FALSE(HomeStoreService::supportsType("Sticker"));
    REQUIRE_FALSE(HomeStoreService::supportsType("https://example.test"));
}

TEST_CASE("Homes Store data keys are opaque safe identifiers", "[homes-store]") {
    REQUIRE(HomeStoreService::safeDataKey("trax_sfx"));
    REQUIRE(HomeStoreService::safeDataKey("background-1"));
    REQUIRE_FALSE(HomeStoreService::safeDataKey(""));
    REQUIRE_FALSE(HomeStoreService::safeDataKey("s sticker"));
    REQUIRE_FALSE(HomeStoreService::safeDataKey("../image"));
    REQUIRE_FALSE(HomeStoreService::safeDataKey("https://example.test/a.png"));
    REQUIRE_FALSE(HomeStoreService::safeDataKey("<script>alert(1)</script>"));
    REQUIRE_FALSE(HomeStoreService::safeDataKey(std::string(129, 'a')));
}

TEST_CASE("Homes Store category ids parse as strict unsigned decimals", "[homes-store]") {
    uint32_t categoryId = 999;
    REQUIRE(HomeStoreService::parseCategoryId("", categoryId));
    REQUIRE(categoryId == 0);
    REQUIRE(HomeStoreService::parseCategoryId("0", categoryId));
    REQUIRE(categoryId == 0);
    REQUIRE(HomeStoreService::parseCategoryId("214", categoryId));
    REQUIRE(categoryId == 214);
    REQUIRE_FALSE(HomeStoreService::parseCategoryId("-1", categoryId));
    REQUIRE_FALSE(HomeStoreService::parseCategoryId("+1", categoryId));
    REQUIRE_FALSE(HomeStoreService::parseCategoryId("2x", categoryId));
    REQUIRE_FALSE(HomeStoreService::parseCategoryId(" 2", categoryId));
    REQUIRE_FALSE(HomeStoreService::parseCategoryId("4294967296", categoryId));
    static_assert(std::numeric_limits<uint32_t>::max() == 4294967295U);
}
