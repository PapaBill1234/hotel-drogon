#!/usr/bin/env python3
"""Static guard for the read-only v4 presentation and draft policy seams."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
controller_header = (ROOT / "include/controllers/PresentationValidationController.h").read_text()
controller = (ROOT / "src/controllers/PresentationValidationController.cpp").read_text()
validator = (ROOT / "src/services/PresentationValidationService.cpp").read_text()
draft_contract = (ROOT / "src/services/PresentationDraftContract.cpp").read_text()
draft_outcome = (ROOT / "src/services/PresentationDraftOutcome.cpp").read_text()
draft_policy = (ROOT / "src/services/PresentationDraftPolicy.cpp").read_text()
draft_transaction = (ROOT / "src/services/PresentationDraftTransaction.cpp").read_text()

checks = [
    ('validation route is registered', '"/api/admin/presentation/validate"' in controller_header),
    ('staff gate is explicit', 'requireStaff' in controller),
    ('CSRF filter is present', 'hotel::filters::CsrfFilter' in controller_header),
    ('validator is used', 'PresentationValidationService::validate' in controller),
    ('validation is read-only', 'read_only' in controller and 'ContentService' not in controller and 'AuditService' not in controller),
    ('validator has no database client', 'DbClient' not in validator and 'drogon::app' not in validator),
    ('draft kinds and keys are closed', 'kind == "navigation"' in draft_contract and 'isKnownPublicRoute' in draft_contract),
    ('draft base revision is bounded', 'based_on' in draft_contract and '1000000000U' in draft_contract),
    ('payload base and document revisions must match', 'payload revision must equal based_on' in draft_contract),
    ('serialized draft payload is capped', 'kMaxPayloadBytes' in draft_policy and '256 KiB' in draft_policy),
    ('audit text rejects controls and is bounded', 'validAuditDetail' in draft_policy and 'c < 0x20' in draft_policy),
    ('conflict outcome preserves current revision', 'currentRevision' in draft_transaction and 'currentRevision' in draft_outcome),
    ('audit and transaction failure map unavailable', 'auditSucceeded' in draft_transaction and 'committed' in draft_transaction),
    ('draft policy and transaction classifiers are pure', all(token not in draft_policy + draft_transaction for token in ('DbClient', 'drogon::app', 'INSERT ', 'UPDATE '))),
]
failed = [name for name, ok in checks if not ok]
if failed:
    for name in failed:
        print(f'[FAIL] {name}')
    raise SystemExit(1)
print(f'[PASS] presentation and draft contract seams ({len(checks)} assertions)')
