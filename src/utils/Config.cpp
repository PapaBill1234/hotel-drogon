#include "utils/Config.h"
#include <cstdlib>

#ifndef _WIN32
#include <netdb.h>
#include <arpa/inet.h>
#include <sys/socket.h>
#else
#include <winsock2.h>
#include <ws2tcpip.h>
#endif

namespace hotel::utils {

static std::string getEnvOrDefault(const char* key, const std::string& defaultValue) {
    const char* val = std::getenv(key);
    return (val && *val) ? std::string(val) : defaultValue;
}

static uint16_t getEnvAsUint16(const char* key, uint16_t defaultValue) {
    const char* val = std::getenv(key);
    if (val && *val) {
        try {
            int parsed = std::stoi(val);
            if (parsed > 0 && parsed <= 65535) {
                return static_cast<uint16_t>(parsed);
            }
        } catch (...) {}
    }
    return defaultValue;
}

static size_t getEnvAsSizeT(const char* key, size_t defaultValue) {
    const char* val = std::getenv(key);
    if (val && *val) {
        try {
            int parsed = std::stoi(val);
            if (parsed >= 0) {
                return static_cast<size_t>(parsed);
            }
        } catch (...) {}
    }
    return defaultValue;
}

static bool getEnvAsBool(const char* key, bool defaultValue) {
    const char* val = std::getenv(key);
    if (val && *val) {
        std::string s(val);
        return (s == "1" || s == "true" || s == "yes" || s == "TRUE");
    }
    return defaultValue;
}

// Clamped rather than merely parsed, because both of these values trade a
// security window against latency: a zero or negative TTL would void a ticket
// before a client could present it, and an absurd one would quietly undo the
// bound this setting exists to create.
static uint32_t getEnvAsUint32Clamped(const char* key, uint32_t defaultValue, uint32_t min,
                                      uint32_t max) {
    const char* val = std::getenv(key);
    if (val && *val) {
        try {
            long parsed = std::stol(val);
            if (parsed < static_cast<long>(min)) return min;
            if (parsed > static_cast<long>(max)) return max;
            return static_cast<uint32_t>(parsed);
        } catch (...) {}
    }
    return defaultValue;
}

std::string AppConfig::resolveHost(const std::string& host) {
    if (host.empty() || host == "localhost" || host == "127.0.0.1" || host == "0.0.0.0") {
        return host;
    }

    struct addrinfo hints{}, *res = nullptr;
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;

    if (getaddrinfo(host.c_str(), nullptr, &hints, &res) == 0 && res != nullptr) {
        char ipStr[INET_ADDRSTRLEN] = {0};
        auto* ipv4 = reinterpret_cast<struct sockaddr_in*>(res->ai_addr);
        inet_ntop(AF_INET, &(ipv4->sin_addr), ipStr, INET_ADDRSTRLEN);
        freeaddrinfo(res);
        if (ipStr[0] != '\0') {
            return std::string(ipStr);
        }
    }
    return host;
}

AppConfig AppConfig::loadFromEnv() {
    AppConfig cfg;
    cfg.host = getEnvOrDefault("APP_HOST", "0.0.0.0");
    cfg.port = getEnvAsUint16("APP_PORT", 8080);
    cfg.thread_count = getEnvAsSizeT("APP_THREADS", 0);
    cfg.environment = getEnvOrDefault("APP_ENV", "development");

    cfg.log_level = getEnvOrDefault("LOG_LEVEL", "info");
    cfg.json_logging = getEnvAsBool("LOG_JSON", true);

    cfg.db_host = getEnvOrDefault("DB_HOST", "127.0.0.1");
    cfg.db_port = getEnvAsUint16("DB_PORT", 3306);
    cfg.db_name = getEnvOrDefault("DB_DATABASE", "polaris");
    cfg.db_user = getEnvOrDefault("DB_USERNAME", "hotel");
    cfg.db_password = getEnvOrDefault("DB_PASSWORD", "");
    cfg.db_max_connections = getEnvAsSizeT("DB_MAX_CONNECTIONS", 10);

    cfg.redis_host = getEnvOrDefault("REDIS_HOST", "127.0.0.1");
    cfg.redis_port = getEnvAsUint16("REDIS_PORT", 6379);
    cfg.redis_password = getEnvOrDefault("REDIS_PASSWORD", "");
    cfg.redis_db = static_cast<unsigned int>(getEnvAsSizeT("REDIS_DB", 0));

    cfg.sentry_dsn = getEnvOrDefault("SENTRY_DSN", "");
    cfg.session_cookie_name = getEnvOrDefault("SESSION_COOKIE_NAME", "hotel_session");
    cfg.csrf_header_name = getEnvOrDefault("CSRF_HEADER_NAME", "X-XSRF-TOKEN");
    cfg.secret_key = getEnvOrDefault("APP_SECRET", "change-me-in-production");

    // 5 s is the floor rather than 1 s: a ticket that dies before a browser can
    // finish loading the client is a broken launch, not a tighter bound. The
    // ceiling keeps the replay window a window.
    cfg.sso_ticket_ttl_seconds = getEnvAsUint32Clamped("SSO_TICKET_TTL_SECONDS", 120, 5, 3600);
    cfg.sso_ticket_sweep_seconds = getEnvAsUint32Clamped("SSO_TICKET_SWEEP_SECONDS", 5, 1, 60);

    return cfg;
}

} // namespace hotel::utils
