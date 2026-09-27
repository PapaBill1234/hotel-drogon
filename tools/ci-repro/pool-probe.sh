#!/bin/sh
# One concurrent save pair, then measure. Answers a single question:
#   - if the pool recovers once a THIRD connection exists, the pin is starvation
#     (two transactions + a follow-up read needing a connection of its own);
#   - if it does not recover, the pair leaves a connection checked out for good.
# Run at cap=2 and again at cap=3; the difference is the answer.
BASE="${1:?base url}"
DB="${2:?mariadb container}"
T="$(mktemp -d)"

occ() {
  docker exec "$DB" mysql -uroot -proot_secret -N -B -e \
    "SELECT CONCAT('conns=', COUNT(*), ' ids=', GROUP_CONCAT(id ORDER BY id), ' sleeping=', SUM(command='Sleep'), ' trx=', (SELECT COUNT(*) FROM information_schema.innodb_trx)) FROM information_schema.processlist WHERE user='hotel';" 2>/dev/null
}

curl -s -o /dev/null -D "$T/hdr" -X POST -H 'Content-Type: application/json' \
     --data-binary '{"username":"testuser","password":"password123"}' "$BASE/api/auth/login"
COOKIES=$(awk '/^[Ss]et-[Cc]ookie:/ {sub(/^[Ss]et-[Cc]ookie:[ \t]*/,""); sub(/;.*/,""); gsub(/\r/,""); printf "%s; ", $0}' "$T/hdr")
XSRF=$(printf '%s' "$COOKIES" | tr ';' '\n' | sed -n 's/^[ \t]*XSRF-TOKEN=//p' | head -1)
echo "before race:  $(occ)"

curl -s -o "$T/sess" -X POST -H "Cookie: $COOKIES" -H "X-XSRF-TOKEN: $XSRF" "$BASE/api/homes/2/edit-session"
TOK=$(sed -n 's/.*"token":"\([^"]*\)".*/\1/p' "$T/sess")
curl -s -o "$T/layout" -H "Cookie: $COOKIES" "$BASE/api/homes/2/layout"
VER=$(tr ',' '\n' < "$T/layout" | sed -n 's/.*"version":\([0-9]*\).*/\1/p' | head -1)
WID=$(tr '{' '\n' < "$T/layout" | grep -F '"widget_key":"profilewidget"' | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)
# A widget must exist for the move to be legal; add one if the home is default.
if [ -z "$WID" ] || [ "$WID" = "0" ]; then
  curl -s -o /dev/null -X POST -H "Cookie: $COOKIES" -H "X-XSRF-TOKEN: $XSRF" \
       -H 'Content-Type: application/json' --data-binary '{"widget_key":"profilewidget","column":1}' \
       "$BASE/api/homes/2/widgets"
  curl -s -o "$T/layout" -H "Cookie: $COOKIES" "$BASE/api/homes/2/layout"
  VER=$(tr ',' '\n' < "$T/layout" | sed -n 's/.*"version":\([0-9]*\).*/\1/p' | head -1)
  WID=$(tr '{' '\n' < "$T/layout" | grep -F '"widget_key":"profilewidget"' | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)
fi
echo "version=$VER widget=$WID   $(occ)"

printf '{"version":%s,"lock_token":"%s","widgets":[{"id":%s,"column":1,"position":3}]}' "$VER" "$TOK" "$WID" > "$T/a.json"
printf '{"version":%s,"lock_token":"%s","widgets":[{"id":%s,"column":2,"position":4}]}' "$VER" "$TOK" "$WID" > "$T/b.json"

curl -s --max-time 8 -o /dev/null -w 'A=%{http_code} %{time_total}s\n' -X PUT -H "Cookie: $COOKIES" \
     -H "X-XSRF-TOKEN: $XSRF" -H 'Content-Type: application/json' --data-binary "@$T/a.json" \
     "$BASE/api/homes/2/layout" > "$T/a.out" &
pa=$!
curl -s --max-time 8 -o /dev/null -w 'B=%{http_code} %{time_total}s\n' -X PUT -H "Cookie: $COOKIES" \
     -H "X-XSRF-TOKEN: $XSRF" -H 'Content-Type: application/json' --data-binary "@$T/b.json" \
     "$BASE/api/homes/2/layout" > "$T/b.out" &
pb=$!
wait $pa; wait $pb
echo "race results: $(cat "$T/a.out") | $(cat "$T/b.out")"
echo "right after:  $(occ)"

sleep 15
echo "after 15s:    $(occ)"
r=$(curl -s --max-time 6 -o /dev/null -w '%{http_code} %{time_total}s' -H "Cookie: $COOKIES" "$BASE/api/homes/2/layout")
echo "follow-up read: $r"
rm -rf "$T"
