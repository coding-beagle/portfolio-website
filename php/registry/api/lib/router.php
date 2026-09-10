<?php
/**
 * Every route, as one pure function.
 *
 * `reg_handle()` takes a RegRequest and returns a RegResponse. It reads no
 * superglobals, sends no headers and never exits, which is what lets the test
 * suite drive the entire API — routing, auth, validation, uploads, downloads —
 * in-process against a temporary database, with no server running.
 *
 * The full endpoint reference is in php/registry/README.md.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/http.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/limits.php';
require_once __DIR__ . '/repos.php';
require_once __DIR__ . '/semver.php';

function reg_handle(RegRequest $request): RegResponse
{
    // Every request clears a few expired tokens on its way past, so culling
    // stays correct even where the cron job was never set up. A failure here is
    // housekeeping, not the caller's problem, so it is logged and swallowed.
    try {
        reg_sweep_tokens((int) reg_config()['sweep_per_request']);
    } catch (Throwable $error) {
        error_log('[registry] token sweep failed: ' . $error->getMessage());
    }

    $path = reg_route_path($request->path);

    if ($request->method === 'OPTIONS') {
        return new RegResponse(204, ['Allow' => 'GET, POST, DELETE, OPTIONS']);
    }

    // The only endpoint that answers without a token: a monitor has to be able
    // to tell "up" from "down" without holding a credential.
    if ($path === '/health' && $request->method === 'GET') {
        return reg_route_health();
    }

    if ($path === '/auth/login' && $request->method === 'POST') {
        return reg_route_login($request);
    }

    // ---- everything past here needs a token ----
    $auth = reg_authenticate($request->bearer());
    if ($auth === null) {
        return RegResponse::error(401, 'unauthorised', 'A valid token is required. Run `nt auth login`.');
    }

    return reg_route_authenticated($request, $path, $auth);
}

/** The routes that a caller has already been authenticated for. */
function reg_route_authenticated(RegRequest $request, string $path, array $auth): RegResponse
{
    $method = $request->method;

    if ($path === '/auth/whoami' && $method === 'GET') {
        return RegResponse::json(200, [
            'ok' => true,
            'tokenId' => $auth['id'],
            'label' => $auth['label'],
            'expiresAt' => (int) $auth['expires_at'],
        ]);
    }

    if ($path === '/auth/logout' && $method === 'POST') {
        reg_revoke_token((string) $request->bearer());
        return RegResponse::json(200, ['revoked' => true]);
    }

    if ($path === '/auth/tokens' && $method === 'GET') {
        return RegResponse::json(200, ['tokens' => reg_list_tokens(), 'you' => $auth['id']]);
    }

    if ($path === '/auth/tokens' && $method === 'DELETE') {
        return RegResponse::json(200, ['revoked' => reg_revoke_all_tokens()]);
    }

    if (preg_match('#^/auth/tokens/([0-9a-f-]{36})$#', $path, $m) === 1 && $method === 'DELETE') {
        if (!reg_revoke_token_id($m[1])) {
            return RegResponse::error(404, 'no_token', 'No such token.');
        }
        return RegResponse::json(200, ['revoked' => true]);
    }

    if ($path === '/repos' && $method === 'GET') {
        return RegResponse::json(200, ['repos' => reg_repo_list()]);
    }

    if ($path === '/repos' && $method === 'POST') {
        return reg_route_repo_create($request);
    }

    if (preg_match('#^/repos/([^/]+)$#', $path, $m) === 1) {
        return match ($method) {
            'GET' => reg_route_repo_show(reg_segment($m[1])),
            'DELETE' => reg_route_repo_delete(reg_segment($m[1])),
            default => reg_method_not_allowed(),
        };
    }

    if (preg_match('#^/repos/([^/]+)/versions$#', $path, $m) === 1 && $method === 'GET') {
        return reg_route_versions(reg_segment($m[1]));
    }

    if (preg_match('#^/repos/([^/]+)/versions/([^/]+)$#', $path, $m) === 1) {
        return match ($method) {
            'GET' => reg_route_version_show($request, reg_segment($m[1]), reg_segment($m[2])),
            'DELETE' => reg_route_version_delete(reg_segment($m[1]), reg_segment($m[2])),
            default => reg_method_not_allowed(),
        };
    }

    if (preg_match('#^/repos/([^/]+)/versions/([^/]+)/artifacts$#', $path, $m) === 1 && $method === 'POST') {
        return reg_route_upload($request, reg_segment($m[1]), reg_segment($m[2]));
    }

    if (preg_match('#^/repos/([^/]+)/versions/([^/]+)/download$#', $path, $m) === 1 && $method === 'GET') {
        return reg_route_download($request, reg_segment($m[1]), reg_segment($m[2]), $request->query('platform'));
    }

    if (preg_match('#^/repos/([^/]+)/versions/([^/]+)/artifacts/([^/]+)$#', $path, $m) === 1) {
        return match ($method) {
            'GET' => reg_route_download($request, reg_segment($m[1]), reg_segment($m[2]), reg_segment($m[3])),
            'DELETE' => reg_route_artifact_delete(reg_segment($m[1]), reg_segment($m[2]), reg_segment($m[3])),
            default => reg_method_not_allowed(),
        };
    }

    return RegResponse::error(404, 'not_found', 'No such endpoint.');
}

