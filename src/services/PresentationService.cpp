#include "services/PresentationService.h"

#include "services/PresentationValidationService.h"
#include "utils/Logger.h"

#include <drogon/drogon.h>
#include <drogon/orm/Result.h>
#include <json/reader.h>
#include <json/writer.h>

#include <ctime>
#include <functional>
#include <limits>
#include <memory>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

namespace hotel::services {
namespace {

constexpr uint32_t kMaxPresentationRevision = 1000000000U;
constexpr std::size_t kMaxSerializedDocumentBytes = 512U * 1024U;

PresentationServiceResult serviceFailure(PresentationServiceCode code,
                                         const std::string& field,
                                         const std::string& message) {
    PresentationServiceResult result;
    result.code = code;
    result.field = field;
    result.message = message;
    return result;
}

std::string kindName(PresentationDocumentKind kind) {
    return kind == PresentationDocumentKind::Navigation ? "navigation" : "page";
}

bool isContention(const std::string& message) {
    return message.find("Deadlock found") != std::string::npos ||
           message.find("Lock wait timeout") != std::string::npos;
}

bool isDuplicateKey(const std::string& message) {
    return message.find("Duplicate entry") != std::string::npos;
}

/**
 * The single transaction for one draft save. It keeps the DB client and the
 * transaction alive across Drogon's asynchronous statement callbacks. A write
 * succeeds only after the transaction's commit callback reports success.
 */
class DraftSaveTransaction : public std::enable_shared_from_this<DraftSaveTransaction> {
public:
    DraftSaveTransaction(
        drogon::orm::DbClientPtr db,
        uint32_t actorId,
        std::string documentKey,
        PresentationDocumentKind kind,
        uint32_t expectedRevision,
        uint32_t nextRevision,
        std::string documentJson,
        std::string ipAddress,
        uint64_t now,
        std::function<void(PresentationServiceResult)> callback)
        : db_(std::move(db)),
          actor_id_(actorId),
          document_key_(std::move(documentKey)),
          kind_(kind),
          expected_revision_(expectedRevision),
          next_revision_(nextRevision),
          document_json_(std::move(documentJson)),
          ip_address_(std::move(ipAddress)),
          now_(now),
          callback_(std::move(callback)),
          result_(std::make_shared<PresentationServiceResult>()),
          write_succeeded_(std::make_shared<bool>(false)),
          settled_(std::make_shared<bool>(false)) {}

    void start() {
        keep_alive_ = shared_from_this();
        try {
            auto callback = callback_;
            auto result = result_;
            auto writeSucceeded = write_succeeded_;
            auto settled = settled_;
            transaction_ = db_->newTransaction(
                [callback, result, writeSucceeded, settled,
                 nextRevision = next_revision_](bool committed) mutable {
                    if (*settled) return;
                    *settled = true;
                    if (committed && *writeSucceeded) {
                        result->ok = true;
                        result->code = PresentationServiceCode::None;
                        result->revision = nextRevision;
                        result->message.clear();
                    } else if (*writeSucceeded) {
                        result->ok = false;
                        result->code = PresentationServiceCode::Unavailable;
                        result->message = "The presentation draft could not be committed.";
                    }
                    if (callback) callback(*result);
                });
        } catch (const std::exception& e) {
            HOTEL_LOG_ERROR("PresentationService::saveDraft transaction: {}", e.what());
            result_->code = PresentationServiceCode::Unavailable;
            result_->message = "The presentation draft could not be saved.";
            finishWithoutTransaction();
            return;
        }

        if (!transaction_) {
            result_->code = PresentationServiceCode::Unavailable;
            result_->message = "The presentation draft could not be saved.";
            finishWithoutTransaction();
            return;
        }

        if (expected_revision_ == 0) {
            insertHead();
        } else {
            compareAndSwapHead();
        }
    }

private:
    enum class Step {
        Head,
        Revision,
        Audit,
    };

