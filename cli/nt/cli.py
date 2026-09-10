"""The command line: parsing, and printing.

Kept apart from :mod:`nt.client`, which knows the API but has no opinion about
output, and from :mod:`nt.transport`, which knows the network but not the API.
The split is what makes the whole tool testable against a registry that is not
running — see ``cli/tests``.
"""

import argparse
import datetime
import getpass
import json
import os
import sys
from pathlib import Path

from . import __version__
from .client import Client
from .config import ENV_TOKEN, Config
from .errors import NtError
from .transport import HttpTransport

#: The verbs `nt repo` understands. Everything else in that position is read as
#: a repository name, which is what lets both `nt repo create beagle` and
#: `nt repo beagle upload ...` work — see :func:`normalise`.
REPO_ACTIONS = ("create", "delete", "list", "info", "upload", "pull", "remove")


# --- argument parsing ----------------------------------------------------

#: Global options that swallow the token after them, so the scan for where the
#: command actually starts does not mistake their value for it.
GLOBAL_VALUE_FLAGS = ("--url",)


def command_index(argv):
    """Where the command starts, skipping any global options before it.

    ``nt --json repo beagle list`` has to normalise the same way
    ``nt repo beagle list`` does; assuming the command is at index 0 would
    silently stop rewriting as soon as anyone passed a global flag.
    """
    index = 0
    while index < len(argv):
        token = argv[index]
        if not token.startswith("-"):
            return index
        index += 2 if token in GLOBAL_VALUE_FLAGS else 1
    return None


def normalise(argv):
    """Rewrites ``nt repo <name> <action>`` into ``nt repo <action> <name>``.

    The natural way to type these is subject-first — `nt repo beagle upload` —
    and the natural way for argparse to read them is verb-first, because the
    verb is what decides which flags are legal. Swapping the two here is a
    handful of lines and means neither the user nor the parser has to give in.

    A repository named after one of the verbs would be ambiguous. Such a name
    is still reachable the other way round (`nt repo list list`), and naming a
    project "upload" is a problem that mostly solves itself.
    """
    argv = list(argv)
    start = command_index(argv)
    if start is None or argv[start] != "repo":
        return argv

    name, action = start + 1, start + 2
    if action < len(argv) and argv[name] not in REPO_ACTIONS and argv[action] in REPO_ACTIONS:
        argv[name], argv[action] = argv[action], argv[name]
    return argv


def build_parser():
    parser = argparse.ArgumentParser(
        prog="nt",
        description="Client for a private release registry.",
        epilog="Full documentation: php/registry/README.md in the portfolio-website repository.",
    )
    parser.add_argument("--version", action="version", version="nt " + __version__)
    parser.add_argument(
        "--url",
        help="Registry to talk to. Overrides the saved one and $NT_URL for this command.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print raw JSON instead of a table, for scripting.",
    )
    parser.add_argument(
        "--insecure",
        action="store_true",
        help="Skip TLS verification. For a self-signed test server only.",
    )

    commands = parser.add_subparsers(dest="command", metavar="<command>")

    # -- auth --
    auth = commands.add_parser("auth", help="Log in and out.")
    auth_commands = auth.add_subparsers(dest="auth_command", metavar="<command>")

    login = auth_commands.add_parser("login", help="Exchange the password for a token.")
    login.add_argument("--password", help="Read from a prompt if not given. Prefer the prompt.")
    login.add_argument("--label", default="", help="How this token shows up in `nt auth tokens`.")

    auth_commands.add_parser("logout", help="Revoke this machine's token.")
    auth_commands.add_parser("status", help="Show which registry, and whether logged in.")
    auth_commands.add_parser("tokens", help="List every live token.")
    revoke = auth_commands.add_parser("revoke", help="Revoke one token by id.")
    revoke.add_argument("id", help="From `nt auth tokens`.")

    # -- top level --
    commands.add_parser("list", help="List repositories.")
    commands.add_parser("health", help="Check the registry is up.")

    # -- repo --
    repo = commands.add_parser("repo", help="Work with one repository.")
    repo_commands = repo.add_subparsers(dest="repo_command", metavar="<command>")

    create = repo_commands.add_parser("create", help="Create a repository.")
    create.add_argument("repo")
    create.add_argument("-d", "--description", default="", help="What the project is.")

    delete = repo_commands.add_parser("delete", help="Delete a repository and every release.")
    delete.add_argument("repo")
    delete.add_argument("-y", "--yes", action="store_true", help="Skip the confirmation.")

    listing = repo_commands.add_parser("list", help="List a repository's versions.")
    listing.add_argument("repo")

    info = repo_commands.add_parser("info", help="Show one version in detail.")
    info.add_argument("repo")
    info.add_argument("-v", "--version", default="latest", help="Default: latest.")
    info.add_argument("--prerelease", action="store_true", help="Let latest mean a prerelease.")

    # Positionals are declared repo-first because that is the order they arrive
    # in after normalise(), for both `nt repo <name> upload <file>` and the
    # canonical `nt repo upload <name> <file>`.
    upload = repo_commands.add_parser("upload", help="Upload a build.")
    upload.add_argument("repo")
    upload.add_argument("file")
    upload.add_argument("-v", "--version", required=True, help="Semver, such as 1.4.2.")
    upload.add_argument(
        "-p", "--platform", default="",
        help="Which build this is, such as linux-x64. Default: any.",
    )
    upload.add_argument("-n", "--notes", default="", help="Release notes.")

    pull = repo_commands.add_parser("pull", help="Download a build.")
    pull.add_argument("repo")
    pull.add_argument("dest", nargs="?", default=".", help="File or directory. Default: here.")
    pull.add_argument("-v", "--version", default="latest", help="Default: latest.")
    pull.add_argument("-p", "--platform", default="", help="Needed only if the version has several.")
    pull.add_argument("--prerelease", action="store_true", help="Let latest mean a prerelease.")

    remove = repo_commands.add_parser("remove", help="Remove a version, or one of its builds.")
    remove.add_argument("repo")
    remove.add_argument("-v", "--version", required=True)
    remove.add_argument(
        "-p", "--platform", default="",
        help="Remove just this build. Without it, the whole version goes.",
    )
    remove.add_argument("-y", "--yes", action="store_true", help="Skip the confirmation.")

    return parser


