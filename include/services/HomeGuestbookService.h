#pragma once

#include <drogon/orm/DbClient.h>

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace hotel::services {

enum class HomeGuestbookCode {
    None,
    InvalidInput,
    Unavailable,
};

struct HomeGuestbookEntry {
    uint32_t id = 0;
    uint32_t profile_user_id = 0;
    uint32_t author_user_id = 0;
    std::string message;
    uint32_t created_at = 0;
    std::string username;
    std::string look;
    std::string online;
};

struct HomeGuestbookResult {
    HomeGuestbookCode code = HomeGuestbookCode::Unavailable;
    std::string message;
    std::vector<HomeGuestbookEntry> entries;

    bool ok() const { return code == HomeGuestbookCode::None; }
};

/** Read-only public personal guestbook rows; messages remain plain JSON text. */
class HomeGuestbookService {
public:
    static constexpr uint32_t kMaxEntries = 50;

    static bool validProfileId(int64_t profileId);
    static bool parseProfileId(const std::string& value, int64_t& profileId);

    static void getEntries(
        const drogon::orm::DbClientPtr& db,
        const std::string& profileId,
        std::function<void(HomeGuestbookResult)> callback);
};

}  // namespace hotel::services
