"""The one exception type the CLI reports on.

Anything the user could plausibly cause — a wrong password, a missing repo, a
file that is not there — is raised as an ``NtError`` and printed as a single
line without a traceback. Anything else escapes as a real traceback, because
it is a bug and hiding it would only make it harder to fix.
"""


class NtError(Exception):
    """A problem worth telling the user about in one line.

    ``code`` is the API's machine-readable error code where there was one, so
    callers (and tests) can distinguish "no such repo" from "no such version"
    without matching on the message text.
    """

    def __init__(self, message, code="", hint=""):
        super().__init__(message)
        self.message = message
        self.code = code
        self.hint = hint

    def __str__(self):
        return self.message
