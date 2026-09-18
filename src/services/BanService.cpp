#include "services/BanService.h"
#include "services/AuditService.h"
#include "utils/Logger.h"
#include <chrono>

namespace hotel::services {

void BanService::checkUserBan(
    uint32_t userId,
    std::function<void(BanCheckResult)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback({false, "", 0, ""});
        return;
    }

    auto nowUnix = static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::system_clock::now().time_since_epoch()
        ).count()
    );

    *db << "SELECT id, ban_reason, ban_expire, type FROM bans "
           "WHERE user_id = ? AND type IN ('account', 'super') "
           "AND (ban_expire = 0 OR ban_expire > ?) "
           "ORDER BY ban_expire DESC LIMIT 1"
        << userId
        << nowUnix
        >> [callback](const drogon::orm::Result& r) {
            if (r.empty()) {
                callback({false, "", 0, ""});
            } else {
                const auto& row = r[0];
                BanCheckResult res;
                res.isBanned = true;
                res.reason = row["ban_reason"].as<std::string>();
                res.expire = row["ban_expire"].as<uint64_t>();
                res.type = row["type"].as<std::string>();
                callback(res);
            }
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("BanService::checkUserBan error: {}", e.base().what());
            callback({false, "", 0, ""});
        };
}

void BanService::checkIpBan(
    const std::string& ipAddress,
    std::function<void(BanCheckResult)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db || ipAddress.empty()) {
        callback({false, "", 0, ""});
        return;
    }

    auto nowUnix = static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::system_clock::now().time_since_epoch()
        ).count()
    );

    *db << "SELECT id, ban_reason, ban_expire, type FROM bans "
           "WHERE ip = ? AND type IN ('ip', 'super') "
           "AND (ban_expire = 0 OR ban_expire > ?) "
           "ORDER BY ban_expire DESC LIMIT 1"
        << ipAddress
        << nowUnix
        >> [callback](const drogon::orm::Result& r) {
            if (r.empty()) {
                callback({false, "", 0, ""});
            } else {
                const auto& row = r[0];
                BanCheckResult res;
                res.isBanned = true;
                res.reason = row["ban_reason"].as<std::string>();
                res.expire = row["ban_expire"].as<uint64_t>();
                res.type = row["type"].as<std::string>();
                callback(res);
            }
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("BanService::checkIpBan error: {}", e.base().what());
            callback({false, "", 0, ""});
        };
}

void BanService::banUser(
    uint32_t actorStaffId,
    uint32_t targetUserId,
    const std::string& reason,
    uint64_t expireTimestamp,
    const std::string& banType,
    const std::string& cfhTopic,
    const std::string& actorIp,
    std::function<void(bool success, const std::string& error)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(false, "Database unavailable");
        return;
    }

    auto nowUnix = static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::system_clock::now().time_since_epoch()
        ).count()
    );

    *db << "INSERT INTO bans (user_id, ip, machine_id, user_staff_id, timestamp, ban_expire, ban_reason, type, cfh_topic) "
           "VALUES (?, '', '', ?, ?, ?, ?, ?, ?)"
        << targetUserId
        << actorStaffId
        << nowUnix
        << expireTimestamp
        << reason
        << banType
        << cfhTopic
        >> [actorStaffId, targetUserId, reason, expireTimestamp, banType, actorIp, callback](const drogon::orm::Result& /*r*/) {
            std::string details = "Banned type=" + banType + " expire=" + std::to_string(expireTimestamp) + " reason=" + reason;
            AuditService::logAction(actorStaffId, "ban_user", "user", targetUserId, details, actorIp);
            callback(true, "");
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("BanService::banUser error: {}", e.base().what());
            callback(false, "Failed to apply ban");
        };
}

void BanService::unbanUser(
    uint32_t actorStaffId,
    uint32_t targetUserId,
    const std::string& actorIp,
    std::function<void(bool success, const std::string& error)> callback
) {
    auto db = drogon::app().getDbClient("default");
    if (!db) {
        callback(false, "Database unavailable");
        return;
    }

    *db << "DELETE FROM bans WHERE user_id = ?"
        << targetUserId
        >> [actorStaffId, targetUserId, actorIp, callback](const drogon::orm::Result& /*r*/) {
            AuditService::logAction(actorStaffId, "unban_user", "user", targetUserId, "All active bans revoked", actorIp);
            callback(true, "");
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("BanService::unbanUser error: {}", e.base().what());
            callback(false, "Failed to remove bans");
        };
}

} // namespace hotel::services
