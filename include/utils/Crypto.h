#pragma once

#include <string>
#include <string_view>
#include <cstdint>

namespace hotel::utils {

struct PasswordVerifyResult {
    bool verified = false;
    bool needsRehash = false;
};

class Crypto {
public:
    static std::string sha1(std::string_view input);
    static std::string sha256(std::string_view input);
    static std::string hmacSha256(std::string_view key, std::string_view data);
    static std::string randomHex(size_t byteCount = 32);
    static std::string randomAlphanumeric(size_t length = 32);
    static bool constantTimeEquals(std::string_view a, std::string_view b);

    /**
     * An SSO ticket in the format the legacy website wrote.
     *
     * `includes/functions.php`'s `GenerateTicket("sso")`:
     *
     *   random(8) . "-" . random(4) . "-" . random(4) . "-" . random(4) . "-" . random(12)
     *
     * where `random($n)` is `substr(bin2hex(random_bytes(ceil($n/2))), 0, $n)` —
     * lowercase hex. The result is 36 characters, `users.auth_ticket` holds it
     * (`varchar(256)` in PolarIS), and the client is handed it as
     * `use.sso.ticket=1;sso.ticket=<ticket>`.
     *
     * The *shape* is all this reproduces. What the emulator does with the value
     * is emulator behaviour and is not verified anywhere in this repository.
     */
    static std::string generateSsoTicket();

    /**
     * The value that replaces a website-issued SSO ticket when the website voids
     * it — a tombstone, not a ticket.
     *
     * Two properties matter, and both are deliberate:
     *
     * 1. **It cannot be presented.** It is longer than the 128 characters both
     *    PolarIS doors cap a presented ticket at (`SecureLoginEvent` rejects a
     *    longer value before any lookup, and `SessionEndpoints.handleSsoToken`
     *    answers 400 for one), while still fitting `users.auth_ticket`
     *    `varchar(256)`. So even a leaked tombstone is not a credential.
     * 2. **It is not empty.** The emulator restores a consumed ticket during its
     *    reconnect grace, but only into an empty column — its own restore is
     *    `WHERE id = ? AND (auth_ticket = '' OR auth_ticket IS NULL)`. Clearing
     *    the ticket to `''` would let that restore put the dead ticket back;
     *    leaving a non-empty tombstone is what makes the void final.
     *
     * The prefix keeps it recognisable in a row to anyone debugging, and the
     * random tail keeps two voids from looking like the same value.
     */
    static std::string generateVoidSsoTicket();

    /**
     * A remember-me token in the format the legacy website wrote.
     *
     * `includes/functions.php`'s `GenerateTicket("remember")`:
     *
     *   random(6) . "-" . bin2hex(random_bytes(10)) . "-" . bin2hex(random_bytes(10))
     *
     * Note what differs from the SSO ticket: the first segment is **six hex
     * characters**, and the other two are ten *bytes* rendered as twenty hex
     * characters each. The whole value is 6 + 1 + 20 + 1 + 20 = 48 characters.
     *
     * It is stored only as its SHA-256 hex digest in `users.remember_token_hash`
     * (`varchar(64)` in PolarIS, which is exactly one SHA-256 digest in hex), and
     * the raw value goes to the browser in the `rememberme_token` cookie. That
     * asymmetry is the point: a database disclosure yields digests, not tokens.
     */
    static std::string generateRememberToken();

    // Password hashing & verification with legacy PHPRetro/PolarIS migration support
    static PasswordVerifyResult verifyPassword(
        std::string_view password,
        std::string_view storedHash,
        std::string_view username
    );
    static std::string hashPassword(std::string_view password);

    // TOTP RFC 6238 verification for Staff 2FA
    static bool verifyTotp(
        std::string_view secretBase32,
        std::string_view code,
        uint32_t windowSteps = 1,
        uint64_t stepSeconds = 30
    );
};

} // namespace hotel::utils
