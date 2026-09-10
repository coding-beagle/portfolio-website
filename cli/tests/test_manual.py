"""`nt manual` — the integration guide, shipped with the client.

Needs neither php nor a network. The interesting test is the first one: the
guide exists twice, once in the registry's directory where it is read on
GitHub and once inside the Python package where `pip install` can reach it.
Two copies of a document drift, so the drift is what gets tested.
"""

import io
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from support import REPO_ROOT  # noqa: F401  (adds cli/ to sys.path)

from nt.cli import EXAMPLES, extract_example, manual_text, run

CANONICAL = REPO_ROOT / "php" / "registry" / "INTEGRATION.md"
SHIPPED = REPO_ROOT / "cli" / "nt" / "data" / "INTEGRATION.md"


def nt(*argv):
    out = io.StringIO()
    code = run(list(argv), out=out)
    assert code == 0, "`nt %s` exited %d" % (" ".join(argv), code)
    return out.getvalue()


class ShippedCopyTest(unittest.TestCase):
    def test_the_two_copies_are_identical(self):
        """The guide is duplicated, so this is what stops it diverging.

        php/registry/INTEGRATION.md is the one people read in the repository;
        cli/nt/data/INTEGRATION.md is the one `nt manual` prints, and it has to
        be inside the package to survive `pip install`. Editing one and not the
        other would ship stale instructions to precisely the audience least
        able to notice — an agent, which has no other copy to compare against.
        """
        self.assertTrue(CANONICAL.is_file(), "%s is missing" % CANONICAL)
        self.assertTrue(SHIPPED.is_file(), "%s is missing" % SHIPPED)
        self.assertEqual(
            CANONICAL.read_text("utf-8"),
            SHIPPED.read_text("utf-8"),
            "the integration guide has drifted — run `make sync_integration_doc`",
        )

    def test_the_package_can_find_it(self):
        # Reading it through the package, the way an installed copy would,
        # rather than by walking the repository.
        self.assertIn("# Integrating with the registry", manual_text())


class OutputTest(unittest.TestCase):
    def test_the_default_output_is_the_document_itself(self):
        # Piped into files and other tools far more often than it is read at a
        # prompt, so it has to come out byte-for-byte rather than reflowed.
        self.assertEqual(nt("manual").rstrip("\n"), CANONICAL.read_text("utf-8").rstrip("\n"))

    def test_aliases_reach_the_same_command(self):
        self.assertEqual(nt("integrate"), nt("manual"))
        self.assertEqual(nt("docs"), nt("manual"))

    def test_it_can_be_written_to_a_file(self):
        with tempfile.TemporaryDirectory() as work:
            target = Path(work) / "REGISTRY.md"
            nt("manual", "-o", str(target))
            self.assertEqual(target.read_text("utf-8"), CANONICAL.read_text("utf-8"))

    def test_render_produces_something_readable(self):
        rendered = nt("manual", "--render")
        self.assertIn("Integrating with the registry", rendered)
        # Formatted for a terminal, so deliberately NOT the raw markdown.
        self.assertNotIn("## 4. The update algorithm", rendered)


class ExampleTest(unittest.TestCase):
    """The examples are lifted out of the guide by pattern, so each one is
    checked to still be findable — and to still be valid code."""

    def test_every_example_is_extractable(self):
        text = manual_text()
        for name in EXAMPLES:
            with self.subTest(example=name):
                code = extract_example(text, name)
                self.assertGreater(len(code.splitlines()), 10, "%s looks truncated" % name)

    def test_the_python_example_compiles(self):
        compile(nt("manual", "--example", "python"), "update.py", "exec")

    def test_the_python_example_comparator_is_correct(self):
        # The single most important line of code in the guide: an updater that
        # compares versions wrongly ships the wrong build to everybody.
        namespace = {}
        exec(compile(nt("manual", "--example", "python"), "update.py", "exec"), namespace)
        is_newer = namespace["is_newer"]

        order = [
            "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta",
            "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0",
            "1.9.0", "1.10.0", "2.0.0",
        ]
        for lower, higher in zip(order, order[1:]):
            self.assertTrue(is_newer(higher, lower), "%s should outrank %s" % (higher, lower))
        self.assertFalse(is_newer("1.0.0-rc.1", "1.0.0"))

    def test_the_shell_example_parses(self):
        with tempfile.NamedTemporaryFile("w", suffix=".sh") as handle:
            handle.write(nt("manual", "--example", "sh"))
            handle.flush()
            subprocess.run(["sh", "-n", handle.name], check=True)

    @unittest.skipUnless(
        subprocess.run(["sh", "-c", "command -v node"], capture_output=True).returncode == 0,
        "needs node",
    )
    def test_the_node_example_parses(self):
        with tempfile.NamedTemporaryFile("w", suffix=".js") as handle:
            handle.write(nt("manual", "--example", "node"))
            handle.flush()
            subprocess.run(["node", "--check", handle.name], check=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
