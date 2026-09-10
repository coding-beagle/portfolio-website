<?php
/**
 * Tests for the registry, run with plain PHP:
 *
 *   php php/registry/tests/run.php      (or: make test_registry)
 *
 * No framework, because adding Composer to a cPanel deploy for one file's worth
 * of assertions is a poor trade.
 *
 * These are not unit tests of the store. Every case below goes through
 * reg_handle() — the same routing, the same auth guards, the same validation a
 * real request meets — but in-process, against a throwaway database in the
 * system temp directory. That is what the RegRequest/RegResponse split in
 * lib/http.php buys: the entire API is testable with no server to start, no
 * port to pick, no network, and no live deployment to point at.
 *
 * tests/local.sh runs the same suite's HTTP-level cousin against `php -S`, to
 * cover the parts only a real web server has: the .htaccess rewrite, multipart
 * parsing, and whether Authorization survives the trip to PHP.
 */

declare(strict_types=1);

$temp = sys_get_temp_dir() . '/registry-test-' . bin2hex(random_bytes(6));
mkdir($temp, 0700, true);

const TEST_PASSWORD = 'correct horse battery staple';

// reg_config() caches on first call, so the environment has to be set first.
$configFile = $temp . '/config.php';
file_put_contents($configFile, '<?php return ' . var_export([
    'data_dir' => $temp . '/data',
    'admin_password_hash' => password_hash(TEST_PASSWORD, PASSWORD_DEFAULT),
    'accepting_writes' => true,
    'token_ttl_seconds' => 3600,
    'max_artifact_bytes' => 4096,
    'global_bytes_ceiling' => 1024 * 1024,
    'disk_soft_fraction' => 0.9,
    'sweep_per_request' => 5,
    'rate_limits' => [
        'login' => ['limit' => 3, 'window' => 900],
        'upload' => ['limit' => 50, 'window' => 3600],
    ],
], true) . ';');
putenv('REGISTRY_CONFIG=' . $configFile);

require_once __DIR__ . '/../api/lib/router.php';

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

/**
 * One request against the API, exactly as the web entry point would make it.
 *
 * @param array{token?:string,json?:array,post?:array,file?:array,query?:array,ip?:string,truncated?:bool} $options
 */
function api(string $method, string $path, array $options = []): RegResponse
{
    $headers = [];
    if (isset($options['token'])) {
        $headers['authorization'] = 'Bearer ' . $options['token'];
    }

    $files = [];
    if (isset($options['file'])) {
        $files['file'] = $options['file'];
    }

    return reg_handle(new RegRequest(
        method: $method,
        path: $path,
        query: $options['query'] ?? [],
        headers: $headers,
        body: isset($options['json']) ? (string) json_encode($options['json']) : '',
        post: $options['post'] ?? [],
        files: $files,
        ip: $options['ip'] ?? '203.0.113.10',
        truncated: $options['truncated'] ?? false,
    ));
}

/**
 * A file to upload. `uploaded` is false, which is the one thing that differs
 * from a real request: move_uploaded_file rightly refuses a path PHP did not
 * receive itself, so the store copies instead. Everything else is identical.
 */
function upload_file(string $name, string $contents): array
{
    static $counter = 0;
    global $temp;

    $path = $temp . '/upload-' . (++$counter) . '.bin';
    file_put_contents($path, $contents);

    return [
        'path' => $path,
        'name' => $name,
        'size' => strlen($contents),
        'type' => 'application/octet-stream',
        'uploaded' => false,
    ];
}

/** One repo out of the listing, by name, so a test never depends on ordering. */
function repo_summary(string $token, string $name): array
{
    foreach (api('GET', '/api/repos', ['token' => $token])->decoded()['repos'] as $repo) {
        if ($repo['name'] === $name) {
            return $repo;
        }
    }
    return [];
}

// --- every file parses ---------------------------------------------------
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
    check("$name parses", $status === 0 ? 'no syntax errors' : trim(implode(' ', $output)), 'no syntax errors');
}

// --- semver --------------------------------------------------------------
// The rules that decide what `latest` means. Everything an auto-updater does
// rests on this being right, and it is the one part of the app with enough
// edge cases to be worth testing on its own rather than only through a route.
echo "\nsemver\n";

