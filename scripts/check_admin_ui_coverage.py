#!/usr/bin/env python3
"""
CI check: the `/api/admin/*` CMS surface and the admin UI that drives it agree.

The Phase 4 exit condition requires staff to manage public content *through the
admin UI*, not merely through an API that exists. An endpoint with no UI is
exactly the gap this check catches, and it catches it statically, so a future
resource cannot be added to the controller and forgotten in the panel (or vice
versa).

What it asserts:

1. Every route registered in `AdminContentController.h` and
   `StaffTestController.h` is either
     - called from `frontend/src/services/apiAdmin.ts` (the single place the
       panel is allowed to talk to `/api/admin/*` and `/api/auth/*`), or
     - listed in ALLOWED_UNWIRED below with a written reason.
2. Every mutating route (POST/PUT/DELETE) has a matching call with the same HTTP
   method, so a route cannot be "covered" by a call that would 404 or 405.
3. No module calls `fetch()` directly except the two service clients
   (`api.ts` for the anonymous public surface, `apiAdmin.ts` for admin), which is
   what keeps the CSRF header and cookie policy in one place per surface.
4. `GET /api/admin/session` is both served and used, because without it the
   panel cannot distinguish "signed in but no staff session" from "not signed
   in" and would show the operator the wrong instruction.
5. The high-trust warning element is rendered by the panel: the plan requires a
   *visible* warning for raw-HTML fields, and a warning component that nothing
   renders is not a warning.

Exits 0 when all assertions hold, 1 otherwise.
"""

import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CONTROLLERS = [
    "include/controllers/AdminContentController.h",
    "include/controllers/StaffTestController.h",
]

CLIENT = "frontend/src/services/apiAdmin.ts"
FRONTEND_SRC = "frontend/src"
# The only modules allowed to open a request themselves, one per API surface.
FETCH_ALLOWED = {
    CLIENT,
    "frontend/src/services/api.ts",
}

METHOD_PATTERN = re.compile(
    r'ADD_METHOD_TO\s*\(\s*[\w:]+::(\w+)\s*,\s*"([^"]+)"\s*,\s*([^)]+)\)',
    re.MULTILINE,
)

# `request<T>(...)` / `request(...)`: the type argument may itself contain angle
# brackets, so match the parentheses instead of trying to describe the generics.
REQUEST_CALL = re.compile(r"\brequest\s*(?:<[^()]*>)?\s*\(")
STRING_LITERAL = re.compile(r"^(['\"`])((?:\\.|(?!\1).)*)\1", re.DOTALL)

# Routes deliberately not wired to the panel yet: {route: reason}
ALLOWED_UNWIRED = {
    "/api/admin/test-gate": (
        "diagnostic gate used by scripts/smoke_phase3.sh; superseded for the UI by "
        "/api/admin/session, which reports the session instead of a fixed string"
    ),
    "/api/admin/bans": (
        "Phase 9 (housekeeping replacement) surface. No bans UI is built yet, so no "
        "bans coverage is claimed."
    ),
    "/api/admin/bans/revoke": (
        "Phase 9 (housekeeping replacement) surface. No bans UI is built yet, so no "
        "bans coverage is claimed."
    ),
}

MUTATING = {"Post", "Put", "Patch", "Delete"}


def read(path: str) -> str:
    with open(os.path.join(REPO, path), "r", encoding="utf-8") as handle:
        return handle.read()


def parse_routes() -> list[tuple[str, str, set[str]]]:
    """[(route, source_file, http_methods)] for every admin route."""
    routes = []
    for rel in CONTROLLERS:
        content = read(rel)
        for _handler, route, args in METHOD_PATTERN.findall(content):
            methods = {token.strip().split("::")[-1] for token in args.split(",")}
            methods = {
                m for m in methods if m in MUTATING or m in {"Get", "Head", "Options"}
            }
            routes.append((route, rel, methods))
    return routes


def parse_client_calls() -> list[tuple[str, str]]:
    """[(path_template, http_method)] for every call in the typed client.

    Walks each `request(...)` invocation, reads its first string argument (path)
    and looks for `method: 'X'` in the remainder of the call. Doing this by
    hand rather than with one regex is deliberate: a single-expression regex for
    a nested-generic call is where the previous version of this check silently
    matched nothing.
    """
    content = read(CLIENT)
    calls = []
    for match in REQUEST_CALL.finditer(content):
        # Find the matching close paren for this call.
        depth = 1
        index = match.end()
        while index < len(content) and depth > 0:
            char = content[index]
            if char in "([{":
                depth += 1
            elif char in ")]}":
                depth -= 1
            index += 1
        args = content[match.end() : index - 1].strip()

        literal = STRING_LITERAL.match(args)
        if not literal:
            continue
        path = literal.group(2)

        method = "GET"
        method_match = re.search(r"method\s*:\s*'(\w+)'", args)
        if method_match:
            method = method_match.group(1)
        calls.append((path, method))
    return calls


