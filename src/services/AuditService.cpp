#include "services/AuditService.h"
#include "utils/Logger.h"
#include <chrono>

namespace hotel::services {

void AuditService::logAction(
    uint32_t actorId,
    const std::string& actionType,
    const std::string& targetType,
    std::optional<uint32_t> targetId,
    const std::string& details,
    const std::string& ipAddress,
    std::function<void(bool success)> callback
) {
    auto nowUnix = static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::system_clock::now().time_since_epoch()
        ).count()
    );

    HOTEL_LOG_INFO(
        "[AUDIT] actor_id={} action={} target={}:{} ip='{}' details='{}'",
        actorId, actionType, targetType, targetId.value_or(0), ipAddress, details
    );

    try {
        auto dbClient = drogon::app().getDbClient("default");
        if (!dbClient) {
            if (callback) callback(false);
            return;
        }

        std::string sql = 
            "INSERT INTO phpretro_admin_action_log "
            "(admin_id, action_type, target_type, target_id, details, ip, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)";

        int tId = targetId.has_value() ? static_cast<int>(targetId.value()) : 0;

        *dbClient << sql
            << actorId
            << actionType
            << targetType
            << tId
            << details
            << ipAddress
            << nowUnix
            >> [callback](const drogon::orm::Result& /*r*/) {
                if (callback) callback(true);
            }
            >> [callback, actionType](const drogon::orm::DrogonDbException& e) {
                HOTEL_LOG_ERROR("Failed to insert audit log for action '{}': {}", actionType, e.base().what());
                if (callback) callback(false);
            };
    } catch (const std::exception& ex) {
        HOTEL_LOG_ERROR("Exception in AuditService::logAction: {}", ex.what());
        if (callback) callback(false);
    }
}

} // namespace hotel::services
