"""The command line: the command tree, and what each command prints.

Click defines the tree; :mod:`nt.ui` decides how output looks; :mod:`nt.client`
knows the API and has no opinion about either. That split is what lets the
whole tool be driven against a registry that is not running — a transport is
handed in and nothing else changes. See ``cli/tests``.
"""

import json
import sys

import click

from . import __version__
from .client import Client
from .config import ENV_TOKEN, Config
from .errors import NtError
from .transport import HttpTransport
from .ui import Ui, human_bytes, human_time


# --- subject-first commands ----------------------------------------------

def subject_first(args, commands):
    """Rewrites ``repo <name> <verb>`` into ``repo <verb> <name>``.

    The natural way to type these is subject-first — `nt repo beagle upload` —
    and the natural way for a parser to read them is verb-first, because the
    verb is what decides which options are legal. Swapping the two costs three
    lines and means neither the user nor the parser has to give in.

    A repository named after one of the verbs would be ambiguous. Such a name
    is still reachable the other way round (`nt repo list list`), and naming a
    project "upload" is a problem that mostly solves itself.
    """
    args = list(args)
    if len(args) >= 2 and args[0] not in commands and args[1] in commands:
        args[0], args[1] = args[1], args[0]
    return args


class RepoGroup(click.Group):
    """A group that accepts its subject before its verb.

    Doing this in the group rather than by rewriting ``sys.argv`` means it
    happens after the global options have already been parsed off, so it cannot
    be confused by anything appearing in front of the command.
    """

    def parse_args(self, ctx, args):
        return super().parse_args(ctx, subject_first(args, self.commands))


# --- the application object ----------------------------------------------

class App:
    """One invocation: where output goes, and what it can talk to."""

    def __init__(self, transport=None, out=None):
        self._transport = transport
        self._insecure = False
        self.out = out
        self.as_json = False
        self.ui = Ui(out=out)
        self.config = None
        self.client = None

    def start(self, url, as_json, insecure):
        self.as_json = as_json
        self._insecure = insecure
        # force_plain under --json so that even the error path stays free of
        # escape sequences when the output is being parsed.
        self.ui = Ui(out=self.out, force_plain=as_json)
        self.config = Config.load()
        if url:
            self.config.url = url.rstrip("/")

    def connect(self, anonymous=False):
        """Builds the client. Checked locally first when a token is required,
        so being logged out says so rather than round-tripping for a 401."""
        if not anonymous:
            self.config.require_token()
        transport = self._transport or HttpTransport(
            self.config.url, self.config.token, insecure=self._insecure
        )
        self.client = Client(transport)
        return self.client

    def emit(self, payload):
        """Prints JSON when asked to, and reports whether it did."""
        if self.as_json:
            self.ui.raw(json.dumps(payload, indent=2))
            return True
        return False

    def say(self, message=""):
        self.ui.say(message)

    def confirm(self, question, action, assume_yes):
        if assume_yes:
            return True
        if not self.ui.interactive:
            raise NtError(
                "Refusing to %s without a confirmation." % action,
                hint="Pass -y if you mean it.",
            )
        return click.confirm(question, default=False)


pass_app = click.make_pass_decorator(App)


# --- the tree ------------------------------------------------------------

CONTEXT_SETTINGS = {"help_option_names": ["-h", "--help"], "max_content_width": 100}


@click.group(context_settings=CONTEXT_SETTINGS)
@click.option("--url", help="Registry to talk to. Overrides the saved one and $NT_URL.")
@click.option("--json", "as_json", is_flag=True, help="Print raw JSON instead of a table.")
@click.option("--insecure", is_flag=True, help="Skip TLS verification. Test servers only.")
@click.version_option(__version__, "-V", "--version", prog_name="nt")
@pass_app
def cli(app, url, as_json, insecure):
    """Client for a private release registry.

    Repository commands read either way round: `nt repo beagle-cli list` and
    `nt repo list beagle-cli` are the same thing.
    """
    app.start(url, as_json, insecure)


# --- auth ----------------------------------------------------------------

@cli.group()
def auth():
    """Log in and out."""


@auth.command("login")
@click.option("--password", help="Read from a prompt if not given. Prefer the prompt.")
@click.option("--label", default="", help="How this token shows up in `nt auth tokens`.")
@pass_app
def auth_login(app, password, label):
    """Exchange the password for a token."""
    client = app.connect(anonymous=True)

    import os

    password = password or os.environ.get("NT_PASSWORD")
    if not password:
        password = click.prompt("Password for %s" % app.config.url, hide_input=True, err=True)
    if not password:
        raise NtError("No password given.")

    result = client.login(password, label or _default_label())

    app.config.token = result["token"]
    app.config.expires_at = result.get("expiresAt", 0)
    app.config.save()

    if app.emit({"url": app.config.url, "expiresAt": app.config.expires_at}):
        return 0
    app.ui.good("Logged in to %s." % app.config.url)
    app.say("Token expires %s. Stored in %s." % (human_time(app.config.expires_at), app.config.path))
    return 0


