// Adjustment demos: the picture in the hover card beside a menu row under
// Image > Adjustments and Filter.
//
// The card itself is `helpcard.js`; this is the media source that fills it
// for adjustments. Nothing here is recorded. A tool's demo has to be a clip
// because a gesture cannot be derived from code, but an adjustment is a
// function of pixels and a handful of numbers, so its demo can simply be
// run — on the picture the user has open, which is the thing a recording
// could never show. `NPaint.adjust_rgba` is the whole of what that takes:
// the same `Adjustment` the menu row itself would build, applied to a loose
// buffer instead of the document, so a demo cannot drift from what the row
// does.
//
// The picture is the whole document scaled down to fit the card. It was a
// 1:1 crop of the middle at first, so that a filter's radius on screen would
// be the radius the dialog asks for — but a 258-pixel window onto a photo is
// some sky, and a demo you cannot recognise your own picture in is not
// showing you anything. The numbers give way to the picture: what a demo
// sweeps to is chosen to read well anyway, never copied from the dialog's
// defaults, so there was less to lose than it looked.
//
// Two ways of showing it, chosen per adjustment in `ADJUSTMENTS`:
//
//   sweep  the swept parameter runs end to end and back, so the card says
//          what the slider does and not only that there is one
//   wipe   a seam slides across, the original on one side and the result on
//          the other — for the ones a sweep cannot show, either because
//          there is no slider (Invert) or because the effect is too fine to
//          read without the original beside it (Sharpen, Median)
//
// A sweep is drawn from a few keyframes cross-faded into each other rather
// than one per displayed frame: the filters are fast but not free, and the
// difference between eight keyframes cross-faded and sixty computed is not
// one anybody can see in a 260-pixel card.

import { NPaint } from "./pkg/npaint.js";
import { ADJUSTMENTS, demoSweep, paramsFor } from "./adjust.js";
import { attachHelpCard, canHover, cardElement, stillMotion } from "./helpcard.js";

/**
 * How tall the demo may get. The card is a fixed width and the picture keeps
 * the document's aspect inside it, so this is what stops a tall document
 * from turning the card into a column.
 */
const DEMO_MAX_HEIGHT = 190;

/** The demo's shape when there is no document to take one from. */
const SAMPLE_ASPECT = 0.62;

/** Keyframes across a sweep, counting both ends. */
const SWEEP_FRAMES = 6;

/** How long one there-and-back sweep, or one wipe, takes. */
const CYCLE_MS = 2600;

/**
 * How many adjustments' frames are kept before the oldest is dropped. A
 * whole menu's worth, so walking down Filter and back up it never rebuilds
 * anything — which is the one path anybody actually takes through these.
 */
const CACHE_LIMIT = 12;

/**
 * How long one keyframe may take before the in-between ones are given up on.
 * A demo that has both ends still cross-fades between them, which is the
 * wipe's information at the sweep's cost; what it must not do is spend a
 * second of the main thread grinding out a median filter nobody asked for.
 */
const KEYFRAME_BUDGET_MS = 40;

/** Where the wipe's seam starts and stops, so neither side is ever all there is. */
const WIPE_FROM = 0.12;
const WIPE_TO = 0.88;

/** The engine, once `app.js` has one. */
let np = null;

/** The card's canvas, once a card has been mounted. */
let canvas = null;

/** The demo size in pixels, measured off the card so the picture is 1:1. */
let width = 0;
let height = 0;

/** name -> Demo, oldest first, so the map itself is the LRU order. */
const cache = new Map();

/** The document the cache was built from, by `document_state`. */
let cachedState = null;

/** The two `u32`s `composite_thumbnail` puts in front of its pixels. */
const SIZE_HEADER_BYTES = 8;

/** The synthetic picture used when the document has nothing to show. */
let sampleFrame = null;

/** The document as the demos see it, until it is edited. */
let subjectFrame = null;

const spec = (name) => ADJUSTMENTS.find((a) => a.name === name);

