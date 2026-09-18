#pragma once

#include <string>
#include <optional>
#include <vector>
#include <cstdint>
#include <functional>
#include <drogon/drogon.h>

namespace hotel::services {

struct ReportRecord {
    uint32_t id = 0;
    uint32_t user_id = 0;
    uint32_t target_id = 0;
    std::string category;
    std::string message;
    std::string status = "open";
    uint64_t created_at = 0;
    uint64_t resolved_at = 0;
    uint32_t resolved_by = 0;
};

class ReportService {
public:
    static void createReport(
        uint32_t reporterId,
        uint32_t targetId,
        const std::string& category,
        const std::string& message,
        const std::string& ipAddress,
        std::function<void(bool success, const std::string& error)> callback
    );

    static void resolveReport(
        uint32_t actorStaffId,
        uint32_t reportId,
        const std::string& resolutionStatus,
        const std::string& resolutionNote,
        const std::string& actorIp,
        std::function<void(bool success, const std::string& error)> callback
    );
};

} // namespace hotel::services
