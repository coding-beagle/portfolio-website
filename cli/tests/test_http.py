"""The real transport, against a real web server.

test_cli.py covers what the commands *do* by talking to the API through a pipe.
That deliberately bypasses :class:`nt.transport.HttpTransport` — so without
this file, the code that actually builds multipart bodies, streams uploads and
writes downloads to disk would never run in a test at all.

So this suite is short and covers only that: a real socket, a real web server,
real bytes in both directions. It starts `php -S` on a free port and stops it
again.
"""

import http.client
import io
import json
import os
import socket
import subprocess
import sys
import time
import unittest

from support import REPO_ROOT, Registry, php_available

from nt.cli import run
from nt.config import Config
from nt.transport import HttpTransport


def free_port():
    with socket.socket() as sock:
        sock.bind(("localhost", 0))
        return sock.getsockname()[1]


@unittest.skipUnless(php_available(), "needs php on PATH to run the API")
class HttpTest(unittest.TestCase):
    """One `php -S` for the whole class: starting it is the slow part."""

    @classmethod
    def setUpClass(cls):
        cls.registry = Registry()
        # The shared fixture caps artifacts at 1 MB; this suite deliberately
        # pushes a larger file through the multipart body, so it needs room.
        cls.registry.write_config(max_artifact_bytes=8 * 1024 * 1024)
        cls.port = free_port()
        cls.base = "http://localhost:%d" % cls.port

        cls.server = subprocess.Popen(
            [
                "php", "-S", "localhost:%d" % cls.port,
                "-t", str(REPO_ROOT / "php" / "registry" / "public"),
                str(REPO_ROOT / "php" / "registry" / "tests" / "dev-router.php"),
            ],
            env=dict(os.environ, REGISTRY_CONFIG=str(cls.registry.config_path)),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )

        for _ in range(100):
            try:
                connection = http.client.HTTPConnection("localhost", cls.port, timeout=1)
                connection.request("GET", "/api/health")
                if connection.getresponse().status == 200:
                    break
            except OSError:
                time.sleep(0.05)
        else:
            cls.tearDownClass()
            raise AssertionError("the test server never came up")

    @classmethod
    def tearDownClass(cls):
        if getattr(cls, "server", None):
            cls.server.terminate()
            cls.server.wait(timeout=10)
        cls.registry.close()

    def setUp(self):
        self._environment = dict(os.environ)
        os.environ["NT_CONFIG"] = str(self.registry.root / "nt-http.json")
        os.environ["NT_URL"] = self.base
        os.environ.pop("NT_TOKEN", None)
        self.addCleanup(self._restore)

    def _restore(self):
        os.environ.clear()
        os.environ.update(self._environment)

    def nt(self, *argv, expect=0):
        out = io.StringIO()
        config = Config.load()
        transport = HttpTransport(self.base, config.token)
        code = run(list(argv), transport=transport, out=out)
        self.assertEqual(code, expect, "`nt %s` exited %d:\n%s" % (" ".join(argv), code, out.getvalue()))
        return out.getvalue()

    def test_a_large_artifact_survives_the_round_trip(self):
        """The one thing only this suite can catch.

        A multipart body assembled wrongly — a boundary off by a byte, a
        Content-Length that disagrees with the stream — produces a file that
        arrives corrupted rather than an error, so only comparing the bytes
        actually proves it. Large enough to take several chunks through the
        streaming reader rather than one convenient pass.
        """
        source = self.registry.root / "big.bin"
        source.write_bytes(os.urandom(1_500_000))

        self.nt("auth", "login", "--password", Registry.PASSWORD, "--label", "http")
        self.nt("repo", "create", "big-app")
        self.nt("repo", "big-app", "upload", str(source), "-v", "1.0.0", "-p", "linux-x64")

        destination = self.registry.root / "pulled.bin"
        self.nt("repo", "big-app", "pull", str(destination), "-v", "1.0.0")

        self.assertEqual(destination.read_bytes(), source.read_bytes())

    def test_form_fields_arrive_alongside_the_file(self):
        # Fields are written into the same multipart body as the artifact, so
        # they are the other half of getting that encoding right.
        source = self.registry.root / "small.bin"
        source.write_bytes(b"a build")

        self.nt("auth", "login", "--password", Registry.PASSWORD)
        self.nt("repo", "create", "fielded")
        self.nt(
            "repo", "fielded", "upload", str(source),
            "-v", "2.1.0", "-p", "macos-arm64", "-n", "Notes that must survive",
        )

        version = json.loads(self.nt("--json", "repo", "fielded", "info", "-v", "2.1.0"))
        self.assertEqual(version["notes"], "Notes that must survive")
        self.assertEqual(version["artifacts"][0]["platform"], "macos-arm64")
        self.assertEqual(version["artifacts"][0]["filename"], "small.bin")

    def test_an_http_error_becomes_a_readable_message(self):
        # urllib raises on a 4xx, and the transport has to read the body out of
        # the exception rather than letting it escape as a stack trace.
        from nt.errors import NtError

        self.nt("auth", "login", "--password", Registry.PASSWORD)
        with self.assertRaises(NtError) as caught:
            self.nt("repo", "list", "definitely-not-there")
        self.assertEqual(caught.exception.code, "no_repo")

    def test_an_unreachable_registry_says_so(self):
        from nt.errors import NtError

        out = io.StringIO()
        transport = HttpTransport("http://localhost:%d" % free_port(), "token")
        with self.assertRaises(NtError) as caught:
            run(["list"], transport=transport, out=out)
        self.assertEqual(caught.exception.code, "unreachable")


if __name__ == "__main__":
    unittest.main(verbosity=2)