checkThat('a plain version parses', reg_semver_valid('1.4.2'));
checkThat('a prerelease parses', reg_semver_valid('1.0.0-rc.1'));
checkThat('build metadata parses', reg_semver_valid('1.0.0+build.7'));
checkThat('a leading v is accepted', reg_semver_valid('v2.0.0'));
check('and normalised away', reg_semver_parse('v2.0.0')['version'], '2.0.0');
checkThat('two components is not a version', !reg_semver_valid('1.4'));
checkThat('leading zeroes are refused', !reg_semver_valid('1.01.0'));
checkThat('a bare word is not a version', !reg_semver_valid('latest'));
checkThat('nor is an empty string', !reg_semver_valid(''));

check('patch releases order', reg_semver_compare('1.0.1', '1.0.0'), 1);
check('minor beats patch', reg_semver_compare('1.1.0', '1.0.9'), 1);
check('major beats minor', reg_semver_compare('2.0.0', '1.99.99'), 1);
check('a release outranks its own prerelease', reg_semver_compare('1.0.0', '1.0.0-rc.1'), 1);
check('prereleases order among themselves', reg_semver_compare('1.0.0-rc.2', '1.0.0-rc.1'), 1);
check('numeric identifiers compare numerically', reg_semver_compare('1.0.0-rc.10', '1.0.0-rc.9'), 1);
check('alphanumeric outranks numeric', reg_semver_compare('1.0.0-alpha', '1.0.0-1'), 1);
check('a longer prerelease outranks its prefix', reg_semver_compare('1.0.0-alpha.1', '1.0.0-alpha'), 1);
check('build metadata is ignored', reg_semver_compare('1.0.0+a', '1.0.0+b'), 0);
check('equal versions are equal', reg_semver_compare('1.2.3', '1.2.3'), 0);

check(
    'the canonical spec ordering holds',
    reg_semver_sort(['1.0.0', '1.0.0-rc.1', '1.0.0-beta', '1.0.0-alpha.1', '1.0.0-alpha', '2.0.0']),
    ['2.0.0', '1.0.0', '1.0.0-rc.1', '1.0.0-beta', '1.0.0-alpha.1', '1.0.0-alpha']
);

// --- health and the closed door ------------------------------------------
echo "\nhealth\n";

$health = api('GET', '/api/health');
check('health answers without a token', $health->status, 200);
check('and says it is up', $health->decoded()['ok'], true);
check('and whether a password is configured', $health->decoded()['authConfigured'], true);
checkThat('but gives away nothing about what is stored', !isset($health->decoded()['repos']));

check('every other endpoint refuses an anonymous caller', api('GET', '/api/repos')->status, 401);
check('with a code the client can switch on', api('GET', '/api/repos')->errorCode(), 'unauthorised');
check('a made-up token is not a token', api('GET', '/api/repos', ['token' => 'nonsense'])->status, 401);

// --- logging in ----------------------------------------------------------
echo "\nauth\n";

check('the wrong password is refused', api('POST', '/api/auth/login', [
    'json' => ['password' => 'hunter2'],
    'ip' => '198.51.100.1',
])->status, 403);

check('an empty password is refused', api('POST', '/api/auth/login', [
    'json' => ['password' => ''],
    'ip' => '198.51.100.2',
])->status, 403);

$login = api('POST', '/api/auth/login', ['json' => ['password' => TEST_PASSWORD, 'label' => 'laptop']]);
check('the right password is accepted', $login->status, 201);
$token = $login->decoded()['token'] ?? '';
checkThat('and hands back a token', strlen($token) > 30);
checkThat('with an expiry in the future', ($login->decoded()['expiresAt'] ?? 0) > time());

$who = api('GET', '/api/auth/whoami', ['token' => $token]);
check('the token identifies itself', $who->status, 200);
check('and remembers its label', $who->decoded()['label'], 'laptop');

// A token is only ever stored as a hash, so the database being copied
// somewhere is not the same as the credential being copied somewhere.
$hashes = reg_db()->query('SELECT token_hash FROM tokens')->fetchAll(PDO::FETCH_COLUMN);
checkThat('the plaintext token is never stored', !in_array($token, $hashes, true));
checkThat('only its hash is', in_array(hash('sha256', $token), $hashes, true));

