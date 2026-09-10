"""nt — the command line client for a private release registry.

The registry stores versioned build artifacts and hands them back to whatever
asks: your laptop, a CI job, or an application checking whether it is out of
date. This package is the client; the server it talks to lives in
``php/registry`` in the same repository.

Click builds the command tree and rich draws the output; everything that
touches the network is stdlib (urllib), so there is nothing here that needs a
compiler or a system package to install.
"""

__version__ = "1.0.0"