def normalise(path: str) -> str:
    """Reduce a controller route and a client path to the same key.

    The client prefixes every request with the module constant
    `ADMIN_API_BASE = '/api'`, so `request('/admin/news', …)` and the route
    `/api/admin/news` are the same endpoint. `{id}` and a JS template
    placeholder are likewise the same. Comparison happens under `/api/`.
    """
    path = path.split("?")[0]
    path = re.sub(r"\$\{[^}]+\}", "{id}", path)
    path = path.rstrip("/")
    if not path.startswith("/api/"):
        path = "/api" + path
    return path


def main() -> int:
    errors: list[str] = []
    routes = parse_routes()
    calls = parse_client_calls()

    if not routes:
        print(
            "[FAIL] no /api/admin routes were parsed; the controller pattern changed.",
            file=sys.stderr,
        )
        return 1
    if not calls:
        print(f"[FAIL] no API calls were parsed from {CLIENT}.", file=sys.stderr)
        return 1

    called = {(normalise(path), method.upper()) for path, method in calls}
    called_paths = {path for path, _method in called}

    # --- 1 & 2: every route reachable from the client, with the right method ---
    wired = 0
    for route, source, methods in routes:
        normalised = normalise(route)
        if normalised in ALLOWED_UNWIRED:
            continue
        if normalised not in called_paths:
            errors.append(
                f"[FAIL] {source}: route '{route}' has no call in {CLIENT}. Either drive it "
                f"from the admin UI or add it to ALLOWED_UNWIRED with a reason."
            )
            continue
        for method in sorted(methods & MUTATING):
            if (normalised, method.upper()) not in called:
                errors.append(
                    f"[FAIL] {source}: route '{route}' accepts {method.upper()} but {CLIENT} "
                    f"never issues a {method.upper()} to it."
                )
        wired += 1

    # --- 3: no direct fetch() outside the two service clients ------------------
    for root, _dirs, files in os.walk(os.path.join(REPO, FRONTEND_SRC)):
        for name in files:
            if not name.endswith((".ts", ".tsx")):
                continue
            full = os.path.join(root, name)
            rel = os.path.relpath(full, REPO).replace("\\", "/")
            if rel in FETCH_ALLOWED:
                continue
            content = open(full, "r", encoding="utf-8").read()
            if re.search(r"\bfetch\s*\(", content):
                errors.append(
                    f"[FAIL] {rel} calls fetch() directly. Requests must go through "
                    f"frontend/src/services/api.ts (public) or apiAdmin.ts (admin) so the "
                    f"cookie and CSRF policy stay in one place per surface."
                )

    # --- 4: the staff-session endpoint is served and used ----------------------
    session_route = "/api/admin/session"
    if not any(normalise(r) == session_route for r, _source, _methods in routes):
        errors.append(f"[FAIL] {session_route} is not registered by any controller.")
    if session_route not in called_paths:
        errors.append(
            f"[FAIL] {session_route} is registered but never called by {CLIENT}."
        )

    # --- 5: the high-trust warning is actually rendered ------------------------
    warning_component = "frontend/src/pages/admin/AdminChrome.tsx"
    warning_testid = "high-trust-warning"
    if warning_testid not in read(warning_component):
        errors.append(
            f"[FAIL] {warning_component} does not render the {warning_testid} element."
        )
    renderers = []
    admin_pages = os.path.join(REPO, FRONTEND_SRC, "pages", "admin")
    for name in sorted(os.listdir(admin_pages)):
        if not name.endswith(".tsx"):
            continue
        rel = f"frontend/src/pages/admin/{name}"
        if rel != warning_component and "<HighTrustWarning" in read(rel):
            renderers.append(rel)
    if not renderers:
        errors.append(
            "[FAIL] no admin page renders <HighTrustWarning>. The plan requires a visible "
            "warning on raw-HTML/script fields."
        )

    print(
        f"Scanned {len(routes)} admin routes and {len(calls)} client calls; "
        f"{wired} routes wired to the admin UI, {len(ALLOWED_UNWIRED)} explicitly unwired."
    )
    print(f"High-trust warning rendered by: {', '.join(sorted(renderers)) or 'nothing'}.")

    if errors:
        for err in errors:
            print(err, file=sys.stderr)
        return 1

    print("Admin API surface and admin UI are consistent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