    template <typename OnSuccess, typename... Args>
    void execute(const std::string& sql, OnSuccess onSuccess, const Args&... args) {
        auto self = shared_from_this();
        auto binder = *transaction_ << sql;
        ((binder << args), ...);
        binder >> [self, onSuccess](const drogon::orm::Result& result) {
                   if (!self->stopping_) onSuccess(result);
               }
               >> [self](const drogon::orm::DrogonDbException& e) {
                      if (!self->stopping_) self->onQueryError(e);
                  };
    }

    void insertHead() {
        step_ = Step::Head;
        auto self = shared_from_this();
        execute(
            "INSERT INTO phpretro_presentation_documents "
            "(document_key, document_kind, contract_version, draft_revision, "
            "published_revision, updated_by, updated_at, published_by, published_at) "
            "VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, NULL)",
            [self](const drogon::orm::Result&) { self->insertRevision(); },
            document_key_, kindName(kind_), kPresentationContractVersion,
            next_revision_, actor_id_, now_);
    }

    void compareAndSwapHead() {
        step_ = Step::Head;
        auto self = shared_from_this();
        execute(
            "UPDATE phpretro_presentation_documents "
            "SET draft_revision = ?, updated_by = ?, updated_at = ? "
            "WHERE document_key = ? AND document_kind = ? AND contract_version = ? "
            "AND draft_revision = ?",
            [self](const drogon::orm::Result& result) {
                if (result.affectedRows() == 0) {
                    self->abort(PresentationServiceCode::Conflict,
                                "This presentation draft changed. Reload and try again.");
                    return;
                }
                self->insertRevision();
            },
            next_revision_, actor_id_, now_, document_key_, kindName(kind_),
            kPresentationContractVersion, expected_revision_);
    }

    void insertRevision() {
        step_ = Step::Revision;
        auto self = shared_from_this();
        execute(
            "INSERT INTO phpretro_presentation_revisions "
            "(document_key, revision, contract_version, document_json, created_by, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [self](const drogon::orm::Result&) { self->insertAudit(); },
            document_key_, next_revision_, kPresentationContractVersion,
            document_json_, actor_id_, now_);
    }

    void insertAudit() {
        step_ = Step::Audit;
        auto self = shared_from_this();
        const std::string details = "Saved presentation draft '" + document_key_ +
                                    "' at revision " + std::to_string(next_revision_);
        execute(
            "INSERT INTO phpretro_admin_action_log "
            "(admin_id, action_type, target_type, target_id, details, ip, created_at) "
            "VALUES (?, 'presentation_draft_saved', 'presentation_document', 0, ?, ?, ?)",
            [self](const drogon::orm::Result&) { self->commit(); },
            actor_id_, details, ip_address_, now_);
    }

    void onQueryError(const drogon::orm::DrogonDbException& e) {
        const std::string driverMessage = e.base().what();
        PresentationServiceCode code = PresentationServiceCode::Unavailable;
        std::string message = "The presentation draft could not be saved.";
        if (step_ == Step::Head && expected_revision_ == 0 && isDuplicateKey(driverMessage)) {
            code = PresentationServiceCode::Conflict;
            message = "This presentation draft already exists. Reload and try again.";
        } else if (step_ == Step::Head && expected_revision_ != 0 && isContention(driverMessage)) {
            code = PresentationServiceCode::Conflict;
            message = "This presentation draft changed. Reload and try again.";
        }
        HOTEL_LOG_ERROR("PresentationService::saveDraft step {}: {}",
                        static_cast<int>(step_), driverMessage);
        abort(code, message);
    }

