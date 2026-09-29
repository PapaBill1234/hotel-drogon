#include <catch2/catch_test_macros.hpp>

#include "services/PersonalGuestbookWidgetService.h"

using hotel::services::PersonalGuestbookWidgetService;

TEST_CASE("personal guestbook widget ownership excludes group and foreign widgets",
          "[homes-guestbook-widget]") {
    REQUIRE(PersonalGuestbookWidgetService::isPersonalOwner(2, 2, 0));
    REQUIRE_FALSE(PersonalGuestbookWidgetService::isPersonalOwner(2, 2, 9));
    REQUIRE_FALSE(PersonalGuestbookWidgetService::isPersonalOwner(2, 3, 0));
    REQUIRE_FALSE(PersonalGuestbookWidgetService::isPersonalOwner(0, 2, 0));
    REQUIRE_FALSE(PersonalGuestbookWidgetService::isPersonalOwner(2, 0, 0));
}
