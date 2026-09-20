#include "controllers/StaffTestController.h"
#include "filters/AuthPolicy.h"
#include "services/BanService.h"
#include "utils/Logger.h"
#include <json/json.h>

using Json::Value;

namespace hotel::controllers {

void StaffTestController::testGate(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    filters::AuthPolicy::requireStaff(
        req,
        5,
        [callback](const services::StaffSessionData& session) {
            Value root;
            root["status"] = "ok";
            root["message"] = "Staff gate access granted.";
            root["user_id"] = session.user_id;
            root["username"] = session.username;
            root["rank"] = session.rank;
            root["2fa_verified"] = session.is_2fa_verified;

            auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
            resp->setStatusCode(drogon::k200OK);
            callback(resp);
        },
        [callback](const drogon::HttpResponsePtr& denied) {
            callback(denied);
        }
    );
}

void StaffTestController::session(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    // Deliberately requireStaff(5), the same gate the content endpoints use:
    // reporting a staff session to a caller that does not hold one would turn
    // this into an account-enumeration surface. rank/username are only ever
    // returned for the caller's own session cookie.
    filters::AuthPolicy::requireStaff(
        req,
        5,
        [callback](const services::StaffSessionData& session) {
            Value root;
            root["status"] = "ok";
            root["username"] = session.username;
            root["rank"] = session.rank;
            root["2fa_verified"] = session.is_2fa_verified;
            // Capability mirror of AuthPolicy::requireHighTrust, so the UI can
            // refuse to *offer* a raw-HTML field instead of only being told no
            // after submitting it. The server check remains the authority.
            root["high_trust"] = session.rank >= filters::kHighTrustMinRank;
            callback(drogon::HttpResponse::newHttpJsonResponse(root));
        },
        [callback](const drogon::HttpResponsePtr& denied) { callback(denied); });
}

void StaffTestController::banUser(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    filters::AuthPolicy::requireStaff(
        req,
        5,
        [req, callback](const services::StaffSessionData& session) {
            auto json = req->getJsonObject();
            if (!json || !json->isMember("user_id") || !json->isMember("reason")) {
                Value err;
                err["error"] = "Bad Request";
                err["message"] = "user_id and reason are required.";
                err["status"] = 400;
                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                resp->setStatusCode(drogon::k400BadRequest);
                callback(resp);
                return;
            }

            uint32_t targetId = (*json)["user_id"].asUInt();
            std::string reason = (*json)["reason"].asString();
            uint64_t expire = json->isMember("expire") ? (*json)["expire"].asUInt64() : 0;
            std::string banType = json->isMember("type") ? (*json)["type"].asString() : "account";
            std::string cfhTopic = json->isMember("cfh_topic") ? (*json)["cfh_topic"].asString() : "";
            std::string ip = req->peerAddr().toIp();

            services::BanService::banUser(
                session.user_id,
                targetId,
                reason,
                expire,
                banType,
                cfhTopic,
                ip,
                [targetId, callback](bool success, const std::string& error) {
                    if (!success) {
                        Value err;
                        err["error"] = "Ban Failed";
                        err["message"] = error;
                        err["status"] = 400;
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                        resp->setStatusCode(drogon::k400BadRequest);
                        callback(resp);
                        return;
                    }

                    Value root;
                    root["status"] = "ok";
                    root["message"] = "User successfully banned.";
                    root["target_id"] = targetId;
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
                    resp->setStatusCode(drogon::k200OK);
                    callback(resp);
                }
            );
        },
        [callback](const drogon::HttpResponsePtr& denied) {
            callback(denied);
        }
    );
}

void StaffTestController::revokeBan(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    filters::AuthPolicy::requireStaff(
        req,
        5,
        [req, callback](const services::StaffSessionData& session) {
            auto json = req->getJsonObject();
            if (!json || !json->isMember("user_id")) {
                Value err;
                err["error"] = "Bad Request";
                err["message"] = "user_id is required.";
                err["status"] = 400;
                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                resp->setStatusCode(drogon::k400BadRequest);
                callback(resp);
                return;
            }

            uint32_t targetId = (*json)["user_id"].asUInt();
            std::string ip = req->peerAddr().toIp();

            services::BanService::unbanUser(
                session.user_id,
                targetId,
                ip,
                [targetId, callback](bool success, const std::string& error) {
                    if (!success) {
                        Value err;
                        err["error"] = "Unban Failed";
                        err["message"] = error;
                        err["status"] = 400;
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                        resp->setStatusCode(drogon::k400BadRequest);
                        callback(resp);
                        return;
                    }

                    Value root;
                    root["status"] = "ok";
                    root["message"] = "User ban revoked.";
                    root["target_id"] = targetId;
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
                    resp->setStatusCode(drogon::k200OK);
                    callback(resp);
                }
            );
        },
        [callback](const drogon::HttpResponsePtr& denied) {
            callback(denied);
        }
    );
}

} // namespace hotel::controllers
