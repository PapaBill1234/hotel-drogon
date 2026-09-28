#include <catch2/catch_test_macros.hpp>

#include "services/HomeGuestbookService.h"

#include <limits>
#include <string>

using hotel::services::HomeGuestbookService;

TEST_CASE("Homes guestbook accepts positive personal profile ids", "[homes-guestbook]") {
    REQUIRE_FALSE(HomeGuestbookService::validProfileId(0));
    REQUIRE(HomeGuestbookService::validProfileId(1));
    REQUIRE(HomeGuestbookService::validProfileId(
        std::numeric_limits<int64_t>::max()));
    int64_t profileId = 0;
    REQUIRE(HomeGuestbookService::parseProfileId("1", profileId));
    REQUIRE(profileId == 1);
    REQUIRE(HomeGuestbookService::parseProfileId("+1", profileId));
    REQUIRE(profileId == 1);
    REQUIRE(HomeGuestbookService::parseProfileId(" \t+1\r\n", profileId));
    REQUIRE(profileId == 1);
    REQUIRE(HomeGuestbookService::parseProfileId("4294967295", profileId));
    REQUIRE(profileId == 4294967295LL);
    REQUIRE(HomeGuestbookService::parseProfileId("4294967296", profileId));
    REQUIRE(profileId == 4294967296LL);
    REQUIRE(HomeGuestbookService::parseProfileId("9223372036854775807", profileId));
    REQUIRE(profileId == std::numeric_limits<int64_t>::max());
    REQUIRE_FALSE(HomeGuestbookService::parseProfileId("", profileId));
    REQUIRE_FALSE(HomeGuestbookService::parseProfileId("0", profileId));
    REQUIRE_FALSE(HomeGuestbookService::parseProfileId("+0", profileId));
    REQUIRE_FALSE(HomeGuestbookService::parseProfileId("00", profileId));
    REQUIRE_FALSE(HomeGuestbookService::parseProfileId("01", profileId));
    REQUIRE_FALSE(HomeGuestbookService::parseProfileId("-1", profileId));
    REQUIRE_FALSE(HomeGuestbookService::parseProfileId("1x", profileId));
    REQUIRE_FALSE(HomeGuestbookService::parseProfileId("9223372036854775808", profileId));
    REQUIRE(HomeGuestbookService::kMaxEntries == 50);
}