# --- formatting ----------------------------------------------------------

def human_bytes(count):
    count = float(count)
    for unit in ("B", "KB", "MB", "GB"):
        if count < 1024 or unit == "GB":
            return ("%d %s" % (count, unit)) if unit == "B" else ("%.1f %s" % (count, unit))
        count /= 1024


def human_time(seconds):
    if not seconds:
        return "—"
    return datetime.datetime.fromtimestamp(seconds).strftime("%Y-%m-%d %H:%M")


def table(rows, headers):
    """A plain aligned table. No box drawing: this gets piped into things."""
    if not rows:
        return ""
    widths = [len(h) for h in headers]
    for row in rows:
        for index, cell in enumerate(row):
            widths[index] = max(widths[index], len(str(cell)))

    lines = ["  ".join(h.ljust(widths[i]) for i, h in enumerate(headers)).rstrip()]
    lines.append("  ".join("-" * widths[i] for i in range(len(headers))))
    for row in rows:
        lines.append("  ".join(str(c).ljust(widths[i]) for i, c in enumerate(row)).rstrip())
    return "\n".join(lines)


def confirm(question, assume_yes):
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        raise NtError(
            "Refusing to %s without a confirmation." % question,
            hint="Pass -y if you mean it.",
        )
    return input("%s [y/N] " % question).strip().lower() in ("y", "yes")


# --- commands ------------------------------------------------------------

