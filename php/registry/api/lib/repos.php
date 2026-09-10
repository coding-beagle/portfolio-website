<?php
/**
 * Repositories, versions and artifacts: everything that touches the database or
 * the blob directory, so the router stays a router.
 *
 * The shape is three levels deep. A *repo* is one project. A *version* is one
 * semver release of it. An *artifact* is one file within that release, keyed by
 * *platform* — which is how a single release can carry a Linux build and a
 * Windows build without the client having to guess at filenames.
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/semver.php';

/** The platform used when an upload does not name one. */
const REG_DEFAULT_PLATFORM = 'any';

/**
 * Repo names go in URLs and become directory names, so they are kept to a
 * conservative set: lower case, and no leading dot or dash that could read as
 * a flag or hide a file.
 */
function reg_valid_repo_name(string $name): bool
{
    return preg_match('/^[a-z0-9][a-z0-9._-]{0,63}$/', $name) === 1
        && !str_contains($name, '..');
}

function reg_valid_platform(string $platform): bool
{
    return preg_match('/^[a-z0-9][a-z0-9._-]{0,31}$/', $platform) === 1
        && !str_contains($platform, '..');
}

// --- repos ---------------------------------------------------------------

/**
 * Creates a repo.
 *
 * @return array{id:string,name:string}|null null if the name is already taken
 */
function reg_repo_create(string $name, string $description = ''): ?array
{
    if (reg_repo_find($name) !== null) {
        return null;
    }

    $now = time();
    $id = reg_uuid();
    reg_db()->prepare(
        'INSERT INTO repos (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    )->execute([$id, $name, substr($description, 0, 500), $now, $now]);

    return ['id' => $id, 'name' => $name];
}

function reg_repo_find(string $name): ?array
{
    $statement = reg_db()->prepare('SELECT * FROM repos WHERE name = ?');
    $statement->execute([$name]);
    $row = $statement->fetch();
    return $row === false ? null : $row;
}

/** Every repo, with the counts and the latest release the listing shows. */
function reg_repo_list(): array
{
    $rows = reg_db()->query('SELECT * FROM repos ORDER BY name')->fetchAll();
    return array_map(reg_repo_summary(...), $rows);
}

/**
 * The JSON shape of one repo.
 *
 * `latest` is resolved the same way `-v latest` resolves it — full releases
 * only — so what the listing calls latest is what a client would actually be
 * handed. `latestPrerelease` is reported alongside rather than folded in, so a
 * staged release is visible without ever being served by accident.
 */
function reg_repo_summary(array $repo): array
{
    $versions = reg_version_list($repo['id']);
    $stable = reg_version_resolve($repo['id'], 'latest', false);
    $any = reg_version_resolve($repo['id'], 'latest', true);

    $bytes = reg_db()->prepare(
        'SELECT COALESCE(SUM(a.size), 0) FROM artifacts a
         JOIN versions v ON v.id = a.version_id WHERE v.repo_id = ?'
    );
    $bytes->execute([$repo['id']]);

    return [
        'name' => $repo['name'],
        'description' => $repo['description'],
        'versionCount' => count($versions),
        'latest' => $stable === null ? null : $stable['version'],
        'latestPrerelease' => ($any !== null && $any['prerelease'] !== '') ? $any['version'] : null,
        'bytesUsed' => (int) $bytes->fetchColumn(),
        'createdAt' => (int) $repo['created_at'],
        'updatedAt' => (int) $repo['updated_at'],
    ];
}

/** Deletes a repo, every version in it, and every byte on disk. */
function reg_repo_delete(string $name): bool
{
    $repo = reg_repo_find($name);
    if ($repo === null) {
        return false;
    }

    // Rows first: the cascade takes versions and artifacts with the repo, and a
    // crash between the two leaves orphan directories that the sweeper knows
    // how to find. The reverse order would leave rows pointing at nothing,
    // which is the failure that actually breaks clients.
    $statement = reg_db()->prepare('DELETE FROM repos WHERE id = ?');
    $statement->execute([$repo['id']]);

    reg_rmtree(reg_data_dir() . '/blobs/' . $repo['id']);
    return true;
}

function reg_repo_touch(string $repoId): void
{
    reg_db()->prepare('UPDATE repos SET updated_at = ? WHERE id = ?')->execute([time(), $repoId]);
}

// --- versions ------------------------------------------------------------

/**
 * Every version of a repo, newest first by semver precedence.
 *
 * Ordered in PHP rather than SQL because prerelease precedence is a
 * dot-separated identifier comparison that SQL cannot express. The list is
 * small — one project's releases — so this costs nothing worth optimising.
 */
function reg_version_list(string $repoId): array
{
    $statement = reg_db()->prepare('SELECT * FROM versions WHERE repo_id = ?');
    $statement->execute([$repoId]);
    $rows = $statement->fetchAll();

    usort($rows, static fn(array $a, array $b): int => reg_semver_compare($b['version'], $a['version']));
    return $rows;
}

function reg_version_find(string $repoId, string $version): ?array
{
    $parsed = reg_semver_parse($version);
    if ($parsed === null) {
        return null;
    }

    // Matched on the normalised text, so `v1.2.0` finds the row stored as
    // `1.2.0` instead of reporting a version that is plainly there as missing.
    $statement = reg_db()->prepare('SELECT * FROM versions WHERE repo_id = ? AND version = ?');
    $statement->execute([$repoId, $parsed['version']]);
    $row = $statement->fetch();
    return $row === false ? null : $row;
}

/**
 * Turns whatever the client asked for into a version row.
 *
 * `latest` is the interesting case, and the reason this is one function rather
 * than a branch at every call site: an auto-updater asks for `latest` on every
 * check, and it must mean the same thing on the download path as it did on the
 * listing that sent the client there.
 *
 * @param bool $includePrerelease true only when the caller opted in. A
 *        prerelease is never what `latest` means by default — that is the whole
 *        point of tagging one.
 */
function reg_version_resolve(string $repoId, string $spec, bool $includePrerelease = false): ?array
{
    if (strtolower(trim($spec)) !== 'latest') {
        return reg_version_find($repoId, $spec);
    }

    foreach (reg_version_list($repoId) as $row) {
        if ($includePrerelease || $row['prerelease'] === '') {
            return $row;
        }
    }
    return null;
}

/**
 * Finds a version, creating it if this is the first artifact for it.
 *
 * Versions are not created on their own: an empty release is not a thing a
 * client can be given, so one comes into existence with its first upload.
 *
 * @return array{row:array,created:bool}|null null if `$version` is not semver
 */
function reg_version_ensure(string $repoId, string $version, string $notes = ''): ?array
{
    $parsed = reg_semver_parse($version);
    if ($parsed === null) {
        return null;
    }

    $existing = reg_version_find($repoId, $parsed['version']);
    if ($existing !== null) {
        if ($notes !== '') {
            reg_db()->prepare('UPDATE versions SET notes = ? WHERE id = ?')
                ->execute([substr($notes, 0, 4000), $existing['id']]);
            $existing['notes'] = $notes;
        }
        return ['row' => $existing, 'created' => false];
    }

    $id = reg_uuid();
    reg_db()->prepare(
        'INSERT INTO versions (id, repo_id, version, major, minor, patch, prerelease, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $id,
        $repoId,
        $parsed['version'],
        $parsed['major'],
        $parsed['minor'],
        $parsed['patch'],
        $parsed['prerelease'],
        substr($notes, 0, 4000),
        time(),
    ]);

    return ['row' => reg_version_find($repoId, $parsed['version']), 'created' => true];
}

