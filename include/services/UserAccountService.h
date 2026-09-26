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
     *
     * ## The void this schedules
     *
     * The write is paired with a deadline, recorded in the website-owned
     * `phpretro_sso_tickets` table, at which `voidIssuedAuthTicket` replaces the
     * ticket with a tombstone. Without that, the ticket has no lifetime at all:
     * the pinned emulator matches `users.auth_ticket` at game login **without
     * consulting any expiry** (its own comment says a stale expiry used to block
     * third-party CMSes that only write this column), consumes it, then restores
     * it during its reconnect grace and leaves it on the row after a full
     * disconnect. A ticket taken from browser history would therefore open the
     * account indefinitely.
     *
     * The deadline is recorded **before** the ticket is written, and a failure
     * there fails the whole call: a caller must never receive a credential the
     * website has no plan to void. The record lives in the database rather than in
     * Redis so it survives a cache restart — a ticket whose deadline was lost
     * would be exactly the unbounded credential this exists to prevent.
     *
     * `callback(success, voidAtEpochSeconds)` reports both the write and the
     * deadline it was scheduled for, so the caller can state the window rather
     * than describe it.
     */
    static void generateAuthTicket(
        uint32_t userId,
        const std::string& ticket,
        const std::string& ipAddress,
        std::function<void(bool success, uint64_t voidAtEpochSeconds)> callback
    );

    /** How long an issued SSO ticket stays valid. See `AppConfig`. */
    static uint32_t ssoTicketTtlSeconds();

    /** How often `voidExpiredAuthTickets` runs. See `AppConfig`. */
    static uint32_t ssoTicketSweepSeconds();

    /**
     * Void the user's website-issued ticket now, and close its record.
     *
     * Used for two things, which is why it is named for the ticket rather than
     * for either caller: the sweep acting when the deadline passes, and sign-out,
     * where the user is ending the session and the client credential must end
     * with it.
     *
     * The row is only touched when it still holds the ticket this website issued
     * (or when it is empty, which is the state a consumed ticket leaves behind and
     * the state the emulator's restore would otherwise write into). A ticket
     * rotated in the meantime, or one another issuer wrote, is left alone. No
     * recorded ticket means nothing this website issued is outstanding, and the
     * call reports `false` rather than guessing at the row.
     */
    static void voidIssuedAuthTicket(
        uint32_t userId,
        const std::string& reason,
        const std::string& ipAddress,
        std::function<void(bool voided)> callback
    );

    /**
     * Void every issued ticket whose deadline has passed.
     *
     * Called on a timer by the server, in bounded batches, oldest first. A record
     * that outlived its deadline while the process was down is picked up on the
     * next run — late, not skipped — which is the reason the schedule is durable
     * rather than a cache entry. A second pass over the same record changes
     * nothing: the closed record is no longer selected, and an already-tombstoned
     * row no longer matches the guard, so no audit entry is written twice.
     */
    static void voidExpiredAuthTickets();

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

    // --- remember-me ---------------------------------------------------

    /**
     * The lifetime of a remember-me token, in days, from the raw setting value.
     *
     * Legacy took `site_cookie_time` from `phpretro_site_settings`:
     *
     *   $expiresAt = time() + (60 * 60 * 24 * (int) $settings->find("site_cookie_time"));
     *
     * and the installer seeded that setting to **14** with the label "Rememberme
     * Expire In / Number of days". A missing, non-numeric or non-positive value
     * therefore means 14 — the legacy default, not a number invented here.
     *
     * Pure: the caller reads the setting and passes the string in, so the
     * defaulting is testable without a database.
     */
    static uint32_t rememberMeDays(const std::string& siteCookieTime);

    /**
     * Store a remember-me token hash and its expiry on the user's row.
     *
     * Writes `users.remember_token_hash` (the SHA-256 hex digest, 64 characters —
     * the column is `varchar(64)`) and `users.remember_token_expires_at`. Both
     * columns are PolarIS's own; nothing is added or widened.
     *
     * The caller hashes; this method takes the digest, so a raw token is never
     * passed to a data-layer function that might log it.
     *
     * Declared once, above, next to the other credential methods; the remember-me
     * section documents the surrounding behaviour rather than repeating it.
     */

    /**
     * Resolve a remember-me token to its account, if it is still valid.
     *
     * Legacy `security_check.php` looked the token up by its digest and required
     * `remember_token_expires_at > time()`:
     *
     *   SELECT id FROM users WHERE remember_token_hash = ? AND remember_token_expires_at > ? LIMIT 1
     *
     * That predicate is reproduced exactly, including the strict `>`, so a token
     * expiring at this instant is already dead. A banned user is refused here
     * too, because `HoloUser::loginFromToken` checked `IsUserBanned` before
     * accepting a token — a ban that landed after the token was issued must not
     * be bypassable by the token.
     */
    static void findByRememberToken(
        const std::string& tokenHash,
        std::function<void(std::optional<UserRecord>)> callback
    );

    /**
     * Clear a user's remember-me token.
     *
     * Used by logout and whenever a token is spent, so a token is single-use for
     * the session it creates. Legacy cleared the cookies on logout; this also
     * clears the stored digest, because a token that keeps working after a
     * deliberate sign-out is a session the user cannot end.
     */
    static void clearRememberToken(
        uint32_t userId,
        std::function<void(bool success)> callback
    );
};

} // namespace hotel::services