/**
 * The path with the query string and the /api mount point taken off.
 *
 * Deliberately NOT percent-decoded here. Decoding before matching would let an
 * encoded slash invent path segments — `..%2F..%2Fetc` would arrive as a
 * traversal that matches no route and reads as a 404, rather than as one
 * segment that fails the name check with a clear answer. Segments are decoded
 * individually by reg_segment() once the route is known.
 */
function reg_route_path(string $raw): string
{
    $path = parse_url($raw, PHP_URL_PATH) ?: '/';
    $path = '/' . trim($path, '/');
    if ($path === '/api' || strncmp($path, '/api/', 5) === 0) {
        $path = substr($path, 4);
    }
    return $path === '' ? '/' : $path;
}

/** One captured path segment, decoded. Never contains a slash. */
function reg_segment(string $raw): string
{
    return str_replace('/', '', rawurldecode($raw));
}

function reg_method_not_allowed(): RegResponse
{
    return RegResponse::error(405, 'method_not_allowed', 'That method is not allowed here.');
}

// --- health and auth -----------------------------------------------------

function reg_route_health(): RegResponse
{
    $config = reg_config();

    // Deliberately says nothing about what is stored: this is the one endpoint
    // reachable without a token, and an unauthenticated caller learning repo
    // names or sizes would undo the point of gating the rest.
    return RegResponse::json(200, [
        'ok' => true,
        'acceptingWrites' => (bool) $config['accepting_writes'],
        'authConfigured' => reg_auth_configured(),
        // What the *web server* will actually take, which is usually smaller
        // than max_artifact_bytes and is the limit that bites first.
        'uploadCeiling' => min(reg_bytes_ini('upload_max_filesize'), reg_bytes_ini('post_max_size')),
        'maxArtifactBytes' => (int) $config['max_artifact_bytes'],
    ]);
}

function reg_route_login(RegRequest $request): RegResponse
{
    if (!reg_auth_configured()) {
        return RegResponse::error(
            503,
            'not_configured',
            'No password is set on this server, so nothing can log in. '
            . 'Set admin_password_hash in the config file.'
        );
    }

    // Checked before verifying, so a guessing attack cannot make the server
    // burn password-hashing time on its behalf — but only charged for below, on
    // a wrong password. Logging in correctly should never lock you out of your
    // own registry, which spending the budget on every attempt would do.
    if (reg_rate_exceeded($request->ip, 'login')) {
        return RegResponse::error(429, 'rate_limited', 'Too many login attempts. Try again later.');
    }

    if (!reg_auth_hash_looks_valid()) {
        error_log(
            '[registry] admin_password_hash is not a password hash. Generate one with '
            . 'password_hash($password, PASSWORD_DEFAULT) and store that instead.'
        );
    }

    $body = $request->json();
    $password = (string) ($body['password'] ?? '');
    $label = substr((string) ($body['label'] ?? ''), 0, 100);

    $issued = $password === '' ? null : reg_login($password, $label);
    if ($issued === null) {
        reg_rate_consume($request->ip, 'login');
        return RegResponse::error(403, 'bad_password', 'That password was not recognised.');
    }

    return RegResponse::json(201, [
        'token' => $issued['token'],
        'tokenId' => $issued['id'],
        'expiresAt' => $issued['expires_at'],
    ]);
}

