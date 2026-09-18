#pragma once

#include <drogon/HttpFilter.h>
#include <string>

namespace hotel::filters {

class CsrfFilter : public drogon::HttpFilter<CsrfFilter> {
public:
    CsrfFilter() = default;
    void doFilter(
        const drogon::HttpRequestPtr& req,
        drogon::FilterCallback&& fcb,
        drogon::FilterChainCallback&& fccb
    ) override;
};

} // namespace hotel::filters
