#include "services/UserAccountService.h"
#include "services/BanService.h"
#include "services/AuditService.h"
#include "utils/Crypto.h"
#include "utils/Logger.h"
#include <chrono>

// The password-reset methods use Drogon's Redis client and `drogon::app()`,
// which live in the umbrella header. The service header pulls in only the ORM
// client so a unit test can include it without the whole framework.
#include <drogon/drogon.h>

namespace hotel::services {

static UserRecord mapUserRow(const drogon::orm::Row& row) {
    UserRecord u;
    u.id = row["id"].as<uint32_t>();
    u.username = row["username"].as<std::string>();
    u.real_name = row["real_name"].as<std::string>();
    u.mail = row["mail"].as<std::string>();
    u.mail_verified = (row["mail_verified"].as<std::string>() == "1" || row["mail_verified"].as<int>() == 1);
    u.rank = row["rank"].as<uint32_t>();
    u.credits = row["credits"].as<int32_t>();
    u.pixels = row["pixels"].as<int32_t>();
    u.points = row["points"].as<int32_t>();
    u.look = row["look"].as<std::string>();
    u.gender = row["gender"].as<std::string>();
    u.motto = row["motto"].as<std::string>();
    u.online = row["online"].as<std::string>();
    u.account_created = row["account_created"].as<uint64_t>();
    u.last_login = row["last_login"].as<uint64_t>();
    u.ip_current = row["ip_current"].as<std::string>();
    u.auth_ticket = row["auth_ticket"].as<std::string>();
    return u;
}

void UserAccountService::findById(
    uint32_t userId,
    std::function<void(std::optional<UserRecord>)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(std::nullopt);
        return;
    }

    *db << "SELECT id, username, real_name, mail, mail_verified, rank, credits, pixels, points, "
           "look, gender, motto, online, account_created, last_login, ip_current, auth_ticket "
           "FROM users WHERE id = ? LIMIT 1"
        << userId
        >> [callback](const drogon::orm::Result& r) {
            if (r.empty()) {
                callback(std::nullopt);
            } else {
                callback(mapUserRow(r[0]));
            }
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("UserAccountService::findById error: {}", e.base().what());
            callback(std::nullopt);
        };
}

void UserAccountService::findByUsername(
    const std::string& username,
    std::function<void(std::optional<UserRecord>)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(std::nullopt);
        return;
    }

    *db << "SELECT id, username, real_name, mail, mail_verified, rank, credits, pixels, points, "
           "look, gender, motto, online, account_created, last_login, ip_current, auth_ticket "
           "FROM users WHERE username = ? LIMIT 1"
        << username
        >> [callback](const drogon::orm::Result& r) {
            if (r.empty()) {
                callback(std::nullopt);
            } else {
                callback(mapUserRow(r[0]));
            }
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("UserAccountService::findByUsername error: {}", e.base().what());
            callback(std::nullopt);
        };
}

