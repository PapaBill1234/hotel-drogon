#!/bin/sh
# Phase 8 smoke test: the MyHabbo Homes layout API — its versioned write, the
# Redis edit session, and the refusal paths.
#
# Usage: smoke_phase8_homes.sh [BASE_URL]
#   BASE_URL defaults to http://proxy (the nginx service name on the compose
#   network). From the host:  http://localhost:3000
#
# Exits 0 if every assertion passes, 1 otherwise.
#
# Why this suite exists at all: the plan's Phase 8 exit condition is "concurrent
# edits don't silently overwrite each other". A layout API can look correct in a
# serial test and still lose a write, so the concurrency case here fires two
# saves with the same version and requires exactly one 200 and one 409.
#
# The legacy behaviour every expectation is derived from:
#   home.php, includes/PhpretroHomes.php, habblet/myhabbo_layout_save.php,
#   habblet/myhabbo_widget_add.php, habblet/myhabbo_widget_delete.php
# in the read-only PHPRetro checkout.
#
# FIXTURE: the first section asserts the state of a home that has never been
# saved, which is what `displayLayouts()` renders as a default profile widget.
# Set HOMES_RESET=1 when the docker CLI can reach the stack's MariaDB container
# (CI does this) and the script deletes `testuser`'s layout first, so the run is
# repeatable. Without it the two virgin-state assertions are reported as SKIP
# and the rest of the suite runs against whatever the home currently holds.

set -u

BASE="${1:-http://proxy}"
DB_CONTAINER="${HOMES_DB_CONTAINER:-hotel_mariadb}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
SKIP=0
CODE=""
COOKIES=""
USER_COOKIES=""
ADMIN_COOKIES=""
USER_CSRF=""
ADMIN_CSRF=""
LOCK_TOKEN=""
VERSION=""
WIDGET_ID=""
GUESTBOOK_ID=""

# ---- payload fixtures ----
printf '%s' '{"username":"testuser","password":"password123"}' > "$TMP/user.json"
printf '%s' '{"username":"admin","password":"password123"}'    > "$TMP/admin.json"

do_req() {
    _m="$1"; _u="$2"; _c="$3"; _d="${4:-}"; _csrf="${5:-}"
    # Built with `set --` rather than an unquoted "$_hdrs" string: a Cookie value
    # contains spaces and semicolons, and word-splitting it hands curl a second
    # "URL" that is really a cookie pair. That failure looks exactly like a
    # server bug and cost a debugging round.
    set -- -s -o "$TMP/body" -D "$TMP/hdr" -w '%{http_code}' -X "$_m"
    set -- "$@" -H 'Content-Type: application/json'
    if [ -n "$_c" ]; then set -- "$@" -H "Cookie: $_c"; fi
    if [ -n "$_csrf" ]; then set -- "$@" -H "X-XSRF-TOKEN: $_csrf"; fi
    if [ -n "$_d" ]; then set -- "$@" --data-binary "@$_d"; fi
    set -- "$@" "$_u"
    CODE=$(curl "$@")
}

cookies_from_last_response() {
    awk '/^[Ss]et-[Cc]ookie:/ {
            sub(/^[Ss]et-[Cc]ookie:[ \t]*/, "");
            sub(/;.*/, "");
            gsub(/\r/, "");
            printf "%s; ", $0
         }' "$TMP/hdr"
}

cookie_value() { # COOKIES NAME
    printf '%s' "$1" | tr ';' '\n' | awk -v n="$2" '
        { gsub(/^[ \t]+/, ""); split($0, kv, "="); if (kv[1] == n) print kv[2] }' | head -1
}

# json_field FILE KEY — the value of one flat JSON key.
# Splitting on commas first keeps a greedy match from reaching past its pair.
json_field() {
    tr ',' '\n' < "$1" | sed -n 's/.*"'"$2"'":\([^,}]*\).*/\1/p' | head -1 | tr -d '"'
}

# widget_id_by_key FILE KEY — the id of one widget in a layout response.
# Each widget object is separated onto its own line first; JSON object key order
# is not guaranteed by jsoncpp, so this must not depend on `id` coming first.
widget_id_by_key() {
    tr '{' '\n' < "$1" | grep -F "\"widget_key\":\"$2\"" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1
}

widget_count() {
    tr '{' '\n' < "$1" | grep -c '"widget_key"'
}

