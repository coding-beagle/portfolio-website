<?php
/**
 * Rate limiting and the disk guard.
 *
 * A fixed window rather than a sliding one: at this scale the extra precision
 * would buy nothing, and a fixed window is two statements instead of a table
 * scan. The worst case is a caller getting up to double the limit across a
 * window boundary, which for "10 password attempts in 15 minutes" is not worth
 * solving.
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/config.php';

/** The window a bucket is currently counting in, or null if it has no rule. */
function reg_rate_window(string $kind): ?array
{
    $rule = reg_config()['rate_limits'][$kind] ?? null;
    if ($rule === null) {
        return null;
    }
    $window = (int) $rule['window'];
    return ['start' => intdiv(time(), $window) * $window, 'limit' => (int) $rule['limit']];
}

/**
 * Whether `$bucket` has already spent its window — without spending any of it.
 *
 * Separate from consuming so a check can gate expensive work (verifying a
 * password costs deliberate CPU) while only the outcome decides whether the
 * caller is charged. Logging in correctly should never use up the budget that
 * exists to slow down wrong guesses.
 */
function reg_rate_exceeded(string $bucket, string $kind): bool
{
    $window = reg_rate_window($kind);
    if ($window === null) {
        return false;
    }
    $statement = reg_db()->prepare(
        'SELECT count FROM rate_limits WHERE bucket = ? AND window_start = ?'
    );
    $statement->execute([$kind . ':' . $bucket, $window['start']]);
    return (int) $statement->fetchColumn() >= $window['limit'];
}

/** Charges `$bucket` for one attempt. */
function reg_rate_consume(string $bucket, string $kind): void
{
    $window = reg_rate_window($kind);
    if ($window === null) {
        return;
    }
    reg_db()->prepare(
        'INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1'
    )->execute([$kind . ':' . $bucket, $window['start']]);
}

/**
 * Charges `$bucket` for one attempt and reports whether it was allowed. For
 * limits where the attempt itself is what is being rationed rather than only
 * its failures.
 *
 * @return bool false when the caller has already used up the window
 */
function reg_rate_allow(string $bucket, string $kind): bool
{
    if (reg_rate_window($kind) === null) {
        return true;
    }
    if (reg_rate_exceeded($bucket, $kind)) {
        return false;
    }
    reg_rate_consume($bucket, $kind);
    return true;
}

/** Clears rate-limit rows from windows that are long over. */
function reg_rate_sweep(): int
{
    $longest = 0;
    foreach (reg_config()['rate_limits'] as $rule) {
        $longest = max($longest, (int) $rule['window']);
    }
    $statement = reg_db()->prepare('DELETE FROM rate_limits WHERE window_start < ?');
    $statement->execute([time() - ($longest * 2)]);
    return $statement->rowCount();
}

/** Total bytes held across every stored artifact. */
function reg_bytes_stored(): int
{
    return (int) reg_db()->query('SELECT COALESCE(SUM(size), 0) FROM artifacts')->fetchColumn();
}

/**
 * Whether the registry is close enough to its ceiling to warn about it. Reads
 * and deletes keep working; this only colours the health endpoint and the
 * browser UI, so there is warning before uploads start failing outright.
 */
function reg_disk_pressured(): bool
{
    $config = reg_config();
    $soft = (int) ($config['global_bytes_ceiling'] * $config['disk_soft_fraction']);
    return reg_bytes_stored() >= $soft;
}

function reg_disk_full(): bool
{
    return reg_bytes_stored() >= (int) reg_config()['global_bytes_ceiling'];
}
