"""The registry's API, as methods.

One method per endpoint, each returning parsed data or raising :class:`NtError`
with the API's own error code attached. Nothing above this layer builds a URL
or reads a status code, and nothing in it decides how anything is printed.
"""

from pathlib import Path

from .errors import NtError
from .transport import Request, Upload


class Client:
    def __init__(self, transport):
        self.transport = transport

    # -- plumbing ---------------------------------------------------------

    def _call(self, method, path, **kwargs):
        response = self.transport.send(Request(method=method, path=path, **kwargs))
        if not response.ok:
            raise self._error(response)
        return response.json()

    def _error(self, response):
        code, message = response.error()
        hints = {
            "unauthorised": "Run `nt auth login`.",
            "read_only": "The registry is frozen; ask the operator to turn writes back on.",
            "rate_limited": "Wait a few minutes and try again.",
            "not_configured": "The server has no password set yet.",
        }
        hint = hints.get(code, "")

        # The API answers an under-specified download with the list of builds
        # that do exist. Putting them in the message turns "that failed" into
        # "here is what to type instead".
        platforms = response.json().get("error", {}).get("platforms")
        if platforms:
            hint = "Available: " + ", ".join(platforms)

        return NtError(message, code=code, hint=hint)

    # -- auth -------------------------------------------------------------

    def login(self, password, label=""):
        return self._call("POST", "/auth/login", body={"password": password, "label": label})

    def logout(self):
        return self._call("POST", "/auth/logout")

    def whoami(self):
        return self._call("GET", "/auth/whoami")

    def health(self):
        return self._call("GET", "/health")

    def tokens(self):
        return self._call("GET", "/auth/tokens")

    def revoke(self, token_id):
        return self._call("DELETE", "/auth/tokens/" + token_id)

    # -- repos ------------------------------------------------------------

    def repos(self):
        return self._call("GET", "/repos")["repos"]

    def create_repo(self, name, description=""):
        return self._call("POST", "/repos", body={"name": name, "description": description})["repo"]

    def repo(self, name):
        return self._call("GET", "/repos/" + _segment(name))

    def delete_repo(self, name):
        return self._call("DELETE", "/repos/" + _segment(name))

    # -- versions and artifacts -------------------------------------------

    def versions(self, repo):
        return self._call("GET", "/repos/%s/versions" % _segment(repo))["versions"]

    def version(self, repo, version, prerelease=False):
        return self._call(
            "GET",
            "/repos/%s/versions/%s" % (_segment(repo), _segment(version)),
            query={"prerelease": "1" if prerelease else ""},
        )["version"]

    def delete_version(self, repo, version):
        return self._call("DELETE", "/repos/%s/versions/%s" % (_segment(repo), _segment(version)))

    def delete_artifact(self, repo, version, platform):
        return self._call(
            "DELETE",
            "/repos/%s/versions/%s/artifacts/%s"
            % (_segment(repo), _segment(version), _segment(platform)),
        )

    def upload(self, repo, version, path, platform="", notes="", on_progress=None):
        path = Path(path)
        if not path.is_file():
            raise NtError("There is no file at %s." % path, code="no_local_file")
        if path.stat().st_size == 0:
            raise NtError("%s is empty." % path, code="empty_file")

        response = self.transport.send(
            Request(
                method="POST",
                path="/repos/%s/versions/%s/artifacts" % (_segment(repo), _segment(version)),
                upload=Upload(path),
                form={"platform": platform, "notes": notes},
            ),
            on_progress=on_progress,
        )
        if not response.ok:
            raise self._error(response)
        return response.json()

    def download(self, repo, version, destination, platform="", prerelease=False, on_progress=None):
        """Fetches one artifact to `destination`, which must be a file path."""
        response = self.transport.download(
            Request(
                method="GET",
                path="/repos/%s/versions/%s/download" % (_segment(repo), _segment(version)),
                query={"platform": platform, "prerelease": "1" if prerelease else ""},
            ),
            destination,
            on_progress=on_progress,
        )
        if not response.ok:
            raise self._error(response)
        return response.headers.get("x-checksum-sha256", "")


def _segment(value):
    """One path segment, encoded.

    Names are validated server-side against a conservative character set, so
    this is not the security boundary — but sending a raw `../` and getting a
    routing error back instead of "no such repository" would be a poor answer
    to a typo.
    """
    from urllib.parse import quote

    return quote(str(value), safe="")
