#pragma once

#include "services/PresentationDraftOutcome.h"
#include <drogon/orm/DbClient.h>
#include <json/value.h>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>

namespace hotel::services {

struct PresentationDraftRecord {
    std::string document_kind;
    std::string document_key;
    uint32_t revision = 0;
    Json::Value payload;
    uint32_t updated_by = 0;
    uint64_t updated_at = 0;
};

struct PresentationDraftResult {
    PresentationDraftOutcome outcome;
    std::optional<PresentationDraftRecord> draft;
};

/** Named website-owned draft boundary; no generic table or emulator access. */
class PresentationDraftService {
public:
    using Callback = std::function<void(PresentationDraftResult)>;

    static void readDraft(const drogon::orm::DbClientPtr& db,
                          uint32_t actorId,
                          uint32_t staffRank,
                          bool twoFactorVerified,
                          const std::string& documentKind,
                          const std::string& documentKey,
                          Callback callback);

    /**
     * Save request shape is the validated PresentationDraftContract envelope:
     * document_kind, document_key, based_on and typed payload.
     */
    static void saveDraft(const drogon::orm::DbClientPtr& db,
                          uint32_t actorId,
                          uint32_t staffRank,
                          bool twoFactorVerified,
                          const Json::Value& request,
                          const std::string& actorIp,
                          Callback callback);
};

}  // namespace hotel::services
