#pragma once

#include "services/PresentationDraftOutcome.h"
#include <cstdint>
#include <functional>
#include <string>

namespace hotel::services {

enum class PresentationDraftOperation { read, save };

/** Pure transaction result classification; does not execute SQL or begin a transaction. */
class PresentationDraftTransaction {
public:
    static PresentationDraftOutcome classifyRead(bool found);
    static PresentationDraftOutcome classifyCompareAndSwap(bool rowAffected,
                                                            uint32_t currentRevision);
    static PresentationDraftOutcome classifyAudit(bool auditSucceeded);
    static PresentationDraftOutcome classifyTransaction(bool committed);
};

}  // namespace hotel::services
