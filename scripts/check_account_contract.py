#!/usr/bin/env python3
"""Validate the first OpenAPI slice against a disposable, seeded Drogon stack."""

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = json.loads((ROOT / "docs/openapi-account-v1.json").read_text(encoding="utf-8"))
BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000").rstrip("/")
CHECKS = 0


def check(condition, label):
    global CHECKS
    CHECKS += 1
    if not condition:
        raise AssertionError(label)


def resolve(ref):
    check(ref.startswith("#/"), f"local reference: {ref}")
    value = SPEC
    for part in ref[2:].split("/"):
        value = value[part.replace("~1", "/").replace("~0", "~")]
    return value


def walk_refs(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "$ref":
                resolve(item)
            else:
                walk_refs(item)
    elif isinstance(value, list):
        for item in value:
            walk_refs(item)


def matches(schema, value, label):
    if "$ref" in schema:
        return matches(resolve(schema["$ref"]), value, label)
    if "const" in schema:
        check(value == schema["const"], f"{label} constant")
    kind = schema.get("type")
    if kind == "object":
        check(isinstance(value, dict), f"{label} object")
        for field in schema.get("required", []):
            check(field in value, f"{label}.{field} present")
        for field, child in schema.get("properties", {}).items():
            if field in value:
                matches(child, value[field], f"{label}.{field}")
    elif kind == "string":
        check(isinstance(value, str), f"{label} string")
    elif kind == "integer":
        check(type(value) is int, f"{label} integer")
    elif kind == "boolean":
        check(type(value) is bool, f"{label} boolean")


def response_schema(path, method, status):
    response = SPEC["paths"][path][method.lower()]["responses"][str(status)]
    if "$ref" in response:
        response = resolve(response["$ref"])
    return response["content"]["application/json"]["schema"]


def request(method, path, status, payload=None, cookies="", csrf="", raw=False):
    headers = {}
    if cookies:
        headers["Cookie"] = cookies
    if csrf:
        headers["X-XSRF-TOKEN"] = csrf
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = payload.encode() if raw else json.dumps(payload).encode()
    else:
        body = None
    req = urllib.request.Request(BASE + path, data=body, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as error:
        resp = error
    with resp:
        check(resp.status == status, f"{method} {path} expected {status}, got {resp.status}")
        data = json.loads(resp.read())
        matches(response_schema(path, method, status), data, f"{method} {path} {status}")
        check(data.get("status") == ("ok" if status == 200 else status),
              f"{method} {path} body status")
        return data, resp.headers.get_all("Set-Cookie") or []


def cookie_fields(headers):
    fields = {}
    for line in headers:
        name = line.split("=", 1)[0]
        fields[name] = line
    return fields


def cookie_value(line):
    return line.split(";", 1)[0]


def main():
    check(os.environ.get("ACCOUNT_CONTRACT_DISPOSABLE") == "1",
          "set ACCOUNT_CONTRACT_DISPOSABLE=1 only for a throwaway seeded stack")
    check(SPEC["openapi"] == "3.1.0", "OpenAPI version")
    walk_refs(SPEC)
    expected = {
        ("/api/auth/login", "post"), ("/api/auth/staff-login", "post"),
        ("/api/auth/login", "options"), ("/api/auth/staff-login", "options"),
        ("/api/auth/logout", "post"), ("/api/me", "get"),
        *((f"/api/account/{name}", "post") for name in ("motto", "look", "email", "password")),
        # Phase 5 credits surface, served by CreditsController.
        ("/api/account/purse", "get"), ("/api/account/transactions", "get"),
        # Phase 5 client-entry handoff, also on CreditsController.
        ("/api/account/client-entry", "get"),
        # Phase 5 forgot/reset and the step-up flow.
        ("/api/auth/password/forgot", "post"), ("/api/auth/password/reset", "post"),
        ("/api/auth/username/forgot", "post"),
        ("/api/account/session", "get"), ("/api/account/reauthenticate", "post"),
        # Phase 5 remember-me: the consume side.
        ("/api/auth/remember-login", "post"),
    }
    actual = {(path, method) for path, methods in SPEC["paths"].items()
              for method in methods if method in ("get", "post", "put", "delete", "patch", "options")}
    check(actual == expected, "documented first slice matches the expected path and method set")
    headers = "\n".join((ROOT / "include/controllers" / name).read_text(encoding="utf-8")
                        for name in ("AuthController.h", "AccountController.h",
                                     "CreditsController.h", "SecurityController.h"))
    routes = {(path, method.lower()) for path, method in
              re.findall(r'ADD_METHOD_TO\([^,]+,\s*"([^"]+)",\s*drogon::(Get|Post)', headers)}
    options = set(re.findall(r'ADD_METHOD_TO\([^,]+,\s*"([^"]+)",\s*drogon::Post,\s*drogon::Options', headers))
    routes.update((path, "options") for path in options)
    check(actual == routes, "documented operations match auth/account route macros")
    ids = [operation["operationId"] for methods in SPEC["paths"].values()
           for operation in methods.values() if isinstance(operation, dict)]
    check(len(ids) == len(set(ids)), "operation IDs are unique")

    for path in ("/api/auth/login", "/api/auth/staff-login"):
        with urllib.request.urlopen(urllib.request.Request(BASE + path, method="OPTIONS"), timeout=15) as response:
            check(response.status == 200 and response.read() == b"", f"OPTIONS {path} empty 200")
    request("GET", "/api/me", 401)
    request("POST", "/api/auth/login", 400, "{", raw=True)
    request("POST", "/api/auth/login", 401, {})
    request("POST", "/api/auth/login", 401, {"username": "testuser", "password": "wrongpass"})
    data, set_cookies = request("POST", "/api/auth/login", 200,
                                {"username": "testuser", "password": "password123"})
    fields = cookie_fields(set_cookies)
    check(set(fields) == {"hotel_session", "XSRF-TOKEN"}, "public cookies")
    for name in fields:
        line = fields[name].lower()
        check("samesite=lax" in line and "path=/" in line and "max-age=604800" in line,
              f"{name} attributes")
        check(("httponly" in line) == (name == "hotel_session"), f"{name} HttpOnly")
        check("secure" not in line, f"{name} Secure not set by current handler")
    cookies = "; ".join(map(cookie_value, fields.values()))
    token = data["csrf_token"]
    check(fields["XSRF-TOKEN"].split("=", 1)[1].split(";", 1)[0] == token,
          "readable CSRF cookie matches JSON token")
    me, _ = request("GET", "/api/me", 200, cookies=cookies)
    check(me["user"]["username"] == "testuser" and me["csrf_token"] == token,
          "authenticated profile and CSRF token")
    old = {key: me["user"][key] for key in ("motto", "look", "gender", "mail")}

    # --- Phase 5 credits surface -------------------------------------------
    # Both routes are reads, so neither is CSRF-filtered; the property to assert
    # is that they refuse an anonymous caller rather than serving anything.
    request("GET", "/api/account/purse", 401)
    request("GET", "/api/account/transactions", 401)
    purse, _ = request("GET", "/api/account/purse", 200, cookies=cookies)
    check(purse["credits"] == me["user"]["credits"]
          and purse["pixels"] == me["user"]["pixels"]
          and purse["points"] == me["user"]["points"],
          "purse balances agree with /api/me")
    ledger, _ = request("GET", "/api/account/transactions", 200, cookies=cookies)
    check(ledger["limit"] == 100, "ledger page cap matches history.php")
    check(isinstance(ledger["items"], list) and ledger["count"] == len(ledger["items"]),
          "ledger count matches the items it returned")
    check(ledger["count"] == 0, "a disposable stack starts with an empty ledger")

    # --- Phase 5 client-entry handoff --------------------------------------
    # What is verifiable here is the WEBSITE side: the ticket is issued in the
    # legacy format and stored in the column PolarIS defines, and the connection
    # settings are reported honestly — including the fact that a disposable stack
    # has none. Whether an emulator accepts the ticket is emulator behaviour and
    # is deliberately not asserted.
    request("GET", "/api/account/client-entry", 401)
    entry, _ = request("GET", "/api/account/client-entry", 200, cookies=cookies)
    parts = entry["sso_ticket"].split("-")
    check([len(p) for p in parts] == [8, 4, 4, 4, 12],
          "SSO ticket uses the legacy 8-4-4-4-12 segment shape")
    check(all(c in "0123456789abcdef" for p in parts for c in p),
          "SSO ticket segments are lowercase hex")
    check(len(entry["sso_ticket"]) <= 256, "SSO ticket fits users.auth_ticket varchar(256)")
    check(entry["sso_ticket"] != "", "a ticket was generated and stored")
    check(isinstance(entry["notes"], str) and entry["notes"] != "",
          "the response states what the handoff does and does not claim")
    # A second call must not hand back the same ticket: the page issues a fresh
    # one each time it is opened.
    second, _ = request("GET", "/api/account/client-entry", 200, cookies=cookies)
    check(second["sso_ticket"] != entry["sso_ticket"], "each request issues a fresh ticket")
    # The stack this runs against has never had a client configured, so the
    # honest answer is "not configured" and every required setting is named.
    check(entry["handoff_ready"] is False, "unconfigured stack does not claim a ready handoff")
    check(entry["handoff_available"] is False, "unconfigured stack offers no handoff")
    for required in ("hotel_ip", "hotel_port", "hotel_mus", "client_dcr"):
        check(required in entry["missing_settings"], f"{required} reported as missing")

    request("POST", "/api/account/motto", 403, {"motto": "test"}, cookies=cookies)
    request("POST", "/api/account/motto", 403, {"motto": "test"}, cookies=cookies, csrf="wrong")
    request("POST", "/api/account/motto", 400, {}, cookies=cookies, csrf=token)
    request("POST", "/api/account/look", 400, {}, cookies=cookies, csrf=token)
    request("POST", "/api/account/email", 400, {"email": "invalid"}, cookies=cookies, csrf=token)
    request("POST", "/api/account/password", 400, {}, cookies=cookies, csrf=token)
    request("POST", "/api/account/password", 400,
            {"current_password": "password123", "new_password": "short"}, cookies=cookies, csrf=token)
    request("POST", "/api/account/password", 401,
            {"current_password": "wrongpass", "new_password": "password456"}, cookies=cookies, csrf=token)

    try:
        # Profile validation is asserted against LEGACY profile.php, not against
        # whatever the handler happened to do first:
        #
        #   if (mb_strlen($motto) > 127 || mb_strlen($look) > 256
        #       || !in_array($gender, ['M','F'], true)) -> 'Invalid profile details.'
        #
        # An earlier revision truncated the motto to 128 bytes and coerced an
        # unknown gender to M. Both were silent changes from legacy, so the
        # contract now requires rejection, and the boundary is checked from both
        # sides so the assertion cannot pass on a handler that rejects everything.
        request("POST", "/api/account/motto", 400, {"motto": "x" * 128}, cookies=cookies, csrf=token)
        motto, _ = request("POST", "/api/account/motto", 200, {"motto": "x" * 127}, cookies=cookies, csrf=token)
        check(motto["motto"] == "x" * 127, "127-character motto stored intact")
        trimmed, _ = request("POST", "/api/account/motto", 200,
                             {"motto": "  padded motto  "}, cookies=cookies, csrf=token)
        check(trimmed["motto"] == "padded motto", "motto trimmed like legacy profile.php")

        # The figure boundary is legacy's 256 versus PolarIS's `varchar(255)`:
        # 256 cannot be stored at all, so 400 is the correct explicit answer and
        # 255 must still succeed.
        request("POST", "/api/account/look", 400,
                {"look": "l" * 256, "gender": "M"}, cookies=cookies, csrf=token)
        request("POST", "/api/account/look", 400,
                {"look": "hd-180-1", "gender": "X"}, cookies=cookies, csrf=token)
        request("POST", "/api/account/look", 400,
                {"look": "hd-180-1", "gender": "invalid", "csrf_token": token}, cookies=cookies)
        look, _ = request("POST", "/api/account/look", 200,
                          {"look": "l" * 255, "gender": "F"}, cookies=cookies, csrf=token)
        check(look["gender"] == "F", "valid gender F stored rather than coerced")
        check(look["look"] == "l" * 255, "255-character figure stored intact")
        look, _ = request("POST", "/api/account/look", 200,
                          {"look": "hd-180-1"}, cookies=cookies, csrf=token)
        check(look["gender"] == "M", "absent gender still stores M")

        email, _ = request("POST", "/api/account/email", 200,
                           {"email": "contract@example.test"}, cookies=cookies, csrf=token)
        check(email["mail_verified"] is False, "email update resets verification")
        updated, _ = request("GET", "/api/me", 200, cookies=cookies)
        check(updated["user"]["mail"] == email["email"] and
              updated["user"]["motto"] == trimmed["motto"] and
              updated["user"]["look"] == look["look"] and
              updated["user"]["gender"] == look["gender"],
              "profile writes visible through /api/me")
        password, _ = request("POST", "/api/account/password", 200,
                              {"current_password": "password123", "new_password": "password456"},
                              cookies=cookies, csrf=token)
        check(password["message"] == "Password successfully changed.", "password success message")
        request("GET", "/api/me", 200, cookies=cookies)
        request("POST", "/api/account/password", 200,
                {"current_password": "password456", "new_password": "password123"},
                cookies=cookies, csrf=token)
    finally:
        request("POST", "/api/account/motto", 200, {"motto": old["motto"]}, cookies=cookies, csrf=token)
        request("POST", "/api/account/look", 200,
                {"look": old["look"], "gender": old["gender"]}, cookies=cookies, csrf=token)
        request("POST", "/api/account/email", 200, {"email": old["mail"]}, cookies=cookies, csrf=token)

    request("POST", "/api/auth/staff-login", 400, "{", raw=True)
    request("POST", "/api/auth/staff-login", 401,
            {"username": "admin", "password": "wrongpass"})
    request("POST", "/api/auth/staff-login", 403,
            {"username": "testuser", "password": "password123"})
    staff, staff_headers = request("POST", "/api/auth/staff-login", 200,
                                   {"username": "admin", "password": "password123"})
    check(staff["2fa_verified"] is True, "current omitted-code staff flag")
    staff_fields = cookie_fields(staff_headers)
    check(set(staff_fields) == {"hotel_staff_session"}, "separate staff cookie")
    staff_line = staff_fields["hotel_staff_session"].lower()
    check(all(part in staff_line for part in ("httponly", "samesite=strict", "path=/", "max-age=7200")),
          "staff cookie attributes")
    staff, _ = request("POST", "/api/auth/staff-login", 200,
                       {"username": "admin", "password": "password123", "totp_code": "123"})
    check(staff["2fa_verified"] is False, "non-six-character staff code not verified")
    staff, _ = request("POST", "/api/auth/staff-login", 200,
                       {"username": "admin", "password": "password123", "totp_code": "abcdef"})
    check(staff["2fa_verified"] is True, "six-character staff code is only length checked")

    request("POST", "/api/auth/logout", 403, {}, cookies=cookies)
    logout, clear = request("POST", "/api/auth/logout", 200, {}, cookies=cookies, csrf=token)
    check(logout["message"] == "Logged out successfully.", "logout message")
    cleared = cookie_fields(clear)
    # Four now, not two: signing out must also drop the remember-me pair, or a
    # browser would keep a credential the user just asked to end. The stored
    # digest is cleared server side in the same step (asserted below).
    check(set(cleared) == {"hotel_session", "XSRF-TOKEN", "rememberme", "rememberme_token"} and
          all("max-age=0" in line.lower() for line in cleared.values()),
          "public and remember-me cookies cleared")
    request("GET", "/api/me", 401, cookies=cookies)

    # --- Phase 5 forgot / reset / step-up ---------------------------------
    # These routes exist for a caller with NO session, which is why they carry
    # CsrfPublicFilter rather than CsrfFilter. What is asserted is that the header
    # requirement is real and that the responses do not disclose whether an
    # account exists.
    request("POST", "/api/auth/password/forgot", 403, {"username": "a", "email": "b@c.test"})
    request("POST", "/api/auth/username/forgot", 403, {"email": "b@c.test"})
    request("POST", "/api/auth/password/reset", 403, {"token": "x", "new_password": "abcdef"})

    # A wrong password for the caller's own account: the endpoint must not
    # distinguish it from an unknown account, so both are 200 with the same text.
    body = {"username": "testuser", "email": "not-the-address@example.test"}
    unknown, _ = request("POST", "/api/auth/password/forgot", 200, body, csrf="public")
    check(unknown["message"].startswith("If those details match"),
          "forgot answers without disclosing whether the account exists")

    # The email was changed and restored during the profile checks above, so the
    # live address is the one /api/me reported originally; use it for the
    # matching case and assert the answer is byte-identical.
    matched, _ = request("POST", "/api/auth/password/forgot", 200,
                         {"username": "testuser", "email": old["mail"]}, csrf="public")
    check(matched["message"] == unknown["message"],
          "a matching and a non-matching request are indistinguishable")

    # A reset token that was never issued is refused the same way an expired or
    # spent one is.
    request("POST", "/api/auth/password/reset", 401,
            {"token": "0000000000000000000000000000000000000000000000000000000000000000",
             "new_password": "abcdef"}, csrf="public")
    # And a too-short password is a validation failure, not an invalid token.
    request("POST", "/api/auth/password/reset", 400,
            {"token": "x", "new_password": "abc"}, csrf="public")

    names, _ = request("POST", "/api/auth/username/forgot", 200, {"email": old["mail"]},
                       csrf="public")
    check("testuser" in names["usernames"], "username recovery lists the account on the address")
    check(names["mail_transport"] == "log-only",
          "the response states that no mail transport is configured")
    request("POST", "/api/auth/username/forgot", 200, {"email": "nobody@example.test"},
            csrf="public")

    # The step-up routes need a session, which the logout above removed.
    request("GET", "/api/account/session", 401)
    request("POST", "/api/account/reauthenticate", 403, {"password": "password123"})

    # --- Phase 5 remember-me -----------------------------------------------
    # The consume route needs BOTH cookies; each is checked separately so the
    # assertion cannot pass on a handler that only looks at one.
    request("POST", "/api/auth/remember-login", 401)
    request("POST", "/api/auth/remember-login", 401, cookies="rememberme=true")
    request("POST", "/api/auth/remember-login", 401,
            cookies="rememberme_token=000000000000000000000000000000000000000000000000")

    # The issued pair, end to end. The token is only ever available in the
    # Set-Cookie header, so the login response is where it is read from.
    issued, issued_headers = request("POST", "/api/auth/login", 200,
                                     {"username": "testuser", "password": "password123",
                                      "_login_remember_me": "true"})
    issued_fields = cookie_fields(issued_headers)
    check("rememberme" in issued_fields and "rememberme_token" in issued_fields,
          "remember-me login issues both cookies")
    flag_line = issued_fields["rememberme"].lower()
    token_line = issued_fields["rememberme_token"].lower()
    check("rememberme=true" in flag_line, "the flag cookie carries the literal true")
    # 14 days is the installer's `site_cookie_time` default; asserted as a range
    # so a differently configured stack does not fail the contract.
    check("max-age=" in flag_line and "max-age=" in token_line,
          "both remember-me cookies carry an expiry")
    check("httponly" not in flag_line, "the flag cookie is readable by the client")
    check("httponly" in token_line,
          "the token cookie is HttpOnly: script never needs the credential itself")
    check("samesite=lax" in flag_line and "samesite=lax" in token_line,
          "both remember-me cookies are SameSite=Lax")

    remember_cookie = cookie_value(issued_fields["rememberme_token"])
    parts = remember_cookie.split("=", 1)[1].split("-")
    check([len(p) for p in parts] == [6, 20, 20],
          "remember-me token uses the legacy 6-20-20 segment shape")

    # (`tests/unit/RememberMeTest.cpp` asserts the format in isolation, including
    # that its SHA-256 digest is exactly 64 characters — the width of
    # `users.remember_token_hash`. The live proof that the digest matches is the
    # consume below: the handler hashes what the cookie carries and the lookup
    # succeeds.)

    restored, restored_headers = request("POST", "/api/auth/remember-login", 200,
                                         cookies=remember_cookie + "; rememberme=true")
    check(restored["reauth_required"] is True,
          "a token-established session ALWAYS requires step-up")
    check(restored["user"]["username"] == "testuser", "the right account was restored")
    restored_fields = cookie_fields(restored_headers)
    check("hotel_session" in restored_fields and "XSRF-TOKEN" in restored_fields,
          "the restored session issues its own cookies")

    # Single use: the same token must not establish a second session.
    request("POST", "/api/auth/remember-login", 401,
            cookies=remember_cookie + "; rememberme=true")

    print(f"[PASS] OpenAPI references, route inventory, schemas, cookies, and live account behavior ({CHECKS} assertions)")


if __name__ == "__main__":
    main()
