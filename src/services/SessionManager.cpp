#include "services/SessionManager.h"
#include "utils/Crypto.h"
#include "utils/Logger.h"
#include <drogon/drogon.h>
#include <json/json.h>
#include <chrono>

using Json::Value;
using Json::FastWriter;

namespace hotel::services {

static uint64_t currentUnixTime() {
    return static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::system_clock::now().time_since_epoch()
        ).count()
    );
}

void SessionManager::createUserSession(
    const UserRecord& user,
    const std::string& ip,
    std::function<void(std::optional<UserSessionData>)> callback
) {
    auto redis = drogon::app().getRedisClient("default");
    if (!redis) {
        HOTEL_LOG_ERROR("Redis client unavailable for createUserSession");
        callback(std::nullopt);
        return;
    }

    std::string token = hotel::utils::Crypto::randomHex(32);
    std::string csrfToken = hotel::utils::Crypto::randomHex(32);
    uint64_t now = currentUnixTime();

    UserSessionData session;
    session.token = token;
    session.user_id = user.id;
    session.username = user.username;
    session.rank = user.rank;
    session.look = user.look;
    session.motto = user.motto;
    session.ip = ip;
    session.csrf_token = csrfToken;
    session.created_at = now;
    session.last_active = now;

    Json::Value root;
    root["user_id"] = session.user_id;
    root["username"] = session.username;
    root["rank"] = session.rank;
    root["look"] = session.look;
    root["motto"] = session.motto;
    root["ip"] = session.ip;
    root["csrf_token"] = session.csrf_token;
    root["created_at"] = static_cast<Json::UInt64>(session.created_at);
    root["last_active"] = static_cast<Json::UInt64>(session.last_active);

    Json::FastWriter writer;
    std::string jsonStr = writer.write(root);

    std::string key = "session:user:" + token;
    redis->execCommandAsync(
        [session, callback](const drogon::nosql::RedisResult& r) {
            if (r.type() != drogon::nosql::RedisResultType::kNil && r.type() != drogon::nosql::RedisResultType::kError) {
                callback(session);
            } else {
                callback(std::nullopt);
            }
        },
        [callback](const std::exception& e) {
            HOTEL_LOG_ERROR("Redis error in createUserSession: {}", e.what());
            callback(std::nullopt);
        },
        "SETEX %s %u %s",
        key.c_str(),
        static_cast<unsigned int>(USER_SESSION_TTL_SEC),
        jsonStr.c_str()
    );
}

void SessionManager::getUserSession(
    const std::string& token,
    std::function<void(std::optional<UserSessionData>)> callback
) {
    if (token.empty()) {
        callback(std::nullopt);
        return;
    }

    auto redis = drogon::app().getRedisClient("default");
    if (!redis) {
        callback(std::nullopt);
        return;
    }

    std::string key = "session:user:" + token;
    redis->execCommandAsync(
        [token, callback](const drogon::nosql::RedisResult& r) {
            if (r.type() == drogon::nosql::RedisResultType::kString) {
                std::string jsonStr = r.asString();
                Json::Value root;
                Json::Reader reader;
                if (reader.parse(jsonStr, root)) {
                    UserSessionData session;
                    session.token = token;
                    session.user_id = root["user_id"].asUInt();
                    session.username = root["username"].asString();
                    session.rank = root["rank"].asUInt();
                    session.look = root["look"].asString();
                    session.motto = root["motto"].asString();
                    session.ip = root["ip"].asString();
                    session.csrf_token = root["csrf_token"].asString();
                    session.created_at = root["created_at"].asUInt64();
                    session.last_active = root["last_active"].asUInt64();
                    // The step-up flag. Absent in a document written before this
                    // field existed, and `asBool()` on a missing member yields
                    // false — the correct default: a session that never recorded
                    // the flag does not require step-up. Its absence here was a
                    // real defect: the writer stored it and the reader silently
                    // dropped it, so `/api/account/session` always reported false.
                    session.reauth_required = root["reauth_required"].asBool();
                    callback(session);
                    return;
                }
            }
            callback(std::nullopt);
        },
        [callback](const std::exception& e) {
            HOTEL_LOG_ERROR("Redis error in getUserSession: {}", e.what());
            callback(std::nullopt);
        },
        "GET %s",
        key.c_str()
    );
}

void SessionManager::destroyUserSession(
    const std::string& token,
    std::function<void(bool success)> callback
) {
    if (token.empty()) {
        if (callback) callback(true);
        return;
    }

    auto redis = drogon::app().getRedisClient("default");
    if (!redis) {
        if (callback) callback(false);
        return;
    }

    std::string key = "session:user:" + token;
    redis->execCommandAsync(
        [callback](const drogon::nosql::RedisResult& /*r*/) {
            if (callback) callback(true);
        },
        [callback](const std::exception& e) {
            HOTEL_LOG_ERROR("Redis error in destroyUserSession: {}", e.what());
            if (callback) callback(false);
        },
        "DEL %s",
        key.c_str()
    );
}

