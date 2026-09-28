#include "services/PresentationService.h"

#include "services/PresentationValidationService.h"
#include "utils/Logger.h"

#include <drogon/orm/Result.h>

#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace hotel::services {

std::optional<PresentationDocumentKind> PresentationService::kindForDocumentKey(
    const std::string& documentKey) {
    if (documentKey == "navigation") {
        return PresentationDocumentKind::Navigation;
    }

    constexpr char kPagePrefix[] = "page:";
    if (documentKey.rfind(kPagePrefix, 0) == 0 &&
        PresentationValidationService::isKnownPublicRoute(
            documentKey.substr(sizeof(kPagePrefix) - 1))) {
        return PresentationDocumentKind::Page;
    }

    return std::nullopt;
}

void PresentationService::ensureSchema(
    const drogon::orm::DbClientPtr& db,
    std::function<void()> onComplete) {
    if (!db) {
        HOTEL_LOG_WARN("PresentationService::ensureSchema called without a DbClient");
        if (onComplete) onComplete();
        return;
    }

    // The head row names the current draft and (optionally) published revision.
    // Revision rows are append-only snapshots; publication and rollback will
    // move pointers rather than rewrite document JSON. No initial content is
    // seeded here because the current static legacy navigation has not yet been
    // mapped into the typed contract.
    static const std::vector<std::string> kStatements = {
        "CREATE TABLE IF NOT EXISTS phpretro_presentation_documents ("
        "document_key VARCHAR(256) NOT NULL,"
        "document_kind ENUM('navigation','page') NOT NULL,"
        "contract_version SMALLINT UNSIGNED NOT NULL,"
        "draft_revision INT UNSIGNED NOT NULL DEFAULT 0,"
        "published_revision INT UNSIGNED NULL DEFAULT NULL,"
        "updated_by INT UNSIGNED NULL,"
        "updated_at BIGINT UNSIGNED NOT NULL DEFAULT 0,"
        "published_by INT UNSIGNED NULL,"
        "published_at BIGINT UNSIGNED NULL,"
        "PRIMARY KEY (document_key),"
        "INDEX idx_phpretro_presentation_published (published_at)"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        "CREATE TABLE IF NOT EXISTS phpretro_presentation_revisions ("
        "document_key VARCHAR(256) NOT NULL,"
        "revision INT UNSIGNED NOT NULL,"
        "contract_version SMALLINT UNSIGNED NOT NULL,"
        "document_json LONGTEXT NOT NULL,"
        "created_by INT UNSIGNED NOT NULL,"
        "created_at BIGINT UNSIGNED NOT NULL,"
        "PRIMARY KEY (document_key, revision),"
        "INDEX idx_phpretro_presentation_revision_created (created_at)"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    };

    auto step = std::make_shared<std::function<void(std::size_t)>>();
    *step = [db, step, onComplete](std::size_t index) {
        if (index >= kStatements.size()) {
            if (onComplete) onComplete();
            return;
        }

        *db << kStatements[index]
            >> [step, index](const drogon::orm::Result&) {
                   (*step)(index + 1);
               }
            >> [step, index](const drogon::orm::DrogonDbException& e) {
                   HOTEL_LOG_ERROR("PresentationService schema statement {}: {}",
                                   index, e.base().what());
                   (*step)(index + 1);
               };
    };
    (*step)(0);
}

}  // namespace hotel::services
