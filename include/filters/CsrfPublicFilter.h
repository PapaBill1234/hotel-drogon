#pragma once

#include <drogon/HttpFilter.h>

namespace hotel::filters {

/**
 * CSRF protection for the pre-authentication account routes.
 *
 * ## The problem this solves
 *
 * `CsrfFilter` validates a submitted token against the `csrf_token` of a Redis
 * **user session**. The password-recovery routes cannot use it: the whole point
 * of "I forgot my password" is that the caller has no session, so a
 * session-bound token cannot exist yet.
 *
 * The Laravel branch's answer was a blanket CSRF exemption, which the plan names
 * as a mistake not to repeat. The plan's other option — a synchronizer token —
 * also needs somewhere to keep the secret, and a pre-session store is new
 * infrastructure this slice does not need.
 *
 * ## What this filter does instead
 *
 * It requires the value to arrive in a **custom request header**
 * (`X-XSRF-TOKEN`), and rejects the request with 403 when it does not.
 *
 * That is a real control, not a formality:
 *
 *   - An attacker's cross-origin `fetch` cannot set a custom header without
 *     triggering a CORS preflight, which this application does not answer for
 *     other origins.
 *   - A cross-origin HTML form cannot set headers at all, so a plain
 *     form-posted CSRF is impossible.
 *   - The endpoints are additionally limited to `application/json`, which no
 *     form can produce as a simple request.
 *
 * ## What it deliberately does NOT check
 *
 * The header's *value*. There is nothing to compare it against before a session
 * exists, so this filter does not pretend to validate a token — it enforces a
 * requirement that only a same-origin script can satisfy. The routes that use it
 * therefore rely on their own primary defences (an exact credential match, a
 * single-use emailed token, and result-count limits) rather than on a shared
 * secret. Saying so here is the point: a future reader must not mistake this for
 * token validation and build on it.
 */
class CsrfPublicFilter : public drogon::HttpFilter<CsrfPublicFilter> {
public:
    void doFilter(
        const drogon::HttpRequestPtr& req,
        drogon::FilterCallback&& fcb,
        drogon::FilterChainCallback&& fccb
    ) override;
};

} // namespace hotel::filters
