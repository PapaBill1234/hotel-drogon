#include "services/PresentationDraftOutcome.h"

#include <utility>

namespace hotel::services {

PresentationDraftOutcome PresentationDraftOutcome::success() {
    return {true, PresentationDraftError::none, 0, {}};
}

PresentationDraftOutcome PresentationDraftOutcome::failure(PresentationDraftError error,
                                                            std::string message,
                                                            uint32_t currentRevision) {
    return {false, error, currentRevision, std::move(message)};
}

int PresentationDraftOutcome::statusCode() const {
    if (ok) return 200;
    switch (error) {
        case PresentationDraftError::invalid_request: return 400;
        case PresentationDraftError::unauthorized: return 401;
        case PresentationDraftError::forbidden: return 403;
        case PresentationDraftError::not_found: return 404;
        case PresentationDraftError::conflict: return 409;
        case PresentationDraftError::unavailable: return 503;
        case PresentationDraftError::none: return 200;
    }
    return 503;
}

}  // namespace hotel::services
