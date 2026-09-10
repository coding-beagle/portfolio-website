"""nt — the command line client for a private release registry.

The registry stores versioned build artifacts and hands them back to whatever
asks: your laptop, a CI job, or an application checking whether it is out of
date. This package is the client; the server it talks to lives in
``php/registry`` in the same repository.

Everything is stdlib. A tool you want to install on a build machine at 2am
should not need a package index to be reachable.
"""

__version__ = "1.0.0"
