<?php
/**
 * The password, and the tokens it issues.
 *
 * One admin password, stored as a password_hash in a config file outside the
 * document root. `nt auth login` exchanges it for a bearer token with an
 * expiry; every other endpoint takes the token and never sees the password
 * again. Tokens are stored only as SHA-256 hashes, so a copy of the database
 * is not a set of live credentials.
 *
 * SHA-256 and not bcrypt for the tokens, deliberately: a token is 256 bits of
 * real randomness, so there is no dictionary to slow an attacker down with,
 * and every authenticated request would have to pay the bcrypt cost.
 *
 * There are two kinds of token, differing only in how they are made and how
 * long they last:
 *
 *   'session' — from `nt auth login` or the browser. Lives for
 *               token_ttl_seconds, which is short enough that a leaked one
 *               stops mattering on its own.
 *   'named'   — minted by an already-authenticated caller with a label and an
 *               explicit lifetime, which may be *never expires*. This is what
 *               a CI job or a shipped auto-updater carries: it can be revoked
 *               on its own, without disturbing anybody's session, and it does
 *               not silently stop working three weeks into the year.
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/limits.php';

/** An `expires_at` of 0 means the token never expires. */
const REG_TOKEN_NEVER = 0;

/** The longest explicit lifetime a named token may be given, in days. */
const REG_MAX_TOKEN_DAYS = 3650;

/** Whether a password has been configured at all. */
function reg_auth_configured(): bool
{
    $hash = reg_config()['admin_password_hash'];
    return is_string($hash) && $hash !== '';
}

/**
 * Whether the configured hash is actually a hash.
 *
 * A passphrase pasted in where the hash belongs would otherwise fail exactly
 * like a wrong password, with nothing to tell the two apart — a genuinely
 * miserable thing to debug at 2am against a server you cannot echo from.
 */
function reg_auth_hash_looks_valid(): bool
{
    if (!reg_auth_configured()) {
        return false;
    }
    $hash = (string) reg_config()['admin_password_hash'];
    return (password_get_info($hash)['algoName'] ?? 'unknown') !== 'unknown';
}

/**
 * Checks a password and, if it is right, issues a token.
 *
 * @return array{token:string,expires_at:int,id:string}|null null on a wrong
 *         password or a spent rate-limit budget; the caller cannot tell which,
 *         and does not need to.
 */
function reg_login(string $password, string $label = ''): ?array
{
    if (!reg_auth_configured()) {
        return null;
    }

    $hash = (string) reg_config()['admin_password_hash'];
    if (!password_verify($password, $hash)) {
        return null;
    }

    // Explicitly a session: it came from a password, and it should age out
    // like one. Named tokens are minted deliberately, by an endpoint of their
    // own, so that "long lived" is never something you get by accident.
    return reg_issue_token($label, null, 'session');
}

/**
 * Mints a token. The plaintext is returned exactly once and never stored.
 *
 * @param int|null $ttl Seconds to live. Null takes the configured default;
 *        REG_TOKEN_NEVER (0) means the token never expires, which is only
 *        appropriate for a named token that something is going to carry
 *        around — and which is exactly why those have to be labelled.
 * @return array{token:string,expires_at:int,id:string,kind:string,label:string}
 */
function reg_issue_token(string $label = '', ?int $ttl = null, string $kind = 'session'): array
{
    $now = time();
    $ttl ??= (int) reg_config()['token_ttl_seconds'];

    // 0 in, 0 out: the sentinel is stored as-is rather than as `now + 0`,
    // which would be a token that expired the instant it was created.
    $expiresAt = $ttl === REG_TOKEN_NEVER ? REG_TOKEN_NEVER : $now + $ttl;

    $token = reg_token();
    $id = reg_uuid();

    reg_db()->prepare(
        'INSERT INTO tokens (id, token_hash, label, kind, created_at, expires_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $id, reg_hash_token($token), substr($label, 0, 100), $kind, $now, $expiresAt, $now,
    ]);

    return [
        'id' => $id,
        'token' => $token,
        'expires_at' => $expiresAt,
        'kind' => $kind,
        'label' => substr($label, 0, 100),
    ];
}

