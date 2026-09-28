#include "services/PresentationDraftTransaction.h"

namespace hotel::services {

PresentationDraftOutcome PresentationDraftTransaction::classifyRead(bool found) {
    if (found) return PresentationDraftOutcome::success();
    return PresentationDraftOutcome::failure(PresentationDraftError::not_found, "Draft not found.");
}

PresentationDraftOutcome PresentationDraftTransaction::classifyCompareAndSwap(bool rowAffected,
                                                                               uint32_t currentRevision) {
    if (rowAffected) return PresentationDraftOutcome::success();
    return PresentationDraftOutcome::failure(PresentationDraftError::conflict,
                                             "Draft revision is stale.", currentRevision);
}

PresentationDraftOutcome PresentationDraftTransaction::classifyAudit(bool auditSucceeded) {
    if (auditSucceeded) return PresentationDraftOutcome::success();
    return PresentationDraftOutcome::failure(PresentationDraftError::unavailable,
                                             "Draft audit could not be committed.");
}

PresentationDraftOutcome PresentationDraftTransaction::classifyTransaction(bool committed) {
    if (committed) return PresentationDraftOutcome::success();
    return PresentationDraftOutcome::failure(PresentationDraftError::unavailable,
                                             "Draft transaction did not commit.");
}

}  // namespace hotel::services
