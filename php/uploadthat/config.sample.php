<?php
/**
 * Copy to ~/uploadthat_config.php — OUTSIDE the document root — and edit.
 *
 * Nothing here is secret to the code, but `operator_key_hash` is a password
 * hash and must never live in the repository.
 *
 * Every key is optional; anything left out falls back to the defaults in
 * api/lib/config.php.
 */
return [
    // Where the SQLite file and the uploaded blobs live. Must be outside the
    // document root: that is what makes uploads unreachable by URL.
    'data_dir' => '/home/nteagvxe/uploadthat_data',

    // The kill switch. Set false to refuse new sessions without a deploy;
    // sessions already open keep working until they expire.
    'accepting_sessions' => true,

    // password_hash('your passphrase here', PASSWORD_DEFAULT)
    // PASSWORD_DEFAULT rather than a named algorithm, because Argon2 is not
    // compiled into every cPanel PHP. Leave null to disable the operator tier.
    'operator_key_hash' => null,

    // Once stored bytes pass `disk_soft_fraction` of this, anonymous sessions
    // and uploads are refused while operator sessions carry on.
    'global_bytes_ceiling' => 5 * 1024 * 1024 * 1024,
    'disk_soft_fraction' => 0.8,
];
