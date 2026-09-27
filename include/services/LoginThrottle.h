#pragma once

#include <functional>
#include <string>

namespace hotel::services {

/**
 * Consecutive-failure throttling for credential checks.
 *
 * Every route that asks "is this the right password for this account?" goes
 * through `UserAccountService::authenticate`, so the counter lives at that
 * boundary rather than in the controllers: `POST /api/auth/login`,
 * `POST /api/auth/staff-login`, `POST /api/account/password` (the step-up
 * before a password change) and `POST /api/account/reauthenticate` are all
 * covered by one mechanism, and a route added later cannot forget it.
 *
 * Two counters, because they stop different attacks:
 *
 *   * per submitted account, `kAccountLimit` failures in a window. Keyed on the
 *     username that was *submitted*, not on one that exists: a counter that
 *     only moved for real accounts would answer "does this account exist?".
 *   * per source address, `kAddressLimit` failures in the same window, so
 *     spraying one password across many account names costs more than one
 *     account's budget. Higher than the account limit on purpose -- a shared
 *     address (an office, a school, a carrier NAT) must not be locked out by
 *     one person's typos.
 *
 * A window starts at the first failure and is refreshed by each one, so the
 * counter cannot be waited out while attempts continue. `clearAccount` runs on
 * a successful sign-in and drops the account counter only; the address counter
 * deliberately survives success, or an attacker with one working account of
 * their own could reset the spray budget at will.
 *
 * The refusal message is a constant: it names neither the limit that was hit
 * nor whether the account exists, and the caller is expected to answer with the
 * same status for an existing and a non-existent username.
 *
 * The counter is *read* before the password is verified and *written* after a
 * refusal, which means a burst arriving at once can overshoot the limit: every
 * request in flight that read a counter below its limit still gets verified.
 * `scripts/check_login_throttle.sh` measures exactly that, and asserts the
 * property that does hold under concurrency -- no failure is lost or counted
 * twice -- rather than a limit the design does not promise. Serialising the two
 * would mean counting attempts rather than failures, which would spend a
 * legitimate sign-in's budget on the successful request itself.
 *
 * Redis being unreachable is treated as a refusal, not as an open door. The
 * alternative -- allow the attempt and skip the counter -- turns a Redis outage
 * into an unthrottled oracle: a wrong password would still answer "invalid
 * credentials" while a right one would fail later, in the session layer, with a
 * different error. Sessions are stored in the same Redis, so nothing usable is
 * lost by refusing while it is down.
 */
struct LoginThrottleState {
    bool allowed = true;
    bool available = true;
    int failures = 0;
    int retryAfterSeconds = 0;
};

class LoginThrottle {
public:
    /** Failures allowed against one account name inside one window. */
    static constexpr int kAccountLimit = 5;
    /** Failures allowed from one source address inside one window. */
    static constexpr int kAddressLimit = 20;
    /** Window length in seconds; refreshed by each recorded failure. */
    static constexpr int kWindowSeconds = 900;

    /**
     * Read both counters before the password is verified. The callback always
     * runs; `available` is false when the counter store could not be reached.
     */
    static void check(
        const std::string& username,
        const std::string& ipAddress,
        std::function<void(LoginThrottleState)> callback
    );

    /** Count a refused credential: one account failure and one address failure. */
    static void recordFailure(const std::string& username, const std::string& ipAddress);

    /** Drop the account counter after a successful sign-in. */
    static void clearAccount(const std::string& username);

    /** True while the counter is below the limit. Pure, so it is unit-tested. */
    static bool allowed(int failures, int limit);

    /** Redis key for an account name. Pure; lowercases and percent-encodes. */
    static std::string accountKey(const std::string& username);

    /** Redis key for a source address. Pure; percent-encodes. */
    static std::string addressKey(const std::string& ipAddress);

    /** The one message every refusal carries, whatever was hit. Pure. */
    static std::string refusalMessage(int retryAfterSeconds);
};

}  // namespace hotel::services