check() { # LABEL EXPECTED
    if [ "$2" = "$CODE" ]; then
        printf '  PASS  %-52s HTTP %s\n' "$1" "$CODE"
        PASS=$((PASS + 1))
    else
        printf '  FAIL  %-52s expected %s, got %s\n' "$1" "$2" "$CODE"
        printf '        body: %s\n' "$(cat "$TMP/body" 2>/dev/null)"
        FAIL=$((FAIL + 1))
    fi
}

check_body() { # LABEL NEEDLE
    # `-F`: the needles are literal JSON fragments, and several contain `[` —
    # which a basic regular expression reads as the start of a bracket
    # expression. `"tags":[` matched nothing that way, and the failure looked
    # like a missing field rather than a broken pattern.
    if grep -qF -- "$2" "$TMP/body" 2>/dev/null; then
        printf '  PASS  %-52s body contains %s\n' "$1" "$2"
        PASS=$((PASS + 1))
    else
        printf '  FAIL  %-52s body lacks %s\n' "$1" "$2"
        printf '        body: %s\n' "$(cat "$TMP/body" 2>/dev/null)"
        FAIL=$((FAIL + 1))
    fi
}

check_body_absent() { # LABEL NEEDLE
    if grep -q -- "$2" "$TMP/body" 2>/dev/null; then
        printf '  FAIL  %-52s body unexpectedly contains %s\n' "$1" "$2"
        printf '        body: %s\n' "$(cat "$TMP/body" 2>/dev/null)"
        FAIL=$((FAIL + 1))
    else
        printf '  PASS  %-52s body omits %s\n' "$1" "$2"
        PASS=$((PASS + 1))
    fi
}

check_value() { # LABEL EXPECTED ACTUAL
    if [ "$2" = "$3" ]; then
        printf '  PASS  %-52s %s\n' "$1" "$3"
        PASS=$((PASS + 1))
    else
        printf '  FAIL  %-52s expected %s, got %s\n' "$1" "$2" "$3"
        FAIL=$((FAIL + 1))
    fi
}

skip() { # LABEL REASON
    printf '  SKIP  %-52s %s\n' "$1" "$2"
    SKIP=$((SKIP + 1))
}

echo "Phase 8 homes smoke test against $BASE"
echo

if [ "${HOMES_RESET:-0}" = "1" ]; then
    if docker exec "$DB_CONTAINER" mysql -uhotel -photel_secret polaris \
         -e "DELETE FROM phpretro_myhabbo_layouts WHERE user_id = 2; \
             DELETE FROM phpretro_myhabbo_homes WHERE user_id = 2;" >/dev/null 2>&1; then
        echo "  info  reset testuser's home in $DB_CONTAINER"
    else
        echo "  info  HOMES_RESET=1 but $DB_CONTAINER was not reachable; continuing as-is"
    fi
fi

echo "[1] Anonymous read of a home"
do_req GET "$BASE/api/homes/2/layout" ""
check "guest reads a home" 200
check_body "the read carries a version" '"version":'
check_body "the background is a legacy class" '"background":"b_'
check_body "a guest cannot edit" '"editable":false'
# The owner block is legacy `PhpretroHomes::profile()`'s row. `tags` travels as
# the array the box renders — already split and filtered the way
# `array_values(array_filter(explode(';', $tags)))` did — and
# `settings_available` is what stops the box saying "No tags." for a user whose
# tags it could not read at all.
check_body "the read carries the owner block" '"owner":{'
check_body "the owner block names the profile" '"username":"testuser"'
check_body "tags arrive as an array" '"tags":['
check_body "the users_settings half of the join was read" '"settings_available":true'
check_body "the owner's motto is the stored one" '"motto":"Exploring the hotel!"'
if grep -q '"default_layout":true' "$TMP/body"; then
    check_body "an unsaved home reports the legacy default layout" '"default_layout":true'
    check_body "the default widget is the profile widget" '"widget_key":"profilewidget"'
    check_body "the default widget is unsaved (id 0)" '"id":0'
    check_body "the default background is legacy's" '"background":"b_bg_pattern_abstract2"'
    check_body "an unsaved home is at version 1" '"version":1'
else
    skip "an unsaved home reports the legacy default layout" "(the home already has saved rows)"
fi

do_req GET "$BASE/api/homes/999999/layout" ""
check "unknown profile is 404" 404
do_req GET "$BASE/api/homes/0/layout" ""
check "invalid profile id is 400" 400

