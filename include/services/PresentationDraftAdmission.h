#pragma once

#include "services/PresentationDraftAccess.h"
#include "services/PresentationDraftContract.h"
#include "services/PresentationDraftPolicy.h"

namespace hotel::services {

/** Pure fail-closed admission checks for a future named draft save operation. */
class PresentationDraftAdmission {
public:
    static PresentationDraftOutcome validateSave(uint32_t actorId,
                                                 uint32_t staffRank,
                                                 bool twoFactorVerified,
                                                 const Json::Value& request,
                                                 const std::string& auditDetail);
};

}  // namespace hotel::services
