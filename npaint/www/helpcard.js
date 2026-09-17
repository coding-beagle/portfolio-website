// The hover card: the small panel that appears beside a control, showing a
// demo of what it does above its name and its hint.
//
// Two unlike things fill that demo slot. A tool's demo is a recorded clip,
// because a gesture cannot be derived from code — see `toolhelp.js`. An
// adjustment's is computed while you look at it, because an adjustment is a
// function of pixels and so can be run on the picture you have open — see
// `adjusthelp.js`. Everything else the two have in common: the panel, the
// hover delay, the placement, reduced motion, and the rule that only one
// card is ever up. That is what lives here.
//
// A media source owns its own elements and is told when the card wants them:
//
//   mount(card, before)  put its elements in the card, once, ahead of `before`
//   show(name)           start showing `name`; false when it has nothing to show
//   hide()               stop
//
// Sources share one card, so only one can be active at a time — which is
// what keeps two demos from playing at once.
//
// Only pointers that can actually hover get a card. On a touch screen a
// `pointerenter` arrives with the tap that also picks the thing, so the card
// would cover what the user just aimed at; those devices keep the browser's
// own tooltip instead.

/** How long the pointer has to rest on a control before the card appears. */
const HOVER_DELAY_MS = 250;

/**
 * How long after a card is put away the next one still counts as the same
 * look around. Within that window the wait is skipped: the delay is there to
 * keep cards from flashing up at a pointer that is only passing through, and
 * someone comparing one thing with the next has already shown that is not
 * what they are doing.
 */
const WARM_MS = 600;

/** Gap between the control and the card. */
const OFFSET_PX = 8;

/** How close the card may come to the edge of the window. */
const MARGIN_PX = 8;

let card = null;
let titleEl = null;
let hintEl = null;

/** Sources that have had `mount` called, so it is called once each. */
const mounted = new WeakSet();

/** The definition the card is currently showing, or null when it is hidden. */
let shown = null;
let timer = 0;

/** When the last card was put away, for `WARM_MS`. */
let hiddenAt = 0;

export const canHover = () => window.matchMedia?.("(hover: hover)").matches ?? true;
export const stillMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** The card element, for a source that needs to size its media to it. */
export function cardElement() {
  if (!card) build();
  return card;
}

function build() {
  card = document.createElement("div");
  card.className = "toolhelp";
  card.hidden = true;
  // Decoration: the control it describes is already in the accessibility tree
  // with its own label, and a card that comes and goes would only interrupt.
  card.setAttribute("aria-hidden", "true");

  titleEl = document.createElement("div");
  titleEl.className = "toolhelp-title";
  hintEl = document.createElement("div");
  hintEl.className = "toolhelp-hint";

  card.append(titleEl, hintEl);
  document.body.appendChild(card);
}

/**
 * Puts the card beside `def`'s control. Horizontal placement clears whatever
 * `avoid` names — the control itself for a toolbox button, the whole popup
 * for a menu row, since a card overlapping the menu it came from covers the
 * rows either side of the one being read. Vertical placement centres on the
 * control regardless, which is what ties the card to the row.
 */
function place(def) {
  const align = def.el.getBoundingClientRect();
  const beside = (def.avoid?.() ?? def.el).getBoundingClientRect();
  const size = card.getBoundingClientRect();

  let left = beside.right + OFFSET_PX;
  if (left + size.width > window.innerWidth - MARGIN_PX) {
    left = Math.max(MARGIN_PX, beside.left - OFFSET_PX - size.width);
  }

  let top = align.top + align.height / 2 - size.height / 2;
  top = Math.min(Math.max(MARGIN_PX, top), window.innerHeight - MARGIN_PX - size.height);

  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}

const text = (v) => (typeof v === "function" ? v() : v) ?? "";

function show(def) {
  if (shown && shown.source !== def.source) shown.source.hide();
  shown = def;

  titleEl.textContent = text(def.title);
  hintEl.textContent = text(def.hint);

  if (!mounted.has(def.source)) {
    def.source.mount(card, titleEl);
    mounted.add(def.source);
  }

  // Unhide before measuring, but keep it out of the way until it is placed:
  // a card that flashes at the top-left corner first is worse than no card.
  card.style.visibility = "hidden";
  card.hidden = false;

  def.source.show(def.name);

  place(def);
  card.style.visibility = "";
}

/** Puts the card away, if it is up. */
export function hideCard() {
  if (!shown) return;
  shown.source.hide();
  shown = null;
  hiddenAt = performance.now();
  card.hidden = true;
}

function cancel() {
  clearTimeout(timer);
  timer = 0;
}

/**
 * Shows the card for `name` again from the top, if that is what it is
 * showing. A source calls this when the media behind a name has changed
 * underneath it, which is what makes a fresh recording appear without a
 * reload.
 */
export function restartCard(name) {
  if (!shown || shown.name !== name) return;
  const def = shown;
  hideCard();
  show(def);
}

/**
 * Wires the shared card to one control.
 *
 * `name` is the key handed to the source — a tool's name, an adjustment's.
 * `title` and `hint` are strings, or functions for text that depends on the
 * state when the card opens. `avoid` names the box the card sits beside, for
 * a control inside something the card should not cover.
 *
 * Returns false on devices that cannot hover, so the caller can leave the
 * control's own `title` in place.
 */
export function attachHelpCard(el, { name, title, hint, source, avoid }) {
  if (!canHover()) return false;
  if (!card) build();
  const def = { el, name, title, hint, source, avoid };

  el.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch") return;
    cancel();
    if (performance.now() - hiddenAt < WARM_MS) show(def);
    else timer = setTimeout(() => show(def), HOVER_DELAY_MS);
  });
  el.addEventListener("pointerleave", () => {
    cancel();
    hideCard();
  });
  // Choosing the thing answers the question the card was asking.
  el.addEventListener("pointerdown", () => {
    cancel();
    hideCard();
  });
  // Keyboard users get the same card, without the wait.
  el.addEventListener("focus", () => {
    cancel();
    show(def);
  });
  el.addEventListener("blur", () => {
    cancel();
    hideCard();
  });
  return true;
}

// Anything that moves the control out from under the card dismisses it rather
// than leaving it stranded over the canvas. `scroll` needs the capture phase
// to hear the toolbox scrolling, since it does not bubble — but that also
// puts every event a descendant fires through here, and the card's own video
// fires `resize` as it loads, so events from inside the card are ignored.
const dismiss = (e) => {
  if (card && e.target instanceof Node && card.contains(e.target)) return;
  cancel();
  hideCard();
};
window.addEventListener("scroll", dismiss, true);
window.addEventListener("wheel", dismiss, { passive: true });
window.addEventListener("resize", dismiss);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    cancel();
    hideCard();
  }
});
