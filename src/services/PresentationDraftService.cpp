#include "services/PresentationDraftService.h"

#include "services/PresentationDraftAccess.h"
#include "services/PresentationDraftAdmission.h"
#include "services/PresentationDraftAudit.h"
#include "services/PresentationDraftContract.h"
#include "services/PresentationDraftPolicy.h"
#include "services/PresentationDraftTransaction.h"
#include "utils/Logger.h"
#include <chrono>
#include <json/json.h>
#include <memory>

namespace hotel::services {
namespace {

PresentationDraftResult failure(PresentationDraftOutcome outcome) {
    return {std::move(outcome), std::nullopt};
}

PresentationDraftResult unavailable(const std::string& message) {
    return failure(PresentationDraftOutcome::failure(
        PresentationDraftError::unavailable, message));
}

PresentationDraftRecord mapDraft(const drogon::orm::Row& row) {
    PresentationDraftRecord draft;
    draft.document_kind = row["document_kind"].as<std::string>();
    draft.document_key = row["document_key"].as<std::string>();
    draft.revision = row["revision"].as<uint32_t>();
    draft.payload = Json::Value(Json::objectValue);
    Json::CharReaderBuilder builder;
    std::string errors;
    const auto payload = row["payload"].as<std::string>();
    std::unique_ptr<Json::CharReader> reader(builder.newCharReader());
    if (!reader->parse(payload.data(), payload.data() + payload.size(),
                       &draft.payload, &errors)) {
        draft.payload = Json::Value(Json::nullValue);
    }
    draft.updated_by = row["updated_by"].as<uint32_t>();
    draft.updated_at = row["updated_at"].as<uint64_t>();
    return draft;
}

PresentationDraftResult withDraft(PresentationDraftOutcome outcome,
                                  PresentationDraftRecord draft) {
    return {std::move(outcome), std::optional<PresentationDraftRecord>(std::move(draft))};
}

}  // namespace

void PresentationDraftService::readDraft(
    const drogon::orm::DbClientPtr& db,
    uint32_t actorId,
    uint32_t staffRank,
    bool twoFactorVerified,
    const std::string& documentKind,
    const std::string& documentKey,
    Callback callback) {
    const auto access = PresentationDraftAccess::authorize(actorId, staffRank, twoFactorVerified);
    if (!access.ok) {
        callback(failure(access));
        return;
    }
    if (!db) {
        callback(unavailable("Database service unavailable."));
        return;
    }
    if (!PresentationDraftContract::isDocumentKey(documentKind, documentKey)) {
        callback(failure(PresentationDraftOutcome::failure(
            PresentationDraftError::invalid_request,
            "document key is not an allowed website document.")));
        return;
    }

    *db << "SELECT document_kind, document_key, revision, payload, updated_by, updated_at "
           "FROM phpretro_presentation_drafts "
           "WHERE document_kind = ? AND document_key = ? LIMIT 1"
        << documentKind << documentKey
        >> [callback](const drogon::orm::Result& rows) {
               if (rows.empty()) {
                   callback(failure(PresentationDraftTransaction::classifyRead(false)));
                   return;
               }
               callback(withDraft(PresentationDraftTransaction::classifyRead(true), mapDraft(rows[0])));
           }
        >> [callback](const drogon::orm::DrogonDbException& e) {
               HOTEL_LOG_ERROR("PresentationDraftService::readDraft: {}", e.base().what());
               callback(unavailable("Draft could not be read."));
           };
}

void PresentationDraftService::saveDraft(
    const drogon::orm::DbClientPtr& db,
    uint32_t actorId,
    uint32_t staffRank,
    bool twoFactorVerified,
    const Json::Value& request,
    const std::string& actorIp,
    Callback callback) {
    const auto requestKind = request.isMember("document_kind") && request["document_kind"].isString()
                                 ? request["document_kind"].asString() : std::string{};
    const auto requestKey = request.isMember("document_key") && request["document_key"].isString()
                                ? request["document_key"].asString() : std::string{};
    const auto requestRevision = request.isMember("based_on") && request["based_on"].isUInt()
                                     ? request["based_on"].asUInt() : 0U;
    const auto requestDetail = PresentationDraftAudit::detail(requestKind, requestKey, requestRevision);
    const auto admission = PresentationDraftAdmission::validateSave(
        actorId, staffRank, twoFactorVerified, request, requestDetail);
    if (!admission.ok) {
        callback(failure(admission));
        return;
    }
    if (!db) {
        callback(unavailable("Database service unavailable."));
        return;
    }

    const auto kind = request["document_kind"].asString();
    const auto key = request["document_key"].asString();
    const auto basedOn = request["based_on"].asUInt();
    const auto payload = request["payload"].toStyledString();
    const auto now = static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::system_clock::now().time_since_epoch()).count());
    const auto detail = requestDetail;

    // Every terminal answer goes through `finish`, which is guarded by `settled`.
    // This keeps the refusal path and any late transaction callback from answering
    // the caller more than once, matching the callback discipline used elsewhere
    // in the backend.
    auto settled = std::make_shared<bool>(false);
    auto finish = [callback, settled](PresentationDraftResult result) mutable {
        if (*settled) return;
        *settled = true;
        callback(std::move(result));
    };
    std::shared_ptr<drogon::orm::Transaction> transaction;
    try {
        transaction = db->newTransaction(
            [finish](bool committed) mutable {
                if (!committed) {
                    finish(unavailable("Draft transaction could not be committed."));
                    return;
                }
                finish({PresentationDraftOutcome::success(), std::nullopt});
            });
    } catch (const std::exception& e) {
        HOTEL_LOG_ERROR("PresentationDraftService::saveDraft: no transaction: {}", e.what());
        callback(unavailable("Draft transaction could not be started."));
        return;
    }

    // `done` is always the guarded completion wrapper, so a refusal and a late
    // transaction callback cannot both answer.
    auto rollback = [transaction](PresentationDraftResult result, Callback done) {
        auto pending = std::make_shared<PresentationDraftResult>(std::move(result));
        *transaction << "ROLLBACK"
                     >> [pending, done = std::move(done)](const drogon::orm::Result&) mutable {
                            done(std::move(*pending));
                        }
                     >> [pending, done = std::move(done)](
                            const drogon::orm::DrogonDbException&) mutable {
                            done(std::move(*pending));
                        };
    };

    // The CAS is the first transaction statement. No insert-or-update operation is
    // allowed here because the Homes evidence reproduced an InnoDB lock-upgrade
    // deadlock for that ordering.
    *transaction << "UPDATE phpretro_presentation_drafts "
                    "SET revision = revision + 1, payload = ?, updated_by = ?, updated_at = ? "
                    "WHERE document_kind = ? AND document_key = ? AND revision = ?"
                 << payload << actorId << now << kind << key << basedOn
                 >> [transaction, rollback, finish, actorId, actorIp, kind, key, basedOn, detail](
                        const drogon::orm::Result& result) mutable {
                        if (result.affectedRows() != 1) {
                             // Read the winning draft before rollback so conflicts identify
                             // server state rather than echoing the stale client revision.
                             *transaction << "SELECT document_kind, document_key, revision, payload, updated_by, updated_at "
                                             "FROM phpretro_presentation_drafts "
                                             "WHERE document_kind = ? AND document_key = ? LIMIT 1"
                                          << kind << key
                                      >> [rollback, finish](const drogon::orm::Result& rows) mutable {
                                             if (rows.empty()) {
                                                 rollback(failure(PresentationDraftTransaction::classifyRead(false)), finish);
                                                 return;
                                             }
                                             const auto current = mapDraft(rows[0]);
                                             rollback(withDraft(
                                                 PresentationDraftTransaction::classifyCompareAndSwap(
                                                     false, current.revision), current), finish);
                                         }
                                      >> [rollback, finish](const drogon::orm::DrogonDbException& e) mutable {
                                             HOTEL_LOG_ERROR("PresentationDraftService::saveDraft conflict read: {}",
                                                             e.base().what());
                                             rollback(unavailable("Draft conflict could not be read."), finish);
                                         };
                             return;
                         }
                        *transaction << "INSERT INTO phpretro_admin_action_log "
                                        "(admin_id, action_type, target_type, target_id, details, ip, created_at) "
                                        "VALUES (?, ?, ?, 0, ?, ?, UNIX_TIMESTAMP())"
                                     << actorId << "presentation_draft_saved"
                                     << "phpretro_presentation_draft" << detail << actorIp
                                     >> [transaction](const drogon::orm::Result&) {
                                            // The transaction completion callback reports success after commit.
                                        }
                                     >> [rollback, finish](const drogon::orm::DrogonDbException& e) mutable {
                                            HOTEL_LOG_ERROR("PresentationDraftService::saveDraft audit: {}", e.base().what());
                                            rollback(failure(PresentationDraftOutcome::failure(
                                                         PresentationDraftError::unavailable,
                                                         "Draft audit could not be committed.")), finish);
                                        };
                    }
                 >> [rollback, finish](const drogon::orm::DrogonDbException& e) mutable {
                        HOTEL_LOG_ERROR("PresentationDraftService::saveDraft: {}", e.base().what());
                        rollback(failure(PresentationDraftOutcome::failure(
                                     PresentationDraftError::unavailable,
                                     "Draft could not be saved.")), finish);
                    };
}

}  // namespace hotel::services
