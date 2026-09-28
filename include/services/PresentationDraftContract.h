#pragma once

#include "services/PresentationValidationService.h"
#include <json/value.h>
#include <string>

namespace hotel::services {

/** Pure request-envelope checks for the v4 draft boundary; no persistence. */
class PresentationDraftContract {
public:
    static PresentationValidationResult validateRequest(const Json::Value& request);
    static bool isDocumentKey(const std::string& kind, const std::string& key);
};

}  // namespace hotel::services