void UserAccountService::authenticate(
    const std::string& username,
    const std::string& password,
    const std::string& ipAddress,
    std::function<void(AuthResult)> callback
) {
    if (username.empty() || password.empty()) {
        AuthResult res;
        res.success = false;
        res.errorCode = 1;
        res.errorMessage = "Username and password are required.";
        callback(res);
        return;
    }

    auto db = drogon::app().getDbClient("default");
    if (!db) {
        AuthResult res;
        res.success = false;
        res.errorCode = 4;
        res.errorMessage = "Database service unavailable.";
        callback(res);
        return;
    }

    *db << "SELECT id, username, real_name, password, mail, mail_verified, rank, credits, pixels, points, "
           "look, gender, motto, online, account_created, last_login, ip_current, auth_ticket "
           "FROM users WHERE username = ? LIMIT 1"
        << username
        >> [password, ipAddress, db, callback](const drogon::orm::Result& r) {
            if (r.empty()) {
                AuthResult res;
                res.success = false;
                res.errorCode = 2;
                res.errorMessage = "Invalid username or password.";
                callback(res);
                return;
            }

            const auto& row = r[0];
            uint32_t userId = row["id"].as<uint32_t>();
            std::string storedPassword = row["password"].as<std::string>();
            std::string userLogin = row["username"].as<std::string>();

            // Password verification
            auto verifyResult = hotel::utils::Crypto::verifyPassword(password, storedPassword, userLogin);
            if (!verifyResult.verified) {
                AuthResult res;
                res.success = false;
                res.errorCode = 2;
                res.errorMessage = "Invalid username or password.";
                callback(res);
                return;
            }

            // Upgrade legacy password hash if required
            if (verifyResult.needsRehash) {
                std::string newHash = hotel::utils::Crypto::hashPassword(password);
                *db << "UPDATE users SET password = ? WHERE id = ?"
                    << newHash << userId
                    >> [](const drogon::orm::Result&) {
                        HOTEL_LOG_INFO("Successfully upgraded legacy password hash for user");
                    }
                    >> [](const drogon::orm::DrogonDbException& e) {
                        HOTEL_LOG_WARN("Failed to upgrade legacy password hash: {}", e.base().what());
                    };
            }

            // Ban check
            BanService::checkUserBan(userId, [row, userId, ipAddress, db, callback](BanCheckResult banCheck) {
                if (banCheck.isBanned) {
                    AuthResult res;
                    res.success = false;
                    res.errorCode = 3;
                    res.errorMessage = "Account is banned: " + banCheck.reason;
                    res.banReason = banCheck.reason;
                    res.banExpires = std::to_string(banCheck.expire);
                    callback(res);
                    return;
                }

                // Record login timestamp and IP
                auto nowUnix = static_cast<uint64_t>(
                    std::chrono::duration_cast<std::chrono::seconds>(
                        std::chrono::system_clock::now().time_since_epoch()
                    ).count()
                );

                *db << "UPDATE users SET last_login = ?, ip_current = ? WHERE id = ?"
                    << nowUnix << ipAddress << userId
                    >> [](const drogon::orm::Result&) {}
                    >> [](const drogon::orm::DrogonDbException& e) {
                        HOTEL_LOG_WARN("Failed to update last_login: {}", e.base().what());
                    };

                AuditService::logAction(userId, "user_login", "user", userId, "Login from " + ipAddress, ipAddress);

                UserRecord user = mapUserRow(row);
                user.last_login = nowUnix;
                user.ip_current = ipAddress;

                AuthResult res;
                res.success = true;
                res.errorCode = 0;
                res.user = user;
                callback(res);
            });
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("UserAccountService::authenticate error: {}", e.base().what());
            AuthResult res;
            res.success = false;
            res.errorCode = 4;
            res.errorMessage = "Authentication failed due to system error.";
            callback(res);
        };
}

void UserAccountService::updateMotto(
    uint32_t userId,
    const std::string& newMotto,
    const std::string& ipAddress,
    std::function<void(bool success, const std::string& error)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(false, "Database unavailable");
        return;
    }

    *db << "UPDATE users SET motto = ? WHERE id = ?"
        << newMotto << userId
        >> [userId, newMotto, ipAddress, callback](const drogon::orm::Result& r) {
            if (r.affectedRows() > 0 || r.size() == 0) {
                AuditService::logAction(userId, "update_motto", "user", userId, "Motto changed", ipAddress);
                callback(true, "");
            } else {
                callback(false, "User not found");
            }
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("UserAccountService::updateMotto error: {}", e.base().what());
            callback(false, "Database update error");
        };
}

void UserAccountService::updateLook(
    uint32_t userId,
    const std::string& newLook,
    const std::string& newGender,
    const std::string& ipAddress,
    std::function<void(bool success, const std::string& error)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(false, "Database unavailable");
        return;
    }

    *db << "UPDATE users SET look = ?, gender = ? WHERE id = ?"
        << newLook << newGender << userId
        >> [userId, ipAddress, callback](const drogon::orm::Result& /*r*/) {
            AuditService::logAction(userId, "update_look", "user", userId, "Avatar look changed", ipAddress);
            callback(true, "");
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("UserAccountService::updateLook error: {}", e.base().what());
            callback(false, "Database update error");
        };
}

void UserAccountService::updateEmail(
    uint32_t userId,
    const std::string& newEmail,
    const std::string& ipAddress,
    std::function<void(bool success, const std::string& error)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(false, "Database unavailable");
        return;
    }

    *db << "UPDATE users SET mail = ?, mail_verified = 0 WHERE id = ?"
        << newEmail << userId
        >> [userId, ipAddress, callback](const drogon::orm::Result& /*r*/) {
            AuditService::logAction(userId, "update_email", "user", userId, "Email address changed", ipAddress);
            callback(true, "");
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("UserAccountService::updateEmail error: {}", e.base().what());
            callback(false, "Database update error");
        };
}

