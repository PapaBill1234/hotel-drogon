#pragma once

#include <string>
#include <optional>
#include <cstdint>
#include <functional>
#include "services/UserAccountService.h"

namespace hotel::services {

struct UserSessionData {
    std::string token;
    uint32_t user_id = 0;
    std::string username;
    uint32_t rank = 1;
    std::string look;
    std::string motto;
    std::string ip;
    std::string csrf_token;
    uint64_t created_at = 0;
    uint64_t last_active = 0;
};

struct StaffSessionData {
    std::string token;
    uint32_t user_id = 0;
    std::string username;
    uint32_t rank = 5;
    bool is_2fa_verified = false;
    std::string ip;
    uint64_t created_at = 0;
    uint64_t last_active = 0;
};

class SessionManager {
public:
    static constexpr const char* USER_COOKIE_NAME = "hotel_session";
    static constexpr const char* STAFF_COOKIE_NAME = "hotel_staff_session";
    static constexpr const char* CSRF_COOKIE_NAME = "XSRF-TOKEN";
    static constexpr const char* CSRF_HEADER_NAME = "X-XSRF-TOKEN";

    static constexpr uint64_t USER_SESSION_TTL_SEC = 7 * 86400; // 7 days
    static constexpr uint64_t STAFF_SESSION_TTL_SEC = 2 * 3600;  // 2 hours

    // Public user sessions
    static void createUserSession(
        const UserRecord& user,
        const std::string& ip,
        std::function<void(std::optional<UserSessionData>)> callback
    );

    static void getUserSession(
        const std::string& token,
        std::function<void(std::optional<UserSessionData>)> callback
    );

    static void destroyUserSession(
        const std::string& token,
        std::function<void(bool success)> callback
    );

    // Staff sessions (distinct Redis keys and separate cookies)
    static void createStaffSession(
        const UserRecord& user,
        const std::string& ip,
        bool is2faVerified,
        std::function<void(std::optional<StaffSessionData>)> callback
    );

    static void getStaffSession(
        const std::string& token,
        std::function<void(std::optional<StaffSessionData>)> callback
    );

    static void destroyStaffSession(
        const std::string& token,
        std::function<void(bool success)> callback
    );
};

} // namespace hotel::services
