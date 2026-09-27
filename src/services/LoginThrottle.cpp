#include "services/LoginThrottle.h"

#include "utils/Logger.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <exception>
#include <memory>
#include <stdexcept>
#include <utility>

// The Redis client and `drogon::app()` live in the umbrella header. The service
// header deliberately pulls in nothing, so a unit test can include it without
// the whole framework and still exercise the pure parts below.
#include <drogon/drogon.h>

namespace hotel::services {

namespace {

/**
 * Lowercase ASCII and percent-encode everything outside `[a-z0-9._-]`.
 *
 * The commands below are built by interpolating the key into one string, which
 * Redis splits on spaces: a username containing a space would silently become
 * two arguments, and one containing a newline or a CRLF would become a
 * second command. Usernames are user-supplied, so the key is encoded rather
 * than trusted. `%` is encoded too, so the mapping stays injective.
 *
 * Lowercasing matches what the credential query already does: the account is
 * looked up with `WHERE username = ?` under a case-insensitive collation, so
 * `Alice` and `alice` are the same account and must share one counter.
 */
std::string encodeKeyPart(const std::string& raw) {
    static const char* kHex = "0123456789ABCDEF";
    std::string out;
    out.reserve(raw.size());
    for (const unsigned char c : raw) {
        const bool safe = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-';
        if (safe) {
            out.push_back(static_cast<char>(c));
            continue;
        }
        if (c >= 'A' && c <= 'Z') {
            out.push_back(static_cast<char>(c - 'A' + 'a'));
            continue;
        }
        out.push_back('%');
        out.push_back(kHex[c >> 4]);
        out.push_back(kHex[c & 0x0F]);
    }
    return out;
}

/** A counter reply: `GET` answers a string, `INCR`/`TTL` answer an integer. */
int parseCount(const drogon::nosql::RedisResult& r) {
    try {
        if (r.type() == drogon::nosql::RedisResultType::kString) {
            return std::stoi(r.asString());
        }
        if (r.type() == drogon::nosql::RedisResultType::kInteger) {
            return static_cast<int>(r.asInteger());
        }
    } catch (const std::exception&) {
        return 0;
    }
    return 0;
}

void readCounter(
    const std::shared_ptr<drogon::nosql::RedisClient>& redis,
    const std::string& key,
    std::function<void(int)> callback
) {
    redis->execCommandAsync(
        [callback](const drogon::nosql::RedisResult& r) {
            callback(parseCount(r));
        },
        [key, callback](const std::exception& e) {
            HOTEL_LOG_WARN("LoginThrottle: reading {} failed: {}", key, e.what());
            callback(0);
        },
        "GET %s",
        key.c_str()
    );
}

void readTtl(
    const std::shared_ptr<drogon::nosql::RedisClient>& redis,
    const std::string& key,
    std::function<void(int)> callback
) {
    redis->execCommandAsync(
        [callback](const drogon::nosql::RedisResult& r) {
            callback(parseCount(r));
        },
        [key, callback](const std::exception& e) {
            HOTEL_LOG_WARN("LoginThrottle: reading the TTL of {} failed: {}", key, e.what());
            callback(0);
        },
        "TTL %s",
        key.c_str()
    );
}

/**
 * `INCR` then `EXPIRE`, in that order and both unconditional.
 *
 * The second command is not conditional on the counter being new, so every
 * failure refreshes the window: a counter that expired while an attack was
 * still running would hand the attacker a fresh budget. `EXPIRE` is also what
 * keeps a counter from outliving its usefulness if the process dies between the
 * two commands -- the worst case is one immortal counter keyed to an account
 * name, which a later successful sign-in clears anyway.
 */
void bumpCounter(
    const std::shared_ptr<drogon::nosql::RedisClient>& redis,
    const std::string& key
) {
    redis->execCommandAsync(
        [redis, key](const drogon::nosql::RedisResult&) {
            redis->execCommandAsync(
                [](const drogon::nosql::RedisResult&) {},
                [key](const std::exception& e) {
                    HOTEL_LOG_WARN("LoginThrottle: expiring {} failed: {}", key, e.what());
                },
                "EXPIRE %s %d",
                key.c_str(),
                LoginThrottle::kWindowSeconds
            );
        },
        [key](const std::exception& e) {
            HOTEL_LOG_WARN("LoginThrottle: counting a failure for {} failed: {}", key, e.what());
        },
        "INCR %s",
        key.c_str()
    );
}

}  // namespace

bool LoginThrottle::allowed(int failures, int limit) {
    return failures < limit;
}

std::string LoginThrottle::accountKey(const std::string& username) {
    return "login_fail:u:" + encodeKeyPart(username);
}

std::string LoginThrottle::addressKey(const std::string& ipAddress) {
    return "login_fail:a:" + encodeKeyPart(ipAddress);
}

std::string LoginThrottle::refusalMessage(int retryAfterSeconds) {
    int minutes = (retryAfterSeconds + 59) / 60;
    if (minutes < 1) {
        minutes = 1;
    }
    return "Too many failed sign-in attempts. Try again in " + std::to_string(minutes) +
           (minutes == 1 ? " minute." : " minutes.");
}

void LoginThrottle::check(
    const std::string& username,
    const std::string& ipAddress,
    std::function<void(LoginThrottleState)> callback
) {
    auto redis = drogon::app().getRedisClient("default");
    if (!redis) {
        LoginThrottleState state;
        state.allowed = false;
        state.available = false;
        HOTEL_LOG_ERROR("LoginThrottle: no Redis client, refusing the credential check");
        callback(state);
        return;
    }

    const std::string userKey = accountKey(username);
    const std::string addressKeyValue = addressKey(ipAddress);

    readCounter(redis, userKey, [redis, userKey, addressKeyValue, callback](int userFailures) {
        readCounter(redis, addressKeyValue, [redis, userKey, addressKeyValue, userFailures, callback](int addressFailures) {
            LoginThrottleState state;
            state.failures = std::max(userFailures, addressFailures);
            if (allowed(userFailures, kAccountLimit) && allowed(addressFailures, kAddressLimit)) {
                callback(state);
                return;
            }

            // Refused: the retry after is however long the slower window has
            // left, and the counter key that hit its limit is the one to read.
            state.allowed = false;
            const bool accountHit = !allowed(userFailures, kAccountLimit);
            const std::string key = accountHit ? userKey : addressKeyValue;
            readTtl(redis, key, [state, callback](int ttl) mutable {
                state.retryAfterSeconds = ttl > 0 ? ttl : kWindowSeconds;
                callback(state);
            });
        });
    });
}

void LoginThrottle::recordFailure(const std::string& username, const std::string& ipAddress) {
    auto redis = drogon::app().getRedisClient("default");
    if (!redis) {
        // Nothing to record against; `check` has already refused the attempt in
        // this state, so this cannot silently unthrottle anything.
        return;
    }
    bumpCounter(redis, accountKey(username));
    bumpCounter(redis, addressKey(ipAddress));
}

void LoginThrottle::clearAccount(const std::string& username) {
    auto redis = drogon::app().getRedisClient("default");
    if (!redis) {
        return;
    }
    redis->execCommandAsync(
        [](const drogon::nosql::RedisResult&) {},
        [](const std::exception& e) {
            HOTEL_LOG_WARN("LoginThrottle: clearing the account counter failed: {}", e.what());
        },
        "DEL %s",
        accountKey(username).c_str()
    );
}

}  // namespace hotel::services
