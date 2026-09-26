#include <catch2/catch_test_macros.hpp>

#include <set>
#include <string>

#include "services/UserAccountService.h"
#include "utils/Crypto.h"

using namespace hotel::utils;
using namespace hotel::services;

/**
 * The remember-me token format the legacy website produced.
 *
 * `includes/functions.php`'s `GenerateTicket("remember")`:
 *
 *   random(6) . "-" . bin2hex(random_bytes(10)) . "-" . bin2hex(random_bytes(10))
 *
 * 6 + 1 + 20 + 1 + 20 = 48 characters, all lowercase hex around two dashes. It is
 * deliberately a *different* shape from the SSO ticket, which is 8-4-4-4-12, so
 * the two are asserted separately rather than by one format check.
 */
TEST_CASE("Remember-me tokens match the legacy GenerateTicket format", "[crypto][remember]") {
    SECTION("shape is 6-20-20 lowercase hex") {
        const std::string token = Crypto::generateRememberToken();
        REQUIRE(token.size() == 48);

        REQUIRE(token[6] == '-');
        REQUIRE(token[27] == '-');

        for (std::size_t i = 0; i < token.size(); ++i) {
            if (i == 6 || i == 27) continue;
            const char c = token[i];
            const bool isLowerHex = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
            REQUIRE(isLowerHex);
        }
    }

    SECTION("its SHA-256 digest fits users.remember_token_hash, which is varchar(64)") {
        // The column is exactly one SHA-256 digest in hex. A longer digest would
        // be silently truncated by MySQL and the token would never match again,
        // which is why `setRememberToken` refuses anything that is not 64.
        REQUIRE(Crypto::sha256(Crypto::generateRememberToken()).size() == 64);
    }

    SECTION("successive tokens differ") {
        std::set<std::string> seen;
        for (int i = 0; i < 32; ++i) {
            seen.insert(Crypto::generateRememberToken());
        }
        REQUIRE(seen.size() == 32);
    }

    SECTION("it is not the SSO ticket shape") {
        // Guards against a future refactor collapsing the two generators: an SSO
        // ticket is 36 characters with four dashes, a remember-me token is 48 with
        // two, and a client expecting one must not be handed the other.
        const std::string sso = Crypto::generateSsoTicket();
        const std::string remember = Crypto::generateRememberToken();
        REQUIRE(sso.size() == 36);
        REQUIRE(remember.size() == 48);
        REQUIRE(sso != remember);
    }
}

/**
 * `site_cookie_time`, the remember-me lifetime.
 *
 * Legacy: `time() + (60 * 60 * 24 * (int) $settings->find("site_cookie_time"))`,
 * with the installer seeding that setting to 14 and labelling it "Rememberme
 * Expire In / Number of days". These cases pin the defaulting and the parsing,
 * which is the part a database cannot be trusted to supply.
 */
TEST_CASE("Remember-me lifetime follows site_cookie_time with a legacy default",
          "[remember]") {
    SECTION("a numeric setting is used as days") {
        REQUIRE(UserAccountService::rememberMeDays("14") == 14);
        REQUIRE(UserAccountService::rememberMeDays("1") == 1);
        REQUIRE(UserAccountService::rememberMeDays("30") == 30);
    }

    SECTION("a missing setting falls back to the installer's 14") {
        REQUIRE(UserAccountService::rememberMeDays("") == 14);
    }

    SECTION("a non-numeric setting falls back rather than throwing") {
        REQUIRE(UserAccountService::rememberMeDays("forever") == 14);
        REQUIRE(UserAccountService::rememberMeDays("14 days") == 14);
    }

    SECTION("a non-positive setting falls back: a token must expire") {
        // `(int) "0"` in PHP would produce an expiry of `time() + 0`, i.e. an
        // already-dead token. Falling back to 14 is friendlier than honouring a
        // value that means "never usable", and it is what the installer's default
        // is for.
        REQUIRE(UserAccountService::rememberMeDays("0") == 14);
        REQUIRE(UserAccountService::rememberMeDays("-5") == 14);
    }

    SECTION("an absurd setting is capped") {
        // Not a legacy rule — legacy would happily compute a year-100000 expiry —
        // but a stored int and a cookie Max-Age both overflow long before that, so
        // the value is bounded rather than allowed to wrap.
        REQUIRE(UserAccountService::rememberMeDays("999999") == 3650);
    }
}
