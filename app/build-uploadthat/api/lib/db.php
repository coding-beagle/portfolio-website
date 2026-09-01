<?php
/**
 * The SQLite connection and the schema.
 *
 * WAL because two devices poll and upload against the same file constantly, and
 * a busy timeout because the default behaviour on a locked database is to fail
 * immediately rather than wait — which under polling shows up as random 500s.
 *
 * The schema is already the shape phase 2 needs: `meta` is a blob the server
 * never reads, and the key columns are nullable and unused for now. Phase 2
 * fills them in and changes what the client puts in `meta`; no migration.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

function ut_db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    $dir = ut_data_dir();
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        throw new RuntimeException('Cannot create data directory: ' . $dir);
    }

    $pdo = new PDO('sqlite:' . $dir . '/uploadthat.sqlite');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA busy_timeout = 5000');
    $pdo->exec('PRAGMA synchronous = NORMAL');

    ut_migrate($pdo);

    return $pdo;
}

function ut_migrate(PDO $pdo): void
{
    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS sessions (
            id           TEXT PRIMARY KEY,
            code         TEXT NOT NULL UNIQUE,
            owner_token  TEXT NOT NULL,
            owner_pubkey BLOB,
            tier         TEXT NOT NULL DEFAULT 'anon',
            version      INTEGER NOT NULL DEFAULT 0,
            bytes_used   INTEGER NOT NULL DEFAULT 0,
            created_at   INTEGER NOT NULL,
            expires_at   INTEGER NOT NULL,
            ceiling_at   INTEGER NOT NULL
        )
    SQL);

    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS members (
            id          TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            token       TEXT NOT NULL,
            role        TEXT NOT NULL,
            label       TEXT NOT NULL,
            pubkey      BLOB,
            wrapped_key BLOB,
            status      TEXT NOT NULL,
            created_at  INTEGER NOT NULL
        )
    SQL);

    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS files (
            id          TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            size        INTEGER NOT NULL,
            meta        BLOB NOT NULL,
            iv          BLOB,
            uploaded_by TEXT NOT NULL,
            created_at  INTEGER NOT NULL
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

    // Columns added after the first deploy. CREATE TABLE IF NOT EXISTS does
    // nothing to a table that already exists, so anything new has to be added
    // explicitly or an upgraded install quietly runs without it.
    ut_add_column($pdo, 'sessions', 'note', "TEXT NOT NULL DEFAULT ''");

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_members_token ON members(token)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_files_session ON files(session_id)');
}

/** Adds a column if the table does not have it yet. */
function ut_add_column(PDO $pdo, string $table, string $column, string $definition): void
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
function ut_uuid(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
}

/** A bearer token, and the hash of it that is what actually gets stored. */
function ut_token(): string
{
    return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
}

function ut_hash_token(string $token): string
{
    return hash('sha256', $token);
}
