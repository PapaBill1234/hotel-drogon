#pragma once

#include <drogon/HttpResponse.h>
#include <json/value.h>
#include <optional>
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

struct PresentationOrderedResult {
    PresentationValidationResult validation;
    Json::Value document;
};

/** Pure, database-free validation for the v4 presentation contracts. */
class PresentationValidationService {
public:
    static PresentationValidationResult validateNavigation(const Json::Value& document);
    static PresentationValidationResult validatePage(const Json::Value& document);
    /** Validate and return a sorted copy by `(order, key)` for deterministic output. */
    static PresentationOrderedResult validateAndOrderNavigation(
        const Json::Value& document);
    /** Validate and return a sorted copy by `(order, key)` for deterministic output. */
    static PresentationOrderedResult validateAndOrderPage(const Json::Value& document);
    /** Return a canonical safe image URL, or nullopt for an unsafe value. */
    static std::optional<std::string> normalizePresentationMediaUrl(
        const std::string& url);
    /** Empty means no link; otherwise allow only HTTPS URLs or known public routes. */
    static bool isSafePresentationLinkUrl(const std::string& url);
    static bool isKnownPublicRoute(const std::string& path);
    static bool isSafeKey(const std::string& key);
};

}  // namespace hotel::services
