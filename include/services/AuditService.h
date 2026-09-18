#pragma once

#include <string>
#include <optional>
#include <cstdint>
#include <functional>
#include <drogon/drogon.h>

namespace hotel::services {

class AuditService {
public:
    static void logAction(
        uint32_t actorId,
        const std::string& actionType,
        const std::string& targetType,
        std::optional<uint32_t> targetId,
        const std::string& details,
        const std::string& ipAddress = "",
        std::function<void(bool success)> callback = nullptr
    );
};

} // namespace hotel::services
