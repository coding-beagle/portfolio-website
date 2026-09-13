// NPaint's page: the browser half of the editor.
//
// Everything that decides what the document looks like lives in the wasm
// module (see ../src). This file owns the DOM, the canvas, pointer and
// keyboard events, and the render loop — it turns browser events into calls
// on `NPaint` and draws what `NPaint` says the document is. There is no
// state here that the engine also has; the layers panel, the menus and the
// status bar are all re-read from the engine after every change.

import init, { NPaint } from "./pkg/npaint.js";
import { createMenuBar, showContextMenu, closeMenus } from "./menu.js";
import { createColorPicker } from "./colorpicker.js";
import { ADJUSTMENTS, createAdjustDialog } from "./adjust.js";

// ---- Tools ------------------------------------------------------------------

const ICON = {
  select: '<rect x="4" y="4" width="16" height="16" stroke-dasharray="3 2"/>',
  wand: '<path d="M4 20l9-9M6.5 4.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5L3 8l2.5-1zM17 3l.8 2.2L20 6l-2.2.8L17 9l-.8-2.2L14 6l2.2-.8zM19 14l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"/><path d="M12.5 11.5l2 2"/>',
  quickselect: '<path d="M3 12a9 9 0 0113.5-7.8" stroke-dasharray="3 2"/><path d="M21 12a9 9 0 01-9 9" stroke-dasharray="3 2"/><path d="M8 17c1.5-.3 2.2-1.3 2.6-2.6L17 8l2 2-6.4 6.4C11.3 16.8 10 17.5 8 17.5z"/>',
  refine: '<path d="M4 20c2-.5 3-2 3.5-4l8.5-8.5 2.5 2.5L10 18.5c-2 .5-3.5 1.5-6 1.5z"/><circle cx="17" cy="6" r="3.2" stroke-dasharray="2.5 2"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  brush: '<path d="M4 20c2-.5 3-2 3.5-4l8.5-8.5 2.5 2.5L10 18.5c-2 .5-3.5 1.5-6 1.5z"/><path d="M15 6l3-3 3 3-3 3"/>',
  pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  eraser: '<path d="M5 15l8-8 6 6-6 6H9z"/><path d="M9 19h11"/>',
  line: '<path d="M5 19L19 5"/>',
  rectangle: '<rect x="4" y="6" width="16" height="12"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  zoom: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20M8 10.5h5M10.5 8v5"/>',
  hand: '<path d="M8 12V6a1.5 1.5 0 013 0v5V5a1.5 1.5 0 013 0v6V7a1.5 1.5 0 013 0v7.5a5.5 5.5 0 01-11 0V10a1.5 1.5 0 013 0z"/>',
};

const TOOLS = [
  { name: "select", label: "Marquee select", key: "M", hint: "Drag to select a rectangle; click to deselect. Shift for a square." },
  {
    name: "wand",
    label: "Magic wand",
    key: "W",
    hint: "Click a colour to select it. Shift adds, Alt takes away, Shift+Alt keeps the overlap.",
  },
  {
    name: "quickselect",
    label: "Quick select",
    key: "Q",
    hint: "Brush over what you want and it grows out to the edges. Shift adds, Alt takes away.",
  },
  {
    name: "refine",
    label: "Refine selection",
    key: "R",
    hint: "Paint the selection itself to fix it: drag to add, Alt+drag to rub out.",
  },
  { name: "move", label: "Move", key: "V", hint: "Drag to move the selected pixels, or the whole layer." },
  { name: "brush", label: "Brush", key: "B", hint: "Paint with the foreground colour at the chosen opacity." },
  { name: "pencil", label: "Pencil", key: "P", hint: "Hard, fully opaque strokes." },
  { name: "eraser", label: "Eraser", key: "E", hint: "Erase to transparent." },
  { name: "line", label: "Line", key: "L", hint: "Drag to draw a line. Shift snaps to 45°." },
  { name: "rectangle", label: "Rectangle", key: "U", hint: "Drag to draw. Shift for a square, Alt to draw from the centre." },
  { name: "ellipse", label: "Ellipse", key: "O", hint: "Drag to draw. Shift for a circle, Alt to draw from the centre." },
  {
    name: "zoom",
    label: "Zoom",
    key: "Z",
    hint: "Click to zoom in, Alt+click to zoom out, drag out the area to zoom into.",
    scrubHint: "Click to zoom in, Alt+click to zoom out, drag left or right to scrub.",
  },
  { name: "hand", label: "Hand", key: "H", hint: "Drag to pan. Space does this from any tool." },
];

const EYE =
  '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';

const $ = (id) => document.getElementById(id);

// ---- State ------------------------------------------------------------------

let np; // the NPaint instance
let memory; // wasm linear memory, for zero-copy frames

const view = $("view");
const vctx = view.getContext("2d");
const viewport = $("viewport");
const offscreen = document.createElement("canvas");
const octx = offscreen.getContext("2d");
const checker = makeChecker();

let tool = "brush";
let zoomOutMode = false; // the zoom tool's options-bar toggle
let spaceHeld = false;
let altHeld = false;
let pan = null; // { x, y } of the last pointer position while space/middle panning
let needsDraw = true;
let layersDirty = true;
// The marching-ants outline, and whether it needs tracing again.
let ants = [];
let antsDirty = true;
// Where the pointer is over the canvas, in CSS pixels, for the brush ring.
let cursor = null;
// Set once the render loop has reported a failure, so it says so once.
let frameFailed = false;
// Set while a canvas edge is being dragged: which edge, and where it is now.
let resizing = null;
let dpr = 1;
let picker; // the colour picker
let pickerTarget = "fg"; // which swatch the picker is editing
let adjust; // the adjustment dialog

// ---- Boot -------------------------------------------------------------------

async function boot() {
  // Before anything else, so the mark is already turning while the wasm loads.
  buildThrobbers();
  if (typeof WebAssembly === "undefined") {
    $("loading").hidden = true;
    $("unsupported").hidden = false;
    return;
  }
  const exports = await init();
  memory = exports.memory;
  np = new NPaint(1024, 768, "#ffffff");

  buildToolbox();
  buildMenus();
  bindOptions();
  bindSwatches();
  bindLayers();
  bindPointer();
  bindKeyboard();
  bindDialogs();
  bindExport();
  bindCanvasDialog();
  adjust = createAdjustDialog(np, { onChange: touch, onError: message });

  $("loading").hidden = true;
  $("app").hidden = false;

  new ResizeObserver(onResize).observe(viewport);
  onResize();
  np.fit_to_view(viewport.clientWidth, viewport.clientHeight);
  syncOptions();
  buildQualityPicker();
  requestAnimationFrame(frame);
}

function onResize() {
  dpr = window.devicePixelRatio || 1;
  view.width = Math.max(1, Math.round(viewport.clientWidth * dpr));
  view.height = Math.max(1, Math.round(viewport.clientHeight * dpr));
  // The engine needs the window size to zoom a marquee up to fill it.
  np.set_view_size(viewport.clientWidth, viewport.clientHeight);
  needsDraw = true;
}

/** Marks everything the engine may have changed as needing a refresh. */
function touch() {
  needsDraw = true;
  layersDirty = true;
  antsDirty = true;
}

let messageTimer = null;
function message(text) {
  $("status-message").textContent = text;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => ($("status-message").textContent = ""), 4000);
}

// ---- Render loop --------------------------------------------------------------

function frame(now) {
  // One throw in here used to kill the loop for good — the next frame was
  // never scheduled and the canvas simply stopped. Whatever happens, the
  // loop keeps running and says what went wrong.
  try {
    step(now);
  } catch (e) {
    if (!frameFailed) {
      frameFailed = true;
      message(`Drawing failed: ${e.message ?? e}`);
      console.error(e);
    }
  }
  requestAnimationFrame(frame);
}

function step(now) {
  if (np.render()) {
    // The frame is a view into wasm memory: no copy until putImageData.
    const w = np.width();
    const h = np.height();
    if (offscreen.width !== w || offscreen.height !== h) {
      offscreen.width = w;
      offscreen.height = h;
    }
    const bytes = new Uint8ClampedArray(memory.buffer, np.frame_ptr(), np.frame_len());
    octx.putImageData(new ImageData(bytes, w, h), 0, 0);
    needsDraw = true;
    layersDirty = true;
    antsDirty = true;
  }

  // Tracing the outline of a mask costs a pass over the document, so it is
  // done when the selection may have changed rather than once a frame; the
  // ants themselves crawl by moving the dash along a path that stays put.
  if (antsDirty) {
    ants = np.selection_contours();
    antsDirty = false;
  }
  const transforming = np.is_transforming();
  // While a transform previews, the marquee still sits where the pixels used
  // to be. The transform box is what is true, so show only that.
  const showing = transforming ? [] : ants;
  if (needsDraw || showing.length || transforming) {
    draw(now, showing, transforming);
    needsDraw = false;
  }

  if (layersDirty && !np.is_gesturing()) {
    // Clicking another layer while the adjustment dialog is open ends the
    // session in the engine; the dialog has nothing left to preview.
    if (adjust.isOpen() && !np.is_adjusting()) adjust.abandon();
    renderLayers();
    syncTransformBar();
    layersDirty = false;
  }
}

