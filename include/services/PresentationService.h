#pragma once

#include <drogon/orm/DbClient.h>
#include <json/value.h>

#include <cstdint>
#include <functional>
#include <optional>
#include <string>

#include "services/PresentationValidationService.h"

namespace hotel::services {

/** The v1 shape of website-owned navigation and page presentation documents. */
inline constexpr uint16_t kPresentationContractVersion = 1;

enum class PresentationDocumentKind {
    Navigation,
    Page,
};

enum class PresentationServiceCode {
    None,
    InvalidInput,
    NotFound,
    Conflict,
    UnsupportedVersion,
    Unavailable,
};

struct PresentationStoredDocument {
    std::string document_key;
    PresentationDocumentKind kind = PresentationDocumentKind::Navigation;
    uint16_t contract_version = 0;
    uint32_t revision = 0;
    Json::Value contents;
    uint32_t created_by = 0;
    uint64_t created_at = 0;
};

struct PresentationServiceResult {
    bool ok = false;
    PresentationServiceCode code = PresentationServiceCode::Unavailable;
    std::string field;
    std::string message;
    uint32_t revision = 0;
    std::optional<PresentationStoredDocument> document;
};

/**
 * Storage boundary for website-owned v4 presentation documents.
 *
 * Documents use canonical keys: `navigation` or `page:<known public route>`.
 * Their append-only revisions and mutable head pointers live in separate
 * `phpretro_presentation_*` tables. This service deliberately has no generic
 * table/column write operation.
 */
class PresentationService {
public:
    /**
     * Create the presentation tables in order. Completion is reported only
     * after every statement succeeds; startup uses it as a readiness gate.
     */
    static void ensureSchema(const drogon::orm::DbClientPtr& db,
                             std::function<void()> onComplete = nullptr);

    static std::optional<PresentationDocumentKind> kindForDocumentKey(
        const std::string& documentKey);

    static PresentationValidationResult validateDocumentForKey(
        const std::string& documentKey,
        const Json::Value& document);

    static void loadDraft(
        const std::string& documentKey,
        std::function<void(PresentationServiceResult)> callback);

    static void loadDraft(
        const drogon::orm::DbClientPtr& db,
        const std::string& documentKey,
        std::function<void(PresentationServiceResult)> callback);

    static void saveDraft(
        uint32_t actorId,
        const std::string& documentKey,
        uint32_t expectedRevision,
        const Json::Value& document,
        const std::string& ipAddress,
        std::function<void(PresentationServiceResult)> callback);

    static void saveDraft(
        const drogon::orm::DbClientPtr& db,
        uint32_t actorId,
        const std::string& documentKey,
        uint32_t expectedRevision,
        const Json::Value& document,
        const std::string& ipAddress,
        std::function<void(PresentationServiceResult)> callback);
};

}  // namespace hotel::services
