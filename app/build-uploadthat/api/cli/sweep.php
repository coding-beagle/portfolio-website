<?php
// The cron sweeper. Not reachable over the web -- cron runs it by path, every
// five minutes:
//
//   */5 * * * * /usr/local/bin/php ~/public_uploadthat_html/api/cli/sweep.php
//
// Line comments, not a docblock: the `*/` in a crontab schedule would close a
// `/* */` block early and turn the rest of the line into a parse error.
//
// Clears expired sessions, then blob directories with no session behind them,
// which is what catches a crash between deleting a row and deleting its files.
//
// Failures are loud on purpose. A sweeper that dies quietly fills the disk over
// days and takes the rest of the account with it, so anything that goes wrong
// goes to stderr and comes back as a non-zero exit.

declare(strict_types=1);

// A web request always sets REQUEST_METHOD; a shell never does. Checking that
// rather than PHP_SAPI, because cPanel's /usr/local/bin/php is sometimes the
// CGI binary rather than the CLI one, and this would refuse to run under it.
if (isset($_SERVER['REQUEST_METHOD'])) {
    http_response_code(404);
    exit;
}

ini_set('display_errors', 'stderr');
ini_set('error_reporting', (string) E_ALL);

require_once __DIR__ . '/../lib/store.php';

try {
    $sessions = ut_sweep();
    $orphans = ut_sweep_orphans();
} catch (Throwable $error) {
    fwrite(
        STDERR,
        'uploadthat sweep failed: ' . $error->getMessage()
        . ' @ ' . $error->getFile() . ':' . $error->getLine() . PHP_EOL
    );
    exit(1);
}

echo sprintf("uploadthat: culled %d session(s), %d orphan director(ies)\n", $sessions, $orphans);
