<?php
/**
 * The SQLite connection and the schema.
 *
 * WAL because an upload can hold a write open for a while and a client polling
 * for a new release should not be blocked by it, and a busy timeout because the
 * default behaviour on a locked database is to fail immediately rather than
 * wait — which under concurrent uploads shows up as random 500s.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

function reg_db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    $dir = reg_data_dir();
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        throw new RuntimeException('Cannot create data directory: ' . $dir);
    }

    $pdo = new PDO('sqlite:' . $dir . '/registry.sqlite');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA busy_timeout = 5000');
    $pdo->exec('PRAGMA synchronous = NORMAL');

    reg_migrate($pdo);

    return $pdo;
}

function reg_migrate(PDO $pdo): void
{
    // A token is stored only as a hash: the database is a backup away from
    // somewhere else, and a stolen copy should not hand over live credentials.
    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS tokens (
            id           TEXT PRIMARY KEY,
            token_hash   TEXT NOT NULL UNIQUE,
            label        TEXT NOT NULL DEFAULT '',
            created_at   INTEGER NOT NULL,
            expires_at   INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL
        )
    SQL);

    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS repos (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL UNIQUE,
            description TEXT NOT NULL DEFAULT '',
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        )
    SQL);

    // major/minor/patch are stored alongside the original string so the common
    // ordering can be done in SQL; prerelease precedence is finished in PHP,
    // where the dot-separated identifier rules are expressible. `version` is
    // the exact text the uploader used, which is what gets shown back.
    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS versions (
            id         TEXT PRIMARY KEY,
            repo_id    TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
            version    TEXT NOT NULL,
            major      INTEGER NOT NULL,
            minor      INTEGER NOT NULL,
            patch      INTEGER NOT NULL,
            prerelease TEXT NOT NULL DEFAULT '',
            notes      TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            UNIQUE (repo_id, version)
        )
    SQL);

    // One artifact per platform per version: `platform` is the key a client
    // asks by, so two files claiming the same one would make "which build do I
    // download" ambiguous. Re-uploading the same platform replaces it.
    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS artifacts (
            id           TEXT PRIMARY KEY,
            version_id   TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
            platform     TEXT NOT NULL,
            filename     TEXT NOT NULL,
            content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
            size         INTEGER NOT NULL,
            sha256       TEXT NOT NULL,
            created_at   INTEGER NOT NULL,
            UNIQUE (version_id, platform)
        )
    SQL);

    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS rate_limits (
            bucket       TEXT NOT NULL,
            window_start INTEGER NOT NULL,
            count        INTEGER NOT NULL,
            PRIMARY KEY (bucket, window_start)
        )
    SQL);

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_tokens_expiry ON tokens(expires_at)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_versions_repo ON versions(repo_id, major, minor, patch)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_artifacts_version ON artifacts(version_id)');
}

/**
 * Adds a column if the table does not have it yet.
 *
 * CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so
 * anything added after the first deploy has to come through here or an upgraded
 * install quietly runs without it.
 */
function reg_add_column(PDO $pdo, string $table, string $column, string $definition): void
{
    $statement = $pdo->query('PRAGMA table_info(' . $table . ')');
    foreach ($statement->fetchAll() as $row) {
        if ($row['name'] === $column) {
            return;
        }
    }
    $pdo->exec("ALTER TABLE $table ADD COLUMN $column $definition");
}

/** A v4 UUID from real randomness. */
function reg_uuid(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
}

/** A bearer token, and the hash of it that is what actually gets stored. */
function reg_token(): string
{
    return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
}

function reg_hash_token(string $token): string
{
    return hash('sha256', $token);
}
