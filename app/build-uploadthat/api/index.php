<?php
/**
 * Uploadthat API — phase 1.
 *
 * One front controller behind an .htaccess rewrite. Same origin as the front
 * end, so there is no CORS here by design; if you ever need it, that is a sign
 * something is being served from the wrong place.
 *
 * Nothing here can read anything it stores. File bodies, their descriptions and
 * the shared note all arrive encrypted and leave the same way; the only key
 * material that passes through is public keys and a key wrapped to a secret
 * this server cannot derive.
 *
 * A join code is not a credential. Presenting one gets a device a token that
 * opens nothing — it is *pending* until the owner approves it and hands over
 * the wrapped key, which is why guessing a live code is not worth doing.
 */

declare(strict_types=1);

// Never render a stack trace to a caller: on a misconfigured host it would
// leak absolute paths. Failures go to the error log and come back as a plain
// 500 instead.
ini_set('display_errors', '0');
ini_set('log_errors', '1');

require_once __DIR__ . '/lib/config.php';
require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/limits.php';
require_once __DIR__ . '/lib/store.php';

set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if ((error_reporting() & $severity) === 0) {
        return false;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

try {
    ut_handle_request();
} catch (Throwable $error) {
    error_log('[uploadthat] ' . $error->getMessage() . ' @ ' . $error->getFile() . ':' . $error->getLine());
    ut_fail(500, 'server_error', 'Something went wrong on the server.');
}

function ut_handle_request(): void
{
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $path = ut_route_path();

    // Every request clears a few expired sessions on its way past, so culling
    // stays correct even where the cron job was never set up.
    try {
        ut_sweep((int) ut_config()['sweep_per_request']);
    } catch (Throwable $error) {
        error_log('[uploadthat] sweep failed: ' . $error->getMessage());
    }

    if ($method === 'OPTIONS') {
        http_response_code(204);
        header('Allow: GET, POST, DELETE, OPTIONS');
        return;
    }

    if ($path === '/health' && $method === 'GET') {
        ut_json(200, [
            'ok' => true,
            'acceptingSessions' => (bool) ut_config()['accepting_sessions'],
            'uploadCeiling' => min(ut_bytes_ini('upload_max_filesize'), ut_bytes_ini('post_max_size')),
        ]);
    }

    if ($path === '/session' && $method === 'POST') {
        ut_route_create();
    }

    if (preg_match('#^/join/(\d{6})$#', $path, $matches) === 1 && $method === 'POST') {
        ut_route_join($matches[1]);
    }

    if (preg_match('#^/session/([0-9a-f-]{36})/([a-z]+)$#', $path, $matches) === 1) {
        $sessionId = $matches[1];
        $action = $matches[2];

        if ($action === 'heartbeat' && $method === 'POST') {
            ut_route_heartbeat($sessionId);
        }
        if ($action === 'close' && $method === 'POST') {
            ut_route_close($sessionId);
        }
        if ($action === 'manifest' && $method === 'GET') {
            ut_route_manifest($sessionId);
        }
        if ($action === 'files' && $method === 'POST') {
            ut_route_upload($sessionId);
        }
        if ($action === 'handshake' && $method === 'GET') {
            ut_route_handshake($sessionId);
        }
        if ($action === 'note' && $method === 'POST') {
            ut_route_note($sessionId);
        }
    }

    if (preg_match('#^/session/([0-9a-f-]{36})/joins/([0-9a-f-]{36})$#', $path, $matches) === 1) {
        if ($method === 'POST') {
            ut_route_approve($matches[1], $matches[2]);
        }
        if ($method === 'DELETE') {
            ut_route_reject($matches[1], $matches[2]);
        }
    }

    if (preg_match('#^/session/([0-9a-f-]{36})/files/([0-9a-f-]{36})$#', $path, $matches) === 1) {
        if ($method === 'GET') {
            ut_route_download($matches[1], $matches[2]);
        }
        if ($method === 'DELETE') {
            ut_route_delete($matches[1], $matches[2]);
        }
    }

    ut_fail(404, 'not_found', 'No such endpoint.');
}

/** The path with the query string and the /api mount point taken off. */
function ut_route_path(): string
{
    $uri = $_SERVER['REQUEST_URI'] ?? '/';
    $path = parse_url($uri, PHP_URL_PATH) ?: '/';
    $path = '/' . trim($path, '/');
    if (strncmp($path, '/api', 4) === 0) {
        $path = substr($path, 4);
    }
    return $path === '' ? '/' : $path;
}

/** The caller, whatever state it is in, or a 401. */
function ut_require_member(string $sessionId): array
{
    $auth = ut_authenticate(ut_bearer());
    if ($auth === null || $auth['s_id'] !== $sessionId) {
        ut_fail(401, 'unauthorised', 'This session has ended, or the link is not valid.');
    }
    return $auth;
}

/**
 * The caller, and only once it is really in. A device that has joined but not
 * been approved holds a token that reaches nothing but the handshake.
 */
function ut_require_auth(string $sessionId): array
{
    $auth = ut_require_member($sessionId);
    if ($auth['status'] !== 'active') {
        ut_fail(403, 'pending', 'Waiting for the other device to let you in.');
    }
    return $auth;
}

/** Public keys and wrapped keys: base64, and no bigger than they should be. */
function ut_require_base64(string $value, int $max, string $what): string
{
    if ($value === '' || strlen($value) > $max || base64_decode($value, true) === false) {
        ut_fail(400, 'bad_request', $what);
    }
    return $value;
}

function ut_route_create(): void
{
    $config = ut_config();
    if (!$config['accepting_sessions']) {
        ut_fail(503, 'closed', 'Uploadthat is not accepting new sessions right now.');
    }

    $body = ut_body();
    $tier = 'anon';

    $offered = isset($body['operatorKey']) ? (string) $body['operatorKey'] : '';
    if ($offered !== '') {
        // Checked before verifying, so a guessing attack cannot make the server
        // burn bcrypt time on its behalf — but only charged for below, on a
        // wrong key. Using your own key correctly should never lock you out of
        // your own tool, which spending the budget on every attempt would do.
        if (ut_rate_exceeded(ut_client_ip(), 'operator')) {
            ut_fail(429, 'rate_limited', 'Too many key attempts. Try again later.');
        }
        $hash = $config['operator_key_hash'];

        // A passphrase pasted in where the hash belongs would otherwise fail
        // exactly like a wrong key, with nothing to tell the two apart.
        if (is_string($hash) && $hash !== '' && (password_get_info($hash)['algoName'] ?? 'unknown') === 'unknown') {
            error_log(
                '[uploadthat] operator_key_hash is not a password hash. Generate one with '
                . 'password_hash($passphrase, PASSWORD_DEFAULT) and store that instead.'
            );
        }

        if (!is_string($hash) || $hash === '' || !password_verify($offered, $hash)) {
            ut_rate_consume(ut_client_ip(), 'operator');
            ut_fail(403, 'bad_key', 'That key was not recognised.');
        }
        $tier = 'operator';
    }

    if ($tier === 'anon') {
        if (!ut_rate_allow(ut_client_ip(), 'create')) {
            ut_fail(429, 'rate_limited', 'You have opened too many sessions in the last hour.');
        }
        if (ut_disk_pressured()) {
            ut_fail(503, 'no_space', 'Uploadthat is out of room at the moment. Try again later.');
        }
    }

    $publicKey = ut_require_base64(
        (string) ($body['publicKey'] ?? ''),
        200,
        'A public key is required to open a session.'
    );

    $session = ut_create_session($tier, $publicKey);

    ut_json(201, [
        'sessionId' => $session['id'],
        'code' => $session['code'],
        'token' => $session['token'],
        'memberId' => $session['member_id'],
        'role' => 'owner',
        'status' => 'active',
        'label' => 'Device 1',
        'tier' => $tier,
        'expiresAt' => $session['expires_at'],
        'ceilingAt' => $session['ceiling_at'],
        'limits' => $session['limits'],
    ]);
}

function ut_route_join(string $code): void
{
    if (!ut_rate_allow(ut_client_ip(), 'join')) {
        ut_fail(429, 'rate_limited', 'Too many join attempts. Try again later.');
    }

    $publicKey = ut_require_base64(
        (string) (ut_body()['publicKey'] ?? ''),
        200,
        'A public key is required to join a session.'
    );

    $joined = ut_join_session($code, $publicKey);
    if ($joined === null) {
        // Deliberately the same answer for "never existed" and "already over",
        // so the endpoint cannot be used to map which codes are live.
        ut_fail(404, 'no_session', 'No session with that code. It may have ended.');
    }

    ut_json(200, [
        'sessionId' => $joined['session']['id'],
        'code' => $joined['session']['code'],
        'token' => $joined['token'],
        'memberId' => $joined['member_id'],
        'role' => 'guest',
        // Nothing but the handshake works until the owner approves it.
        'status' => 'pending',
        'ownerPublicKey' => (string) $joined['session']['owner_pubkey'],
        'tier' => $joined['session']['tier'],
        'expiresAt' => (int) $joined['session']['expires_at'],
        'ceilingAt' => (int) $joined['session']['ceiling_at'],
        'limits' => ut_tier($joined['session']['tier']),
    ]);
}

/**
 * What a device that has joined is waiting for: whether it has been let in and,
 * once it has, the session key wrapped for it.
 *
 * The one endpoint a pending token reaches, which is what lets a device poll
 * for its own approval without being able to read anything yet.
 */
function ut_route_handshake(string $sessionId): void
{
    $auth = ut_require_member($sessionId);
    ut_json(200, [
        'status' => $auth['status'],
        'ownerPublicKey' => (string) $auth['owner_pubkey'],
        'wrappedKey' => $auth['wrapped_key'] === null ? null : (string) $auth['wrapped_key'],
    ]);
}

function ut_route_approve(string $sessionId, string $memberId): void
{
    $auth = ut_require_auth($sessionId);
    if ($auth['role'] !== 'owner') {
        ut_fail(403, 'not_owner', 'Only the device that opened the session can admit others.');
    }

    $wrapped = ut_require_base64(
        (string) (ut_body()['wrappedKey'] ?? ''),
        512,
        'A wrapped key is required to admit a device.'
    );

    if (!ut_approve_join($sessionId, $memberId, $wrapped)) {
        ut_fail(404, 'no_join', 'That device is no longer waiting.');
    }
    ut_json(200, ['approved' => true]);
}

function ut_route_reject(string $sessionId, string $memberId): void
{
    $auth = ut_require_auth($sessionId);
    if ($auth['role'] !== 'owner') {
        ut_fail(403, 'not_owner', 'Only the device that opened the session can admit others.');
    }
    if (!ut_reject_join($sessionId, $memberId)) {
        ut_fail(404, 'no_join', 'That device is no longer waiting.');
    }
    ut_json(200, ['rejected' => true]);
}

/**
 * The shared note. Stored exactly as it arrives — base64 of ciphertext — and
 * checked only for being that, because reading it is not this server's business.
 */
function ut_route_note(string $sessionId): void
{
    ut_require_auth($sessionId);

    $note = (string) (ut_body()['note'] ?? '');
    if ($note !== '' && (strlen($note) > 65536 || base64_decode($note, true) === false)) {
        ut_fail(400, 'bad_note', 'That note is too large, or not in the expected form.');
    }

    ut_set_note($sessionId, $note);
    ut_json(200, ['saved' => true]);
}

function ut_route_heartbeat(string $sessionId): void
{
    $auth = ut_require_auth($sessionId);
    if ($auth['role'] !== 'owner') {
        ut_fail(403, 'not_owner', 'Only the device that opened the session can extend it.');
    }
    ut_json(200, ['expiresAt' => ut_heartbeat($auth)]);
}

function ut_route_close(string $sessionId): void
{
    // sendBeacon cannot set headers, so the tab-closing courtesy call has to be
    // able to carry its token in the body. It is the same secret either way,
    // and unlike a query parameter a body does not end up in access logs.
    $token = ut_bearer();
    if ($token === null) {
        $fromBody = ut_body()['token'] ?? null;
        $token = (is_string($fromBody) && $fromBody !== '') ? $fromBody : null;
    }

    $auth = ut_authenticate($token);
    if ($auth === null || $auth['s_id'] !== $sessionId) {
        ut_fail(401, 'unauthorised', 'This session has ended, or the link is not valid.');
    }
    if ($auth['role'] !== 'owner') {
        ut_fail(403, 'not_owner', 'Only the device that opened the session can end it.');
    }
    ut_close_session($sessionId);
    ut_json(200, ['closed' => true]);
}

/**
 * The manifest is polled every couple of seconds, so it answers 304 whenever
 * the session has not changed. `version` counts every mutation, which makes it
 * a sound ETag without hashing the body.
 */
function ut_route_manifest(string $sessionId): void
{
    $auth = ut_require_auth($sessionId);
    $manifest = ut_manifest($sessionId);
    $manifest['you'] = [
        'memberId' => $auth['id'],
        'label' => $auth['label'],
        'role' => $auth['role'],
        'status' => $auth['status'],
    ];

    // Devices waiting to be let in ride along with the poll the owner is
    // already making, rather than costing an endpoint and a request of their
    // own. Only the owner can admit anyone, so only the owner is told.
    if ($auth['role'] === 'owner') {
        $manifest['joins'] = array_map(
            static fn(array $row): array => [
                'id' => $row['id'],
                'label' => $row['label'],
                'publicKey' => (string) $row['pubkey'],
                'createdAt' => (int) $row['created_at'],
            ],
            ut_pending_joins($sessionId)
        );
    }

    $etag = '"v' . $manifest['version'] . '-' . substr($sessionId, 0, 8) . '"';
    $sent = trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''));
    if ($sent !== '' && $sent === $etag) {
        http_response_code(304);
        header('ETag: ' . $etag);
        header('Cache-Control: no-store');
        exit;
    }

    ut_json(200, $manifest, ['ETag' => $etag]);
}

