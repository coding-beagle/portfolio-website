<?php
/**
 * The registry API — the web entry point.
 *
 * Deliberately thin. All it does is turn the current request into a RegRequest,
 * hand it to reg_handle(), and write the RegResponse back out. Everything
 * interesting lives in lib/router.php, where it can be tested without a server.
 *
 * Single front controller behind an .htaccess rewrite; every path under /api
 * arrives here.
 */

declare(strict_types=1);

// Never render a stack trace to a caller: on a misconfigured host it would leak
// absolute paths. Failures go to the error log and come back as a plain 500.
ini_set('display_errors', '0');
ini_set('log_errors', '1');

require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/router.php';

// Warnings become exceptions, so a failed write or a bad path is caught by the
// handler below rather than printing a notice into the middle of a JSON body.
set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if ((error_reporting() & $severity) === 0) {
        return false;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

try {
    reg_emit(reg_handle(RegRequest::fromGlobals()));
} catch (Throwable $error) {
    error_log('[registry] ' . $error->getMessage() . ' @ ' . $error->getFile() . ':' . $error->getLine());
    reg_emit(RegResponse::error(500, 'server_error', 'Something went wrong on the server.'));
}
