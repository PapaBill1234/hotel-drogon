#pragma once

#include <functional>
#include <string>

namespace hotel::services {

struct RecoveryThrottleState {
    bool allowed = true;
    bool available = true;
    int retryAfterSeconds = 0;
};

/** Counts requests before either public recovery route can look up an account. */
class RecoveryThrottle {
public:
    static constexpr int kTargetLimit = 5;
    static constexpr int kAddressLimit = 20;
    static constexpr int kWindowSeconds = 900;

    /** Every request spends an address and email budget, including unknown emails. */
    static void reserve(
        const std::string& email,
        const std::string& ipAddress,
        std::function<void(RecoveryThrottleState)> callback
    );

    static std::string targetKey(const std::string& email);
    static std::string addressKey(const std::string& ipAddress);
};

}  // namespace hotel::services
