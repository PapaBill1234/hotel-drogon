#include "filters/AuthPolicy.h"
#include "services/GuildService.h"
#include <json/json.h>

using Json::Value;

namespace hotel::filters {

static drogon::HttpResponsePtr makeErrorResponse(drogon::HttpStatusCode status, const std::string& error, const std::string& message) {
    Value val;
    val["error"] = error;
    val["message"] = message;
    val["status"] = static_cast<int>(status);
    auto resp = drogon::HttpResponse::newHttpJsonResponse(val);
    resp->setStatusCode(status);
    return resp;
}

void AuthPolicy::requireUser(
    const drogon::HttpRequestPtr& req,
    std::function<void(const services::UserSessionData& session)> onSuccess,
    std::function<void(const drogon::HttpResponsePtr& resp)> onDenied
) {
    if (req->attributes()->find("user_session")) {
        const auto& s = req->attributes()->get<services::UserSessionData>("user_session");
        onSuccess(s);
        return;
    }

    std::string token = req->getCookie(services::SessionManager::USER_COOKIE_NAME);
    if (token.empty()) {
        onDenied(makeErrorResponse(drogon::k401Unauthorized, "Unauthorized", "Authentication required."));
        return;
    }

    services::SessionManager::getUserSession(
        token,
        [req, onSuccess, onDenied](std::optional<services::UserSessionData> session) {
            if (!session.has_value()) {
                onDenied(makeErrorResponse(drogon::k401Unauthorized, "Unauthorized", "Invalid or expired session."));
                return;
            }
            req->attributes()->insert("user_session", *session);
            onSuccess(*session);
        }
    );
}

void AuthPolicy::requireStaff(
    const drogon::HttpRequestPtr& req,
    uint32_t minRank,
    std::function<void(const services::StaffSessionData& session)> onSuccess,
    std::function<void(const drogon::HttpResponsePtr& resp)> onDenied
) {
    std::string token = req->getCookie(services::SessionManager::STAFF_COOKIE_NAME);
    if (token.empty()) {
        onDenied(makeErrorResponse(drogon::k403Forbidden, "Forbidden", "Staff session required."));
        return;
    }

    services::SessionManager::getStaffSession(
        token,
        [minRank, onSuccess, onDenied](std::optional<services::StaffSessionData> session) {
            if (!session.has_value()) {
                onDenied(makeErrorResponse(drogon::k403Forbidden, "Forbidden", "Invalid or expired staff session."));
                return;
            }

            if (session->rank < minRank) {
                onDenied(makeErrorResponse(drogon::k403Forbidden, "Forbidden", "Insufficient staff permissions."));
                return;
            }

            if (!session->is_2fa_verified) {
                onDenied(makeErrorResponse(drogon::k403Forbidden, "Forbidden", "Staff 2FA step-up required."));
                return;
            }

            onSuccess(*session);
        }
    );
}

void AuthPolicy::requireGroupOwner(
    const drogon::HttpRequestPtr& req,
    uint32_t guildId,
    std::function<void(const services::UserSessionData& session, const services::GuildRecord& guild)> onSuccess,
    std::function<void(const drogon::HttpResponsePtr& resp)> onDenied
) {
    requireUser(
        req,
        [guildId, onSuccess, onDenied](const services::UserSessionData& session) {
            services::GuildService::findById(guildId, [session, onSuccess, onDenied](std::optional<services::GuildRecord> guild) {
                if (!guild.has_value()) {
                    onDenied(makeErrorResponse(drogon::k404NotFound, "Not Found", "Guild does not exist."));
                    return;
                }

                if (guild->user_id != session.user_id && session.rank < 6) {
                    onDenied(makeErrorResponse(drogon::k403Forbidden, "Forbidden", "Only group owner may perform this action."));
                    return;
                }

                onSuccess(session, *guild);
            });
        },
        onDenied
    );
}

void AuthPolicy::requireGroupAdmin(
    const drogon::HttpRequestPtr& req,
    uint32_t guildId,
    std::function<void(const services::UserSessionData& session, const services::GuildRecord& guild)> onSuccess,
    std::function<void(const drogon::HttpResponsePtr& resp)> onDenied
) {
    requireUser(
        req,
        [guildId, onSuccess, onDenied](const services::UserSessionData& session) {
            services::GuildService::findById(guildId, [session, guildId, onSuccess, onDenied](std::optional<services::GuildRecord> guild) {
                if (!guild.has_value()) {
                    onDenied(makeErrorResponse(drogon::k404NotFound, "Not Found", "Guild does not exist."));
                    return;
                }

                if (guild->user_id == session.user_id || session.rank >= 6) {
                    onSuccess(session, *guild);
                    return;
                }

                services::GuildService::getMember(guildId, session.user_id, [session, guild = *guild, onSuccess, onDenied](std::optional<services::GuildMemberRecord> member) {
                    if (member.has_value() && member->rank_level >= 1) {
                        onSuccess(session, guild);
                    } else {
                        onDenied(makeErrorResponse(drogon::k403Forbidden, "Forbidden", "Group administrator rights required."));
                    }
                });
            });
        },
        onDenied
    );
}

} // namespace hotel::filters