// --- repos ---------------------------------------------------------------

/**
 * Resolves a repo name to its row.
 *
 * @return array{repo:array}|array{error:RegResponse}
 */
function reg_lookup_repo(string $name): array
{
    if (!reg_valid_repo_name($name)) {
        return ['error' => RegResponse::error(
            400,
            'bad_name',
            'Repository names are lower case letters, digits, dot, dash and underscore, '
            . 'up to 64 characters, and must start with a letter or digit.'
        )];
    }

    $repo = reg_repo_find($name);
    if ($repo === null) {
        return ['error' => RegResponse::error(404, 'no_repo', 'No repository called "' . $name . '".')];
    }
    return ['repo' => $repo];
}

/** The kill switch, checked on every route that changes anything. */
function reg_writes_blocked(): ?RegResponse
{
    if (reg_config()['accepting_writes']) {
        return null;
    }
    return RegResponse::error(
        503,
        'read_only',
        'This registry is in read-only mode. Existing releases still download.'
    );
}

function reg_route_repo_create(RegRequest $request): RegResponse
{
    if ($blocked = reg_writes_blocked()) {
        return $blocked;
    }

    $body = $request->json();

    // Trimmed but never case-folded. Lower-casing here would accept "Beagle",
    // store "beagle", and then 404 every later request for "Beagle" — the
    // lookup path does not fold case either, and a name you cannot address is
    // worse than a name you were told to retype.
    $name = trim((string) ($body['name'] ?? ''));
    $description = (string) ($body['description'] ?? '');

    if (!reg_valid_repo_name($name)) {
        return RegResponse::error(
            400,
            'bad_name',
            'Repository names are lower case letters, digits, dot, dash and underscore, '
            . 'up to 64 characters, and must start with a letter or digit.'
        );
    }

    $created = reg_repo_create($name, $description);
    if ($created === null) {
        return RegResponse::error(409, 'exists', 'There is already a repository called "' . $name . '".');
    }

    return RegResponse::json(201, ['repo' => reg_repo_summary(reg_repo_find($name))]);
}

function reg_route_repo_show(string $name): RegResponse
{
    $found = reg_lookup_repo($name);
    if (isset($found['error'])) {
        return $found['error'];
    }

    return RegResponse::json(200, [
        'repo' => reg_repo_summary($found['repo']),
        'versions' => array_map(reg_version_view(...), reg_version_list($found['repo']['id'])),
    ]);
}

function reg_route_repo_delete(string $name): RegResponse
{
    if ($blocked = reg_writes_blocked()) {
        return $blocked;
    }
    $found = reg_lookup_repo($name);
    if (isset($found['error'])) {
        return $found['error'];
    }

    reg_repo_delete($name);
    return RegResponse::json(200, ['deleted' => true]);
}

// --- versions ------------------------------------------------------------

function reg_route_versions(string $name): RegResponse
{
    $found = reg_lookup_repo($name);
    if (isset($found['error'])) {
        return $found['error'];
    }

    return RegResponse::json(200, [
        'repo' => $found['repo']['name'],
        'versions' => array_map(reg_version_view(...), reg_version_list($found['repo']['id'])),
    ]);
}

/**
 * Resolves a repo and a version spec together, since every version route needs
 * both and every one of them can fail in the same three ways.
 *
 * @return array{repo:array,version:array}|array{error:RegResponse}
 */
function reg_lookup_version(string $name, string $spec, bool $includePrerelease = false): array
{
    $found = reg_lookup_repo($name);
    if (isset($found['error'])) {
        return $found;
    }
    $repo = $found['repo'];

    $isLatest = strtolower(trim($spec)) === 'latest';
    if (!$isLatest && !reg_semver_valid($spec)) {
        return ['error' => RegResponse::error(
            400,
            'bad_version',
            '"' . $spec . '" is not a semantic version. Expected something like 1.4.2, '
            . '1.4.2-rc.1, or the word "latest".'
        )];
    }

    $version = reg_version_resolve($repo['id'], $spec, $includePrerelease);
    if ($version === null) {
        return ['error' => RegResponse::error(
            404,
            'no_version',
            $isLatest
                ? 'No released version of "' . $name . '" yet.'
                : 'Version ' . $spec . ' is not in "' . $name . '".'
        )];
    }

    return ['repo' => $repo, 'version' => $version];
}

