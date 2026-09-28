#!/bin/sh
# Disposable MariaDB evidence for the v4 draft transaction contract.
#
# This is deliberately a test-only harness. It creates uniquely named tables in
# the explicitly supplied disposable database, proves named draft/audit SQL
# semantics, and removes those tables on every exit. It does not install the
# proposed production table, alter startup DDL, or expose a generic writer.
#
# Usage:
#   sh scripts/check_draft_transaction_db.sh \
#     ci-presentation-mariadb-1 ci-presentation polaris hotel hotel_secret
#
# The project label is checked before any SQL is sent. Never point this at the
# primary hotel_mariadb container.

set -u

CONTAINER="${1:-}"
PROJECT="${2:-}"
DATABASE="${3:-polaris}"
DB_USER="${4:-hotel}"
DB_PASSWORD="${5:-hotel_secret}"

if [ -z "$CONTAINER" ] || [ -z "$PROJECT" ]; then
    echo "usage: $0 CONTAINER COMPOSE_PROJECT [DATABASE] [USER] [PASSWORD]" >&2
    exit 2
fi

label="$(docker inspect --format='{{index .Config.Labels "com.docker.compose.project"}}' "$CONTAINER" 2>/dev/null || true)"
service="$(docker inspect --format='{{index .Config.Labels "com.docker.compose.service"}}' "$CONTAINER" 2>/dev/null || true)"
if [ "$label" != "$PROJECT" ] || [ "$service" != "mariadb" ]; then
    echo "refusing database evidence: container '$CONTAINER' has project='$label' service='$service', expected project='$PROJECT' service='mariadb'" >&2
    exit 1
fi

mysql() {
    docker exec "$CONTAINER" mysql --protocol=TCP -u"$DB_USER" -p"$DB_PASSWORD" "$DATABASE" "$@"
}

suffix="draft_evidence_$$_$(date +%s)"
drafts="${suffix}_drafts"
audit="${suffix}_audit"
work="$(mktemp -d)"
PASS=0
FAIL=0

