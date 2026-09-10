<?php
// The cron sweeper. Not reachable over the web -- cron runs it by path, once
// an hour:
//
//   17 * * * * /usr/local/bin/php ~/public_api_html/api/cli/sweep.php
//
// Line comments, not a docblock: the `*/` in a crontab schedule would close a
// `/* */` block early and turn the rest of the line into a parse error.
//
// Clears expired tokens and stale rate-limit rows, then blob directories with
// no row behind them, which is what catches a crash between deleting a row and
// deleting its files.
//
// Nothing here touches a release. Artifacts are permanent until something asks
// for them to go -- this is an update server, and a release that vanished on
// its own would break every client still on it.
//
// Failures are loud on purpose. A sweeper that dies quietly fills the disk over
// weeks and takes the rest of the account with it, so anything that goes wrong
// goes to stderr and comes back as a non-zero exit.

declare(strict_types=1);

if (isset($_SERVER['REQUEST_METHOD'])) {
    http_response_code(404);
    exit;
}

ini_set('display_errors', 'stderr');
ini_set('error_reporting', (string) E_ALL);

require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/limits.php';
require_once __DIR__ . '/../lib/repos.php';

try {
    $tokens = reg_sweep_tokens();
    $buckets = reg_rate_sweep();
    $orphans = reg_sweep_orphans();
} catch (Throwable $error) {
    fwrite(
        STDERR,
        'registry sweep failed: ' . $error->getMessage()
        . ' @ ' . $error->getFile() . ':' . $error->getLine() . PHP_EOL
    );
    exit(1);
}

echo sprintf(
    "registry: cleared %d token(s), %d rate-limit row(s), %d orphan director(ies)\n",
    $tokens,
    $buckets,
    $orphans
);
