<?php
/**
 * Sessions, members, files, and the culling that makes the whole thing
 * ephemeral. Everything that touches the database or the blob directory lives
 * here so the front controller stays a router.
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/config.php';

/**
 * A join code: six digits, never starting with a zero so it reads and types the
 * way people expect, and checked against the live sessions so two open sessions
 * can never share one.
 */
function ut_allocate_code(PDO $pdo): string
{
    for ($attempt = 0; $attempt < 40; $attempt++) {
        $code = (string) random_int(100000, 999999);
        $statement = $pdo->prepare('SELECT 1 FROM sessions WHERE code = ?');
        $statement->execute([$code]);
        if ($statement->fetchColumn() === false) {
            return $code;
        }
    }
    // 900k codes and a 15 minute life: reaching here means something is very
    // wrong, and inventing a code anyway would collide.
    throw new RuntimeException('No join code available');
}

function ut_create_session(string $tier, string $ownerPublicKey = ''): array
{
    $pdo = ut_db();
    $limits = ut_tier($tier);
    $now = time();

    $session = [
        'id' => ut_uuid(),
        'code' => ut_allocate_code($pdo),
        'tier' => $tier,
        'created_at' => $now,
        'expires_at' => $now + (int) $limits['window_seconds'],
        'ceiling_at' => $now + (int) $limits['ceiling_seconds'],
    ];
    $ownerToken = ut_token();

    $pdo->beginTransaction();
    try {
        $pdo->prepare(
            'INSERT INTO sessions (id, code, owner_token, owner_pubkey, tier, version, bytes_used, created_at, expires_at, ceiling_at)
             VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)'
        )->execute([
            $session['id'],
            $session['code'],
            ut_hash_token($ownerToken),
            $ownerPublicKey,
            $tier,
            $session['created_at'],
            $session['expires_at'],
            $session['ceiling_at'],
        ]);

        $memberId = ut_uuid();
        $pdo->prepare(
            'INSERT INTO members (id, session_id, token, role, label, pubkey, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $memberId,
            $session['id'],
            ut_hash_token($ownerToken),
            'owner',
            'Device 1',
            $ownerPublicKey,
            'active',
            $now,
        ]);

        $pdo->commit();
        $session['member_id'] = $memberId;
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }

    $session['token'] = $ownerToken;
    $session['limits'] = $limits;
    return $session;
}

/**
 * Adds a device to a session, given its code.
 *
 * It arrives *pending*: it has a token, but that token opens nothing until the
 * owner has approved it and handed over the wrapped key. A code alone is not
 * enough to read anything, which is what makes guessing one useless.
 *
 * @return array|null null if no live session has that code
 */
function ut_join_session(string $code, string $publicKey = ''): ?array
{
    $pdo = ut_db();
    $statement = $pdo->prepare('SELECT * FROM sessions WHERE code = ? AND expires_at > ?');
    $statement->execute([$code, time()]);
    $session = $statement->fetch();
    if ($session === false) {
        return null;
    }

    $count = $pdo->prepare('SELECT COUNT(*) FROM members WHERE session_id = ?');
    $count->execute([$session['id']]);
    $ordinal = (int) $count->fetchColumn() + 1;

    $token = ut_token();
    $memberId = ut_uuid();
    $pdo->prepare(
        'INSERT INTO members (id, session_id, token, role, label, pubkey, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $memberId,
        $session['id'],
        ut_hash_token($token),
        'guest',
        'Device ' . $ordinal,
        $publicKey,
        'pending',
        time(),
    ]);

    // So the owner's next poll actually returns something: the manifest is
    // ETag'd on the version, and a device waiting to be let in is a change.
    ut_bump_version($session['id']);

    return [
        'session' => $session,
        'member_id' => $memberId,
        'token' => $token,
    ];
}

/**
 * Resolves a bearer token to its member and session, or null.
 *
 * Tokens are compared by their hash, so this is an indexed lookup rather than a
 * scan; `hash_equals` then guards the comparison of the row that came back.
 */
function ut_authenticate(?string $token): ?array
{
    if ($token === null) {
        return null;
    }
    $hash = ut_hash_token($token);
    $statement = ut_db()->prepare(
        'SELECT m.*, s.id AS s_id, s.code, s.tier, s.version, s.bytes_used,
                s.owner_pubkey, s.created_at AS s_created_at, s.expires_at, s.ceiling_at
         FROM members m JOIN sessions s ON s.id = m.session_id
         WHERE m.token = ?'
    );
    $statement->execute([$hash]);
    $row = $statement->fetch();
    if ($row === false || !hash_equals($row['token'], $hash)) {
        return null;
    }
    if ((int) $row['expires_at'] <= time()) {
        return null;
    }
    return $row;
}