/** `?prerelease=1` opts a client in to staged releases when asking for latest. */
function reg_wants_prerelease(RegRequest $request): bool
{
    return in_array(strtolower($request->query('prerelease')), ['1', 'true', 'yes'], true);
}

function reg_route_version_show(RegRequest $request, string $name, string $spec): RegResponse
{
    $found = reg_lookup_version($name, $spec, reg_wants_prerelease($request));
    if (isset($found['error'])) {
        return $found['error'];
    }

    return RegResponse::json(200, [
        'repo' => $found['repo']['name'],
        'version' => reg_version_view($found['version']),
    ]);
}

function reg_route_version_delete(string $name, string $spec): RegResponse
{
    if ($blocked = reg_writes_blocked()) {
        return $blocked;
    }

    // Prereleases included: deleting is explicit about what it is deleting, and
    // refusing to find a version that is plainly there would be surprising.
    $found = reg_lookup_version($name, $spec, true);
    if (isset($found['error'])) {
        return $found['error'];
    }

    reg_version_delete($found['repo']['id'], $found['version']['version']);
    return RegResponse::json(200, ['deleted' => true, 'version' => $found['version']['version']]);
}

// --- artifacts -----------------------------------------------------------

function reg_route_upload(RegRequest $request, string $name, string $spec): RegResponse
{
    if ($blocked = reg_writes_blocked()) {
        return $blocked;
    }

    // Checked before anything else: a truncated request has no $_POST and no
    // $_FILES, so every other check below would report the wrong problem.
    if ($request->truncated) {
        return RegResponse::error(
            413,
            'too_large',
            'That file is bigger than the web server will accept in one request. '
            . 'Check upload_max_filesize and post_max_size.'
        );
    }

    if (!reg_rate_allow($request->ip, 'upload')) {
        return RegResponse::error(429, 'rate_limited', 'Too many uploads. Try again later.');
    }

    $found = reg_lookup_repo($name);
    if (isset($found['error'])) {
        return $found['error'];
    }
    $repo = $found['repo'];

    if (strtolower(trim($spec)) === 'latest') {
        return RegResponse::error(
            400,
            'bad_version',
            '"latest" is a name for a release, not a release. Upload with the actual version.'
        );
    }
    if (!reg_semver_valid($spec)) {
        return RegResponse::error(
            400,
            'bad_version',
            '"' . $spec . '" is not a semantic version. Expected something like 1.4.2 or 1.4.2-rc.1.'
        );
    }

    $file = $request->files['file'] ?? null;
    if ($file === null) {
        return RegResponse::error(400, 'no_file', 'No file was attached.');
    }

    $platform = strtolower(trim((string) ($request->post['platform'] ?? REG_DEFAULT_PLATFORM)));
    if ($platform === '') {
        $platform = REG_DEFAULT_PLATFORM;
    }
    if (!reg_valid_platform($platform)) {
        return RegResponse::error(
            400,
            'bad_platform',
            'Platform names are lower case letters, digits, dot, dash and underscore, '
            . 'up to 32 characters. For example: linux-x64, windows, macos-arm64.'
        );
    }

    $size = (int) $file['size'];
    if ($size <= 0) {
        return RegResponse::error(400, 'empty_file', 'That file is empty.');
    }

    $maximum = (int) reg_config()['max_artifact_bytes'];
    if ($size > $maximum) {
        return RegResponse::error(
            413,
            'too_large',
            'Artifacts are limited to ' . reg_human($maximum) . ' on this server.'
        );
    }
    if (reg_disk_full()) {
        return RegResponse::error(503, 'no_space', 'This registry is out of room.');
    }

    $ensured = reg_version_ensure($repo['id'], $spec, (string) ($request->post['notes'] ?? ''));
    if ($ensured === null) {
        return RegResponse::error(400, 'bad_version', '"' . $spec . '" is not a semantic version.');
    }

    $stored = reg_artifact_store(
        repo: $repo,
        version: $ensured['row'],
        platform: $platform,
        filename: basename((string) $file['name']),
        sourcePath: (string) $file['path'],
        size: $size,
        contentType: (string) ($file['type'] ?: 'application/octet-stream'),
        uploaded: (bool) $file['uploaded'],
    );

    return RegResponse::json($stored['replaced'] ? 200 : 201, [
        'repo' => $repo['name'],
        'version' => $ensured['row']['version'],
        'platform' => $stored['platform'],
        'replaced' => $stored['replaced'],
        'size' => $stored['size'],
        'sha256' => $stored['sha256'],
    ]);
}

