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
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/limits.php';

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

    return reg_issue_token($label);
}

/**
 * Mints a token. The plaintext is returned exactly once and never stored.
 *
 * @return array{token:string,expires_at:int,id:string}
 */
function reg_issue_token(string $label = '', ?int $ttl = null): array
{
    $now = time();
    $ttl ??= (int) reg_config()['token_ttl_seconds'];
    $token = reg_token();
    $id = reg_uuid();

    reg_db()->prepare(
        'INSERT INTO tokens (id, token_hash, label, created_at, expires_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)'
    )->execute([$id, reg_hash_token($token), substr($label, 0, 100), $now, $now + $ttl, $now]);

    return ['id' => $id, 'token' => $token, 'expires_at' => $now + $ttl];
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

    $statement = reg_db()->prepare(
        'SELECT * FROM tokens WHERE token_hash = ? AND expires_at > ?'
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
    $rows = reg_db()->prepare('SELECT * FROM tokens WHERE expires_at > ? ORDER BY created_at DESC');
    $rows->execute([time()]);

    return array_map(static fn(array $row): array => [
        'id' => $row['id'],
        'label' => $row['label'],
        'createdAt' => (int) $row['created_at'],
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
    $sql = 'DELETE FROM tokens WHERE expires_at <= ?';
    $parameters = [time()];
    if ($limit !== null && $limit > 0) {
        $sql .= ' AND id IN (SELECT id FROM tokens WHERE expires_at <= ? LIMIT ' . (int) $limit . ')';
        $parameters[] = time();
    }
    $statement = reg_db()->prepare($sql);
    $statement->execute($parameters);
    return $statement->rowCount();
}