void SessionManager::setReauthRequired(
    const std::string& token,
    bool required,
    std::function<void(bool success)> callback
) {
    if (token.empty()) {
        if (callback) callback(false);
        return;
    }

    // Reuses the session reader so the document shape has exactly one definition.
    getUserSession(token, [token, required, callback](std::optional<UserSessionData> session) {
        if (!session.has_value()) {
            // No session means there is nothing to flag. The caller reports this
            // as a failure rather than silently succeeding on a session that does
            // not exist.
            if (callback) callback(false);
            return;
        }

        auto redis = drogon::app().getRedisClient("default");
        if (!redis) {
            if (callback) callback(false);
            return;
        }

        Json::Value root;
        root["user_id"] = session->user_id;
        root["username"] = session->username;
        root["rank"] = session->rank;
        root["look"] = session->look;
        root["motto"] = session->motto;
        root["ip"] = session->ip;
        root["csrf_token"] = session->csrf_token;
        root["created_at"] = static_cast<Json::UInt64>(session->created_at);
        root["last_active"] = static_cast<Json::UInt64>(session->last_active);
        root["reauth_required"] = required;

        Json::FastWriter writer;
        const std::string jsonStr = writer.write(root);
        const std::string key = "session:user:" + token;

        // `KEEPTTL` is deliberate: reauthenticating must not extend the session's
        // lifetime, and a plain SET would reset it to the Redis default (no
        // expiry at all).
        redis->execCommandAsync(
            [callback](const drogon::nosql::RedisResult& r) {
                if (callback) callback(r.type() != drogon::nosql::RedisResultType::kError);
            },
            [callback](const std::exception& e) {
                HOTEL_LOG_ERROR("Redis error in setReauthRequired: {}", e.what());
                if (callback) callback(false);
            },
            "SET %s %s KEEPTTL",
            key.c_str(),
            jsonStr.c_str());
    });
}

void SessionManager::createStaffSession(
    const UserRecord& user,
    const std::string& ip,
    bool is2faVerified,
    std::function<void(std::optional<StaffSessionData>)> callback
) {
    auto redis = drogon::app().getRedisClient("default");
    if (!redis) {
        HOTEL_LOG_ERROR("Redis client unavailable for createStaffSession");
        callback(std::nullopt);
        return;
    }

    std::string token = hotel::utils::Crypto::randomHex(32);
    uint64_t now = currentUnixTime();

    StaffSessionData session;
    session.token = token;
    session.user_id = user.id;
    session.username = user.username;
    session.rank = user.rank;
    session.is_2fa_verified = is2faVerified;
    session.ip = ip;
    session.created_at = now;
    session.last_active = now;

    Json::Value root;
    root["user_id"] = session.user_id;
    root["username"] = session.username;
    root["rank"] = session.rank;
    root["is_2fa_verified"] = session.is_2fa_verified;
    root["ip"] = session.ip;
    root["created_at"] = static_cast<Json::UInt64>(session.created_at);
    root["last_active"] = static_cast<Json::UInt64>(session.last_active);

    Json::FastWriter writer;
    std::string jsonStr = writer.write(root);

    std::string key = "session:staff:" + token;
    redis->execCommandAsync(
        [session, callback](const drogon::nosql::RedisResult& r) {
            if (r.type() != drogon::nosql::RedisResultType::kNil && r.type() != drogon::nosql::RedisResultType::kError) {
                callback(session);
            } else {
                callback(std::nullopt);
            }
        },
        [callback](const std::exception& e) {
            HOTEL_LOG_ERROR("Redis error in createStaffSession: {}", e.what());
            callback(std::nullopt);
        },
        "SETEX %s %u %s",
        key.c_str(),
        static_cast<unsigned int>(STAFF_SESSION_TTL_SEC),
        jsonStr.c_str()
    );
}

void SessionManager::getStaffSession(
    const std::string& token,
    std::function<void(std::optional<StaffSessionData>)> callback
) {
    if (token.empty()) {
        callback(std::nullopt);
        return;
    }

    auto redis = drogon::app().getRedisClient("default");
    if (!redis) {
        callback(std::nullopt);
        return;
    }

    std::string key = "session:staff:" + token;
    redis->execCommandAsync(
        [token, callback](const drogon::nosql::RedisResult& r) {
            if (r.type() == drogon::nosql::RedisResultType::kString) {
                std::string jsonStr = r.asString();
                Json::Value root;
                Json::Reader reader;
                if (reader.parse(jsonStr, root)) {
                    StaffSessionData session;
                    session.token = token;
                    session.user_id = root["user_id"].asUInt();
                    session.username = root["username"].asString();
                    session.rank = root["rank"].asUInt();
                    session.is_2fa_verified = root["is_2fa_verified"].asBool();
                    session.ip = root["ip"].asString();
                    session.created_at = root["created_at"].asUInt64();
                    session.last_active = root["last_active"].asUInt64();
                    callback(session);
                    return;
                }
            }
            callback(std::nullopt);
        },
        [callback](const std::exception& e) {
            HOTEL_LOG_ERROR("Redis error in getStaffSession: {}", e.what());
            callback(std::nullopt);
        },
        "GET %s",
        key.c_str()
    );
}

void SessionManager::destroyStaffSession(
    const std::string& token,
    std::function<void(bool success)> callback
) {
    if (token.empty()) {
        if (callback) callback(true);
        return;
    }

    auto redis = drogon::app().getRedisClient("default");
    if (!redis) {
        if (callback) callback(false);
        return;
    }

    std::string key = "session:staff:" + token;
    redis->execCommandAsync(
        [callback](const drogon::nosql::RedisResult& /*r*/) {
            if (callback) callback(true);
        },
        [callback](const std::exception& e) {
            HOTEL_LOG_ERROR("Redis error in destroyStaffSession: {}", e.what());
            if (callback) callback(false);
        },
        "DEL %s",
        key.c_str()
    );
}

} // namespace hotel::services