function draw(now, ants, transforming) {
  const zoom = np.zoom();
  const px = np.pan_x();
  const py = np.pan_y();
  const w = np.width() * zoom;
  const h = np.height() * zoom;

  vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  vctx.clearRect(0, 0, view.width, view.height);

  // Checkerboard behind the document, fixed to the screen so it does not
  // scale with the zoom.
  vctx.save();
  vctx.beginPath();
  vctx.rect(px, py, w, h);
  vctx.clip();
  vctx.fillStyle = checker;
  vctx.fillRect(px, py, w, h);
  vctx.restore();

  // Nearest-neighbour when zoomed in so pixels are pixels; smoothed when
  // zoomed out so the downsample is not a moiré.
  vctx.imageSmoothingEnabled = zoom < 1;
  vctx.drawImage(offscreen, px, py, w, h);

  vctx.strokeStyle = "rgba(0,0,0,0.6)";
  vctx.lineWidth = 1;
  vctx.strokeRect(px - 0.5, py - 0.5, w + 1, h + 1);

  if (ants.length) drawAnts(now, ants, px, py, zoom);

  const overlay = np.tool_overlay();
  if (overlay.length) drawZoomMarquee(overlay);

  if (transforming) drawTransformBox();
  if (resizing) drawResizePreview(zoom);
  if ((cursor || sizing) && showsBrushRing() && !resizing) drawBrushRing(zoom);

  $("btn-zoom-level").textContent = `${Math.round(zoom * 100)}%`;
  $("status-size").textContent = `${np.width()} × ${np.height()} px`;
  $("status-brush").textContent = showsBrushRing() ? `Brush ${np.size()} px` : "";
  const rect = transforming ? [] : np.selection_rect();
  $("status-selection").textContent = rect.length
    ? `Selection ${np.selection_area()} px in ${rect[2]} × ${rect[3]} at ${rect[0]}, ${rect[1]}`
    : "";
}

/**
 * The marching ants: the outline of the selection, whatever shape it is.
 *
 * The engine hands over closed loops in document coordinates, flattened as a
 * point count followed by that many x, y pairs — one loop per island, and one
 * per hole. Two dashed passes offset from each other give the black-and-white
 * crawl that reads against any picture.
 */
