"""How a request gets to the registry — and the seam that lets it not.

``Transport`` is the whole of the CLI's contact with the outside world. The
client and every command above it are written against this interface and
nothing else, which means the entire tool can be driven against something that
is not a network: the test suite points it at the real PHP API running in a
subprocess, so the commands are exercised end to end with no server, no port
and no deployment.

``HttpTransport`` is the real one, on urllib: nothing about moving bytes over
HTTP needs a dependency, and keeping this layer stdlib means a release tool
that fails to install is one fewer thing that can go wrong on the day it
matters.
"""

import io
import json
import mimetypes
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path

from .errors import NtError

#: Uploads and downloads can be large and slow; everything else should be
#: quick. A single generous timeout would hang a typo for two minutes.
CONNECT_TIMEOUT = 30
TRANSFER_TIMEOUT = 900

#: Read in chunks rather than whole: a 500 MB artifact should not need 500 MB
#: of memory at either end.
CHUNK = 64 * 1024


@dataclass
class Upload:
    """A file to send as multipart form data."""

    path: Path
    field: str = "file"

    @property
    def filename(self):
        return self.path.name

    @property
    def size(self):
        return self.path.stat().st_size

    @property
    def content_type(self):
        guessed, _ = mimetypes.guess_type(self.path.name)
        return guessed or "application/octet-stream"


@dataclass
class Request:
    method: str = "GET"
    path: str = "/"
    query: dict = field(default_factory=dict)
    body: dict = None
    """A JSON body, as a dict. Mutually exclusive with `upload`."""
    form: dict = field(default_factory=dict)
    """Plain multipart fields, sent alongside `upload`."""
    upload: Upload = None


@dataclass
class Response:
    status: int
    headers: dict = field(default_factory=dict)
    body: bytes = b""

    @property
    def ok(self):
        return 200 <= self.status < 300

    def json(self):
        if not self.body:
            return {}
        try:
            return json.loads(self.body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}

    def error(self):
        """The API's error envelope as ``(code, message)``.

        Falls back to something readable when the body is not an envelope at
        all, which is what a crashed PHP process or an intercepting proxy
        produces — and which would otherwise surface as a blank message.
        """
        envelope = self.json().get("error")
        if isinstance(envelope, dict):
            return envelope.get("code", "error"), envelope.get("message", "Request failed.")
        text = self.body.decode("utf-8", "replace").strip()
        return "http_%d" % self.status, text[:200] or "HTTP %d" % self.status


class Transport(ABC):
    """Somewhere to send a request.

    `on_progress` is called as `(done, total)` in bytes while a body moves in
    either direction, for callers that want to draw a progress bar. `total` is
    zero when the far end did not say how much there was to come. It is
    optional everywhere: a transport that cannot report progress simply never
    calls it, and the caller sees a bar that finishes in one step.
    """

    @abstractmethod
    def send(self, request, on_progress=None):
        """Perform `request` and return a :class:`Response`."""

    @abstractmethod
    def download(self, request, destination, on_progress=None):
        """Perform `request`, writing a successful body to `destination`.

        Separate from :meth:`send` so a real implementation can stream to disk
        rather than holding an artifact in memory. On a non-2xx the body comes
        back in the Response and nothing is written.
        """


