#pragma once

#include <string>
#include <optional>
#include <vector>
#include <cstdint>
#include <functional>
#include <drogon/drogon.h>

namespace hotel::services {

struct BanRecord {
    uint32_t id = 0;
    uint32_t user_id = 0;
    std::string ip;
    std::string machine_id;
    uint32_t user_staff_id = 0;
    uint64_t timestamp = 0;
    uint64_t ban_expire = 0;
    std::string ban_reason;
    std::string type = "account";
    std::string cfh_topic;
};

struct BanCheckResult {
    bool isBanned = false;
    std::string reason;
    uint64_t expire = 0;
    std::string type;
};

class BanService {
public:
    static void checkUserBan(
        uint32_t userId,
        std::function<void(BanCheckResult)> callback
    );

    static void checkIpBan(
        const std::string& ipAddress,
        std::function<void(BanCheckResult)> callback
    );

    static void banUser(
        uint32_t actorStaffId,
        uint32_t targetUserId,
        const std::string& reason,
        uint64_t expireTimestamp,
        const std::string& banType,
        const std::string& cfhTopic,
        const std::string& actorIp,
        std::function<void(bool success, const std::string& error)> callback
    );

    static void unbanUser(
        uint32_t actorStaffId,
        uint32_t targetUserId,
        const std::string& actorIp,
        std::function<void(bool success, const std::string& error)> callback
    );
};

} // namespace hotel::services
