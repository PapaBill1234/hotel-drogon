#include "services/PresentationDraftAccess.h"

namespace hotel::services {

PresentationDraftOutcome PresentationDraftAccess::authorize(uint32_t actorId,
                                                            uint32_t staffRank,
                                                            bool twoFactorVerified) {
    if (actorId == 0) {
        return PresentationDraftOutcome::failure(PresentationDraftError::unauthorized,
                                                 "Staff identity is required.");
    }
    if (staffRank < kMinimumStaffRank) {
        return PresentationDraftOutcome::failure(PresentationDraftError::forbidden,
                                                 "Insufficient staff permissions.");
    }
    if (!twoFactorVerified) {
        return PresentationDraftOutcome::failure(PresentationDraftError::forbidden,
                                                 "Staff 2FA step-up required.");
    }
    return PresentationDraftOutcome::success();
}

}  // namespace hotel::services
