<?php
/**
 * Request and response as plain values, so the API can be exercised without a
 * socket.
 *
 * This is the difference between this app and a typical PHP front controller.
 * Handlers here never touch a superglobal, never call header(), and never
 * exit — they take a RegRequest and return a RegResponse. Serving a real
 * request is then two thin adapters at the edges (`fromGlobals` and
 * `reg_emit`), and the test suite drives the very same routing, auth and
 * validation code in-process, with no server to start and no port to pick.
 */

declare(strict_types=1);

/**
 * One inbound request.
 *
 * Header names are normalised to lower case on the way in, so a lookup never
 * has to guess how the web server capitalised them.
 */
final class RegRequest
{
    /** @param array<string,string> $query
     *  @param array<string,string> $headers
     *  @param array<string,string> $post
     *  @param array<string,array{path:string,name:string,size:int,type:string,uploaded:bool}> $files
     */
    public function __construct(
        public readonly string $method = 'GET',
        public readonly string $path = '/',
        public readonly array $query = [],
        public readonly array $headers = [],
        public readonly string $body = '',
        public readonly array $post = [],
        public readonly array $files = [],
        public readonly string $ip = '127.0.0.1',
        /**
         * Whether the body was truncated before PHP ever saw it. An upload over
         * post_max_size arrives looking like an empty request rather than a
         * failed one, and Content-Length is the only thing left to notice it by.
         */
        public readonly bool $truncated = false,
    ) {
    }

    public static function fromGlobals(): self
    {
        $uri = $_SERVER['REQUEST_URI'] ?? '/';
        $path = parse_url($uri, PHP_URL_PATH) ?: '/';

        $files = [];
        foreach ($_FILES as $field => $file) {
            if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
                continue;
            }
            $files[$field] = [
                'path' => (string) $file['tmp_name'],
                'name' => (string) ($file['name'] ?? 'artifact'),
                'size' => (int) ($file['size'] ?? 0),
                'type' => (string) ($file['type'] ?? 'application/octet-stream'),
                // True only here. It is what tells the store to use
                // move_uploaded_file, which refuses anything PHP did not
                // receive itself — the guard that stops a crafted path being
                // passed off as an upload.
                'uploaded' => true,
            ];
        }

        return new self(
            method: strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            path: $path,
            query: array_map(strval(...), $_GET),
            headers: reg_request_headers(),
            body: (string) (file_get_contents('php://input') ?: ''),
            post: array_filter($_POST, is_scalar(...)),
            files: $files,
            ip: (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'),
            truncated: reg_post_was_truncated(),
        );
    }

    /** The named header, lower-cased lookup, or `$default`. */
    public function header(string $name, string $default = ''): string
    {
        return $this->headers[strtolower($name)] ?? $default;
    }

    public function query(string $name, string $default = ''): string
    {
        return $this->query[$name] ?? $default;
    }

    /** The decoded JSON body, or an empty array when there is none. */
    public function json(): array
    {
        if ($this->body === '') {
            return [];
        }
        $decoded = json_decode($this->body, true);
        return is_array($decoded) ? $decoded : [];
    }

    /** The bearer token, or null. */
    public function bearer(): ?string
    {
        $header = $this->header('authorization');
        if (stripos($header, 'Bearer ') !== 0) {
            return null;
        }
        $token = trim(substr($header, 7));
        return $token === '' ? null : $token;
    }
}

/**
 * One outbound response.
 *
 * A body is either a string or, for downloads, a path to stream — held as a
 * path rather than read into memory so that serving a 500 MB artifact does not
 * need 500 MB of PHP heap.
 */
final class RegResponse
{
    /** @param array<string,string> $headers */
    public function __construct(
        public readonly int $status = 200,
        public readonly array $headers = [],
        public readonly string $body = '',
        public readonly ?string $streamPath = null,
    ) {
    }

    public static function json(int $status, array $payload, array $headers = []): self
    {
        return new self(
            status: $status,
            headers: array_merge(['Content-Type' => 'application/json; charset=utf-8'], $headers),
            body: (string) json_encode($payload, JSON_UNESCAPED_SLASHES),
        );
    }

