"""Everything that decides how output looks.

Separate from :mod:`nt.cli`, which decides what the commands do, and from
:mod:`nt.client`, which has no opinion about presentation at all. Rich lives
here and nowhere else, so a command reads as a sequence of calls rather than as
a rendering routine.

Two rules run through this module:

* **Machine-readable output is never decorated.** `--json` bypasses all of this
  and prints with :func:`print`, so a pipe gets exactly the bytes the API sent.
* **Nothing depends on being a terminal.** Colour, progress bars and terminal
  width all degrade on their own when the output is a file or a pipe, because
  that is how this gets used from CI as often as from a prompt.
"""

import contextlib
import datetime
import sys

from rich.box import SIMPLE_HEAD
from rich.console import Console
from rich.progress import (
    BarColumn,
    DownloadColumn,
    Progress,
    SpinnerColumn,
    TextColumn,
    TimeRemainingColumn,
    TransferSpeedColumn,
)
from rich.table import Table
from rich.text import Text

#: Rich falls back to 80 columns when it cannot ask a terminal how wide it is,
#: which squeezes a six-column table into wrapped fragments the moment output
#: is redirected. A pipe has no width to run out of, so it is given room.
REDIRECTED_WIDTH = 200


class Ui:
    """Where output goes, and what it looks like on the way."""

    def __init__(self, out=None, force_plain=False):
        self.console = Console(
            file=out,
            width=None if _is_terminal(out) else REDIRECTED_WIDTH,
            no_color=force_plain or None,
            highlight=False,
            soft_wrap=False,
            emoji=False,
            # Off, because almost everything printed here is user data: repo
            # names, descriptions, release notes, filenames. With markup on, a
            # description containing "[bold]" is silently swallowed rather than
            # shown — the display quietly loses what it was asked to display.
            # Styling is applied with Text objects instead, which cannot be
            # injected into.
            markup=False,
        )

    @property
    def interactive(self):
        return self.console.is_terminal

    # -- plain output ------------------------------------------------------

    def say(self, message=""):
        self.console.print(message)

    def raw(self, text):
        """Output that must not be touched: JSON, mostly."""
        print(text, file=self.console.file)

    def field(self, label, value, style=""):
        """A `label value` line for the small status readouts.

        The label carries its own spacing rather than being padded here, so
        what reaches the terminal is exactly the string in the source — which
        is what makes these greppable.
        """
        line = Text(label, style="dim")
        line.append(str(value), style=style)
        self.console.print(line)

    def good(self, message):
        self.console.print(Text(message, style="green"))

    def warn(self, message):
        self.console.print(Text(message, style="yellow"))

    def error(self, message, hint=""):
        self.console.print(Text("nt: ", style="bold red") + Text(message))
        if hint:
            self.console.print(Text("    " + hint, style="dim"))

    # -- tables ------------------------------------------------------------

    def table(self, columns, rows, empty=""):
        """A table, or `empty` if there is nothing to put in one.

        `columns` are `(header, style)` pairs; a header of `""` renders as an
        unlabelled column, which is how the badge columns stay quiet.
        """
        if not rows:
            if empty:
                self.console.print(Text(empty, style="dim"))
            return

        table = Table(box=SIMPLE_HEAD, pad_edge=False, show_edge=False, header_style="dim")
        for header, style in columns:
            # Folded, never cropped. These columns carry names, versions and
            # checksums, and rich's default for a column that will not fit is
            # to cut it off — which turns a sha256 into a shorter string that
            # still looks like one. A wrapped hash is ugly; a truncated one is
            # wrong, and wrong in a way you would not notice until you compared
            # it against something.
            table.add_column(header, style=style, no_wrap=False, overflow="fold")
        for row in rows:
            table.add_row(*[c if isinstance(c, Text) else str(c) for c in row])
        self.console.print(table)

    # -- progress ----------------------------------------------------------

    @contextlib.contextmanager
    def progress(self, description, total=0, enabled=True):
        """A transfer bar, yielding an `update(done, total)` callback.

        Disabled for `--json` and whenever output is not a terminal: a progress
        bar redrawing itself into a log file is noise, and into a pipe it is
        corruption.
        """
        if not enabled or not self.interactive:
            yield lambda done, size=0: None
            return

        columns = [
            SpinnerColumn(),
            # markup=False for the same reason as the console: the description
            # carries a filename, and a "[" in one would otherwise be read as
            # the start of a tag.
            TextColumn("{task.description}", markup=False),
            BarColumn(),
            DownloadColumn(),
            TransferSpeedColumn(),
            TimeRemainingColumn(),
        ]
        with Progress(*columns, console=self.console, transient=True) as progress:
            task = progress.add_task(description, total=total or None)

            def update(done, size=0):
                # The size is only known once the response headers arrive, so
                # the total is set on the first callback rather than up front.
                if size and progress.tasks[task].total != size:
                    progress.update(task, total=size)
                progress.update(task, completed=done)

            yield update


def _is_terminal(out):
    """Whether output is going to a terminal.

    `out` of None means "wherever stdout goes", which is *not* the same as "a
    terminal" — `nt list > file` has a stdout that is a plain file. Assuming
    otherwise means rich asks a pipe how wide it is, gets 80, and crushes every
    table that is redirected anywhere.
    """
    stream = sys.stdout if out is None else out
    try:
        return bool(stream.isatty())
    except (AttributeError, ValueError):
        return False


# --- formatting helpers --------------------------------------------------

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