/** The joins waiting on the owner, with the public key each one offered. */
function ut_pending_joins(string $sessionId): array
{
    $statement = ut_db()->prepare(
        'SELECT id, label, pubkey, created_at FROM members
         WHERE session_id = ? AND status = ? ORDER BY created_at ASC'
    );
    $statement->execute([$sessionId, 'pending']);
    return $statement->fetchAll();
}

/**
 * Lets a pending device in, storing the key the owner wrapped for it.
 *
 * The server keeps the wrapped key only long enough to hand it over. It cannot
 * unwrap it: doing that needs a private key that never left either device.
 */
function ut_approve_join(string $sessionId, string $memberId, string $wrappedKey): bool
{
    $pdo = ut_db();
    $statement = $pdo->prepare(
        'UPDATE members SET status = ?, wrapped_key = ?
         WHERE id = ? AND session_id = ? AND status = ?'
    );
    $statement->execute(['active', $wrappedKey, $memberId, $sessionId, 'pending']);
    if ($statement->rowCount() === 0) {
        return false;
    }
    ut_bump_version($sessionId);
    return true;
}

function ut_reject_join(string $sessionId, string $memberId): bool
{
    $statement = ut_db()->prepare(
        'DELETE FROM members WHERE id = ? AND session_id = ? AND status = ?'
    );
    $statement->execute([$memberId, $sessionId, 'pending']);
    return $statement->rowCount() > 0;
}

/** The shared note: one opaque string the server stores and never reads. */
function ut_set_note(string $sessionId, string $note): void
{
    $pdo = ut_db();
    $pdo->prepare('UPDATE sessions SET note = ?, version = version + 1 WHERE id = ?')
        ->execute([$note, $sessionId]);
}

function ut_bump_version(string $sessionId): int
{
    $pdo = ut_db();
    $pdo->prepare('UPDATE sessions SET version = version + 1 WHERE id = ?')->execute([$sessionId]);
    $statement = $pdo->prepare('SELECT version FROM sessions WHERE id = ?');
    $statement->execute([$sessionId]);
    return (int) $statement->fetchColumn();
}

/** Tops the clock back up, never past the session's absolute ceiling. */
function ut_heartbeat(array $auth): int
{
    $limits = ut_tier($auth['tier']);
    $expires = min(time() + (int) $limits['window_seconds'], (int) $auth['ceiling_at']);
    ut_db()->prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
        ->execute([$expires, $auth['s_id']]);
    return $expires;
}

function ut_manifest(string $sessionId): array
{
    $pdo = ut_db();

    $statement = $pdo->prepare(
        'SELECT version, expires_at, bytes_used, tier, note FROM sessions WHERE id = ?'
    );
    $statement->execute([$sessionId]);
    $session = $statement->fetch();
    if ($session === false) {
        return ['version' => 0, 'files' => [], 'gone' => true];
    }

    $statement = $pdo->prepare(
        'SELECT f.id, f.size, f.meta, f.created_at, m.label AS uploaded_by
         FROM files f LEFT JOIN members m ON m.id = f.uploaded_by
         WHERE f.session_id = ? ORDER BY f.created_at ASC, f.id ASC'
    );
    $statement->execute([$sessionId]);

    $files = [];
    foreach ($statement->fetchAll() as $row) {
        $files[] = [
            'id' => $row['id'],
            'size' => (int) $row['size'],
            // Opaque to the server: a base64 string it stores and hands back
            // without ever decoding. Phase 1 puts JSON in it, phase 2 puts
            // ciphertext in, and nothing on this side changes.
            'meta' => $row['meta'],
            'uploadedBy' => $row['uploaded_by'] ?? 'unknown',
            'createdAt' => (int) $row['created_at'],
        ];
    }

    $limits = ut_tier($session['tier']);
    return [
        'version' => (int) $session['version'],
        'expiresAt' => (int) $session['expires_at'],
        'bytesUsed' => (int) $session['bytes_used'],
        'limits' => $limits,
        // Opaque, like the file descriptions: ciphertext going out, ciphertext
        // coming back, and nothing in between that can read it.
        'note' => (string) ($session['note'] ?? ''),
        'files' => $files,
    ];
}

/**
 * Records an uploaded file. The blob is already on disk by this point; the row
 * and the byte count go in together so a quota can never be walked past by two
 * uploads racing.
 */
