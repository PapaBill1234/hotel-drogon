#include "services/PresentationDraftPolicy.h"

#include <json/json.h>

namespace hotel::services {
namespace {
PresentationValidationResult failure(const std::string& field, const std::string& message) {
    return PresentationValidationResult::failure(PresentationValidationCode::invalid_field, field, message);
}
}

PresentationValidationResult PresentationDraftPolicy::validatePayloadSize(const Json::Value& payload) {
    Json::StreamWriterBuilder builder;
    builder["indentation"] = "";
    const auto serialized = Json::writeString(builder, payload);
    if (serialized.size() > kMaxPayloadBytes)
        return failure("payload", "presentation payload exceeds the 256 KiB limit");
    return PresentationValidationResult::success();
}

bool PresentationDraftPolicy::validAuditDetail(const std::string& detail) {
    if (detail.empty() || detail.size() > 512) return false;
    for (const unsigned char c : detail) {
        if (c < 0x20 || c == 0x7f) return false;
    }
    return true;
}

}  // namespace hotel::services
