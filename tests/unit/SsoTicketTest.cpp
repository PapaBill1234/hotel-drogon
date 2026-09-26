#include <catch2/catch_test_macros.hpp>

#include <set>
#include <string>

#include "utils/Crypto.h"

using namespace hotel::utils;

/**
 * The SSO ticket format the legacy website produced.
 *
 * `includes/functions.php`'s `GenerateTicket("sso")` built
 * `random(8)-random(4)-random(4)-random(4)-random(12)` where each segment is
 * lowercase hex. That shape is what `users.auth_ticket` holds and what the client
 * was handed, so it is the one part of the client handoff this repository can
 * verify on its own — the rest is emulator behaviour and is recorded as a gap.
 */
TEST_CASE("SSO tickets match the legacy GenerateTicket format", "[crypto][sso]") {
    SECTION("shape is 8-4-4-4-12 lowercase hex") {
        const std::string ticket = Crypto::generateSsoTicket();
        REQUIRE(ticket.size() == 36);

        const std::size_t dashes[] = {8, 13, 18, 23};
        for (std::size_t position : dashes) {
            REQUIRE(ticket[position] == '-');
        }
        for (std::size_t i = 0; i < ticket.size(); ++i) {
            const char c = ticket[i];
            const bool isDash = (i == 8 || i == 13 || i == 18 || i == 23);
            if (isDash) continue;
            const bool isLowerHex = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
            REQUIRE(isLowerHex);
        }
    }

    SECTION("fits the PolarIS column, which is varchar(256)") {
        // Not a tight bound on purpose: the point is that the generated value
        // cannot be truncated by the column the legacy site wrote it to.
        REQUIRE(Crypto::generateSsoTicket().size() <= 256);
    }

    SECTION("successive tickets differ") {
        // A ticket that repeated would be a session-fixation hazard, so this
        // asserts the randomness actually reaches the output rather than only
        // checking the formatting.
        std::set<std::string> seen;
        for (int i = 0; i < 32; ++i) {
            seen.insert(Crypto::generateSsoTicket());
        }
        REQUIRE(seen.size() == 32);
    }
}