pass() { printf '  PASS  %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf '  FAIL  %s\n' "$1"; FAIL=$((FAIL + 1)); }

cleanup() {
    mysql -e "DROP TABLE IF EXISTS $audit, $drafts;" >/dev/null 2>&1 || true
    rm -rf "$work"
}
trap cleanup EXIT INT TERM

# Identifiers are generated locally and contain only [a-z0-9_]. They are not
# derived from request data and are interpolated only after the label guard.
mysql -e "
CREATE TABLE $drafts (
  document_kind VARCHAR(16) NOT NULL,
  document_key VARCHAR(128) NOT NULL,
  revision INT UNSIGNED NOT NULL,
  payload JSON NOT NULL,
  updated_by INT UNSIGNED NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (document_kind, document_key)
) ENGINE=InnoDB;
CREATE TABLE $audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_kind VARCHAR(16) NOT NULL,
  document_key VARCHAR(128) NOT NULL,
  revision INT UNSIGNED NOT NULL,
  detail VARCHAR(128) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;
INSERT INTO $drafts VALUES ('page','/community',0,'{\"value\":\"before\"}',7,1),('page','/articles',0,'{\"value\":\"separate\"}',7,1);
" >/dev/null || { echo "failed to create disposable evidence tables" >&2; exit 1; }

# One document's CAS update is held open briefly while a second transaction
# attempts the same base revision. InnoDB serializes the row and exactly one
# writer can observe affected_rows=1.
cat > "$work/winner.sql" <<SQL
START TRANSACTION;
UPDATE $drafts SET revision=1,payload='{"value":"winner"}',updated_by=7,updated_at=2 WHERE document_kind='page' AND document_key='/community' AND revision=0;
SELECT ROW_COUNT();
SELECT SLEEP(1);
INSERT INTO $audit (document_kind,document_key,revision,detail) VALUES ('page','/community',1,'draft save revision 1');
COMMIT;
SQL
cat > "$work/loser.sql" <<SQL
START TRANSACTION;
UPDATE $drafts SET revision=1,payload='{"value":"loser"}',updated_by=8,updated_at=3 WHERE document_kind='page' AND document_key='/community' AND revision=0;
SELECT ROW_COUNT();
ROLLBACK;
SQL
mysql --batch --skip-column-names < /dev/null >/dev/null 2>&1 || true
(docker exec -i "$CONTAINER" mysql --protocol=TCP --batch --skip-column-names -u"$DB_USER" -p"$DB_PASSWORD" "$DATABASE" < "$work/winner.sql" > "$work/winner.out" 2>"$work/winner.err") &
winner_pid=$!
sleep 0.15
(docker exec -i "$CONTAINER" mysql --protocol=TCP --batch --skip-column-names -u"$DB_USER" -p"$DB_PASSWORD" "$DATABASE" < "$work/loser.sql" > "$work/loser.out" 2>"$work/loser.err")
loser_status=$?
wait "$winner_pid"; winner_status=$?

winner_rows="$(sed -n '1p' "$work/winner.out" | tr -d '\r')"
loser_rows="$(sed -n '1p' "$work/loser.out" | tr -d '\r')"
if [ "$winner_status" -eq 0 ] && [ "$winner_rows" = "1" ]; then pass "CAS winner updates exactly one row"; else fail "CAS winner status=$winner_status rows='$winner_rows'"; fi
if [ "$loser_status" -eq 0 ] && [ "$loser_rows" = "0" ]; then pass "concurrent stale writer updates zero rows"; else fail "concurrent stale writer status=$loser_status rows='$loser_rows'"; fi

state="$(mysql --batch --skip-column-names -e "SELECT revision, JSON_UNQUOTE(JSON_EXTRACT(payload,'$.value')), (SELECT COUNT(*) FROM $audit) FROM $drafts WHERE document_kind='page' AND document_key='/community';" | tr -d '\r')"
if [ "$state" = "1$(printf '\twinner\t1')" ]; then pass "CAS leaves winner payload, revision, and one audit row"; else fail "CAS final state was '$state'"; fi

# An audit failure is forced inside the same transaction. The NOT NULL error is
# expected; the explicit rollback must leave both the draft and audit count at
# their pre-mutation values.
set +e
mysql -e "START TRANSACTION; UPDATE $drafts SET revision=2,payload='{\"value\":\"must-rollback\"}' WHERE document_kind='page' AND document_key='/community' AND revision=1; INSERT INTO $audit (document_kind,document_key,revision,detail) VALUES ('page','/community',2,NULL); ROLLBACK;" >"$work/audit-failure.out" 2>&1
failure_status=$?
set -e
rollback_state="$(mysql --batch --skip-column-names -e "SELECT revision, JSON_UNQUOTE(JSON_EXTRACT(payload,'$.value')), (SELECT COUNT(*) FROM $audit) FROM $drafts WHERE document_kind='page' AND document_key='/community';" | tr -d '\r')"
if [ "$failure_status" -ne 0 ]; then pass "audit failure is surfaced by MariaDB"; else fail "audit failure unexpectedly succeeded"; fi
if [ "$rollback_state" = "1$(printf '\twinner\t1')" ]; then pass "audit failure rolls draft and audit mutation back"; else fail "rollback final state was '$rollback_state'"; fi

# A different document key must remain independent of the raced document.
isolated="$(mysql --batch --skip-column-names -e "SELECT revision, JSON_UNQUOTE(JSON_EXTRACT(payload,'$.value')) FROM $drafts WHERE document_kind='page' AND document_key='/articles';" | tr -d '\r')"
if [ "$isolated" = "0$(printf '\tseparate')" ]; then pass "document keys remain isolated"; else fail "isolated document state was '$isolated'"; fi

printf '\nDraft transaction DB evidence: %s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
