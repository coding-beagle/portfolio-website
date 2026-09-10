<?php
/**
 * Router script for PHP's built-in server, so `php -S` serves the same shape
 * the deployed subdomain does: the management UI at /, the API under /api.
 *
 * Only for local development. On the real host Apache does this with the
 * .htaccess files, and this file is never deployed.
 */

declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if ($path === '/api' || strncmp($path, '/api/', 5) === 0) {
    require __DIR__ . '/../api/index.php';
    return true;
}

// Anything that exists under public/ is served as-is. Returning false hands it
// back to the built-in server, which knows the content types already.
$file = realpath(__DIR__ . '/../public' . $path);
$root = realpath(__DIR__ . '/../public');
if ($file !== false && $root !== false && str_starts_with($file, $root) && is_file($file)) {
    return false;
}

header('Content-Type: text/html; charset=utf-8');
readfile(__DIR__ . '/../public/index.html');
return true;