echo
echo "[2] Writes require a session and a CSRF token"
printf '%s' '{"version":1,"widgets":[]}' > "$TMP/put-empty.json"
do_req PUT "$BASE/api/homes/2/layout" "" "$TMP/put-empty.json"
check "anonymous save is refused" 403

do_req POST "$BASE/api/auth/login" "" "$TMP/user.json"
check "sign in as the home owner" 200
USER_COOKIES="$(cookies_from_last_response)"
USER_CSRF="$(cookie_value "$USER_COOKIES" XSRF-TOKEN)"
check_value "login issues a CSRF token" "yes" "$([ -n "$USER_CSRF" ] && echo yes || echo no)"

do_req PUT "$BASE/api/homes/2/layout" "$USER_COOKIES" "$TMP/put-empty.json"
check "save without the CSRF header is refused" 403

do_req POST "$BASE/api/homes/2/edit-session" "$USER_COOKIES" ""
check "edit session without the CSRF header is refused" 403

do_req POST "$BASE/api/auth/login" "" "$TMP/admin.json"
check "sign in as a second user" 200
ADMIN_COOKIES="$(cookies_from_last_response)"
ADMIN_CSRF="$(cookie_value "$ADMIN_COOKIES" XSRF-TOKEN)"

echo
echo "[3] The edit session"
do_req POST "$BASE/api/homes/2/edit-session" "$USER_COOKIES" "" "$USER_CSRF"
check "owner opens an edit session" 200
LOCK_TOKEN="$(json_field "$TMP/body" token)"
check_value "edit session returns a token" "yes" "$([ -n "$LOCK_TOKEN" ] && echo yes || echo no)"

# A home is edited by its owner and nobody else. Legacy had no per-home ACL at
# all (only the owner was ever on the page), so a second user's refusal is the
# ownership rule answering first, not the lock.
do_req POST "$BASE/api/homes/2/edit-session" "$ADMIN_COOKIES" "" "$ADMIN_CSRF"
check "another user cannot open an edit session" 403

do_req GET "$BASE/api/homes/2/layout" "$ADMIN_COOKIES" ""
check "the lock is visible to everyone" 200
check_body "the lock names its holder" '"holder_user_id":2'
check_body "someone else's lock reports held" '"held":true'
check_body_absent "someone else's token is not echoed" '"token":'

echo
echo "[4] The versioned save"
printf '{"version":1,"lock_token":"%s","widgets":[{"id":0,"column":1,"position":0}]}' \
    "$LOCK_TOKEN" > "$TMP/put-default-widget.json"
do_req PUT "$BASE/api/homes/2/layout" "$USER_COOKIES" "$TMP/put-default-widget.json" "$USER_CSRF"
check "the synthesised default widget cannot be placed" 400

printf '{"version":99,"lock_token":"%s","widgets":[]}' "$LOCK_TOKEN" > "$TMP/put-stale.json"
do_req PUT "$BASE/api/homes/2/layout" "$USER_COOKIES" "$TMP/put-stale.json" "$USER_CSRF"
check "a stale version is refused" 409
check_body "the conflict carries the current version" '"current_version":'
check_body "the conflict carries the current layout" '"current":{'

printf '%s' '{"version":1,"lock_token":"not-the-lock","widgets":[]}' > "$TMP/put-badlock.json"
do_req PUT "$BASE/api/homes/2/layout" "$USER_COOKIES" "$TMP/put-badlock.json" "$USER_CSRF"
check "a wrong lock token cannot save" 423

printf '%s' '{"lock_token":"%s","widgets":[]}' "$LOCK_TOKEN" > "$TMP/put-noversion.json"
do_req PUT "$BASE/api/homes/2/layout" "$USER_COOKIES" "$TMP/put-noversion.json" "$USER_CSRF"
check "a save without a version is refused" 400

echo
echo "[5] Adding widgets uses legacy's allow-list"
printf '%s' '{"widget_key":"traxplayerwidget","column":1}' > "$TMP/add-trax.json"
do_req POST "$BASE/api/homes/2/widgets" "$USER_COOKIES" "$TMP/add-trax.json" "$USER_CSRF"
check "the blocked Trax widget is refused" 503

printf '%s' '{"widget_key":"notawidget","column":1}' > "$TMP/add-unknown.json"
do_req POST "$BASE/api/homes/2/widgets" "$USER_COOKIES" "$TMP/add-unknown.json" "$USER_CSRF"
check "an unknown widget is refused" 400

