"""The `nt` command line, end to end against the real API.

Every case here runs a real command against a real registry — real routing,
real auth, real semver resolution, real bytes on disk — with no server running
and no network involved. See support.py for how.

    python3 -m unittest discover -s cli/tests    (or: make test_nt)
"""

import io
import json
import os
import unittest

from support import PhpTransport, Registry, php_available

from nt.cli import repo as repo_group, run, subject_first
from nt.config import Config
from nt.errors import NtError


@unittest.skipUnless(php_available(), "needs php on PATH to run the API")
class CliTest(unittest.TestCase):
    """Base: a fresh registry and a logged-out client for every test."""

    def setUp(self):
        self.registry = Registry()
        self.addCleanup(self.registry.close)

        # The CLI's own config is redirected into the temp directory, so a test
        # run can never read or overwrite the developer's real token.
        self._environment = dict(os.environ)
        os.environ["NT_CONFIG"] = str(self.registry.nt_config)
        os.environ["NT_URL"] = "https://registry.test"
        os.environ.pop("NT_TOKEN", None)
        self.addCleanup(self._restore_environment)

    def _restore_environment(self):
        os.environ.clear()
        os.environ.update(self._environment)

    # -- running commands --------------------------------------------------

    def nt(self, *argv, expect=0):
        """Runs one command, returning its stdout."""
        out = io.StringIO()
        transport = PhpTransport(self.registry.config_path, token=Config.load().token)
        code = run(list(argv), transport=transport, out=out)
        self.assertEqual(
            code, expect,
            "`nt %s` exited %d, expected %d. Output:\n%s" % (" ".join(argv), code, expect, out.getvalue()),
        )
        return out.getvalue()

    def fails(self, *argv):
        """Runs a command expected to raise, returning the NtError."""
        out = io.StringIO()
        transport = PhpTransport(self.registry.config_path, token=Config.load().token)
        with self.assertRaises(NtError) as caught:
            run(list(argv), transport=transport, out=out)
        return caught.exception

    def usage_fails(self, *argv):
        """Runs a command click itself rejects, returning what it told the user.

        These are usage errors, not NtErrors: click validates before the
        command body runs, so nothing reaches the network. They print to
        stderr and exit 2.
        """
        import contextlib

        out = io.StringIO()
        errors = io.StringIO()
        transport = PhpTransport(self.registry.config_path, token=Config.load().token)
        with contextlib.redirect_stderr(errors):
            code = run(list(argv), transport=transport, out=out)
        self.assertEqual(code, 2, "expected a usage error, got %d" % code)
        return errors.getvalue()

    def login(self):
        self.nt("auth", "login", "--password", Registry.PASSWORD, "--label", "tests")

    def json_of(self, *argv):
        return json.loads(self.nt("--json", *argv))


class ArgumentTest(unittest.TestCase):
    """subject_first() has no I/O, so it needs no registry and no php.

    It is given the real command group's verbs rather than a handmade list, so
    a `repo` command this does not know about cannot slip past it.

    Note that global options no longer appear here at all: Click parses them
    off in the parent group before the repo group sees its arguments, so the
    rewrite cannot be defeated by anything in front of the command — which
    under the old hand-rolled argv scan it could be, and was.
    """

    VERBS = repo_group.commands

    def rewrite(self, args):
        return subject_first(args, self.VERBS)

    def test_subject_first_is_rewritten_to_verb_first(self):
        self.assertEqual(
            self.rewrite(["beagle", "upload", "app.bin"]),
            ["upload", "beagle", "app.bin"],
        )
        self.assertEqual(self.rewrite(["beagle", "list"]), ["list", "beagle"])

    def test_verb_first_is_left_alone(self):
        self.assertEqual(self.rewrite(["create", "beagle"]), ["create", "beagle"])
        self.assertEqual(self.rewrite(["delete", "beagle"]), ["delete", "beagle"])

    def test_too_short_to_swap_is_left_alone(self):
        self.assertEqual(self.rewrite(["list"]), ["list"])
        self.assertEqual(self.rewrite([]), [])

    def test_options_are_not_mistaken_for_a_name(self):
        self.assertEqual(self.rewrite(["--help"]), ["--help"])
        self.assertEqual(self.rewrite(["beagle", "--help"]), ["beagle", "--help"])


