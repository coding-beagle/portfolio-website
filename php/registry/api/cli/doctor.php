<?php
/**
 * Checks the things that have to be true before the API will work, and says
 * which one is not. Run it after setting up, and again whenever something
 * behaves oddly:
 *
 *   /usr/local/bin/php ~/public_api_html/api/cli/doctor.php
 */

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
// 8.1, not 8.0: lib/http.php uses readonly properties and the app uses
// first-class callable syntax throughout, both of which are 8.1. On 8.0 the
// files do not parse, and a parse error with display_errors off prints
// absolutely nothing — so getting this check wrong would mean a blank 500 and
// a doctor reporting all-clear.
report('version ' . PHP_VERSION, PHP_VERSION_ID >= 80100, '', 'needs 8.1 or newer');
report('sapi is ' . PHP_SAPI, true);
report('pdo_sqlite', extension_loaded('pdo_sqlite'), '', 'enable it in MultiPHP INI Editor');
report('json', extension_loaded('json'));

// These are the CLI values. cPanel usually gives the web SAPI a different ini,
// and the web one is what actually limits an upload — so this section is a
// sanity check, not the answer. GET /api/health reports the live web figures.
echo "\nupload limits (as seen from the command line)\n";
require_once __DIR__ . '/../lib/http.php';
$upload = reg_bytes_ini('upload_max_filesize');
$post = reg_bytes_ini('post_max_size');
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
echo "       the web server's own limits: curl -s https://api.nteague.com/api/health\n";

echo "\nconfiguration\n";
try {
    require_once __DIR__ . '/../lib/config.php';
    require_once __DIR__ . '/../lib/auth.php';
    $config = reg_config();
    report('config loads', true);
    report('data_dir = ' . $config['data_dir'], true);

    $dir = reg_data_dir();
    $exists = is_dir($dir) || @mkdir($dir, 0700, true);
    report('data_dir exists and is writable', $exists && is_writable($dir));

    if (!reg_auth_configured()) {
        report(
            'admin_password_hash is set',
            false,
            'not set',
            'nothing can log in until it is; see config.sample.php'
        );
    } else {
        $named = password_get_info((string) $config['admin_password_hash'])['algoName'] ?? 'unknown';
        report(
            'admin_password_hash is a password hash',
            reg_auth_hash_looks_valid(),
            $named === 'unknown' ? '' : $named,
            'looks like a plain password; store password_hash() output instead'
        );
    }

    report(
        'accepting_writes',
        true,
        $config['accepting_writes'] ? 'yes, kill switch off' : 'NO, read-only mode is on'
    );
} catch (Throwable $error) {
    report('config loads', false, $error->getMessage());
}

echo "\ndatabase\n";
try {
    require_once __DIR__ . '/../lib/db.php';
    require_once __DIR__ . '/../lib/limits.php';
    $pdo = reg_db();
    $tables = $pdo->query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        ->fetchAll(PDO::FETCH_COLUMN);
    report('opens and migrates', count($tables) >= 5, implode(', ', $tables));

    $repos = (int) $pdo->query('SELECT COUNT(*) FROM repos')->fetchColumn();
    $versions = (int) $pdo->query('SELECT COUNT(*) FROM versions')->fetchColumn();
    $artifacts = (int) $pdo->query('SELECT COUNT(*) FROM artifacts')->fetchColumn();
    $tokens = (int) $pdo->query('SELECT COUNT(*) FROM tokens WHERE expires_at > ' . time())->fetchColumn();
    report("$repos repo(s), $versions version(s), $artifacts artifact(s)", true);
    report("$tokens live token(s)", true);

    $stored = reg_bytes_stored();
    report(
        'storage: ' . round($stored / (1024 * 1024), 1) . ' MB used',
        !reg_disk_full(),
        reg_disk_pressured() ? 'past the soft limit' : '',
        'at the global_bytes_ceiling; uploads are being refused'
    );
} catch (Throwable $error) {
    report('opens and migrates', false, $error->getMessage());
}

// The bytes on disk and the rows in the database are two records of the same
// thing, and they only disagree when something has gone wrong. Cheap to check,
// and the alternative is finding out from a client that a download 404s.
echo "\nartifacts on disk\n";
try {
    $missing = 0;
    $rows = reg_db()->query(
        'SELECT a.id, a.filename, v.id AS version_id, r.id AS repo_id, r.name
         FROM artifacts a
         JOIN versions v ON v.id = a.version_id
         JOIN repos r ON r.id = v.repo_id'
    )->fetchAll();
    foreach ($rows as $row) {
        if (!is_file(reg_artifact_path($row['repo_id'], $row['version_id'], $row['id']))) {
            $missing++;
            echo '       missing: ' . $row['name'] . ' / ' . $row['filename'] . "\n";
        }
    }
    report('every artifact row has its bytes', $missing === 0, count($rows) . ' checked');
} catch (Throwable $error) {
    report('artifact check', false, $error->getMessage());
}

echo "\n" . ($problems === 0 ? "All good.\n" : "$problems problem(s) above.\n");
exit($problems === 0 ? 0 : 1);