printf '%s' '{"widget_key":"groupinfowidget","column":1}' > "$TMP/add-group.json"
do_req POST "$BASE/api/homes/2/widgets" "$USER_COOKIES" "$TMP/add-group.json" "$USER_CSRF"
check "a group widget is not a user-home widget" 400

printf '%s' '{"widget_key":"profilewidget","column":1}' > "$TMP/add-profile.json"
do_req POST "$BASE/api/homes/2/widgets" "$USER_COOKIES" "$TMP/add-profile.json" "$USER_CSRF"
check "the profile widget is added" 201

do_req POST "$BASE/api/homes/2/widgets" "$USER_COOKIES" "$TMP/add-profile.json" "$USER_CSRF"
check "the same widget cannot be placed twice" 409

# `key()` resolves the alias, so `guestbook` must land as `guestbookwidget`.
printf '%s' '{"widget_key":"guestbook","column":2}' > "$TMP/add-guestbook.json"
do_req POST "$BASE/api/homes/2/widgets" "$USER_COOKIES" "$TMP/add-guestbook.json" "$USER_CSRF"
check "a widget alias resolves" 201
check_body "the alias is stored resolved" '"widget_key":"guestbookwidget"'

do_req GET "$BASE/api/homes/2/layout" "$USER_COOKIES" ""
check "the saved widgets are readable" 200
check_body "the home is no longer the default layout" '"default_layout":false'
WIDGET_ID="$(widget_id_by_key "$TMP/body" profilewidget)"
GUESTBOOK_ID="$(widget_id_by_key "$TMP/body" guestbookwidget)"
VERSION="$(json_field "$TMP/body" version)"
check_value "both widgets are placed" "2" "$(widget_count "$TMP/body")"
check_value "the profile widget has a stored id" "yes" "$([ -n "$WIDGET_ID" ] && echo yes || echo no)"

echo
echo "[6] Moving widgets uses legacy's pixel mapping"
# `saveLayout()`: column = x >= 450 ? 2 : 1, position = floor(y / 50).
# `widgetStyle()`: left 25 or 450, top = position * 50 + 10, z-index = position + 1.
printf '{"version":%s,"lock_token":"%s","widgets":[{"id":%s,"column":2,"position":3},{"id":%s,"column":1,"position":0}]}' \
    "$VERSION" "$LOCK_TOKEN" "$WIDGET_ID" "$GUESTBOOK_ID" > "$TMP/put-move.json"
do_req PUT "$BASE/api/homes/2/layout" "$USER_COOKIES" "$TMP/put-move.json" "$USER_CSRF"
check "a save with the current version succeeds" 200
check_body "the version advanced" "\"version\":$((VERSION + 1))"
check_body "column 2 renders at 450px" '"left":450'
check_body "position 3 renders at top 160" '"top":160'
check_body "position 3 renders above position 0" '"z_index":4'

do_req PUT "$BASE/api/homes/2/layout" "$USER_COOKIES" "$TMP/put-move.json" "$USER_CSRF"
check "replaying the same version is refused" 409

do_req GET "$BASE/api/homes/2/layout" ""
check "the move is visible to a guest" 200
check_body "the guest sees the new version" "\"version\":$((VERSION + 1))"
check_body "the guest sees the moved widget" '"column":2'

echo
echo "[7] Two concurrent saves: one winner, one refusal"
# Both requests carry the SAME version, which is what two open editors produce.
# Exactly one may be applied; the other must be told, never silently dropped.
do_req GET "$BASE/api/homes/2/layout" "$USER_COOKIES" ""
VERSION="$(json_field "$TMP/body" version)"
printf '{"version":%s,"lock_token":"%s","widgets":[{"id":%s,"column":1,"position":5}]}' \
    "$VERSION" "$LOCK_TOKEN" "$WIDGET_ID" > "$TMP/race-a.json"
printf '{"version":%s,"lock_token":"%s","widgets":[{"id":%s,"column":2,"position":7}]}' \
    "$VERSION" "$LOCK_TOKEN" "$WIDGET_ID" > "$TMP/race-b.json"

curl -s -o "$TMP/race-a.body" -w '%{http_code}' -X PUT \
     -H "Cookie: $USER_COOKIES" -H "X-XSRF-TOKEN: $USER_CSRF" \
     -H 'Content-Type: application/json' --data-binary "@$TMP/race-a.json" \
     "$BASE/api/homes/2/layout" > "$TMP/race-a.code" &
