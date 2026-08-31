<?php
/**
 * Tests for the uploadthat store, run with plain PHP:
 *
 *   php php/uploadthat/tests/run.php      (or: make test_uploadthat)
 *
 * No framework, because adding Composer to a cPanel deploy for one file's worth
 * of assertions is a poor trade. Everything runs against a throwaway database
 * in the system temp directory, so it never touches real sessions.
 */

declare(strict_types=1);

$temp = sys_get_temp_dir() . '/uploadthat-test-' . bin2hex(random_bytes(6));
mkdir($temp, 0700, true);

// ut_config() caches on first call, so the environment has to be set first.
$configFile = $temp . '/config.php';
file_put_contents($configFile, '<?php return ' . var_export([
    'data_dir' => $temp . '/data',
    'operator_key_hash' => password_hash('let me in', PASSWORD_DEFAULT),
    'accepting_sessions' => true,
    'tiers' => [
        'anon' => [
            'max_file_bytes' => 1024,
            'max_session_bytes' => 4096,
            'max_files' => 3,
            'window_seconds' => 900,
            'ceiling_seconds' => 3600,
        ],
        'operator' => [
            'max_file_bytes' => 8192,
            'max_session_bytes' => 65536,
            'max_files' => 10,
            'window_seconds' => 7200,
            'ceiling_seconds' => 14400,
        ],
    ],
    'rate_limits' => ['create' => ['limit' => 2, 'window' => 3600]],
], true) . ';');
putenv('UPLOADTHAT_CONFIG=' . $configFile);

require_once __DIR__ . '/../api/lib/store.php';
require_once __DIR__ . '/../api/lib/limits.php';

$passed = 0;
$failed = 0;

function check(string $what, $actual, $expected): void
{
    global $passed, $failed;
    if ($actual === $expected) {
        $passed++;
        echo "  ok   $what\n";
        return;
    }
    $failed++;
    echo "  FAIL $what\n";
    echo '       expected: ' . var_export($expected, true) . "\n";
    echo '       actual:   ' . var_export($actual, true) . "\n";
}

function checkThat(string $what, bool $condition): void
{
    check($what, $condition, true);
}

// --- every file parses -------------------------------------------------
// First, because everything below is meaningless if a file will not compile —
// and the CLI scripts are never required by these tests, so nothing else here
// would notice one being broken. A parse error with display_errors off prints
// nothing at all, which is a miserable thing to debug on a server.
echo "syntax\n";

$sources = array_merge(
    glob(__DIR__ . '/../api/*.php') ?: [],
    glob(__DIR__ . '/../api/lib/*.php') ?: [],
    glob(__DIR__ . '/../api/cli/*.php') ?: [],
    glob(__DIR__ . '/../*.php') ?: []
);

foreach ($sources as $source) {
    $output = [];
    $status = 0;
    exec(escapeshellarg(PHP_BINARY) . ' -l ' . escapeshellarg($source) . ' 2>&1', $output, $status);
    $name = basename(dirname($source)) . '/' . basename($source);
    if ($status === 0) {
        check("$name parses", true, true);
    } else {
        check("$name parses", trim(implode(' ', $output)), 'no syntax errors');
    }
}

echo "\nuploadthat store\n";

// --- sessions ----------------------------------------------------------
$session = ut_create_session('anon');
checkThat('a new session gets a six-digit code', (bool) preg_match('/^[1-9]\d{5}$/', $session['code']));
checkThat('a new session gets a token', strlen($session['token']) > 30);
check('the clock starts at the tier window', $session['expires_at'] - $session['created_at'], 900);
check('the ceiling is further out than the window', $session['ceiling_at'] - $session['created_at'], 3600);

$auth = ut_authenticate($session['token']);
checkThat('the owner token authenticates', $auth !== null);
check('and resolves to the right session', $auth['s_id'], $session['id']);
check('as the owner', $auth['role'], 'owner');
check('a token that was never issued does not authenticate', ut_authenticate('nonsense'), null);
check('nor does no token at all', ut_authenticate(null), null);

// --- joining -----------------------------------------------------------
$joined = ut_join_session($session['code']);
checkThat('a live code can be joined', $joined !== null);
check('the joiner lands in the same session', $joined['session']['id'], $session['id']);
$guest = ut_authenticate($joined['token']);
check('the joiner is a guest', $guest['role'], 'guest');
check('and is labelled as the second device', $guest['label'], 'Device 2');
checkThat('the two devices get different tokens', $joined['token'] !== $session['token']);
check('an unknown code cannot be joined', ut_join_session('000000'), null);

// --- files -------------------------------------------------------------
$meta = base64_encode(json_encode(['name' => 'notes.txt', 'type' => 'text/plain']));
$fileId = ut_uuid();
mkdir(ut_blob_dir($session['id']), 0700, true);
file_put_contents(ut_blob_dir($session['id']) . '/' . $fileId, str_repeat('x', 128));
ut_add_file($auth, $fileId, $meta, 128);