function ut_route_upload(string $sessionId): void
{
    if (ut_post_was_truncated()) {
        ut_fail(413, 'too_large', 'That file is bigger than the server will accept in one request.');
    }

    $auth = ut_require_auth($sessionId);
    $limits = ut_tier($auth['tier']);

    if (!isset($_FILES['file']) || !is_array($_FILES['file'])) {
        ut_fail(400, 'no_file', 'No file was attached.');
    }

    $upload = $_FILES['file'];
    if (($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        $code = (int) $upload['error'];
        if ($code === UPLOAD_ERR_INI_SIZE || $code === UPLOAD_ERR_FORM_SIZE) {
            ut_fail(413, 'too_large', 'That file is bigger than the server will accept.');
        }
        ut_fail(400, 'upload_failed', 'The upload did not complete.');
    }

    $size = (int) $upload['size'];
    if ($size <= 0) {
        ut_fail(400, 'empty_file', 'That file is empty.');
    }
    if ($size > (int) $limits['max_file_bytes']) {
        ut_fail(413, 'too_large', 'Files are limited to ' . ut_human($limits['max_file_bytes']) . ' on this session.');
    }
    if ((int) $auth['bytes_used'] + $size > (int) $limits['max_session_bytes']) {
        ut_fail(413, 'session_full', 'This session has reached its ' . ut_human($limits['max_session_bytes']) . ' limit.');
    }

    $count = ut_db()->prepare('SELECT COUNT(*) FROM files WHERE session_id = ?');
    $count->execute([$sessionId]);
    if ((int) $count->fetchColumn() >= (int) $limits['max_files']) {
        ut_fail(413, 'too_many_files', 'This session has reached its limit of ' . (int) $limits['max_files'] . ' files.');
    }

    if ($auth['tier'] !== 'operator' && ut_disk_pressured()) {
        ut_fail(503, 'no_space', 'Uploadthat is out of room at the moment.');
    }
    if (ut_disk_full()) {
        ut_fail(503, 'no_space', 'Uploadthat is out of room.');
    }

    // Opaque to the server: a base64 string, JSON inside it for now and
    // ciphertext in phase 2. Only the encoding is checked, never the content —
    // the moment this function looks inside, the trust model is broken.
    $meta = (string) ($_POST['meta'] ?? '');
    if ($meta === '' || strlen($meta) > 8192 || base64_decode($meta, true) === false) {
        ut_fail(400, 'bad_meta', 'The file description was missing or malformed.');
    }

    $directory = ut_blob_dir($sessionId);
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) {
        ut_fail(500, 'server_error', 'Could not store the file.');
    }

    $fileId = ut_uuid();
    if (!move_uploaded_file($upload['tmp_name'], $directory . '/' . $fileId)) {
        ut_fail(500, 'server_error', 'Could not store the file.');
    }

    // The row is written after the bytes land, so a failed write never leaves a
    // file the manifest claims exists.
    try {
        ut_add_file($auth, $fileId, $meta, $size);
    } catch (Throwable $error) {
        @unlink($directory . '/' . $fileId);
        throw $error;
    }

    ut_json(201, ['id' => $fileId, 'size' => $size]);
}

