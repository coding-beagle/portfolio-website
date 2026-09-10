"""A transport that reaches the real API without a server.

Every request is handed to ``php/registry/tests/handle.php``, which runs the
genuine router in a subprocess and hands back the genuine response. So the
tests below exercise the actual routing, auth, semver and storage code rather
than a mock of it — a mock would drift from the server over time and quietly
stop testing anything at all — while needing no port, no network and nothing
deployed.

It is slower than a stub, and worth it. There are a few dozen requests in the
suite and it still finishes in seconds.
"""

import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HANDLER = REPO_ROOT / "php" / "registry" / "tests" / "handle.php"

sys.path.insert(0, str(REPO_ROOT / "cli"))

from nt.transport import Response, Transport  # noqa: E402


def php_available():
    return shutil.which("php") is not None


class PhpTransport(Transport):
    """Sends requests to the PHP API through a pipe."""

    def __init__(self, config_path, token=None):
        self.config_path = str(config_path)
        self.token = token

    def _spec(self, request):
        spec = {
            "method": request.method.upper(),
            "path": "/api" + request.path,
            "query": {k: str(v) for k, v in (request.query or {}).items() if v not in (None, "")},
            "headers": {},
            "ip": "203.0.113.5",
        }
        if self.token:
            spec["headers"]["authorization"] = "Bearer " + self.token
        if request.body is not None:
            spec["body"] = json.dumps(request.body)
        if request.upload is not None:
            spec["file"] = {
                "path": str(request.upload.path),
                "name": request.upload.filename,
                "type": request.upload.content_type,
            }
            spec["post"] = {k: v for k, v in (request.form or {}).items() if v not in (None, "")}
        return spec

    def send(self, request):
        environment = dict(os.environ, REGISTRY_CONFIG=self.config_path)
        result = subprocess.run(
            ["php", str(HANDLER)],
            input=json.dumps(self._spec(request)).encode("utf-8"),
            capture_output=True,
            env=environment,
        )
        if result.returncode != 0:
            raise AssertionError(
                "the API subprocess failed: " + result.stderr.decode("utf-8", "replace")
            )

        payload = json.loads(result.stdout.decode("utf-8"))
        return Response(
            status=payload["status"],
            headers={k.lower(): v for k, v in payload["headers"].items()},
            body=base64.b64decode(payload["body"]),
        )

    def download(self, request, destination):
        response = self.send(request)
        if not response.ok:
            return response
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(response.body)
        return Response(response.status, response.headers, b"")


class Registry:
    """A throwaway registry: its own database, artifacts and password."""

    PASSWORD = "correct horse battery staple"

    def __init__(self):
        self.root = Path(tempfile.mkdtemp(prefix="nt-test-"))
        self.config_path = self.root / "registry-config.php"
        self.nt_config = self.root / "nt-config.json"

        hashed = subprocess.run(
            ["php", "-r", 'echo password_hash($argv[1], PASSWORD_DEFAULT);', self.PASSWORD],
            capture_output=True, check=True,
        ).stdout.decode()

        # Written by PHP itself rather than hand-rolled here: var_export of a
        # decoded JSON object is the one way to get nested arrays right without
        # reimplementing PHP literal syntax in Python.
        settings = {
            "data_dir": str(self.root / "data"),
            "admin_password_hash": hashed,
            "accepting_writes": True,
            "token_ttl_seconds": 3600,
            "max_artifact_bytes": 1024 * 1024,
            "global_bytes_ceiling": 8 * 1024 * 1024,
            "disk_soft_fraction": 0.9,
            "sweep_per_request": 5,
            "rate_limits": {
                "login": {"limit": 20, "window": 900},
                "upload": {"limit": 200, "window": 3600},
            },
        }
        self.settings = settings
        self.write_config()

    def write_config(self, **overrides):
        """Rewrites the server's config, for testing things like read-only mode."""
        settings = dict(self.settings, **overrides)
        self.settings = settings
        subprocess.run(
            [
                "php", "-r",
                'file_put_contents($argv[1], "<?php return "'
                ' . var_export(json_decode($argv[2], true), true) . ";");',
                str(self.config_path), json.dumps(settings),
            ],
            check=True, capture_output=True,
        )

    def file(self, name, contents):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(contents.encode() if isinstance(contents, str) else contents)
        return path

    def close(self):
        shutil.rmtree(self.root, ignore_errors=True)