class App:
    """One invocation: the parsed arguments, the config, and somewhere to talk."""

    def __init__(self, args, config, client, out=sys.stdout):
        self.args = args
        self.config = config
        self.client = client
        self.out = out

    def say(self, *parts):
        print(*parts, file=self.out)

    def emit(self, payload):
        """Prints JSON when asked to, and returns whether it did."""
        if self.args.json:
            self.say(json.dumps(payload, indent=2))
            return True
        return False

    # -- auth --

    def auth_login(self):
        password = self.args.password or os.environ.get("NT_PASSWORD")
        if not password:
            password = getpass.getpass("Password for %s: " % self.config.url)
        if not password:
            raise NtError("No password given.")

        label = self.args.label or _default_label()
        result = self.client.login(password, label)

        self.config.token = result["token"]
        self.config.expires_at = result.get("expiresAt", 0)
        self.config.save()

        if self.emit({"url": self.config.url, "expiresAt": self.config.expires_at}):
            return 0
        self.say("Logged in to %s." % self.config.url)
        self.say("Token expires %s. Stored in %s." % (
            human_time(self.config.expires_at), self.config.path
        ))
        return 0

    def auth_logout(self):
        self.config.require_token()
        try:
            self.client.logout()
        except NtError as error:
            # An already-dead token is the state we were trying to reach, so
            # clearing it locally and reporting success is the honest answer.
            if error.code not in ("unauthorised", "unreachable"):
                raise
        if not self.config.token_from_env:
            self.config.clear_token()
        self.say("Logged out.")
        return 0

    def auth_status(self):
        status = {"url": self.config.url, "loggedIn": False, "config": str(self.config.path)}
        if self.config.token:
            try:
                who = self.client.whoami()
                status.update(
                    loggedIn=True,
                    tokenId=who["tokenId"],
                    label=who.get("label", ""),
                    expiresAt=who.get("expiresAt", 0),
                )
            except NtError as error:
                status["problem"] = error.message

        if self.emit(status):
            return 0

        self.say("Registry:  %s" % status["url"])
        self.say("Config:    %s" % status["config"])
        if status["loggedIn"]:
            self.say("Logged in: yes, as %s" % (status["label"] or "unlabelled"))
            self.say("Expires:   %s" % human_time(status["expiresAt"]))
        elif self.config.token:
            self.say("Logged in: no — %s" % status.get("problem", "the stored token was refused"))
        else:
            self.say("Logged in: no. Run `nt auth login`.")
        return 0 if status["loggedIn"] else 1

    def auth_tokens(self):
        data = self.client.tokens()
        if self.emit(data):
            return 0
        rows = [
            (
                token["id"][:8],
                token["label"] or "—",
                human_time(token["lastSeenAt"]),
                human_time(token["expiresAt"]),
                "  <- this one" if token["id"] == data.get("you") else "",
            )
            for token in data["tokens"]
        ]
        self.say(table(rows, ["ID", "LABEL", "LAST USED", "EXPIRES", ""]) or "No live tokens.")
        return 0

    def auth_revoke(self):
        self.client.revoke(self.args.id)
        self.say("Revoked.")
        return 0

    # -- top level --

    def health(self):
        data = self.client.health()
        if self.emit(data):
            return 0
        self.say("%s is up." % self.config.url)
        if not data.get("acceptingWrites"):
            self.say("Read-only mode is on: downloads work, uploads do not.")
        if not data.get("authConfigured"):
            self.say("No password is configured, so nothing can log in.")
        self.say("Largest upload the web server will take: %s" % human_bytes(data.get("uploadCeiling", 0)))
        return 0

    def list_repos(self):
        repos = self.client.repos()
        if self.emit(repos):
            return 0
        if not repos:
            self.say("No repositories yet. Create one with `nt repo create <name>`.")
            return 0
        rows = [
            (
                repo["name"],
                repo["latest"] or "—",
                repo["latestPrerelease"] or "",
                repo["versionCount"],
                human_bytes(repo["bytesUsed"]),
                repo["description"] or "",
            )
            for repo in repos
        ]
        self.say(table(rows, ["REPOSITORY", "LATEST", "PRERELEASE", "VERSIONS", "SIZE", "DESCRIPTION"]))
        return 0

    # -- repo --

    def repo_create(self):
        repo = self.client.create_repo(self.args.repo, self.args.description)
        if self.emit(repo):
            return 0
        self.say("Created %s." % repo["name"])
        return 0

    def repo_delete(self):
        if not confirm('Delete "%s" and every release in it?' % self.args.repo, self.args.yes):
            self.say("Left alone.")
            return 1
        self.client.delete_repo(self.args.repo)
        self.say("Deleted %s." % self.args.repo)
        return 0

    def repo_list(self):
        versions = self.client.versions(self.args.repo)
        if self.emit(versions):
            return 0
        if not versions:
            self.say("%s has no releases yet." % self.args.repo)
            return 0

        rows = []
        for version in versions:
            platforms = ", ".join(a["platform"] for a in version["artifacts"])
            total = sum(a["size"] for a in version["artifacts"])
            rows.append((
                version["version"],
                "prerelease" if version["prerelease"] else "",
                platforms,
                human_bytes(total),
                human_time(version["createdAt"]),
            ))
        self.say(table(rows, ["VERSION", "", "PLATFORMS", "SIZE", "RELEASED"]))
        return 0

    def repo_info(self):
        version = self.client.version(self.args.repo, self.args.version, self.args.prerelease)
        if self.emit(version):
            return 0
        self.say("%s %s%s" % (
            self.args.repo, version["version"], "  (prerelease)" if version["prerelease"] else ""
        ))
        self.say("Released %s" % human_time(version["createdAt"]))
        if version["notes"]:
            self.say("")
            self.say(version["notes"])
        self.say("")
        rows = [
            (a["platform"], a["filename"], human_bytes(a["size"]), a["sha256"])
            for a in version["artifacts"]
        ]
        self.say(table(rows, ["PLATFORM", "FILE", "SIZE", "SHA256"]))
        return 0

    def repo_upload(self):
        result = self.client.upload(
            self.args.repo, self.args.version, self.args.file,
            platform=self.args.platform, notes=self.args.notes,
        )
        if self.emit(result):
            return 0
        self.say("%s %s %s (%s) — %s, %s" % (
            "Replaced" if result["replaced"] else "Uploaded",
            result["repo"], result["version"], result["platform"],
            human_bytes(result["size"]), result["sha256"][:16],
        ))
        return 0

    def repo_pull(self):
        destination = Path(self.args.dest)

        # A directory means "put it here under its own name", which is what
        # `nt repo x pull .` plainly means. Working out that name needs the
        # metadata, so it costs one extra request — only in that case.
        if destination.is_dir() or self.args.dest.endswith(("/", os.sep)):
            version = self.client.version(self.args.repo, self.args.version, self.args.prerelease)
            artifacts = version["artifacts"]
            if self.args.platform:
                artifacts = [a for a in artifacts if a["platform"] == self.args.platform]
            if not artifacts:
                raise NtError(
                    "%s %s has no %s build." % (
                        self.args.repo, version["version"], self.args.platform or "matching"
                    ),
                    code="no_artifact",
                    hint="Available: " + ", ".join(a["platform"] for a in version["artifacts"]),
                )
            if len(artifacts) > 1:
                raise NtError(
                    "%s %s has builds for several platforms." % (self.args.repo, version["version"]),
                    code="ambiguous_platform",
                    hint="Pick one with -p. Available: "
                         + ", ".join(a["platform"] for a in artifacts),
                )
            destination = destination / artifacts[0]["filename"]

        checksum = self.client.download(
            self.args.repo, self.args.version, destination,
            platform=self.args.platform, prerelease=self.args.prerelease,
        )

        if self.emit({"path": str(destination), "sha256": checksum}):
            return 0
        self.say("Downloaded %s (%s)" % (destination, human_bytes(destination.stat().st_size)))
        if checksum:
            self.say("sha256 %s" % checksum)
        return 0

    def repo_remove(self):
        what = "%s %s" % (self.args.repo, self.args.version)
        if self.args.platform:
            what += " (%s)" % self.args.platform

        if not confirm("Remove %s?" % what, self.args.yes):
            self.say("Left alone.")
            return 1

        if self.args.platform:
            self.client.delete_artifact(self.args.repo, self.args.version, self.args.platform)
        else:
            self.client.delete_version(self.args.repo, self.args.version)
        self.say("Removed %s." % what)
        return 0


