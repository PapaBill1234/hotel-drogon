#include "services/PresentationDraftAudit.h"

#include "services/PresentationDraftPolicy.h"
#include <string>

namespace hotel::services {

std::string PresentationDraftAudit::detail(const std::string& documentKind,
                                           const std::string& documentKey,
                                           uint32_t revision) {
    const std::string result = "draft " + documentKind + " " + documentKey +
                               " revision " + std::to_string(revision);
    if (!PresentationDraftPolicy::validAuditDetail(result)) return {};
    return result;
}

}  // namespace hotel::services
