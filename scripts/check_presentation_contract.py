#!/usr/bin/env python3
"""Static guard for the read-only v4 presentation validation seam."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
controller = (ROOT / "include/controllers/PresentationValidationController.h").read_text()
source = (ROOT / "src/controllers/PresentationValidationController.cpp").read_text()
service = (ROOT / "src/services/PresentationValidationService.cpp").read_text()

checks = [
    ('route is registered', '"/api/admin/presentation/validate"' in controller),
    ('staff gate is explicit', 'requireStaff' in source),
    ('CSRF filter is present', 'hotel::filters::CsrfFilter' in controller),
    ('validator is used', 'PresentationValidationService::validate' in source),
    ('validation is read-only', 'read_only' in source and 'ContentService' not in source and 'AuditService' not in source),
    ('validator has no database client', 'DbClient' not in service and 'drogon::app' not in service),
]
failed = [name for name, ok in checks if not ok]
if failed:
    for name in failed:
        print(f'[FAIL] {name}')
    raise SystemExit(1)
print(f'[PASS] presentation contract seam ({len(checks)} assertions)')
