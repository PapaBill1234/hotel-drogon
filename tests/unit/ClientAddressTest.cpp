#include <catch2/catch_test_macros.hpp>

#include <string>

#include "utils/ClientAddress.h"

using namespace hotel::utils;

/**
 * The address a request is attributed to.
 *
 * Why this is not `peerAddr()`: the backend has no published port, every
 * request arrives from the nginx container, and `proxy/nginx.conf` overwrites
 * `X-Real-IP` with `$remote_addr`. The peer address is therefore one address for
 * every visitor, which is fine for a log line and wrong for anything that counts
 * per visitor -- the login throttle's address budget would become a site-wide
 * one. `scripts/check_login_throttle.sh` prints the counter key it seeds, and
 * read `login_fail:a:172.27.0.5` before this.
 */
TEST_CASE("A forwarded client address is preferred to the proxy's", "[client-address]") {
    REQUIRE(ClientAddress::choose("203.0.113.7", "172.27.0.5") == "203.0.113.7");
    REQUIRE(ClientAddress::choose("2001:db8::1", "172.27.0.5") == "2001:db8::1");
}

TEST_CASE("A header that is not an address falls back to the peer", "[client-address]") {
    // The header is trusted because the topology guarantees nginx wrote it, but
    // a deployment that puts this app behind something else -- or an empty
    // header on a direct request -- must not end up with a key per junk value.
    REQUIRE(ClientAddress::choose("", "172.27.0.5") == "172.27.0.5");
    REQUIRE(ClientAddress::choose("not an address", "172.27.0.5") == "172.27.0.5");
    REQUIRE(ClientAddress::choose("203.0.113.7, 172.27.0.5", "172.27.0.5") == "172.27.0.5");
    REQUIRE(ClientAddress::choose("bob%201", "172.27.0.5") == "172.27.0.5");
    REQUIRE(ClientAddress::choose(std::string(64, 'a'), "172.27.0.5") == "172.27.0.5");
}

TEST_CASE("An address literal is recognised, and a hexadecimal word is not", "[client-address]") {
    REQUIRE(ClientAddress::isIpLiteral("127.0.0.1"));
    REQUIRE(ClientAddress::isIpLiteral("::1"));
    REQUIRE(ClientAddress::isIpLiteral("2001:db8:85a3::8a2e:370:7334"));
    REQUIRE(ClientAddress::isIpLiteral("0.0.0.0"));
    // 45 characters is the longest textual IPv6 address; one more is not.
    REQUIRE(ClientAddress::isIpLiteral(std::string(43, 'a') + ":1"));
    REQUIRE_FALSE(ClientAddress::isIpLiteral(std::string(44, 'a') + ":1"));

    REQUIRE_FALSE(ClientAddress::isIpLiteral(""));
    REQUIRE_FALSE(ClientAddress::isIpLiteral("deadbeef"));
    REQUIRE_FALSE(ClientAddress::isIpLiteral("::"));
    REQUIRE_FALSE(ClientAddress::isIpLiteral("127.0.0.1 203.0.113.7"));
    REQUIRE_FALSE(ClientAddress::isIpLiteral("127.0.0.1\r\nDEL login_fail:a:1"));
}
