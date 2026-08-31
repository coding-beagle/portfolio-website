#!/usr/bin/env bash
#
# End-to-end check against a deployed uploadthat, over real HTTP.
#
#   php/uploadthat/tests/smoke.sh https://uploadthat.nteague.com [operator-key]
#
# The PHP tests cover the store directly; this covers everything between it and
# the network — the .htaccess rewrite, whether the Authorization header survives
# the trip to PHP (it does not by default on some cPanel setups), multipart
# upload through the web SAPI, and streamed download.
#
# It opens a real session, so without an operator key it uses one of the three
# anonymous sessions your IP is allowed per hour. Pass the key as the second
# argument to avoid that.

set -uo pipefail

BASE="${1:-https://uploadthat.nteague.com}"
OPERATOR_KEY="${2:-}"

passed=0
failed=0

ok()   { printf '  ok   %s\n' "$1"; passed=$((passed + 1)); }
bad()  { printf '  FAIL %s\n' "$1"; [ $# -gt 1 ] && printf '       %s\n' "$2"; failed=$((failed + 1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected '$3', got '$2'"; fi; }

# php is the one JSON parser guaranteed to be present here; jq often is not.
#
# A missing key prints NOTHING, not "null" — otherwise `[ -z "$x" ]` never fires
# and a failed request cascades into every later step using the literal string
# "null" as a session id, which then reports a tidy row of false passes.
json() {
  php -r '$d = json_decode(stream_get_contents(STDIN), true);
          foreach (explode(".", $argv[1]) as $part) {
              $d = (is_array($d) && array_key_exists($part, $d)) ? $d[$part] : null;
          }
          if ($d === null) { exit; }
          if (is_bool($d)) { echo $d ? "1" : "0"; exit; }
          echo is_scalar($d) ? $d : json_encode($d);' "$1"
}

# What went wrong, from an error envelope or, failing that, the raw body.
why() {
  local code message
  code=$(printf '%s' "$1" | json error.code)
  message=$(printf '%s' "$1" | json error.message)
  if [ -n "$code" ]; then
    printf '%s (%s)' "$message" "$code"
  else
    printf '%s' "$(printf '%s' "$1" | head -c 300)"
  fi
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "uploadthat over HTTP — $BASE"
echo
echo "reachability"

health=$(curl -sS --max-time 15 "$BASE/api/health" 2>&1)
if [ "$(printf '%s' "$health" | json ok)" = "1" ]; then
  ok "GET /api/health (so the rewrite works)"
  printf '       web SAPI upload ceiling: %s bytes\n' "$(printf '%s' "$health" | json uploadCeiling)"
  check "accepting sessions" "$(printf '%s' "$health" | json acceptingSessions)" "1"
else
  bad "GET /api/health" "$health"
  echo
  echo "Nothing else can pass until that does. Check the .htaccess in the document root."
  exit 1
fi

echo
echo "a session"

body='{}'
[ -n "$OPERATOR_KEY" ] && body=$(php -r 'echo json_encode(["operatorKey" => $argv[1]]);' "$OPERATOR_KEY")

created=$(curl -sS --max-time 15 -X POST "$BASE/api/session" \
  -H 'Content-Type: application/json' -d "$body")
SID=$(printf '%s' "$created" | json sessionId)
CODE=$(printf '%s' "$created" | json code)
TOKEN=$(printf '%s' "$created" | json token)
TIER=$(printf '%s' "$created" | json tier)

if [ -z "$SID" ]; then
  bad "POST /api/session" "$(why "$created")"
  echo
  if [ -n "$OPERATOR_KEY" ]; then
    echo "If that says the key was not recognised, check the key reached the script"
    echo "in one piece — a passphrase with spaces needs quoting all the way through."
    echo "Try once without a key to test the anonymous path on its own."
  fi
  echo
  echo "$passed passed, $((failed)) failed"
  exit 1
fi
ok "POST /api/session"
printf '       tier: %s, code: %s\n' "$TIER" "$CODE"
[ -n "$OPERATOR_KEY" ] && check "the operator key was accepted" "$TIER" "operator"

joined=$(curl -sS --max-time 15 -X POST "$BASE/api/join/$CODE")
GUEST=$(printf '%s' "$joined" | json token)
check "a second device can join with the code" "$(printf '%s' "$joined" | json sessionId)" "$SID"

echo
echo "a file"

printf 'hello from the smoke test\n' > "$work/smoke.txt"
META=$(php -r 'echo base64_encode(json_encode(["name" => "smoke.txt", "type" => "text/plain"]));')

uploaded=$(curl -sS --max-time 60 -X POST "$BASE/api/session/$SID/files" \
  -H "Authorization: Bearer $GUEST" -F "meta=$META" -F "file=@$work/smoke.txt")
FID=$(printf '%s' "$uploaded" | json id)

if [ -z "$FID" ]; then
  # The single most likely cause, and it looks like a plain auth failure.
  bad "POST .../files" "$(why "$uploaded")"
  echo "       if that says unauthorised, the Authorization header is not reaching"
  echo "       PHP — check the RewriteRule in api/.htaccess"
else
  ok "the guest uploaded a file (so the Authorization header arrives)"

  manifest=$(curl -sS --max-time 15 "$BASE/api/session/$SID/manifest" -H "Authorization: Bearer $TOKEN")
  check "the owner sees it in the manifest" "$(printf '%s' "$manifest" | json files.0.id)" "$FID"
  check "attributed to the device that sent it" "$(printf '%s' "$manifest" | json files.0.uploadedBy)" "Device 2"
  check "with its description untouched" "$(printf '%s' "$manifest" | json files.0.meta)" "$META"

  etag=$(curl -sS --max-time 15 -D - -o /dev/null "$BASE/api/session/$SID/manifest" \
    -H "Authorization: Bearer $TOKEN" | awk 'tolower($1) == "etag:" { print $2 }' | tr -d '\r')
  status=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$BASE/api/session/$SID/manifest" \
    -H "Authorization: Bearer $TOKEN" -H "If-None-Match: $etag")
  check "an unchanged session answers 304, so polling stays cheap" "$status" "304"

  curl -sS --max-time 60 "$BASE/api/session/$SID/files/$FID" \
    -H "Authorization: Bearer $TOKEN" -o "$work/back.txt"
  if cmp -s "$work/smoke.txt" "$work/back.txt"; then
    ok "downloaded byte for byte"
  else
    bad "downloaded byte for byte" "$(head -c 200 "$work/back.txt")"
  fi

  status=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$BASE/api/session/$SID/files/$FID")
  check "and not without a token" "$status" "401"
fi

echo
echo "closing up"

curl -sS --max-time 15 -X POST "$BASE/api/session/$SID/close" -H "Authorization: Bearer $TOKEN" > /dev/null
status=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$BASE/api/session/$SID/manifest" \
  -H "Authorization: Bearer $TOKEN")
check "the session is gone once closed" "$status" "401"

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ] || exit 1