// The login limiter must not charge a correct password, or using your own
// registry normally would eventually lock you out of it.
foreach (range(1, 3) as $attempt) {
    api('POST', '/api/auth/login', ['json' => ['password' => 'wrong'], 'ip' => '198.51.100.9']);
}
check('a guessing attack runs out of attempts', api('POST', '/api/auth/login', [
    'json' => ['password' => 'wrong'],
    'ip' => '198.51.100.9',
])->errorCode(), 'rate_limited');
check('even with the right password, once the budget is spent', api('POST', '/api/auth/login', [
    'json' => ['password' => TEST_PASSWORD],
    'ip' => '198.51.100.9',
])->status, 429);
check('a different caller has its own budget', api('POST', '/api/auth/login', [
    'json' => ['password' => TEST_PASSWORD],
    'ip' => '198.51.100.20',
])->status, 201);

// --- repos ---------------------------------------------------------------
echo "\nrepos\n";

check('there are no repos to start with', api('GET', '/api/repos', ['token' => $token])->decoded()['repos'], []);

$created = api('POST', '/api/repos', [
    'token' => $token,
    'json' => ['name' => 'beagle-cli', 'description' => 'The beagle command line tool'],
]);
check('a repo can be created', $created->status, 201);
check('and comes back described', $created->decoded()['repo']['description'], 'The beagle command line tool');
check('with no versions yet', $created->decoded()['repo']['versionCount'], 0);
check('and no latest release', $created->decoded()['repo']['latest'], null);

check('the same name twice is a conflict', api('POST', '/api/repos', [
    'token' => $token,
    'json' => ['name' => 'beagle-cli'],
])->status, 409);

foreach (['Beagle', 'has spaces', '../etc', '-leading-dash', ''] as $bad) {
    check(
        'a name like "' . $bad . '" is refused',
        api('POST', '/api/repos', ['token' => $token, 'json' => ['name' => $bad]])->errorCode(),
        'bad_name'
    );
}

check('an unknown repo is a 404', api('GET', '/api/repos/nope', ['token' => $token])->errorCode(), 'no_repo');
check('the listing shows it', count(api('GET', '/api/repos', ['token' => $token])->decoded()['repos']), 1);

// --- uploading -----------------------------------------------------------
echo "\nuploading\n";

$body = str_repeat('beagle', 100);
$upload = api('POST', '/api/repos/beagle-cli/versions/1.0.0/artifacts', [
    'token' => $token,
    'file' => upload_file('beagle-1.0.0-linux', $body),
    'post' => ['platform' => 'linux-x64', 'notes' => 'First release'],
]);
check('an artifact uploads', $upload->status, 201);
check('under the platform it was given', $upload->decoded()['platform'], 'linux-x64');
check('with its size', $upload->decoded()['size'], strlen($body));
check('and a checksum of what landed', $upload->decoded()['sha256'], hash('sha256', $body));
check('nothing was replaced', $upload->decoded()['replaced'], false);

// The version did not exist before this upload: an empty release is not
// something a client could be handed, so one is created by its first artifact.
$show = api('GET', '/api/repos/beagle-cli', ['token' => $token]);
check('the version now exists', count($show->decoded()['versions']), 1);
check('carrying the notes from the upload', $show->decoded()['versions'][0]['notes'], 'First release');
check('and the repo counts it', $show->decoded()['repo']['versionCount'], 1);
check('and calls it the latest', $show->decoded()['repo']['latest'], '1.0.0');

$second = api('POST', '/api/repos/beagle-cli/versions/1.0.0/artifacts', [
    'token' => $token,
    'file' => upload_file('beagle-1.0.0-win.exe', 'windows build'),
    'post' => ['platform' => 'windows'],
]);
check('a second platform joins the same version', $second->status, 201);
check(
    'and the version now carries both',
    count(api('GET', '/api/repos/beagle-cli/versions/1.0.0', ['token' => $token])
        ->decoded()['version']['artifacts']),
    2
);

$replace = api('POST', '/api/repos/beagle-cli/versions/1.0.0/artifacts', [
    'token' => $token,
    'file' => upload_file('beagle-1.0.0-win.exe', 'windows build, fixed'),
    'post' => ['platform' => 'windows'],
]);
check('re-uploading a platform replaces it', $replace->decoded()['replaced'], true);
check('rather than adding a third', count(
    api('GET', '/api/repos/beagle-cli/versions/1.0.0', ['token' => $token])->decoded()['version']['artifacts']
), 2);

check('a version that is not semver is refused', api('POST', '/api/repos/beagle-cli/versions/nightly/artifacts', [
    'token' => $token,
    'file' => upload_file('x', 'x'),
])->errorCode(), 'bad_version');