// ---- The subject ------------------------------------------------------------------

/**
 * Whether a crop has enough going on to be worth filtering. An empty white
 * canvas reads as a broken demo — the same reason `demos/README.md` tells you
 * to open a picture before recording a tool.
 */
const FLAT_THRESHOLD = 6;

function isFlat(data) {
  let min = 255;
  let max = 0;
  // Every fourth pixel is plenty to tell a blank canvas from a picture.
  for (let i = 0; i < data.length; i += 16) {
    const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min < FLAT_THRESHOLD;
}

/**
 * A card built to exercise the adjustments: a hue sweep for the ones that
 * turn colours, a tone ramp for the ones that remap tones, flat blocks for
 * posterising and dithering, and fine stripes for the ones that read
 * neighbours. Drawn rather than shipped — a file would be one more thing to
 * keep, and this says exactly which properties the demos need.
 */
function drawSample() {
  const c = new OffscreenCanvas(width, height);
  const g = c.getContext("2d");

  const hues = g.createLinearGradient(0, 0, width, 0);
  for (let i = 0; i <= 6; i++) hues.addColorStop(i / 6, `hsl(${(i * 360) / 6}, 78%, 55%)`);
  g.fillStyle = hues;
  g.fillRect(0, 0, width, Math.round(height * 0.34));

  const tones = g.createLinearGradient(0, 0, width, 0);
  tones.addColorStop(0, "#000");
  tones.addColorStop(1, "#fff");
  g.fillStyle = tones;
  g.fillRect(0, Math.round(height * 0.34), width, Math.round(height * 0.18));

  const blocks = ["#2d4a7c", "#c8543a", "#e8c15a", "#3f7d52", "#8b5ca8", "#d8d2c4"];
  const blockWidth = width / blocks.length;
  const blockTop = Math.round(height * 0.52);
  blocks.forEach((color, i) => {
    g.fillStyle = color;
    g.fillRect(Math.round(i * blockWidth), blockTop, Math.ceil(blockWidth), height - blockTop);
  });

  // Stripes that narrow across the last third, so a blur or a median has
  // something it visibly destroys and a sharpen something it visibly bites
  // on — and so the blocks to their left stay flat, which is what posterising
  // and dithering need to show anything at all.
  g.strokeStyle = "rgba(255, 255, 255, 0.85)";
  g.lineWidth = 1;
  const stripesFrom = Math.round(width * 0.66);
  for (let x = stripesFrom; x < width; x += 2 + Math.floor(((width - x) / width) * 12)) {
    g.beginPath();
    g.moveTo(x + 0.5, blockTop);
    g.lineTo(x + 0.5, height);
    g.stroke();
  }
  return g.getImageData(0, 0, width, height);
}

/**
 * Works out how big the picture is, from the card it will sit in, so it is
 * drawn at 1:1 — a filter's radius on screen is then the radius the dialog
 * would ask for. Separate from mounting because a prefetch can run before
 * anything has been hovered, and it has to render at the right size.
 */
function measure() {
  if (width) return;
  const card = cardElement();
  // A prefetch can run long before anything is hovered, and a card that has
  // never been shown is `display: none` and so has no width to read. Showing
  // it invisibly for the one measurement is cheaper than guessing.
  const wasHidden = card.hidden;
  if (wasHidden) {
    card.style.visibility = "hidden";
    card.hidden = false;
  }
  const style = getComputedStyle(card);
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  width = Math.round(card.clientWidth - padding);
  if (wasHidden) {
    card.hidden = true;
    card.style.visibility = "";
  }
  // A card with no width at all means no stylesheet, which is not a state
  // worth drawing into; the demos stay out of the way until there is one.
  if (width < 1) width = 0;
  height = Math.round(width * SAMPLE_ASPECT);
}

/** The picture the demos run on: the middle of the document, or the sample. */
function subject() {
  if (subjectFrame) return subjectFrame;
  subjectFrame = readSubject();
  return subjectFrame;
}

/**
 * The picture itself, without the caching. Compositing a document is the
 * expensive part of a demo and every adjustment wants the same answer, so
 * this runs once per edit rather than once per adjustment.
 */
function readSubject() {
  if (!sampleFrame) sampleFrame = drawSample();
  if (!np) return sampleFrame;
  let bytes;
  try {
    bytes = np.composite_thumbnail(width, DEMO_MAX_HEIGHT);
  } catch {
    return sampleFrame;
  }
  // The engine puts the fitted size in front of the pixels, because keeping
  // the document's aspect means the answer is not the size that was asked for.
  const size = new Uint32Array(bytes.buffer, bytes.byteOffset, 2);
  const [w, h] = size;
  const pixels = bytes.subarray(SIZE_HEADER_BYTES);
  if (pixels.length !== w * h * 4 || isFlat(pixels)) return sampleFrame;
  return new ImageData(new Uint8ClampedArray(pixels), w, h);
}

// ---- Building a demo --------------------------------------------------------------

/** One adjustment run over `from` at `t` along its sweep, as an ImageData. */
function render(name, from, at) {
  const bytes = NPaint.adjust_rgba(name, at, from.width, from.height, from.data);
  return new ImageData(new Uint8ClampedArray(bytes), from.width, from.height);
}

/**
 * Everything a demo needs to play: the picture, the keyframes along the
 * sweep, and which of them are worked out. `frames[0]` is the sweep's start
 * and the last is its end; a wipe has no sweep and holds the original and
 * the result in those two slots.
 */
function build(name) {
  const found = spec(name);
  if (!found) return null;
  const from = subject();
  const sweep = demoSweep(found);
  const set = { ...(found.demo?.set ?? {}) };
  const count = sweep ? SWEEP_FRAMES : 2;
  const demo = { name, from, sweep, set, frames: new Array(count).fill(null), giveUp: false };

  // Both ends first: they are what makes the card useful, and for a wipe
  // they are the whole thing.
  try {
    const started = performance.now();
    const at = (value) => paramsFor(found, sweep ? { ...set, [sweep.key]: value } : set);
    demo.frames[count - 1] = render(name, from, at(sweep?.to));
    demo.frames[0] = sweep ? render(name, from, at(sweep.from)) : from;
    // A filter this slow is one the in-between frames are not worth the main
    // thread for; the two ends cross-fade on their own.
    if (performance.now() - started > KEYFRAME_BUDGET_MS * 2) demo.giveUp = true;
  } catch {
    return null;
  }
  return demo;
}

/** The keyframe at `i`, or the nearest one that has been worked out. */
function nearest(demo, i) {
  const last = demo.frames.length - 1;
  for (let step = 0; step <= last; step++) {
    const before = demo.frames[Math.max(0, i - step)];
    if (before) return before;
    const after = demo.frames[Math.min(last, i + step)];
    if (after) return after;
  }
  return demo.from;
}

/**
 * Works out one more of a sweep's in-between keyframes, taking the widest
 * gap first so the sweep gets smoother all over rather than from one end.
 * Returns false when there is nothing left to do.
 */
function fillOne(demo) {
  if (!demo.sweep || demo.giveUp) return false;
  let at = -1;
  let widest = 0;
  for (let i = 1; i < demo.frames.length - 1; i++) {
    if (demo.frames[i]) continue;
    let before = i;
    while (!demo.frames[before]) before--;
    let after = i;
    while (!demo.frames[after]) after++;
    if (after - before > widest) {
      widest = after - before;
      at = i;
    }
  }
  if (at < 0) return false;
  const found = spec(demo.name);
  const t = at / (demo.frames.length - 1);
  const value = demo.sweep.from + (demo.sweep.to - demo.sweep.from) * t;
  const started = performance.now();
  try {
    const params = paramsFor(found, { ...demo.set, [demo.sweep.key]: value });
    demo.frames[at] = render(demo.name, demo.from, params);
  } catch {
    demo.giveUp = true;
    return false;
  }
  if (performance.now() - started > KEYFRAME_BUDGET_MS) demo.giveUp = true;
  return true;
}

function remember(name, demo) {
  cache.set(name, demo);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

/** The demo for `name`, built if it has not been, or null if it cannot be. */
function demoFor(name) {
  const state = np ? np.document_state() : 0;
  if (state !== cachedState) {
    cache.clear();
    subjectFrame = null;
    cachedState = state;
  }
  if (cache.has(name)) {
    // Touching it moves it to the end, which is what makes the map an LRU.
    const demo = cache.get(name);
    cache.delete(name);
    cache.set(name, demo);
    return demo;
  }
  const demo = build(name);
  if (demo) remember(name, demo);
  return demo;
}

// ---- Playing it -------------------------------------------------------------------

/**
 * When a keyframe was last worked out, anywhere. The card has one player and
 * the contact sheet has one per adjustment, and a filter run per player per
 * animation frame would bring the page down; one across all of them keeps a
 * sweep smoothing out at a pace nobody waits on and the sheet usable.
 */
let lastFilledAt = 0;
const FILL_INTERVAL_MS = 50;

function maybeFill(demo, now) {
  if (now - lastFilledAt < FILL_INTERVAL_MS) return;
  if (fillOne(demo)) lastFilledAt = now;
}

/** There and back, eased, so neither end is a hard turn. */
const pingPong = (t) => 0.5 - Math.cos(2 * Math.PI * t) / 2;

/**
 * Plays demos into one canvas: the hover card has one of these, the contact
 * sheet one per tile.
 */
function createPlayer(canvas) {
  const ctx = canvas.getContext("2d");
  const scratch = new OffscreenCanvas(canvas.width, canvas.height);
  const scratchCtx = scratch.getContext("2d");
  let showing = null;
  let request = 0;
  let startedAt = 0;

  /** Puts `frame` on the canvas, optionally faded over what is already there. */
  function paint(frame, alpha = 1) {
    if (alpha >= 1) {
      ctx.putImageData(frame, 0, 0);
      return;
    }
    scratchCtx.putImageData(frame, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(scratch, 0, 0);
    ctx.globalAlpha = 1;
  }

  /** Draws `after` over `before` from `at` across, with a hairline on the seam. */
  function paintWipe(before, after, at) {
    ctx.putImageData(before, 0, 0);
    const seam = Math.round(canvas.width * at);
    scratchCtx.putImageData(after, 0, 0);
    const rest = canvas.width - seam;
    ctx.drawImage(scratch, seam, 0, rest, canvas.height, seam, 0, rest, canvas.height);
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    ctx.fillRect(seam, 0, 1, canvas.height);
  }

  const last = (demo) => demo.frames[demo.frames.length - 1];

  function draw(now) {
    request = 0;
    if (!showing) return;
    const demo = showing;
    const t = ((now - startedAt) % CYCLE_MS) / CYCLE_MS;

    if (demo.sweep) {
      const place = pingPong(t) * (demo.frames.length - 1);
      const i = Math.min(demo.frames.length - 2, Math.floor(place));
      paint(nearest(demo, i));
      paint(nearest(demo, i + 1), place - i);
    } else {
      paintWipe(demo.from, last(demo), WIPE_FROM + (WIPE_TO - WIPE_FROM) * pingPong(t));
    }

    maybeFill(demo, now);
    request = requestAnimationFrame(draw);
  }

  /** The still shown when motion is not wanted: the two ends, side by side. */
  function drawStill(demo) {
    paintWipe(demo.sweep ? demo.frames[0] : demo.from, last(demo), 0.5);
  }

  return {
    /**
     * Starts `demo` looping. `at` is where its cycle begins, which a caller
     * showing several at once passes the same value for so they run in step —
     * demos out of phase with each other cannot be compared, which is the
     * only reason to show several. A card leaves it alone and so always opens
     * on the start of the sweep.
     */
    play(demo, at = performance.now()) {
      showing = demo;
      if (stillMotion()) {
        drawStill(demo);
        return;
      }
      startedAt = at;
      draw(performance.now());
    },
    stop() {
      showing = null;
      cancelAnimationFrame(request);
      request = 0;
    },
  };
}

/** A canvas the demos are drawn into, shaped like the picture in `frame`. */
function makeCanvas(frame) {
  const el = document.createElement("canvas");
  el.className = "toolhelp-demo";
  el.width = frame.width;
  el.height = frame.height;
  return el;
}

// ---- The card's source ------------------------------------------------------------

let player = null;

const source = {
  mount(card, before) {
    measure();
    if (!width) return;
    canvas = makeCanvas(subject());
    canvas.hidden = true;
    player = createPlayer(canvas);
    card.insertBefore(canvas, before);
  },

  show(name) {
    if (!canvas) return false;
    const demo = demoFor(name);
    canvas.hidden = !demo;
    if (!demo) return false;
    // A new document of another shape changes the picture's, and a player
    // holds a buffer the size of the canvas it was made for.
    if (canvas.width !== demo.from.width || canvas.height !== demo.from.height) {
      player.stop();
      canvas.width = demo.from.width;
      canvas.height = demo.from.height;
      player = createPlayer(canvas);
    }
    player.play(demo);
    return true;
  },

  hide() {
    player?.stop();
    if (canvas) canvas.hidden = true;
  },
};

// ---- Wiring -----------------------------------------------------------------------

/** Hands the engine over, once `app.js` has one. */
export function useEngine(engine) {
  np = engine;
}

/**
 * Wires the hover card to one menu row. `avoid` is the box the card must
 * clear — the popup the row is in, since a card sitting over the menu covers
 * the rows either side of the one being read.
 */
export function attachAdjustHelp(row, name, avoid) {
  const found = spec(name);
  if (!found || !canHover()) return false;
  const label = found.label.replace(/…$/, "");
  return attachHelpCard(row, {
    name,
    title: found.shortcut ? `${label} (${found.shortcut})` : label,
    hint: found.hint,
    source,
    avoid,
  });
}

/**
 * One adjustment's demo as a canvas of its own, playing straight away, for
 * the contact sheet in `demosheet.js`. Returns null when there is nothing to
 * show. `stop` takes it off the animation loop; the canvas is the caller's
 * to place and to remove.
 */
export function demoTile(name, at) {
  measure();
  if (!width) return null;
  const demo = demoFor(name);
  if (!demo) return null;
  const tile = makeCanvas(demo.from);
  const tilePlayer = createPlayer(tile);
  tilePlayer.play(demo, at);
  return { canvas: tile, stop: tilePlayer.stop };
}

/** Adjustments waiting to be worked out ahead of being asked for. */
const queued = [];
let draining = false;

function drain() {
  draining = false;
  const name = queued.shift();
  if (name === undefined) return;
  demoFor(name);
  draining = true;
  // Only the two ends of a sweep are worked out here; the in-between frames
  // are filled while the card plays, where they cost nothing anyone waits on.
  if (typeof requestIdleCallback === "function") requestIdleCallback(drain, { timeout: 500 });
  else setTimeout(drain, 16);
}

/**
 * Works the listed adjustments' demos out ahead of being asked, one per idle
 * slice. A menu is walked down a row at a time, so a menu that has just
 * opened is about to be asked for most of this. Called once per row as the
 * popup is built, so it takes the same list over and over — hence the queue
 * rather than a pass per call.
 */
export function prefetchDemos(names) {
  if (!canHover()) return;
  measure();
  if (!width) return;
  for (const name of names) {
    if (!cache.has(name) && !queued.includes(name)) queued.push(name);
  }
  if (!draining) drain();
}
