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

/** The window a bucket is currently counting in, or null if it has no rule. */
function ut_rate_window(string $kind): ?array
{
    $rule = ut_config()['rate_limits'][$kind] ?? null;
    if ($rule === null) {
        return null;
    }
    $window = (int) $rule['window'];
    return ['start' => intdiv(time(), $window) * $window, 'limit' => (int) $rule['limit']];
}

/**
 * Whether `$bucket` has already spent its window — without spending any of it.
 *
 * Separate from consuming so that a check can gate expensive work (verifying a
 * password costs deliberate CPU) while only the outcome decides whether the
 * caller is charged for the attempt.
 */
function ut_rate_exceeded(string $bucket, string $kind): bool
{
    $window = ut_rate_window($kind);
    if ($window === null) {
        return false;
    }
    $statement = ut_db()->prepare(
        'SELECT count FROM rate_limits WHERE bucket = ? AND window_start = ?'
    );
    $statement->execute([$kind . ':' . $bucket, $window['start']]);
    return (int) $statement->fetchColumn() >= $window['limit'];
}

/** Charges `$bucket` for one attempt. */
function ut_rate_consume(string $bucket, string $kind): void
{
    $window = ut_rate_window($kind);
    if ($window === null) {
        return;
    }
    ut_db()->prepare(
        'INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1'
    )->execute([$kind . ':' . $bucket, $window['start']]);
}

/**
 * Charges `$bucket` for one attempt and reports whether it was allowed. For
 * limits where the attempt itself is the thing being rationed — opening
 * sessions, trying join codes — rather than only its failures.
 *
 * @return bool false when the caller has already used up the window
 */
function ut_rate_allow(string $bucket, string $kind): bool
{
    if (ut_rate_window($kind) === null) {
        return true;
    }
    if (ut_rate_exceeded($bucket, $kind)) {
        return false;
    }
    ut_rate_consume($bucket, $kind);
    return true;
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