check('"latest" cannot be uploaded to', api('POST', '/api/repos/beagle-cli/versions/latest/artifacts', [
    'token' => $token,
    'file' => upload_file('x', 'x'),
])->errorCode(), 'bad_version');

check('an upload with no file is refused', api('POST', '/api/repos/beagle-cli/versions/1.1.0/artifacts', [
    'token' => $token,
])->errorCode(), 'no_file');

check('an empty file is refused', api('POST', '/api/repos/beagle-cli/versions/1.1.0/artifacts', [
    'token' => $token,
    'file' => upload_file('empty', ''),
])->errorCode(), 'empty_file');

check('a file over the ceiling is refused', api('POST', '/api/repos/beagle-cli/versions/1.1.0/artifacts', [
    'token' => $token,
    'file' => upload_file('big', str_repeat('x', 5000)),
])->errorCode(), 'too_large');

// A request truncated by post_max_size arrives with no $_POST and no $_FILES,
// so without this check it would be reported as a missing file — sending the
// operator to look for a bug in their client instead of at their php.ini.
check('a truncated upload says so', api('POST', '/api/repos/beagle-cli/versions/1.1.0/artifacts', [
    'token' => $token,
    'truncated' => true,
])->errorCode(), 'too_large');

check('a bad platform name is refused', api('POST', '/api/repos/beagle-cli/versions/1.1.0/artifacts', [
    'token' => $token,
    'file' => upload_file('x', 'x'),
    'post' => ['platform' => '../etc'],
])->errorCode(), 'bad_platform');

checkThat(
    'a failed upload leaves no version behind',
    api('GET', '/api/repos/beagle-cli/versions/1.1.0', ['token' => $token])->status === 404
);

// --- latest --------------------------------------------------------------
// The endpoint an auto-updater actually calls, and the one whose behaviour has
// to be exactly right: a client that is handed a prerelease it did not ask for
// is a client that ships a beta to everyone.
echo "\nlatest\n";

api('POST', '/api/repos/beagle-cli/versions/1.2.0/artifacts', [
    'token' => $token,
    'file' => upload_file('beagle-1.2.0', 'newer'),
    'post' => ['platform' => 'linux-x64'],
]);
api('POST', '/api/repos/beagle-cli/versions/2.0.0-rc.1/artifacts', [
    'token' => $token,
    'file' => upload_file('beagle-2.0.0-rc1', 'candidate'),
    'post' => ['platform' => 'linux-x64'],
]);

$latest = api('GET', '/api/repos/beagle-cli/versions/latest', ['token' => $token]);
check('latest resolves to the newest release', $latest->decoded()['version']['version'], '1.2.0');
check('and skips the prerelease', $latest->decoded()['version']['prerelease'], false);

$latestPre = api('GET', '/api/repos/beagle-cli/versions/latest', [
    'token' => $token,
    'query' => ['prerelease' => '1'],
]);
check('unless the client opts in', $latestPre->decoded()['version']['version'], '2.0.0-rc.1');

$summary = repo_summary($token, 'beagle-cli');
check('the listing agrees on latest', $summary['latest'], '1.2.0');
check('and reports the staged release separately', $summary['latestPrerelease'], '2.0.0-rc.1');

check('versions come back newest first', array_column(
    api('GET', '/api/repos/beagle-cli/versions', ['token' => $token])->decoded()['versions'],
    'version'
), ['2.0.0-rc.1', '1.2.0', '1.0.0']);

check('a version that was never released is a 404', api('GET', '/api/repos/beagle-cli/versions/9.9.9', [
    'token' => $token,
])->errorCode(), 'no_version');

check('a nonsense version is a 400, not a 404', api('GET', '/api/repos/beagle-cli/versions/banana', [
    'token' => $token,
])->errorCode(), 'bad_version');

// --- downloading ---------------------------------------------------------
echo "\ndownloading\n";

$download = api('GET', '/api/repos/beagle-cli/versions/1.2.0/download', [
    'token' => $token,
    'query' => ['platform' => 'linux-x64'],
]);
check('an artifact downloads', $download->status, 200);
checkThat('as a stream, not a string in memory', $download->streamPath !== null);
check('with the right bytes', file_get_contents((string) $download->streamPath), 'newer');
check('the checksum rides along', $download->headers['X-Checksum-SHA256'], hash('sha256', 'newer'));

