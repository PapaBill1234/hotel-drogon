#include "controllers/AccountController.h"
#include "services/UserAccountService.h"
#include "filters/AuthPolicy.h"
#include "utils/Logger.h"
#include <json/json.h>

using Json::Value;

namespace hotel::controllers {

void AccountController::updateMotto(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    filters::AuthPolicy::requireUser(
        req,
        [req, callback](const services::UserSessionData& session) {
            auto json = req->getJsonObject();
            if (!json || !json->isMember("motto") || !(*json)["motto"].isString()) {
                Value err;
                err["error"] = "Bad Request";
                err["message"] = "Field 'motto' is required.";
                err["status"] = 400;
                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                resp->setStatusCode(drogon::k400BadRequest);
                callback(resp);
                return;
            }

            std::string newMotto = (*json)["motto"].asString();
            if (newMotto.length() > 128) {
                newMotto = newMotto.substr(0, 128);
            }

            std::string ip = req->peerAddr().toIp();
            services::UserAccountService::updateMotto(
                session.user_id,
                newMotto,
                ip,
                [newMotto, callback](bool success, const std::string& error) {
                    if (!success) {
                        Value err;
                        err["error"] = "Update Failed";
                        err["message"] = error;
                        err["status"] = 400;
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                        resp->setStatusCode(drogon::k400BadRequest);
                        callback(resp);
                        return;
                    }

                    Value root;
                    root["status"] = "ok";
                    root["motto"] = newMotto;
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

void AccountController::updateLook(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    filters::AuthPolicy::requireUser(
        req,
        [req, callback](const services::UserSessionData& session) {
            auto json = req->getJsonObject();
            if (!json || !json->isMember("look") || !(*json)["look"].isString()) {
                Value err;
                err["error"] = "Bad Request";
                err["message"] = "Field 'look' is required.";
                err["status"] = 400;
                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                resp->setStatusCode(drogon::k400BadRequest);
                callback(resp);
                return;
            }

            std::string newLook = (*json)["look"].asString();
            std::string newGender = (json->isMember("gender") && (*json)["gender"].isString()) ? (*json)["gender"].asString() : "M";
            if (newGender != "M" && newGender != "F") {
                newGender = "M";
            }

            std::string ip = req->peerAddr().toIp();
            services::UserAccountService::updateLook(
                session.user_id,
                newLook,
                newGender,
                ip,
                [newLook, newGender, callback](bool success, const std::string& error) {
                    if (!success) {
                        Value err;
                        err["error"] = "Update Failed";
                        err["message"] = error;
                        err["status"] = 400;
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                        resp->setStatusCode(drogon::k400BadRequest);
                        callback(resp);
                        return;
                    }

                    Value root;
                    root["status"] = "ok";
                    root["look"] = newLook;
                    root["gender"] = newGender;
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

void AccountController::updateEmail(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    filters::AuthPolicy::requireUser(
        req,
        [req, callback](const services::UserSessionData& session) {
            auto json = req->getJsonObject();
            if (!json || !json->isMember("email") || !(*json)["email"].isString()) {
                Value err;
                err["error"] = "Bad Request";
                err["message"] = "Field 'email' is required.";
                err["status"] = 400;
                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                resp->setStatusCode(drogon::k400BadRequest);
                callback(resp);
                return;
            }

            std::string newEmail = (*json)["email"].asString();
            if (newEmail.find('@') == std::string::npos) {
                Value err;
                err["error"] = "Bad Request";
                err["message"] = "Invalid email format.";
                err["status"] = 400;
                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                resp->setStatusCode(drogon::k400BadRequest);
                callback(resp);
                return;
            }

            std::string ip = req->peerAddr().toIp();
            services::UserAccountService::updateEmail(
                session.user_id,
                newEmail,
                ip,
                [newEmail, callback](bool success, const std::string& error) {
                    if (!success) {
                        Value err;
                        err["error"] = "Update Failed";
                        err["message"] = error;
                        err["status"] = 400;
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                        resp->setStatusCode(drogon::k400BadRequest);
                        callback(resp);
                        return;
                    }

                    Value root;
                    root["status"] = "ok";
                    root["email"] = newEmail;
                    root["mail_verified"] = false;
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

void AccountController::changePassword(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback
) {
    filters::AuthPolicy::requireUser(
        req,
        [req, callback](const services::UserSessionData& session) {
            auto json = req->getJsonObject();
            if (!json || !json->isMember("current_password") || !json->isMember("new_password")) {
                Value err;
                err["error"] = "Bad Request";
                err["message"] = "Current password and new password are required.";
                err["status"] = 400;
                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                resp->setStatusCode(drogon::k400BadRequest);
                callback(resp);
                return;
            }

            std::string currentPass = (*json)["current_password"].asString();
            std::string newPass = (*json)["new_password"].asString();

            if (newPass.length() < 6) {
                Value err;
                err["error"] = "Bad Request";
                err["message"] = "New password must be at least 6 characters.";
                err["status"] = 400;
                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                resp->setStatusCode(drogon::k400BadRequest);
                callback(resp);
                return;
            }

            std::string ip = req->peerAddr().toIp();

            services::UserAccountService::authenticate(
                session.username,
                currentPass,
                ip,
                [session, newPass, ip, callback](services::AuthResult authResult) {
                    if (!authResult.success) {
                        Value err;
                        err["error"] = "Unauthorized";
                        err["message"] = "Current password does not match.";
                        err["status"] = 401;
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                        resp->setStatusCode(drogon::k401Unauthorized);
                        callback(resp);
                        return;
                    }

                    services::UserAccountService::changePassword(
                        session.user_id,
                        newPass,
                        ip,
                        [callback](bool success, const std::string& error) {
                            if (!success) {
                                Value err;
                                err["error"] = "Update Failed";
                                err["message"] = error;
                                err["status"] = 400;
                                auto resp = drogon::HttpResponse::newHttpJsonResponse(err);
                                resp->setStatusCode(drogon::k400BadRequest);
                                callback(resp);
                                return;
                            }

                            Value root;
                            root["status"] = "ok";
                            root["message"] = "Password successfully changed.";
                            auto resp = drogon::HttpResponse::newHttpJsonResponse(root);
                            resp->setStatusCode(drogon::k200OK);
                            callback(resp);
                        }
                    );
                }
            );
        },
        [callback](const drogon::HttpResponsePtr& denied) {
            callback(denied);
        }
    );
}

} // namespace hotel::controllers
