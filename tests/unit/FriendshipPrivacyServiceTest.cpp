#include <catch2/catch_test_macros.hpp>

#include "services/FriendshipPrivacyService.h"

using hotel::services::FriendshipPrivacyService;

TEST_CASE("personal guestbook privacy allows public and self, but requires friendship otherwise",
          "[homes-guestbook-privacy]") {
    REQUIRE(FriendshipPrivacyService::privatePostAllowed(2, 3, false, false));
    REQUIRE(FriendshipPrivacyService::privatePostAllowed(2, 2, true, false));
    REQUIRE(FriendshipPrivacyService::privatePostAllowed(2, 3, true, true));
    REQUIRE_FALSE(FriendshipPrivacyService::privatePostAllowed(2, 3, true, false));
    REQUIRE_FALSE(FriendshipPrivacyService::privatePostAllowed(0, 3, false, true));
    REQUIRE_FALSE(FriendshipPrivacyService::privatePostAllowed(2, 0, false, true));
}