// An update server hands out executables. Nothing it stores should ever be
// rendered by a browser on the domain that served it.
check('always as a download', $download->headers['Content-Type'], 'application/octet-stream');
checkThat(
    'never as something to render',
    str_contains($download->headers['Content-Disposition'], 'attachment')
);

$onlyOne = api('GET', '/api/repos/beagle-cli/versions/1.2.0/download', ['token' => $token]);
check('a single-build version needs no platform', $onlyOne->status, 200);

$ambiguous = api('GET', '/api/repos/beagle-cli/versions/1.0.0/download', ['token' => $token]);
check('but a multi-build one does', $ambiguous->errorCode(), 'ambiguous_platform');
check('and says which are on offer', $ambiguous->decoded()['error']['platforms'], ['linux-x64', 'windows']);

$missing = api('GET', '/api/repos/beagle-cli/versions/1.2.0/download', [
    'token' => $token,
    'query' => ['platform' => 'solaris'],
]);
check('an unbuilt platform is a 404', $missing->errorCode(), 'no_artifact');
check('listing what does exist', $missing->decoded()['error']['platforms'], ['linux-x64']);

$byLatest = api('GET', '/api/repos/beagle-cli/versions/latest/download', ['token' => $token]);
check('latest can be downloaded directly', file_get_contents((string) $byLatest->streamPath), 'newer');

$meta = api('GET', '/api/repos/beagle-cli/versions/1.2.0/artifacts/linux-x64', ['token' => $token]);
check('an artifact can be described without fetching it', $meta->status, 200);
check('and that response carries no bytes', $meta->streamPath, null);
check('just the filename', $meta->decoded()['artifact']['filename'], 'beagle-1.2.0');

check('downloading still needs a token', api('GET', '/api/repos/beagle-cli/versions/1.2.0/download')->status, 401);

// --- removing ------------------------------------------------------------
echo "\nremoving\n";

$blobBefore = reg_artifact_path(
    reg_repo_find('beagle-cli')['id'],
    reg_version_find(reg_repo_find('beagle-cli')['id'], '1.0.0')['id'],
    reg_artifact_find(reg_version_find(reg_repo_find('beagle-cli')['id'], '1.0.0')['id'], 'windows')['id']
);
checkThat('the artifact is on disk', is_file($blobBefore));

check('one platform can be removed', api('DELETE', '/api/repos/beagle-cli/versions/1.0.0/artifacts/windows', [
    'token' => $token,
])->status, 200);
checkThat('and its bytes go with it', !is_file($blobBefore));
check('leaving the other one', count(
    api('GET', '/api/repos/beagle-cli/versions/1.0.0', ['token' => $token])->decoded()['version']['artifacts']
), 1);
check('removing it twice is a 404', api('DELETE', '/api/repos/beagle-cli/versions/1.0.0/artifacts/windows', [
    'token' => $token,
])->errorCode(), 'no_artifact');

// Removing the last artifact takes the version too: a version with no files is
// not something a client can be handed, so leaving one would make the listing
// claim a release that cannot be downloaded.
check('removing the last artifact removes the version', api(
    'DELETE',
    '/api/repos/beagle-cli/versions/1.0.0/artifacts/linux-x64',
    ['token' => $token]
)->status, 200);
check('so the version is gone', api('GET', '/api/repos/beagle-cli/versions/1.0.0', [
    'token' => $token,
])->errorCode(), 'no_version');

$versionDir = reg_blob_dir(
    reg_repo_find('beagle-cli')['id'],
    reg_version_find(reg_repo_find('beagle-cli')['id'], '1.2.0')['id']
);
check('a whole version can be removed', api('DELETE', '/api/repos/beagle-cli/versions/1.2.0', [
    'token' => $token,
])->status, 200);
checkThat('taking its directory with it', !is_dir($versionDir));
check('and latest falls back to what is left', repo_summary($token, 'beagle-cli')['latest'], null);

// A prerelease is not what `latest` means, but it is still deletable by name —
// otherwise a staged release could never be withdrawn.
check('a prerelease can still be removed by name', api('DELETE', '/api/repos/beagle-cli/versions/2.0.0-rc.1', [
    'token' => $token,
])->status, 200);

// --- the kill switch -----------------------------------------------------
// Reads keep working, writes stop. The point is to freeze releases without
// taking every client that polls this server offline.
echo "\nread-only mode\n";