void UserAccountService::changePassword(
    uint32_t userId,
    const std::string& newPassword,
    const std::string& ipAddress,
    std::function<void(bool success, const std::string& error)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(false, "Database unavailable");
        return;
    }

    std::string newHash = hotel::utils::Crypto::hashPassword(newPassword);

    *db << "UPDATE users SET password = ? WHERE id = ?"
        << newHash << userId
        >> [userId, ipAddress, callback](const drogon::orm::Result& /*r*/) {
            AuditService::logAction(userId, "change_password", "user", userId, "Password updated", ipAddress);
            callback(true, "");
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("UserAccountService::changePassword error: {}", e.base().what());
            callback(false, "Database update error");
        };
}

void UserAccountService::setRememberToken(
    uint32_t userId,
    const std::string& tokenHash,
    uint64_t expiresAt,
    std::function<void(bool success)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        if (callback) callback(false);
        return;
    }

    *db << "UPDATE users SET remember_token_hash = ?, remember_token_expires_at = ? WHERE id = ?"
        << tokenHash << expiresAt << userId
        >> [callback](const drogon::orm::Result& /*r*/) {
            if (callback) callback(true);
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("UserAccountService::setRememberToken error: {}", e.base().what());
            if (callback) callback(false);
        };
}

void UserAccountService::generateAuthTicket(
    uint32_t userId,
    const std::string& ticket,
    const std::string& ipAddress,
    std::function<void(bool success)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        if (callback) callback(false);
        return;
    }

    // `users.auth_ticket` only. PolarIS declares `auth_ticket varchar(256)` and
    // no expiry column; see the note on the declaration.
    *db << "UPDATE users SET auth_ticket = ? WHERE id = ?"
        << ticket << userId
        >> [userId, ipAddress, callback](const drogon::orm::Result& /*r*/) {
            AuditService::logAction(userId, "issue_sso_ticket", "user", userId, "Client SSO ticket issued", ipAddress);
            if (callback) callback(true);
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("UserAccountService::generateAuthTicket error: {}", e.base().what());
            if (callback) callback(false);
        };
}

void UserAccountService::findByUsernameAndVerifiedMail(
    const std::string& username,
    const std::string& mail,
    std::function<void(std::optional<UserRecord>)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(std::nullopt);
        return;
    }

    // Legacy forgot.php's exact predicate, including `mail_verified = '1'`.
    *db << "SELECT id, username, real_name, mail, mail_verified, rank, credits, pixels, points, "
           "look, gender, motto, online, account_created, last_login, ip_current, auth_ticket "
           "FROM users WHERE username = ? AND mail = ? AND mail_verified = '1' LIMIT 1"
        << username << mail
        >> [callback](const drogon::orm::Result& r) {
            if (r.empty()) {
                callback(std::nullopt);
            } else {
                callback(mapUserRow(r[0]));
            }
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR(
                "UserAccountService::findByUsernameAndVerifiedMail error: {}",
                e.base().what());
            callback(std::nullopt);
        };
}

void UserAccountService::listUsernamesForMail(
    const std::string& mail,
    std::function<void(std::vector<std::string>)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback({});
        return;
    }

    *db << "SELECT username FROM users WHERE mail = ? ORDER BY username ASC" << mail
        >> [callback](const drogon::orm::Result& r) {
            std::vector<std::string> names;
            names.reserve(r.size());
            for (const auto& row : r) {
                names.push_back(row["username"].as<std::string>());
            }
            callback(std::move(names));
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("UserAccountService::listUsernamesForMail error: {}", e.base().what());
            callback({});
        };
}

uint32_t UserAccountService::passwordResetTtlSeconds() {
    // 30 minutes. There is no legacy value to copy — the legacy flow had no
    // token — so this is a deliberate choice: long enough to fetch mail and act,
    // short enough that a leaked link is not durable. The expiry is enforced by
    // Redis itself, so it holds even if this process restarts.
    return 1800;
}

