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

    // --- password reset ------------------------------------------------

    /**
     * Find the account a reset request may act on.
     *
     * The lookup is legacy `forgot.php`'s own, condition for condition:
     *
     *   SELECT id, username, mail FROM users
     *   WHERE username = ? AND mail = ? AND mail_verified = '1' LIMIT 1
     *
     * Both values must match exactly and the address must be verified. No
     * variant of this query matches on one field only, and none returns a row
     * for an unverified address, because that is what the legacy site required
     * before it would touch a password.
     */
    static void findByUsernameAndVerifiedMail(
        const std::string& username,
        const std::string& mail,
        std::function<void(std::optional<UserRecord>)> callback
    );

    /**
     * All account names registered to an address — legacy's `actionList`.
     *
     * `SELECT username FROM users WHERE mail = ? ORDER BY username ASC`. The
     * legacy page did not require the address to be verified for this one, and
     * neither does this: it discloses only names the requester already has the
     * address for, and it is the documented recovery path for a forgotten
     * username.
     */
    static void listUsernamesForMail(
        const std::string& mail,
        std::function<void(std::vector<std::string>)> callback
    );

    /**
     * Issue a single-use password-reset token for an account.
     *
     * ## Why Redis and not a column
     *
     * The token is stored **only** as a SHA-256 hash, under
     * `password_reset:<hash>`, with a TTL. There is no PolarIS column for a reset
     * token — `CleanDB.sql` has `remember_token_hash`/`remember_token_expires_at`
     * and nothing else — and plan rule 1 forbids adding a column to a
     * PolarIS-owned table for convenience, while rule 6 forbids inventing one.
     * Redis is already in the stack for sessions and is the right home for a
     * short-lived single-use secret.
     *
     * Storing the hash rather than the token means a Redis dump does not contain
     * a usable credential. The raw token is returned once, to the caller, and
     * never persisted.
     */
    static void issuePasswordResetToken(
        uint32_t userId,
        std::function<void(bool success, const std::string& token, uint32_t ttlSeconds)>
            callback
    );

    /** How long an issued reset token stays valid. */
    static uint32_t passwordResetTtlSeconds();

    /**
     * Consume a reset token and set a new password.
     *
     * Single use is enforced by deleting the key before the password is written:
     * a token presented twice fails the second time even if the first attempt
     * failed afterwards. An unknown, expired or already-used token is reported
     * as `invalidToken`, which is deliberately the same answer in all three
     * cases — the caller cannot distinguish them and so cannot probe for which
     * tokens exist.
     *
     * On success the password is rehashed with the current scheme, the token is
     * gone, and the action is audited.
     */
    static void consumePasswordResetToken(
        const std::string& token,
        const std::string& newPassword,
        const std::string& ipAddress,
        std::function<void(bool success, bool invalidToken, const std::string& error)>
            callback
    );
};

} // namespace hotel::services