api('POST', '/api/repos', ['token' => $token, 'json' => ['name' => 'frozen']]);
api('POST', '/api/repos/frozen/versions/1.0.0/artifacts', [
    'token' => $token,
    'file' => upload_file('frozen', 'bytes'),
]);

$live = reg_config();
$frozen = array_replace($live, ['accepting_writes' => false]);
file_put_contents($configFile, '<?php return ' . var_export($frozen, true) . ';');

// reg_config() memoises, so the running process cannot be made to re-read the
// file. A fresh PHP process is the honest way to test what a real request with
// the switch thrown would do.
$script = <<<'SCRIPT'
    putenv('REGISTRY_CONFIG=' . $argv[1]);
    require $argv[2];
    $token = $argv[3];
    $results = [
        'download' => reg_handle(new RegRequest(
            method: 'GET',
            path: '/api/repos/frozen/versions/1.0.0/download',
            headers: ['authorization' => 'Bearer ' . $token],
        ))->status,
        'create' => reg_handle(new RegRequest(
            method: 'POST',
            path: '/api/repos',
            headers: ['authorization' => 'Bearer ' . $token],
            body: json_encode(['name' => 'nope']),
        ))->errorCode(),
        'delete' => reg_handle(new RegRequest(
            method: 'DELETE',
            path: '/api/repos/frozen',
            headers: ['authorization' => 'Bearer ' . $token],
        ))->errorCode(),
        'list' => reg_handle(new RegRequest(
            method: 'GET',
            path: '/api/repos',
            headers: ['authorization' => 'Bearer ' . $token],
        ))->status,
    ];
    echo json_encode($results);
SCRIPT;

// exec() appends rather than replaces, so this needs an array of its own —
// sharing one with the syntax loop above would prepend its last line to the
// JSON below and decode to nothing.
$readOnlyOutput = [];
exec(
    escapeshellarg(PHP_BINARY) . ' -r ' . escapeshellarg($script) . ' '
    . escapeshellarg($configFile) . ' '
    . escapeshellarg(__DIR__ . '/../api/lib/router.php') . ' '
    . escapeshellarg($token) . ' 2>&1',
    $readOnlyOutput
);
$readOnly = json_decode(implode('', $readOnlyOutput), true) ?: [];

check('downloads keep working', $readOnly['download'] ?? null, 200);
check('the listing keeps working', $readOnly['list'] ?? null, 200);
check('creating a repo is refused', $readOnly['create'] ?? null, 'read_only');
check('deleting is refused', $readOnly['delete'] ?? null, 'read_only');

file_put_contents($configFile, '<?php return ' . var_export($live, true) . ';');

// --- tokens --------------------------------------------------------------
echo "\ntokens\n";

$tokens = api('GET', '/api/auth/tokens', ['token' => $token]);
checkThat('live tokens can be listed', count($tokens->decoded()['tokens']) >= 1);
checkThat('without leaking any hashes', !str_contains($tokens->body, 'token_hash'));
check('and the caller knows which one is theirs', $tokens->decoded()['you'], $who->decoded()['tokenId']);

$other = api('POST', '/api/auth/login', [
    'json' => ['password' => TEST_PASSWORD, 'label' => 'ci'],
    'ip' => '198.51.100.30',
])->decoded()['token'];
checkThat('a second token works', api('GET', '/api/repos', ['token' => $other])->status === 200);

$otherId = api('GET', '/api/auth/whoami', ['token' => $other])->decoded()['tokenId'];
check('one token can revoke another', api('DELETE', '/api/auth/tokens/' . $otherId, [
    'token' => $token,
])->status, 200);
check('and the revoked one stops working', api('GET', '/api/repos', ['token' => $other])->status, 401);

check('logging out revokes your own', api('POST', '/api/auth/logout', ['token' => $token])->status, 200);
check('which takes effect immediately', api('GET', '/api/repos', ['token' => $token])->status, 401);

// An expired token is refused by the same path as an unknown one, and the
// sweeper is what stops the table growing forever.
$expiring = reg_issue_token('short lived', 1);
reg_db()->prepare('UPDATE tokens SET expires_at = ? WHERE id = ?')
    ->execute([time() - 1, $expiring['id']]);
check('an expired token does not authenticate', api('GET', '/api/repos', [
    'token' => $expiring['token'],
])->status, 401);

