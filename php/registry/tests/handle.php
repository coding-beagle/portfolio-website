<?php
/**
 * The API as a pipe: one JSON request on stdin, one JSON response on stdout.
 *
 *   echo '{"method":"GET","path":"/api/health"}' | php tests/handle.php
 *
 * This exists so things that are not PHP can be tested against the real API
 * without one running. The `nt` CLI's integration tests drive it through here:
 * they exercise the actual routing, auth and storage code — not a mock of it,
 * which could drift from the real thing and quietly stop testing anything —
 * with no server, no port and no network in the way.
 *
 * Every request is a fresh process, so it is slow by the standards of a unit
 * test and fast by the standards of deploying something. Not for production;
 * never deployed. See tests/README-testing notes in php/registry/README.md.
 *
 * Request fields, all optional but `path`:
 *   method, path, query{}, headers{}, body, post{}, ip, truncated
 *   file: {path, name, type}   — a real file on disk, copied as an upload
 *
 * Response fields: status, headers{}, body (base64), binary (bool)
 */

declare(strict_types=1);

if (isset($_SERVER['REQUEST_METHOD'])) {
    http_response_code(404);
    exit;
}

ini_set('display_errors', 'stderr');
ini_set('error_reporting', (string) E_ALL);

require_once __DIR__ . '/../api/lib/router.php';

$raw = stream_get_contents(STDIN);
$spec = json_decode($raw === false ? '' : $raw, true);
if (!is_array($spec)) {
    fwrite(STDERR, "handle.php: expected a JSON request object on stdin\n");
    exit(1);
}

$files = [];
if (isset($spec['file']) && is_array($spec['file'])) {
    $path = (string) $spec['file']['path'];
    $files['file'] = [
        'path' => $path,
        'name' => (string) ($spec['file']['name'] ?? basename($path)),
        'size' => is_file($path) ? (int) filesize($path) : 0,
        'type' => (string) ($spec['file']['type'] ?? 'application/octet-stream'),
        // False, so the store copies rather than calling move_uploaded_file,
        // which rightly refuses any path PHP did not receive as an upload.
        'uploaded' => false,
    ];
}

try {
    $response = reg_handle(new RegRequest(
        method: strtoupper((string) ($spec['method'] ?? 'GET')),
        path: (string) ($spec['path'] ?? '/'),
        query: array_map(strval(...), $spec['query'] ?? []),
        headers: array_change_key_case($spec['headers'] ?? [], CASE_LOWER),
        body: (string) ($spec['body'] ?? ''),
        post: array_map(strval(...), $spec['post'] ?? []),
        files: $files,
        ip: (string) ($spec['ip'] ?? '127.0.0.1'),
        truncated: (bool) ($spec['truncated'] ?? false),
    ));
} catch (Throwable $error) {
    fwrite(STDERR, 'handle.php: ' . $error->getMessage()
        . ' @ ' . $error->getFile() . ':' . $error->getLine() . PHP_EOL);
    exit(1);
}

// Base64 because an artifact is arbitrary bytes and this channel is JSON.
$body = $response->streamPath !== null
    ? (string) file_get_contents($response->streamPath)
    : $response->body;

echo json_encode([
    'status' => $response->status,
    'headers' => $response->headers,
    'body' => base64_encode($body),
    'binary' => $response->streamPath !== null,
]);