function drawAnts(now, ants, px, py, zoom) {
  const path = new Path2D();
  for (let i = 0; i < ants.length; ) {
    const count = ants[i++];
    for (let n = 0; n < count; n++) {
      const x = Math.round(px + ants[i++] * zoom) + 0.5;
      const y = Math.round(py + ants[i++] * zoom) + 0.5;
      if (n === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
  }
  const crawl = (now / 60) % 9;
  vctx.save();
  vctx.lineWidth = 1;
  vctx.setLineDash([5, 4]);
  vctx.lineDashOffset = -crawl;
  vctx.strokeStyle = "#fff";
  vctx.stroke(path);
  vctx.lineDashOffset = -crawl + 4.5;
  vctx.strokeStyle = "#000";
  vctx.stroke(path);
  vctx.restore();
}

/** The tools whose size is worth seeing before the stroke starts. */
const BRUSH_TOOLS = new Set(["brush", "pencil", "eraser", "quickselect", "refine"]);
const showsBrushRing = () => BRUSH_TOOLS.has(tool);

/**
 * The brush, drawn where the pointer is and the size it will actually paint.
 * Two rings, light over dark, so it shows up against any picture.
 */
function drawBrushRing(zoom) {
  const at = sizing ? sizing.anchor : cursor;
  const radius = (np.size() * zoom) / 2;
  // Below a pixel or two the ring is just noise; the crosshair says enough.
  if (radius < 1.5) return;
  vctx.save();
  vctx.beginPath();
  vctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
  vctx.lineWidth = 3;
  vctx.strokeStyle = "rgba(0,0,0,0.45)";
  vctx.stroke();
  vctx.lineWidth = 1;
  vctx.strokeStyle = "rgba(255,255,255,0.95)";
  vctx.stroke();
  vctx.restore();
}

/** The canvas the edge drag is asking for: an outline, and the size it wants. */
function drawResizePreview(zoom) {
  const r = resizing.rect;
  const x = Math.round(np.pan_x() + r.x0 * zoom) + 0.5;
  const y = Math.round(np.pan_y() + r.y0 * zoom) + 0.5;
  const w = Math.round((r.x1 - r.x0) * zoom);
  const h = Math.round((r.y1 - r.y0) * zoom);
  vctx.save();
  vctx.lineWidth = 1;
  vctx.setLineDash([6, 4]);
  vctx.strokeStyle = "rgba(0,0,0,0.8)";
  vctx.strokeRect(x, y, w, h);
  vctx.strokeStyle = "#fff";
  vctx.lineDashOffset = 5;
  vctx.strokeRect(x, y, w, h);
  vctx.setLineDash([]);
  const label = `${r.x1 - r.x0} × ${r.y1 - r.y0}`;
  vctx.font = "12px system-ui, sans-serif";
  const width = vctx.measureText(label).width + 10;
  vctx.fillStyle = "rgba(0,0,0,0.75)";
  vctx.fillRect(x, y - 22, width, 18);
  vctx.fillStyle = "#fff";
  vctx.fillText(label, x + 5, y - 9);
  vctx.restore();
}

/**
 * The zoom tool's marquee: the area the view will be zoomed to. Screen pixels
 * already, so no mapping — and still, not marching: it lives for one drag.
 */
function drawZoomMarquee([x, y, w, h]) {
  const rx = Math.round(x) + 0.5;
  const ry = Math.round(y) + 0.5;
  vctx.save();
  vctx.lineWidth = 1;
  vctx.strokeStyle = "rgba(0,0,0,0.8)";
  vctx.strokeRect(rx, ry, Math.round(w), Math.round(h));
  vctx.setLineDash([4, 4]);
  vctx.strokeStyle = "#fff";
  vctx.strokeRect(rx, ry, Math.round(w), Math.round(h));
  vctx.restore();
}

/** The free-transform box: outline through the corners, then the handles. */
function drawTransformBox() {
  const h = np.transform_handles();
  if (h.length < 16) return;
  const pt = (i) => [h[i * 2], h[i * 2 + 1]];
  vctx.save();
  vctx.lineWidth = 1;
  vctx.strokeStyle = "rgba(0,0,0,0.8)";
  vctx.beginPath();
  for (const i of [0, 2, 4, 6]) {
    const [x, y] = pt(i);
    if (i === 0) vctx.moveTo(x, y);
    else vctx.lineTo(x, y);
  }
  vctx.closePath();
  vctx.stroke();
  vctx.strokeStyle = "rgba(255,255,255,0.9)";
  vctx.setLineDash([4, 4]);
  vctx.stroke();
  vctx.setLineDash([]);
  for (let i = 0; i < 8; i++) {
    const [x, y] = pt(i);
    vctx.fillStyle = "#fff";
    vctx.strokeStyle = "#000";
    vctx.fillRect(x - 4, y - 4, 8, 8);
    vctx.strokeRect(x - 4.5, y - 4.5, 9, 9);
  }
  // Centre mark.
  const cx = (h[0] + h[8]) / 2;
  const cy = (h[1] + h[9]) / 2;
  vctx.beginPath();
  vctx.arc(cx, cy, 3, 0, Math.PI * 2);
  vctx.strokeStyle = "#000";
  vctx.stroke();
  vctx.restore();
}

function makeChecker() {
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#8a8a8a";
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = "#5e5e5e";
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillRect(8, 8, 8, 8);
  return vctx.createPattern(c, "repeat");
}

// ---- Sizing the brush by dragging (Blender's F) ------------------------------
//
// Press F with a brush in hand and move the pointer: the ring follows the
// distance from where you pressed, so the size is set against the picture
// rather than against a slider. Click, F or Enter keeps it; Escape puts back
// the size it was.

let sizing = null;

function beginSizing() {
  if (!showsBrushRing() || sizing) return;
  const at = cursor ?? { x: view.clientWidth / 2, y: view.clientHeight / 2 };
  sizing = { anchor: at, was: np.size() };
  cursor = { ...at };
  message("Move to set the brush size — click or F to keep it, Esc to cancel.");
  needsDraw = true;
}

/** Follows the pointer while sizing. Returns whether it handled the move. */
function sizeToPointer(x, y) {
  if (!sizing) return false;
  const radius = Math.hypot(x - sizing.anchor.x, y - sizing.anchor.y);
  // The ring is drawn at the document's scale, so the size is in document
  // pixels however far the view is zoomed.
  setSize(Math.max(1, Math.round((radius * 2) / np.zoom())));
  needsDraw = true;
  return true;
}

function endSizing(keep) {
  if (!sizing) return false;
  if (!keep) setSize(sizing.was);
  else message(`Brush ${np.size()} px.`);
  sizing = null;
  needsDraw = true;
  return true;
}

// ---- The mark ---------------------------------------------------------------
//
// A 3:2 Lissajous figure — sin(3t + pi/2) against sin(2t) — drawn faintly with
// a bright arc running round it. It is the site's mark (see
// `www/favicon.svg`), and as a throbber it is the same curve with the arc
// moving, so waiting looks like the logo rather than like a stock spinner.

/**
 * The curve as a path, and how long that path is, in user units.
 *
 * `phase` is the shift between the two axes, and it is what gives the figure
 * its shape: a pretzel at a quarter turn, a flat ribbon at none, everything
 * in between on the way. Moving it slowly makes the mark breathe instead of
 * merely spinning.
 */
function lissajous(phase = Math.PI / 2, points = 120, radius = 40) {
  let d = "M";
  let length = 0;
  let first = null;
  let prev = null;
  for (let i = 0; i < points; i++) {
    const t = (2 * Math.PI * i) / points;
    const x = 50 + radius * Math.sin(3 * t + phase);
    const y = 50 + radius * Math.sin(2 * t);
    d += `${i ? "L" : ""}${x.toFixed(1)} ${y.toFixed(1)}`;
    if (prev) length += Math.hypot(x - prev[0], y - prev[1]);
    else first = [x, y];
    prev = [x, y];
  }
  length += Math.hypot(first[0] - prev[0], first[1] - prev[1]);
  return { d: `${d}Z`, length };
}

/** How far round the curve the bright arc reaches. */
const THROB_ARC = 0.22;
/** Radians of phase a second, and laps of the curve a second. */
const THROB_PHASE_RATE = 0.55;
const THROB_LAP_RATE = 0.42;

let throbbers = [];
let throbbing = false;

/** Fills every `.throb-slot` in the page with a throbber. */
function buildThrobbers() {
  throbbers = [];
  for (const slot of document.querySelectorAll(".throb-slot")) {
    slot.innerHTML =
      `<svg class="throb" viewBox="0 0 100 100" aria-hidden="true">` +
      `<path class="track"/><path class="lead"/>` +
      `</svg>`;
    const svg = slot.firstChild;
    throbbers.push({ svg, track: svg.firstChild, lead: svg.lastChild });
  }
  drawThrobbers(0);
  startThrobbing();
}

/** Whether a throbber is on screen at all; a hidden one is not worth drawing. */
const throbberShowing = (t) => t.svg.isConnected && !t.svg.closest("[hidden]");

/**
 * One frame of the mark: the phase creeps round, reshaping the curve, while
 * the bright arc runs along whatever shape that is. The two have to be drawn
 * together — the arc is a fraction of the path's length, and the path is a
 * different length at every phase.
 */
function drawThrobbers(elapsed) {
  const { d, length } = lissajous(Math.PI / 2 + elapsed * THROB_PHASE_RATE);
  const arc = length * THROB_ARC;
  const offset = -((elapsed * THROB_LAP_RATE * length) % length);
  for (const t of throbbers) {
    if (!throbberShowing(t)) continue;
    t.track.setAttribute("d", d);
    t.lead.setAttribute("d", d);
    t.lead.setAttribute("stroke-dasharray", `${arc.toFixed(1)} ${(length - arc).toFixed(1)}`);
    t.lead.setAttribute("stroke-dashoffset", offset.toFixed(1));
  }
}

function startThrobbing() {
  if (throbbing || !throbbers.some(throbberShowing)) return;
  // Asked not to be animated at: the mark is drawn, and held still.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  throbbing = true;
  const began = performance.now();
  const tick = (now) => {
    if (!throbbers.some(throbberShowing)) {
      // Nothing on screen to animate: stop, and let whatever shows one next
      // start it again.
      throbbing = false;
      return;
    }
    drawThrobbers((now - began) / 1000);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---- Toolbox and options ------------------------------------------------------

/** Which block of the toolbox each tool belongs in, in order. */
const TOOL_GROUPS = [
  ["select", "wand", "quickselect", "refine"],
  ["move"],
  ["brush", "pencil", "eraser"],
  ["line", "rectangle", "ellipse"],
  ["zoom", "hand"],
];

function buildToolbox() {
  const box = $("tools");
  const groupOf = (name) => TOOL_GROUPS.findIndex((g) => g.includes(name));
  let group = null;
  for (const t of TOOLS) {
    const mine = groupOf(t.name);
    if (group !== null && mine !== group) {
      const rule = document.createElement("div");
      rule.className = "tool-sep";
      box.appendChild(rule);
    }
    group = mine;
    const b = document.createElement("button");
    b.className = "tool";
    b.dataset.tool = t.name;
    b.title = `${t.label} (${t.key})`;
    b.setAttribute("aria-label", t.label);
    b.innerHTML = `<svg viewBox="0 0 24 24">${ICON[t.name]}</svg><span class="key">${t.key}</span>`;
    b.addEventListener("click", () => setTool(t.name));
    box.appendChild(b);
  }
  setTool(tool);
}

function setTool(name) {
  endSizing(false);
  tool = name;
  np.set_tool(name);
  for (const b of document.querySelectorAll(".tool")) {
    b.classList.toggle("active", b.dataset.tool === name);
  }
  for (const t of TOOLS) viewport.classList.toggle(`tool-${t.name}`, t.name === name);
  const def = TOOLS.find((t) => t.name === name);
  $("opt-hint").textContent = def ? def.hint : "";
  syncOptions();
}

/** The zoom tool's hint, which depends on what a drag is going to do. */
function zoomHint() {
  const def = TOOLS.find((t) => t.name === "zoom");
  return np.scrubby_zoom() ? def.scrubHint : def.hint;
}

/** Shows the options that apply to the current tool. */
function syncOptions() {
  const isShape = tool === "rectangle" || tool === "ellipse";
  const hasOpacity = tool === "brush" || tool === "eraser";
  const auto = tool === "wand" || tool === "quickselect" || tool === "refine";
  const viewTool =
    tool === "select" ||
    tool === "hand" ||
    tool === "zoom" ||
    tool === "move" ||
    tool === "wand";
  const usesSize = !viewTool && !(isShape && np.fill());
  $("opt-opacity-wrap").hidden = !hasOpacity;
  $("opt-fill-wrap").hidden = !isShape;
  // The tolerance is the wand's and quick select's; the refine brush paints
  // the selection by hand and has only a size.
  $("opt-tolerance-wrap").hidden = !(tool === "wand" || tool === "quickselect");
  $("opt-sample-wrap").hidden = tool !== "wand";
  $("opt-all-layers-wrap").hidden = !auto;
  $("opt-antialias-wrap").hidden = !auto;
  $("opt-subject").hidden = !auto;
  $("opt-quality-wrap").hidden = !auto;
  $("opt-tolerance").value = np.tolerance();
  $("opt-tolerance-out").value = np.tolerance();
  $("opt-all-layers").checked = np.sample_all_layers();
  $("opt-antialias").checked = np.antialias();
  toggleSeg($("opt-contiguous"), $("opt-global"), np.sample_mode() === "contiguous");
  $("opt-zoom-wrap").hidden = tool !== "zoom";
  $("opt-scrubby-wrap").hidden = tool !== "zoom";
  $("opt-scrubby").checked = np.scrubby_zoom();
  if (tool === "zoom") $("opt-hint").textContent = zoomHint();
  $("opt-size-wrap").hidden = !usesSize;
  toggleSeg($("opt-fill"), $("opt-stroke"), np.fill());
  toggleSeg($("opt-zoom-in"), $("opt-zoom-out"), !zoomOutMode);
  viewport.classList.toggle("alt", tool === "zoom" && (altHeld || zoomOutMode));
}

function toggleSeg(onEl, offEl, first) {
  onEl.classList.toggle("seg-on", first);
  onEl.setAttribute("aria-pressed", String(first));
  offEl.classList.toggle("seg-on", !first);
  offEl.setAttribute("aria-pressed", String(!first));
}

function bindOptions() {
  const size = $("opt-size");
  const sizeNum = $("opt-size-num");
  size.addEventListener("input", () => setSize(Number(size.value)));
  sizeNum.addEventListener("change", () => setSize(Number(sizeNum.value) || 1));

  const opacity = $("opt-opacity");
  opacity.addEventListener("input", () => {
    np.set_opacity(Number(opacity.value) / 100);
    $("opt-opacity-out").value = `${opacity.value}%`;
  });

  $("opt-fill").addEventListener("click", () => {
    np.set_fill(true);
    syncOptions();
  });
  $("opt-stroke").addEventListener("click", () => {
    np.set_fill(false);
    syncOptions();
  });
  const tolerance = $("opt-tolerance");
  tolerance.addEventListener("input", () => {
    np.set_tolerance(Number(tolerance.value));
    $("opt-tolerance-out").value = tolerance.value;
  });
  $("opt-contiguous").addEventListener("click", () => {
    np.set_sample_mode("contiguous");
    syncOptions();
  });
  $("opt-global").addEventListener("click", () => {
    np.set_sample_mode("global");
    syncOptions();
  });
  $("opt-all-layers").addEventListener("change", (e) => np.set_sample_all_layers(e.target.checked));
  $("opt-antialias").addEventListener("change", (e) => np.set_antialias(e.target.checked));
  $("opt-subject").addEventListener("click", selectSubject);
  $("opt-quality").addEventListener("change", (e) => setSubjectQuality(e.target.value));
  $("opt-scrubby").addEventListener("change", (e) => {
    np.set_scrubby_zoom(e.target.checked);
    syncOptions();
  });
  $("opt-zoom-in").addEventListener("click", () => {
    zoomOutMode = false;
    syncOptions();
  });
  $("opt-zoom-out").addEventListener("click", () => {
    zoomOutMode = true;
    syncOptions();
  });

  $("btn-zoom-in").addEventListener("click", () => zoomStep(1));
  $("btn-zoom-out").addEventListener("click", () => zoomStep(-1));
  $("btn-zoom-level").addEventListener("click", actualSize);
  $("btn-fit").addEventListener("click", fit);

  $("tb-rot-ccw").addEventListener("click", () => act(() => np.transform_rotate(-90)));
  $("tb-rot-cw").addEventListener("click", () => act(() => np.transform_rotate(90)));
  $("tb-flip-h").addEventListener("click", () => act(() => np.transform_flip_horizontal()));
  $("tb-flip-v").addEventListener("click", () => act(() => np.transform_flip_vertical()));
  $("tb-cancel").addEventListener("click", () => act(() => np.cancel_session()));
  $("tb-commit").addEventListener("click", () => act(() => np.commit_session()));
}

function setSize(v) {
  np.set_size(Math.max(1, v));
  $("opt-size").value = Math.min(200, np.size());
  $("opt-size-num").value = np.size();
}

function syncTransformBar() {
  const info = np.transform_info();
  const on = info.length === 7;
  $("transform-bar").hidden = !on;
  viewport.classList.toggle("transforming", on);
  if (on) {
    const [x, y, w, h, , , angle] = info;
    $("tb-info").textContent = `X ${x.toFixed(0)}  Y ${y.toFixed(0)}  W ${w.toFixed(0)}  H ${h.toFixed(0)}  ∠ ${angle.toFixed(1)}°`;
  }
}

// ---- Colours --------------------------------------------------------------------

function bindSwatches() {
  picker = createColorPicker($("color-popover"), {
    onChange: (hex) => {
      if (pickerTarget === "fg") np.set_color(hex);
      else np.set_background(hex);
      syncSwatches();
    },
  });
  $("swatch-fg").addEventListener("click", () => openPicker("fg"));
  $("swatch-bg").addEventListener("click", () => openPicker("bg"));
  $("swatch-swap").addEventListener("click", swapColors);
  $("swatch-reset").addEventListener("click", resetColors);
  syncSwatches();
}

function openPicker(target) {
  pickerTarget = target;
  picker.open($(target === "fg" ? "swatch-fg" : "swatch-bg"), target === "fg" ? np.color() : np.background());
}

function syncSwatches() {
  $("swatch-fg").style.setProperty("--swatch", np.color());
  $("swatch-bg").style.setProperty("--swatch", np.background());
}

function swapColors() {
  np.swap_colors();
  syncSwatches();
}

function resetColors() {
  np.reset_colors();
  syncSwatches();
}

// ---- Menus ------------------------------------------------------------------------

const hasSelection = () => np.selection_rect().length > 0;
const layerCount = () => np.layer_count();
const active = () => np.active_layer();

function adjustmentItems() {
  return ADJUSTMENTS.map((a) => ({
    label: a.label,
    shortcut: a.shortcut,
    action: () => adjust.open(a.name),
  }));
}

/** The same list as new adjustment layers: the layer is made with neutral
 *  settings and its dialog opened straight away, if it has any. */
function adjustmentLayerItems() {
  return ADJUSTMENTS.map((a) => ({
    label: a.label,
    action: () =>
      act(() => {
        const index = np.add_adjustment_layer(a.name, new Float32Array());
        adjust.openLayer(index);
      }),
  }));
}

const layerKind = (i) => np.layer_kind(i);
const hasMask = (i) => np.layer_has_mask(i);

/** Edits an adjustment layer's settings, or says why it cannot. */
function editAdjustmentLayer(index) {
  if (layerKind(index) !== "adjustment") return;
  if (!adjust.openLayer(index)) message("This adjustment has no settings to change.");
}

/** The mask submenu of one layer. */
function maskItems(i) {
  const with_ = (fn) => () => act(() => fn(i()));
  return [
    { label: "Reveal All", action: with_((k) => np.add_layer_mask(k, false)), enabled: () => !hasSelection() },
    { label: "Hide All", action: with_((k) => np.add_layer_mask(k, true)), enabled: () => !hasSelection() },
    { label: "Reveal Selection", action: with_((k) => np.add_layer_mask(k, false)), enabled: hasSelection },
    { label: "Hide Selection", action: with_((k) => np.add_layer_mask(k, true)), enabled: hasSelection },
    { sep: true },
    {
      label: "Disable Mask",
      checked: () => hasMask(i()) && !np.layer_mask_enabled(i()),
      enabled: () => hasMask(i()),
      action: with_((k) => np.set_layer_mask_enabled(k, !np.layer_mask_enabled(k))),
    },
    { label: "Delete Mask", enabled: () => hasMask(i()), action: with_((k) => np.remove_layer_mask(k)) },
    {
      label: "Apply Mask",
      enabled: () => hasMask(i()) && layerKind(i()) !== "adjustment",
      action: with_((k) => np.apply_layer_mask(k)),
    },
    { sep: true },
    {
      label: "Load Mask as Selection",
      enabled: () => hasMask(i()),
      action: with_((k) => {
        if (!np.select_layer_mask(k)) message("The mask hides everything, so there is nothing to select.");
      }),
    },
  ];
}

/** The items that act on one layer; shared by the Layer menu and the
 *  layer row's context menu. */
function layerItems(index) {
  const i = () => (index === undefined ? active() : index);
  return [
    { label: "New Layer", shortcut: "Ctrl+Shift+N", action: () => act(() => np.add_layer()) },
    { label: "New Adjustment Layer", submenu: adjustmentLayerItems() },
    { label: "Duplicate Layer", shortcut: "Ctrl+J", action: () => act(() => np.duplicate_layer(i())) },
    { label: "Layer via Copy", enabled: hasSelection, action: () => act(() => np.layer_via_copy()) },
    { label: "Delete Layer", enabled: () => layerCount() > 1, action: () => act(() => np.remove_layer(i())) },
    { sep: true },
    {
      label: "Edit Adjustment…",
      enabled: () => layerKind(i()) === "adjustment",
      action: () => withActive(i(), () => editAdjustmentLayer(i())),
    },
    { label: "Layer Mask", submenu: maskItems(i) },
    { sep: true },
    {
      label: "Convert to Smart Object",
      enabled: () => layerKind(i()) === "pixels",
      action: () => act(() => np.convert_to_smart_object(i())),
    },
    {
      label: "Rasterize Layer",
      enabled: () => layerKind(i()) === "smart",
      action: () => act(() => np.rasterize_layer(i())),
    },
    {
      label: "Replace Contents…",
      enabled: () => layerKind(i()) === "smart",
      action: () => withActive(i(), () => pickFile("replace")),
    },
    { sep: true },
    { label: "Rename…", action: () => act(() => renameLayer(i())) },
    {
      label: "Hide Layer",
      checked: () => !np.layer_visible(i()),
      action: () => act(() => np.set_layer_visible(i(), !np.layer_visible(i()))),
    },
    { sep: true },
    { label: "Move Up", enabled: () => i() < layerCount() - 1, action: () => act(() => np.move_layer(i(), i() + 1)) },
    { label: "Move Down", enabled: () => i() > 0, action: () => act(() => np.move_layer(i(), i() - 1)) },
    { sep: true },
    {
      label: "Merge Down",
      shortcut: "Ctrl+E",
      enabled: () => i() > 0 && layerKind(i() - 1) === "pixels",
      action: () => act(() => np.merge_down(i())),
    },
    { label: "Flatten Image", shortcut: "Ctrl+Shift+E", enabled: () => layerCount() > 1, action: () => act(() => np.flatten()) },
    { sep: true },
    {
      label: "Transform",
      submenu: [
        { label: "Free Transform…", shortcut: "T", action: () => withActive(i(), beginTransform) },
        { sep: true },
        { label: "Flip Horizontal", action: () => withActive(i(), () => np.flip_layer_horizontal()) },
        { label: "Flip Vertical", action: () => withActive(i(), () => np.flip_layer_vertical()) },
        { label: "Rotate 90° Clockwise", action: () => withActive(i(), () => np.rotate_layer(1)) },
        { label: "Rotate 90° Anticlockwise", action: () => withActive(i(), () => np.rotate_layer(-1)) },
        { label: "Rotate 180°", action: () => withActive(i(), () => np.rotate_layer(2)) },
      ],
    },
  ];
}

/** Runs `fn` with `index` as the active layer — the context menu acts on
 *  the row that was clicked, not the one that happened to be active. */
function withActive(index, fn) {
  act(() => {
    np.set_active_layer(index);
    fn();
  });
}

function editItems() {
  return [
    { label: "Undo", shortcut: "Ctrl+Z", enabled: () => np.can_undo(), action: () => act(() => np.undo()) },
    { label: "Redo", shortcut: "Ctrl+Shift+Z", enabled: () => np.can_redo(), action: () => act(() => np.redo()) },
    { sep: true },
    { label: "Free Transform…", shortcut: "T", action: beginTransform },
    { sep: true },
    { label: "Fill with Foreground", shortcut: "Alt+Backspace", action: () => act(() => np.fill_selection()) },
    { label: "Fill with Background", shortcut: "Ctrl+Backspace", action: () => act(() => np.fill_selection_background()) },
    { label: "Clear", shortcut: "Delete", action: () => act(() => np.clear_selection()) },
    { sep: true },
    { label: "Swap Colours", shortcut: "X", action: swapColors },
    { label: "Default Colours", shortcut: "D", action: resetColors },
  ];
}

/** The pixel amounts the modify commands offer, so no dialog is needed. */
const AMOUNTS = [1, 2, 4, 8, 16, 32];

const amountItems = (run) =>
  AMOUNTS.map((n) => ({ label: `${n} px`, enabled: hasSelection, action: () => act(() => run(n)) }));

function selectItems() {
  return [
    { label: "All", shortcut: "Ctrl+A", action: () => act(() => np.select_all()) },
    { label: "Deselect", shortcut: "Ctrl+D", enabled: hasSelection, action: () => act(() => np.deselect()) },
    { label: "Inverse", shortcut: "Ctrl+Shift+I", action: () => act(() => np.select_invert()) },
    { sep: true },
    { label: "Subject", action: selectSubject },
    { label: "Subject Quality", submenu: qualityItems },
    { label: "Layer Pixels", action: () => act(() => np.select_opaque()) },
    { label: "Similar", enabled: hasSelection, action: () => act(() => np.select_similar()) },
    { sep: true },
    { label: "Expand", submenu: amountItems((n) => np.select_expand(n)) },
    { label: "Contract", submenu: amountItems((n) => np.select_contract(n)) },
    { label: "Feather", submenu: amountItems((n) => np.select_feather(n)) },
    { label: "Smooth", submenu: amountItems((n) => np.select_smooth(n)) },
  ];
}

// ---- Select Subject ---------------------------------------------------------
//
// One command. It uses the model, which means a one-time download the first
// time it is asked for; if that is declined or anything goes wrong it falls
// back to the search built into the engine, which needs nothing and is
// instant. Either way the user gets a selection.

/** Set when the download has been declined, so it asks once a session. */
let modelDeclined = false;
/** Which model to use, remembered between visits. Filled in on boot. */
let subjectQuality = "fast";

/**
 * Fills the quality picker from the model list. Done from the module rather
 * than the markup so the sizes shown are the ones that will be downloaded.
 */
/**
 * The quality choices, as menu items. The array is filled in once the model
 * list has loaded and is read when the submenu is opened, so the menu does
 * not have to wait for the module at boot.
 */
const qualityItems = [];

function setSubjectQuality(id) {
  subjectQuality = id;
  $("opt-quality").value = id;
  try {
    localStorage.setItem("npaint.subjectQuality", id);
  } catch {
    // Private windows refuse storage; the choice just will not be remembered.
  }
  message(`Select Subject will use the ${id} model.`);
}

async function buildQualityPicker() {
  let models;
  try {
    ({ MODELS: models, DEFAULT_MODEL: subjectQuality } = await import("./subject-model.js"));
  } catch {
    $("opt-quality-wrap").hidden = true;
    return;
  }
  try {
    const saved = localStorage.getItem("npaint.subjectQuality");
    if (saved && models.some((m) => m.id === saved)) subjectQuality = saved;
  } catch {
    // No storage: the default stands.
  }
  const select = $("opt-quality");
  select.replaceChildren();
  qualityItems.length = 0;
  for (const m of models) {
    const option = document.createElement("option");
    option.value = m.id;
    option.textContent = `${m.label} (${m.mb} MB)`;
    option.selected = m.id === subjectQuality;
    select.appendChild(option);
    qualityItems.push({
      label: `${m.label} — ${m.mb} MB${m.slow ? ", slow" : ""}`,
      checked: () => subjectQuality === m.id,
      action: () => setSubjectQuality(m.id),
    });
  }
}

/** The panel over the canvas that says what is happening, and how far along. */
function working(label, fraction) {
  const panel = $("working");
  panel.hidden = false;
  startThrobbing();
  $("working-label").textContent = label;
  const bar = $("working-bar");
  if (fraction === null || fraction === undefined) {
    bar.removeAttribute("value");
    $("working-pct").textContent = "";
  } else {
    bar.value = fraction;
    $("working-pct").textContent = `${Math.round(fraction * 100)}%`;
  }
}

function doneWorking() {
  $("working").hidden = true;
}

/** Lets the panel paint before something slow takes the thread. */
const painted = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

/** The engine's own subject finder: no download, and never fails to answer. */
async function selectSubjectBuiltIn(why) {
  working(why ?? "Looking for the subject…", null);
  await painted();
  const found = np.select_subject();
  touch();
  doneWorking();
  message(found ? "Selected the subject." : "Could not find a subject in this image.");
}

/**
 * Runs the model in a worker, so the page keeps drawing while it thinks.
 *
 * If the browser will not take a module worker, or the worker fails for any
 * reason, the same work happens here instead: the result is identical, it
 * just freezes the page while it runs. The pixels are copied rather than
 * handed over precisely so that fallback is still possible.
 */
function matteInBackground(model, rgba, onProgress) {
  const onThisThread = () => model.matte(rgba, np.width(), np.height(), subjectQuality, onProgress);
  let worker;
  try {
    worker = new Worker(new URL("./subject-worker.js", import.meta.url), { type: "module" });
  } catch {
    return onThisThread();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      fn();
    };
    worker.onmessage = (e) => {
      const data = e.data;
      if (data.type === "progress") onProgress(data.fraction);
      else if (data.type === "done") finish(() => resolve(data));
      else finish(() => reject(new Error(data.message)));
    };
    worker.onerror = () => finish(() => resolve(onThisThread()));
    worker.postMessage({ rgba, width: np.width(), height: np.height(), id: subjectQuality });
  });
}

async function selectSubject() {
  let model = null;
  try {
    model = await import("./subject-model.js");
  } catch {
    // The module is not deployed alongside the page.
    await selectSubjectBuiltIn();
    return;
  }

  const cached = await model.isCached(subjectQuality);
  if (!cached) {
    if (modelDeclined) {
      await selectSubjectBuiltIn();
      return;
    }
    const ok = window.confirm(
      `Select Subject works best with a machine-learning model: about ${model.downloadMb(subjectQuality)} MB, ` +
        `downloaded once from this site and then kept in your browser for good. It runs on your ` +
        `machine — nothing is uploaded.\n\nDownload it now? Cancel to use the quick built-in ` +
        `version instead.`
    );
    if (!ok) {
      modelDeclined = true;
      await selectSubjectBuiltIn();
      return;
    }
  }

  const thinking = model.isSlow(subjectQuality)
    ? "Finding the subject… (this one takes a few seconds)"
    : "Finding the subject…";
  const getting = cached ? "Loading the model…" : "Downloading the model…";
  working(cached ? thinking : getting, cached ? null : 0);
  await painted();
  try {
    np.render();
    const rgba = np.frame_copy();
    const started = performance.now();
    const { matte, width, height } = await matteInBackground(model, rgba, (fraction) =>
      // Progress is the download; once it is in, the model is running.
      working(fraction >= 1 ? thinking : getting, fraction >= 1 ? null : fraction)
    );
    const found = np.select_subject_from_matte(matte, width, height);
    touch();
    doneWorking();
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    message(found ? `Selected the subject (${seconds}s).` : "The model did not find a subject in this image.");
  } catch (e) {
    doneWorking();
    // Anything at all — no network, no cache storage, a browser that will not
    // run it — still ends in a selection.
    await selectSubjectBuiltIn("The model could not run; looking for the subject…");
    message(`The model could not run (${e.message ?? e}), so the built-in search was used.`);
  }
}

function buildMenus() {
  createMenuBar($("menus"), [
    {
      title: "File",
      items: [
        { label: "New…", shortcut: "Ctrl+N", action: showNewDialog },
        { label: "Open…", shortcut: "Ctrl+O", action: () => pickFile("open") },
        { label: "Place as Smart Object…", action: () => pickFile("place") },
        { sep: true },
        { label: "Export Image…", shortcut: "Ctrl+S", action: showExportDialog },
      ],
    },
    { title: "Edit", items: editItems() },
    {
      title: "Image",
      items: [
        { label: "Adjustments", submenu: adjustmentItems() },
        { sep: true },
        { label: "Canvas Size…", action: showCanvasDialog },
        { sep: true },
        { label: "Rotate Canvas 90° Clockwise", action: () => act(() => np.rotate_canvas(1)) },
        { label: "Rotate Canvas 90° Anticlockwise", action: () => act(() => np.rotate_canvas(-1)) },
        { label: "Rotate Canvas 180°", action: () => act(() => np.rotate_canvas(2)) },
        { label: "Flip Canvas Horizontal", action: () => act(() => np.flip_canvas_horizontal()) },
        { label: "Flip Canvas Vertical", action: () => act(() => np.flip_canvas_vertical()) },
        { sep: true },
        { label: "Flatten Image", enabled: () => layerCount() > 1, action: () => act(() => np.flatten()) },
      ],
    },
    { title: "Layer", items: layerItems() },
    { title: "Select", items: selectItems() },
    {
      title: "View",
      items: [
        { label: "Zoom In", shortcut: "+", action: () => zoomStep(1) },
        { label: "Zoom Out", shortcut: "−", action: () => zoomStep(-1) },
        { label: "Fit on Screen", shortcut: "Ctrl+0", action: fit },
        { label: "Actual Pixels", shortcut: "Ctrl+1", action: actualSize },
      ],
    },
  ]);
}

/** The canvas's right-click menu. */
function canvasContextItems() {
  if (np.is_transforming()) {
    return [
      { label: "Apply Transform", shortcut: "Enter", action: () => act(() => np.commit_session()) },
      { label: "Cancel Transform", shortcut: "Esc", action: () => act(() => np.cancel_session()) },
      { sep: true },
      { label: "Rotate 90° Clockwise", action: () => act(() => np.transform_rotate(90)) },
      { label: "Rotate 90° Anticlockwise", action: () => act(() => np.transform_rotate(-90)) },
      { label: "Rotate 180°", action: () => act(() => np.transform_rotate(180)) },
      { label: "Flip Horizontal", action: () => act(() => np.transform_flip_horizontal()) },
      { label: "Flip Vertical", action: () => act(() => np.transform_flip_vertical()) },
    ];
  }
  return [
    ...selectItems(),
    { sep: true },
    ...editItems().slice(3),
    { sep: true },
    { label: "Layer via Copy", shortcut: "", enabled: hasSelection, action: () => act(() => np.layer_via_copy()) },
    { label: "Adjustments", submenu: adjustmentItems() },
    { sep: true },
    { label: "Fit on Screen", shortcut: "Ctrl+0", action: fit },
    { label: "Actual Pixels", shortcut: "Ctrl+1", action: actualSize },
  ];
}

function beginTransform() {
  act(() => np.begin_transform());
}

// ---- Dialogs --------------------------------------------------------------------

function bindDialogs() {
  const dlg = $("dlg-new");
  dlg.addEventListener("close", () => {
    if (dlg.returnValue !== "ok") return;
    const w = clampInt($("new-width").value, 1, 8192, 1024);
    const h = clampInt($("new-height").value, 1, 8192, 768);
    np.new_document(w, h, $("new-bg").value);
    fit();
    touch();
  });
}

function showNewDialog() {
  $("new-width").value = np.width();
  $("new-height").value = np.height();
  $("dlg-new").showModal();
}

function clampInt(text, min, max, fallback) {
  const n = Math.round(Number(text));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function viewCentre() {
  return [viewport.clientWidth / 2, viewport.clientHeight / 2];
}

function zoomStep(direction) {
  const [cx, cy] = viewCentre();
  if (direction > 0) np.zoom_in_about(cx, cy);
  else np.zoom_out_about(cx, cy);
  needsDraw = true;
}

function fit() {
  np.fit_to_view(viewport.clientWidth, viewport.clientHeight);
  needsDraw = true;
}

function actualSize() {
  np.zoom_to_actual_size(viewport.clientWidth, viewport.clientHeight);
  needsDraw = true;
}

// ---- Files ------------------------------------------------------------------

let fileMode = "open";

function pickFile(mode) {
  fileMode = mode;
  const input = $("file-input");
  input.value = "";
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (file) loadFile(file, fileMode).catch((e) => message(`Could not open ${file.name}: ${e.message || e}`));
  };
  input.click();
}

/**
 * Decodes an image file and hands its pixels, at the picture's own size, to
 * the engine: as a new document (`open`), as a smart object fitted to the
 * document (`place`), or as the new contents of the active smart object
 * (`replace`). The engine works out the placement, so a placed picture keeps
 * every pixel it came with however small it is shown.
 */
async function loadFile(file, mode) {
  const bitmap = await createImageBitmap(file);
  const name = file.name.replace(/\.[^.]+$/, "") || "Image";
  const scratch = document.createElement("canvas");
  const sctx = scratch.getContext("2d");
  scratch.width = bitmap.width;
  scratch.height = bitmap.height;
  sctx.drawImage(bitmap, 0, 0);
  const data = sctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const bytes = new Uint8Array(data.data.buffer);
  bitmap.close();

  if (mode === "open") {
    np.open_image(name, data.width, data.height, bytes);
    fit();
  } else if (mode === "replace") {
    act(() => np.replace_smart_contents(active(), data.width, data.height, bytes));
  } else {
    act(() => np.place_smart_object(name, data.width, data.height, bytes));
    message(`Placed ${file.name} as a smart object: transform it freely, it keeps its pixels.`);
  }
  touch();
}

// ---- Canvas size ------------------------------------------------------------
//
// Dragging an edge is the quick way; this is the one where you type the
// numbers and press a button, which is also where the anchor lives.

function showCanvasDialog() {
  $("canvas-width").value = np.width();
  $("canvas-height").value = np.height();
  syncCanvasNote();
  $("dlg-canvas").showModal();
}

/** Says what the chosen size will do to the picture. */
function syncCanvasNote() {
  const w = Number($("canvas-width").value);
  const h = Number($("canvas-height").value);
  const note = $("canvas-note");
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
    note.textContent = "Give a width and a height of at least one pixel.";
    return;
  }
  if (w * h > np.max_pixels() || w > np.max_side() || h > np.max_side()) {
    note.textContent = `Too big: at most ${np.max_side()} px a side and ${Math.round(np.max_pixels() / 1e6)} megapixels.`;
    return;
  }
  const smaller = w < np.width() || h < np.height();
  note.textContent = smaller
    ? "The canvas is getting smaller: anything outside it is cropped away."
    : "New space is added empty; nothing already on the canvas moves within it.";
}

/** Where the old canvas sits inside the new one, from the anchor. */
function anchorOffset(anchor, width, height) {
  const dw = width - np.width();
  const dh = height - np.height();
  const x = anchor[1] === "l" ? 0 : anchor[1] === "r" ? dw : Math.round(dw / 2);
  const y = anchor[0] === "t" ? 0 : anchor[0] === "b" ? dh : Math.round(dh / 2);
  return [x, y];
}

function bindCanvasDialog() {
  for (const id of ["canvas-width", "canvas-height", "canvas-anchor"]) {
    $(id).addEventListener("input", syncCanvasNote);
  }
  $("canvas-cancel").addEventListener("click", () => $("dlg-canvas").close());
  $("canvas-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const w = Number($("canvas-width").value);
    const h = Number($("canvas-height").value);
    const [dx, dy] = anchorOffset($("canvas-anchor").value, w, h);
    act(() => {
      if (np.resize_canvas(w, h, dx, dy)) {
        message(`Canvas ${w} × ${h} px.`);
        $("dlg-canvas").close();
      } else {
        syncCanvasNote();
      }
    });
  });
}