$manifest = ut_manifest($session['id']);
check('the manifest lists the file', count($manifest['files']), 1);
check('with its size', $manifest['files'][0]['size'], 128);
check('and the description untouched', $manifest['files'][0]['meta'], $meta);
check('attributed to the device that sent it', $manifest['files'][0]['uploadedBy'], 'Device 1');
check('the session tracks bytes used', $manifest['bytesUsed'], 128);

$before = $manifest['version'];
ut_add_file($auth, ut_uuid(), $meta, 64);
check('every change bumps the version the poll watches', ut_manifest($session['id'])['version'], $before + 1);

checkThat('a file can be removed', ut_delete_file($session['id'], $fileId));
check('and the byte count comes back down', ut_manifest($session['id'])['bytesUsed'], 64);
check('removing it twice is not an error, just false', ut_delete_file($session['id'], $fileId), false);
checkThat('its blob is gone from disk', !file_exists(ut_blob_dir($session['id']) . '/' . $fileId));

// --- heartbeat ---------------------------------------------------------
$fresh = ut_authenticate($session['token']);
$extended = ut_heartbeat($fresh);
checkThat('a heartbeat never pushes past the ceiling', $extended <= (int) $fresh['ceiling_at']);

// --- culling -----------------------------------------------------------
$doomed = ut_create_session('anon');
$blob = ut_blob_dir($doomed['id']);
mkdir($blob, 0700, true);
file_put_contents($blob . '/some-file', 'bytes');
ut_db()->prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
    ->execute([time() - 1, $doomed['id']]);

checkThat('the sweeper culls an expired session', ut_sweep() >= 1);
checkThat('taking its files with it', !is_dir($blob));
check('and an expired token stops working', ut_authenticate($doomed['token']), null);

$orphan = ut_data_dir() . '/blobs/11111111-2222-4333-8444-555555555555';
mkdir($orphan, 0700, true);
file_put_contents($orphan . '/stray', 'bytes');
checkThat('orphan directories are cleaned by the cron pass', ut_sweep_orphans() >= 1);
checkThat('and really are gone', !is_dir($orphan));

// --- closing -----------------------------------------------------------
ut_close_session($session['id']);
check('closing a session ends it', ut_authenticate($session['token']), null);
check('and the guest with it', ut_authenticate($joined['token']), null);
checkThat('and takes the blob directory', !is_dir(ut_blob_dir($session['id'])));

// --- rate limiting -----------------------------------------------------
echo "\nrate limiting\n";
checkThat('the first use is allowed', ut_rate_allow('198.51.100.7', 'create'));
checkThat('the second is allowed', ut_rate_allow('198.51.100.7', 'create'));
check('the third is not', ut_rate_allow('198.51.100.7', 'create'), false);
checkThat('a different caller has its own budget', ut_rate_allow('198.51.100.8', 'create'));
checkThat('an unconfigured bucket is not limited', ut_rate_allow('198.51.100.7', 'nonexistent'));

// The operator key uses these two halves rather than ut_rate_allow, so that a
// correct key never spends the budget that exists to slow down wrong ones.
check('checking a budget does not spend it', ut_rate_exceeded('198.51.100.9', 'create'), false);
checkThat('and it is still untouched afterwards', ut_rate_allow('198.51.100.9', 'create'));
ut_rate_consume('198.51.100.9', 'create');
checkThat('spending it twice reaches the limit', ut_rate_exceeded('198.51.100.9', 'create'));

// --- the data directory guard -----------------------------------------
echo "\nconfiguration\n";
$caught = false;
try {
    ut_assert_data_dir_outside('/home/x/public_html/.data', '/home/x/public_html');
} catch (RuntimeException $error) {
    $caught = true;
}
checkThat('a data directory inside the document root is refused', $caught);

$allowed = true;
try {
    ut_assert_data_dir_outside('/home/x/uploadthat_data', '/home/x/public_html');
} catch (RuntimeException $error) {
    $allowed = false;
}
checkThat('one beside it is fine', $allowed);

$sibling = true;
try {
    // A sibling whose name merely starts with the document root's must not trip
    // the prefix check.
    ut_assert_data_dir_outside('/home/x/public_html_data', '/home/x/public_html');
} catch (RuntimeException $error) {
    $sibling = false;
}
checkThat('a sibling with a similar name is not mistaken for a child', $sibling);

// --- teardown ----------------------------------------------------------
ut_rmdir($temp . '/data/blobs');
foreach (glob($temp . '/data/*') ?: [] as $file) {
    @unlink($file);
}
@rmdir($temp . '/data/blobs');
@rmdir($temp . '/data');
@unlink($configFile);
@rmdir($temp);

echo "\n$passed passed, $failed failed\n";
exit($failed === 0 ? 0 : 1);
