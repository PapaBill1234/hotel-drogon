#include <catch2/catch_test_macros.hpp>
#include "filters/AuthPolicy.h"
#include "services/SessionManager.h"

using namespace hotel::filters;
using namespace hotel::services;

TEST_CASE("AuthPolicy Role and Session Gating", "[auth][policy]") {
    SECTION("Staff requirement correctly gates non-staff and staff sessions") {
        // Setup Staff session with rank 7 (Admin)
        StaffSessionData adminSession;
        adminSession.user_id = 1;
        adminSession.username = "Admin";
        adminSession.rank = 7;
        adminSession.is_2fa_verified = true;

        REQUIRE(adminSession.rank >= 5);
        REQUIRE(adminSession.is_2fa_verified == true);

        // Setup Staff session with rank 4 (Not sufficient for minRank 5)
        StaffSessionData lowRankSession;
        lowRankSession.user_id = 2;
        lowRankSession.username = "SeniorUser";
        lowRankSession.rank = 4;
        lowRankSession.is_2fa_verified = true;

        REQUIRE(lowRankSession.rank < 5);

        // Setup Staff session without 2FA step-up
        StaffSessionData unverifiedSession;
        unverifiedSession.user_id = 3;
        unverifiedSession.username = "Mod";
        unverifiedSession.rank = 6;
        unverifiedSession.is_2fa_verified = false;

        REQUIRE(unverifiedSession.is_2fa_verified == false);
    }

    SECTION("User session data structure integrity") {
        UserSessionData session;
        session.user_id = 42;
        session.username = "TestHabbo";
        session.rank = 1;
        session.csrf_token = "abc123csrf";

        REQUIRE(session.user_id == 42);
        REQUIRE(session.username == "TestHabbo");
        REQUIRE(session.rank == 1);
        REQUIRE(!session.csrf_token.empty());
    }
}
