#!/bin/sh
# Latency and connection sampler for the browser-suite diagnostics.
#
# One line per second: connection occupancy as
#   total/sleeping/open-transactions
# and the latency of /health (no database) and /api/homes/2/layout (database),
# so the moment the suite stalls can be lined up with what the database and the
# pool were doing. Idle `Sleep` connections are the normal steady state and are
# recorded, not treated as a fault.
BASE="${1:?base url}"
DB="${2:?mariadb container}"
OUT="${3:?output file}"
ROUNDS="${4:-600}"

: > "$OUT"
i=0
while [ "$i" -lt "$ROUNDS" ]; do
  ts=$(date +%H:%M:%S)
  occ=$(docker exec "$DB" mysql -uroot -proot_secret -N -B -e \
    "SELECT CONCAT(COUNT(*), '/', SUM(command='Sleep'), '/', (SELECT COUNT(*) FROM information_schema.innodb_trx)) FROM information_schema.processlist WHERE user='hotel';" 2>/dev/null)
  h=$(curl -s --max-time 3 -o /dev/null -w '%{http_code}:%{time_total}' "$BASE/health" 2>/dev/null)
  l=$(curl -s --max-time 3 -o /dev/null -w '%{http_code}:%{time_total}' "$BASE/api/homes/2/layout" 2>/dev/null)
  printf '%s conns=%s health=%s layout=%s\n' "$ts" "$occ" "$h" "$l" >> "$OUT"
  i=$((i + 1))
  sleep 1
done
