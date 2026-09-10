#!/usr/bin/env bash
#
# The whole registry, locally, in one command: the API, the management UI and a
# shell set up to drive it with `nt`.
#
#   php/registry/tests/dev.sh   (or: make registry_dev)
#
# Everything is made fresh in a temp directory and deleted on the way out, so
# every run starts with an empty store, empty rate limits and a password that
# is not a secret. Nothing from a dev run is left on disk afterwards.
#
# The reason this exists rather than just `make run_registry`: a registry with
# no admin_password_hash cannot be logged into at all, so the bare server is a
# login screen you cannot get past. This generates a throwaway password and
# prints it.
#
# It also prints an NT_CONFIG pointing into the temp directory. That matters:
# `nt auth login` against this server would otherwise overwrite the token for
# the real registry in ~/.config/nt/config.json, and you would find out the
# next time you tried to ship something.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
REPO="$(cd "$ROOT/../.." && pwd)"

PORT="${PORT:-8788}"
PASSWORD="${REGISTRY_PASSWORD:-local-dev-password}"

command -v php >/dev/null || { echo "php is not on PATH"; exit 1; }

# Bash can open the socket itself, so this needs neither lsof nor ss.
port_taken() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
if port_taken "$PORT"; then
  echo "port $PORT is already in use."
  echo "stop whatever is on it — a run_registry in another terminal? — and try again."
  exit 1
fi

# A persistent data directory can be asked for, for when you want yesterday's
# uploads to still be there. It is then yours to clean up.
KEEP=""
if [ -n "${REGISTRY_DEV_DATA:-}" ]; then
  WORK="$REGISTRY_DEV_DATA"
  mkdir -p "$WORK"
  KEEP="yes"
else
  WORK=$(mktemp -d)
fi

SERVER_PID=""
TAIL_PID=""

cleanup() {
  trap - EXIT INT TERM
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  [ -n "$TAIL_PID" ] && kill "$TAIL_PID" 2>/dev/null
  if [ -n "$KEEP" ]; then
    echo
    echo "stopped. the data in $WORK was left alone."
  else
    rm -rf "$WORK"
    echo
    echo "stopped. the repositories, their artifacts and the database went with it."
  fi
}
# cleanup untraps first, so exiting from the signal handler does not run it
# twice. Zero rather than 128+n: stopping this is what finishing it looks like,
# and make should not report it as a failure.
on_signal() { cleanup; exit 0; }
trap cleanup EXIT
trap on_signal INT TERM

HASH=$(php -r 'echo password_hash($argv[1], PASSWORD_DEFAULT);' "$PASSWORD")
cat > "$WORK/config.php" <<PHP
<?php
return [
    'data_dir' => '$WORK/data',
    'accepting_writes' => true,
    'admin_password_hash' => '$HASH',
];
PHP

echo "starting the registry on :$PORT against $WORK/data"
REGISTRY_CONFIG="$WORK/config.php" \
  php -S "localhost:$PORT" -t "$ROOT/public" "$HERE/dev-router.php" \
  > "$WORK/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 50); do
  curl -sS --max-time 2 "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 0.1
done
if ! curl -sS --max-time 2 "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
  echo "the registry never came up:"
  cat "$WORK/server.log"
  exit 1
fi

# A scratch config for the CLI, so `nt` here can never touch the real one.
NT_CONFIG_PATH="$WORK/nt-config.json"
python3 - "$NT_CONFIG_PATH" "http://localhost:$PORT" <<'PY' 2>/dev/null
import json, os, stat, sys
path, url = sys.argv[1], sys.argv[2]
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, stat.S_IRUSR | stat.S_IWUSR)
with os.fdopen(fd, "w") as handle:
    json.dump({"url": url, "token": None, "expires_at": 0}, handle)
PY

# Something to look at. An empty registry is a poor first impression, and a
# seeded one shows what versions, platforms and prereleases actually look like.
if [ -z "${NO_SEED:-}" ]; then
  TOKEN=$(curl -sS --max-time 5 -X POST "http://localhost:$PORT/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "$(php -r 'echo json_encode(["password" => $argv[1], "label" => "dev seed"]);' "$PASSWORD")" \
    | php -r '$d = json_decode(stream_get_contents(STDIN), true); echo $d["token"] ?? "";')

  if [ -n "$TOKEN" ]; then
    seed_repo() {
      curl -sS --max-time 5 -X POST "http://localhost:$PORT/api/repos" \
        -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
        -d "{\"name\":\"$1\",\"description\":\"$2\"}" >/dev/null
    }
    seed_build() {
      head -c "$4" /dev/urandom > "$WORK/seed.bin"
      curl -sS --max-time 15 -X POST \
        "http://localhost:$PORT/api/repos/$1/versions/$2/artifacts" \
        -H "Authorization: Bearer $TOKEN" \
        -F "file=@$WORK/seed.bin;filename=$5" \
        -F "platform=$3" -F "notes=$6" >/dev/null
    }

    seed_repo "beagle-cli" "The beagle command line tool"
    seed_build beagle-cli 1.0.0 linux-x64 200000 beagle-1.0.0-linux "Initial release."
    seed_build beagle-cli 1.2.0 linux-x64 240000 beagle-1.2.0-linux "Faster tree walk."
    seed_build beagle-cli 1.2.0 windows 260000 beagle-1.2.0.exe ""
    seed_build beagle-cli 1.2.0 macos-arm64 230000 beagle-1.2.0-macos ""
    seed_build beagle-cli 2.0.0-rc.1 linux-x64 250000 beagle-2.0.0-rc1 "New plugin API."

    seed_repo "hexviewer" "Desktop hex and binary inspector"
    seed_build hexviewer 0.9.3 any 120000 hexviewer-0.9.3.zip "Beta."

    # Revoked, so the token list starts out honest rather than showing a
    # session nobody is actually holding.
    curl -sS --max-time 5 -X POST "http://localhost:$PORT/api/auth/logout" \
      -H "Authorization: Bearer $TOKEN" >/dev/null
    rm -f "$WORK/seed.bin"
  fi
fi

URL="http://localhost:$PORT"

cat <<TXT

  registry, locally

  UI          $URL
  API         $URL/api
  data        $WORK/data$([ -n "$KEEP" ] && echo "   (kept)" || echo "   (deleted on exit)")
  password    $PASSWORD

  Drive it with the CLI from another terminal — the NT_CONFIG keeps this
  away from your real token:

    export NT_URL=$URL
    export NT_CONFIG=$NT_CONFIG_PATH
    nt auth login
    nt list

  Ctrl-C stops the server$([ -n "$KEEP" ] || echo " and deletes everything above").

TXT

if [ -z "${NO_OPEN:-}" ]; then
  if command -v xdg-open >/dev/null; then
    xdg-open "$URL" >/dev/null 2>&1
  elif command -v open >/dev/null; then
    open "$URL" >/dev/null 2>&1
  fi
fi

# The server log from here on, so a PHP warning shows up where you are already
# looking. Backgrounded and waited on rather than run in front: bash runs a trap
# the moment `wait` is interrupted, but not while it is sitting on a foreground
# command, and that is the difference between Ctrl-C cleaning up and Ctrl-C
# leaving a temp directory and a server behind.
tail -n 0 -f "$WORK/server.log" &
TAIL_PID=$!
wait "$TAIL_PID"
