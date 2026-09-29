#include "services/FriendshipPrivacyService.h"

#include "utils/Logger.h"

#include <memory>
#include <utility>

namespace hotel::services {
namespace {

FriendshipPrivacyResult result(FriendshipPrivacyCode code,
                               bool friends,
                               bool privateHome,
                               std::string message) {
    FriendshipPrivacyResult value;
    value.code = code;
    value.friends = friends;
    value.private_home = privateHome;
    value.message = std::move(message);
    return value;
}

}  // namespace

bool FriendshipPrivacyService::privatePostAllowed(uint32_t profileOwnerId,
                                                   uint32_t actorId,
                                                   bool privateHome,
                                                   bool friends) {
    if (profileOwnerId == 0 || actorId == 0) return false;
    // Legacy areFriends() treats self as a friend. Preserve that rule here,
    // while keeping the friendship query itself in the named read boundary.
    return !privateHome || profileOwnerId == actorId || friends;
}

void FriendshipPrivacyService::canPostPersonalGuestbook(
    const drogon::orm::DbClientPtr& db,
    uint32_t profileOwnerId,
    uint32_t actorId,
    bool privateHome,
    std::function<void(FriendshipPrivacyResult)> callback) {
    if (!callback) return;
    if (profileOwnerId == 0 || actorId == 0) {
        callback(result(FriendshipPrivacyCode::InvalidInput, false, privateHome,
                        "A signed-in profile is required."));
        return;
    }
    if (!db) {
        callback(result(FriendshipPrivacyCode::Unavailable, false, privateHome,
                        "Friendship privacy could not be checked."));
        return;
    }

    auto resultCallback =
        std::make_shared<std::function<void(FriendshipPrivacyResult)>>(std::move(callback));
    const auto deliver = [resultCallback](FriendshipPrivacyResult value) {
        if (!*resultCallback) return;
        auto callbackOnce = std::move(*resultCallback);
        callbackOnce(std::move(value));
    };

    if (!privateHome) {
        deliver(result(FriendshipPrivacyCode::Allowed, false, false, {}));
        return;
    }
    if (profileOwnerId == actorId) {
        deliver(result(FriendshipPrivacyCode::Allowed, true, true, {}));
        return;
    }

    try {
        *db << "SELECT id FROM messenger_friendships "
               "WHERE user_one_id = ? AND user_two_id = ? LIMIT 1"
            << profileOwnerId << actorId
            >> [deliver](const drogon::orm::Result& rows) {
                   const bool friends = !rows.empty();
                   deliver(result(friends ? FriendshipPrivacyCode::Allowed
                                           : FriendshipPrivacyCode::Forbidden,
                                  friends, true,
                                  friends ? std::string{}
                                          : "Only friends can post to this guestbook."));
               }
            >> [deliver](const drogon::orm::DrogonDbException& error) {
                   HOTEL_LOG_ERROR("FriendshipPrivacyService friendship read: {}",
                                   error.base().what());
                   deliver(result(FriendshipPrivacyCode::Unavailable, false, true,
                                  "Friendship privacy could not be checked."));
               };
    } catch (const std::exception& error) {
        HOTEL_LOG_ERROR("FriendshipPrivacyService: {}", error.what());
        deliver(result(FriendshipPrivacyCode::Unavailable, false, true,
                       "Friendship privacy could not be checked."));
    }
}

}  // namespace hotel::services
