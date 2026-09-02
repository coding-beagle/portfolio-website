#!/usr/bin/env bash
#
# Two uploadthat clients talking to each other over one throwaway server, for
# the half of the app that needs a second device: the join code, the handshake,
# the shared note, files landing on the other side.
#
#   php/uploadthat/tests/duo.sh   (or: make uploadthat_duo)
#
# The database and the blobs are made fresh in a temp directory and deleted on
# the way out, so every run starts with an empty store and empty rate limits —
# otherwise the fourth run of the day would fail on the three-sessions-an-hour
# cap rather than on anything real — and nothing from a test session is left on
# disk afterwards.
#
# The two clients are one dev server reached by two names: localhost and
# 127.0.0.1. A browser treats those as separate origins, so each window gets its
# own localStorage — the remembered operator key — and neither can see the
# other's, which is the part of "two devices" that a second tab would not give.
# A second webpack, for this, would cost a gigabyte and buy nothing.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
REPO="$(cd "$ROOT/../.." && pwd)"
APP="$REPO/app"

# The API port is not a preference: app/package.json proxies the dev server to
# this one, and the client port is half of what makes the two origins.
API_PORT="${API_PORT:-8787}"
CLIENT_PORT="${PORT:-3000}"
PASSPHRASE="${OPERATOR_KEY:-local-test-key}"

command -v php >/dev/null || { echo "php is not on PATH"; exit 1; }
command -v npm >/dev/null || { echo "npm is not on PATH"; exit 1; }
[ -d "$APP/node_modules" ] || { echo "app dependencies are missing — run: make install"; exit 1; }

# Bash can open the socket itself, so this needs neither lsof nor ss.
port_taken() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
for PORT_IN_USE in "$API_PORT" "$CLIENT_PORT"; do
  if port_taken "$PORT_IN_USE"; then
    echo "port $PORT_IN_USE is already in use."
    echo "stop whatever is on it — a run_uploadthat or run_uploadthat_api in another terminal? — and try again."
    exit 1
  fi
done

WORK=$(mktemp -d)
API_PID=""
CLIENT_PID=""
TAIL_PID=""

cleanup() {
  trap - EXIT INT TERM
  # The client is npm, which is not the process listening on the port: killing
  # the group takes react-scripts with it rather than orphaning it on the port.
  [ -n "$CLIENT_PID" ] && { kill -- "-$CLIENT_PID" 2>/dev/null || kill "$CLIENT_PID" 2>/dev/null; }
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null
  [ -n "$TAIL_PID" ] && kill "$TAIL_PID" 2>/dev/null
  rm -rf "$WORK"
  echo
  echo "stopped. the session, its files and its database went with it."
}
# cleanup untraps first, so exiting from the signal handler does not run it
# twice. Zero rather than 128+n: stopping this is what finishing it looks like,
# and make should not report it as a failure.
on_signal() { cleanup; exit 0; }
trap cleanup EXIT
trap on_signal INT TERM

HASH=$(php -r 'echo password_hash($argv[1], PASSWORD_DEFAULT);' "$PASSPHRASE")
cat > "$WORK/config.php" <<PHP
<?php
return [
    'data_dir' => '$WORK/data',
    'accepting_sessions' => true,
    'operator_key_hash' => '$HASH',
];
PHP

echo "starting the api on :$API_PORT against $WORK/data"
UPLOADTHAT_CONFIG="$WORK/config.php" \
  php -S "localhost:$API_PORT" -t "$ROOT" "$ROOT/api/index.php" \
  > "$WORK/server.log" 2>&1 &
API_PID=$!

for _ in $(seq 1 50); do
  curl -sS --max-time 2 "http://localhost:$API_PORT/api/health" >/dev/null 2>&1 && break
  sleep 0.1
done
if ! curl -sS --max-time 2 "http://localhost:$API_PORT/api/health" >/dev/null 2>&1; then
  echo "the api never came up:"
  cat "$WORK/server.log"
  exit 1
fi

echo "starting the client on :$CLIENT_PORT (webpack, so give it a moment)"
SETSID=""
command -v setsid >/dev/null && SETSID="setsid"
(
  cd "$APP" || exit 1
  # BROWSER=none because this script opens both windows itself, and one of them
  # has to be the other origin.
  BROWSER=none PORT="$CLIENT_PORT" exec $SETSID npm run start:uploadthat
) > "$WORK/client.log" 2>&1 &
CLIENT_PID=$!

# A cold compile of this app is tens of seconds, so this waits minutes rather
# than guessing, and gives up loudly instead of printing URLs that 404.
READY=""
for _ in $(seq 1 600); do
  if curl -sS --max-time 2 "http://localhost:$CLIENT_PORT/" >/dev/null 2>&1; then
    READY="yes"
    break
  fi
  kill -0 "$CLIENT_PID" 2>/dev/null || break
  sleep 0.5
done
if [ -z "$READY" ]; then
  echo "the client never came up:"
  tail -30 "$WORK/client.log"
  exit 1
fi

A="http://localhost:$CLIENT_PORT"
B="http://127.0.0.1:$CLIENT_PORT"

cat <<TXT

  uploadthat duo

  client A    $A
  client B    $B   (a separate origin: its own device)
  api         http://localhost:$API_PORT
  data        $WORK/data   (deleted on exit)
  operator    $PASSPHRASE

  Start a session in A, then type its six digits into B and confirm the four
  that both windows show. The QR encodes A's own origin, so it is the six
  digits that get you across, not a scan.

  Ctrl-C stops both and deletes everything above.

TXT

if [ -z "${NO_OPEN:-}" ] && command -v xdg-open >/dev/null; then
  xdg-open "$A" >/dev/null 2>&1
  xdg-open "$B" >/dev/null 2>&1
elif [ -z "${NO_OPEN:-}" ] && command -v open >/dev/null; then
  open "$A" >/dev/null 2>&1
  open "$B" >/dev/null 2>&1
fi

# Both logs from here on, so a compile error or a PHP warning shows up where
# you are already looking. Backgrounded and waited on rather than run in front:
# bash runs a trap the moment `wait` is interrupted, but not while it is sitting
# on a foreground command, and that is the difference between Ctrl-C cleaning up
# and Ctrl-C leaving a temp directory and two servers behind.
tail -n 0 -f "$WORK/client.log" "$WORK/server.log" &
TAIL_PID=$!
wait "$TAIL_PID"
