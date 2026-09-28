#pragma once

#include <cstdint>
#include <string>

namespace hotel::services {

/** Formats bounded, non-secret audit detail for a named draft document. */
class PresentationDraftAudit {
public:
    static std::string detail(const std::string& documentKind,
                              const std::string& documentKey,
                              uint32_t revision);
};

}  // namespace hotel::services
