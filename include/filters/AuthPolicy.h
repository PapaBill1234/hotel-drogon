#pragma once

#include <drogon/drogon.h>
#include <functional>
#include <string>
#include <optional>
#include "services/SessionManager.h"
#include "services/GuildService.h"

namespace hotel::filters {

enum class UserRole {
    Visitor = 0,
    User = 1,
    GroupMember = 2,
    GroupAdmin = 3,
    GroupOwner = 4,
    Staff = 5
};

// Rank required for the high-trust capability. This is deliberately a separate
// capability from ordinary staff access: writing raw HTML/script content
// (banner markup, tracking snippets) is not the same kind of action as editing
// a news headline, and the plan requires it be permission-gated explicitly.
// Rank 7 = administrator.
constexpr uint32_t kHighTrustMinRank = 7;

class AuthPolicy {
public:
    static void requireUser(
        const drogon::HttpRequestPtr& req,
        std::function<void(const services::UserSessionData& session)> onSuccess,
        std::function<void(const drogon::HttpResponsePtr& resp)> onDenied
    );

    static void requireStaff(
        const drogon::HttpRequestPtr& req,
        uint32_t minRank,
        std::function<void(const services::StaffSessionData& session)> onSuccess,
        std::function<void(const drogon::HttpResponsePtr& resp)> onDenied
    );

    // High-trust capability: raw-HTML/script content. Denial is reported
    // distinctly (403 + high_trust_required) so the caller does not mistake a
    // missing capability for a missing session.
    static void requireHighTrust(
        const drogon::HttpRequestPtr& req,
        std::function<void(const services::StaffSessionData& session)> onSuccess,
        std::function<void(const drogon::HttpResponsePtr& resp)> onDenied
    );

    static void requireGroupOwner(
        const drogon::HttpRequestPtr& req,
        uint32_t guildId,
        std::function<void(const services::UserSessionData& session, const services::GuildRecord& guild)> onSuccess,
        std::function<void(const drogon::HttpResponsePtr& resp)> onDenied
    );

    static void requireGroupAdmin(
        const drogon::HttpRequestPtr& req,
        uint32_t guildId,
        std::function<void(const services::UserSessionData& session, const services::GuildRecord& guild)> onSuccess,
        std::function<void(const drogon::HttpResponsePtr& resp)> onDenied
    );
};

} // namespace hotel::filters
