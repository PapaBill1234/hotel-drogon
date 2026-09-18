#include <catch2/catch_test_macros.hpp>
#include "utils/Crypto.h"

using namespace hotel::utils;

TEST_CASE("Crypto utility functions", "[crypto]") {
    SECTION("SHA-1 hashing") {
        std::string hash = Crypto::sha1("password123");
        REQUIRE(hash == "cbfdac6008f9cab4083784cbd1874f76618d2a97");
    }

    SECTION("SHA-256 hashing") {
        std::string hash = Crypto::sha256("test_string");
        REQUIRE(hash == "4b641e9a923d1ea57e18fe41dcb543e2c4005c41ff210864a710b0fbb2654c11");
    }

    SECTION("HMAC SHA-256") {
        std::string hmac = Crypto::hmacSha256("secret_key", "payload_data");
        REQUIRE(!hmac.empty());
        REQUIRE(hmac.length() == 64);
    }

    SECTION("Constant time equality") {
        REQUIRE(Crypto::constantTimeEquals("abc123xyz", "abc123xyz") == true);
        REQUIRE(Crypto::constantTimeEquals("abc123xyz", "abc123xyw") == false);
        REQUIRE(Crypto::constantTimeEquals("short", "longer_string") == false);
    }

    SECTION("TOTP verification") {
        // Standard base32 secret: JBSWY3DPEHPK3PXP (ASCII: "Hello!\xde\xad\xbe\xef")
        std::string secret = "JBSWY3DPEHPK3PXP";
        // Invalid code rejection
        REQUIRE(Crypto::verifyTotp(secret, "000000") == false);
        REQUIRE(Crypto::verifyTotp("", "123456") == false);
        REQUIRE(Crypto::verifyTotp(secret, "12345") == false); // wrong length
    }
}
