<?php
/**
 * The cron sweeper. Not reachable over the web — cron runs it by path:
 *
 *   */5 * * * * /usr/local/bin/php /home/nteagvxe/public_uploadthat_html/api/cli/sweep.php
 *
 * Clears expired sessions, then blob directories with no session behind them,
 * which is what catches a crash between deleting a row and deleting its files.
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../lib/store.php';

$sessions = ut_sweep();
$orphans = ut_sweep_orphans();

echo sprintf("uploadthat: culled %d session(s), %d orphan director(ies)\n", $sessions, $orphans);
