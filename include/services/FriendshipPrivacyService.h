#pragma once

#include <drogon/orm/DbClient.h>

#include <cstdint>
#include <functional>
#include <string>

namespace hotel::services {

enum class FriendshipPrivacyCode {
    Allowed,
    Forbidden,
    InvalidInput,
    Unavailable,
};

struct FriendshipPrivacyResult {
    FriendshipPrivacyCode code = FriendshipPrivacyCode::Unavailable;
    bool friends = false;
    bool private_home = false;
    std::string message;

    bool allowed() const { return code == FriendshipPrivacyCode::Allowed; }
};

/**
 * Read-only personal guestbook privacy boundary.
 *
 * Friendship rows belong to PolarIS and are only read through this named
 * method. Personal/group ownership and all mutations remain outside this
 * prerequisite; this service answers only whether a viewer may post to a
 * personal public/private guestbook according to the verified legacy rule.
 */
class FriendshipPrivacyService {
public:
    static bool privatePostAllowed(uint32_t profileOwnerId,
                                   uint32_t actorId,
                                   bool privateHome,
                                   bool friends);

    static void canPostPersonalGuestbook(
        const drogon::orm::DbClientPtr& db,
        uint32_t profileOwnerId,
        uint32_t actorId,
        bool privateHome,
        std::function<void(FriendshipPrivacyResult)> callback);
};

}  // namespace hotel::services
