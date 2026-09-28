#pragma once

#include <drogon/HttpController.h>

namespace hotel::controllers {

/**
 * MyHabbo Homes: the page layout read, its versioned write, and the edit session
 * that guards it.
 *
 * ## Legacy entry points
 *
 *   - `home.php` — the page. `?id=`/`?name=` resolve the profile; the layout is
 *     `displayLayouts()` split into two columns and `placedItems()` on the
 *     playground; `backgroundClass()` is the page background.
 *   - `habblet/myhabbo_layout_save.php` — the edit-mode save. The editor's
 *     JavaScript posted `widgets=12:25,10,1/13:450,60,2`, i.e. the pixel
 *     coordinates it had dragged, and the model derived column and position from
 *     them.
 *   - `habblet/myhabbo_widget_add.php`, `myhabbo_widget_delete.php` — adding and
 *     removing a widget box.
 *
 * ## What this controller adds, and why
 *
 * The legacy editor had no concurrency control at all: two tabs could save over
 * each other and the second write simply won. The plan's Phase 8 requires the
 * opposite — "two concurrent edits ... prove that the loser is rejected or safely
 * merged, never silently overwritten" — so every write here carries the layout
 * `version` the client read, and a save whose version is stale is answered 409
 * with the current version, never applied.
 *
 * The Redis edit session is the second half: it stops two people *starting* an
 * edit on one page. It is not what makes a lost update impossible — the version
 * compare-and-swap is — which is why an expired lock degrades to a 409 rather
 * than to a silent overwrite.
 *
 * The request/response/conflict shapes are written down in
 * `docs/homes-layout-api.md`, which is the artifact the plan asks to be presented
 * before implementation.
 *
 * ## Deliberately absent
 *
 * Group homes (`guild_id != 0`), guestbook writes or rendering, store purchases,
 * inventory and placement routes. The public guestbook route returns raw message
 * strings as JSON; it does not render BBCode. Ratings and read-only store
 * catalogue browsing have separate API slices; no rating widget UI, purchase,
 * asset preview, inventory mutation or placement route is wired into the page.
 * Each remaining feature is a separate work unit with its own permission or
 * credit-write rule.
 */
class HomesController : public drogon::HttpController<HomesController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(HomesController::layout, "/api/homes/{1}/layout", drogon::Get);
    ADD_METHOD_TO(HomesController::saveLayout, "/api/homes/{1}/layout", drogon::Put,
                  "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(HomesController::openEditSession, "/api/homes/{1}/edit-session", drogon::Post,
                  "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(HomesController::closeEditSession, "/api/homes/{1}/edit-session", drogon::Delete,
                  "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(HomesController::addWidget, "/api/homes/{1}/widgets", drogon::Post,
                  "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(HomesController::removeWidget, "/api/homes/{1}/widgets/{2}", drogon::Delete,
                  "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(HomesController::ratingSummary, "/api/homes/{1}/rating", drogon::Get);
    ADD_METHOD_TO(HomesController::rate, "/api/homes/{1}/rating/{2}", drogon::Post,
                  "hotel::filters::CsrfFilter");
    ADD_METHOD_TO(HomesController::storeCategories,
                  "/api/homes/store/categories", drogon::Get);
    ADD_METHOD_TO(HomesController::storeItems,
                  "/api/homes/store/items", drogon::Get);
    ADD_METHOD_TO(HomesController::inventory,
                  "/api/homes/inventory", drogon::Get);
    ADD_METHOD_TO(HomesController::guestbookEntries,
                  "/api/homes/{1}/guestbook", drogon::Get);
    METHOD_LIST_END

    /** `GET /api/homes/{id}/layout` — the page as the converted `home.php` reads it. */
    void layout(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback,
        uint32_t userId
    );

    /** `PUT /api/homes/{id}/layout` — move widgets, optionally change background. */
    void saveLayout(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback,
        uint32_t userId
    );

    /** `POST /api/homes/{id}/edit-session` — open or refresh the Redis edit lock. */
    void openEditSession(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback,
        uint32_t userId
    );

    /** `DELETE /api/homes/{id}/edit-session` — release the caller's own lock. */
    void closeEditSession(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback,
        uint32_t userId
    );

    /** `POST /api/homes/{id}/widgets` — add a widget box to a column. */
    void addWidget(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback,
        uint32_t userId
    );

    /** `DELETE /api/homes/{id}/widgets/{widgetId}` — remove a widget box. */
    void removeWidget(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback,
        uint32_t userId,
        uint32_t widgetId
    );

    /** `GET /api/homes/{id}/rating` — public summary, personalized to the viewer. */
    void ratingSummary(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback,
        uint32_t userId
    );

    /** `POST /api/homes/{id}/rating/{widgetId}` — cast one first vote. */
    void rate(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback,
        uint32_t userId,
        uint32_t widgetId
    );

    /** `GET /api/homes/store/categories?type=sticker` — eligible categories. */
    void storeCategories(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

    /** `GET /api/homes/store/items?type=sticker&category_id=...` — item metadata. */
    void storeItems(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

    /** `GET /api/homes/inventory` — signed-in personal inventory metadata. */
    void inventory(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback
    );

    /** `GET /api/homes/{id}/guestbook` — public raw JSON rows, newest first. */
    void guestbookEntries(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback,
        const std::string& profileId
    );
};

} // namespace hotel::controllers
