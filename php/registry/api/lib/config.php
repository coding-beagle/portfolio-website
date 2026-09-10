<?php
/**
 * Configuration, merged over defaults.
 *
 * Looked for in two places, in order: an explicit REGISTRY_CONFIG environment
 * variable, then the home directory one level above the document root (which is
 * where cPanel puts it). If neither is there the defaults below run against a
 * data directory beside the document root, so the API works under `php -S`
 * without any setup.
 */

declare(strict_types=1);

function reg_config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }

    // api/lib -> api -> document root
    $documentRoot = dirname(__DIR__, 2);
    $candidates = array_filter([
        getenv('REGISTRY_CONFIG') ?: null,
        dirname($documentRoot) . '/registry_config.php',
    ]);

    $loaded = [];
    foreach ($candidates as $path) {
        if (is_readable($path)) {
            $value = require $path;
            if (is_array($value)) {
                $loaded = $value;
            }
            break;
        }
    }

    $config = array_replace([
        // Beside the document root, never inside it. See the guard below.
        'data_dir' => dirname($documentRoot) . '/registry_data',

        // The OUTPUT of password_hash(). Null locks the API completely: with no
        // way to log in, nothing but /health answers. That is the correct
        // failure mode for a missing config — an open registry would be worse.
        'admin_password_hash' => null,

        // The kill switch. False keeps reads working and refuses every write,
        // which is how you freeze releases without taking clients offline.
        'accepting_writes' => true,

        // How long a token from `nt auth login` lasts. Long enough not to be a
        // nuisance, short enough that a leaked one is not forever.
        'token_ttl_seconds' => 30 * 24 * 60 * 60,

        'max_artifact_bytes' => 512 * 1024 * 1024,
        'global_bytes_ceiling' => 5 * 1024 * 1024 * 1024,
        'disk_soft_fraction' => 0.9,

        // How many expired tokens each request clears on its way past. Keeps
        // culling correct even if the cron job is never set up.
        'sweep_per_request' => 5,

        // Only `login` is really a security control — the others exist so that
        // a looping client cannot hammer the box. Buckets are per client IP.
        'rate_limits' => [
            'login' => ['limit' => 10, 'window' => 900],
            'upload' => ['limit' => 120, 'window' => 3600],
        ],
    ], $loaded);

    reg_assert_data_dir_outside($config['data_dir'], $documentRoot);

    return $config;
}

/**
 * Refuses a data directory inside the document root.
 *
 * Two things go wrong if artifacts land under the web root: they become
 * reachable by URL without a token, which is the one property this design
 * rests on, and the next deploy's `rm -rf` takes the database with it. Both
 * are silent failures — nothing looks broken until it matters — so this throws.
 */
function reg_assert_data_dir_outside(string $dataDir, string $documentRoot): void
{
    $data = rtrim(str_replace('\\', '/', $dataDir), '/');
    $root = rtrim(str_replace('\\', '/', $documentRoot), '/');

    if ($data === $root || strncmp($data . '/', $root . '/', strlen($root) + 1) === 0) {
        throw new RuntimeException(
            'registry: data_dir (' . $dataDir . ') is inside the document root. '
            . 'Move it outside — artifacts there would be downloadable without a token '
            . 'and wiped by the next deploy.'
        );
    }
}

function reg_data_dir(): string
{
    return rtrim(reg_config()['data_dir'], '/');
}

/** Where one artifact's bytes live. Sharded by repo and version. */
function reg_blob_dir(string $repoId, string $versionId): string
{
    return reg_data_dir() . '/blobs/' . $repoId . '/' . $versionId;
}