/** Deletes one version and every artifact in it. */
function reg_version_delete(string $repoId, string $version): bool
{
    $row = reg_version_find($repoId, $version);
    if ($row === null) {
        return false;
    }

    $statement = reg_db()->prepare('DELETE FROM versions WHERE id = ?');
    $statement->execute([$row['id']]);

    reg_rmtree(reg_blob_dir($repoId, $row['id']));
    reg_repo_touch($repoId);
    return true;
}

/** The JSON shape of one version, artifacts included. */
function reg_version_view(array $version): array
{
    return [
        'version' => $version['version'],
        'prerelease' => $version['prerelease'] !== '',
        'notes' => $version['notes'],
        'createdAt' => (int) $version['created_at'],
        'artifacts' => array_map(reg_artifact_view(...), reg_artifact_list($version['id'])),
    ];
}

// --- artifacts -----------------------------------------------------------

function reg_artifact_list(string $versionId): array
{
    $statement = reg_db()->prepare('SELECT * FROM artifacts WHERE version_id = ? ORDER BY platform');
    $statement->execute([$versionId]);
    return $statement->fetchAll();
}

function reg_artifact_find(string $versionId, string $platform): ?array
{
    $statement = reg_db()->prepare('SELECT * FROM artifacts WHERE version_id = ? AND platform = ?');
    $statement->execute([$versionId, $platform]);
    $row = $statement->fetch();
    return $row === false ? null : $row;
}

/**
 * The one artifact of a version, when the caller did not say which.
 *
 * `nt repo x pull -v 1.0.0` with no --platform is the common case, and it
 * should work whenever there is no ambiguity to resolve. Falls back to the
 * default platform if that is one of several.
 *
 * @return array{row:array}|array{ambiguous:string[]}|null
 */
function reg_artifact_only(string $versionId): array|null
{
    $all = reg_artifact_list($versionId);
    if ($all === []) {
        return null;
    }
    if (count($all) === 1) {
        return ['row' => $all[0]];
    }
    foreach ($all as $row) {
        if ($row['platform'] === REG_DEFAULT_PLATFORM) {
            return ['row' => $row];
        }
    }
    return ['ambiguous' => array_column($all, 'platform')];
}

function reg_artifact_view(array $artifact): array
{
    return [
        'platform' => $artifact['platform'],
        'filename' => $artifact['filename'],
        'contentType' => $artifact['content_type'],
        'size' => (int) $artifact['size'],
        'sha256' => $artifact['sha256'],
        'createdAt' => (int) $artifact['created_at'],
    ];
}

function reg_artifact_path(string $repoId, string $versionId, string $artifactId): string
{
    return reg_blob_dir($repoId, $versionId) . '/' . $artifactId;
}

