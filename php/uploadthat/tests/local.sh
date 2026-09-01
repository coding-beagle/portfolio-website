#!/usr/bin/env bash
#
# Runs the HTTP smoke test against PHP's built-in server, so the parts of the
# API that only exist over HTTP — routing, the auth guards, request validation —
# can be tested without deploying anything.
#
#   php/uploadthat/tests/local.sh   (or: make test_uploadthat_http)
#
# run.php calls the store directly and never goes through index.php, so without
# this the entire front controller is only ever exercised in production.
#
# Everything runs against a throwaway data directory, which also means the rate
# limits start empty each time — otherwise the fourth run of the day would fail
# on the three-sessions-an-hour cap rather than on anything real.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
PORT="${PORT:-8787}"
PASSPHRASE="local-test-key"

command -v php >/dev/null || { echo "php is not on PATH"; exit 1; }

WORK=$(mktemp -d)
SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

HASH=$(php -r 'echo password_hash($argv[1], PASSWORD_DEFAULT);' "$PASSPHRASE")
cat > "$WORK/config.php" <<PHP
<?php
return [
    'data_dir' => '$WORK/data',
    'accepting_sessions' => true,
    'operator_key_hash' => '$HASH',
];
PHP

echo "starting php -S on :$PORT"
UPLOADTHAT_CONFIG="$WORK/config.php" \
  php -S "localhost:$PORT" -t "$ROOT" "$ROOT/api/index.php" \
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

"$HERE/smoke.sh" "http://localhost:$PORT" "$PASSPHRASE"
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