void UserAccountService::issuePasswordResetToken(
    uint32_t userId,
    std::function<void(bool success, const std::string& token, uint32_t ttlSeconds)> callback
) {
    auto redis = drogon::app().getRedisClient("default");
    if (!redis) {
        HOTEL_LOG_ERROR("UserAccountService::issuePasswordResetToken: no Redis client");
        callback(false, "", 0);
        return;
    }

    // 32 bytes of hex, in the same generator the session tokens use.
    const std::string token = utils::Crypto::randomHex(32);
    const std::string tokenHash = utils::Crypto::sha256(token);
    const uint32_t ttl = passwordResetTtlSeconds();
    const std::string key = "password_reset:" + tokenHash;

    // The value is the user id; the key carries the secret. SETEX makes the TTL
    // atomic with the write, so a token can never exist without an expiry.
    redis->execCommandAsync(
        [callback, token, ttl](const drogon::nosql::RedisResult& r) {
            if (r.type() == drogon::nosql::RedisResultType::kError) {
                HOTEL_LOG_ERROR("UserAccountService: reset token SETEX returned an error");
                callback(false, "", 0);
                return;
            }
            callback(true, token, ttl);
        },
        [callback](const std::exception& e) {
            HOTEL_LOG_ERROR("UserAccountService::issuePasswordResetToken: {}", e.what());
            callback(false, "", 0);
        },
        "SETEX %s %u %s",
        key.c_str(),
        static_cast<unsigned int>(ttl),
        std::to_string(userId).c_str());
}

void UserAccountService::consumePasswordResetToken(
    const std::string& token,
    const std::string& newPassword,
    const std::string& ipAddress,
    std::function<void(bool success, bool invalidToken, const std::string& error)> callback
) {
    if (token.empty()) {
        callback(false, true, "Reset token is required.");
        return;
    }
    // Same six-byte floor the authenticated password-change route enforces, so a
    // reset cannot produce a password the change route would have refused.
    if (newPassword.size() < 6) {
        callback(false, false, "New password must be at least 6 characters.");
        return;
    }

    auto redis = drogon::app().getRedisClient("default");
    if (!redis) {
        callback(false, false, "Session store unavailable.");
        return;
    }

    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(false, false, "Database service unavailable.");
        return;
    }

    const std::string key = "password_reset:" + utils::Crypto::sha256(token);

    // GETDEL deletes and returns in one atomic step, which is what makes the
    // token single-use even if two requests race: exactly one of them sees the
    // value. Doing GET then DEL would let both read it.
    redis->execCommandAsync(
        [db, newPassword, ipAddress, callback](const drogon::nosql::RedisResult& r) {
            if (r.type() != drogon::nosql::RedisResultType::kString) {
                // Unknown, expired, or already consumed — one answer for all
                // three, so a caller cannot probe which tokens exist.
                callback(false, true, "This reset link is invalid or has expired.");
                return;
            }

            uint32_t userId = 0;
            try {
                userId = static_cast<uint32_t>(std::stoul(r.asString()));
            } catch (const std::exception&) {
                HOTEL_LOG_ERROR("UserAccountService: reset token held a non-numeric user id");
                callback(false, true, "This reset link is invalid or has expired.");
                return;
            }

            const std::string newHash = utils::Crypto::hashPassword(newPassword);
            *db << "UPDATE users SET password = ? WHERE id = ?" << newHash << userId
                >> [userId, ipAddress, callback](const drogon::orm::Result& res) {
                       if (res.affectedRows() == 0) {
                           callback(false, true, "This reset link is invalid or has expired.");
                           return;
                       }
                       AuditService::logAction(userId, "password_reset", "user", userId,
                                               "Password reset completed with a single-use token",
                                               ipAddress);
                       callback(true, false, "");
                   }
                >> [callback](const drogon::orm::DrogonDbException& e) {
                       HOTEL_LOG_ERROR("UserAccountService::consumePasswordResetToken error: {}",
                                       e.base().what());
                       callback(false, false, "Database update error");
                   };
        },
        [callback](const std::exception& e) {
            HOTEL_LOG_ERROR("UserAccountService::consumePasswordResetToken: {}", e.what());
            callback(false, false, "Session store error");
        },
        "GETDEL %s",
        key.c_str());
}

} // namespace hotel::services