    /** Errors are `{error: {code, message}}`; `code` is what a client switches on. */
    public static function error(int $status, string $code, string $message, array $extra = []): self
    {
        return self::json($status, ['error' => array_merge(
            ['code' => $code, 'message' => $message],
            $extra
        )]);
    }

    /**
     * An artifact, streamed.
     *
     * Always a download and never a render: an update server hands out
     * executables, and nothing it stores should be able to run in a browser on
     * the domain that served it.
     */
    public static function download(string $path, string $filename, string $sha256 = ''): self
    {
        $headers = [
            'Content-Type' => 'application/octet-stream',
            'Content-Length' => (string) filesize($path),
            'Content-Disposition' => 'attachment; filename="' . reg_safe_filename($filename) . '"',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ];
        if ($sha256 !== '') {
            // Lets a client verify what it just downloaded without a second
            // request for the metadata it already had.
            $headers['X-Checksum-SHA256'] = $sha256;
        }
        return new self(status: 200, headers: $headers, streamPath: $path);
    }

    /** The decoded body. For tests, which assert on payloads rather than text. */
    public function decoded(): array
    {
        $decoded = json_decode($this->body, true);
        return is_array($decoded) ? $decoded : [];
    }

    /** The error code from an error envelope, or '' for a success. */
    public function errorCode(): string
    {
        return (string) ($this->decoded()['error']['code'] ?? '');
    }
}

/**
 * Sends a response and ends the request. The only place in the app that writes
 * to the wire.
 */
function reg_emit(RegResponse $response): void
{
    http_response_code($response->status);

    // Applied to everything: no artifact metadata should sit in a shared cache,
    // and nosniff matters most on the download path, where a browser guessing
    // at content type is exactly what we are trying to prevent.
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    foreach ($response->headers as $name => $value) {
        header($name . ': ' . $value);
    }

    if ($response->streamPath !== null) {
        // Any buffered output would be prepended to the bytes and corrupt the
        // artifact, so the buffers go before a single byte of it is written.
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        readfile($response->streamPath);
        return;
    }

    echo $response->body;
}

/** Every request header, lower-cased. */
function reg_request_headers(): array
{
    $headers = [];

    if (function_exists('apache_request_headers')) {
        foreach (apache_request_headers() as $name => $value) {
            $headers[strtolower($name)] = (string) $value;
        }
    }

    foreach ($_SERVER as $key => $value) {
        if (strncmp($key, 'HTTP_', 5) === 0) {
            $name = strtolower(str_replace('_', '-', substr($key, 5)));
            $headers[$name] = (string) $value;
        }
    }

    // Some cPanel setups strip Authorization before PHP sees it; the .htaccess
    // puts it back under this name, and it is the only copy that survives.
    if (!isset($headers['authorization'])) {
        $fallback = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if ($fallback !== '') {
            $headers['authorization'] = (string) $fallback;
        }
    }

    return $headers;
}

/**
 * PHP discards the whole body — $_POST and $_FILES included — when a request
 * exceeds post_max_size, so an oversized upload arrives looking like an empty
 * one. Content-Length is the only thing left to recognise it by.
 */
function reg_post_was_truncated(): bool
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        return false;
    }
    if (!empty($_POST) || !empty($_FILES)) {
        return false;
    }
    $length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    return $length > 0 && $length > reg_bytes_ini('post_max_size');
}

/** An ini size such as "8M" as a byte count. */
function reg_bytes_ini(string $key): int
{
    $value = trim((string) ini_get($key));
    if ($value === '') {
        return 0;
    }
    $unit = strtolower(substr($value, -1));
    $number = (int) $value;
    return match ($unit) {
        'g' => $number * 1024 * 1024 * 1024,
        'm' => $number * 1024 * 1024,
        'k' => $number * 1024,
        default => $number,
    };
}

/**
 * A filename safe to put in a Content-Disposition header.
 *
 * A quote or a newline in there is a header injection, and the name came from
 * whoever uploaded the file.
 */
function reg_safe_filename(string $name): string
{
    $clean = preg_replace('/[^A-Za-z0-9._-]+/', '_', basename($name)) ?? 'artifact';
    return $clean === '' ? 'artifact' : substr($clean, 0, 120);
}