/** Opens the export dialog; the actual writing happens on submit. */
function showExportDialog() {
  const dialog = $("dlg-export");
  syncExportFields();
  dialog.showModal();
}

/** JPEG has no transparency and the quality slider only applies to the lossy
 *  formats, so the dialog says what the chosen format will do. */
function syncExportFields() {
  const format = $("export-format").value;
  const lossy = format !== "image/png";
  $("export-quality-wrap").hidden = !lossy;
  $("export-quality-out").value = `${$("export-quality").value}%`;
  $("export-note").textContent =
    format === "image/jpeg"
      ? "JPEG cannot store transparency: anything transparent comes out white."
      : lossy
        ? "WebP keeps transparency. Lower quality means a smaller file."
        : "PNG is lossless and keeps transparency.";
}

function bindExport() {
  $("export-format").addEventListener("change", syncExportFields);
  $("export-quality").addEventListener("input", syncExportFields);
  $("export-cancel").addEventListener("click", () => $("dlg-export").close());
  $("export-form").addEventListener("submit", (e) => {
    e.preventDefault();
    $("dlg-export").close();
    writeImage($("export-format").value, Number($("export-quality").value) / 100, $("export-name").value.trim());
  });
}

/** The extension each format is normally written with. */
const EXTENSION = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function writeImage(format, quality, name) {
  const w = np.width();
  const h = np.height();
  const bytes = np.frame_copy();
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (format === "image/jpeg") {
    // No alpha in a JPEG, and the default is black rather than the white
    // people expect from a paint program.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  const image = new ImageData(new Uint8ClampedArray(bytes.buffer), w, h);
  if (format === "image/jpeg") {
    // putImageData ignores what is underneath, so compose through a second
    // canvas to keep the white showing through transparent pixels.
    const src = document.createElement("canvas");
    src.width = w;
    src.height = h;
    src.getContext("2d").putImageData(image, 0, 0);
    ctx.drawImage(src, 0, 0);
  } else {
    ctx.putImageData(image, 0, 0);
  }
  c.toBlob(
    (blob) => {
      if (!blob) {
        message(`This browser cannot write ${format.replace("image/", "").toUpperCase()}.`);
        return;
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${name || "npaint"}.${EXTENSION[format] ?? "png"}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      message(`Exported ${a.download} (${Math.round(blob.size / 1024)} kB).`);
    },
    format,
    quality
  );
}

// ---- Layers panel ---------------------------------------------------------------

function bindLayers() {
  $("layer-add").addEventListener("click", () => act(() => np.add_layer()));
  $("layer-dup").addEventListener("click", () => act(() => np.duplicate_layer(active())));
  $("layer-delete").addEventListener("click", () => act(() => np.remove_layer(active())));
  $("layer-merge").addEventListener("click", () => act(() => np.merge_down(active())));
  // Photoshop's add-mask button: the selection becomes the mask, or the
  // mask reveals everything when nothing is selected.
  $("layer-mask").addEventListener("click", () => act(() => np.add_layer_mask(active(), false)));
  $("layer-adjust").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showContextMenu(r.left, r.top - 4, adjustmentLayerItems());
  });
  // "Up" in the panel is towards the top of the stack, which is a higher index.
  $("layer-up").addEventListener("click", () => {
    const i = active();
    if (i + 1 < layerCount()) act(() => np.move_layer(i, i + 1));
  });
  $("layer-down").addEventListener("click", () => {
    const i = active();
    if (i > 0) act(() => np.move_layer(i, i - 1));
  });

  const opacity = $("layer-opacity");
  opacity.addEventListener("input", () => {
    np.set_layer_opacity(active(), Number(opacity.value) / 100);
    $("layer-opacity-out").value = `${opacity.value}%`;
  });

  $("layer-list").addEventListener("contextmenu", (e) => {
    const row = e.target.closest(".layer");
    if (!row) return;
    e.preventDefault();
    const index = Number(row.dataset.index);
    act(() => np.set_active_layer(index));
    showContextMenu(e.clientX, e.clientY, layerItems(index));
  });
}

