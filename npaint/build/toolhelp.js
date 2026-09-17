// Tool help: the card that appears beside a tool button on hover, showing a
// short silent clip of the tool in use above its name and its hint.
//
// The clips are a convention, not a manifest: a tool called `brush` shows
// `demos/brush.webm` if that file is there, and shows just the text if it is
// not. Adding a demo is therefore dropping a file in `www/demos/` — nothing
// here or in `app.js` has to learn its name. The cost of that is one 404 per
// tool without a clip, so each tool is probed at most once per page load and
// the answer is remembered in `probed`.
//
// See `demos/README.md` for how the clips are made.
//
// Only pointers that can actually hover get a card. On a touch screen a
// `pointerenter` arrives with the tap that also picks the tool, so the card
// would cover the canvas the user just aimed at; those devices keep the
// browser's own tooltip instead.

/** How long the pointer has to rest on a button before the card appears. */
const HOVER_DELAY_MS = 350;

/** Gap between the toolbox button and the card. */
const OFFSET_PX = 8;

/** Whether a clip for a tool has loaded before: name -> boolean. */
const probed = new Map();

/** Bumped by `refreshDemo` to get past the browser's cache: name -> number. */
const version = new Map();

const canHover = () => window.matchMedia?.("(hover: hover)").matches ?? true;
const stillMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

let card = null;
let video = null;
let titleEl = null;
let hintEl = null;

/** The button the card is currently showing for, or null when it is hidden. */
let shownFor = null;
let timer = 0;

function build() {
  card = document.createElement("div");
  card.className = "toolhelp";
  card.hidden = true;
  // Decoration: the button it describes is already in the accessibility tree
  // with its own label, and a card that comes and goes would only interrupt.
  card.setAttribute("aria-hidden", "true");

  video = document.createElement("video");
  video.className = "toolhelp-demo";
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "none";
  video.hidden = true;

  titleEl = document.createElement("div");
  titleEl.className = "toolhelp-title";
  hintEl = document.createElement("div");
  hintEl.className = "toolhelp-hint";

  card.append(video, titleEl, hintEl);
  document.body.appendChild(card);

  // A clip that is missing, or that the browser cannot decode, leaves the
  // card as text — which is what every tool without a demo looks like.
  video.addEventListener("error", () => {
    probed.set(video.dataset.tool, false);
    video.hidden = true;
    video.removeAttribute("src");
  });
  video.addEventListener("loadeddata", () => {
    probed.set(video.dataset.tool, true);
    video.hidden = false;
  });
}

/** Puts the card beside `button`, or below it if there is no room to the right. */
function place(button) {
  const b = button.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  const margin = 8;

  let left = b.right + OFFSET_PX;
  if (left + c.width > window.innerWidth - margin) left = Math.max(margin, b.left - OFFSET_PX - c.width);

  let top = b.top + b.height / 2 - c.height / 2;
  top = Math.min(Math.max(margin, top), window.innerHeight - margin - c.height);

  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}

function show(button, def) {
  shownFor = button;
  titleEl.textContent = def.key ? `${def.label} (${def.key})` : def.label;
  hintEl.textContent = def.hint ?? "";

  // Unhide before measuring, but keep it out of the way until it is placed:
  // a card that flashes at the top-left corner first is worse than no card.
  card.style.visibility = "hidden";
  card.hidden = false;

  const known = probed.get(def.name);
  if (known === false) {
    video.hidden = true;
    video.removeAttribute("src");
  } else {
    video.dataset.tool = def.name;
    video.hidden = known !== true;
    const v = version.get(def.name);
    const src = v ? `demos/${def.name}.webm?v=${v}` : `demos/${def.name}.webm`;
    if (!video.src.endsWith(src)) video.src = src;
    // Reduced motion gets the first frame and no loop; the hint carries the
    // rest. `preload="none"` means nothing is fetched until one of these.
    if (stillMotion()) video.load();
    else video.play().catch(() => {});
  }

  place(button);
  card.style.visibility = "";
}

function hide() {
  if (!shownFor) return;
  shownFor = null;
  card.hidden = true;
  video.pause();
}

function cancel() {
  clearTimeout(timer);
  timer = 0;
}

/**
 * Forgets what is known about one tool's clip, so the next hover fetches it
 * again. Record mode calls this after writing a clip, which is what makes a
 * fresh recording show up without a reload.
 */
export function refreshDemo(name) {
  probed.delete(name);
  version.set(name, Date.now());
  if (shownFor && video.dataset.tool === name) {
    const button = shownFor;
    hide();
    button.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
  }
}

/**
 * Wires the hover card to one tool button. `def` is the tool's entry in
 * `TOOLS` — its `name` picks the clip, its `label`, `key` and `hint` are the
 * text. Returns false on devices that cannot hover, so the caller can leave
 * the button's own `title` in place.
 */
export function attachToolHelp(button, def) {
  if (!canHover()) return false;
  if (!card) build();

  button.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch") return;
    cancel();
    timer = setTimeout(() => show(button, def), HOVER_DELAY_MS);
  });
  button.addEventListener("pointerleave", () => {
    cancel();
    hide();
  });
  // Picking the tool answers the question the card was asking.
  button.addEventListener("pointerdown", () => {
    cancel();
    hide();
  });
  // Keyboard users get the same card, without the wait.
  button.addEventListener("focus", () => {
    cancel();
    show(button, def);
  });
  button.addEventListener("blur", () => {
    cancel();
    hide();
  });
  return true;
}

// Anything that moves the button out from under the card dismisses it rather
// than leaving it stranded over the canvas. `scroll` needs the capture phase
// to hear the toolbox scrolling, since it does not bubble — but that also
// puts every event a descendant fires through here, and the card's own video
// fires `resize` as it loads, so events from inside the card are ignored.
const dismiss = (e) => {
  if (card && e.target instanceof Node && card.contains(e.target)) return;
  cancel();
  hide();
};
window.addEventListener("scroll", dismiss, true);
window.addEventListener("wheel", dismiss, { passive: true });
window.addEventListener("resize", dismiss);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    cancel();
    hide();
  }
});
