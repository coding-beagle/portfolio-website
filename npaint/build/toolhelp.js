// Tool demos: the short silent clip in the hover card beside a tool button.
//
// The card itself is `helpcard.js`; this is the media source that fills it
// for tools. A tool's demo has to be a recording — what a lasso feels like is
// a gesture over time, and there is nothing in the code to derive it from.
//
// The clips are a convention, not a manifest: a tool called `brush` shows
// `demos/brush.webm` if that file is there, and shows just the text if it is
// not. Adding a demo is therefore dropping a file in `www/demos/` — nothing
// here or in `app.js` has to learn its name. The cost of that is one 404 per
// tool without a clip, so each tool is probed at most once per page load and
// the answer is remembered in `probed`.
//
// That probe used to happen on the first hover, which made the first card for
// each tool arrive a beat late. The whole set is well under two megabytes, so
// instead every attached tool is fetched once the page has gone idle. Fetching
// alone is not enough to make the card instant: a single `<video>` that has
// its `src` swapped per tool still has to demux and decode a first frame on
// every hover. So each clip gets its own `<video>`, built as its bytes land,
// decoded up front and parked hidden in the card — a hover then only unhides
// the one it wants. Hovering before the prefetch reaches that tool still
// works; it falls back to a shared element that loads on demand, the way all
// of this used to.
//
// See `demos/README.md` for how the clips are made.

import { attachHelpCard, canHover, restartCard, stillMotion } from "./helpcard.js";

/** Whether a clip for a tool has loaded before: name -> boolean. */
const probed = new Map();

/** Bumped by `refreshDemo` to get past the browser's cache: name -> number. */
const version = new Map();

/** Prefetched clips, decoded and ready to show: name -> HTMLVideoElement. */
const clips = new Map();

/** Every tool wired up by `attachToolHelp`, in the order they were wired. */
const wanted = [];

/** How many clips are fetched at once, so the prefetch stays off the critical path. */
const PREFETCH_CONCURRENCY = 4;

let prefetchScheduled = false;

/** The card the clips live in, once one tool has been hovered. */
let host = null;
/** Where in the card the clips go: everything sits above the title. */
let hostBefore = null;

/** The shared element for clips the prefetch has not got to yet. */
let fallback = null;

/** The element the card is showing, prefetched or fallback. */
let video = null;

/** Whether the card is currently showing one of ours. */
let active = false;

/** The URL a tool's clip is at right now — versioned after a retake. */
function demoUrl(name) {
  const v = version.get(name);
  return v ? `demos/${name}.webm?v=${v}` : `demos/${name}.webm`;
}

/**
 * A `<video>` for one tool, hidden in the card. `src` is a blob URL for a
 * prefetched clip; the fallback element is made without one and given a URL
 * per hover instead.
 */
function makeVideo(name, src) {
  const el = document.createElement("video");
  el.className = "toolhelp-demo";
  el.muted = true;
  el.loop = true;
  el.playsInline = true;
  el.hidden = true;
  // The fallback is only ever used for a clip nobody has asked for yet, so it
  // waits to be told; a prefetched one is meant to be decoded before anyone
  // asks, which is the whole point of holding the bytes.
  el.preload = src ? "auto" : "none";
  if (name) el.dataset.tool = name;
  if (src) el.src = src;

  // A clip that is missing, or that the browser cannot decode, leaves the
  // card as text — which is what every tool without a demo looks like.
  el.addEventListener("error", () => {
    probed.set(el.dataset.tool, false);
    el.hidden = true;
    if (el === fallback) el.removeAttribute("src");
  });
  el.addEventListener("loadeddata", () => {
    probed.set(el.dataset.tool, true);
    if (video === el && active) el.hidden = false;
  });

  if (host) host.insertBefore(el, hostBefore);
  if (src) el.load();
  return el;
}