@auth.command("logout")
@pass_app
def auth_logout(app):
    """Revoke this machine's token."""
    client = app.connect()
    try:
        client.logout()
    except NtError as error:
        # An already-dead token is the state we were trying to reach, so
        # clearing it locally and reporting success is the honest answer.
        if error.code not in ("unauthorised", "unreachable"):
            raise
    if not app.config.token_from_env:
        app.config.clear_token()
    app.say("Logged out.")
    return 0


@auth.command("status")
@pass_app
def auth_status(app):
    """Show which registry, and whether you are logged in."""
    status = {"url": app.config.url, "loggedIn": False, "config": str(app.config.path)}

    if app.config.token:
        try:
            who = app.connect().whoami()
            status.update(
                loggedIn=True,
                tokenId=who["tokenId"],
                label=who.get("label", ""),
                expiresAt=who.get("expiresAt", 0),
            )
        except NtError as error:
            status["problem"] = error.message

    if app.emit(status):
        return 0 if status["loggedIn"] else 1

    app.ui.field("Registry:  ", status["url"])
    app.ui.field("Config:    ", status["config"])
    if status["loggedIn"]:
        app.ui.field("Logged in: ", "yes, as %s" % (status["label"] or "unlabelled"), style="green")
        app.ui.field("Expires:   ", human_time(status["expiresAt"]))
        return 0
    if app.config.token:
        app.ui.field(
            "Logged in: ",
            "no — %s" % status.get("problem", "the stored token was refused"),
            style="red",
        )
    else:
        app.ui.field("Logged in: ", "no. Run `nt auth login`.", style="yellow")
    return 1


@auth.command("tokens")
@pass_app
def auth_tokens(app):
    """List every live token."""
    data = app.connect().tokens()
    if app.emit(data):
        return 0

    rows = [
        (
            token["id"][:8],
            token["kind"],
            token["label"] or "—",
            human_time(token["lastSeenAt"]),
            # An expiry of 0 is the never-expires sentinel; rendering it as a
            # date would show 1970 and read as a bug.
            "never" if not token["expiresAt"] else human_time(token["expiresAt"]),
            "<- this one" if token["id"] == data.get("you") else "",
        )
        for token in data["tokens"]
    ]
    app.ui.table(
        [
            ("ID", "dim"),
            ("KIND", ""),
            ("LABEL", ""),
            ("LAST USED", ""),
            ("EXPIRES", ""),
            ("", "green"),
        ],
        rows,
        empty="No live tokens.",
    )
    return 0


@auth.command("issue")
@click.argument("label")
@click.option(
    "--days", type=int, default=None,
    help="How long it lives. Required unless --never.",
)
@click.option(
    "--never", is_flag=True,
    help="Never expires. For a token compiled into a shipped application.",
)
@pass_app
def auth_issue(app, label, days, never):
    """Mint a named token for CI or a shipped app.

    LABEL says what will be holding it, so it can be revoked later without
    guessing. The token is shown once and cannot be retrieved again.
    """
    if never and days is not None:
        raise NtError("Pass either --days or --never, not both.")
    if not never and days is None:
        raise NtError(
            "Say how long the token should live.",
            hint="--days 90, or --never for a token you are shipping.",
        )

    result = app.connect().issue_token(label, 0 if never else days)

    if app.emit(result):
        return 0

    app.ui.good("Minted a token for %s." % result["label"])
    app.say()
    app.ui.raw(result["token"])
    app.say()
    app.ui.field(
        "Expires:  ",
        "never" if result["neverExpires"] else human_time(result["expiresAt"]),
        style="yellow" if result["neverExpires"] else "",
    )
    app.ui.field("Revoke:   ", "nt auth revoke %s" % result["tokenId"])
    app.say()
    # Said once, plainly, at the only moment it can still be acted on.
    app.ui.warn("This is the only time the token is shown. Copy it now.")
    if result["neverExpires"]:
        app.say(
            "It never expires, so revoking it is the only way to retire it. "
            "Anyone holding it can read every repository."
        )
    return 0


@auth.command("revoke")
@click.argument("token_id")
@pass_app
def auth_revoke(app, token_id):
    """Revoke one token by id, from `nt auth tokens`."""
    app.connect().revoke(token_id)
    app.say("Revoked.")
    return 0


