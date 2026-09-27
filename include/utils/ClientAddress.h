#pragma once

#include <drogon/drogon.h>

#include <string>

namespace hotel::utils {

/**
 * Which address a request should be attributed to.
 *
 * The backend has no published port in any Compose file: the only way in is
 * through the nginx proxy, and `proxy/nginx.conf` sets
 * `X-Real-IP $remote_addr` on every API location, which *overwrites* whatever a
 * client sent. So the header is this stack's own record of the client, and
 * `peerAddr()` is the proxy's address -- a container address that is the same
 * for every visitor.
 *
 * That difference matters as soon as anything counts per visitor. The login
 * throttle's address budget, keyed on the peer address, would be one shared
 * budget for the whole site: twenty failed sign-ins from anyone would refuse
 * sign-in for everyone for the next fifteen minutes, and the counter would look
 * perfectly healthy while it did it. `scripts/check_login_throttle.sh` prints
 * the key it seeds, which is how that was found -- it read
 * `login_fail:a:172.27.0.5`, a container address rather than a visitor's.
 *
 * The header is only trusted because of the topology above: it is read as a
 * plausible address literal and otherwise ignored, and a bogus value can only
 * cost the deployment a per-visitor budget, never a command injection (see
 * `LoginThrottle::addressKey`, which encodes whatever it is given).
 */
class ClientAddress {
public:
    /** The address to attribute `req` to. */
    static std::string of(const drogon::HttpRequestPtr& req);

    /** The forwarded address when it is a plausible literal, else the peer. */
    static std::string choose(const std::string& forwarded, const std::string& peer);

    /**
     * True when `candidate` could be an IPv4 or IPv6 literal: a bounded length,
     * a hexadecimal/dot/colon alphabet, and at least one separator. A word like
     * `deadbeef` is hexadecimal but is not an address and is rejected, and so is
     * an empty header, a list, or anything carrying a space.
     */
    static bool isIpLiteral(const std::string& candidate);
};

}  // namespace hotel::utils
