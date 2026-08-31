<?php
/**
 * Checks the things that have to be true before the API will work, and says
 * which one is not. Run it after setting up, and again whenever something
 * behaves oddly:
 *
 *   /usr/local/bin/php ~/public_uploadthat_html/api/cli/doctor.php
 */

declare(strict_types=1);

if (isset($_SERVER['REQUEST_METHOD'])) {
    http_response_code(404);
    exit;
}

ini_set('display_errors', 'stderr');
ini_set('error_reporting', (string) E_ALL);

$problems = 0;

/**
 * `$detail` is worth knowing either way; `$fix` is what to do about it and only
 * appears on a failure — printing remediation next to a passing check reads as
 * though something is wrong with it.
 */
function report(string $what, bool $ok, string $detail = '', string $fix = ''): void
{
    global $problems;
    if (!$ok) {
        $problems++;
    }
    $note = $detail;
    if (!$ok && $fix !== '') {
        $note = $note === '' ? $fix : $note . '; ' . $fix;
    }
    printf("  %-4s %s%s\n", $ok ? 'ok' : 'FAIL', $what, $note === '' ? '' : ' — ' . $note);
}

echo "php\n";
report('version ' . PHP_VERSION, PHP_VERSION_ID >= 70400, '', 'needs 7.4 or newer');
report('sapi is ' . PHP_SAPI, true);
report('pdo_sqlite', extension_loaded('pdo_sqlite'), '', 'enable it in MultiPHP INI Editor');
report('json', extension_loaded('json'));

// These are the CLI values. cPanel usually gives the web SAPI a different ini,
// and the web one is what actually limits an upload — so this section is a
// sanity check, not the answer. GET /api/health reports the live web figures.
echo "\nupload limits (as seen from the command line)\n";
require_once __DIR__ . '/../lib/http.php';
$upload = ut_bytes_ini('upload_max_filesize');
$post = ut_bytes_ini('post_max_size');
report('upload_max_filesize = ' . ini_get('upload_max_filesize'), $upload > 0);
report(
    'post_max_size = ' . ini_get('post_max_size'),
    $post >= $upload,
    '',
    'should be at least upload_max_filesize, or large uploads are silently truncated'
);
report('memory_limit = ' . ini_get('memory_limit'), true);
report(
    'max_execution_time = ' . ini_get('max_execution_time'),
    true,
    (int) ini_get('max_execution_time') === 0 ? 'unlimited' : 'seconds'
);
echo "       the web server's own limits: curl -s https://uploadthat.nteague.com/api/health\n";

echo "\nconfiguration\n";
try {
    require_once __DIR__ . '/../lib/config.php';
    $config = ut_config();
    report('config loads', true);
    report('data_dir = ' . $config['data_dir'], true);

    $dir = ut_data_dir();
    $exists = is_dir($dir) || @mkdir($dir, 0700, true);
    report('data_dir exists and is writable', $exists && is_writable($dir));

    $hash = $config['operator_key_hash'];
    if ($hash === null || $hash === '') {
        report('operator_key_hash not set', true, 'operator tier disabled');
    } else {
        $named = password_get_info((string) $hash)['algoName'] ?? 'unknown';
        report(
            'operator_key_hash is a password hash',
            $named !== 'unknown',
            $named === 'unknown' ? '' : $named,
            'looks like a plain passphrase; store password_hash() output instead'
        );
    }
    report(
        'accepting_sessions',
        true,
        $config['accepting_sessions'] ? 'yes, kill switch off' : 'NO, kill switch is on'
    );
} catch (Throwable $error) {
    report('config loads', false, $error->getMessage());
}

echo "\ndatabase\n";
try {
    require_once __DIR__ . '/../lib/db.php';
    $pdo = ut_db();
    $tables = $pdo->query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        ->fetchAll(PDO::FETCH_COLUMN);
    report('opens and migrates', count($tables) >= 4, implode(', ', $tables));
    $live = (int) $pdo->query('SELECT COUNT(*) FROM sessions')->fetchColumn();
    report('live sessions: ' . $live, true);
} catch (Throwable $error) {
    report('opens and migrates', false, $error->getMessage());
}

echo "\n" . ($problems === 0 ? "All good.\n" : "$problems problem(s) above.\n");
exit($problems === 0 ? 0 : 1);