// Every request sweeps a few expired tokens on its way past, so by now the
// request above has already cleared this one — which is the point: culling
// stays correct on a host where the cron job was never set up.
$left = reg_db()->prepare('SELECT COUNT(*) FROM tokens WHERE id = ?');
$left->execute([$expiring['id']]);
check('and ordinary traffic sweeps it away', (int) $left->fetchColumn(), 0);

$stale = reg_issue_token('also short lived', 1);
reg_db()->prepare('UPDATE tokens SET expires_at = ? WHERE id = ?')->execute([time() - 1, $stale['id']]);
checkThat('as does the cron sweeper', reg_sweep_tokens() >= 1);

// --- named tokens --------------------------------------------------------
// The kind a CI job or a shipped auto-updater carries: labelled, with a
// lifetime of its own, revocable without disturbing anybody's session.
echo "\nnamed tokens\n";

$token = api('POST', '/api/auth/login', [
    'json' => ['password' => TEST_PASSWORD],
    'ip' => '198.51.100.41',
])->decoded()['token'];

$named = api('POST', '/api/auth/tokens', [
    'token' => $token,
    'json' => ['label' => 'github actions', 'days' => 90],
]);
check('a named token can be minted', $named->status, 201);
check('it says what it is', $named->decoded()['kind'], 'named');
check('and carries its label', $named->decoded()['label'], 'github actions');
checkThat('with an expiry about 90 days out', abs(
    $named->decoded()['expiresAt'] - (time() + 90 * 86400)
) < 10);
check('and is not marked as never expiring', $named->decoded()['neverExpires'], false);
checkThat('it actually works', api('GET', '/api/repos', [
    'token' => $named->decoded()['token'],
])->status === 200);

$forever = api('POST', '/api/auth/tokens', [
    'token' => $token,
    'json' => ['label' => 'beagle-cli updater', 'days' => 0],
]);
check('a token can be minted that never expires', $forever->status, 201);
check('which it says plainly', $forever->decoded()['neverExpires'], true);
check('rather than as a date', $forever->decoded()['expiresAt'], 0);

$foreverToken = $forever->decoded()['token'];
check('it authenticates', api('GET', '/api/repos', ['token' => $foreverToken])->status, 200);

// The trap this whole feature walks into: `expires_at` of 0 is the sentinel
// for "never", and every query that filters on expiry reads it as "expired in
// 1970" unless told otherwise. Getting this wrong deletes every shipped
// updater's credential on the next request.
reg_sweep_tokens();
check('the sweeper does not take it', api('GET', '/api/repos', ['token' => $foreverToken])->status, 200);
reg_sweep_tokens(5);
check('nor does the per-request sweep', api('GET', '/api/repos', ['token' => $foreverToken])->status, 200);
checkThat('and it is still in the listing', in_array(
    'beagle-cli updater',
    array_column(api('GET', '/api/auth/tokens', ['token' => $token])->decoded()['tokens'], 'label'),
    true
));

// Meanwhile an ordinary expired token still goes.
$doomed = reg_issue_token('doomed', 60, 'named');
reg_db()->prepare('UPDATE tokens SET expires_at = ? WHERE id = ?')
    ->execute([time() - 1, $doomed['id']]);
checkThat('an expired named token is still swept', reg_sweep_tokens() >= 1);
check('and stops working', api('GET', '/api/repos', ['token' => $doomed['token']])->status, 401);

// Revoking one must not touch the others: that is the whole reason for
// minting a token per consumer rather than sharing one.
$namedId = $named->decoded()['tokenId'];
check('a named token can be revoked on its own', api('DELETE', '/api/auth/tokens/' . $namedId, [
    'token' => $token,
])->status, 200);
check('it stops working', api('GET', '/api/repos', ['token' => $named->decoded()['token']])->status, 401);
check('and the others are untouched', api('GET', '/api/repos', ['token' => $foreverToken])->status, 200);

$listed = api('GET', '/api/auth/tokens', ['token' => $token])->decoded()['tokens'];
$byLabel = array_column($listed, 'kind', 'label');
check('a login token describes itself as a session', $byLabel[''] ?? null, 'session');
check('and a minted one as named', $byLabel['beagle-cli updater'] ?? null, 'named');

check('a token with no label is refused', api('POST', '/api/auth/tokens', [
    'token' => $token,
    'json' => ['days' => 30],
])->errorCode(), 'no_label');
check('as is a blank one', api('POST', '/api/auth/tokens', [
    'token' => $token,
    'json' => ['label' => '   ', 'days' => 30],
])->errorCode(), 'no_label');

