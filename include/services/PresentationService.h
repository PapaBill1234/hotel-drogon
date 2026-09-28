#pragma once

#include <drogon/orm/DbClient.h>

#include <cstdint>
#include <functional>
#include <optional>
#include <string>

namespace hotel::services {

/** The v1 shape of website-owned navigation and page presentation documents. */
inline constexpr uint16_t kPresentationContractVersion = 1;

enum class PresentationDocumentKind {
    Navigation,
    Page,
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
    static void ensureSchema(const drogon::orm::DbClientPtr& db,
                             std::function<void()> onComplete = nullptr);

    static std::optional<PresentationDocumentKind> kindForDocumentKey(
        const std::string& documentKey);
};

}  // namespace hotel::services