class AuthTest(CliTest):
    def test_login_stores_a_token(self):
        output = self.nt("auth", "login", "--password", Registry.PASSWORD)
        self.assertIn("Logged in", output)

        stored = json.loads(self.registry.nt_config.read_text())
        self.assertTrue(stored["token"])
        self.assertGreater(stored["expires_at"], 0)

    def test_the_token_file_is_private(self):
        # It holds a credential. On a shared machine the mode is the only thing
        # between it and everyone else with an account.
        self.login()
        mode = self.registry.nt_config.stat().st_mode & 0o777
        self.assertEqual(mode, 0o600, "config is mode %o, expected 600" % mode)

    def test_a_wrong_password_is_refused(self):
        error = self.fails("auth", "login", "--password", "hunter2")
        self.assertEqual(error.code, "bad_password")
        self.assertFalse(self.registry.nt_config.exists())

    def test_commands_refuse_to_run_logged_out(self):
        # Checked locally, so being logged out says so rather than round
        # tripping to the server for a 401.
        error = self.fails("list")
        self.assertEqual(error.code, "unauthorised")
        self.assertIn("nt auth login", error.hint)

    def test_status_reports_both_states(self):
        self.assertIn("Logged in: no", self.nt("auth", "status", expect=1))
        self.login()
        output = self.nt("auth", "status")
        self.assertIn("Logged in: yes", output)
        self.assertIn("tests", output)

    def test_logout_revokes_the_token_server_side(self):
        self.login()
        token = Config.load().token
        self.nt("auth", "logout")
        self.assertIsNone(Config.load().token)

        # Not merely forgotten locally: the token must be dead on the server,
        # or "log out" on a shared machine would mean nothing.
        os.environ["NT_TOKEN"] = token
        self.assertEqual(self.fails("list").code, "unauthorised")

    def test_tokens_can_be_listed_and_revoked(self):
        self.login()
        listing = self.json_of("auth", "tokens")
        self.assertEqual(len(listing["tokens"]), 1)

        self.nt("auth", "login", "--password", Registry.PASSWORD, "--label", "second")
        self.assertEqual(len(self.json_of("auth", "tokens")["tokens"]), 2)

        first = [t for t in self.json_of("auth", "tokens")["tokens"] if t["label"] == "tests"][0]
        self.nt("auth", "revoke", first["id"])
        labels = [t["label"] for t in self.json_of("auth", "tokens")["tokens"]]
        self.assertEqual(labels, ["second"])

    def test_a_named_token_can_be_minted(self):
        self.login()
        out = self.nt("auth", "issue", "github actions", "--days", "90")
        self.assertIn("Minted a token", out)
        self.assertIn("only time the token is shown", out)

        listed = self.json_of("auth", "tokens")["tokens"]
        minted = [t for t in listed if t["label"] == "github actions"][0]
        self.assertEqual(minted["kind"], "named")
        self.assertGreater(minted["expiresAt"], 0)

    def test_a_minted_token_actually_works(self):
        self.login()
        token = self.json_of("auth", "issue", "ci", "--days", "30")["token"]

        # Used the way CI would: no config file involved at all.
        self.registry.nt_config.unlink()
        os.environ["NT_TOKEN"] = token
        self.nt("list")

    def test_a_never_expiring_token_says_so(self):
        self.login()
        result = self.json_of("auth", "issue", "beagle-cli updater", "--never")
        self.assertTrue(result["neverExpires"])
        self.assertEqual(result["expiresAt"], 0)

        # Rendered as "never", not as a date from 1970.
        self.assertIn("never", self.nt("auth", "tokens"))

    def test_a_lifetime_is_not_chosen_for_you(self):
        self.login()
        error = self.fails("auth", "issue", "ci")
        self.assertIn("how long", error.message)
        self.assertIn("--never", error.hint)

        self.assertIn(
            "not both",
            self.fails("auth", "issue", "ci", "--days", "30", "--never").message,
        )

    def test_revoking_a_named_token_leaves_the_others(self):
        self.login()
        keep = self.json_of("auth", "issue", "keep me", "--never")["token"]
        drop = self.json_of("auth", "issue", "drop me", "--days", "30")

        self.nt("auth", "revoke", drop["tokenId"])

        os.environ["NT_TOKEN"] = drop["token"]
        self.assertEqual(self.fails("list").code, "unauthorised")

        os.environ["NT_TOKEN"] = keep
        self.nt("list")

    def test_a_token_from_the_environment_is_used(self):
        # How a CI job authenticates: no login step, nothing written to disk.
        self.login()
        token = Config.load().token
        self.registry.nt_config.unlink()
        os.environ["NT_TOKEN"] = token
        self.nt("list")


class RepoTest(CliTest):
    def setUp(self):
        super().setUp()
        self.login()

    def test_create_and_list(self):
        self.assertIn("No repositories yet", self.nt("list"))

        self.nt("repo", "create", "beagle-cli", "-d", "The beagle tool")
        output = self.nt("list")
        self.assertIn("beagle-cli", output)
        self.assertIn("The beagle tool", output)

    def test_a_duplicate_name_is_refused(self):
        self.nt("repo", "create", "beagle-cli")
        self.assertEqual(self.fails("repo", "create", "beagle-cli").code, "exists")

    def test_an_invalid_name_is_refused_with_an_explanation(self):
        error = self.fails("repo", "create", "Beagle CLI")
        self.assertEqual(error.code, "bad_name")
        self.assertIn("lower case", error.message)

    def test_delete_needs_confirmation_but_takes_yes(self):
        self.nt("repo", "create", "doomed")
        self.nt("repo", "delete", "doomed", "-y")
        self.assertIn("No repositories yet", self.nt("list"))

    def test_an_unknown_repo_is_reported_by_name(self):
        error = self.fails("repo", "list", "ghost")
        self.assertEqual(error.code, "no_repo")
        self.assertIn("ghost", error.message)