async function prefetchOne(name) {
  if (clips.has(name) || probed.get(name) === false) return;
  try {
    const res = await fetch(demoUrl(name));
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    if (!blob.size) throw new Error("empty");
    // Two fetches for one tool can overlap — a retake lands while the idle
    // pass is still working through the list — and the loser drops its copy
    // rather than replacing an element the card may already be playing.
    if (clips.has(name)) return;
    clips.set(name, makeVideo(name, URL.createObjectURL(blob)));
  } catch {
    // A missing clip is the common case for a tool without a demo, and the
    // card is meant to be text-only there. Anything else that goes wrong
    // leaves the hover to try the URL itself.
    probed.set(name, false);
  }
}

async function prefetchAll() {
  const queue = wanted.slice();
  const worker = async () => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      await prefetchOne(name);
    }
  };
  await Promise.all(Array.from({ length: PREFETCH_CONCURRENCY }, worker));
}

/**
 * Queues the whole set to be fetched once the page has stopped being busy.
 * Called after every `attachToolHelp`, but only the first one schedules —
 * the buttons are all wired in the same task, so one pass covers them.
 */
function schedulePrefetch() {
  if (prefetchScheduled) return;
  // Metered or explicitly frugal connections keep the old behaviour: fetch a
  // clip when someone actually asks to see it.
  if (navigator.connection?.saveData) return;
  prefetchScheduled = true;
  const run = () => prefetchAll();
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 500);
}

/** Makes `el` the card's clip, putting away whichever one was there before. */
function useVideo(el) {
  if (video && video !== el) {
    video.pause();
    video.hidden = true;
  }
  video = el;
}

/** The card's media source for tools. */
const source = {
  mount(card, before) {
    host = card;
    hostBefore = before;
    // Clips fetched before the first hover were built without a home.
    for (const el of clips.values()) card.insertBefore(el, before);
    fallback = makeVideo(null, null);
  },

  show(name) {
    active = true;
    const ready = clips.get(name);
    if (probed.get(name) === false) {
      useVideo(null);
      return false;
    }
    if (ready) {
      useVideo(ready);
      // Every clip starts from the top, however far the last hover got.
      ready.currentTime = 0;
      ready.hidden = false;
      if (!stillMotion()) ready.play().catch(() => {});
      return true;
    }
    useVideo(fallback);
    fallback.dataset.tool = name;
    // Unknown until it loads: showing an empty box and then the clip is worse
    // than the text growing a clip once there is one to show.
    fallback.hidden = true;
    const src = demoUrl(name);
    if (!fallback.src.endsWith(src)) fallback.src = src;
    // Reduced motion gets the first frame and no loop; the hint carries the
    // rest. `preload="none"` means nothing is fetched until one of these.
    if (stillMotion()) fallback.load();
    else fallback.play().catch(() => {});
    return true;
  },

  hide() {
    active = false;
    // Hidden as well as paused: the card outlives a move from a tool button
    // to a menu row, and a stopped clip left showing under the next card's
    // picture is worse than either on its own.
    useVideo(null);
  },
};

/**
 * Forgets what is known about one tool's clip, so the next hover fetches it
 * again. Record mode calls this after writing a clip, which is what makes a
 * fresh recording show up without a reload.
 */
export function refreshDemo(name) {
  probed.delete(name);
  version.set(name, Date.now());
  const stale = clips.get(name);
  if (stale) {
    clips.delete(name);
    if (video === stale) useVideo(null);
    stale.remove();
    URL.revokeObjectURL(stale.src);
  }
  // The retake has to come off the server, so it is fetched again rather than
  // left to the next hover — which is what makes the new clip show at once.
  prefetchOne(name);
  restartCard(name);
}

/**
 * Wires the hover card to one tool button. `def` is the tool's entry in
 * `TOOLS` — its `name` picks the clip, its `label`, `key` and `hint` are the
 * text. Returns false on devices that cannot hover, so the caller can leave
 * the button's own `title` in place.
 */
export function attachToolHelp(button, def) {
  if (!canHover()) return false;
  const attached = attachHelpCard(button, {
    name: def.name,
    title: def.key ? `${def.label} (${def.key})` : def.label,
    hint: def.hint,
    source,
  });
  if (!attached) return false;
  wanted.push(def.name);
  schedulePrefetch();
  return true;
}