// No default lifetime: "how long should this live" is exactly the decision
// that should not be made silently on the caller's behalf.
check('a lifetime must be given', api('POST', '/api/auth/tokens', [
    'token' => $token,
    'json' => ['label' => 'ci'],
])->errorCode(), 'no_lifetime');
check('a negative lifetime is refused', api('POST', '/api/auth/tokens', [
    'token' => $token,
    'json' => ['label' => 'ci', 'days' => -1],
])->errorCode(), 'bad_lifetime');
check('an absurd one is refused', api('POST', '/api/auth/tokens', [
    'token' => $token,
    'json' => ['label' => 'ci', 'days' => 100000],
])->errorCode(), 'bad_lifetime');
check('and so is a non-number', api('POST', '/api/auth/tokens', [
    'token' => $token,
    'json' => ['label' => 'ci', 'days' => 'forever'],
])->errorCode(), 'bad_lifetime');

check('minting needs a token of your own', api('POST', '/api/auth/tokens', [
    'json' => ['label' => 'ci', 'days' => 30],
])->status, 401);

// --- routing -------------------------------------------------------------
echo "\nrouting\n";

$token = api('POST', '/api/auth/login', [
    'json' => ['password' => TEST_PASSWORD],
    'ip' => '198.51.100.40',
])->decoded()['token'];

check('the /api prefix is optional', api('GET', '/repos', ['token' => $token])->status, 200);
check('as is a trailing slash', api('GET', '/api/repos/', ['token' => $token])->status, 200);
check('an unknown path is a 404', api('GET', '/api/nowhere', ['token' => $token])->errorCode(), 'not_found');
check('a wrong method is a 405', api('POST', '/api/repos/frozen', ['token' => $token])->errorCode(), 'method_not_allowed');
check('OPTIONS is answered for preflight', api('OPTIONS', '/api/repos')->status, 204);

// A path that resolves out of the repo root must not become a filesystem path.
check('a traversal attempt is refused', api('GET', '/api/repos/..%2F..%2Fetc', [
    'token' => $token,
])->errorCode(), 'bad_name');

// --- orphan sweeping -----------------------------------------------------
// Rows and bytes are two records of the same thing, and a crash between the
// deletes leaves the bytes invisible and permanent without this.
echo "\nhousekeeping\n";

$orphan = reg_data_dir() . '/blobs/11111111-2222-4333-8444-555555555555/99999999-2222-4333-8444-555555555555';
mkdir($orphan, 0700, true);
file_put_contents($orphan . '/stray', 'bytes');
checkThat('orphan directories are found', reg_sweep_orphans() >= 1);
checkThat('and really are gone', !is_dir($orphan));

$repoId = reg_repo_find('frozen')['id'];
checkThat('a live repo is left alone', is_dir(reg_data_dir() . '/blobs/' . $repoId));

check('deleting a repo takes everything', api('DELETE', '/api/repos/frozen', ['token' => $token])->status, 200);
checkThat('including its files', !is_dir(reg_data_dir() . '/blobs/' . $repoId));
check('and its versions', (int) reg_db()->query('SELECT COUNT(*) FROM versions')->fetchColumn(), 0);
check('and its artifacts', (int) reg_db()->query('SELECT COUNT(*) FROM artifacts')->fetchColumn(), 0);

// --- the data directory guard --------------------------------------------
echo "\nconfiguration\n";

$caught = false;
try {
    reg_assert_data_dir_outside('/home/x/public_html/.data', '/home/x/public_html');
} catch (RuntimeException $error) {
    $caught = true;
}
checkThat('a data directory inside the document root is refused', $caught);

$allowed = true;
try {
    reg_assert_data_dir_outside('/home/x/registry_data', '/home/x/public_html');
} catch (RuntimeException $error) {
    $allowed = false;
}
checkThat('one beside it is fine', $allowed);

$sibling = true;
try {
    // A sibling whose name merely starts with the document root's must not trip
    // the prefix check.
    reg_assert_data_dir_outside('/home/x/public_html_data', '/home/x/public_html');
} catch (RuntimeException $error) {
    $sibling = false;
}
checkThat('a sibling with a similar name is not mistaken for a child', $sibling);

// --- teardown ------------------------------------------------------------
reg_rmtree($temp);

echo "\n$passed passed, $failed failed\n";
exit($failed === 0 ? 0 : 1);