    void abort(PresentationServiceCode code, const std::string& message) {
        if (stopping_) return;
        stopping_ = true;
        result_->code = code;
        result_->message = message;
        auto self = shared_from_this();
        // Drogon's async transaction must drain this statement before release.
        // Calling Transaction::rollback() and immediately dropping the handle
        // can race its completion flag; see the measured HomesService abort path.
        *transaction_ << "ROLLBACK"
                     >> [self](const drogon::orm::Result&) {
                            self->releaseAfterRollback();
                        }
                     >> [self](const drogon::orm::DrogonDbException& e) {
                            const std::string rollbackMessage = e.base().what();
                            if (rollbackMessage == "The transaction has been rolled back") {
                                HOTEL_LOG_DEBUG(
                                    "PresentationService rollback already completed by Drogon");
                            } else {
                                HOTEL_LOG_ERROR("PresentationService rollback failed: {}",
                                                rollbackMessage);
                            }
                            self->releaseAfterRollback();
                        };
    }

    void commit() {
        if (stopping_) return;
        stopping_ = true;
        *write_succeeded_ = true;
        result_->revision = next_revision_;
        result_->code = PresentationServiceCode::None;
        result_->field.clear();
        result_->message.clear();
        transaction_.reset();
        keep_alive_.reset();
    }

    void releaseAfterRollback() {
        if (*settled_) return;
        *settled_ = true;
        auto keepAlive = keep_alive_;
        transaction_.reset();
        keep_alive_.reset();
        if (callback_) callback_(*result_);
        (void)keepAlive;
    }

    void finishWithoutTransaction() {
        if (*settled_) return;
        *settled_ = true;
        if (callback_) callback_(*result_);
        keep_alive_.reset();
    }