class ReleaseTest(CliTest):
    def setUp(self):
        super().setUp()
        self.login()
        self.nt("repo", "create", "beagle-cli", "-d", "The beagle tool")
        self.binary = self.registry.file("dist/beagle", "#!/bin/sh\necho beagle\n")

    def upload(self, version, platform=None, path=None, notes=None):
        argv = ["repo", "beagle-cli", "upload", str(path or self.binary), "-v", version]
        if platform:
            argv += ["-p", platform]
        if notes:
            argv += ["-n", notes]
        return self.nt(*argv)

    # -- uploading --

    def test_upload_reports_what_landed(self):
        output = self.upload("1.0.0", "linux-x64", notes="First release")
        self.assertIn("Uploaded", output)
        self.assertIn("1.0.0", output)
        self.assertIn("linux-x64", output)

    def test_the_server_agrees_on_the_checksum(self):
        import hashlib

        result = json.loads(self.nt(
            "--json", "repo", "beagle-cli", "upload", str(self.binary), "-v", "1.0.0"
        ))
        self.assertEqual(result["sha256"], hashlib.sha256(self.binary.read_bytes()).hexdigest())

    def test_uploading_the_same_platform_replaces_it(self):
        self.upload("1.0.0", "linux-x64")
        again = self.registry.file("dist/beagle2", "#!/bin/sh\necho fixed\n")
        output = self.upload("1.0.0", "linux-x64", path=again)
        self.assertIn("Replaced", output)

        version = self.json_of("repo", "beagle-cli", "info", "-v", "1.0.0")
        self.assertEqual(len(version["artifacts"]), 1)

    def test_several_platforms_live_in_one_version(self):
        self.upload("1.0.0", "linux-x64")
        self.upload("1.0.0", "windows")
        self.upload("1.0.0", "macos-arm64")

        version = self.json_of("repo", "beagle-cli", "info", "-v", "1.0.0")
        self.assertEqual(
            sorted(a["platform"] for a in version["artifacts"]),
            ["linux-x64", "macos-arm64", "windows"],
        )

    def test_a_missing_local_file_is_caught_before_any_request(self):
        # Validated by click from the argument's own type, so it fails before
        # the command body runs and nothing is sent.
        message = self.usage_fails(
            "repo", "beagle-cli", "upload", "/no/such/file", "-v", "1.0.0"
        )
        self.assertIn("/no/such/file", message)
        self.assertIn("does not exist", message)

    def test_the_client_still_guards_a_missing_file_itself(self):
        # The CLI is not the only caller of Client.upload, so the check there
        # has to stand on its own rather than relying on the argument type.
        from nt.client import Client

        client = Client(PhpTransport(self.registry.config_path, token=Config.load().token))
        with self.assertRaises(NtError) as caught:
            client.upload("beagle-cli", "1.0.0", "/no/such/file")
        self.assertEqual(caught.exception.code, "no_local_file")

    def test_a_non_semver_version_is_refused(self):
        error = self.fails("repo", "beagle-cli", "upload", str(self.binary), "-v", "nightly")
        self.assertEqual(error.code, "bad_version")

    # -- listing --

    def test_versions_list_newest_first(self):
        for version in ("1.0.0", "1.10.0", "1.2.0", "2.0.0-rc.1"):
            self.upload(version, "linux-x64")

        listed = [v["version"] for v in self.json_of("repo", "beagle-cli", "list")]
        self.assertEqual(listed, ["2.0.0-rc.1", "1.10.0", "1.2.0", "1.0.0"])

    def test_latest_skips_prereleases_unless_asked(self):
        self.upload("1.2.0", "linux-x64")
        self.upload("2.0.0-rc.1", "linux-x64")

        self.assertEqual(self.json_of("repo", "beagle-cli", "info")["version"], "1.2.0")
        self.assertEqual(
            self.json_of("repo", "beagle-cli", "info", "--prerelease")["version"],
            "2.0.0-rc.1",
        )

    # -- pulling --

    def test_pull_writes_the_bytes_back(self):
        self.upload("1.0.0", "linux-x64")
        destination = self.registry.root / "out" / "beagle"

        output = self.nt("repo", "beagle-cli", "pull", str(destination), "-v", "1.0.0")
        self.assertIn("Downloaded", output)
        self.assertEqual(destination.read_bytes(), self.binary.read_bytes())

    def test_pull_defaults_to_latest(self):
        self.upload("1.0.0", "linux-x64")
        newer = self.registry.file("dist/beagle-new", "newer build")
        self.upload("1.1.0", "linux-x64", path=newer)

        destination = self.registry.root / "out" / "beagle"
        self.nt("repo", "beagle-cli", "pull", str(destination))
        self.assertEqual(destination.read_bytes(), newer.read_bytes())

    def test_pull_into_a_directory_uses_the_stored_filename(self):
        self.upload("1.0.0", "linux-x64")
        directory = self.registry.root / "downloads"
        directory.mkdir()

        self.nt("repo", "beagle-cli", "pull", str(directory), "-v", "1.0.0")
        self.assertEqual((directory / "beagle").read_bytes(), self.binary.read_bytes())

    def test_pull_needs_a_platform_only_when_it_is_ambiguous(self):
        self.upload("1.0.0", "linux-x64")
        destination = self.registry.root / "out" / "beagle"

        # One build: no platform needed, which is the common case.
        self.nt("repo", "beagle-cli", "pull", str(destination), "-v", "1.0.0")

        self.upload("1.0.0", "windows")
        error = self.fails("repo", "beagle-cli", "pull", str(destination), "-v", "1.0.0")
        self.assertEqual(error.code, "ambiguous_platform")
        # The error has to say what to type instead, or it is just a refusal.
        self.assertIn("linux-x64", error.hint)

        self.nt("repo", "beagle-cli", "pull", str(destination), "-v", "1.0.0", "-p", "windows")

    def test_pulling_an_unbuilt_platform_lists_the_real_ones(self):
        self.upload("1.0.0", "linux-x64")
        error = self.fails(
            "repo", "beagle-cli", "pull",
            str(self.registry.root / "out.bin"), "-v", "1.0.0", "-p", "solaris",
        )
        self.assertEqual(error.code, "no_artifact")
        self.assertIn("linux-x64", error.hint)

    def test_an_interrupted_pull_leaves_no_partial_file(self):
        # A truncated download that looks complete is the worst outcome for a
        # file something is about to execute, so the transport writes to a .part
        # and renames. A failed request must leave neither behind.
        self.upload("1.0.0", "linux-x64")
        destination = self.registry.root / "out" / "beagle"
        self.fails("repo", "beagle-cli", "pull", str(destination), "-v", "9.9.9")
        self.assertFalse(destination.exists())
        self.assertFalse(destination.with_name("beagle.part").exists())

    # -- removing --

    def test_remove_takes_one_platform_or_the_whole_version(self):
        self.upload("1.0.0", "linux-x64")
        self.upload("1.0.0", "windows")

        self.nt("repo", "beagle-cli", "remove", "-v", "1.0.0", "-p", "windows", "-y")
        version = self.json_of("repo", "beagle-cli", "info", "-v", "1.0.0")
        self.assertEqual([a["platform"] for a in version["artifacts"]], ["linux-x64"])

        self.nt("repo", "beagle-cli", "remove", "-v", "1.0.0", "-y")
        self.assertEqual(self.fails("repo", "beagle-cli", "info", "-v", "1.0.0").code, "no_version")

    def test_removing_the_last_build_removes_the_version(self):
        self.upload("1.0.0", "linux-x64")
        self.nt("repo", "beagle-cli", "remove", "-v", "1.0.0", "-p", "linux-x64", "-y")
        self.assertEqual(self.json_of("repo", "beagle-cli", "list"), [])

    def test_removing_a_version_that_is_not_there(self):
        self.assertEqual(
            self.fails("repo", "beagle-cli", "remove", "-v", "3.0.0", "-y").code,
            "no_version",
        )


class ReadOnlyTest(CliTest):
    """The kill switch, from the client's side."""

    def setUp(self):
        super().setUp()
        self.login()
        self.nt("repo", "create", "beagle-cli")
        binary = self.registry.file("dist/beagle", "build")
        self.nt("repo", "beagle-cli", "upload", str(binary), "-v", "1.0.0")
        self.registry.write_config(accepting_writes=False)

    def test_reads_keep_working(self):
        self.assertIn("beagle-cli", self.nt("list"))
        destination = self.registry.root / "out.bin"
        self.nt("repo", "beagle-cli", "pull", str(destination))
        self.assertEqual(destination.read_bytes(), b"build")

    def test_writes_are_refused_with_a_usable_message(self):
        binary = self.registry.file("dist/other", "build")
        error = self.fails("repo", "beagle-cli", "upload", str(binary), "-v", "2.0.0")
        self.assertEqual(error.code, "read_only")
        self.assertIn("frozen", error.hint)


if __name__ == "__main__":
    unittest.main(verbosity=2)
