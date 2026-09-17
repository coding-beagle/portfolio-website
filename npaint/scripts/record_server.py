#!/usr/bin/env python3
"""Static server for NPaint's record mode: serves the built page and accepts
the hover clips it records.

NPaint is a static page, so recording a clip in the browser normally ends at
the downloads folder. This server closes the loop: a PUT of `demos/<tool>.webm`
is written straight into the *source* tree at `npaint/www/demos/`, and the next
hover shows it. Nothing else here is writable.

Demos are read from and written to `www/demos/` rather than `build/demos/`
even though the rest of the page comes out of `build/`, so that a recording
survives the next `make build_npaint` and is committed with the source.

Clips are re-encoded with ffmpeg when it is on the PATH. MediaRecorder's own
output is generous — an order of magnitude more than a tuned VP9 pass — and
these ship with the page, so the re-encode is the difference between a demo
set that costs a megabyte and one that costs twenty. Without ffmpeg the raw
recording is kept and a warning is printed.
"""

import argparse
import http.server
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent.parent
BUILD = HERE / "build"
DEMOS = HERE / "www" / "demos"

# Tool names come from `ToolKind::name` in src/tools/mod.rs: lowercase and
# hyphens. Anything else is refused rather than sanitised — a name that needs
# sanitising is a bug, not a filename.
SAFE_NAME = re.compile(r"^[a-z0-9][a-z0-9-]*\.webm$")

# The card shows the clip about 276px wide; 480 covers a 2x display.
DEMO_WIDTH = 480
DEMO_CRF = 36

# Guards the socket against a runaway upload; a demo is tens of kilobytes.
MAX_UPLOAD = 64 * 1024 * 1024


def reencode(src: pathlib.Path, dest: pathlib.Path, cut=None) -> bool:
    """VP9-encodes `src` to `dest` small, optionally keeping only `cut`.

    `cut` is an `(in, out)` pair in seconds. `-ss` goes before `-i` so ffmpeg
    seeks rather than decoding and discarding the head, and the length is given
    as `-t` rather than `-to` because `-to` after a seek would be measured from
    the same origin and cut the clip short.

    False if ffmpeg is not available, which is also the caller's signal that a
    requested trim did not happen.
    """
    if not shutil.which("ffmpeg"):
        return False
    seek = []
    if cut:
        start, end = cut
        seek = ["-ss", f"{start:.3f}", "-t", f"{end - start:.3f}"]
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        *seek[:2], "-i", str(src), *seek[2:],
        "-vf", f"scale={DEMO_WIDTH}:-2:flags=lanczos",
        "-c:v", "libvpx-vp9", "-crf", str(DEMO_CRF), "-b:v", "0",
        "-row-mt", "1", "-deadline", "good",
        "-an", str(dest),
    ]
    done = subprocess.run(cmd, capture_output=True, text=True)
    if done.returncode != 0:
        print(f"  ffmpeg failed, keeping the raw recording:\n{done.stderr.strip()}", file=sys.stderr)
        return False
    return True


class RecordHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BUILD), **kwargs)

    def translate_path(self, path):
        """Routes `demos/` at the source tree and everything else at `build/`."""
        name = self.demo_name(path)
        if name:
            return str(DEMOS / name)
        return super().translate_path(path)

    @staticmethod
    def trim(path):
        """The `(in, out)` seconds asked for in the query, or None.

        A nonsensical pair is dropped rather than refused: the recording in
        hand is worth more than the trim, and an untrimmed clip can be retaken.
        """
        query = urllib.parse.urlparse(path).query
        if not query:
            return None
        args = urllib.parse.parse_qs(query)
        try:
            start = float(args["in"][0])
            end = float(args["out"][0])
        except (KeyError, IndexError, ValueError):
            return None
        if not 0 <= start < end:
            return None
        return start, end

    @staticmethod
    def demo_name(path):
        """The filename for a `/demos/<name>.webm` request, or None."""
        path = path.split("?", 1)[0].split("#", 1)[0].lstrip("/")
        if not path.startswith("demos/"):
            return None
        name = path[len("demos/"):]
        return name if SAFE_NAME.match(name) else None

    def end_headers(self):
        # A recording replaces a file at a URL the page has already fetched,
        # so nothing under this server may be cached.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_PUT(self):
        name = self.demo_name(self.path)
        if not name:
            self.fail(403, "only demos/<tool>.webm may be written")
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_UPLOAD:
            self.fail(413, f"bad body length: {length}")
            return

        cut = self.trim(self.path)
        DEMOS.mkdir(parents=True, exist_ok=True)
        dest = DEMOS / name
        with tempfile.TemporaryDirectory() as tmp:
            raw = pathlib.Path(tmp) / "raw.webm"
            raw.write_bytes(self.rfile.read(length))
            small = pathlib.Path(tmp) / name
            encoded = reencode(raw, small, cut)
            shutil.move(str(small if encoded else raw), dest)

        size = dest.stat().st_size
        cut_note = f", trimmed to {cut[0]:.1f}–{cut[1]:.1f}s" if cut and encoded else ""
        print(f"  saved {dest.relative_to(HERE)} — {size / 1024:.0f} KB "
              f"(recorded {length / 1024:.0f} KB{cut_note})", flush=True)
        # `trimmed` tells the page whether the cut it asked for happened, so it
        # can warn rather than let a clip keep a false start it thinks is gone.
        self.reply(200, {"ok": True, "name": name, "bytes": size, "trimmed": bool(cut) and encoded})

    def reply(self, code, body):
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def fail(self, code, why):
        self.reply(code, {"ok": False, "error": why})

    def log_message(self, fmt, *args):
        # The default line per request buries the save messages.
        if self.command in ("PUT",):
            super().log_message(fmt, *args)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=8791)
    args = ap.parse_args()

    if not (BUILD / "pkg" / "npaint_bg.wasm").exists():
        sys.exit("No build yet: run `make build_npaint` first.")
    if not shutil.which("ffmpeg"):
        print("ffmpeg is not on the PATH: clips will be saved as recorded, which is large.", file=sys.stderr)

    DEMOS.mkdir(parents=True, exist_ok=True)
    url = f"http://localhost:{args.port}/?record=1"
    print(f"NPaint record mode: {url}")
    print(f"Clips are written to {DEMOS.relative_to(HERE.parent)}")
    http.server.ThreadingHTTPServer(("", args.port), RecordHandler).serve_forever()


if __name__ == "__main__":
    main()