    drogon::orm::DbClientPtr db_;
    uint32_t actor_id_;
    std::string document_key_;
    PresentationDocumentKind kind_;
    uint32_t expected_revision_;
    uint32_t next_revision_;
    std::string document_json_;
    std::string ip_address_;
    uint64_t now_;
    std::function<void(PresentationServiceResult)> callback_;
    std::shared_ptr<PresentationServiceResult> result_;
    std::shared_ptr<bool> write_succeeded_;
    std::shared_ptr<bool> settled_;
    std::shared_ptr<drogon::orm::Transaction> transaction_;
    std::shared_ptr<DraftSaveTransaction> keep_alive_;
    Step step_ = Step::Head;
    bool stopping_ = false;
};

}  // namespace

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

PresentationValidationResult PresentationService::validateDocumentForKey(
    const std::string& documentKey,
    const Json::Value& document) {
    const auto kind = kindForDocumentKey(documentKey);
    if (!kind.has_value()) {
        return PresentationValidationResult::failure(
            PresentationValidationCode::unknown_route,
            "documentKey",
            "presentation document key is not supported");
    }

    if (*kind == PresentationDocumentKind::Navigation) {
        return PresentationValidationService::validateNavigation(document);
    }

    constexpr std::size_t kPagePrefixLength = sizeof("page:") - 1;
    const std::string expectedPath = documentKey.substr(kPagePrefixLength);
    if (!document.isObject() || !document.isMember("path") ||
        !document["path"].isString() || document["path"].asString() != expectedPath) {
        return PresentationValidationResult::failure(
            PresentationValidationCode::invalid_document,
            "path",
            "page document path must match its document key");
    }
    return PresentationValidationService::validatePage(document);
}

void PresentationService::loadDraft(
    const std::string& documentKey,
    std::function<void(PresentationServiceResult)> callback) {
    loadDraft(drogon::app().getDbClient("default"), documentKey,
              std::move(callback));
}

void PresentationService::loadDraft(
    const drogon::orm::DbClientPtr& db,
    const std::string& documentKey,
    std::function<void(PresentationServiceResult)> callback) {
    const auto expectedKind = kindForDocumentKey(documentKey);
    if (!expectedKind.has_value()) {
        if (callback) callback(serviceFailure(
            PresentationServiceCode::InvalidInput, "documentKey",
            "presentation document key is not supported"));
        return;
    }

    if (!db) {
        if (callback) callback(serviceFailure(
            PresentationServiceCode::Unavailable, "",
            "Presentation storage is unavailable."));
        return;
    }

    *db << "SELECT d.document_kind, d.contract_version AS head_contract_version, "
           "d.draft_revision, r.contract_version AS revision_contract_version, "
           "r.document_json, r.created_by, r.created_at "
           "FROM phpretro_presentation_documents d "
           "LEFT JOIN phpretro_presentation_revisions r "
           "ON r.document_key = d.document_key AND r.revision = d.draft_revision "
           "WHERE d.document_key = ? LIMIT 1"
        << documentKey
        >> [documentKey, expectedKind, callback](const drogon::orm::Result& rows) {
               if (rows.empty() || rows[0]["draft_revision"].as<uint32_t>() == 0) {
                   if (callback) callback(serviceFailure(
                       PresentationServiceCode::NotFound, "documentKey",
                       "No presentation draft exists."));
                   return;
               }

               const auto& row = rows[0];
               const uint16_t headVersion = row["head_contract_version"].as<uint16_t>();
               const std::string storedKind = row["document_kind"].as<std::string>();
               if (storedKind != kindName(*expectedKind) ||
                   row["revision_contract_version"].isNull()) {
                   if (callback) callback(serviceFailure(
                       PresentationServiceCode::Unavailable, "",
                       "Presentation storage contains an inconsistent document."));
                   return;
               }

               const uint16_t revisionVersion =
                   row["revision_contract_version"].as<uint16_t>();
               if (headVersion != kPresentationContractVersion ||
                   revisionVersion != kPresentationContractVersion) {
                   if (callback) callback(serviceFailure(
                       PresentationServiceCode::UnsupportedVersion, "contractVersion",
                       "This presentation document uses an unsupported contract version."));
                   return;
               }

               const uint32_t revision = row["draft_revision"].as<uint32_t>();
               const std::string encoded = row["document_json"].as<std::string>();
               Json::CharReaderBuilder reader;
               Json::Value contents;
               std::string parseError;
               std::istringstream stream(encoded);
               if (!Json::parseFromStream(reader, stream, &contents, &parseError)) {
                   HOTEL_LOG_ERROR("PresentationService::loadDraft invalid JSON for '{}': {}",
                                   documentKey, parseError);
                   if (callback) callback(serviceFailure(
                       PresentationServiceCode::Unavailable, "",
                       "Presentation storage contains an invalid document."));
                   return;
               }

               const auto validation = PresentationService::validateDocumentForKey(
                   documentKey, contents);
               if (!validation.ok || !contents["revision"].isUInt() ||
                   contents["revision"].asUInt() != revision) {
                   HOTEL_LOG_ERROR("PresentationService::loadDraft failed stored document validation for '{}'",
                                   documentKey);
                   if (callback) callback(serviceFailure(
                       PresentationServiceCode::Unavailable, "",
                       "Presentation storage contains an invalid document."));
                   return;
               }

               PresentationStoredDocument stored;
               stored.document_key = documentKey;
               stored.kind = *expectedKind;
               stored.contract_version = headVersion;
               stored.revision = revision;
               stored.contents = std::move(contents);
               stored.created_by = row["created_by"].as<uint32_t>();
               stored.created_at = row["created_at"].as<uint64_t>();

               PresentationServiceResult result;
               result.ok = true;
               result.code = PresentationServiceCode::None;
               result.revision = revision;
               result.document = std::move(stored);
               if (callback) callback(std::move(result));
           }
        >> [documentKey, callback](const drogon::orm::DrogonDbException& e) {
               HOTEL_LOG_ERROR("PresentationService::loadDraft '{}': {}",
                               documentKey, e.base().what());
               if (callback) callback(serviceFailure(
                   PresentationServiceCode::Unavailable, "",
                   "Presentation storage is unavailable."));
           };
}

void PresentationService::saveDraft(
    uint32_t actorId,
    const std::string& documentKey,
    uint32_t expectedRevision,
    const Json::Value& document,
    const std::string& ipAddress,
    std::function<void(PresentationServiceResult)> callback) {
    saveDraft(drogon::app().getDbClient("default"), actorId, documentKey,
              expectedRevision, document, ipAddress, std::move(callback));
}

void PresentationService::saveDraft(
    const drogon::orm::DbClientPtr& db,
    uint32_t actorId,
    const std::string& documentKey,
    uint32_t expectedRevision,
    const Json::Value& document,
    const std::string& ipAddress,
    std::function<void(PresentationServiceResult)> callback) {
    const auto kind = kindForDocumentKey(documentKey);
    if (!kind.has_value()) {
        if (callback) callback(serviceFailure(
            PresentationServiceCode::InvalidInput, "documentKey",
            "presentation document key is not supported"));
        return;
    }
    if (actorId == 0 || actorId > static_cast<uint32_t>(std::numeric_limits<int32_t>::max())) {
        if (callback) callback(serviceFailure(
            PresentationServiceCode::InvalidInput, "actorId",
            "a valid staff actor is required"));
        return;
    }
    if (expectedRevision >= kMaxPresentationRevision) {
        if (callback) callback(serviceFailure(
            PresentationServiceCode::InvalidInput, "expectedRevision",
            "the presentation revision is outside the supported range"));
        return;
    }
    if (!document.isObject()) {
        if (callback) callback(serviceFailure(
            PresentationServiceCode::InvalidInput, "document",
            "the presentation document must be an object"));
        return;
    }

    const uint32_t nextRevision = expectedRevision + 1;
    Json::Value normalized = document;
    normalized["revision"] = nextRevision;
    const auto validation = validateDocumentForKey(documentKey, normalized);
    if (!validation.ok) {
        if (callback) callback(serviceFailure(
            PresentationServiceCode::InvalidInput, validation.field,
            validation.message));
        return;
    }

    Json::StreamWriterBuilder writer;
    writer["indentation"] = "";
    const std::string encoded = Json::writeString(writer, normalized);
    if (encoded.size() > kMaxSerializedDocumentBytes) {
        if (callback) callback(serviceFailure(
            PresentationServiceCode::InvalidInput, "document",
            "the presentation document is too large"));
        return;
    }

    if (!db) {
        if (callback) callback(serviceFailure(
            PresentationServiceCode::Unavailable, "",
            "Presentation storage is unavailable."));
        return;
    }

    const auto now = static_cast<uint64_t>(std::time(nullptr));
    auto transaction = std::make_shared<DraftSaveTransaction>(
        db, actorId, documentKey, *kind, expectedRevision, nextRevision,
        encoded, ipAddress, now, std::move(callback));
    // For a first save the new head, revision and audit are all in the same
    // transaction. The document_key primary key makes a concurrent create
    // resolve as a conflict instead of creating two initial drafts.
    transaction->start();
}

void PresentationService::ensureSchema(
    const drogon::orm::DbClientPtr& db,
    std::function<void()> onComplete) {
    if (!db) {
        HOTEL_LOG_WARN("PresentationService::ensureSchema called without a DbClient");
        // Startup uses this callback to proceed to seeding and mark readiness.
        // A missing database client must leave the process unready.
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
    const std::weak_ptr<std::function<void(std::size_t)>> weakStep = step;
    *step = [db, weakStep, onComplete](std::size_t index) {
        if (index >= kStatements.size()) {
            if (onComplete) onComplete();
            return;
        }

        const auto keepAlive = weakStep.lock();
        if (!keepAlive) return;
        *db << kStatements[index]
            >> [keepAlive, index](const drogon::orm::Result&) {
                   (*keepAlive)(index + 1);
               }
            >> [index](const drogon::orm::DrogonDbException& e) {
                   HOTEL_LOG_ERROR("PresentationService schema statement {}: {}",
                                   index, e.base().what());
                   // Do not signal bootstrap completion after a failed DDL.
                   // Readiness is the guard against serving with a partial schema.
               };
    };
    (*step)(0);
}

}  // namespace hotel::services