/**
 * Serves an artifact's bytes.
 *
 * `$platform` empty means "whichever one there is", which is what makes
 * `nt repo x pull -v 1.0.0` work for the common single-build release without
 * anyone having to think about platforms at all.
 */
function reg_route_download(RegRequest $request, string $name, string $spec, string $platform): RegResponse
{
    $found = reg_lookup_version($name, $spec, reg_wants_prerelease($request));
    if (isset($found['error'])) {
        return $found['error'];
    }
    ['repo' => $repo, 'version' => $version] = $found;

    $platform = strtolower(trim($platform));

    if ($platform === '') {
        $only = reg_artifact_only($version['id']);
        if ($only === null) {
            return RegResponse::error(404, 'no_artifact', 'That version has no files.');
        }
        if (isset($only['ambiguous'])) {
            return RegResponse::error(
                400,
                'ambiguous_platform',
                'Version ' . $version['version'] . ' has builds for several platforms. '
                . 'Say which one with --platform.',
                ['platforms' => $only['ambiguous']]
            );
        }
        $artifact = $only['row'];
    } else {
        if (!reg_valid_platform($platform)) {
            return RegResponse::error(400, 'bad_platform', 'That is not a valid platform name.');
        }
        $artifact = reg_artifact_find($version['id'], $platform);
        if ($artifact === null) {
            return RegResponse::error(
                404,
                'no_artifact',
                'Version ' . $version['version'] . ' has no "' . $platform . '" build.',
                ['platforms' => array_column(reg_artifact_list($version['id']), 'platform')]
            );
        }
    }

    // A GET on the artifact path without /download returns the metadata; the
    // bytes are only ever served from the download route.
    $wantsBytes = str_ends_with(reg_route_path($request->path), '/download')
        || $request->query('download') !== '';

    if (!$wantsBytes) {
        return RegResponse::json(200, [
            'repo' => $repo['name'],
            'version' => $version['version'],
            'artifact' => reg_artifact_view($artifact),
        ]);
    }

    $path = reg_artifact_path($repo['id'], $version['id'], $artifact['id']);
    if (!is_file($path)) {
        // The row says it is there and the disk disagrees. Worth logging: it
        // means something removed bytes out from under the database.
        error_log('[registry] missing blob for artifact ' . $artifact['id'] . ' at ' . $path);
        return RegResponse::error(404, 'no_artifact', 'That file is no longer on the server.');
    }

    return RegResponse::download($path, $artifact['filename'], $artifact['sha256']);
}

function reg_route_artifact_delete(string $name, string $spec, string $platform): RegResponse
{
    if ($blocked = reg_writes_blocked()) {
        return $blocked;
    }

    $found = reg_lookup_version($name, $spec, true);
    if (isset($found['error'])) {
        return $found['error'];
    }

    $platform = strtolower(trim($platform));
    if (!reg_artifact_delete($found['repo'], $found['version'], $platform)) {
        return RegResponse::error(
            404,
            'no_artifact',
            'Version ' . $found['version']['version'] . ' has no "' . $platform . '" build.'
        );
    }

    return RegResponse::json(200, ['deleted' => true, 'platform' => $platform]);
}

function reg_human(int $bytes): string
{
    if ($bytes >= 1024 * 1024 * 1024) {
        return round($bytes / (1024 * 1024 * 1024), 1) . ' GB';
    }
    if ($bytes >= 1024 * 1024) {
        return (string) (int) round($bytes / (1024 * 1024)) . ' MB';
    }
    return (string) (int) round($bytes / 1024) . ' KB';
}
