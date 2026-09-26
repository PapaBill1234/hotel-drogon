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

/**
 * The tombstone that replaces a ticket when the website voids it.
 *
 * This is the value that makes the replay bound hold, so its two required
 * properties are asserted here rather than only described in a comment:
 *
 *  - it cannot be presented, because both PolarIS doors cap a presented ticket at
 *    128 characters (`SecureLoginEvent` disposes the connection for a longer
 *    value; `SessionEndpoints.handleSsoToken` answers 400), while the column is
 *    `varchar(256)`;
 *  - it is never empty, because the emulator's reconnect grace restores a
 *    consumed ticket *only* into an empty column. An empty column would let the
 *    dead ticket come back.
 */
TEST_CASE("Voided SSO tickets leave a value the client cannot present", "[crypto][sso]") {
    /// The cap both PolarIS doors apply to a presented ticket.
    constexpr std::size_t kPresentableTicketMax = 128;

    SECTION("longer than any presentable ticket, still inside the column") {
        for (int i = 0; i < 16; ++i) {
            const std::string tombstone = Crypto::generateVoidSsoTicket();
            REQUIRE(tombstone.size() > kPresentableTicketMax);
            REQUIRE(tombstone.size() <= 256);
        }
    }

    SECTION("non-empty, and never equal to a real ticket") {
        const std::string tombstone = Crypto::generateVoidSsoTicket();
        REQUIRE_FALSE(tombstone.empty());
        REQUIRE(tombstone != Crypto::generateSsoTicket());
    }

    SECTION("recognisable, and distinct between voids") {
        // Two voids must not look like the same value in a row: an operator
        // reading `auth_ticket` should be able to tell a tombstone from a ticket,
        // and tell one void from another.
        std::set<std::string> seen;
        for (int i = 0; i < 32; ++i) {
            const std::string tombstone = Crypto::generateVoidSsoTicket();
            REQUIRE(tombstone.rfind("void-", 0) == 0);
            seen.insert(tombstone);
        }
        REQUIRE(seen.size() == 32);
    }
}
