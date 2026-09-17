// The gradient editor: the run of colours the gradient tool lays down.
//
// A gradient is a list of *stops* — a colour, an opacity and how far along
// the run it sits — which the engine samples between (see `src/gradient.rs`).
// This module is the editor for that list: a bar showing the gradient, a
// marker per stop to drag, a colour and an opacity for the one picked out,
// and a row of presets.
//
// The engine holds the stops, as it holds every other tool setting; the page
// hands them over as `[position, r, g, b, a]` each. An empty list means the
// foreground and background swatches, which is what the tool used before
// there was an editor and still does until a gradient is chosen.
//
// The bar is drawn a column at a time with the same premultiplied mix the
// engine uses, rather than with a canvas gradient, so a run out to
// transparent looks here as it lands on the picture.

import { toHex, parseHex } from "./colorpicker.js";

/** The bar's size in CSS pixels; the markers sit under it. */
const BAR_W = 260;
const BAR_H = 28;
/** How close to a marker a click counts as grabbing it. */
const GRAB_PX = 9;
/** Dragging a marker this far below the bar throws the stop away. */
const DROP_PX = 34;
/** A gradient needs two colours to be a gradient. */
const MIN_STOPS = 2;
/** As many as `gradient::MAX_STOPS` allows. */
const MAX_STOPS = 32;

/**
 * The gradients offered out of the box. Each is a name and its stops, in
 * the compact form `[position, "#rrggbb", alpha]`.
 */
const PRESETS = [
  { name: "Black to white", stops: [[0, "#000000", 255], [1, "#ffffff", 255]] },
  { name: "White to black", stops: [[0, "#ffffff", 255], [1, "#000000", 255]] },
  { name: "Black to transparent", stops: [[0, "#000000", 255], [1, "#000000", 0]] },
  { name: "Sunset", stops: [[0, "#f9c74f", 255], [0.45, "#f3722c", 255], [1, "#9d0208", 255]] },
  { name: "Sea", stops: [[0, "#caf0f8", 255], [0.5, "#00b4d8", 255], [1, "#03045e", 255]] },
  { name: "Spectrum", stops: [[0, "#ff0000", 255], [0.17, "#ffff00", 255], [0.33, "#00ff00", 255], [0.5, "#00ffff", 255], [0.67, "#0000ff", 255], [0.83, "#ff00ff", 255], [1, "#ff0000", 255]] },
];

/** Where the user's own gradients are kept between visits. */
const SAVED_KEY = "npaint.gradients";
/** And the run the tool has in hand. */
const STOPS_KEY = "npaint.gradientStops";

/** A stop as the editor holds one. */
const stop = (at, color, alpha = 255) => ({ at, color, alpha });

const expand = (preset) => preset.map(([at, color, alpha]) => stop(at, color, alpha));
const compact = (stops) => stops.map((s) => [Number(s.at.toFixed(4)), s.color, s.alpha]);

/** The stops as the engine reads them: `[position, r, g, b, a]` each. */
export function toFlat(stops) {
  return Float32Array.from(
    stops.flatMap((s) => {
      const [r, g, b] = parseHex(s.color) ?? [0, 0, 0];
      return [s.at, r, g, b, s.alpha];
    }),
  );
}

/** And back, which is how the editor opens on what the engine has. */
export function fromFlat(flat) {
  const stops = [];
  for (let i = 0; i + 4 < flat.length; i += 5) {
    stops.push(stop(flat[i], toHex(flat[i + 1], flat[i + 2], flat[i + 3]), flat[i + 4]));
  }
  return stops;
}

/**
 * The colour a fraction of the way along, as `[r, g, b, a]`, by the rule
 * `GradientStops::sample` follows: the run starts at the last stop at or
 * before the fraction, and the mix is premultiplied.
 */
