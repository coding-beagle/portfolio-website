// Post-build step for the uploadthat bundle.
//
// Does what the hex tool's step does — prune the portfolio assets CRA copies
// out of the shared public/ folder, and retitle the document — and then copies
// the PHP API in alongside the front end.
//
// That last part matters: the deploy target wipes the document root, so the API
// has to arrive as build output rather than as something placed there by hand
// once. The data directory survives only because it lives outside the document
// root, which is also what keeps uploads unreachable by URL.
const fs = require("fs");
const path = require("path");

const BUILD_DIR = path.join(__dirname, "..", "build-uploadthat");
const PHP_DIR = path.join(__dirname, "..", "..", "php", "uploadthat");

const KEEP = new Set([
  "index.html",
  "asset-manifest.json",
  "manifest.json",
  "favicon.ico",
  "logo192.png",
  "robots.txt",
  "static",
]);

const TITLE = "uploadthat";
const DESCRIPTION =
  "Open a session, join from another device, and move files across. Deleted when the session ends.";

function prune() {
  let removed = 0;
  for (const entry of fs.readdirSync(BUILD_DIR)) {
    if (KEEP.has(entry)) continue;
    fs.rmSync(path.join(BUILD_DIR, entry), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

function retitle() {
  const file = path.join(BUILD_DIR, "index.html");
  const html = fs
    .readFileSync(file, "utf8")
    .replace(/<title>[^<]*<\/title>/, `<title>${TITLE}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${DESCRIPTION}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${TITLE}$2`)
    .replace(/<meta property="og:image[^>]*>/g, "")
    .replace(/<meta property="og:url"[^>]*>/, "");
  fs.writeFileSync(file, html);
}

function copyApi() {
  fs.cpSync(path.join(PHP_DIR, "api"), path.join(BUILD_DIR, "api"), { recursive: true });
  fs.copyFileSync(
    path.join(PHP_DIR, "htaccess.root"),
    path.join(BUILD_DIR, ".htaccess")
  );
}

if (!fs.existsSync(BUILD_DIR)) {
  console.error(`No ${BUILD_DIR} to finish — run "npm run build:uploadthat".`);
  process.exit(1);
}

const removed = prune();
retitle();
copyApi();
console.log(
  `Finished uploadthat build: pruned ${removed} portfolio asset(s), copied the PHP API.`
);
