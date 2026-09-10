#!/usr/bin/env bash
#
# End-to-end check against a running registry, over real HTTP.
#
#   php/registry/tests/smoke.sh https://api.nteague.com [password]
#
# tests/run.php covers the API's behaviour in-process and covers it far more
# thoroughly than this does. What it cannot cover is everything BETWEEN the
# router and the network, which is exactly what this is for:
#
#   - the .htaccess rewrite, so /api/anything reaches the front controller
#   - whether the Authorization header survives the trip to PHP, which on some
#     cPanel setups it does not without the RewriteRule in api/.htaccess
#   - real multipart upload through the web SAPI rather than a synthetic array
#   - streamed download, byte for byte, through the web server
#
# So this stays deliberately short. Anything that is really about the API's
# logic belongs in run.php, where it costs no network and no deployment.
#
# The password can also come from REGISTRY_PASSWORD, to keep it out of `ps`
# and out of your shell history.

set -uo pipefail

BASE="${1:-https://api.nteague.com}"
PASSWORD="${2:-${REGISTRY_PASSWORD:-}}"
REPO="smoke-$(date +%s)"

passed=0
failed=0

ok()   { printf '  ok   %s\n' "$1"; passed=$((passed + 1)); }
bad()  { printf '  FAIL %s\n' "$1"; [ $# -gt 1 ] && printf '       %s\n' "$2"; failed=$((failed + 1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected '$3', got '$2'"; fi; }

# php is the one JSON parser guaranteed to be present here; jq often is not.
#
# A missing key prints NOTHING, not "null" — otherwise `[ -z "$x" ]` never fires
# and a failed request cascades into every later step using the literal string
# "null" as a token, which then reports a tidy row of false passes.
json() {
  php -r '$d = json_decode(stream_get_contents(STDIN), true);
          foreach (explode(".", $argv[1]) as $part) {
              $d = (is_array($d) && array_key_exists($part, $d)) ? $d[$part] : null;
          }
          if ($d === null) { exit; }
          if (is_bool($d)) { echo $d ? "1" : "0"; exit; }
          echo is_scalar($d) ? $d : json_encode($d);' "$1"
}

# Runs a request, leaving the status in REPLY_STATUS and the body in REPLY_BODY.
# The status is what separates a routing problem from a rejection from a crash,
# and without it every failure looks the same.
REPLY_STATUS=""
REPLY_BODY=""
call() {
  local out
  out=$(curl -sS --max-time 120 -w $'\n%{http_code}' "$@" 2>&1)
  REPLY_STATUS="${out##*$'\n'}"
  REPLY_BODY="${out%$'\n'*}"
}

# What went wrong, from an error envelope or, failing that, the raw body.
why() {
  local code message
  code=$(printf '%s' "$1" | json error.code)
  message=$(printf '%s' "$1" | json error.message)
  if [ -n "$code" ]; then
    printf '%s: %s' "$code" "$message"
  else
    printf '%s' "$(printf '%s' "$1" | head -c 200)"
  fi
}

command -v curl >/dev/null || { echo "curl is not on PATH"; exit 1; }
command -v php  >/dev/null || { echo "php is not on PATH"; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "registry smoke test against $BASE"
echo
echo "reachability"

call "$BASE/api/health"
check "GET /api/health" "$REPLY_STATUS" "200"
check "  reports itself up" "$(printf '%s' "$REPLY_BODY" | json ok)" "1"

if [ "$(printf '%s' "$REPLY_BODY" | json authConfigured)" != "1" ]; then
  echo
  echo "  no password is configured on this server — set admin_password_hash."
  echo "  Nothing else can be tested until then."
  exit 1
fi

ceiling=$(printf '%s' "$REPLY_BODY" | json uploadCeiling)
echo "  note: the web server will accept uploads up to $ceiling bytes"

# A JSON error envelope from a path with no file behind it proves the rewrite
# reached the front controller — Apache answering its own 404 would be HTML.
call "$BASE/api/repos"
check "the API refuses an anonymous caller" "$REPLY_STATUS" "401"
check "  and the rewrite reached the app" "$(printf '%s' "$REPLY_BODY" | json error.code)" "unauthorised"

if [ -z "$PASSWORD" ]; then
  echo
  echo "no password given, so only the public checks ran."
  echo "pass one as the second argument, or set REGISTRY_PASSWORD, for the rest."
  echo
  echo "$passed passed, $failed failed"
  [ "$failed" -eq 0 ] || exit 1
  exit 0
fi

echo
echo "authentication"

call -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "$(php -r 'echo json_encode(["password" => $argv[1], "label" => "smoke test"]);' "$PASSWORD")"
TOKEN=$(printf '%s' "$REPLY_BODY" | json token)

if [ -z "$TOKEN" ]; then
  bad "POST /api/auth/login" "HTTP $REPLY_STATUS — $(why "$REPLY_BODY")"
  echo
  echo "$passed passed, $failed failed"
  exit 1
fi
ok "POST /api/auth/login"

# The single most likely thing to be broken on a fresh cPanel subdomain: PHP
# never sees Authorization unless api/.htaccess puts it back. Worth its own
# check, because every later failure would look like a bad token instead.
call "$BASE/api/auth/whoami" -H "Authorization: Bearer $TOKEN"
if [ "$REPLY_STATUS" = "200" ]; then
  ok "the Authorization header reaches PHP"
else
  bad "the Authorization header reaches PHP" \
      "HTTP $REPLY_STATUS — check the RewriteRule in api/.htaccess"
fi

# Checked with a token, because an anonymous caller is turned away at the auth
# gate before routing is reached — deliberately, so that not holding a token
# tells you nothing about which endpoints exist.
call "$BASE/api/nowhere" -H "Authorization: Bearer $TOKEN"
check "an unknown API path is the app's 404" "$(printf '%s' "$REPLY_BODY" | json error.code)" "not_found"

echo
echo "a release, end to end"

call -X POST "$BASE/api/repos" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"name\":\"$REPO\",\"description\":\"smoke test\"}"
check "POST /api/repos" "$REPLY_STATUS" "201"

# Big enough that a truncating proxy or a small post_max_size shows up here
# rather than silently passing on a few bytes.
head -c 300000 /dev/urandom > "$work/artifact.bin"

call -X POST "$BASE/api/repos/$REPO/versions/1.0.0/artifacts" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@$work/artifact.bin" \
  -F "platform=linux-x64" \
  -F "notes=smoke test release"
if [ "$REPLY_STATUS" = "201" ]; then
  ok "multipart upload through the web SAPI"
else
  bad "multipart upload through the web SAPI" "HTTP $REPLY_STATUS — $(why "$REPLY_BODY")"
fi

sent=$(php -r 'echo hash_file("sha256", $argv[1]);' "$work/artifact.bin")
check "  the server hashed what it received" "$(printf '%s' "$REPLY_BODY" | json sha256)" "$sent"

call "$BASE/api/repos/$REPO/versions/latest" -H "Authorization: Bearer $TOKEN"
check "latest resolves to the release" "$(printf '%s' "$REPLY_BODY" | json version.version)" "1.0.0"

curl -sS --max-time 120 "$BASE/api/repos/$REPO/versions/1.0.0/download?platform=linux-x64" \
  -H "Authorization: Bearer $TOKEN" -o "$work/back.bin"
if cmp -s "$work/artifact.bin" "$work/back.bin"; then
  ok "downloaded byte for byte"
else
  bad "downloaded byte for byte" "$(head -c 200 "$work/back.bin")"
fi

status=$(curl -sS --max-time 30 -o /dev/null -w '%{http_code}' \
  "$BASE/api/repos/$REPO/versions/1.0.0/download?platform=linux-x64")
check "and not without a token" "$status" "401"

echo
echo "cleaning up"

call -X DELETE "$BASE/api/repos/$REPO" -H "Authorization: Bearer $TOKEN"
if [ "$(printf '%s' "$REPLY_BODY" | json deleted)" = "1" ]; then
  ok "DELETE /api/repos/$REPO"
else
  bad "DELETE /api/repos/$REPO" "HTTP $REPLY_STATUS — $(why "$REPLY_BODY")"
  echo "       NOTE: the repo '$REPO' may be left behind on the server."
fi

# A body is sent even though the endpoint ignores it. A POST with no body at
# all is unusual enough that proxies and WAF rules in front of a shared host
# sometimes reject it outright, and this is the only request here that would
# otherwise make one.
call -X POST "$BASE/api/auth/logout" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}'
if [ "$(printf '%s' "$REPLY_BODY" | json revoked)" = "1" ]; then
  ok "the smoke test's token is revoked"
else
  bad "the smoke test's token is revoked" "HTTP $REPLY_STATUS — $(why "$REPLY_BODY")"
  echo "       NOTE: the token stays valid until it expires. Revoke it in the UI."
fi

call "$BASE/api/repos" -H "Authorization: Bearer $TOKEN"
check "and stops working immediately" "$REPLY_STATUS" "401"

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ] || exit 1
