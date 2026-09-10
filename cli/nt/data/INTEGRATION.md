# Integrating with the registry

**Hand this file to whoever — or whatever — is building a client.** It is
self-contained: every request, response and error below was captured from a
running server, and nothing else in this repository needs to be read to write a
working integration.

If the `nt` client is installed, this document comes with it — no repository
required:

```sh
nt manual > REGISTRY.md              # this file
nt manual --example python > update.py   # just the reference updater
nt manual --render | less -R         # formatted for reading
```

If you are an agent: read the whole file before writing code. The three rules in
[Things that will bite you](#things-that-will-bite-you) are not stylistic; each
one is a failure that looks like something else.

---

## 1. What this is

A private registry of versioned build artifacts. You will use it for one of two
jobs:

- **Consuming** — an application that checks whether it is out of date and
  downloads its own replacement. This is the common case; start at §4.
- **Publishing** — a build pipeline that uploads artifacts. Start at §8.

```
Base URL      https://api.nteague.com/api
Auth          Authorization: Bearer <token>   (required on everything but /health)
Transport     HTTPS only. JSON in, JSON out, except artifact bytes.
```

### The data model

| | |
| --- | --- |
| **Repository** | One project. Lower case: `^[a-z0-9][a-z0-9._-]{0,63}$` |
| **Version** | One [semver 2.0.0](https://semver.org) release. `1.4.2`, `2.0.0-rc.1` |
| **Artifact** | One file in that release, keyed by **platform** |

A version holds at most one artifact per platform, so one release carries every
target you ship. You ask for the build you want by platform name, never by
guessing a filename.

**`latest`** is accepted anywhere a version number is. It means the highest
full release by semver precedence and **never a prerelease**, unless you add
`?prerelease=1`.

---

## 2. Authentication

There is no anonymous read path. Every endpoint except `/health` needs a token.

### Getting one

```http
POST /api/auth/login
Content-Type: application/json

{"password": "…", "label": "beagle-cli updater"}
```

```json
{
  "token": "Fz0gZaTmQRUIZdNCQYpLAHsri78XGlL7S_KqCJKkC2g",
  "tokenId": "ba366aae-1c82-4ded-b4d4-24af2c70ca25",
  "expiresAt": 1791656850
}
```

`label` is free text and shows up in the operator's token list — set it to
something that identifies your app, so a token can be revoked without guessing
which one it is.

`expiresAt` is a Unix timestamp.

### For a shipped application

> **A token compiled into a distributed binary is not a secret.** Anyone
> holding the binary can extract it. Plan for that rather than around it:
>
> - Ship a token, **never** the password. The password mints unlimited tokens.
> - Use a *named* token minted for this app and nothing else — see below — so
>   it can be revoked on its own.
> - That token can read every repository on the registry, and can mint further
>   tokens. If that is not acceptable, this registry is the wrong place to
>   publish that build.

### Token lifetime — ask for a named token

There are two kinds of token, and **a login token is the wrong one for you**.
It expires on the ordinary schedule (30 days by default), so an embedded one
stops working partway through the year.

Ask the registry's operator for a **named token**: it carries a label, an
explicit lifetime that may be *never expires*, and can be revoked on its own
without disturbing anyone's session.

```sh
nt auth issue "beagle-cli updater" --never      # or: --days 365
```

The value is shown once. Treat it as an opaque string; nothing about its shape
is guaranteed.

Whatever its lifetime, treat `401` as "cannot check right now" rather than an
error worth showing the user, and carry on with the installed version. A token
can be revoked at any time, and an updater that breaks the app when it cannot
reach the registry is worse than one that never runs.

---

## 3. Reading a release

```http
GET /api/repos/beagle-cli/versions/latest
Authorization: Bearer <token>
```

```json
{
  "repo": "beagle-cli",
  "version": {
    "version": "1.2.0",
    "prerelease": false,
    "notes": "Fixed the thing",
    "createdAt": 1789064850,
    "artifacts": [
      {
        "platform": "linux-x64",
        "filename": "beagle-1.2.0-linux-x64",
        "contentType": "application/octet-stream",
        "size": 4096,
        "sha256": "676b5a2da889b846281746232963751d47edb1ceecaf56fd6c2d45aac1533e6f",
        "createdAt": 1789064850
      }
    ]
  }
}
```

Add `?prerelease=1` to let `latest` resolve to a prerelease. With it, the same
call returns `2.0.0-rc.1` and `"prerelease": true`.

### Downloading

```http
GET /api/repos/beagle-cli/versions/latest/download?platform=linux-x64
Authorization: Bearer <token>
```

Response headers, verbatim from a real download:

```
HTTP/1.1 200 OK
Content-Type: application/octet-stream
Content-Length: 4096
Content-Disposition: attachment; filename="beagle-1.2.0-linux-x64"
X-Checksum-SHA256: 676b5a2da889b846281746232963751d47edb1ceecaf56fd6c2d45aac1533e6f
```

`X-Checksum-SHA256` lets you verify without a second request. It is the same
value the metadata reports.

`platform` may be omitted **only** when the version has exactly one artifact.
With more than one you get `400 ambiguous_platform`, listing what exists.

---

## 4. The update algorithm

Implement exactly this. Each step exists because skipping it produces a
failure that is hard to attribute later.

1. **Know your own version** as a semver string, compiled in.
2. `GET /repos/{repo}/versions/latest`.
   - On any network error or `401`: stop, silently. Not an error the user
     needs. Try again next time.
3. **Compare by semver precedence, not string equality.** `1.10.0` is newer
   than `1.9.0`; string comparison says otherwise.
4. If not newer, stop.
5. Find the artifact whose `platform` matches this build. If there is none,
   stop — this release does not ship for your target, which is normal.
6. `GET …/download?platform=…` to a **temporary file**.
7. **Verify the sha256** against the metadata. On mismatch: delete it, stop,
   log. Never proceed.
8. Install: `chmod +x` if needed, then an **atomic rename** into place.
9. Restart, or tell the user to.

Steps 6–8 are one unit: a half-written file that looks complete is the worst
outcome available, because the next thing that happens is you execute it.

---

## 5. Reference implementation — Python

Stdlib only. Tested against a live registry.

```python
"""Self-update from the registry. Stdlib only."""

import hashlib
import json
import os
import re
import shutil
import stat
import tempfile
import urllib.error
import urllib.request

BASE = "https://api.nteague.com/api"
REPO = "beagle-cli"
TOKEN = os.environ.get("BEAGLE_UPDATE_TOKEN", "")  # or compiled in
PLATFORM = "linux-x64"
CURRENT = "1.0.0"

SEMVER = re.compile(
    r"^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$"
)


def precedence(version):
    """A sort key implementing semver precedence.

    A release outranks its own prereleases, so an absent prerelease sorts
    highest — hence the (1,) versus (0, ...) split. Numeric identifiers compare
    numerically and rank below alphanumeric ones.
    """
    match = SEMVER.match(version.strip())
    if not match:
        raise ValueError("not a semantic version: %r" % version)
    major, minor, patch, pre = match.groups()

    if pre is None:
        return (int(major), int(minor), int(patch), (1,))

    parts = []
    for identifier in pre.split("."):
        if identifier.isdigit():
            parts.append((0, int(identifier), ""))
        else:
            parts.append((1, 0, identifier))
    return (int(major), int(minor), int(patch), (0, tuple(parts)))


def is_newer(candidate, current):
    return precedence(candidate) > precedence(current)


def api(path):
    request = urllib.request.Request(
        BASE + path, headers={"Authorization": "Bearer " + TOKEN}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def check():
    """The latest release, or None if there is nothing to do.

    Every failure here is deliberately non-fatal. An updater that stops the
    application from starting because a server was unreachable is worse than
    one that never ran.
    """
    try:
        version = api("/repos/%s/versions/latest" % REPO)["version"]
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            return None       # token expired or revoked; not the user's problem
        if error.code == 404:
            return None       # no releases yet
        raise
    except (urllib.error.URLError, TimeoutError, OSError):
        return None           # offline

    if not is_newer(version["version"], CURRENT):
        return None

    for artifact in version["artifacts"]:
        if artifact["platform"] == PLATFORM:
            return version, artifact
    return None               # this release does not ship for us


def download(version, artifact):
    """Fetches and verifies. Returns a path, or raises."""
    url = "%s/repos/%s/versions/%s/download?platform=%s" % (
        BASE, REPO, version["version"], PLATFORM
    )
    request = urllib.request.Request(url, headers={"Authorization": "Bearer " + TOKEN})

    digest = hashlib.sha256()
    handle, path = tempfile.mkstemp(prefix=".update-")
    try:
        with urllib.request.urlopen(request, timeout=900) as response, \
                os.fdopen(handle, "wb") as out:
            while True:
                chunk = response.read(65536)
                if not chunk:
                    break
                digest.update(chunk)
                out.write(chunk)

        # Before anything executes it. A mismatch means the bytes on disk are
        # not the bytes that were published, and there is no safe way forward.
        if digest.hexdigest() != artifact["sha256"]:
            raise RuntimeError(
                "checksum mismatch: expected %s, got %s"
                % (artifact["sha256"], digest.hexdigest())
            )
        return path
    except BaseException:
        os.unlink(path)
        raise


def install(downloaded, target):
    """Replaces `target`. Atomic where the filesystem allows it."""
    os.chmod(downloaded, os.stat(downloaded).st_mode | stat.S_IEXEC | stat.S_IRUSR)

    # os.replace is atomic only within one filesystem, and the temp directory
    # is often on another. Moving it alongside the target first makes the
    # swap itself atomic, so there is no moment where the target is partial.
    staged = target + ".new"
    shutil.move(downloaded, staged)
    os.replace(staged, target)


def update(target):
    found = check()
    if not found:
        return None
    version, artifact = found
    install(download(version, artifact), target)
    return version["version"]


if __name__ == "__main__":
    installed = update("/usr/local/bin/beagle")
    print("updated to %s" % installed if installed else "already up to date")
```

---

## 6. Reference implementation — Node

```js
// Self-update from the registry. Node 18+, no dependencies.
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const BASE = 'https://api.nteague.com/api';
const REPO = 'beagle-cli';
const TOKEN = process.env.BEAGLE_UPDATE_TOKEN ?? '';
const PLATFORM = 'linux-x64';
const CURRENT = '1.0.0';

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Semver precedence: negative if a sorts before b. */
function compare(a, b) {
  const [, aMaj, aMin, aPat, aPre] = SEMVER.exec(a.trim());
  const [, bMaj, bMin, bPat, bPre] = SEMVER.exec(b.trim());

  for (const [x, y] of [[aMaj, bMaj], [aMin, bMin], [aPat, bPat]]) {
    if (Number(x) !== Number(y)) return Number(x) - Number(y);
  }
  // A release outranks its own prereleases.
  if (!aPre && !bPre) return 0;
  if (!aPre) return 1;
  if (!bPre) return -1;

  const left = aPre.split('.');
  const right = bPre.split('.');
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    const l = left[i];
    const r = right[i];
    const lNum = /^\d+$/.test(l);
    const rNum = /^\d+$/.test(r);
    if (lNum && rNum) {
      if (Number(l) !== Number(r)) return Number(l) - Number(r);
    } else if (lNum !== rNum) {
      return lNum ? -1 : 1;            // numeric ranks below alphanumeric
    } else if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return left.length - right.length;
}

const auth = { Authorization: `Bearer ${TOKEN}` };

/** The newer release and our artifact, or null. Never throws for the caller. */
async function check() {
  let response;
  try {
    response = await fetch(`${BASE}/repos/${REPO}/versions/latest`, { headers: auth });
  } catch {
    return null;                        // offline
  }
  if (!response.ok) return null;        // 401 expired, 404 nothing released

  const { version } = await response.json();
  if (compare(version.version, CURRENT) <= 0) return null;

  const artifact = version.artifacts.find((a) => a.platform === PLATFORM);
  return artifact ? { version, artifact } : null;
}

async function download({ version, artifact }) {
  const url = `${BASE}/repos/${REPO}/versions/${version.version}/download`
    + `?platform=${encodeURIComponent(PLATFORM)}`;
  const response = await fetch(url, { headers: auth });
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);

  const temp = path.join(os.tmpdir(), `.update-${process.pid}`);
  const digest = crypto.createHash('sha256');
  const file = fs.createWriteStream(temp);

  await pipeline(response.body, async function* (source) {
    for await (const chunk of source) {
      digest.update(chunk);
      yield chunk;
    }
  }, file);

  if (digest.digest('hex') !== artifact.sha256) {
    await fsp.unlink(temp);
    throw new Error('checksum mismatch — refusing to install');
  }
  return temp;
}

async function install(downloaded, target) {
  await fsp.chmod(downloaded, 0o755);
  // Staged beside the target so the final swap is on one filesystem, and
  // therefore atomic. rename() across devices fails outright on Linux.
  const staged = `${target}.new`;
  await fsp.copyFile(downloaded, staged);
  await fsp.unlink(downloaded);
  await fsp.rename(staged, target);
}

async function update(target) {
  const found = await check();
  if (!found) return null;
  await install(await download(found), target);
  return found.version.version;
}

module.exports = { update, compare };
```

---

## 7. Shell

For a build script or a container entrypoint:

```sh
#!/bin/sh
set -eu
BASE=https://api.nteague.com/api
REPO=beagle-cli
PLATFORM=linux-x64
: "${TOKEN:?set TOKEN}"

meta=$(curl -fsS "$BASE/repos/$REPO/versions/latest" -H "Authorization: Bearer $TOKEN")
version=$(printf '%s' "$meta" | jq -r .version.version)
want=$(printf '%s' "$meta" | jq -r --arg p "$PLATFORM" \
  '.version.artifacts[] | select(.platform == $p) | .sha256')

curl -fsS "$BASE/repos/$REPO/versions/$version/download?platform=$PLATFORM" \
  -H "Authorization: Bearer $TOKEN" -o beagle.new

got=$(sha256sum beagle.new | cut -d' ' -f1)
[ "$got" = "$want" ] || { echo "checksum mismatch" >&2; rm -f beagle.new; exit 1; }

chmod +x beagle.new && mv beagle.new beagle
echo "installed $version"
```

---

## 8. Publishing

From a build pipeline, either use the `nt` CLI:

```sh
pip install nt-registry-cli        # or: pip install -e path/to/cli
export NT_URL=https://api.nteague.com
export NT_TOKEN=…                  # nt auth issue "github actions" --days 365
nt repo beagle-cli upload dist/beagle-linux -v "$VERSION" -p linux-x64 -n "$NOTES"
```

or `curl` directly:

```sh
curl -fsS -X POST \
  "https://api.nteague.com/api/repos/beagle-cli/versions/$VERSION/artifacts" \
  -H "Authorization: Bearer $NT_TOKEN" \
  -F "file=@dist/beagle-linux" \
  -F "platform=linux-x64" \
  -F "notes=$NOTES"
```

`201` for a new artifact, `200` when it replaced an existing build of the same
platform. The response carries the `sha256` the server computed from the bytes
it received — compare it against your own to catch a corrupted upload:

```json
{"repo": "beagle-cli", "version": "1.2.0", "platform": "linux-x64",
 "replaced": false, "size": 4096, "sha256": "676b5a…"}
```

The repository must exist first (`nt repo create beagle-cli`). Versions do not:
one is created by its first upload.

### Platform names

There is no fixed list — a platform is any string matching
`^[a-z0-9][a-z0-9._-]{0,31}$`. **Whatever your pipeline uploads is what your
client must ask for**, so agree on it once and write it down. A workable set:

```
linux-x64  linux-arm64  macos-x64  macos-arm64  windows-x64  windows-arm64
```

Use `any` (the default when the field is omitted) for a single-build release.

---

## 9. Things that will bite you

### Every POST must carry a body

The host runs a WAF that rejects a POST with **no request body** — it answers
`403` with an HTML error page, before the request reaches the application. You
will not get a JSON error envelope, and the endpoint is not at fault.

Only bodyless POSTs are affected; `GET` and `DELETE` are fine. If you have a
POST with nothing to send, send `{}`:

```sh
curl -X POST "$BASE/auth/logout" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}'
```

### `latest` excludes prereleases, and that is the point

If you want `2.0.0-rc.1` you must pass `?prerelease=1`. An updater that opts in
by default ships every release candidate to every user.

### Compare versions by precedence, never as strings

`"1.10.0" < "1.9.0"` is true for strings and false for versions. Both reference
implementations above include a correct comparator; use one rather than
reaching for a string compare.

### An HTML body means it never reached the application

Every error the application produces is JSON of exactly this shape:

```json
{"error": {"code": "no_version", "message": "Version 9.9.9 is not in \"beagle-cli\"."}}
```

If you get HTML, something in front of it refused the request — the WAF above,
a proxy, or a redirect you did not follow. Do not try to parse it.

---

## 10. Error codes

Switch on `code`, never on `message`; messages are written for people and will
change.

| code | status | what to do |
| --- | --- | --- |
| `unauthorised` | 401 | Token missing, expired or revoked. In an updater: give up quietly. |
| `bad_password` | 403 | Wrong password on login. |
| `rate_limited` | 429 | Back off. Login is limited to 10 per 15 minutes per IP. |
| `read_only` | 503 | Writes are frozen. Reads still work. Do not retry uploads. |
| `no_repo` | 404 | No such repository. Check the name. |
| `bad_version` | 400 | Not semver, or `latest` where a real version is required. |
| `no_version` | 404 | No such version, or nothing released yet. |
| `no_artifact` | 404 | No build for that platform. Carries `platforms`. |
| `ambiguous_platform` | 400 | Several builds, none named. Carries `platforms`. |
| `too_large` | 413 | Over the limit, or truncated by the web server. |
| `no_space` | 503 | Registry is full. Tell the operator. |
| `server_error` | 500 | A bug. Retry once, then report it. |

`no_artifact` and `ambiguous_platform` include the platforms that do exist:

```json
{"error": {"code": "no_artifact",
           "message": "Version 1.2.0 has no \"solaris\" build.",
           "platforms": ["linux-x64"]}}
```

Surface that list rather than only the failure.

### Retrying

`GET` requests are safe to retry. Upload is idempotent per
`(repo, version, platform)` — retrying replaces rather than duplicating, so a
timed-out upload can simply be repeated. Back off on `429`; do not retry `4xx`
other than `429`.

Reads are not rate limited, but poll for updates on the order of hours, not
minutes.

---

## 11. Testing your integration

Do not develop against the live registry. From this repository:

```sh
make registry_dev
```

That starts the API and a browser UI on `http://localhost:8788` with a
throwaway password, seeded with several releases across several platforms
including a prerelease — everything an update flow needs to exercise. It prints
the password and the environment to use. Ctrl-C deletes it all.

Point your client at `http://localhost:8788/api` and get a token with:

```sh
curl -sX POST http://localhost:8788/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"local-dev-password","label":"my integration"}'
```

---

## 12. Before you call it done

- [ ] Version comparison uses semver precedence, and `1.10.0 > 1.9.0` passes.
- [ ] A prerelease is never installed unless explicitly opted in.
- [ ] The sha256 is verified before anything is executed or installed.
- [ ] A failed or mismatched download leaves no file behind.
- [ ] Installation is an atomic rename within one filesystem.
- [ ] Network failure, `401` and `404` leave the app running on its current
      version and do not surface as errors to the user.
- [ ] The embedded credential is a token, not the password.
- [ ] Every POST sends a body.
- [ ] Errors are handled by `code`, and `platforms` is surfaced when present.
- [ ] Tested against `make registry_dev`, including the no-update-available,
      update-available and wrong-platform paths.
