# `nt` — the registry client

Command line client for the release registry at `api.nteague.com`. The server
lives in [`php/registry`](../php/registry) in this repository, and its API is
documented there.

## Install

```sh
pip install -e cli          # from the repository root
nt --version
```

No dependencies — it is stdlib only, so it installs cleanly on a build machine
or in a CI image without a package index being reachable.

## Getting started

```sh
nt auth login                       # prompts for the password
nt repo create beagle-cli -d "The beagle tool"
nt repo beagle-cli upload dist/beagle -v 1.0.0 -p linux-x64 -n "First release"
nt list
nt repo beagle-cli list
nt repo beagle-cli pull ./downloads          # newest release, into a directory
```

## Commands

Every `nt repo` command can be written either way round — `nt repo beagle-cli
list` or `nt repo list beagle-cli`. The first reads better; the second is what
the parser sees.

| Command | What it does |
| --- | --- |
| `nt auth login` | Exchange the password for a token, saved locally. |
| `nt auth logout` | Revoke this machine's token, server-side too. |
| `nt auth status` | Which registry, and whether you are logged in. |
| `nt auth tokens` | Every live token, and when it was last used. |
| `nt auth revoke <id>` | Revoke one token — a laptop you no longer have. |
| `nt list` | Every repository, with its latest release. |
| `nt health` | Whether the registry is up. Needs no token. |
| `nt repo create <repo> [-d DESC]` | Create a repository. |
| `nt repo delete <repo> [-y]` | Delete it and every release in it. |
| `nt repo <repo> list` | Every version, newest first. |
| `nt repo <repo> info [-v V]` | One version in detail. Defaults to latest. |
| `nt repo <repo> upload <file> -v V [-p PLATFORM] [-n NOTES]` | Upload a build. |
| `nt repo <repo> pull [DEST] [-v V] [-p PLATFORM]` | Download a build. |
| `nt repo <repo> remove -v V [-p PLATFORM] [-y]` | Remove a version, or one build of it. |

### Versions and platforms

Versions are [semver](https://semver.org). `-v latest` — the default for `pull`
and `info` — means the highest full release, never a prerelease; pass
`--prerelease` to include those.

A version can hold one build per platform, so a single release carries every
target you ship:

```sh
nt repo beagle-cli upload dist/beagle-linux   -v 1.2.0 -p linux-x64
nt repo beagle-cli upload dist/beagle.exe     -v 1.2.0 -p windows
nt repo beagle-cli upload dist/beagle-macos   -v 1.2.0 -p macos-arm64
```

`pull` only needs `-p` when there is more than one build to choose from, and
says which are available when it does. Uploading the same platform again
replaces that build rather than adding a second.

`pull` into a directory writes the file under the name it was uploaded with;
`pull` to a path writes it there.

## Scripting

`--json` prints the raw response instead of a table:

```sh
nt --json repo beagle-cli info -v latest | jq -r '.artifacts[].sha256'
```

Downloads are written to a `.part` file and renamed into place, so an
interrupted `pull` never leaves a truncated file that looks complete.

## In CI

Set `NT_TOKEN` and skip the login step entirely — nothing is written to the
runner's disk:

```sh
export NT_URL=https://api.nteague.com
export NT_TOKEN=...                    # from `nt auth login` on your machine
nt repo beagle-cli upload dist/beagle -v "$VERSION" -p linux-x64
```

Mint a token for this and nothing else, so `nt auth revoke` can retire it
without disturbing your own sessions.

## Configuration

| | |
| --- | --- |
| `~/.config/nt/config.json` | The saved URL and token. Mode `600`. |
| `NT_URL` | Registry to talk to. Overrides the saved one. |
| `NT_TOKEN` | Token to use. Overrides the saved one; nothing is written. |
| `NT_CONFIG` | Use a different config file entirely. |
| `NT_PASSWORD` | Read by `auth login` instead of prompting. |
| `--url`, `--json`, `--insecure` | Per-command overrides. |

## Against a local registry

`make registry_dev` from the repository root starts the whole stack with a
throwaway password and prints the two variables to export. Always use the
`NT_CONFIG` it gives you: logging in to a dev server otherwise overwrites the
token for the real one.

```sh
export NT_URL=http://localhost:8788
export NT_CONFIG=/tmp/…/nt-config.json
nt auth login
```

## Tests

```sh
make test_nt        # from the repository root
```

Two suites, both needing `php` on `PATH` and both skipping themselves if there
is none.

`test_cli.py` runs every command against the **real** API — real routing, real
auth, real semver resolution, real bytes on disk — with no server running and
nothing deployed. Each request goes through `php/registry/tests/handle.php`,
which runs the genuine router in a subprocess. A mock would drift from the
server and quietly stop testing anything; this cannot.

`test_http.py` covers what that deliberately skips: the real transport. It
starts `php -S` and pushes a large artifact through the streaming multipart
body and back, comparing bytes. A boundary off by one produces a corrupted file
rather than an error, so only comparing the bytes proves anything.
