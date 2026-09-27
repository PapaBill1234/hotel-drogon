#include <catch2/catch_test_macros.hpp>

#include "services/RecoveryThrottle.h"

using hotel::services::RecoveryThrottle;

TEST_CASE("Recovery budgets use fixed-length keys without submitted addresses", "[recovery]") {
    const auto target = RecoveryThrottle::targetKey("Alice@Example.TEST");
    REQUIRE(target == RecoveryThrottle::targetKey("alice@example.test"));
    REQUIRE(target.starts_with("recovery:t:"));
    REQUIRE(target.size() == std::string("recovery:t:").size() + 64);
    REQUIRE(target.find("Alice") == std::string::npos);
    REQUIRE(target.find('@') == std::string::npos);
    REQUIRE(target.find('\n') == std::string::npos);

    const auto hostile = RecoveryThrottle::targetKey("a@b.test\r\nDEL recovery:a:other");
    REQUIRE(hostile.size() == target.size());
    REQUIRE(hostile != target);
    REQUIRE(hostile.find(' ') == std::string::npos);
    REQUIRE(hostile.find('\r') == std::string::npos);

    REQUIRE(RecoveryThrottle::addressKey("127.0.0.1") != target);
    REQUIRE(RecoveryThrottle::addressKey("127.0.0.1") !=
            RecoveryThrottle::addressKey("127.0.0.2"));
    REQUIRE(RecoveryThrottle::kAddressLimit > RecoveryThrottle::kTargetLimit);
    REQUIRE(RecoveryThrottle::kWindowSeconds > 0);
}