/**
 * Resolves a token to its row, or null if it is unknown or expired.
 *
 * `last_seen_at` is refreshed at most once a minute rather than on every
 * request: it exists so the browser UI can show which tokens are in use, and
 * turning every read of the registry into a write is a poor trade for that.
 */
function reg_authenticate(?string $token): ?array
{
    if ($token === null || $token === '') {
        return null;
    }

    // `expires_at = 0` is the never-expires sentinel, so it has to be admitted
    // explicitly — a plain `expires_at > ?` rejects precisely the tokens that
    // were meant to outlast everything.
    $statement = reg_db()->prepare(
        'SELECT * FROM tokens WHERE token_hash = ? AND (expires_at = 0 OR expires_at > ?)'
    );
    $statement->execute([reg_hash_token($token), time()]);
    $row = $statement->fetch();
    if ($row === false) {
        return null;
    }

    $now = time();
    if ($now - (int) $row['last_seen_at'] > 60) {
        reg_db()->prepare('UPDATE tokens SET last_seen_at = ? WHERE id = ?')
            ->execute([$now, $row['id']]);
        $row['last_seen_at'] = $now;
    }

    return $row;
}

/** Revokes one token by its plaintext. What `nt auth logout` calls. */
function reg_revoke_token(string $token): bool
{
    $statement = reg_db()->prepare('DELETE FROM tokens WHERE token_hash = ?');
    $statement->execute([reg_hash_token($token)]);
    return $statement->rowCount() > 0;
}

/** Revokes one token by its id. What the browser UI calls. */
function reg_revoke_token_id(string $id): bool
{
    $statement = reg_db()->prepare('DELETE FROM tokens WHERE id = ?');
    $statement->execute([$id]);
    return $statement->rowCount() > 0;
}

/** Revokes every token. The panic button, for a leak. */
function reg_revoke_all_tokens(): int
{
    $statement = reg_db()->prepare('DELETE FROM tokens WHERE 1 = 1');
    $statement->execute();
    return $statement->rowCount();
}

/**
 * Live tokens, newest first. No hashes leave this function — the id is what
 * the UI revokes by.
 */
function reg_list_tokens(): array
{
    $rows = reg_db()->prepare(
        'SELECT * FROM tokens WHERE expires_at = 0 OR expires_at > ? ORDER BY created_at DESC'
    );
    $rows->execute([time()]);

    return array_map(static fn(array $row): array => [
        'id' => $row['id'],
        'label' => $row['label'],
        'kind' => $row['kind'] ?? 'session',
        'createdAt' => (int) $row['created_at'],
        // 0 means never. Clients render it, so it is passed through rather
        // than turned into some far-future date that would only be a lie.
        'expiresAt' => (int) $row['expires_at'],
        'lastSeenAt' => (int) $row['last_seen_at'],
    ], $rows->fetchAll());
}

/**
 * Clears expired tokens. Called both by cron and, a few rows at a time, by
 * ordinary requests, so culling stays correct even where cron was never set up.
 */
function reg_sweep_tokens(?int $limit = null): int
{
    // `expires_at > 0` first, and it is not optional: without it this deletes
    // every never-expires token on the next request, which would take out the
    // CI jobs and every shipped updater at once.
    $sql = 'DELETE FROM tokens WHERE expires_at > 0 AND expires_at <= ?';
    $parameters = [time()];
    if ($limit !== null && $limit > 0) {
        $sql .= ' AND id IN (SELECT id FROM tokens WHERE expires_at > 0 AND expires_at <= ?'
            . ' LIMIT ' . (int) $limit . ')';
        $parameters[] = time();
    }
    $statement = reg_db()->prepare($sql);
    $statement->execute($parameters);
    return $statement->rowCount();
}