function ut_route_download(string $sessionId, string $fileId): void
{
    $auth = ut_require_auth($sessionId);
    $file = ut_get_file($auth['s_id'], $fileId);
    if ($file === null) {
        ut_fail(404, 'no_file', 'That file is no longer in the session.');
    }

    $path = ut_blob_dir($sessionId) . '/' . $fileId;
    if (!is_file($path)) {
        ut_fail(404, 'no_file', 'That file is no longer in the session.');
    }

    while (ob_get_level() > 0) {
        ob_end_clean();
    }

    // Always a download, never a render: nothing a visitor uploads should be
    // able to execute on the domain that serves it back.
    header('Content-Type: application/octet-stream');
    header('Content-Length: ' . (string) filesize($path));
    header('Content-Disposition: attachment; filename="' . $fileId . '.bin"');
    header('X-Content-Type-Options: nosniff');
    header('Content-Security-Policy: default-src \'none\'; sandbox');
    header('Cache-Control: no-store');
    readfile($path);
    exit;
}

function ut_route_delete(string $sessionId, string $fileId): void
{
    ut_require_auth($sessionId);
    if (!ut_delete_file($sessionId, $fileId)) {
        ut_fail(404, 'no_file', 'That file is no longer in the session.');
    }
    ut_json(200, ['deleted' => true]);
}

function ut_human(int $bytes): string
{
    if ($bytes >= 1024 * 1024 * 1024) {
        return round($bytes / (1024 * 1024 * 1024), 1) . ' GB';
    }
    return (string) (int) round($bytes / (1024 * 1024)) . ' MB';
}