/** Runs an engine operation, surfacing a refusal as a status message rather
 *  than an uncaught exception, and refreshing everything afterwards. */
function act(fn) {
  try {
    fn();
  } catch (e) {
    message(String(e));
  }
  touch();
}

/** The thumbnail box in the layers panel, matching `.thumb` in the stylesheet. */
const THUMB_W = 40;
const THUMB_H = 30;

/** What each kind of layer wears in the corner of its thumbnail. */
const KIND_BADGE = {
  adjustment: { glyph: "◑", title: "Adjustment layer: double-click to change its settings" },
  smart: { glyph: "▣", title: "Smart object: transforms from its original pixels" },
};

/**
 * A thumbnail canvas of `bytes`, which are `tw` x `th` RGBA, centred in
 * the box. The thumbnail keeps the document's shape inside a fixed box
 * rather than squashing a wide picture into a square one.
 */
function thumbnailCanvas(bytes, tw, th, className) {
  const thumb = document.createElement("canvas");
  thumb.className = `thumb ${className}`;
  thumb.width = THUMB_W;
  thumb.height = THUMB_H;
  thumb.getContext("2d").putImageData(
    new ImageData(new Uint8ClampedArray(bytes.buffer), tw, th),
    Math.round((THUMB_W - tw) / 2),
    Math.round((THUMB_H - th) / 2)
  );
  return thumb;
}

