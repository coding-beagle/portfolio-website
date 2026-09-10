# Registry — `api.nteague.com`

A private release registry: versioned build artifacts, uploaded from a laptop
or from CI, downloaded by whatever needs them — including the applications
themselves, checking whether they are out of date.

- **Server** — this directory. PHP, SQLite, no dependencies, no build step.
- **Client** — [`cli/`](../../cli), the `nt` command line tool.
- **Browser** — the same API, at the root of the subdomain.

Everything needs a token. There is no anonymous read path: a build you have not
shipped yet is not something a stranger should be able to enumerate.

---

## Contents

- [Concepts](#concepts)
- [Setting it up](#setting-it-up)
- [API reference](#api-reference)
- [Errors](#errors)
- [How it is put together](#how-it-is-put-together)
- [Testing](#testing)
- [Operating it](#operating-it)

---

## Concepts

Three levels:

| | |
| --- | --- |
| **Repository** | One project. `beagle-cli`. Lower case, `[a-z0-9][a-z0-9._-]{0,63}`. |
| **Version** | One [semver](https://semver.org) release of it. `1.4.2`, `2.0.0-rc.1`. |
| **Artifact** | One file in that release, keyed by **platform**. `linux-x64`, `windows`. |

A version holds at most one artifact per platform, so one release carries every
target you ship and a client asks for the build it wants by name rather than
guessing at filenames. Uploading the same platform again replaces that build.

Versions are not created on their own — an empty release is not something a
client can be handed, so a version comes into existence with its first upload
and disappears with its last deletion.

**`latest`** is accepted anywhere a version is. It means the highest full
release by semver precedence and never a prerelease, unless the caller passes
`?prerelease=1`. That default is the whole point of tagging something `-rc.1`.

---

## Setting it up

### 0. Requirements

**PHP 8.1 or newer**, with `pdo_sqlite` and `json`. Set the subdomain's version
in cPanel's *MultiPHP Manager* before deploying — on 8.0 the app does not parse,
and a parse error with `display_errors` off serves a completely blank 500.
`doctor.php` checks this first.

### 1. The subdomain

Point `api.nteague.com` at its own document root — `~/public_api_html` in the
examples below. Then deploy:

```sh
make deploy_registry
```

which lays out:

```
public_api_html/
├── .htaccess          HTTPS redirect, HSTS
├── index.html         the management UI
├── assets/
└── api/
    ├── .htaccess      front-controller rewrite, Authorization passthrough
    ├── index.php
    ├── lib/           the app  (.htaccess: deny all)
    └── cli/           doctor and sweep  (.htaccess: deny all)
```

### 2. The config

```sh
cp php/registry/config.sample.php ~/registry_config.php
```

Outside the document root — that is what keeps artifacts unreachable without a
token and what stops the next deploy's `rm -rf` taking every release with it.
The API refuses to start if `data_dir` is inside the web root.

Set a password:

```sh
php -r '$p = trim(fgets(STDIN)); echo password_hash($p, PASSWORD_DEFAULT), PHP_EOL;'
```

Type it, press enter, and put the `$2y$…` output in `admin_password_hash`. The
password itself never touches your shell history or the config file.

With no password set, nothing can log in and only `/api/health` answers. That
is the intended failure mode for a missing config — an update server that is
accidentally open is a considerably worse outcome than one that is closed.

### 3. Check it

```sh
php ~/public_api_html/api/cli/doctor.php
REGISTRY_PASSWORD=… make smoke_registry REGISTRY_URL=https://api.nteague.com
```

`doctor.php` checks PHP's extensions and limits, the config, the database, and
that every artifact row still has its bytes on disk.

### 4. The sweeper

```
17 * * * * /usr/local/bin/php ~/public_api_html/api/cli/sweep.php
```

Clears expired tokens, stale rate-limit rows, and blob directories with no row
behind them. Optional — ordinary requests do a little of this on the way past —
but without it the orphan cleanup never runs.

It never touches a release. Artifacts are permanent until something asks for
them to go; a release that vanished on its own would break every client still
on it.

---

## API reference

Base URL `https://api.nteague.com/api`. JSON in, JSON out, except artifact
downloads. Authentication is `Authorization: Bearer <token>` on everything
except `/health` and `/auth/login`.

`{version}` is a semver string or the literal `latest`. `{repo}` and
`{platform}` are the restricted names above.

### Health

#### `GET /health`

The only endpoint that answers without a token, so a monitor can tell "up" from
"down" without holding a credential. It deliberately says nothing about what is
stored.

```json
{
  "ok": true,
  "acceptingWrites": true,
  "authConfigured": true,
  "uploadCeiling": 2097152,
  "maxArtifactBytes": 536870912
}
```

`uploadCeiling` is what the **web server** will accept in one request — usually
smaller than `maxArtifactBytes`, and the limit that actually bites.

### Authentication

#### `POST /auth/login`

```json
{ "password": "…", "label": "laptop" }
```

→ `201`

```json
{ "token": "…", "tokenId": "uuid", "expiresAt": 1789060250 }
```

`label` is optional and only ever shown back in the token list. Rate limited
per client IP; a *correct* password never spends the budget, so normal use
cannot lock you out of your own registry.

#### `POST /auth/logout`

Revokes the calling token. → `{"revoked": true}`

#### `GET /auth/whoami`

→ `{"ok": true, "tokenId": "…", "label": "…", "expiresAt": 1789060250}`

#### `GET /auth/tokens`

Every live token. No hashes ever leave the server.

```json
{
  "tokens": [
    { "id": "uuid", "label": "laptop", "createdAt": 0, "expiresAt": 0, "lastSeenAt": 0 }
  ],
  "you": "uuid"
}
```

#### `DELETE /auth/tokens/{id}` · `DELETE /auth/tokens`

Revoke one, or all. Revoking takes effect on the next request.

### Repositories

#### `GET /repos`

```json
{
  "repos": [
    {
      "name": "beagle-cli",
      "description": "The beagle tool",
      "versionCount": 4,
      "latest": "1.2.0",
      "latestPrerelease": "2.0.0-rc.1",
      "bytesUsed": 8123456,
      "createdAt": 0,
      "updatedAt": 0
    }
  ]
}
```

`latest` is resolved exactly as `-v latest` resolves it, so what the listing
calls latest is what a client would actually be handed. A staged prerelease is
reported alongside rather than folded in, so it is visible without ever being
served by accident.

#### `POST /repos`

```json
{ "name": "beagle-cli", "description": "optional" }
```

→ `201 {"repo": {…}}` · `409 exists` · `400 bad_name`

Names are not case-folded. `Beagle` is refused rather than quietly stored as
`beagle` and then unfindable under the name you typed.

#### `GET /repos/{repo}`

The repo summary plus every version in full.

```json
{ "repo": { … }, "versions": [ { … } ] }
```

#### `DELETE /repos/{repo}`

Deletes the repository, every version, and every byte on disk. → `{"deleted": true}`

### Versions

#### `GET /repos/{repo}/versions`

Newest first by semver precedence — including prerelease ordering, which is why
this is sorted by the server rather than by whoever displays it.

#### `GET /repos/{repo}/versions/{version}`

```json
{
  "repo": "beagle-cli",
  "version": {
    "version": "1.2.0",
    "prerelease": false,
    "notes": "Fixed the thing",
    "createdAt": 0,
    "artifacts": [
      {
        "platform": "linux-x64",
        "filename": "beagle-1.2.0-linux",
        "contentType": "application/octet-stream",
        "size": 4096123,
        "sha256": "…",
        "createdAt": 0
      }
    ]
  }
}
```

Query: `?prerelease=1` lets `latest` resolve to a prerelease.

#### `DELETE /repos/{repo}/versions/{version}`

Deletes the version and every artifact in it.

### Artifacts

#### `POST /repos/{repo}/versions/{version}/artifacts`

`multipart/form-data`:

| field | | |
| --- | --- | --- |
| `file` | required | The bytes. |
| `platform` | optional | Defaults to `any`. |
| `notes` | optional | Release notes; set on the version. |

→ `201` when it is new, `200` when it replaced an existing build of the same
platform.

```json
{
  "repo": "beagle-cli",
  "version": "1.2.0",
  "platform": "linux-x64",
  "replaced": false,
  "size": 4096123,
  "sha256": "…"
}
```

`latest` is refused here: it is a name for a release, not a release.

The `sha256` is computed from the bytes **after** they land, so it describes
what will actually be served back rather than what was supposed to arrive.

```sh
curl -X POST https://api.nteague.com/api/repos/beagle-cli/versions/1.2.0/artifacts \
  -H "Authorization: Bearer $TOKEN" \
  -F file=@dist/beagle-linux \
  -F platform=linux-x64 \
  -F notes="Fixed the thing"
```

#### `GET /repos/{repo}/versions/{version}/download`

The bytes. `?platform=` picks the build; omit it when the version has only one.

Served as `application/octet-stream`, `Content-Disposition: attachment`, with
`X-Checksum-SHA256` so a client can verify what it just downloaded without a
second request. Never as anything a browser would render: this hands out
executables.

```sh
curl -fL -o beagle \
  -H "Authorization: Bearer $TOKEN" \
  "https://api.nteague.com/api/repos/beagle-cli/versions/latest/download?platform=linux-x64"
```

#### `GET /repos/{repo}/versions/{version}/artifacts/{platform}`

The artifact's metadata, without the bytes.

#### `DELETE /repos/{repo}/versions/{version}/artifacts/{platform}`

Removes one build. If it was the last one, the version goes too.

### As an update check

The whole flow an application needs, on a version it already knows:

```sh
# 1. what is current?
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.nteague.com/api/repos/beagle-cli/versions/latest

# 2. if it is newer than yours, fetch it and check the hash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.nteague.com/api/repos/beagle-cli/versions/latest/download?platform=linux-x64" \
  -o beagle.new
```

Compare the `sha256` from step 1 against the downloaded file before running it.

> **On embedding tokens.** Every endpoint here needs one, so a shipped
> application needs a credential of its own. A token compiled into a binary is
> extractable by anyone holding that binary — mint a token used for nothing but
> update checks, so `DELETE /auth/tokens/{id}` can retire it on its own.

---

## Errors

Every failure is the same shape. `code` is what to switch on; `message` is for
a person.

```json
{ "error": { "code": "no_version", "message": "Version 3.0.0 is not in \"beagle-cli\"." } }
```

| code | status | |
| --- | --- | --- |
| `unauthorised` | 401 | Missing, unknown or expired token. |
| `bad_password` | 403 | Wrong password on login. |
| `not_configured` | 503 | No password set on the server. |
| `rate_limited` | 429 | Too many logins or uploads from this IP. |
| `read_only` | 503 | Writes are frozen. Reads still work. |
| `bad_name` | 400 | Repository name outside the allowed set. |
| `exists` | 409 | That repository is already there. |
| `no_repo` | 404 | No such repository. |
| `bad_version` | 400 | Not semver, or `latest` where a real version is needed. |
| `no_version` | 404 | No such version, or no releases yet. |
| `bad_platform` | 400 | Platform name outside the allowed set. |
| `no_artifact` | 404 | No build for that platform. Carries `platforms`. |
| `ambiguous_platform` | 400 | Several builds, none named. Carries `platforms`. |
| `no_file` / `empty_file` | 400 | Nothing attached, or zero bytes. |
| `too_large` | 413 | Over the artifact limit, or truncated by the web server. |
| `no_space` | 503 | At the global ceiling. |
| `not_found` / `method_not_allowed` | 404 / 405 | Routing. |
| `server_error` | 500 | A bug. Check the error log. |

`no_artifact` and `ambiguous_platform` include a `platforms` array of what does
exist, so the client can say what to type instead of only that it failed.

Note that an anonymous caller gets `401` even for a path that does not exist:
not holding a token tells you nothing about which endpoints are there.

---

## How it is put together

```
api/
├── index.php          web entry point — builds a request, emits a response
└── lib/
    ├── http.php       RegRequest / RegResponse, and reg_emit()
    ├── router.php     reg_handle(): every route, as one pure function
    ├── auth.php       the password, and the tokens it issues
    ├── repos.php      repos, versions, artifacts, blobs on disk
    ├── semver.php     parsing and precedence
    ├── limits.php     rate limiting and the disk guard
    ├── db.php         SQLite connection and schema
    └── config.php     config loading, and the data-directory guard
```

The one structural decision worth knowing about:

**`reg_handle(RegRequest): RegResponse` is a pure function.** It reads no
superglobals, sends no headers, and never calls `exit`. Serving a real request
is two thin adapters at the edges — `RegRequest::fromGlobals()` and
`reg_emit()` — and everything between them is ordinary code that takes a value
and returns one.

That is what makes the test suite possible. The whole API — routing, auth
guards, validation, uploads, downloads, the kill switch — is exercised
in-process against a temporary database, with no server to start, no port to
pick, and nothing deployed. It also means the `nt` CLI can be tested against
the genuine API rather than a mock of it.

The one thing the two entry points genuinely differ on is uploads: a real
request must move its temp file with `move_uploaded_file()`, which refuses any
path PHP did not receive itself. That is a single `uploaded` flag on the file,
not a branch that runs through the app.

### Storage

SQLite in WAL mode, plus one file per artifact under
`<data_dir>/blobs/<repo-id>/<version-id>/<artifact-id>`. Tables: `tokens`,
`repos`, `versions`, `artifacts`, `rate_limits`.

Rows and bytes are two records of the same thing, so the order they change in
matters. Bytes land before the row that claims they exist; rows are deleted
before the bytes they point at. A crash between the two leaves an orphan
directory, which the sweeper finds — the other order would leave a row pointing
at nothing, which is what actually breaks a client mid-download.

Versions store `major`/`minor`/`patch` alongside the original string, but
ordering finishes in PHP: prerelease precedence is a dot-separated identifier
comparison that SQL cannot express.

---

## Testing

```sh
make test_registry          # the API, in-process. No server, no network.
make test_registry_http     # the same over HTTP, against php -S
make test_nt                # the nt CLI, against the real API
make test_registry_all      # all three

REGISTRY_PASSWORD=… make smoke_registry REGISTRY_URL=https://api.nteague.com   # a deployed one
```

Three layers, each covering what the one below it cannot:

**`tests/run.php`** drives `reg_handle()` directly — 150-odd cases over
routing, auth, semver, uploads, downloads, deletion, the kill switch and the
sweeper. This is where the API's behaviour is actually pinned down, because it
costs nothing to run and nothing to set up.

**`tests/local.sh`** runs the HTTP checks against `php -S`. Deliberately short:
it exists for what only a real SAPI has — multipart parsing, streamed
download, the front controller under a web server.

**`cli/tests/`** runs every `nt` command against the real API through
`tests/handle.php`, a one-request-per-process JSON pipe into `reg_handle()`. No
mock of the server exists anywhere, so nothing can drift out of sync with it.
Its `test_http.py` covers what that bypasses — the client's own transport —
by pushing a large artifact through a real `php -S` and comparing the bytes.

**`tests/smoke.sh`** is the only one that needs something deployed, and covers
the things only the real host can be wrong about: the `.htaccess` rewrite, and
whether the `Authorization` header survives the trip to PHP — which on a fresh
cPanel subdomain it does not, without the `RewriteRule` in `api/.htaccess`.

Run it against a live server and it creates a throwaway repo, uploads to it,
downloads it back byte for byte, and cleans up after itself.

---

## Running it locally

```sh
make registry_dev
```

The API and the management UI on :8788, a throwaway password, and a few seeded
releases — several versions, several platforms, one prerelease — so the UI has
something to show. It prints the password and the environment to drive it with:

```
  UI          http://localhost:8788
  password    local-dev-password

    export NT_URL=http://localhost:8788
    export NT_CONFIG=/tmp/…/nt-config.json
    nt auth login
```

The scratch `NT_CONFIG` is not a detail. Logging in to a dev server writes a
token, and without it that token would replace the one for the real registry in
`~/.config/nt/config.json`.

Ctrl-C deletes the database and every artifact, so each run starts empty and
with empty rate limits.

| | |
| --- | --- |
| `PORT=9000` | Serve somewhere else. |
| `REGISTRY_PASSWORD=…` | Use your own instead of the throwaway one. |
| `REGISTRY_DEV_DATA=~/dir` | Keep the data between runs. Then it is yours to clean up. |
| `NO_SEED=1` | Start empty. |
| `NO_OPEN=1` | Do not open a browser. |

`make run_registry` is the bare server against your own config, for pointing at
real data. Note that a registry with no `admin_password_hash` cannot be logged
into at all, so on a fresh checkout that is a login screen you cannot get past —
which is what `registry_dev` exists to avoid.

---

## Operating it

### Freezing releases

Set `accepting_writes => false` in the config. Downloads keep working; every
upload and delete is refused with `read_only`. No deploy needed — it is read on
each request. That is how you stop the world without taking every client that
polls this server offline.

### A leaked token

`nt auth revoke <id>`, or the tokens panel in the browser UI. `DELETE
/auth/tokens` revokes every token including your own, which is the right move
if you are not sure which one leaked.

### A leaked password

Change `admin_password_hash` in the config, then revoke every token — existing
tokens keep working after a password change, which is what you want ordinarily
and not what you want here.

### Running low on space

`doctor.php` reports usage against `global_bytes_ceiling`. Past
`disk_soft_fraction` of it the health endpoint and the UI say so; at the
ceiling, uploads are refused and everything else carries on.

Nothing expires on its own. Old versions go when you remove them:

```sh
nt repo beagle-cli remove -v 0.9.0 -y
```

### Things that are usually the problem

| | |
| --- | --- |
| Every request is 401 | The `Authorization` header is not reaching PHP. `make smoke_registry` says so explicitly. |
| Large uploads fail at exactly the same size | `post_max_size` / `upload_max_filesize`. `GET /api/health` reports the live values. |
| `not_configured` on login | No `admin_password_hash`. |
| 500 on everything | `doctor.php`. Usually `data_dir` not writable, or `pdo_sqlite` not enabled. |
