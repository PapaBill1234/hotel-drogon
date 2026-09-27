#include "utils/ClientAddress.h"

namespace hotel::utils {

bool ClientAddress::isIpLiteral(const std::string& candidate) {
    // 45 is INET6_ADDRSTRLEN - 1: the longest textual IPv6 address.
    if (candidate.empty() || candidate.size() > 45) {
        return false;
    }

    bool sawSeparator = false;
    bool sawHexDigit = false;
    for (const unsigned char c : candidate) {
        if ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
            sawHexDigit = true;
            continue;
        }
        if (c == ':' || c == '.') {
            sawSeparator = true;
            continue;
        }
        return false;
    }

    // A separator is what separates an address from a bare hexadecimal word,
    // and a digit is what rules out "::".
    return sawSeparator && sawHexDigit;
}

std::string ClientAddress::choose(const std::string& forwarded, const std::string& peer) {
    if (isIpLiteral(forwarded)) {
        return forwarded;
    }
    return peer;
}

std::string ClientAddress::of(const drogon::HttpRequestPtr& req) {
    if (!req) {
        return std::string();
    }
    return choose(req->getHeader("X-Real-IP"), req->peerAddr().toIp());
}

}  // namespace hotel::utils
