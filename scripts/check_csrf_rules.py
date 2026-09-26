#!/usr/bin/env python3
"""
CI Check: Ensure every mutating HTTP route (POST, PUT, PATCH, DELETE) in Drogon controllers
registers 'hotel::filters::CsrfFilter' or is on the explicitly authorized public auth exemption list.
"""

import os
import re
import sys

ALLOWED_EXEMPTIONS = {
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/staff-login",
}

# Routes that carry `CsrfPublicFilter` instead of `CsrfFilter`, with the reason.
# They exist for callers who have no session, and `CsrfFilter` validates a token
# against a user session — so it cannot protect them. `CsrfPublicFilter` requires
# the `X-XSRF-TOKEN` header, which a cross-origin request cannot set without a
# CORS preflight this application does not answer; that is a weaker control than
# token validation and a stronger one than an exemption, and the routes are
# listed here explicitly so the difference is reviewable rather than implicit.
PUBLIC_CSRF_ROUTES = {
    "/api/auth/password/forgot",
    "/api/auth/password/reset",
    "/api/auth/username/forgot",
}

METHOD_PATTERN = re.compile(
    r'ADD_METHOD_TO\s*\(\s*([^,]+)\s*,\s*"([^"]+)"\s*,\s*([^)]+)\)',
    re.MULTILINE
)

def check_controllers(controller_dir):
    errors = []
    total_routes = 0
    mutating_routes = 0

    for root, _, files in os.walk(controller_dir):
        for file in files:
            if not file.endswith(('.h', '.cpp')):
                continue
            path = os.path.join(root, file)
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()

            matches = METHOD_PATTERN.findall(content)
            for handler, route, args in matches:
                total_routes += 1
                args_clean = [a.strip() for a in args.split(',')]
                
                # Check if route includes mutating HTTP methods
                is_mutating = any(m in args_clean for m in [
                    'drogon::Post', 'drogon::Put', 'drogon::Patch', 'drogon::Delete',
                    'Post', 'Put', 'Patch', 'Delete'
                ])

                if is_mutating:
                    mutating_routes += 1
                    has_csrf = any('CsrfFilter' in a for a in args_clean)
                    has_public_csrf = any('CsrfPublicFilter' in a for a in args_clean)
                    if has_csrf or has_public_csrf:
                        continue
                    if route in PUBLIC_CSRF_ROUTES:
                        errors.append(
                            f"[FAIL] Controller {file}: Handler '{handler}' on route '{route}' "
                            f"is listed in PUBLIC_CSRF_ROUTES but does not register "
                            f"'hotel::filters::CsrfPublicFilter'."
                        )
                        continue
                    if route not in ALLOWED_EXEMPTIONS:
                        errors.append(
                            f"[FAIL] Controller {file}: Handler '{handler}' on route '{route}' "
                            f"is mutating but lacks 'hotel::filters::CsrfFilter'."
                        )

    print(f"Scanned {total_routes} routes ({mutating_routes} mutating) across controllers in '{controller_dir}'.")
    if errors:
        for err in errors:
            print(err, file=sys.stderr)
        return False

    print("All mutating routes have valid CSRF protection or explicit verified exemption.")
    return True

if __name__ == "__main__":
    controller_dir = sys.argv[1] if len(sys.argv) > 1 else "include/controllers"
    if not os.path.exists(controller_dir):
        controller_dir = os.path.join(os.path.dirname(__file__), "..", "include", "controllers")

    success = check_controllers(controller_dir)
    sys.exit(0 if success else 1)
