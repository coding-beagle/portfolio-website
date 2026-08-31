// Post-build step for the hex tool's own bundle.
//
// `public/` is shared with the portfolio, so CRA copies ~90MB of scene assets
// (the splash gif, the badapple frames, the blog posts) into a build that never
// references any of it — and the build folders are committed, because that is
// what cPanel pulls. So keep only what the page actually loads, and give the
// document the title and preview text of the tool rather than the portfolio's.
//
// The keep list is deliberately an allowlist: if the tool ever grows an asset
// of its own, add it here.
const fs = require("fs");
const path = require("path");

const BUILD_DIR = path.join(__dirname, "..", "build-hextool");

const KEEP = new Set([
  "index.html",
  "asset-manifest.json",
  "manifest.json",
  "favicon.ico",
  "logo192.png",
  "robots.txt",
  "static",
]);

const TITLE = "hex tool";
const DESCRIPTION =
  "Convert between hex and binary, column by column, with Verilog bit selects.";

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
    .replace(
      /(<meta name="description" content=")[^"]*(")/,
      `$1${DESCRIPTION}$2`
    )
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${TITLE}$2`)
    // The portfolio's preview image and canonical URL are not this page's.
    .replace(/<meta property="og:image[^>]*>/g, "")
    .replace(/<meta property="og:url"[^>]*>/, "");
  fs.writeFileSync(file, html);
}

if (!fs.existsSync(BUILD_DIR)) {
  console.error(`No ${BUILD_DIR} to finish — run "npm run build:hextool".`);
  process.exit(1);
}

const removed = prune();
retitle();
console.log(`Finished hex tool build: pruned ${removed} portfolio asset(s).`);
