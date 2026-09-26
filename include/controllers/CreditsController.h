#pragma once

#include <drogon/HttpController.h>

namespace hotel::controllers {

/**
 * The credits surface: the purse balance and the transaction ledger.
 *
 * ## Legacy entry points
 *
 *   - `credits.php` — the Coin pages. Its `#purse-habblet` block rendered
 *     `$user->user("credits")` and linked to `/credits/history`. The rest of the
 *     page is hand-written sample HTML ("THIS IS A SAMPLE HABBLET ONLY!") around
 *     a voucher form and static marketing copy.
 *   - `history.php` — one table of the signed-in user's last 100 ledger rows.
 *
 * Both are ported here rather than in `AccountController` because they are the
 * Coin pages, not profile editing: `AccountController` owns the four profile
 * mutation routes, and folding a read surface into it would blur what that
 * controller is for.
 *
 * ## What is deliberately absent
 *
 * Voucher redemption. `credits.php` posts `voucherCode` to itself, and the plan
 * lists voucher redemption as an explicit handoff unless a verified
 * PolarIS/Nitro integration exists. There is no route for it here, and the React
 * page does not render a form that would imply one.
 */
class CreditsController : public drogon::HttpController<CreditsController> {
public:
    METHOD_LIST_BEGIN
    // Reads only: no mutating route lives on this controller, so none of these
    // carries CsrfFilter. `scripts/check_csrf_rules.py` enforces that split by
    // scanning for mutating verbs.
    //
    // `client-entry` does write one column — the caller's own SSO ticket — but it
    // is reached by GET because that is how the client flow works: the page the
    // visitor opens asks the server for a fresh ticket. The write is scoped to
    // the session's own user, is not attacker-chosen (the ticket is server
    // generated), and is audited. It is deliberately NOT a CSRF-protected POST,
    // because a cross-site GET here can only rotate the victim's own ticket,
    // which is a no-op for an attacker who cannot read the response.
    ADD_METHOD_TO(CreditsController::purse, "/api/account/purse", drogon::Get);
    ADD_METHOD_TO(CreditsController::history, "/api/account/transactions", drogon::Get);
    ADD_METHOD_TO(CreditsController::clientEntry, "/api/account/client-entry", drogon::Get);
    METHOD_LIST_END

    /** `GET /api/account/purse` — the signed-in user's Coin and Pixel balances. */
    void purse(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

    /** `GET /api/account/transactions` — the signed-in user's own ledger page. */
    void history(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

    /**
     * `GET /api/account/client-entry` — the materials a client needs to connect.
     *
     * Issues a fresh SSO ticket for the caller and reports the hotel connection
     * settings, stating plainly whether the stack is actually configured to
     * serve a client. See the implementation for why `ready` can be false and
     * why that is the honest answer rather than a failure.
     */
    void clientEntry(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );
};

} // namespace hotel::controllers
