#pragma once

#include <cstdint>
#include <string>

namespace hotel::services {

enum class PresentationDraftError {
    none,
    invalid_request,
    unauthorized,
    forbidden,
    not_found,
    conflict,
    unavailable,
};

struct PresentationDraftOutcome {
    bool ok = false;
    PresentationDraftError error = PresentationDraftError::invalid_request;
    uint32_t current_revision = 0;
    std::string message;

    static PresentationDraftOutcome success();
    static PresentationDraftOutcome failure(PresentationDraftError error,
                                            std::string message = {},
                                            uint32_t currentRevision = 0);

    /** HTTP mapping used by a future named draft endpoint. */
    int statusCode() const;
};

}  // namespace hotel::services
