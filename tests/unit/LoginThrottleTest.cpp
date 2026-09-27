#include <catch2/catch_test_macros.hpp>

#include <string>

#include "services/LoginThrottle.h"

using namespace hotel::services;

/**
 * The login throttle's decisions and its key encoding, checked without Redis.
 *
 * The counters themselves are read and written through Drogon's Redis client
 * and are exercised against a live stack by `scripts/check_login_throttle.sh`.
 * These cases are the ones that need no server, so they run in the CI
 * sanitizer job: the limit boundary, the property that makes a user-supplied
 * username safe to interpolate into a Redis command, and the refusal message's
 * deliberate silence about which limit was hit.
 */
TEST_CASE("A counter allows below its limit and refuses at it", "[throttle]") {
    REQUIRE(LoginThrottle::allowed(0, LoginThrottle::kAccountLimit));
    REQUIRE(LoginThrottle::allowed(LoginThrottle::kAccountLimit - 1, LoginThrottle::kAccountLimit));
    REQUIRE_FALSE(LoginThrottle::allowed(LoginThrottle::kAccountLimit, LoginThrottle::kAccountLimit));
    REQUIRE_FALSE(LoginThrottle::allowed(LoginThrottle::kAccountLimit + 1, LoginThrottle::kAccountLimit));

    // The address budget is deliberately the larger of the two: every attempt
    // against one account name also spends it, so a shared address must be able
    // to survive more typos than a single account's own five.
    REQUIRE(LoginThrottle::kAddressLimit > LoginThrottle::kAccountLimit);
    REQUIRE(LoginThrottle::kWindowSeconds > 0);
}

TEST_CASE("An account name maps to one key, whatever its case", "[throttle]") {
    // The credential query is `WHERE username = ?` under a case-insensitive
    // collation, so Alice and alice are the same account and must share a
    // counter; that is what makes the throttle impossible to side-step by
    // changing the capitalisation on every attempt.
    REQUIRE(LoginThrottle::accountKey("Alice") == LoginThrottle::accountKey("alice"));
    REQUIRE(LoginThrottle::accountKey("alice") == "login_fail:u:alice");
    REQUIRE(LoginThrottle::accountKey("a_b.c-1") == "login_fail:u:a_b.c-1");
}

TEST_CASE("A user-supplied name cannot carry a second Redis command", "[throttle]") {
    // The command is built by interpolating the key into one string, and Redis
    // splits that on spaces: a name with a space would silently become two
    // arguments and one with a newline a second command. Names are user input,
    // so the key is encoded rather than trusted.
    const std::string hostile = LoginThrottle::accountKey("bob 1\r\nDEL login_fail:a:127.0.0.1");
    // Encoded byte for byte: the space, the CR, the LF and every colon become
    // `%XX` (uppercase), the letters are lower-cased, and nothing survives that
    // Redis could read as a separator.
    REQUIRE(hostile == "login_fail:u:bob%201%0D%0Adel%20login_fail%3Aa%3A127.0.0.1");
    REQUIRE(hostile.find(' ') == std::string::npos);
    REQUIRE(hostile.find('\r') == std::string::npos);
    REQUIRE(hostile.find('\n') == std::string::npos);
    REQUIRE(hostile.find("DEL") == std::string::npos);

    // `%` is encoded as well, so the mapping stays injective: a literal "a%b"
    // and a name that happens to percent-encode to the same text would collide
    // otherwise.
    REQUIRE(LoginThrottle::accountKey("a%b") != LoginThrottle::accountKey("a 5b"));

    // A source address is encoded the same way; IPv6 addresses are the reason
    // the colons are not left as-is.
    REQUIRE(LoginThrottle::addressKey("127.0.0.1") == "login_fail:a:127.0.0.1");
    REQUIRE(LoginThrottle::addressKey("::1") == "login_fail:a:%3A%3A1");
    REQUIRE(LoginThrottle::accountKey("alice") != LoginThrottle::addressKey("alice"));
}

TEST_CASE("The refusal message says nothing about the account", "[throttle]") {
    // One message for both limits and for existing and non-existent accounts:
    // a refusal that varied would answer "does this account exist?", which the
    // generic "Invalid username or password" exists to prevent.
    const std::string fifteen = LoginThrottle::refusalMessage(900);
    REQUIRE(fifteen.find("15 minutes.") != std::string::npos);
    REQUIRE(fifteen.find("exist") == std::string::npos);
    REQUIRE(fifteen.find("account") == std::string::npos);
    REQUIRE(fifteen.find("username") == std::string::npos);

    // Seconds round up, and a wait is never reported as zero minutes.
    REQUIRE(LoginThrottle::refusalMessage(60).find("1 minute.") != std::string::npos);
    REQUIRE(LoginThrottle::refusalMessage(61).find("2 minutes.") != std::string::npos);
    REQUIRE(LoginThrottle::refusalMessage(1).find("1 minute.") != std::string::npos);
    REQUIRE(LoginThrottle::refusalMessage(0).find("0 minute") == std::string::npos);
    REQUIRE(LoginThrottle::refusalMessage(0).find("1 minute.") != std::string::npos);

    // The message is a function of the wait alone: the same value for a wrong
    // password on a real account and on an invented one.
    REQUIRE(LoginThrottle::refusalMessage(900) == LoginThrottle::refusalMessage(900));
}
