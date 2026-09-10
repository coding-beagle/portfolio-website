"""Where the CLI remembers which registry it talks to, and as whom.

One JSON file, mode 0600, under the usual config directory. It holds a bearer
token, which is a credential — hence the mode, and hence the care taken to
create the file privately rather than fixing up the permissions afterwards.

Environment variables win over the file, so a CI job can pass ``NT_TOKEN``
without a login step and without writing anything to the runner's disk.
"""

import json
import os
import stat
from pathlib import Path

from .errors import NtError

DEFAULT_URL = "https://api.nteague.com"

ENV_URL = "NT_URL"
ENV_TOKEN = "NT_TOKEN"
ENV_CONFIG = "NT_CONFIG"


def config_path():
    """The config file's location, honouring XDG and an explicit override."""
    explicit = os.environ.get(ENV_CONFIG)
    if explicit:
        return Path(explicit)
    base = os.environ.get("XDG_CONFIG_HOME") or (Path.home() / ".config")
    return Path(base) / "nt" / "config.json"


class Config:
    """The stored settings, plus whatever the environment overrides."""

    def __init__(self, url=None, token=None, expires_at=0, path=None):
        self.url = url
        self.token = token
        self.expires_at = expires_at
        self.path = path or config_path()

    @classmethod
    def load(cls):
        path = config_path()
        stored = {}
        if path.is_file():
            try:
                stored = json.loads(path.read_text("utf-8"))
            except (ValueError, OSError) as error:
                raise NtError(
                    "Could not read %s (%s)." % (path, error),
                    hint="Delete it and run `nt auth login` again.",
                ) from error
            if not isinstance(stored, dict):
                stored = {}

        return cls(
            url=os.environ.get(ENV_URL) or stored.get("url") or DEFAULT_URL,
            token=os.environ.get(ENV_TOKEN) or stored.get("token"),
            expires_at=stored.get("expires_at", 0),
            path=path,
        )

    @property
    def token_from_env(self):
        return bool(os.environ.get(ENV_TOKEN))

    def require_token(self):
        if not self.token:
            raise NtError(
                "Not logged in.",
                code="unauthorised",
                hint="Run `nt auth login`, or set %s." % ENV_TOKEN,
            )
        return self.token

    def save(self):
        """Writes the config file, readable only by its owner.

        Created with 0600 from the start rather than chmod-ed afterwards: on a
        shared machine the gap between the two is a window in which the token
        is world-readable, and it is free to avoid.
        """
        self.path.parent.mkdir(parents=True, exist_ok=True)

        payload = json.dumps(
            {"url": self.url, "token": self.token, "expires_at": self.expires_at},
            indent=2,
        ) + "\n"

        temporary = self.path.with_name(self.path.name + ".tmp")
        descriptor = os.open(
            temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, stat.S_IRUSR | stat.S_IWUSR
        )
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                handle.write(payload)
            os.replace(temporary, self.path)
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise

    def clear_token(self):
        self.token = None
        self.expires_at = 0
        self.save()
