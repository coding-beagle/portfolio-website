// Generates public/posts/index.json from the frontmatter of every .md file in
// public/posts. Runs as a prestart/prebuild step, so the blog list can be
// rendered from one small fetch without pulling down every post body.
const fs = require("fs");
const path = require("path");

const POSTS_DIR = path.join(__dirname, "..", "public", "posts");
const INDEX_FILE = path.join(POSTS_DIR, "index.json");

// Deliberately tiny: scalars, and [a, b] / "- a" lists. Anything more exotic
// belongs in the post body, not the frontmatter.
function parseFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) return {};

  const data = {};
  let listKey = null;

  for (const rawLine of match[1].split(/\r?\n/)) {
    const listItem = /^\s*-\s+(.*)$/.exec(rawLine);
    if (listItem && listKey) {
      data[listKey].push(unquote(listItem[1]));
      continue;
    }

    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(rawLine);
    if (!pair) continue;

    const [, key, rawValue] = pair;
    const value = rawValue.trim();

    if (value === "") {
      listKey = key;
      data[key] = [];
    } else if (value.startsWith("[") && value.endsWith("]")) {
      listKey = null;
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((entry) => unquote(entry.trim()))
        .filter(Boolean);
    } else {
      listKey = null;
      data[key] = unquote(value);
    }
  }

  return data;
}

function unquote(value) {
  return value.replace(/^["']|["']$/g, "");
}

// "2026-08-27-fpga-mandelbrot.md" -> "fpga-mandelbrot", so the date can lead
// the filename (keeping the folder sorted) without leaking into the URL.
function slugFromFilename(filename) {
  return filename.replace(/\.md$/i, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
}

function build() {
  if (!fs.existsSync(POSTS_DIR)) {
    fs.mkdirSync(POSTS_DIR, { recursive: true });
  }

  const posts = fs
    .readdirSync(POSTS_DIR)
    .filter((filename) => filename.toLowerCase().endsWith(".md"))
    .map((filename) => {
      const source = fs.readFileSync(path.join(POSTS_DIR, filename), "utf8");
      const meta = parseFrontmatter(source);

      if (!meta.title) {
        console.warn(`[posts] ${filename} has no title in its frontmatter`);
      }

      return {
        slug: meta.slug || slugFromFilename(filename),
        title: meta.title || slugFromFilename(filename),
        date: meta.date || "",
        summary: meta.summary || "",
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        cover: meta.cover || "",
        file: `posts/${filename}`,
      };
    })
    // Newest first; undated posts sink to the bottom rather than the top.
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const duplicates = posts
    .map((post) => post.slug)
    .filter((slug, index, all) => all.indexOf(slug) !== index);
  if (duplicates.length) {
    throw new Error(`[posts] duplicate slugs: ${[...new Set(duplicates)].join(", ")}`);
  }

  fs.writeFileSync(INDEX_FILE, JSON.stringify(posts, null, 2) + "\n");
  console.log(`[posts] wrote ${posts.length} post(s) to public/posts/index.json`);
}

if (require.main === module) {
  build();
}

module.exports = { parseFrontmatter, slugFromFilename, build };
