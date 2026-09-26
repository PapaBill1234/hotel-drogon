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
    }
    actual = {(path, method) for path, methods in SPEC["paths"].items()
              for method in methods if method in ("get", "post", "put", "delete", "patch", "options")}
    check(actual == expected, "first slice has eight paths and ten explicit operations")
    headers = "\n".join((ROOT / "include/controllers" / name).read_text(encoding="utf-8")
                        for name in ("AuthController.h", "AccountController.h"))
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
    check(set(cleared) == {"hotel_session", "XSRF-TOKEN"} and
          all("max-age=0" in line.lower() for line in cleared.values()), "public cookies cleared")
    request("GET", "/api/me", 401, cookies=cookies)
    print(f"[PASS] OpenAPI references, route inventory, schemas, cookies, and live account behavior ({CHECKS} assertions)")


if __name__ == "__main__":
    main()
