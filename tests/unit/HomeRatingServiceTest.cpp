#include <catch2/catch_test_macros.hpp>
#include <catch2/catch_approx.hpp>

#include "services/HomeRatingService.h"

using hotel::services::HomeRatingCode;
using hotel::services::HomeRatingService;

TEST_CASE("Home rating summaries follow the legacy rounding and star width", "[homes-rating]") {
    const auto empty = HomeRatingService::summarize(0, 0, 0, false, false);
    REQUIRE(empty.total == 0);
    REQUIRE(empty.high == 0);
    REQUIRE(empty.average == 0.0);
    REQUIRE(empty.px == 0);
    REQUIRE_FALSE(empty.mine);
    REQUIRE_FALSE(empty.owner);

    const auto half = HomeRatingService::summarize(2, 9, 2, true, false);
    REQUIRE(half.average == Catch::Approx(4.5));
    REQUIRE(half.px == 135);
    REQUIRE(half.high == 2);
    REQUIRE(half.mine);
    REQUIRE_FALSE(half.owner);

    const auto rounded = HomeRatingService::summarize(3, 14, 2, false, true);
    REQUIRE(rounded.average == Catch::Approx(4.7));
    REQUIRE(rounded.px == 141);
    REQUIRE(rounded.owner);
    REQUIRE_FALSE(rounded.mine);
}

TEST_CASE("Home rating votes require a distinct voter, widget, and rating", "[homes-rating]") {
    REQUIRE(HomeRatingService::validateVote(10, 20, 30, 1) == HomeRatingCode::None);
    REQUIRE(HomeRatingService::validateVote(10, 20, 30, 5) == HomeRatingCode::None);
    REQUIRE(HomeRatingService::validateVote(0, 20, 30, 4) == HomeRatingCode::InvalidInput);
    REQUIRE(HomeRatingService::validateVote(10, 0, 30, 4) == HomeRatingCode::InvalidInput);
    REQUIRE(HomeRatingService::validateVote(10, 20, 0, 4) == HomeRatingCode::InvalidInput);
    REQUIRE(HomeRatingService::validateVote(10, 20, 10, 4) == HomeRatingCode::InvalidInput);
    REQUIRE(HomeRatingService::validateVote(10, 20, 30, 0) == HomeRatingCode::InvalidInput);
    REQUIRE(HomeRatingService::validateVote(10, 20, 30, 6) == HomeRatingCode::InvalidInput);
}