export function sampleStops(stops, t) {
  if (stops.length === 0) return [0, 0, 0, 0];
  const at = Math.min(1, Math.max(0, t));
  const rgba = (s) => [...(parseHex(s.color) ?? [0, 0, 0]), s.alpha];
  if (at <= stops[0].at) return rgba(stops[0]);
  const last = stops[stops.length - 1];
  if (at >= last.at) return rgba(last);
  let start = 0;
  for (let i = 0; i < stops.length; i++) if (stops[i].at <= at) start = i;
  const lo = rgba(stops[start]);
  const hi = rgba(stops[Math.min(start + 1, stops.length - 1)]);
  const span = stops[Math.min(start + 1, stops.length - 1)].at - stops[start].at;
  if (span <= 1e-6) return hi;
  const f = (at - stops[start].at) / span;
  const [sa, oa] = [lo[3] / 255, hi[3] / 255];
  const a = sa + (oa - sa) * f;
  if (a <= 0) return [0, 0, 0, 0];
  const channel = (s, o) => Math.round(Math.min(255, Math.max(0, (s * sa + (o * oa - s * sa) * f) / a)));
  return [channel(lo[0], hi[0]), channel(lo[1], hi[1]), channel(lo[2], hi[2]), Math.round(a * 255)];
}

/**
 * Paints the gradient across a canvas, over the transparency checkerboard,
 * so that a run out to transparent shows as one. Used by the editor's bar,
 * its presets and the options bar's button.
 */
export function paintGradient(canvas, stops, { width, height } = {}) {
  const w = width ?? canvas.clientWidth ?? canvas.width;
  const h = height ?? canvas.clientHeight ?? canvas.height;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const CHECK = 6;
  for (let y = 0; y < h; y += CHECK) {
    for (let x = 0; x < w; x += CHECK) {
      ctx.fillStyle = ((x / CHECK + y / CHECK) | 0) % 2 ? "#999" : "#666";
      ctx.fillRect(x, y, CHECK, CHECK);
    }
  }
  for (let x = 0; x < w; x++) {
    const [r, g, b, a] = sampleStops(stops, w <= 1 ? 1 : x / (w - 1));
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    ctx.fillRect(x, 0, 1, h);
  }
}

function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((g) => g && typeof g.name === "string" && Array.isArray(g.stops)) : [];
  } catch {
    return [];
  }
}

function storeSaved(gradients) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(gradients));
  } catch {
    // No storage: this session has them, later ones will not.
  }
}

/** The stops the tool was left with, for the next visit. */
export function loadStops() {
  try {
    const saved = JSON.parse(localStorage.getItem(STOPS_KEY) ?? "null");
    return Array.isArray(saved) ? expand(saved) : [];
  } catch {
    return [];
  }
}

function storeStops(stops) {
  try {
    localStorage.setItem(STOPS_KEY, JSON.stringify(compact(stops)));
  } catch {
    // As above.
  }
}

/**
 * The editor, built into `root`. `onChange(stops)` is called with the run
 * whenever it changes — the page hands it to the engine — and
 * `pickColor(anchor, hex, set)` opens the page's colour picker on a stop.
 */