class HttpTransport(Transport):
    """The real one."""

    def __init__(self, base_url, token=None, insecure=False):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self._context = ssl._create_unverified_context() if insecure else None

    # -- building ---------------------------------------------------------

    def _url(self, request):
        url = self.base_url + "/api" + request.path
        if request.query:
            # Skip empty values so an unset optional flag does not turn into
            # `?platform=`, which the API would read as an explicit empty one.
            pairs = {k: v for k, v in request.query.items() if v not in (None, "")}
            if pairs:
                url += "?" + urllib.parse.urlencode(pairs)
        return url

    def _build(self, request, on_progress=None):
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token

        data = None
        if request.upload is not None:
            body = _MultipartBody(request.form, request.upload, on_progress)
            headers["Content-Type"] = body.content_type
            headers["Content-Length"] = str(len(body))
            data = body
        else:
            payload = request.body

            # A POST always carries a body, even when the endpoint ignores it.
            # Shared hosts commonly run a WAF that rejects bodyless POSTs
            # outright — api.nteague.com answers one with a 403 HTML page that
            # never reaches PHP — so `nt auth logout` would fail in production
            # and nowhere else. An empty object costs two bytes.
            if payload is None and request.method.upper() == "POST":
                payload = {}

            if payload is not None:
                data = json.dumps(payload).encode("utf-8")
                headers["Content-Type"] = "application/json"
                headers["Content-Length"] = str(len(data))

        return urllib.request.Request(
            self._url(request), data=data, headers=headers, method=request.method.upper()
        )

    def _open(self, request, timeout, on_progress=None):
        prepared = self._build(request, on_progress)
        try:
            return urllib.request.urlopen(prepared, timeout=timeout, context=self._context)
        except urllib.error.HTTPError as error:
            # Not an exception as far as this tool is concerned: a 404 or a 403
            # is an answer, and the caller wants to read the envelope in it.
            return error
        except urllib.error.URLError as error:
            raise NtError(
                "Could not reach %s (%s)." % (self.base_url, error.reason),
                code="unreachable",
                hint="Check the URL with `nt auth status`, and that you are online.",
            ) from error
        except (TimeoutError, OSError) as error:
            raise NtError(
                "The registry did not answer in time (%s)." % error, code="timeout"
            ) from error

    # -- sending ----------------------------------------------------------

    def send(self, request, on_progress=None):
        timeout = TRANSFER_TIMEOUT if request.upload is not None else CONNECT_TIMEOUT
        with self._open(request, timeout, on_progress) as response:
            return Response(
                status=response.status,
                headers={k.lower(): v for k, v in response.headers.items()},
                body=response.read(),
            )

    def download(self, request, destination, on_progress=None):
        with self._open(request, TRANSFER_TIMEOUT) as response:
            headers = {k.lower(): v for k, v in response.headers.items()}
            if not 200 <= response.status < 300:
                return Response(response.status, headers, response.read())

            # Written to a neighbouring temp file and renamed into place, so an
            # interrupted download never leaves a truncated file that looks
            # like a complete one — which for an update this thing will later
            # execute is a genuinely bad outcome.
            destination = Path(destination)
            destination.parent.mkdir(parents=True, exist_ok=True)
            partial = destination.with_name(destination.name + ".part")
            total = int(headers.get("content-length") or 0)
            done = 0
            try:
                with open(partial, "wb") as handle:
                    while True:
                        chunk = response.read(CHUNK)
                        if not chunk:
                            break
                        handle.write(chunk)
                        done += len(chunk)
                        if on_progress is not None:
                            on_progress(done, total)
                os.replace(partial, destination)
            except BaseException:
                partial.unlink(missing_ok=True)
                raise

            return Response(response.status, headers, b"")


class _MultipartBody(io.RawIOBase):
    """A multipart/form-data body that is read rather than assembled.

    Built as a file-like object so a large artifact streams from disk instead
    of being concatenated into one bytes object first — the difference between
    uploading a 500 MB build and needing 500 MB of RAM to do it.
    """

    def __init__(self, fields, upload, on_progress=None):
        self.boundary = "----nt" + os.urandom(16).hex()
        self._upload = upload
        self._on_progress = on_progress
        self._sent = 0

        preamble = io.BytesIO()
        for name, value in (fields or {}).items():
            if value in (None, ""):
                continue
            preamble.write(self._part(
                'Content-Disposition: form-data; name="%s"\r\n\r\n%s' % (name, value)
            ))
        preamble.write(self._part(
            'Content-Disposition: form-data; name="%s"; filename="%s"\r\n'
            "Content-Type: %s\r\n\r\n" % (upload.field, _quote(upload.filename), upload.content_type),
            trailing=False,
        ))

        self._preamble = preamble.getvalue()
        self._epilogue = ("\r\n--%s--\r\n" % self.boundary).encode("utf-8")
        self._length = len(self._preamble) + upload.size + len(self._epilogue)

        self._stage = 0  # 0 preamble, 1 file, 2 epilogue, 3 done
        self._cursor = 0
        self._handle = None

    def _part(self, text, trailing=True):
        chunk = "--%s\r\n%s" % (self.boundary, text)
        if trailing:
            chunk += "\r\n"
        return chunk.encode("utf-8")

    @property
    def content_type(self):
        return "multipart/form-data; boundary=" + self.boundary

    def __len__(self):
        return self._length

    def readable(self):
        return True

    def read(self, size=-1):
        if size is None or size < 0:
            size = self._length

        out = bytearray()
        while size > 0 and self._stage < 3:
            if self._stage == 0:
                chunk = self._preamble[self._cursor:self._cursor + size]
                self._cursor += len(chunk)
                if self._cursor >= len(self._preamble):
                    self._stage, self._cursor = 1, 0
                    self._handle = open(self._upload.path, "rb")
            elif self._stage == 1:
                chunk = self._handle.read(size)
                if not chunk:
                    self._handle.close()
                    self._handle = None
                    self._stage, self._cursor = 2, 0
                    continue
            else:
                chunk = self._epilogue[self._cursor:self._cursor + size]
                self._cursor += len(chunk)
                if self._cursor >= len(self._epilogue):
                    self._stage = 3
            out += chunk
            size -= len(chunk)

        # Reported from here because this is the only place that knows when
        # bytes actually leave: http.client pulls from this object at its own
        # pace, so counting at the call site would show the whole file "sent"
        # the instant the request was built.
        if out and self._on_progress is not None:
            self._sent += len(out)
            self._on_progress(self._sent, self._length)

        return bytes(out)

    def close(self):
        if self._handle is not None:
            self._handle.close()
            self._handle = None
        super().close()


def _quote(name):
    """Filenames go into a header, so quotes and newlines have to not."""
    return name.replace("\\", "_").replace('"', "_").replace("\r", "").replace("\n", "")
