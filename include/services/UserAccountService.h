#pragma once

#include <string>
#include <optional>
#include <cstdint>
#include <functional>
#include <drogon/drogon.h>

namespace hotel::services {

struct UserRecord {
    uint32_t id = 0;
    std::string username;
    std::string real_name;
    std::string mail;
    bool mail_verified = false;
    uint32_t rank = 1;
    int32_t credits = 0;
    int32_t pixels = 0;
    int32_t points = 0;
    std::string look;
    std::string gender = "M";
    std::string motto;
    std::string online = "0";
    uint64_t account_created = 0;
    uint64_t last_login = 0;
    std::string ip_current;
    std::string auth_ticket;
};

struct AuthResult {
    bool success = false;
    int errorCode = 0; // 0=ok, 1=missing input, 2=invalid credentials, 3=banned, 4=system error
    std::string errorMessage;
    std::optional<UserRecord> user;
    std::string banReason;
    std::string banExpires;
};

class UserAccountService {
public:
    static void findById(
        uint32_t userId,
        std::function<void(std::optional<UserRecord>)> callback
    );

    static void findByUsername(
        const std::string& username,
        std::function<void(std::optional<UserRecord>)> callback
    );

    static void authenticate(
        const std::string& username,
        const std::string& password,
        const std::string& ipAddress,
        std::function<void(AuthResult)> callback
    );

    static void updateMotto(
        uint32_t userId,
        const std::string& newMotto,
        const std::string& ipAddress,
        std::function<void(bool success, const std::string& error)> callback
    );

    static void updateLook(
        uint32_t userId,
        const std::string& newLook,
        const std::string& newGender,
        const std::string& ipAddress,
        std::function<void(bool success, const std::string& error)> callback
    );

    static void updateEmail(
        uint32_t userId,
        const std::string& newEmail,
        const std::string& ipAddress,
        std::function<void(bool success, const std::string& error)> callback
    );

    static void changePassword(
        uint32_t userId,
        const std::string& newPassword,
        const std::string& ipAddress,
        std::function<void(bool success, const std::string& error)> callback
    );

    static void setRememberToken(
        uint32_t userId,
        const std::string& tokenHash,
        uint64_t expiresAt,
        std::function<void(bool success)> callback
    );

    /**
     * Store the client SSO ticket on the user's row — `users.auth_ticket`.
     *
     * That is the column PolarIS defines, and the only one this writes. The
     * legacy website generated the ticket (`GenerateTicket("sso")`), stored it
     * there, and handed it to the client as
     * `use.sso.ticket=1;sso.ticket=<ticket>`.
     *
     * An earlier revision of this method also wrote `auth_ticket_expires_at`.
     * That column does not exist in PolarIS — `references/schema/CleanDB.sql`
     * declares only `auth_ticket varchar(256)` — so the write would have failed
     * against a real PolarIS database. The parameter was never read by anything
     * (the method had no callers), so it is removed rather than left inert.
     */
    static void generateAuthTicket(
        uint32_t userId,
        const std::string& ticket,
        const std::string& ipAddress,
        std::function<void(bool success)> callback
    );
};

} // namespace hotel::services
