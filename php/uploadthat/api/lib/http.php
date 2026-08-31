<?php
/**
 * Request and response plumbing: JSON in, JSON out, and the headers that keep
 * anything a visitor uploads from ever being rendered by a browser.
 */

declare(strict_types=1);

/** Errors are `{error: {code, message}}`; `code` is what the client switches on. */
function ut_json(int $status, array $payload, array $headers = []): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    foreach ($headers as $name => $value) {
        header($name . ': ' . $value);
    }
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function ut_fail(int $status, string $code, string $message, array $extra = []): void
{
    ut_json($status, ['error' => array_merge(['code' => $code, 'message' => $message], $extra)]);
}

/** The decoded JSON body, or an empty array for requests that have none. */
function ut_body(): array
{
    static $body = null;
    if ($body !== null) {
        return $body;
    }
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return $body = [];
    }
    $decoded = json_decode($raw, true);
    return $body = is_array($decoded) ? $decoded : [];
}

function ut_bearer(): ?string
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($header === '' && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        foreach ($headers as $name => $value) {
            if (strcasecmp($name, 'Authorization') === 0) {
                $header = $value;
                break;
            }
        }
    }
    if (stripos($header, 'Bearer ') !== 0) {
        return null;
    }
    $token = trim(substr($header, 7));
    return $token === '' ? null : $token;
}

/**
 * The client address, used only as a rate-limit bucket.
 *
 * Proxy headers are deliberately not trusted: on shared hosting anyone can send
 * an X-Forwarded-For, and honouring it would let a caller pick their own bucket
 * and walk straight past every limit.
 */
function ut_client_ip(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

/**
 * PHP discards the whole body — $_POST and $_FILES included — when a request
 * exceeds post_max_size, so an oversized upload arrives looking like an empty
 * one. Content-Length is the only thing left to recognise it by.
 */
function ut_post_was_truncated(): bool
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        return false;
    }
    if (!empty($_POST) || !empty($_FILES)) {
        return false;
    }
    $length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    return $length > 0 && $length > ut_bytes_ini('post_max_size');
}

/** An ini size such as "8M" as a byte count. */
function ut_bytes_ini(string $key): int
{
    $value = trim((string) ini_get($key));
    if ($value === '') {
        return 0;
    }
    $unit = strtolower(substr($value, -1));
    $number = (int) $value;
    switch ($unit) {
        case 'g': return $number * 1024 * 1024 * 1024;
        case 'm': return $number * 1024 * 1024;
        case 'k': return $number * 1024;
        default: return $number;
    }
}