# --- top level -----------------------------------------------------------

@cli.command("health")
@pass_app
def health(app):
    """Check the registry is up. Needs no token."""
    data = app.connect(anonymous=True).health()
    if app.emit(data):
        return 0

    app.ui.good("%s is up." % app.config.url)
    if not data.get("acceptingWrites"):
        app.ui.warn("Read-only mode is on: downloads work, uploads do not.")
    if not data.get("authConfigured"):
        app.ui.warn("No password is configured, so nothing can log in.")
    app.say("Largest upload the web server will take: %s" % human_bytes(data.get("uploadCeiling", 0)))
    return 0


@cli.command("list")
@pass_app
def list_repos(app):
    """List repositories."""
    repos = app.connect().repos()
    if app.emit(repos):
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
    app.ui.table(
        [
            ("REPOSITORY", "bold"),
            ("LATEST", "green"),
            ("PRERELEASE", "yellow"),
            ("VERSIONS", ""),
            ("SIZE", ""),
            ("DESCRIPTION", "dim"),
        ],
        rows,
        empty="No repositories yet. Create one with `nt repo create <name>`.",
    )
    return 0


# --- repo ----------------------------------------------------------------

@cli.group(cls=RepoGroup)
def repo():
    """Work with one repository.

    Reads either way round: `nt repo beagle-cli upload dist/app -v 1.0.0` and
    `nt repo upload beagle-cli dist/app -v 1.0.0` are the same command.
    """


@repo.command("create")
@click.argument("name")
@click.option("-d", "--description", default="", help="What the project is.")
@pass_app
def repo_create(app, name, description):
    """Create a repository."""
    created = app.connect().create_repo(name, description)
    if app.emit(created):
        return 0
    app.ui.good("Created %s." % created["name"])
    return 0


@repo.command("delete")
@click.argument("name")
@click.option("-y", "--yes", is_flag=True, help="Skip the confirmation.")
@pass_app
def repo_delete(app, name, yes):
    """Delete a repository and every release in it."""
    client = app.connect()
    if not app.confirm(
        'Delete "%s" and every release in it?' % name, 'delete "%s"' % name, yes
    ):
        app.say("Left alone.")
        return 1
    client.delete_repo(name)
    app.say("Deleted %s." % name)
    return 0


@repo.command("list")
@click.argument("name")
@pass_app
def repo_list(app, name):
    """List a repository's versions, newest first."""
    versions = app.connect().versions(name)
    if app.emit(versions):
        return 0
    if not versions:
        app.say("%s has no releases yet." % name)
        return 0

    rows = []
    for version in versions:
        rows.append((
            version["version"],
            "prerelease" if version["prerelease"] else "",
            ", ".join(a["platform"] for a in version["artifacts"]),
            human_bytes(sum(a["size"] for a in version["artifacts"])),
            human_time(version["createdAt"]),
        ))
    app.ui.table(
        [("VERSION", "bold"), ("", "yellow"), ("PLATFORMS", ""), ("SIZE", ""), ("RELEASED", "dim")],
        rows,
    )
    return 0


@repo.command("info")
@click.argument("name")
@click.option("-v", "--version", "version_spec", default="latest", help="Default: latest.")
@click.option("--prerelease", is_flag=True, help="Let latest mean a prerelease.")
@pass_app
def repo_info(app, name, version_spec, prerelease):
    """Show one version in detail."""
    version = app.connect().version(name, version_spec, prerelease)
    if app.emit(version):
        return 0

    app.ui.field(
        "%s " % name,
        version["version"] + ("  (prerelease)" if version["prerelease"] else ""),
        style="bold",
    )
    app.say("Released %s" % human_time(version["createdAt"]))
    if version["notes"]:
        app.say()
        app.say(version["notes"])
    app.say()
    app.ui.table(
        [("PLATFORM", "bold"), ("FILE", ""), ("SIZE", ""), ("SHA256", "dim")],
        [
            (a["platform"], a["filename"], human_bytes(a["size"]), a["sha256"])
            for a in version["artifacts"]
        ],
    )
    return 0