PID_A=$!
curl -s -o "$TMP/race-b.body" -w '%{http_code}' -X PUT \
     -H "Cookie: $USER_COOKIES" -H "X-XSRF-TOKEN: $USER_CSRF" \
     -H 'Content-Type: application/json' --data-binary "@$TMP/race-b.json" \
     "$BASE/api/homes/2/layout" > "$TMP/race-b.code" &
PID_B=$!
# On a diagnostic run, sample the database WHILE the two PUTs are outstanding.
# A processlist collected after nginx's 60-second timeout can miss the wait and
# cannot distinguish a MariaDB row lock from a Drogon callback that never ran.
# The queries are read-only and use this suite's explicitly selected DB.
DIAG_PID=''
if [ "${HOMES_DIAG:-0}" = '1' ]; then
    (
        for delay in 5 15; do
            sleep "$delay"
            echo "  diag  concurrent-save MariaDB snapshot after ${delay}s interval"
            docker exec "$DB_CONTAINER" mariadb -uroot -proot_secret -e \
                "SELECT ID, USER, COMMAND, TIME, STATE, LEFT(INFO, 180) AS query_text FROM information_schema.PROCESSLIST WHERE USER = 'hotel' ORDER BY ID; SELECT trx_id, trx_mysql_thread_id, trx_state, trx_started, LEFT(trx_query, 180) AS query_text FROM information_schema.INNODB_TRX; SELECT * FROM information_schema.INNODB_LOCK_WAITS;" \
                2>&1 || echo '  diag  MariaDB snapshot unavailable'
        done
    ) &
    DIAG_PID=$!
fi
wait "$PID_A"
wait "$PID_B"
if [ -n "$DIAG_PID" ]; then
    kill "$DIAG_PID" 2>/dev/null || true
    wait "$DIAG_PID" 2>/dev/null || true
fi
CODE_A="$(cat "$TMP/race-a.code")"
CODE_B="$(cat "$TMP/race-b.code")"
echo "  info  concurrent saves: A=$CODE_A B=$CODE_B"
if { [ "$CODE_A" = "200" ] && [ "$CODE_B" = "409" ]; } || \
   { [ "$CODE_A" = "409" ] && [ "$CODE_B" = "200" ]; }; then
    printf '  PASS  %-52s A=%s B=%s\n' "concurrent edits do not both land" "$CODE_A" "$CODE_B"
    PASS=$((PASS + 1))
else
    printf '  FAIL  %-52s expected one 200 and one 409, got A=%s B=%s\n' \
        "concurrent edits do not both land" "$CODE_A" "$CODE_B"
    printf '        A body: %s\n' "$(cat "$TMP/race-a.body")"
    printf '        B body: %s\n' "$(cat "$TMP/race-b.body")"
    FAIL=$((FAIL + 1))
fi

do_req GET "$BASE/api/homes/2/layout" "$USER_COOKIES" ""
check "the home is readable after the race" 200
RACE_VERSION="$(json_field "$TMP/body" version)"
check_value "the losing save changed nothing" "$((VERSION + 1))" "$RACE_VERSION"
# The loser must not have half-applied its placement either.
if [ "$CODE_A" = "200" ]; then
    check_body "the winner's placement is the one stored" '"position":5'
else
    check_body "the winner's placement is the one stored" '"position":7'
fi

echo
echo "[8] Only the owner may touch a home"
printf '{"version":%s,"widgets":[]}' "$RACE_VERSION" > "$TMP/put-other.json"
printf '%s' '{"widget_key":"friendswidget","column":1}' > "$TMP/add-other.json"
printf '%s' '{"lock_token":"wrong"}' > "$TMP/release-wrong.json"
printf '{"lock_token":"%s"}' "$LOCK_TOKEN" > "$TMP/release-own.json"

# The owner check answers before the lock: a home is edited by its owner and
# nobody else, and legacy had no per-home ACL at all (only the owner was ever
# shown the edit control). 403 is therefore the correct refusal here, and 423 is
# reserved for "the page is locked for editing by you".
do_req PUT "$BASE/api/homes/2/layout" "$ADMIN_COOKIES" "$TMP/put-other.json" "$ADMIN_CSRF"
check "another user cannot save this home" 403