/**
 * Stores an uploaded file as the artifact for one platform of one version,
 * replacing whatever was there before.
 *
 * Replacing rather than refusing, because re-running a release build after
 * spotting a mistake is normal and having to delete first would be friction for
 * nothing. The old bytes go only once the new ones are safely on disk.
 *
 * @param bool $uploaded true when `$sourcePath` is a PHP upload temp file. The
 *        web path passes true, which routes the move through
 *        move_uploaded_file — the check that refuses any path PHP did not
 *        receive itself. Tests pass false and the file is copied instead. It is
 *        the one thing the two entry points genuinely need to do differently.
 * @return array{platform:string,replaced:bool,sha256:string,size:int}
 */
function reg_artifact_store(
    array $repo,
    array $version,
    string $platform,
    string $filename,
    string $sourcePath,
    int $size,
    string $contentType = 'application/octet-stream',
    bool $uploaded = true,
): array {
    $directory = reg_blob_dir($repo['id'], $version['id']);
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Cannot create blob directory: ' . $directory);
    }

    $artifactId = reg_uuid();
    $destination = $directory . '/' . $artifactId;

    $moved = $uploaded
        ? move_uploaded_file($sourcePath, $destination)
        : copy($sourcePath, $destination);
    if (!$moved) {
        throw new RuntimeException('Could not store the artifact.');
    }
    @chmod($destination, 0600);

    // Hashed after landing rather than from the temp file, so the checksum
    // describes the bytes that will actually be served back.
    $sha256 = hash_file('sha256', $destination);

    $existing = reg_artifact_find($version['id'], $platform);

    try {
        if ($existing !== null) {
            reg_db()->prepare(
                'UPDATE artifacts SET id = ?, filename = ?, content_type = ?, size = ?, sha256 = ?, created_at = ?
                 WHERE id = ?'
            )->execute([
                $artifactId, $filename, $contentType, $size, $sha256, time(), $existing['id'],
            ]);
            @unlink($directory . '/' . $existing['id']);
        } else {
            reg_db()->prepare(
                'INSERT INTO artifacts (id, version_id, platform, filename, content_type, size, sha256, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $artifactId, $version['id'], $platform, $filename, $contentType, $size, $sha256, time(),
            ]);
        }
    } catch (Throwable $error) {
        // The row is what makes the artifact real, so a failed write must not
        // leave bytes behind that nothing points at.
        @unlink($destination);
        throw $error;
    }

    reg_repo_touch($repo['id']);

    return [
        'platform' => $platform,
        'replaced' => $existing !== null,
        'sha256' => $sha256,
        'size' => $size,
    ];
}

/**
 * Deletes one artifact, and the version with it if that was the last one.
 *
 * An empty version is not something a client can be handed, so leaving one
 * behind would only make the listing lie about what is downloadable.
 */
function reg_artifact_delete(array $repo, array $version, string $platform): bool
{
    $artifact = reg_artifact_find($version['id'], $platform);
    if ($artifact === null) {
        return false;
    }

    reg_db()->prepare('DELETE FROM artifacts WHERE id = ?')->execute([$artifact['id']]);
    @unlink(reg_artifact_path($repo['id'], $version['id'], $artifact['id']));

    if (reg_artifact_list($version['id']) === []) {
        reg_version_delete($repo['id'], $version['version']);
    }

    reg_repo_touch($repo['id']);
    return true;
}

// --- housekeeping --------------------------------------------------------

/**
 * Removes blob directories with no row behind them.
 *
 * What catches a crash between deleting a row and deleting its files: the
 * cascade means rows can vanish in one statement while the bytes are removed in
 * several, and without this those bytes are invisible and permanent.
 */
function reg_sweep_orphans(): int
{
    $root = reg_data_dir() . '/blobs';
    if (!is_dir($root)) {
        return 0;
    }

    $liveRepos = reg_db()->query('SELECT id FROM repos')->fetchAll(PDO::FETCH_COLUMN);
    $removed = 0;

    foreach (glob($root . '/*', GLOB_ONLYDIR) ?: [] as $repoDir) {
        $repoId = basename($repoDir);
        if (!in_array($repoId, $liveRepos, true)) {
            reg_rmtree($repoDir);
            $removed++;
            continue;
        }

        $versions = reg_db()->prepare('SELECT id FROM versions WHERE repo_id = ?');
        $versions->execute([$repoId]);
        $liveVersions = $versions->fetchAll(PDO::FETCH_COLUMN);

        foreach (glob($repoDir . '/*', GLOB_ONLYDIR) ?: [] as $versionDir) {
            if (!in_array(basename($versionDir), $liveVersions, true)) {
                reg_rmtree($versionDir);
                $removed++;
            }
        }
    }

    return $removed;
}

/** Removes a directory and everything under it. */
function reg_rmtree(string $path): void
{
    if (!is_dir($path)) {
        return;
    }
    foreach (scandir($path) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }
        $child = $path . '/' . $entry;
        is_dir($child) ? reg_rmtree($child) : @unlink($child);
    }
    @rmdir($path);
}