@repo.command("upload")
@click.argument("name")
@click.argument("file", type=click.Path(exists=True, dir_okay=False, readable=True))
@click.option("-v", "--version", "version_spec", required=True, help="Semver, such as 1.4.2.")
@click.option("-p", "--platform", default="", help="Such as linux-x64. Default: any.")
@click.option("-n", "--notes", default="", help="Release notes.")
@pass_app
def repo_upload(app, name, file, version_spec, platform, notes):
    """Upload a build."""
    client = app.connect()
    with app.ui.progress("Uploading", enabled=not app.as_json) as progress:
        result = client.upload(
            name, version_spec, file, platform=platform, notes=notes, on_progress=progress
        )

    if app.emit(result):
        return 0
    app.ui.good("%s %s %s (%s) — %s" % (
        "Replaced" if result["replaced"] else "Uploaded",
        result["repo"], result["version"], result["platform"], human_bytes(result["size"]),
    ))
    app.ui.field("sha256 ", result["sha256"])
    return 0


@repo.command("pull")
@click.argument("name")
@click.argument("dest", default=".")
@click.option("-v", "--version", "version_spec", default="latest", help="Default: latest.")
@click.option("-p", "--platform", default="", help="Only needed if the version has several.")
@click.option("--prerelease", is_flag=True, help="Let latest mean a prerelease.")
@pass_app
def repo_pull(app, name, dest, version_spec, platform, prerelease):
    """Download a build. DEST may be a file or a directory."""
    import os
    from pathlib import Path

    client = app.connect()
    destination = Path(dest)

    # A directory means "put it here under its own name", which is what
    # `nt repo x pull .` plainly means. Working out that name needs the
    # metadata, so it costs one extra request — only in that case.
    if destination.is_dir() or dest.endswith(("/", os.sep)):
        version = client.version(name, version_spec, prerelease)
        artifacts = version["artifacts"]
        if platform:
            artifacts = [a for a in artifacts if a["platform"] == platform]
        if not artifacts:
            raise NtError(
                "%s %s has no %s build." % (name, version["version"], platform or "matching"),
                code="no_artifact",
                hint="Available: " + ", ".join(a["platform"] for a in version["artifacts"]),
            )
        if len(artifacts) > 1:
            raise NtError(
                "%s %s has builds for several platforms." % (name, version["version"]),
                code="ambiguous_platform",
                hint="Pick one with -p. Available: "
                     + ", ".join(a["platform"] for a in artifacts),
            )
        destination = destination / artifacts[0]["filename"]

    with app.ui.progress("Downloading", enabled=not app.as_json) as progress:
        checksum = client.download(
            name, version_spec, destination,
            platform=platform, prerelease=prerelease, on_progress=progress,
        )

    if app.emit({"path": str(destination), "sha256": checksum}):
        return 0
    app.ui.good("Downloaded %s (%s)" % (destination, human_bytes(destination.stat().st_size)))
    if checksum:
        app.ui.field("sha256 ", checksum)
    return 0


@repo.command("remove")
@click.argument("name")
@click.option("-v", "--version", "version_spec", required=True)
@click.option("-p", "--platform", default="", help="Remove just this build.")
@click.option("-y", "--yes", is_flag=True, help="Skip the confirmation.")
@pass_app
def repo_remove(app, name, version_spec, platform, yes):
    """Remove a version, or one of its builds."""
    client = app.connect()

    what = "%s %s" % (name, version_spec)
    if platform:
        what += " (%s)" % platform

    if not app.confirm("Remove %s?" % what, "remove %s" % what, yes):
        app.say("Left alone.")
        return 1

    if platform:
        client.delete_artifact(name, version_spec, platform)
    else:
        client.delete_version(name, version_spec)
    app.say("Removed %s." % what)
    return 0


def _default_label():
    """Something recognisable in `nt auth tokens` without having to be asked."""
    import getpass
    import platform

    try:
        return "%s@%s" % (getpass.getuser(), platform.node())
    except Exception:
        return "nt cli"


# --- wiring --------------------------------------------------------------

def run(argv, transport=None, out=None):
    """Runs one invocation and returns an exit code.

    `transport` is the seam the tests use: pass one and the CLI never touches
    the network, which is how the whole command surface is exercised against
    the real API without a server running.

    Click is asked not to handle its own exits (`standalone_mode=False`) so
    that this returns a code rather than raising SystemExit, and so that an
    NtError travels back to the caller intact instead of being swallowed.
    """
    app = App(transport=transport, out=out)
    try:
        result = cli.main(args=list(argv), obj=app, prog_name="nt", standalone_mode=False)
    except click.exceptions.Exit as exit_signal:
        # --help and --version take this path, having already printed.
        return exit_signal.exit_code
    except click.exceptions.Abort:
        return 130
    except click.ClickException as error:
        error.show()
        return error.exit_code
    return result if isinstance(result, int) else 0


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    try:
        return run(argv)
    except NtError as error:
        Ui().error(error.message, error.hint)
        return 2
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130
    except BrokenPipeError:
        # `nt list | head` closes the pipe early; that is not a failure.
        return 0