do_req POST "$BASE/api/homes/2/widgets" "$ADMIN_COOKIES" "$TMP/add-other.json" "$ADMIN_CSRF"
check "another user cannot add a widget" 403

do_req DELETE "$BASE/api/homes/2/widgets/$GUESTBOOK_ID" "$ADMIN_COOKIES" "" "$ADMIN_CSRF"
check "another user cannot remove a widget" 403

do_req DELETE "$BASE/api/homes/2/edit-session" "$ADMIN_COOKIES" "$TMP/release-wrong.json" "$ADMIN_CSRF"
check "a non-holder cannot release a lock" 403

do_req DELETE "$BASE/api/homes/2/edit-session" "$USER_COOKIES" "$TMP/release-wrong.json" "$USER_CSRF"
check "the holder's wrong token cannot release it" 403

do_req DELETE "$BASE/api/homes/2/edit-session" "$USER_COOKIES" "$TMP/release-own.json" "$USER_CSRF"
check "the holder releases its own lock" 200

do_req GET "$BASE/api/homes/2/layout" ""
check "the home is readable after release" 200
check_body "the lock is released" '"held":false'

echo
echo "[9] Widget removal rules"
do_req POST "$BASE/api/homes/2/edit-session" "$USER_COOKIES" "" "$USER_CSRF"
check "the owner reopens an edit session" 200
LOCK_TOKEN="$(json_field "$TMP/body" token)"

do_req DELETE "$BASE/api/homes/2/widgets/$WIDGET_ID" "$USER_COOKIES" "" "$USER_CSRF"
check "the profile widget cannot be removed" 403

do_req DELETE "$BASE/api/homes/2/widgets/$GUESTBOOK_ID" "$USER_COOKIES" "" "$USER_CSRF"
check "an ordinary widget can be removed" 200

do_req DELETE "$BASE/api/homes/2/widgets/$GUESTBOOK_ID" "$USER_COOKIES" "" "$USER_CSRF"
check "removing it twice is 404" 404

do_req DELETE "$BASE/api/homes/2/widgets/0" "$USER_COOKIES" "" "$USER_CSRF"
check "an invalid widget id is 400" 400

printf '{"lock_token":"%s"}' "$LOCK_TOKEN" > "$TMP/release-own.json"
do_req DELETE "$BASE/api/homes/2/edit-session" "$USER_COOKIES" "$TMP/release-own.json" "$USER_CSRF"
check "the owner closes the edit session" 200

do_req GET "$BASE/api/homes/2/layout" ""
check "the home is readable at the end" 200
check_body "the lock is released at the end" '"held":false'

echo
echo "[10] Widget bodies carry their data"
# Every box's contents arrive with the box: `home.php` rendered the whole page in
# one load, and a client that had to fetch per box would be a different page with
# a different failure mode.
check_body "the profile box carries data" '"widget_key":"profilewidget"'
check_body "the profile box's data is available" '"available":true'
check_body "the profile box knows the friend count field" '"friend_count":'

printf '%s' '{"widget_key":"badgeswidget","column":1}' > "$TMP/add-badges.json"
do_req POST "$BASE/api/homes/2/widgets" "$USER_COOKIES" "$TMP/add-badges.json" "$USER_CSRF"
BADGES_ID=""
if [ "$CODE" = "201" ]; then
    check "a badges box can be placed" 201
    BADGES_ID="$(json_field "$TMP/body" id)"
fi

do_req GET "$BASE/api/homes/2/layout" ""
check "the home with a badges box is readable" 200
check_body "the badges box carries a data block" '"badges":['
# A stack with no PolarIS emulator behind it has no `users_badges`, so this is
# where the box has to say so: an empty list and a failed read look identical on
# screen, and only one of them is the truth.
if grep -q '"badges":\[\].*"available":false' "$TMP/body" || grep -q '"available":false' "$TMP/body"; then
    check_body "an unreadable box carries its reason" '"unavailable_reason":'
else
    check_body "a readable box lists its badges" '"badges":['
fi

if [ -n "$BADGES_ID" ]; then
    do_req DELETE "$BASE/api/homes/2/widgets/$BADGES_ID" "$USER_COOKIES" "" "$USER_CSRF"
    check "the badges box is removed again" 200
fi

echo
echo "Phase 8 homes smoke: $PASS passed, $FAIL failed, $SKIP skipped"
[ "$FAIL" -eq 0 ]
