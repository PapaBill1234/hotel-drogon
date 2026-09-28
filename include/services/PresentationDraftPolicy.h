#pragma once

#include "services/PresentationDraftContract.h"
#include <cstddef>
#include <string>

namespace hotel::services {

/** Pure limits and audit-detail rules for the future named draft service. */
class PresentationDraftPolicy {
public:
    static constexpr std::size_t kMaxPayloadBytes = 256 * 1024;

    static PresentationValidationResult validatePayloadSize(const Json::Value& payload);
    static bool validAuditDetail(const std::string& detail);
};

}  // namespace hotel::services
