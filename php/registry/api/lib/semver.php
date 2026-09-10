<?php
/**
 * Semantic versioning: parsing, and the precedence rules that decide which
 * release is "latest".
 *
 * Implemented rather than pulled in, because Composer on a cPanel deploy is a
 * lot of machinery to carry for one file, and because precedence is the only
 * part of the spec this server actually needs. It follows semver 2.0.0:
 * numeric identifiers compare numerically, alphanumeric ones compare in ASCII
 * order, numeric ranks below alphanumeric, a longer prerelease outranks a
 * shorter one it shares a prefix with, and build metadata is ignored entirely.
 */

declare(strict_types=1);

/**
 * Splits a version string into its parts, or null if it is not valid semver.
 *
 * Leading "v" is accepted and stripped: people type `v1.2.0` constantly, and
 * refusing it buys nothing but a support question.
 *
 * @return array{version:string,major:int,minor:int,patch:int,prerelease:string,build:string}|null
 */
function reg_semver_parse(string $version): ?array
{
    $text = trim($version);
    if ($text !== '' && ($text[0] === 'v' || $text[0] === 'V')) {
        $text = substr($text, 1);
    }

    // The pattern from the spec's own appendix: no leading zeroes on numeric
    // identifiers, which is what stops 1.01.0 and 1.1.0 being two names for
    // versions that would then sort as equal.
    $pattern = '/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)'
        . '(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)'
        . '(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?'
        . '(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/';

    if (preg_match($pattern, $text, $matches) !== 1) {
        return null;
    }

    return [
        'version' => $text,
        'major' => (int) $matches[1],
        'minor' => (int) $matches[2],
        'patch' => (int) $matches[3],
        'prerelease' => $matches[4] ?? '',
        'build' => $matches[5] ?? '',
    ];
}

function reg_semver_valid(string $version): bool
{
    return reg_semver_parse($version) !== null;
}

/** Whether a version is a prerelease, which is what `latest` skips by default. */
function reg_semver_is_prerelease(string $version): bool
{
    $parsed = reg_semver_parse($version);
    return $parsed !== null && $parsed['prerelease'] !== '';
}

/**
 * Compares two versions by semver precedence.
 *
 * @return int -1 if $a sorts before $b, 1 if after, 0 if they are equal in
 *             precedence — which build metadata never affects.
 */
function reg_semver_compare(string $a, string $b): int
{
    $left = reg_semver_parse($a);
    $right = reg_semver_parse($b);

    // Unparseable versions never reach the database, but comparing defensively
    // keeps this usable as a plain sort callback without a guard at every site.
    if ($left === null || $right === null) {
        return strcmp($a, $b) <=> 0;
    }

    foreach (['major', 'minor', 'patch'] as $part) {
        if ($left[$part] !== $right[$part]) {
            return $left[$part] <=> $right[$part];
        }
    }

    return reg_semver_compare_prerelease($left['prerelease'], $right['prerelease']);
}

/**
 * The prerelease half of precedence, which is where all the subtlety lives.
 *
 * An empty prerelease means a full release, and a full release always outranks
 * any prerelease of the same numbers — 1.0.0 is newer than 1.0.0-rc.1.
 */
function reg_semver_compare_prerelease(string $a, string $b): int
{
    if ($a === $b) {
        return 0;
    }
    if ($a === '') {
        return 1;
    }
    if ($b === '') {
        return -1;
    }

    $left = explode('.', $a);
    $right = explode('.', $b);
    $count = min(count($left), count($right));

    for ($i = 0; $i < $count; $i++) {
        $result = reg_semver_compare_identifier($left[$i], $right[$i]);
        if ($result !== 0) {
            return $result;
        }
    }

    // Every shared identifier matched, so the one with more of them wins:
    // 1.0.0-alpha.1 is ahead of 1.0.0-alpha.
    return count($left) <=> count($right);
}

/** One dot-separated prerelease identifier: numeric ranks below alphanumeric. */
function reg_semver_compare_identifier(string $a, string $b): int
{
    $aNumeric = ctype_digit($a);
    $bNumeric = ctype_digit($b);

    if ($aNumeric && $bNumeric) {
        return (int) $a <=> (int) $b;
    }
    if ($aNumeric !== $bNumeric) {
        return $aNumeric ? -1 : 1;
    }
    return strcmp($a, $b) <=> 0;
}

/**
 * The highest version in a list, newest first by precedence.
 *
 * @param string[] $versions
 */
function reg_semver_sort(array $versions): array
{
    usort($versions, static fn(string $a, string $b): int => reg_semver_compare($b, $a));
    return $versions;
}
