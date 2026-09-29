#include "services/RecoveryThrottle.h"

#include "utils/Crypto.h"
#include "utils/Logger.h"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <drogon/drogon.h>
#include <memory>
#include <utility>

namespace hotel::services {
namespace {

std::string normalizedEmail(std::string email) {
    std::transform(email.begin(), email.end(), email.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return email;
}

// INCR is the admission decision: concurrent requests cannot all read an old
// count and each get a token. EXPIRE refreshes the sliding window on every
// request. Refuse if either Redis command fails; do not issue a token on an
// unmetered request.
void reserveKey(
    const std::shared_ptr<drogon::nosql::RedisClient>& redis,
    const std::string& key,
    int limit,
    std::function<void(RecoveryThrottleState)> callback
) {
    redis->execCommandAsync(
        [redis, key, limit, callback](const drogon::nosql::RedisResult& reply) {
            if (reply.type() != drogon::nosql::RedisResultType::kInteger) {
                callback({false, false, 0});
                return;
            }
            const auto count = reply.asInteger();
            redis->execCommandAsync(
                [redis, key, count, limit, callback](const drogon::nosql::RedisResult& expiry) {
                    if (expiry.type() != drogon::nosql::RedisResultType::kInteger ||
                        expiry.asInteger() != 1) {
                        callback({false, false, 0});
                        return;
                    }
                    if (count <= limit) {
                        callback({});
                        return;
                    }
                    redis->execCommandAsync(
                        [callback](const drogon::nosql::RedisResult& ttlReply) {
                            const int ttl = ttlReply.type() == drogon::nosql::RedisResultType::kInteger
                                                ? static_cast<int>(ttlReply.asInteger()) : 0;
                            callback({false, true, ttl > 0 ? ttl : RecoveryThrottle::kWindowSeconds});
                        },
                        [callback](const std::exception&) { callback({false, false, 0}); },
                        "TTL %s", key.c_str()
                    );
                },
                [callback](const std::exception& e) {
                    HOTEL_LOG_WARN("RecoveryThrottle: EXPIRE failed: {}", e.what());
                    callback({false, false, 0});
                },
                "EXPIRE %s %d", key.c_str(), RecoveryThrottle::kWindowSeconds
            );
        },
        [callback](const std::exception& e) {
            HOTEL_LOG_WARN("RecoveryThrottle: INCR failed: {}", e.what());
            callback({false, false, 0});
        },
        "INCR %s", key.c_str()
    );
}

}  // namespace

std::string RecoveryThrottle::targetKey(const std::string& email) {
    return "recovery:t:" + utils::Crypto::sha256(normalizedEmail(email));
}

std::string RecoveryThrottle::addressKey(const std::string& ipAddress) {
    return "recovery:a:" + utils::Crypto::sha256(ipAddress);
}

void RecoveryThrottle::reserve(
    const std::string& email,
    const std::string& ipAddress,
    std::function<void(RecoveryThrottleState)> callback
) {
    // Drogon's Redis client can retain a command without calling either
    // completion callback while its connection is down. Bound the request and
    // make the completion one-shot: a late Redis reply must never resume the
    // account lookup after a 503 has already been sent.
    auto completed = std::make_shared<std::atomic_bool>(false);
    auto finish = [completed, callback = std::move(callback)](RecoveryThrottleState state) {
        bool expected = false;
        if (completed->compare_exchange_strong(expected, true)) {
            callback(state);
        }
    };
    drogon::app().getLoop()->runAfter(2.0, [finish]() {
        finish({false, false, 0});
    });

    auto redis = drogon::app().getRedisClient("default");
    if (!redis) {
        finish({false, false, 0});
        return;
    }
    reserveKey(redis, addressKey(ipAddress), kAddressLimit,
               [redis, email, completed, finish](RecoveryThrottleState address) {
                   if (completed->load()) {
                       return;
                   }
                   if (!address.allowed) {
                       finish(address);
                       return;
                   }
                   reserveKey(redis, targetKey(email), kTargetLimit, finish);
               });
}

}  // namespace hotel::services
