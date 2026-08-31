<?php
/**
 * Rate limiting and the disk guard.
 *
 * A fixed window rather than a sliding one: at this scale the extra precision
 * would buy nothing, and a fixed window is two statements instead of a table
 * scan. The worst case is a caller getting up to double the limit across a
 * window boundary, which for "3 sessions an hour" is not worth solving.
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/config.php';

/**
 * Records one use of `$bucket` and reports whether it was allowed.
 *
 * @return bool false when the caller has already used up the window
 */
function ut_rate_allow(string $bucket, string $kind): bool
{
    $rule = ut_config()['rate_limits'][$kind] ?? null;
    if ($rule === null) {
        return true;
    }

    $window = (int) $rule['window'];
    $start = intdiv(time(), $window) * $window;
    $key = $kind . ':' . $bucket;
    $pdo = ut_db();

    $pdo->prepare(
        'INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1'
    )->execute([$key, $start]);

    $statement = $pdo->prepare('SELECT count FROM rate_limits WHERE bucket = ? AND window_start = ?');
    $statement->execute([$key, $start]);
    $count = (int) $statement->fetchColumn();

    return $count <= (int) $rule['limit'];
}

/** Total bytes held across every live session. */
function ut_bytes_stored(): int
{
    return (int) ut_db()->query('SELECT COALESCE(SUM(bytes_used), 0) FROM sessions')->fetchColumn();
}

/**
 * Whether the disk is tight enough to start turning anonymous traffic away.
 * This is what "prioritise my files" means in practice: when space runs low,
 * strangers lose first and operator sessions carry on.
 */
function ut_disk_pressured(): bool
{
    $config = ut_config();
    $soft = (int) ($config['global_bytes_ceiling'] * $config['disk_soft_fraction']);
    return ut_bytes_stored() >= $soft;
}

function ut_disk_full(): bool
{
    return ut_bytes_stored() >= (int) ut_config()['global_bytes_ceiling'];
}
