#pragma once

#include <json/value.h>
#include <string>

namespace hotel::services {

enum class PresentationValidationCode {
    none,
    invalid_document,
    invalid_field,
    unknown_route,
    unsafe_target,
    duplicate_key,
    unknown_block,
    invalid_block,
};

struct PresentationValidationResult {
    bool ok = false;
    PresentationValidationCode code = PresentationValidationCode::invalid_document;
    std::string field;
    std::string message;

    static PresentationValidationResult success();
    static PresentationValidationResult failure(PresentationValidationCode code,
                                                std::string field,
                                                std::string message);
};

/** Pure, database-free validation for the v4 presentation contracts. */
class PresentationValidationService {
public:
    static PresentationValidationResult validateNavigation(const Json::Value& document);
    static PresentationValidationResult validatePage(const Json::Value& document);
    static bool isKnownPublicRoute(const std::string& path);
    static bool isSafeKey(const std::string& key);
};

}  // namespace hotel::services
