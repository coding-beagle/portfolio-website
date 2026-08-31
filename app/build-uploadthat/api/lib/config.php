<?php
/**
 * Configuration, merged over defaults.
 *
 * The file is looked for in three places, in order: an explicit
 * UPLOADTHAT_CONFIG environment variable, the home directory two levels above
 * the document root (which is where cPanel puts it), and then nowhere — in
 * which case the defaults below run against a local .data directory, so the
 * API works out of the box under `php -S` without any setup.
 */

declare(strict_types=1);

function ut_config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }

    // api/lib -> api -> document root -> home
    $documentRoot = dirname(__DIR__, 2);
    $candidates = array_filter([
        getenv('UPLOADTHAT_CONFIG') ?: null,
        dirname($documentRoot) . '/uploadthat_config.php',
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
        'data_dir' => dirname($documentRoot) . '/uploadthat_data',
        'accepting_sessions' => true,
        'operator_key_hash' => null,
        'global_bytes_ceiling' => 5 * 1024 * 1024 * 1024,
        'disk_soft_fraction' => 0.8,

        // How many expired sessions each request clears on its way past. Keeps
        // culling correct even if the cron job is never set up.
        'sweep_per_request' => 5,

        'tiers' => [
            'anon' => [
                'max_file_bytes' => 25 * 1024 * 1024,
                'max_session_bytes' => 100 * 1024 * 1024,
                'max_files' => 20,
                // A session starts with `window` seconds on the clock and a
                // heartbeat tops it back up, but never past `ceiling` seconds
                // from when it was opened.
                'window_seconds' => 15 * 60,
                'ceiling_seconds' => 60 * 60,
            ],
            'operator' => [
                'max_file_bytes' => 500 * 1024 * 1024,
                'max_session_bytes' => 2 * 1024 * 1024 * 1024,
                'max_files' => 200,
                'window_seconds' => 2 * 60 * 60,
                'ceiling_seconds' => 4 * 60 * 60,
            ],
        ],

        'rate_limits' => [
            'create' => ['limit' => 3, 'window' => 3600],
            'join' => ['limit' => 10, 'window' => 3600],
            'operator' => ['limit' => 5, 'window' => 3600],
        ],
    ], $loaded);

    ut_assert_data_dir_outside($config['data_dir'], $documentRoot);

    return $config;
}

/**
 * Refuses a data directory inside the document root.
 *
 * Two things go wrong if uploads land under the web root: they become
 * reachable by URL, which is the one property this whole design rests on, and
 * the next deploy's `rm -rf` takes the database with it. Both are silent
 * failures — nothing looks broken until it matters — so this throws instead.
 */
function ut_assert_data_dir_outside(string $dataDir, string $documentRoot): void
{
    $data = rtrim(str_replace('\\', '/', $dataDir), '/');
    $root = rtrim(str_replace('\\', '/', $documentRoot), '/');

    if ($data === $root || strncmp($data . '/', $root . '/', strlen($root) + 1) === 0) {
        throw new RuntimeException(
            'uploadthat: data_dir (' . $dataDir . ') is inside the document root. '
            . 'Move it outside — uploads there would be reachable by URL and wiped by the next deploy.'
        );
    }
}

/** The limits that apply to one tier. */
function ut_tier(string $tier): array
{
    $tiers = ut_config()['tiers'];
    return $tiers[$tier] ?? $tiers['anon'];
}

function ut_data_dir(): string
{
    return rtrim(ut_config()['data_dir'], '/');
}

function ut_blob_dir(string $sessionId): string
{
    return ut_data_dir() . '/blobs/' . $sessionId;
}