/** An adjustment layer has no pixels to show, so its thumbnail is its mark. */
function adjustmentThumbnail() {
  const thumb = document.createElement("canvas");
  thumb.className = "thumb";
  thumb.width = THUMB_W;
  thumb.height = THUMB_H;
  const ctx = thumb.getContext("2d");
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(0, 0, THUMB_W, THUMB_H);
  ctx.beginPath();
  ctx.arc(THUMB_W / 2, THUMB_H / 2, 9, 0, Math.PI * 2);
  ctx.fillStyle = "#eee";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(THUMB_W / 2, THUMB_H / 2, 9, Math.PI / 2, -Math.PI / 2);
  ctx.fillStyle = "#111";
  ctx.fill();
  return thumb;
}

function renderLayers() {
  const list = $("layer-list");
  const count = layerCount();
  const act_ = active();
  list.replaceChildren();
  const fit = Math.min(THUMB_W / np.width(), THUMB_H / np.height());
  const tw = Math.max(1, Math.round(np.width() * fit));
  const th = Math.max(1, Math.round(np.height() * fit));

  for (let i = count - 1; i >= 0; i--) {
    const li = document.createElement("li");
    const visible = np.layer_visible(i);
    const kind = layerKind(i);
    const masked = hasMask(i);
    const onMask = masked && np.layer_editing_mask(i);
    li.className = "layer" + (i === act_ ? " active" : "") + (visible ? "" : " hidden-layer");
    li.dataset.index = i;

    const eye = document.createElement("button");
    eye.className = "eye";
    eye.title = visible ? "Hide layer" : "Show layer";
    eye.innerHTML = EYE;
    eye.addEventListener("click", (e) => {
      e.stopPropagation();
      act(() => np.set_layer_visible(i, !visible));
    });

    // The pixels. Clicking one chooses it as what the tools edit; Ctrl-click
    // selects what it draws without making the layer active.
    const pixels = document.createElement("span");
    pixels.className = "thumb-wrap" + (onMask ? "" : " target");
    pixels.appendChild(kind === "adjustment" ? adjustmentThumbnail() : thumbnailCanvas(np.layer_thumbnail(i, tw, th), tw, th, ""));
    if (KIND_BADGE[kind]) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = KIND_BADGE[kind].glyph;
      pixels.appendChild(badge);
      pixels.title = KIND_BADGE[kind].title;
    } else {
      pixels.title = "Ctrl-click to select everything on this layer" + (masked ? "; click to edit the pixels" : "");
    }
    pixels.addEventListener("click", (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.stopPropagation();
        act(() => {
          if (!np.select_layer_opaque(i)) message("There is nothing on that layer to select.");
        });
      } else if (onMask) {
        e.stopPropagation();
        act(() => {
          np.set_active_layer(i);
          np.set_layer_target(i, false);
        });
      }
    });

    const thumbs = document.createElement("span");
    thumbs.className = "thumbs";
    thumbs.appendChild(pixels);

    // The mask, if there is one. Click edits it, Shift-click switches it
    // off and on, Ctrl-click loads it as the selection — as in Photoshop.
    if (masked) {
      const enabled = np.layer_mask_enabled(i);
      const link = document.createElement("span");
      link.className = "thumb-link";
      link.textContent = "⛓";
      const mask = document.createElement("span");
      mask.className = "thumb-wrap" + (onMask ? " target" : "") + (enabled ? "" : " mask-off");
      mask.appendChild(thumbnailCanvas(np.layer_mask_thumbnail(i, tw, th), tw, th, "mask-thumb"));
      mask.title = enabled
        ? "Layer mask: click to paint on it, Shift-click to disable, Ctrl-click to load as a selection"
        : "Layer mask (disabled): Shift-click to enable";
      mask.addEventListener("click", (e) => {
        e.stopPropagation();
        act(() => {
          if (e.ctrlKey || e.metaKey) {
            if (!np.select_layer_mask(i)) message("The mask hides everything, so there is nothing to select.");
          } else if (e.shiftKey) {
            np.set_layer_mask_enabled(i, !enabled);
          } else {
            np.set_active_layer(i);
            np.set_layer_target(i, true);
          }
        });
      });
      thumbs.append(link, mask);
    }

    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = np.layer_name(i);
    name.title = kind === "adjustment" ? "Double-click to change the adjustment" : "Double-click to rename";
    name.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      if (kind === "adjustment") withActive(i, () => editAdjustmentLayer(i));
      else beginRename(name, i);
    });

    li.append(eye, thumbs, name);
    li.addEventListener("click", () => act(() => np.set_active_layer(i)));
    list.appendChild(li);
  }

  const opacity = Math.round(np.layer_opacity(act_) * 100);
  $("layer-opacity").value = opacity;
  $("layer-opacity-out").value = `${opacity}%`;
  $("layer-delete").disabled = count <= 1;
  $("layer-merge").disabled = act_ === 0 || layerKind(act_ - 1) !== "pixels";
  $("layer-mask").disabled = hasMask(act_);
  $("layer-up").disabled = act_ >= count - 1;
  $("layer-down").disabled = act_ === 0;
}