function ut_add_file(array $auth, string $fileId, string $meta, int $size): void
{
    $pdo = ut_db();

    $pdo->beginTransaction();
    try {
        $pdo->prepare(
            'INSERT INTO files (id, session_id, size, meta, uploaded_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?)'
        )->execute([$fileId, $auth['s_id'], $size, $meta, $auth['id'], time()]);

        $pdo->prepare('UPDATE sessions SET bytes_used = bytes_used + ?, version = version + 1 WHERE id = ?')
            ->execute([$size, $auth['s_id']]);

        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
}

function ut_get_file(string $sessionId, string $fileId): ?array
{
    $statement = ut_db()->prepare('SELECT * FROM files WHERE id = ? AND session_id = ?');
    $statement->execute([$fileId, $sessionId]);
    $row = $statement->fetch();
    return $row === false ? null : $row;
}

function ut_delete_file(string $sessionId, string $fileId): bool
{
    $file = ut_get_file($sessionId, $fileId);
    if ($file === null) {
        return false;
    }

    @unlink(ut_blob_dir($sessionId) . '/' . $fileId);

    $pdo = ut_db();
    $pdo->beginTransaction();
    try {
        $pdo->prepare('DELETE FROM files WHERE id = ?')->execute([$fileId]);
        $pdo->prepare('UPDATE sessions SET bytes_used = MAX(0, bytes_used - ?), version = version + 1 WHERE id = ?')
            ->execute([(int) $file['size'], $sessionId]);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }

    return true;
}

/**
 * Ends a session and takes its files with it.
 *
 * Blobs first, then rows. The other order can orphan files that nothing knows
 * about; this order at worst leaves a row pointing at a file already gone,
 * which the next request reports as missing and the sweeper tidies.
 */
function ut_close_session(string $sessionId): void
{
    ut_rmdir(ut_blob_dir($sessionId));
    ut_db()->prepare('DELETE FROM sessions WHERE id = ?')->execute([$sessionId]);
}

/**
 * Clears expired sessions. Called with a small limit on every request, and
 * without one from cron.
 *
 * @return int how many sessions were culled
 */
function ut_sweep(?int $limit = null): int
{
    $pdo = ut_db();
    $sql = 'SELECT id FROM sessions WHERE expires_at <= ?';
    if ($limit !== null) {
        $sql .= ' LIMIT ' . max(1, $limit);
    }
    $statement = $pdo->prepare($sql);
    $statement->execute([time()]);

    $culled = 0;
    foreach ($statement->fetchAll() as $row) {
        ut_close_session($row['id']);
        $culled++;
    }

    // Rate-limit rows are only useful for the length of their window.
    $pdo->prepare('DELETE FROM rate_limits WHERE window_start < ?')->execute([time() - 86400]);

    return $culled;
}

/**
 * Ends every session immediately, expired or not.
 *
 * The manual counterpart to the kill switch: set `accepting_sessions` to false
 * so nothing new starts, then run this to clear what is already open. Also what
 * you want after a test run that left sessions behind.
 *
 * @return int how many sessions were ended
 */
function ut_purge_all(): int
{
    $pdo = ut_db();
    $rows = $pdo->query('SELECT id FROM sessions')->fetchAll();
    foreach ($rows as $row) {
        ut_close_session($row['id']);
    }
    return count($rows);
}

/**
 * The second pass, for cron only: blob directories with no session behind them.
 * This is what catches a crash between deleting the row and deleting the files.
 */
function ut_sweep_orphans(): int
{
    $root = ut_data_dir() . '/blobs';
    if (!is_dir($root)) {
        return 0;
    }

    $pdo = ut_db();
    $statement = $pdo->prepare('SELECT 1 FROM sessions WHERE id = ?');
    $removed = 0;

    foreach (scandir($root) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }
        $path = $root . '/' . $entry;
        if (!is_dir($path)) {
            continue;
        }
        $statement->execute([$entry]);
        if ($statement->fetchColumn() === false) {
            ut_rmdir($path);
            $removed++;
        }
    }

    return $removed;
}

/** Removes a directory and its contents. Deliberately not recursive past one
 *  level — blob directories are flat, and a surprise nested tree here would
 *  mean something other than this code has been writing to the data directory. */
function ut_rmdir(string $path): void
{
    if (!is_dir($path)) {
        return;
    }
    foreach (scandir($path) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }
        $child = $path . '/' . $entry;
        if (is_file($child) || is_link($child)) {
            @unlink($child);
        }
    }
    @rmdir($path);
}
