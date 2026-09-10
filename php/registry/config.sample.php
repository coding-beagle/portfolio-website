<?php
/**
 * Copy to ~/registry_config.php — OUTSIDE the document root — and edit.
 *
 * Nothing here is secret to the code, but `admin_password_hash` is a password
 * hash and must never live in the repository. Note that anything committed
 * once stays in the history.
 *
 * Every key is optional; anything left out falls back to the defaults in
 * api/lib/config.php.
 */
return [
    // Where the SQLite file and the uploaded artifacts live. Must be outside the
    // document root: that is what makes artifacts unreachable without a token,
    // and what stops the next deploy's `rm -rf` taking every release with it.
    'data_dir' => '/home/nteagvxe/registry_data',

    // The OUTPUT of password_hash(), not the password itself. Generate it
    // without putting the password in your shell history:
    //
    //   php -r '$p = trim(fgets(STDIN)); echo password_hash($p, PASSWORD_DEFAULT), PHP_EOL;'
    //
    // then type the password and press enter. The result starts with $2y$ or
    // $argon2. PASSWORD_DEFAULT rather than a named algorithm, because Argon2
    // is not compiled into every cPanel PHP.
    //
    // Left null, nothing can log in and the API answers only /health. That is
    // the intended failure mode for a missing config: an open update server
    // would be considerably worse than a closed one.
    'admin_password_hash' => null,

    // The kill switch. False keeps every download working and refuses every
    // upload and delete — how you freeze releases without taking clients
    // offline. No deploy needed; it is read on each request.
    'accepting_writes' => true,

    // How long a token from `nt auth login` lasts, in seconds.
    'token_ttl_seconds' => 30 * 24 * 60 * 60,

    // Per-artifact and whole-registry ceilings. The web server's own
    // upload_max_filesize/post_max_size usually bite first — GET /api/health
    // reports what they actually are.
    'max_artifact_bytes' => 512 * 1024 * 1024,
    'global_bytes_ceiling' => 5 * 1024 * 1024 * 1024,
    'disk_soft_fraction' => 0.9,
];
