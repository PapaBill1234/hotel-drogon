#include "services/PresentationDraftAdmission.h"

namespace hotel::services {
namespace {
PresentationDraftOutcome invalid(const PresentationValidationResult& result) {
    return PresentationDraftOutcome::failure(PresentationDraftError::invalid_request,
                                             result.field + ": " + result.message);
}
}

PresentationDraftOutcome PresentationDraftAdmission::validateSave(uint32_t actorId,
                                                                  uint32_t staffRank,
                                                                  bool twoFactorVerified,
                                                                  const Json::Value& request,
                                                                  const std::string& auditDetail) {
    const auto access = PresentationDraftAccess::authorize(actorId, staffRank, twoFactorVerified);
    if (!access.ok) return access;

    const auto contract = PresentationDraftContract::validateRequest(request);
    if (!contract.ok) return invalid(contract);

    const auto size = PresentationDraftPolicy::validatePayloadSize(request["payload"]);
    if (!size.ok) return invalid(size);

    if (!PresentationDraftPolicy::validAuditDetail(auditDetail)) {
        return PresentationDraftOutcome::failure(PresentationDraftError::invalid_request,
                                                 "audit detail is invalid.");
    }
    return PresentationDraftOutcome::success();
}

}  // namespace hotel::services
