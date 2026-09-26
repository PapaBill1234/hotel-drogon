#include "utils/Crypto.h"
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/rand.h>
#include <iomanip>
#include <sstream>
#include <algorithm>
#include <vector>
#include <chrono>
#include <cmath>
#include <cstring>

#ifndef _WIN32
#include <unistd.h>
#include <crypt.h>
#endif

namespace hotel::utils {

static std::string toHex(const unsigned char* data, size_t len) {
    std::ostringstream oss;
    for (size_t i = 0; i < len; ++i) {
        oss << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(data[i]);
    }
    return oss.str();
}

std::string Crypto::sha1(std::string_view input) {
    unsigned char hash[EVP_MAX_MD_SIZE];
    unsigned int length = 0;
    EVP_MD_CTX* ctx = EVP_MD_CTX_new();
    EVP_DigestInit_ex(ctx, EVP_sha1(), nullptr);
    EVP_DigestUpdate(ctx, input.data(), input.size());
    EVP_DigestFinal_ex(ctx, hash, &length);
    EVP_MD_CTX_free(ctx);
    return toHex(hash, length);
}

std::string Crypto::sha256(std::string_view input) {
    unsigned char hash[EVP_MAX_MD_SIZE];
    unsigned int length = 0;
    EVP_MD_CTX* ctx = EVP_MD_CTX_new();
    EVP_DigestInit_ex(ctx, EVP_sha256(), nullptr);
    EVP_DigestUpdate(ctx, input.data(), input.size());
    EVP_DigestFinal_ex(ctx, hash, &length);
    EVP_MD_CTX_free(ctx);
    return toHex(hash, length);
}

std::string Crypto::hmacSha256(std::string_view key, std::string_view data) {
    unsigned char hash[EVP_MAX_MD_SIZE];
    unsigned int length = 0;
    HMAC(
        EVP_sha256(),
        key.data(),
        static_cast<int>(key.size()),
        reinterpret_cast<const unsigned char*>(data.data()),
        data.size(),
        hash,
        &length
    );
    return toHex(hash, length);
}

std::string Crypto::randomHex(size_t byteCount) {
    std::vector<unsigned char> buf(byteCount);
    RAND_bytes(buf.data(), static_cast<int>(byteCount));
    return toHex(buf.data(), byteCount);
}

std::string Crypto::generateSsoTicket() {
    // `GenerateTicket("random", $length)` in the legacy includes/functions.php is
    // `substr(bin2hex(random_bytes(ceil($length / 2))), 0, $length)` — lowercase
    // hex. Every segment length below is even, because an odd one would need a
    // half-byte to reproduce faithfully and no legacy call site asks for one.
    auto segment = [](size_t length) { return randomHex(length / 2); };

    return segment(8) + "-" + segment(4) + "-" + segment(4) + "-" + segment(4) + "-" +
           segment(12);
}

std::string Crypto::randomAlphanumeric(size_t length) {    static constexpr char charset[] =
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    std::vector<unsigned char> randBytes(length);
    RAND_bytes(randBytes.data(), static_cast<int>(length));
    std::string result;
    result.reserve(length);
    for (size_t i = 0; i < length; ++i) {
        result += charset[randBytes[i] % (sizeof(charset) - 1)];
    }
    return result;
}

bool Crypto::constantTimeEquals(std::string_view a, std::string_view b) {
    if (a.size() != b.size()) {
        return false;
    }
    unsigned char result = 0;
    for (size_t i = 0; i < a.size(); ++i) {
        result |= static_cast<unsigned char>(a[i] ^ b[i]);
    }
    return result == 0;
}

PasswordVerifyResult Crypto::verifyPassword(
    std::string_view password,
    std::string_view storedHash,
    std::string_view username
) {
    PasswordVerifyResult res;
    if (password.empty() || storedHash.empty()) {
        return res;
    }

    // 1. Check bcrypt / standard crypt hash ($2y$, $2a$, $2b$)
#ifndef _WIN32
    if (storedHash.rfind("$2", 0) == 0 || storedHash.rfind("$1$", 0) == 0 || storedHash.rfind("$6$", 0) == 0) {
        struct crypt_data data{};
        std::string passStr(password);
        std::string hashStr(storedHash);
        char* computed = crypt_r(passStr.c_str(), hashStr.c_str(), &data);
        if (computed && constantTimeEquals(computed, storedHash)) {
            res.verified = true;
            res.needsRehash = false;
            return res;
        }
    }
#endif

    // 2. Check legacy PHPRetro / PolarIS sha1 format: sha1(password . strtolower(username))
    std::string lowerUser(username);
    std::transform(lowerUser.begin(), lowerUser.end(), lowerUser.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    std::string legacyInput = std::string(password) + lowerUser;
    std::string legacyHash = sha1(legacyInput);

    if (constantTimeEquals(legacyHash, storedHash)) {
        res.verified = true;
        res.needsRehash = true; // Flag for upgrade to standard bcrypt
        return res;
    }

    // 3. Plain SHA-1 fallback
    std::string plainSha1 = sha1(password);
    if (constantTimeEquals(plainSha1, storedHash)) {
        res.verified = true;
        res.needsRehash = true;
        return res;
    }

    return res;
}

std::string Crypto::hashPassword(std::string_view password) {
#ifndef _WIN32
    // Generate bcrypt salt "$2y$12$..."
    std::string saltSetting = "$2y$12$" + randomAlphanumeric(22);
    struct crypt_data data{};
    std::string passStr(password);
    char* hashed = crypt_r(passStr.c_str(), saltSetting.c_str(), &data);
    if (hashed) {
        return std::string(hashed);
    }
#endif
    // Fallback sha256 hash if platform crypt is unavailable
    return sha256(password);
}

// Base32 decoder for RFC 6238 TOTP
static std::vector<uint8_t> base32Decode(std::string_view base32) {
    std::vector<uint8_t> out;
    int buffer = 0;
    int bitsLeft = 0;
    for (char c : base32) {
        if (c == ' ' || c == '-' || c == '=') continue;
        int val = -1;
        if (c >= 'A' && c <= 'Z') val = c - 'A';
        else if (c >= 'a' && c <= 'z') val = c - 'a';
        else if (c >= '2' && c <= '7') val = c - '2' + 26;
        if (val == -1) continue;

        buffer = (buffer << 5) | val;
        bitsLeft += 5;
        if (bitsLeft >= 8) {
            bitsLeft -= 8;
            out.push_back(static_cast<uint8_t>((buffer >> bitsLeft) & 0xFF));
        }
    }
    return out;
}

bool Crypto::verifyTotp(
    std::string_view secretBase32,
    std::string_view code,
    uint32_t windowSteps,
    uint64_t stepSeconds
) {
    if (code.size() != 6 || secretBase32.empty()) {
        return false;
    }

    std::vector<uint8_t> secretKey = base32Decode(secretBase32);
    if (secretKey.empty()) {
        return false;
    }

    uint64_t nowSec = static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::system_clock::now().time_since_epoch()
        ).count()
    );