def _default_label():
    """Something recognisable in `nt auth tokens` without having to be asked."""
    import platform

    try:
        return "%s@%s" % (getpass.getuser(), platform.node())
    except Exception:
        return "nt cli"


# --- wiring --------------------------------------------------------------

#: Maps the parsed command to the method that runs it. A table rather than a
#: chain of ifs, so adding a command is one line in each of two obvious places.
ROUTES = {
    ("auth", "login"): App.auth_login,
    ("auth", "logout"): App.auth_logout,
    ("auth", "status"): App.auth_status,
    ("auth", "tokens"): App.auth_tokens,
    ("auth", "revoke"): App.auth_revoke,
    ("list", None): App.list_repos,
    ("health", None): App.health,
    ("repo", "create"): App.repo_create,
    ("repo", "delete"): App.repo_delete,
    ("repo", "list"): App.repo_list,
    ("repo", "info"): App.repo_info,
    ("repo", "upload"): App.repo_upload,
    ("repo", "pull"): App.repo_pull,
    ("repo", "remove"): App.repo_remove,
}

#: Commands that work without a token. Everything else is checked before the
#: request goes out, so being logged out says so rather than returning a 401.
PUBLIC = {("auth", "login"), ("auth", "status"), ("health", None)}


def run(argv, transport=None, out=sys.stdout):
    """Runs one invocation and returns an exit code.

    `transport` is the seam the tests use: pass one and the CLI never touches
    the network, which is how the whole command surface is exercised against
    the real API without a server running.
    """
    parser = build_parser()
    args = parser.parse_args(normalise(argv))

    if not args.command:
        parser.print_help(out)
        return 1

    key = (args.command, getattr(args, args.command + "_command", None))
    if key[1] is None and key not in ROUTES:
        # `nt auth` or `nt repo` with nothing after it.
        parser.parse_args([args.command, "--help"])
        return 1
    if key not in ROUTES:
        parser.error("unknown command")

    config = Config.load()
    if args.url:
        config.url = args.url.rstrip("/")

    if key not in PUBLIC:
        config.require_token()

    if transport is None:
        transport = HttpTransport(config.url, config.token, insecure=args.insecure)

    app = App(args, config, Client(transport), out=out)
    return ROUTES[key](app) or 0


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    try:
        return run(argv)
    except NtError as error:
        print("nt: %s" % error.message, file=sys.stderr)
        if error.hint:
            print("    %s" % error.hint, file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130
    except BrokenPipeError:
        # `nt list | head` closes the pipe early; that is not a failure.
        return 0
