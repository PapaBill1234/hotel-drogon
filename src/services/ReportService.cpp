#include "services/ReportService.h"
#include "services/AuditService.h"
#include "utils/Logger.h"
#include <chrono>

namespace hotel::services {

void ReportService::createReport(
    uint32_t reporterId,
    uint32_t targetId,
    const std::string& category,
    const std::string& message,
    const std::string& ipAddress,
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

    *db << "INSERT INTO phpretro_user_reports (user_id, target_id, category, message, status, created_at) "
           "VALUES (?, ?, ?, ?, 'open', ?)"
        << reporterId
        << targetId
        << category
        << message
        << nowUnix
        >> [reporterId, targetId, category, ipAddress, callback](const drogon::orm::Result& r) {
            uint32_t reportId = static_cast<uint32_t>(r.insertId());
            AuditService::logAction(reporterId, "create_report", "report", reportId, "Category: " + category, ipAddress);
            callback(true, "");
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("ReportService::createReport error: {}", e.base().what());
            callback(false, "Failed to submit report");
        };
}

void ReportService::resolveReport(
    uint32_t actorStaffId,
    uint32_t reportId,
    const std::string& resolutionStatus,
    const std::string& resolutionNote,
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

    *db << "UPDATE phpretro_user_reports SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?"
        << resolutionStatus
        << nowUnix
        << actorStaffId
        << reportId
        >> [actorStaffId, reportId, resolutionStatus, resolutionNote, actorIp, callback](const drogon::orm::Result& /*r*/) {
            std::string details = "Status: " + resolutionStatus + " Note: " + resolutionNote;
            AuditService::logAction(actorStaffId, "resolve_report", "report", reportId, details, actorIp);
            callback(true, "");
        }
        >> [callback](const drogon::orm::DrogonDbException& e) {
            HOTEL_LOG_ERROR("ReportService::resolveReport error: {}", e.base().what());
            callback(false, "Failed to resolve report");
        };
}

} // namespace hotel::services
