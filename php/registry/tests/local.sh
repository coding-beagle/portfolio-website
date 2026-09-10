#!/usr/bin/env bash
#
# Runs the HTTP smoke test against PHP's built-in server, so the parts of the
# stack that only exist over HTTP can be checked without deploying anything.
#
#   php/registry/tests/local.sh   (or: make test_registry_http)
#
# Everything runs against a throwaway data directory and a throwaway password,
# so it never touches a real registry and the rate limits start empty each time.
#
# dev-router.php stands in for the .htaccess rewrites, so the layout matches
# the deployed one: the management UI at /, the API under /api.
#
# Note that php -S is not Apache: it has no .htaccess, so this cannot tell you
# whether the rewrite or the Authorization passthrough are right on the real
# host. Only tests/smoke.sh against the deployed subdomain can. What this does
# cover is multipart parsing, streamed download and the front controller under
# a real SAPI.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
PORT="${PORT:-8788}"
PASSWORD="local-test-password"

command -v php >/dev/null || { echo "php is not on PATH"; exit 1; }

WORK=$(mktemp -d)
SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

HASH=$(php -r 'echo password_hash($argv[1], PASSWORD_DEFAULT);' "$PASSWORD")
cat > "$WORK/config.php" <<PHP
<?php
return [
    'data_dir' => '$WORK/data',
    'accepting_writes' => true,
    'admin_password_hash' => '$HASH',
];
PHP

echo "starting php -S on :$PORT"
REGISTRY_CONFIG="$WORK/config.php" \
  php -S "localhost:$PORT" -t "$ROOT/public" "$HERE/dev-router.php" \
  > "$WORK/server.log" 2>&1 &
SERVER_PID=$!

# Wait for it to answer rather than guessing at a sleep.
for _ in $(seq 1 50); do
  if curl -sS --max-time 2 "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

if ! curl -sS --max-time 2 "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
  echo "the server never came up:"
  cat "$WORK/server.log"
  exit 1
fi

"$HERE/smoke.sh" "http://localhost:$PORT" "$PASSWORD"
STATUS=$?

# PHP logs warnings and uncaught errors here; a passing run with noise in it is
# still worth looking at.
if grep -qiE "warning|deprecated|fatal|uncaught" "$WORK/server.log"; then
  echo
  echo "the server logged something worth reading:"
  grep -iE "warning|deprecated|fatal|uncaught" "$WORK/server.log" | head -20
  STATUS=1
fi

exit $STATUS
