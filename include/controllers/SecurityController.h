#pragma once

#include <drogon/HttpController.h>

namespace hotel::controllers {

/**
 * The step-up session flow: `reauthenticate.php` and `security_check.php`.
 *
 * ## What the legacy pair did
 *
 * `client.php` opened with:
 *
 *   if (isset($_SESSION['reauthenticate']) && $_SESSION['reauthenticate'] == "true") {
 *       $_SESSION['page'] = $_SERVER["REQUEST_URI"];
 *       header("Location: ".PATH."/account/reauthenticate"); exit;
 *   }
 *
 * so a session that had been restored from a remember-me token — rather than
 * established by a fresh password — could not enter the hotel until the holder
 * proved the password again. `reauthenticate.php` collected it, cleared the flag
 * and redirected to `security_check.php`, which redirected onward to the page
 * the user had originally asked for (`$_SESSION['page']`).
 *
 * ## What is ported here and what is not
 *
 * The **flag and its consequences** are ported: a session carries
 * `reauth_required`, `/api/account/session` reports it, and clearing it requires
 * the account password. What is *not* ported is the redirect dance through an
 * intermediate HTML page — a decoupled SPA has a client-side router, so the
 * React page reads the flag and routes itself. `security_check.php` also carried
 * a `type=token` remember-me branch, which belongs with the remember-me slice
 * rather than this one; see the inventory.
 */
class SecurityController : public drogon::HttpController<SecurityController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(SecurityController::session, "/api/account/session", drogon::Get);
    ADD_METHOD_TO(SecurityController::reauth, "/api/account/reauthenticate", drogon::Post,
                  "hotel::filters::CsrfFilter");
    METHOD_LIST_END

    /**
     * `GET /api/account/session` — what this session may do.
     *
     * Reports `reauth_required`, which is the flag the client entry consults. It
     * is a read, so no CSRF filter, and it requires a session.
     */
    void session(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

    /**
     * `POST /api/account/reauthenticate` — clear the step-up requirement.
     *
     * Requires the account's own password. CSRF-filtered: the caller has a
     * session, so a session-bound token exists and there is no reason to accept
     * less.
     */
    void reauth(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );
};

} // namespace hotel::controllers
