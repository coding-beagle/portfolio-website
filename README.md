# Nicholas Teague's public portfolio website

## Scene previews:

### Snow:
![SNOW](python_scripts/outgifs/snow.gif)

### Rain:
![RAIN](python_scripts/outgifs/rain.gif)

### Plants:
![PLANTS](python_scripts/outgifs/plants.gif)

### Stars:
![STARS](python_scripts/outgifs/stars.gif)

### Boids:
![BOIDS](python_scripts/outgifs/boids.gif)

### Conway:
![CONWAY](python_scripts/outgifs/conway.gif)

### Hexapod:
![HEXAPOD](python_scripts/outgifs/hexapod.gif)

### Mandelbrot:
![MANDELBROT](python_scripts/outgifs/mandelbrot.gif)

### Fire:
![FIRE](python_scripts/outgifs/fire.gif)

### Fireworks:
![FIREWORKS](python_scripts/outgifs/fireworks.gif)

### Plinko:
![PLINKO](python_scripts/outgifs/plinko.gif)

### Gravitalorbs:
![GRAVITALORBS](python_scripts/outgifs/gravitalorbs.gif)

### Liquid:
![LIQUID](python_scripts/outgifs/liquid.gif)

### Life:
![LIFE](python_scripts/outgifs/life.gif)

### Raven:
![RAVEN](python_scripts/outgifs/raven.gif)

### Clocks:
![CLOCKS](python_scripts/outgifs/clocks.gif)

### Pinball:
![PINBALL](python_scripts/outgifs/pinball.gif)

### Ballpit:
![BALLPIT](python_scripts/outgifs/ballpit.gif)

### Pid:
![PID](python_scripts/outgifs/pid.gif)

## Hex tool

A second app built from the same `app/` source tree, for its own subdomain:
paste a hex or binary word and read it back in the other base, column by
column, with Verilog bit selects (`0xDEADBEEF[13]`, `[31:16]`, `[16 +: 16]`).

It shares the site's theming and mobile context by importing them directly.
`REACT_APP_TARGET=hextool` swaps the root component in `src/index.js`, so the
two apps are separate chunks and neither build ships the other's code. The same
page is also reachable from the portfolio at `/#/hextool`.

`make build_hextool` writes `app/build-hextool`, which is what the subdomain's
document root gets.

### Reaching it from the main site

The `desktop` scene (`?scene=desktop`) is a Windows XP desktop: the subdomain
utilities are shortcuts on it, and a Scenes folder holds every other scene, so
it doubles as a way around the rest of them. Double-click to open, or use the
start menu. Shortcuts drag around the desktop and snap to the grid, and the
folder is draggable and resizable.

The page's own theme and hide-UI buttons are suppressed while this scene is
showing — `Title` reports the current scene up to `App` for that — and the
desktop carries the same two controls as programs instead, which is what lets
the taskbar sit in the corner at XP's height rather than being pushed out of
the way of two floating circles.

The Luna chrome uses XP's own colours rather than the site theme's: the taskbar
blue, the green start button and the beige window face are the whole
recognition, and deriving them from the theme's cyan just produced a generic
blue desktop. The wallpaper is the exception — the Bliss hill is drawn from
`theme.secondaryAccent`, and the sky goes to dusk on the dark theme.

Every shortcut comes from `SUBDOMAIN_APPS` in `app/src/subdomains.js` — a new
utility is one entry there and nothing else. Give it a `localPath` and the
desktop still opens something when the site is being run from localhost, where
the subdomains do not exist. The same module's `homeHref()` is what the
utilities link back to.

## uploadthat

`uploadthat.nteague.com` is a file bridge: open a session on one device, join it
from another with a six-digit code or a QR scan, and move files across in either
direction. Everything is deleted when the session ends.

The front end is a third `REACT_APP_TARGET` build from the same tree; the API is
PHP over SQLite in `php/uploadthat`, copied into the build output by
`scripts/finish-uploadthat-build.js` — the deploy target wipes the document
root, so the API has to arrive as build output rather than be placed there once.

Files, their names and the shared note are encrypted in the browser and never
reach the server in the clear. The session key is generated on the device that
opens the session and never sent: a joining device gets it wrapped to a secret
the two devices derive between them over ECDH, and both show four digits from
the same transcript so a person can confirm nothing altered the exchange. A
join code on its own is not a credential — a device that presents one is
*pending*, and its token opens nothing until the owner admits it.

That means a lost tab is lost files: the key lives in memory only, so a reload
ends the session. It also means you cannot see what is passing through, which
is the deliberate trade for making it public.

### Setting it up on the server

1. Copy `php/uploadthat/config.sample.php` to `~/uploadthat_config.php` — outside
   the document root, and never into the repository. Set `data_dir` to a path
   that is also outside the document root; the API refuses to start otherwise,
   because uploads under the web root would be reachable by URL and wiped by the
   next deploy.
2. Set `operator_key_hash` with `password_hash('...', PASSWORD_DEFAULT)` to
   unlock the higher limits, or leave it null to disable that tier.
3. Add a cron job: `*/5 * * * * php ~/public_uploadthat_html/api/cli/sweep.php`.
   Culling still works without it — every request clears a few expired sessions
   — but the cron pass also catches orphaned blob directories. Send stderr to a
   file rather than `/dev/null`: a sweeper that fails silently fills the disk.
   Run it with `--all` to end every session immediately, expired or not, which
   is what you want after setting `accepting_sessions` to false.
4. Make sure AutoSSL covers the subdomain. Phase 2 needs `crypto.subtle`, which
   does not exist without HTTPS.

### Checking it works

`make test_uploadthat` exercises the store against a throwaway database, and
parses every PHP file first — the CLI scripts are not otherwise loaded by
anything, and a parse error with `display_errors` off prints nothing at all.

`api/cli/doctor.php` checks the things that have to be true on the server and
names the one that is not:

    php ~/public_uploadthat_html/api/cli/doctor.php

`make smoke_uploadthat` drives a deployed instance over real HTTP, which is the
only way to test the parts the unit tests cannot reach: the rewrite, whether the
`Authorization` header survives the trip to PHP, multipart upload and streamed
download. It opens a real session, so pass `OPERATOR_KEY=...` to avoid spending
one of the three anonymous sessions an IP gets per hour.

### Running it locally

Two terminals: `make run_uploadthat_api` serves the PHP on :8787, and
`make run_uploadthat` starts the dev server, which proxies `/api` to it.

## Make Commands:

`make install` -> Install JS deps

`make run` -> Run webpack to render website locally

`make run_hextool` -> Run the hex tool locally

`make build` -> Build the portfolio into `app/build`

`make build_hextool` -> Build the hex tool into `app/build-hextool`

`make build_all` -> Build both

`make test` -> Run the unit tests

`make clean` -> Clear out node_modules