function renameLayer(index) {
  const row = $("layer-list").querySelector(`.layer[data-index="${index}"] .layer-name`);
  if (row) beginRename(row, index);
}

function beginRename(nameEl, index) {
  const input = document.createElement("input");
  input.value = np.layer_name(index);
  nameEl.replaceChildren(input);
  input.focus();
  input.select();
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    act(() => np.rename_layer(index, input.value));
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      done = true;
      layersDirty = true;
    }
  });
}

// ---- Pointer ------------------------------------------------------------------

function canvasPoint(e) {
  const r = view.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

const HIT_CURSOR = {
  inside: "cursor-move",
  rotate: "cursor-rotate",
  "top-left": "cursor-nwse",
  "bottom-right": "cursor-nwse",
  "top-right": "cursor-nesw",
  "bottom-left": "cursor-nesw",
  top: "cursor-ns",
  bottom: "cursor-ns",
  left: "cursor-ew",
  right: "cursor-ew",
};

function setHitCursor(hit) {
  for (const cls of Object.values(HIT_CURSOR)) viewport.classList.remove(cls);
  if (HIT_CURSOR[hit]) viewport.classList.add(HIT_CURSOR[hit]);
}

/** How close to an edge, in CSS pixels, counts as grabbing it. */
const EDGE_GRAB = 7;

/** The document's rectangle on screen, in CSS pixels. */
function canvasRect() {
  const zoom = np.zoom();
  return { x: np.pan_x(), y: np.pan_y(), w: np.width() * zoom, h: np.height() * zoom };
}

/**
 * Which canvas edge the pointer is grabbing, as a string of the sides it
 * would move ("l", "r", "t", "b" and the corner pairs), or null.
 *
 * Only counts from *outside* the canvas, so painting right up to the edge is
 * never taken for a resize.
 */
function edgeAt(x, y) {
  const r = canvasRect();
  const left = x <= r.x && x >= r.x - EDGE_GRAB;
  const right = x >= r.x + r.w && x <= r.x + r.w + EDGE_GRAB;
  const top = y <= r.y && y >= r.y - EDGE_GRAB;
  const bottom = y >= r.y + r.h && y <= r.y + r.h + EDGE_GRAB;
  const withinX = x >= r.x - EDGE_GRAB && x <= r.x + r.w + EDGE_GRAB;
  const withinY = y >= r.y - EDGE_GRAB && y <= r.y + r.h + EDGE_GRAB;
  if (!withinX || !withinY) return null;
  const sides = `${top ? "t" : bottom ? "b" : ""}${left ? "l" : right ? "r" : ""}`;
  return sides || null;
}

const EDGE_CURSOR = { l: "ew-resize", r: "ew-resize", t: "ns-resize", b: "ns-resize", tl: "nwse-resize", br: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize" };

/**
 * The document rectangle the drag is asking for, in document pixels, clamped
 * to a canvas the engine will actually make. Without the clamp a drag while
 * zoomed out asks for hundreds of thousands of pixels a side, which is tens
 * of gigabytes of layer and the end of the tab.
 */
function resizedRect(x, y) {
  const doc = np.screen_to_doc(x, y);
  const edge = resizing.edge;
  let x0 = 0;
  let y0 = 0;
  let x1 = np.width();
  let y1 = np.height();
  if (edge.includes("l")) x0 = Math.min(Math.round(doc[0]), x1 - 1);
  if (edge.includes("r")) x1 = Math.max(Math.round(doc[0]), x0 + 1);
  if (edge.includes("t")) y0 = Math.min(Math.round(doc[1]), y1 - 1);
  if (edge.includes("b")) y1 = Math.max(Math.round(doc[1]), y0 + 1);

  const side = np.max_side();
  const pixels = np.max_pixels();
  let w = Math.max(1, Math.min(x1 - x0, side));
  let h = Math.max(1, Math.min(y1 - y0, side));
  // Each side fits; the area may still not, so trim whichever is growing.
  w = Math.max(1, Math.min(w, Math.floor(pixels / h)));
  h = Math.max(1, Math.min(h, Math.floor(pixels / w)));
  // Put the clamped size back on the edge being dragged, so the far edge
  // stays where it is.
  if (edge.includes("l")) x0 = x1 - w;
  else x1 = x0 + w;
  if (edge.includes("t")) y0 = y1 - h;
  else y1 = y0 + h;
  return { x0, y0, x1, y1 };
}

function bindPointer() {
  view.addEventListener("pointerdown", (e) => {
    closeMenus();
    const [x, y] = canvasPoint(e);
    if (e.button === 2) return; // the context menu handler has it
    if (sizing) {
      // The click that ends the sizing must not also start a stroke.
      endSizing(true);
      e.preventDefault();
      return;
    }
    const wantsPan = e.button === 1 || spaceHeld;
    const edge = wantsPan ? null : edgeAt(x, y);
    if (edge && e.button === 0) {
      // Dragging a canvas edge resizes the canvas, and only starts from
      // outside it, so it never gets in the way of painting.
      resizing = { edge, rect: { x0: 0, y0: 0, x1: np.width(), y1: np.height() } };
      needsDraw = true;
    } else if (wantsPan) {
      pan = { x, y };
      viewport.classList.add("panning", "dragging");
    } else if (e.button === 0) {
      // With the zoom tool, the options-bar "zoom out" acts like Alt.
      const alt = e.altKey || (tool === "zoom" && zoomOutMode);
      if (!np.pointer_down(x, y, e.shiftKey, alt)) {
        // A smart object's pixels or an adjustment layer's: the engine says
        // which, and what to do instead.
        const why = np.edit_refusal();
        if (why) message(why.charAt(0).toUpperCase() + why.slice(1) + ".");
        return;
      }
    } else {
      return;
    }
    view.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  view.addEventListener("pointermove", (e) => {
    const [x, y] = canvasPoint(e);
    const [dx, dy] = np.screen_to_doc(x, y);
    $("status-cursor").textContent = `${Math.floor(dx)}, ${Math.floor(dy)}`;
    if (sizeToPointer(x, y)) return;
    if (showsBrushRing()) {
      cursor = { x, y };
      needsDraw = true;
    }
    if (resizing) {
      resizing.rect = resizedRect(x, y);
      needsDraw = true;
      return;
    }
    if (!pan && !np.is_gesturing()) {
      const edge = edgeAt(x, y);
      view.style.cursor = edge ? EDGE_CURSOR[edge] ?? "" : "";
    }
    if (pan) {
      np.pan_by(x - pan.x, y - pan.y);
      pan = { x, y };
      needsDraw = true;
    } else if (np.is_transforming()) {
      if (e.buttons & 1) np.pointer_move(x, y, e.shiftKey, e.altKey);
      else setHitCursor(np.transform_hit(x, y));
    } else if (np.is_gesturing()) {
      np.pointer_move(x, y, e.shiftKey, e.altKey);
      needsDraw = true;
    }
  });

  const end = (e) => {
    const [x, y] = canvasPoint(e);
    if (resizing) {
      const r = resizedRect(x, y);
      resizing = null;
      view.style.cursor = "";
      const w = r.x1 - r.x0;
      const h = r.y1 - r.y0;
      act(() => {
        if (np.resize_canvas(w, h, -r.x0, -r.y0)) message(`Canvas ${w} × ${h} px.`);
      });
      return;
    }
    if (pan) {
      pan = null;
      viewport.classList.remove("panning", "dragging");
    } else if (np.is_transforming()) {
      np.pointer_up(x, y, e.shiftKey, e.altKey);
      layersDirty = true;
    } else if (np.is_gesturing()) {
      np.pointer_up(x, y, e.shiftKey, e.altKey);
      needsDraw = true;
    }
  };
  view.addEventListener("pointerup", end);
  view.addEventListener("pointercancel", () => {
    pan = null;
    resizing = null;
    view.style.cursor = "";
    viewport.classList.remove("panning", "dragging");
    np.cancel_gesture();
    needsDraw = true;
  });
  view.addEventListener("pointerleave", () => {
    cursor = null;
    needsDraw = true;
    $("status-cursor").textContent = "—";
  });

  view.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const [x, y] = canvasPoint(e);
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinches arrive as ctrl+wheel with small deltas; mouse
        // wheels in steps of ~100. The exponent makes both feel right.
        np.zoom_by_about(Math.exp(-e.deltaY * 0.005), x, y);
      } else if (e.shiftKey) {
        np.pan_by(-e.deltaY, 0);
      } else {
        np.pan_by(-e.deltaX, -e.deltaY);
      }
      needsDraw = true;
    },
    { passive: false }
  );

  view.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, canvasContextItems());
  });
  // A stray middle-click on Linux would otherwise paste.
  view.addEventListener("auxclick", (e) => e.preventDefault());
}

