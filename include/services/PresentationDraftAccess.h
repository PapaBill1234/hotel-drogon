#pragma once

#include "services/PresentationDraftOutcome.h"
#include <cstdint>

namespace hotel::services {

/** Pure authorization preconditions for future named draft operations. */
class PresentationDraftAccess {
public:
    static constexpr uint32_t kMinimumStaffRank = 5;

    static PresentationDraftOutcome authorize(uint32_t actorId,
                                              uint32_t staffRank,
                                              bool twoFactorVerified);
};

}  // namespace hotel::services