export function createGradientEditor(root, { onChange, pickColor }) {
  let stops = [];
  let picked = 0; // which stop the colour and opacity rows are showing
  let dragging = null; // the index being dragged, while one is
  let closeHandler = null;

  root.innerHTML = `
    <div class="ge-title">Gradient <button class="ge-close" title="Close">×</button></div>
    <div class="ge-bar-wrap">
      <canvas class="ge-bar" width="${BAR_W}" height="${BAR_H}"></canvas>
      <div class="ge-markers" tabindex="0" role="listbox" aria-label="Colour stops"></div>
    </div>
    <div class="ge-row">
      <button class="ge-swatch" title="The colour of the stop picked out"></button>
      <label class="ge-field">Position <input class="ge-at" type="number" min="0" max="100" step="1" /> %</label>
      <button class="ge-remove" title="Remove this stop (Delete)">Remove</button>
    </div>
    <div class="ge-row">
      <label class="ge-field ge-opacity">Opacity <input class="ge-alpha" type="range" min="0" max="100" /></label>
      <output class="ge-alpha-out"></output>
    </div>
    <div class="ge-presets"></div>
    <div class="ge-row ge-buttons">
      <button class="ge-save" title="Keep this gradient in the row above">Save</button>
      <button class="ge-swatches" title="Go back to running from the foreground colour to the background one">Use swatches</button>
      <button class="ge-reverse" title="Turn the run round">Reverse</button>
    </div>
    <p class="ge-hint">Click the bar to add a stop · drag one below it to remove · double-click a stop for its colour</p>`;

  const find = (cls) => root.querySelector("." + cls);
  const bar = find("ge-bar");
  const markers = find("ge-markers");
  const swatch = find("ge-swatch");
  const atField = find("ge-at");
  const alpha = find("ge-alpha");
  const alphaOut = find("ge-alpha-out");

  /** The stops in order, with `picked` following the stop it was on. */
  function sort() {
    const current = stops[picked];
    stops.sort((a, b) => a.at - b.at);
    picked = Math.max(0, stops.indexOf(current));
  }

  function changed() {
    storeStops(stops);
    onChange(stops);
    draw();
  }

  function draw() {
    paintGradient(bar, stops, { width: BAR_W, height: BAR_H });
    markers.replaceChildren();
    stops.forEach((s, i) => {
      const mark = document.createElement("button");
      mark.className = "ge-mark" + (i === picked ? " ge-mark-on" : "");
      mark.style.left = `${s.at * BAR_W}px`;
      mark.style.setProperty("--stop", s.color);
      mark.style.setProperty("--stop-alpha", String(s.alpha / 255));
      mark.title = `${s.color} at ${Math.round(s.at * 100)}%`;
      mark.dataset.index = String(i);
      markers.appendChild(mark);
    });
    const current = stops[picked];
    swatch.style.setProperty("--swatch", current ? current.color : "#000000");
    if (document.activeElement !== atField) atField.value = current ? Math.round(current.at * 100) : 0;
    if (document.activeElement !== alpha) alpha.value = current ? Math.round((current.alpha / 255) * 100) : 100;
    alphaOut.value = `${alpha.value}%`;
    find("ge-remove").disabled = stops.length <= MIN_STOPS;
    drawPresets();
  }

  function drawPresets() {
    const row = find("ge-presets");
    row.replaceChildren();
    const saved = loadSaved();
    for (const [i, preset] of [...PRESETS.map((p) => [p, false]), ...saved.map((p) => [p, true])].entries()) {
      const [gradient, own] = preset;
      const button = document.createElement("button");
      button.className = "ge-preset";
      button.title = own ? `${gradient.name} — Alt-click to remove` : gradient.name;
      const canvas = document.createElement("canvas");
      button.appendChild(canvas);
      row.appendChild(button);
      paintGradient(canvas, expand(gradient.stops), { width: 44, height: 16 });
      button.addEventListener("click", (e) => {
        if (own && e.altKey) {
          const rest = loadSaved();
          rest.splice(i - PRESETS.length, 1);
          storeSaved(rest);
          drawPresets();
          return;
        }
        stops = expand(gradient.stops);
        picked = 0;
        changed();
      });
    }
  }

  /** Where along the bar a pointer event fell, `0..=1`. */
  function positionOf(e) {
    const box = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
  }

  function nearest(at) {
    let best = 0;
    stops.forEach((s, i) => {
      if (Math.abs(s.at - at) < Math.abs(stops[best].at - at)) best = i;
    });
    return best;
  }

  function addStop(at) {
    if (stops.length >= MAX_STOPS) return;
    const [r, g, b, a] = sampleStops(stops, at);
    stops.push(stop(at, toHex(r, g, b), a));
    sort();
    picked = stops.findIndex((s) => s.at === at);
    changed();
  }

  function removeStop(i) {
    if (stops.length <= MIN_STOPS) return;
    stops.splice(i, 1);
    picked = Math.min(picked, stops.length - 1);
    changed();
  }

  /** A synthetic pointer has nothing to capture, and that is not an error. */
  function capture(e) {
    try {
      markers.setPointerCapture(e.pointerId);
    } catch {
      // The drag still follows the pointer; it may just escape the element.
    }
  }

  markers.addEventListener("pointerdown", (e) => {
    const at = positionOf(e);
    const near = nearest(at);
    const box = bar.getBoundingClientRect();
    if (stops.length && Math.abs(stops[near].at - at) * box.width <= GRAB_PX) {
      picked = near;
      dragging = near;
      capture(e);
    } else {
      addStop(at);
      dragging = picked;
      capture(e);
    }
    draw();
    e.preventDefault();
  });

  markers.addEventListener("pointermove", (e) => {
    if (dragging === null) return;
    stops[dragging].at = positionOf(e);
    sort();
    dragging = picked;
    changed();
  });

  const release = (e) => {
    if (dragging === null) return;
    const box = bar.getBoundingClientRect();
    // Dragged well below the bar, the stop is thrown away — the gesture
    // every gradient editor uses for it.
    if (e.clientY - box.bottom > DROP_PX) removeStop(dragging);
    dragging = null;
    draw();
  };
  markers.addEventListener("pointerup", release);
  markers.addEventListener("pointercancel", release);
  markers.addEventListener("dblclick", () => editColor());

  markers.addEventListener("keydown", (e) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      removeStop(picked);
      e.preventDefault();
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const step = (e.shiftKey ? 0.1 : 0.01) * (e.key === "ArrowLeft" ? -1 : 1);
      stops[picked].at = Math.min(1, Math.max(0, stops[picked].at + step));
      sort();
      changed();
      e.preventDefault();
    }
  });

  function editColor() {
    const current = stops[picked];
    if (!current) return;
    pickColor(swatch, current.color, (hex) => {
      stops[picked].color = hex;
      changed();
    });
  }

  swatch.addEventListener("click", editColor);
  find("ge-remove").addEventListener("click", () => removeStop(picked));
  atField.addEventListener("input", () => {
    const current = stops[picked];
    if (!current) return;
    current.at = Math.min(1, Math.max(0, Number(atField.value) / 100));
    sort();
    changed();
  });
  alpha.addEventListener("input", () => {
    const current = stops[picked];
    if (!current) return;
    current.alpha = Math.round((Number(alpha.value) / 100) * 255);
    changed();
  });
  find("ge-reverse").addEventListener("click", () => {
    stops = stops.map((s) => stop(1 - s.at, s.color, s.alpha));
    sort();
    changed();
  });
  find("ge-swatches").addEventListener("click", () => {
    stops = [];
    onChange(stops);
    storeStops(stops);
    close();
  });
  find("ge-save").addEventListener("click", () => {
    const name = window.prompt("Name this gradient", `Gradient ${loadSaved().length + 1}`);
    if (name === null) return;
    storeSaved([...loadSaved(), { name: name.trim() || "Gradient", stops: compact(stops) }]);
    drawPresets();
  });
  find("ge-close").addEventListener("click", () => close());

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    if (closeHandler) window.removeEventListener("pointerdown", closeHandler, true);
    closeHandler = null;
  }

  /**
   * Opens the editor by `anchor`, on `initial` — the engine's stops, or the
   * two swatch colours when it is running from those, since a run has to
   * start somewhere.
   */
  function open(anchor, initial) {
    stops = initial.length >= MIN_STOPS ? initial : expand(PRESETS[0].stops);
    picked = 0;
    root.hidden = false;
    draw();
    const box = anchor.getBoundingClientRect();
    root.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - root.offsetWidth - 8))}px`;
    root.style.top = `${Math.min(box.bottom + 6, window.innerHeight - root.offsetHeight - 8)}px`;
    closeHandler = (e) => {
      const target = e.target instanceof Node ? e.target : null;
      // The colour picker opens over the editor; clicking in it is not
      // clicking away from it.
      if (!target || (!root.contains(target) && !anchor.contains(target) && !target.closest?.(".color-popover"))) close();
    };
    window.addEventListener("pointerdown", closeHandler, true);
    markers.focus();
  }

  return { open, close, isOpen: () => !root.hidden, stops: () => stops };
}