// ---- Keyboard -------------------------------------------------------------------

/** The inputs that actually swallow letters, as opposed to sliders and boxes. */
const TEXT_ENTRY = new Set(["text", "number", "search", "email", "url", "password", "tel"]);
/** The keys a slider or a checkbox uses itself, which it should keep. */
const CONTROL_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Enter",
  " ",
]);

/**
 * Whether a key belongs to the field it was pressed in rather than to the
 * editor. A text box takes everything; a tolerance slider or an "All layers"
 * checkbox takes only the keys it works with, so clicking one does not leave
 * every shortcut dead until you click somewhere else.
 */
function typingInField(e) {
  const t = e.target;
  if (!t) return false;
  if (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
  if (t.tagName !== "INPUT") return false;
  if (TEXT_ENTRY.has((t.type || "text").toLowerCase())) return true;
  return CONTROL_KEYS.has(e.key);
}

function bindKeyboard() {
  window.addEventListener("keydown", (e) => {
    if ($("dlg-new").open || $("dlg-canvas").open || $("dlg-export").open || adjust.isOpen()) return;
    if (e.key === "Alt") {
      altHeld = true;
      syncOptions();
    }
    if (typingInField(e) && e.key !== "Escape") return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (e.code === "Space" && !e.repeat) {
      spaceHeld = true;
      viewport.classList.add("panning");
      e.preventDefault();
      return;
    }

    if (np.is_transforming() && handleTransformKey(e, key, mod)) {
      e.preventDefault();
      return;
    }

    if (mod) {
      const handled = handleShortcut(key, e.shiftKey, e.altKey);
      if (handled) e.preventDefault();
      return;
    }

    switch (key) {
      case "f":
        if (!endSizing(true)) beginSizing();
        return;
      case "Enter":
        endSizing(true);
        return;
      case "Escape":
        closeMenus();
        picker.close();
        if (endSizing(false)) return;
        np.cancel_gesture();
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        return;
      case "Delete":
      case "Backspace":
        act(() => (e.altKey ? np.fill_selection() : np.clear_selection()));
        e.preventDefault();
        return;
      case "+":
      case "=":
        zoomStep(1);
        return;
      case "-":
      case "_":
        zoomStep(-1);
        return;
      case "[":
        setSize(np.size() - (np.size() > 10 ? 5 : 1));
        return;
      case "]":
        setSize(np.size() + (np.size() >= 10 ? 5 : 1));
        return;
      case "t":
        // Ctrl+T is the browser's new-tab shortcut and never reaches the
        // page, so plain T is the one that actually works.
        beginTransform();
        return;
      case "x":
        swapColors();
        return;
      case "d":
        resetColors();
        return;
      default:
        break;
    }

    const t = TOOLS.find((t) => t.key.toLowerCase() === key);
    if (t && !e.altKey) setTool(t.name);
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
      spaceHeld = false;
      if (!pan) viewport.classList.remove("panning");
    }
    if (e.key === "Alt") {
      altHeld = false;
      syncOptions();
    }
  });

  window.addEventListener("blur", () => {
    endSizing(false);
    spaceHeld = false;
    altHeld = false;
    viewport.classList.remove("panning");
  });
}

/** Keys while a free transform is open. Returns whether one matched. */
function handleTransformKey(e, key, mod) {
  const step = e.shiftKey ? 10 : 1;
  switch (key) {
    case "Enter":
      act(() => np.commit_session());
      return true;
    case "Escape":
      act(() => np.cancel_session());
      return true;
    case "ArrowLeft":
      return act(() => np.transform_nudge(-step, 0)), true;
    case "ArrowRight":
      return act(() => np.transform_nudge(step, 0)), true;
    case "ArrowUp":
      return act(() => np.transform_nudge(0, -step)), true;
    case "ArrowDown":
      return act(() => np.transform_nudge(0, step)), true;
    default:
      return mod && key === "t";
  }
}

/** Ctrl/Cmd shortcuts. Returns whether one matched. */
function handleShortcut(key, shift, alt) {
  switch (key) {
    case "z":
      act(() => (shift ? np.redo() : np.undo()));
      return true;
    case "y":
      act(() => np.redo());
      return true;
    case "a":
      act(() => np.select_all());
      return true;
    case "d":
      act(() => np.deselect());
      return true;
    case "t":
      beginTransform();
      return true;
    case "0":
      fit();
      return true;
    case "1":
      actualSize();
      return true;
    case "n":
      if (shift) act(() => np.add_layer());
      else showNewDialog();
      return true;
    case "j":
      act(() => (hasSelection() ? np.layer_via_copy() : np.duplicate_layer(active())));
      return true;
    case "e":
      act(() => (shift ? np.flatten() : np.merge_down(active())));
      return true;
    case "i":
      if (shift) act(() => np.select_invert());
      else adjust.open("invert");
      return true;
    case "u":
      adjust.open(shift ? "desaturate" : "hue-saturation");
      return true;
    case "l":
      adjust.open("levels");
      return true;
    case "o":
      pickFile("open");
      return true;
    case "s":
      showExportDialog();
      return true;
    case "Backspace":
      act(() => (alt ? np.fill_selection() : np.fill_selection_background()));
      return true;
    default:
      return false;
  }
}

// Awaited at the top level so the page's load event waits for the editor:
// that is what lets a headless browser screenshot the finished page.
try {
  await boot();
} catch (e) {
  $("loading").textContent = `NPaint failed to start: ${e.message || e}`;
  console.error(e);
}
