"""How output is rendered.

These need neither php nor a network: they check what the rendering layer puts
on the stream, which is where two real bugs have already lived.
"""

import io
import json
import re
import unittest

from support import Registry  # noqa: F401  (adds cli/ to sys.path)

from nt.ui import Ui, human_bytes, human_time

SHA = "fa93f4fac47c0d25896de31b161ef400ad828d9a8237297d007e9356891af1ba"

ANSI = re.compile(r"\x1b\[[0-9;]*m")


def render(callback):
    out = io.StringIO()
    callback(Ui(out=out))
    return out.getvalue()


class TableTest(unittest.TestCase):
    def test_a_checksum_is_never_cropped(self):
        """Regression: wide columns were being cut off, not wrapped.

        Rich crops a column that will not fit, which turns a sha256 into a
        shorter string that still looks like a sha256 — wrong in a way you
        would not notice until you compared it against something. It also
        asked the *pipe* how wide it was and got 80, so this happened to
        anything redirected, which is most CI use.
        """
        text = render(lambda ui: ui.table(
            [("PLATFORM", ""), ("FILE", ""), ("SIZE", ""), ("SHA256", "")],
            [("linux-x64", "beagle-1.2.0-linux-x86_64.tar.gz", "234.4 KB", SHA)],
        ))
        self.assertIn(SHA, text.replace("\n", "").replace(" ", ""))

    def test_a_long_description_survives(self):
        description = "Desktop hex and binary inspector, with a rather long description"
        text = render(lambda ui: ui.table(
            [("REPOSITORY", ""), ("DESCRIPTION", "")],
            [("hexviewer", description)],
        ))
        self.assertIn(description, text)

    def test_markup_in_user_data_is_shown_not_swallowed(self):
        """Repo descriptions are user data, and rich reads [x] as a tag.

        With markup enabled a description containing "[bold]" renders as
        nothing at all — the display silently loses what it was asked to show.
        """
        text = render(lambda ui: ui.table(
            [("NAME", ""), ("DESCRIPTION", "")],
            [("thing", "uses [bold] markers and [not-a-tag]")],
        ))
        self.assertIn("[bold]", text)
        self.assertIn("[not-a-tag]", text)

    def test_an_empty_table_says_so(self):
        self.assertIn(
            "No repositories yet",
            render(lambda ui: ui.table([("A", "")], [], empty="No repositories yet.")),
        )


class StreamTest(unittest.TestCase):
    def test_redirected_output_carries_no_escape_codes(self):
        # Colour is decided by rich from the stream, so this also covers the
        # case of a CI log filling up with terminal control sequences.
        text = render(lambda ui: ui.good("Uploaded beagle-cli 1.2.0"))
        self.assertNotRegex(text, ANSI)

    def test_raw_output_is_untouched(self):
        payload = {"sha256": SHA, "notes": "line one\nline two [bold]"}
        text = render(lambda ui: ui.raw(json.dumps(payload, indent=2)))
        self.assertEqual(json.loads(text), payload)

    def test_progress_is_inert_when_not_a_terminal(self):
        # A progress bar redrawing itself into a log file is noise, and into a
        # pipe it is corruption.
        out = io.StringIO()
        ui = Ui(out=out)
        with ui.progress("Uploading", total=100) as update:
            update(50, 100)
            update(100, 100)
        self.assertEqual(out.getvalue(), "")

    def test_a_field_line_is_greppable(self):
        # These are what `nt auth status` prints, and people grep them.
        self.assertIn("Logged in: yes", render(lambda ui: ui.field("Logged in: ", "yes")))


class FormatTest(unittest.TestCase):
    def test_bytes(self):
        self.assertEqual(human_bytes(512), "512 B")
        self.assertEqual(human_bytes(1536), "1.5 KB")
        self.assertEqual(human_bytes(5 * 1024 * 1024), "5.0 MB")
        self.assertEqual(human_bytes(3 * 1024 ** 3), "3.0 GB")

    def test_no_timestamp_is_a_dash(self):
        self.assertEqual(human_time(0), "—")


if __name__ == "__main__":
    unittest.main(verbosity=2)
