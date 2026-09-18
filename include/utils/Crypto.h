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