    uint64_t currentCounter = nowSec / stepSeconds;

    for (int64_t i = -static_cast<int64_t>(windowSteps); i <= static_cast<int64_t>(windowSteps); ++i) {
        uint64_t step = currentCounter + i;
        uint8_t counterBytes[8];
        for (int j = 7; j >= 0; --j) {
            counterBytes[j] = static_cast<uint8_t>(step & 0xFF);
            step >>= 8;
        }

        unsigned char hmacRes[EVP_MAX_MD_SIZE];
        unsigned int hmacLen = 0;
        HMAC(
            EVP_sha1(),
            secretKey.data(),
            static_cast<int>(secretKey.size()),
            counterBytes,
            8,
            hmacRes,
            &hmacLen
        );

        if (hmacLen < 4) continue;
        int offset = hmacRes[hmacLen - 1] & 0x0F;
        uint32_t binaryCode =
            ((hmacRes[offset] & 0x7F) << 24) |
            ((hmacRes[offset + 1] & 0xFF) << 16) |
            ((hmacRes[offset + 2] & 0xFF) << 8) |
            (hmacRes[offset + 3] & 0xFF);

        uint32_t totpInt = binaryCode % 1000000;
        char totpStr[7];
        snprintf(totpStr, sizeof(totpStr), "%06u", totpInt);

        if (constantTimeEquals(totpStr, code)) {
            return true;
        }
    }

    return false;
}

} // namespace hotel::utils
