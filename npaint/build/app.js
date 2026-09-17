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
import { createCommandPalette } from "./commands.js";
import { createColorPicker } from "./colorpicker.js";
import { ADJUSTMENTS, createAdjustDialog } from "./adjust.js";
import { createGradientEditor, paintGradient, toFlat, fromFlat, loadStops } from "./gradient.js";
import { createPalettePanel } from "./palette.js";
import { readRecovery, writeRecovery, clearRecovery, supported as recoverySupported } from "./recovery.js";

// ---- Tools ------------------------------------------------------------------

const ICON = {
  select: '<rect x="4" y="4" width="16" height="16" stroke-dasharray="3 2"/>',
  "ellipse-select": '<ellipse cx="12" cy="12" rx="8" ry="7" stroke-dasharray="3 2"/>',
  lasso: '<path d="M6 17c-2-1-3-2.5-3-4.5C3 8 7.5 5 12 5s9 3 9 7.5c0 3-2.5 5-5.5 5.5" stroke-dasharray="3 2"/><path d="M6 17c-1.5 1-1.5 3 .5 3s2-2 .5-3z"/>',
  crop: '<path d="M7 2v15h15M2 7h15v15"/>',
  bucket: '<path d="M5 11l7-7 7 7-7 7z"/><path d="M12 4V2M19 13c0 2 1.5 3 1.5 4.5a1.5 1.5 0 01-3 0C17.5 16 19 15 19 13z"/>',
  gradient: '<rect x="3" y="5" width="18" height="14"/><path d="M5 17h14M5 14.5h14M5 12h14M5 9.5h14M5 7h14" opacity=".55" stroke-dasharray="0.6 1.4"/><path d="M3 5h18v4H3z" fill="currentColor" stroke="none" opacity=".35"/>',
  eyedropper: '<path d="M4 20l1-4 9-9 3 3-9 9z"/><path d="M13 6l2-2a2 2 0 013 3l-2 2"/>',
  wand: '<path d="M4 20l9-9M6.5 4.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5L3 8l2.5-1zM17 3l.8 2.2L20 6l-2.2.8L17 9l-.8-2.2L14 6l2.2-.8zM19 14l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"/><path d="M12.5 11.5l2 2"/>',
  quickselect: '<path d="M3 12a9 9 0 0113.5-7.8" stroke-dasharray="3 2"/><path d="M21 12a9 9 0 01-9 9" stroke-dasharray="3 2"/><path d="M8 17c1.5-.3 2.2-1.3 2.6-2.6L17 8l2 2-6.4 6.4C11.3 16.8 10 17.5 8 17.5z"/>',
  refine: '<path d="M4 20c2-.5 3-2 3.5-4l8.5-8.5 2.5 2.5L10 18.5c-2 .5-3.5 1.5-6 1.5z"/><circle cx="17" cy="6" r="3.2" stroke-dasharray="2.5 2"/>',
  subject: '<rect x="3" y="3" width="18" height="18" rx="1" stroke-dasharray="3 2"/><circle cx="12" cy="10" r="3"/><path d="M6.5 19c.8-3.2 2.8-4.5 5.5-4.5s4.7 1.3 5.5 4.5"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  brush: '<path d="M4 20c2-.5 3-2 3.5-4l8.5-8.5 2.5 2.5L10 18.5c-2 .5-3.5 1.5-6 1.5z"/><path d="M15 6l3-3 3 3-3 3"/>',
  pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  eraser: '<path d="M5 15l8-8 6 6-6 6H9z"/><path d="M9 19h11"/>',
  clone: '<path d="M8 3h8v5H8z"/><path d="M4 13c0-2.2 2-3 4-5h8c2 2 4 2.8 4 5z"/><path d="M4 13h16v3H4z"/><path d="M10 16v5h4v-5"/>',
  line: '<path d="M5 19L19 5"/>',
  rectangle: '<rect x="4" y="6" width="16" height="12"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  text: '<path d="M5 7V4h14v3M12 4v16M9 20h6"/>',
  zoom: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20M8 10.5h5M10.5 8v5"/>',
  hand: '<path d="M8 12V6a1.5 1.5 0 013 0v5V5a1.5 1.5 0 013 0v6V7a1.5 1.5 0 013 0v7.5a5.5 5.5 0 01-11 0V10a1.5 1.5 0 013 0z"/>',
};

const TOOLS = [
  {
    name: "select",
    label: "Rectangular marquee",
    key: "M",
    hint: "Drag to select a rectangle; click to deselect. Shift adds, Alt takes away; Shift during the drag squares it.",
  },
  {
    name: "ellipse-select",
    label: "Elliptical marquee",
    key: "M",
    hint: "Drag to select an ellipse. Shift adds, Alt takes away; Shift during the drag makes a circle.",
  },
  {
    name: "lasso",
    label: "Lasso",
    key: "L",
    hint: "Draw round what you want; letting go closes the loop. Shift adds, Alt takes away, Shift+Alt keeps the overlap.",
  },
  {
    name: "crop",
    label: "Crop",
    key: "C",
    hint: "Drag out the area to keep, then press Enter or click Crop. Esc clears the box.",
  },
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
    name: "subject",
    label: "Select subject",
    key: "W",
    hint: "Drag a box around the subject and the model finds it in there. Shift adds, Alt takes away.",
  },
  {
    name: "refine",
    label: "Refine selection",
    key: "R",
    hint: "Paint the selection itself to fix it: drag to add, Alt+drag to rub out.",
  },
  { name: "move", label: "Move", key: "V", hint: "Drag to move the selected pixels, or the whole layer." },
  { name: "brush", label: "Brush", key: "B", hint: "Paint with the foreground colour at the chosen opacity. Shift+click draws a straight line from the last stroke. Alt+click picks a colour." },
  { name: "pencil", label: "Pencil", key: "P", hint: "Hard, fully opaque strokes. Shift+click draws a straight line from the last stroke. Alt+click picks a colour." },
  { name: "eraser", label: "Eraser", key: "E", hint: "Erase to transparent. Shift+click erases a straight line from the last stroke." },
  {
    name: "clone",
    label: "Clone stamp",
    key: "S",
    hint: "Alt+click what you want to copy from, then paint it in somewhere else. Aligned keeps the same offset for every stroke.",
  },
  {
    name: "bucket",
    label: "Paint bucket",
    key: "G",
    hint: "Click to fill the patch of colour under the pointer with the foreground colour. Alt+click picks a colour.",
  },
  {
    name: "gradient",
    label: "Gradient",
    key: "G",
    hint: "Drag out the two ends and the layer fills with the gradient. Click the gradient to edit its colours. Shift snaps to 45°.",
  },
  {
    name: "eyedropper",
    label: "Eyedropper",
    key: "I",
    hint: "Click to pick the foreground colour from the picture; Alt+click picks the background colour.",
  },
  { name: "line", label: "Line", key: "L", hint: "Drag to draw a line. Shift snaps to 45°." },
  { name: "rectangle", label: "Rectangle", key: "U", hint: "Drag to draw. Shift for a square, Alt to draw from the centre." },
  { name: "ellipse", label: "Ellipse", key: "O", hint: "Drag to draw. Shift for a circle, Alt to draw from the centre." },
  {
    name: "text",
    label: "Text",
    key: "Y",
    hint: "Click to start typing, or click a text layer to edit it. Ctrl+Enter or a click elsewhere keeps it; Esc throws it away.",
  },
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
/**
 * Half-size copies of the offscreen frame, built when the view is zoomed
 * out and the frame has changed. Drawing a 6000-pixel-wide canvas at 15%
 * samples every source pixel each frame; drawing the level nearest the
 * zoom samples a fraction of them, and box-filters on the way down, so it
 * is both quicker and less shimmery than bilinear straight from full size.
 */
const mips = [];
/** The reduced frame a dialog previews into, and whether it is what to draw. */
let previewCanvas = null;
let previewing = false;
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
/** The history panel alone needs redrawing: a selection gesture made a step
 * but no layer changed, and the thumbnails are a pass over every layer. */
let historyDirty = false;
/** The status-bar line for the selection, recomputed with the ants: counting
 * a mask's pixels is a pass over the document, not something for every frame. */
let selectionStatus = "";
/** The ants' path, rebuilt only when the view or the selection moves. */
let antsPath = null;
let antsPathKey = "";
// Where the pointer is over the canvas, in CSS pixels, for the brush ring.
let cursor = null;
// Set once the render loop has reported a failure, so it says so once.
let frameFailed = false;
// Set while a canvas edge is being dragged: which edge, and where it is now.
let resizing = null;
let dpr = 1;
let commandPalette; // the command palette
let picker; // the colour picker
let pickerTarget = "fg"; // which swatch the picker is editing
// While the picker is open on something that is not one of the swatches —
// a gradient stop, a palette colour — what to do with the colour it gives.
let pickerHandler = null;
let gradientEditor; // the gradient editor popover
let palettePanel; // the palette panel
let adjust; // the adjustment dialog
// The document's name, from the file it came from; what Save and Export use.
// A document that came from nowhere is still saved under something, so the
// default is a filename rather than a title — which is why anything that
// shows the name to the user checks for it first.
const UNTITLED = "npaint";
let docName = UNTITLED;
// The view furniture: none of it is in the document, so the page keeps it.
let showRulers = false;
let showGrid = false;
let showPixelGrid = true;
/** Whether the palette panel is in the side column. */
let showPalette = true;
let gridSize = 32;
/** Whether the move tool and transforms snap to guides and canvas edges. */
let snapToGuides = true;
// Guides in document pixels, and one being dragged out of a ruler or moved.
let guides = { h: [], v: [] };
let guideDrag = null; // { axis: "h" | "v", at: number | null, index: number | null }

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
  bindGradientEditor();
  bindPalettePanel();
  bindLayers();
  bindPointer();
  bindKeyboard();
  bindDialogs();
  bindExport();
  bindCanvasDialog();
  bindImageSizeDialog();
  bindHistory();
  bindClipboard();
  bindDrop();
  bindUnload();
  loadViewPrefs();
  np.set_snap(snapToGuides);
  adjust = createAdjustDialog(np, { onChange: touch, onError: message });

  $("loading").hidden = true;
  $("app").hidden = false;

  new ResizeObserver(onResize).observe(viewport);
  onResize();
  np.fit_to_view(viewport.clientWidth, viewport.clientHeight);
  syncOptions();
  buildQualityPicker();
  requestAnimationFrame(frame);
  startRecovery();
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
  pullGuides();
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
  // While a dialog previews and the canvas is zoomed out, the engine
  // composites at the size the screen is showing rather than at the
  // document's — a sixteenth of the pixels at a quarter zoom — and the page
  // draws that stretched over the canvas. The frame is left as the last
  // full render made it, and the session's commit brings it back.
  const shown = np.render_preview();
  if (shown.length) {
    const [pw, ph, redrawn] = shown;
    if (redrawn) {
      if (!previewCanvas) previewCanvas = document.createElement("canvas");
      if (previewCanvas.width !== pw || previewCanvas.height !== ph) {
        previewCanvas.width = pw;
        previewCanvas.height = ph;
      }
      const preview = new Uint8ClampedArray(memory.buffer, np.preview_ptr(), np.preview_len());
      previewCanvas.getContext("2d").putImageData(new ImageData(preview, pw, ph), 0, 0);
      needsDraw = true;
    }
    previewing = true;
  } else if (previewing) {
    // The session ended: back to the frame, which the engine has marked
    // whole so that the render below fills it.
    previewing = false;
    needsDraw = true;
  }

  // The engine recomposites only what changed and says what that was; a
  // brush dab on a 4K canvas is a few hundred pixels, not eight million.
  const changed = np.render();
  if (changed.length) {
    // The frame is a view into wasm memory: no copy until putImageData.
    const w = np.width();
    const h = np.height();
    const resized = offscreen.width !== w || offscreen.height !== h;
    if (resized) {
      offscreen.width = w;
      offscreen.height = h;
      // The levels were built for the old size; there is nothing in them to
      // patch, so `sourceFor` builds them again as the zoom asks for them.
      mips.length = 0;
    }
    // A canvas that just changed size is blank, so the engine's rectangle
    // is not enough to fill it — take the lot.
    const rect = resized ? [0, 0, w, h] : changed;
    const bytes = new Uint8ClampedArray(memory.buffer, np.frame_ptr(), np.frame_len());
    octx.putImageData(new ImageData(bytes, w, h), 0, 0, ...rect);
    patchMips(rect);
    needsDraw = true;
    layersDirty = true;
    antsDirty = true;
  }

  // Tracing the outline of a mask costs a pass over the document, so it is
  // done when the selection may have changed rather than once a frame; the
  // ants themselves crawl by moving the dash along a path that stays put.
  if (antsDirty) {
    ants = np.selection_contours();
    antsPath = null;
    const rect = np.selection_rect();
    selectionStatus = rect.length
      ? `Selection ${np.selection_area()} px in ${rect[2]} × ${rect[3]} at ${rect[0]}, ${rect[1]}`
      : "";
    antsDirty = false;
  }
  const transforming = np.is_transforming();
  // The text box follows the canvas; and a layer operation, an undo or a
  // new document ends the session in the engine, after which there is
  // nothing for the box to type into.
  if (textEdit) {
    if (!np.is_editing_text()) closeTextBox();
    else if (needsDraw) placeTextBox();
  }
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
    renderHistory();
    syncTransformBar();
    syncCropBar();
    syncSwatches();
    layersDirty = false;
    historyDirty = false;
  } else if (historyDirty && !np.is_gesturing()) {
    renderHistory();
    syncCropBar();
    historyDirty = false;
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
  // zoomed out so the downsample is not a moiré, from a level near the zoom.
  vctx.imageSmoothingEnabled = zoom < 1;
  vctx.drawImage(previewing ? previewCanvas : sourceFor(zoom), px, py, w, h);

  vctx.strokeStyle = "rgba(0,0,0,0.6)";
  vctx.lineWidth = 1;
  vctx.strokeRect(px - 0.5, py - 0.5, w + 1, h + 1);

  if (showGrid) drawGrid(px, py, zoom, w, h);
  if (BRUSH_TOOLS.has(tool) && tool !== "quickselect" && tool !== "refine") drawSymmetryAxes(px, py, zoom, w, h);
  if (showPixelGrid && zoom >= 8) drawPixelGrid(px, py, zoom, w, h);
  if (tool === "crop" && !transforming) drawCropShade(px, py, zoom);
  if (tool === "subject") drawSubjectBox(px, py, zoom);
  if (tool === "clone") drawClonePreview(px, py, zoom);
  if (ants.length) drawAnts(now, ants, px, py, zoom);
  drawGuides(px, py, zoom);

  const overlay = np.tool_overlay();
  if (overlay.length) drawZoomMarquee(overlay);

  if (transforming) drawTransformBox();
  if (resizing) drawResizePreview(zoom);
  if ((cursor || sizing) && showsBrushRing() && !resizing) drawBrushRing(zoom);
  if (showRulers) drawRulers(px, py, zoom);

  $("btn-zoom-level").textContent = `${Math.round(zoom * 100)}%`;
  $("status-size").textContent = `${np.width()} × ${np.height()} px`;
  $("status-brush").textContent = showsBrushRing() ? `Brush ${np.size()} px` : "";
  $("status-selection").textContent = transforming ? "" : selectionStatus;
}

/**
 * The canvas to draw the document from at `zoom`: the offscreen frame
 * itself, or the half-size level that is still at least as large as what is
 * on screen. Levels are rebuilt from the frame only when it has changed, and
 * only as far down as the zoom needs.
 */
function sourceFor(zoom) {
  let level = 0;
  while (level < 4 && zoom <= 0.5 / 2 ** level) level++;
  if (level === 0) return offscreen;
  for (let i = mips.length; i < level; i++) {
    const src = i === 0 ? offscreen : mips[i - 1];
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.floor(src.width / 2));
    c.height = Math.max(1, Math.floor(src.height / 2));
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // Exactly the call `patchMips` makes over the whole level, down to the
    // even source rectangle, so that a level built from scratch and one
    // patched in place agree to the pixel and nothing shimmers when a
    // redraw switches between them.
    ctx.drawImage(src, 0, 0, c.width * 2, c.height * 2, 0, 0, c.width, c.height);
    mips.push(c);
  }
  return mips[level - 1];
}

/**
 * Redraws `[x, y, w, h]` of the document through the levels that already
 * exist, rather than throwing them away and downsampling the whole 4K frame
 * again for the next stroke. Each level is half the one above, so the
 * rectangle halves as it goes down; it is grown by a pixel first so the
 * smoothing at its edge still has the neighbours it would have had, and
 * cleared before it is redrawn because drawImage composites.
 */
function patchMips(rect) {
  let [x, y, w, h] = rect;
  for (let i = 0; i < mips.length; i++) {
    const src = i === 0 ? offscreen : mips[i - 1];
    const level = mips[i];
    // Grow by a pixel so the filter at the edge has its neighbours, then
    // out to even edges so that halving lands exactly on this level's grid.
    const x0 = even(Math.max(0, x - 1));
    const y0 = even(Math.max(0, y - 1));
    const x1 = Math.min(level.width * 2, even(x + w + 2));
    const y1 = Math.min(level.height * 2, even(y + h + 2));
    if (x1 <= x0 || y1 <= y0) return;
    const [dx, dy, dw, dh] = [x0 / 2, y0 / 2, (x1 - x0) / 2, (y1 - y0) / 2];
    const ctx = level.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // drawImage composites, so what is there has to go first.
    ctx.clearRect(dx, dy, dw, dh);
    ctx.drawImage(src, x0, y0, x1 - x0, y1 - y0, dx, dy, dw, dh);
    [x, y, w, h] = [dx, dy, dw, dh];
  }
}

/** `v` rounded down to an even number. */
const even = (v) => v - (v % 2);


/**
 * The marching ants: the outline of the selection, whatever shape it is.
 *
 * The engine hands over closed loops in document coordinates, flattened as a
 * point count followed by that many x, y pairs — one loop per island, and one
 * per hole. Two dashed passes offset from each other give the black-and-white
 * crawl that reads against any picture.
 */
function drawAnts(now, ants, px, py, zoom) {
  const key = `${px},${py},${zoom}`;
  if (!antsPath || antsPathKey !== key) {
    antsPath = new Path2D();
    for (let i = 0; i < ants.length; ) {
      const count = ants[i++];
      for (let n = 0; n < count; n++) {
        const x = Math.round(px + ants[i++] * zoom) + 0.5;
        const y = Math.round(py + ants[i++] * zoom) + 0.5;
        if (n === 0) antsPath.moveTo(x, y);
        else antsPath.lineTo(x, y);
      }
      antsPath.closePath();
    }
    antsPathKey = key;
  }
  const path = antsPath;
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

/** The grid: lines every `gridSize` document pixels, over the document. */
function drawGrid(px, py, zoom, w, h) {
  const step = gridSize * zoom;
  if (step < 4) return;
  vctx.save();
  vctx.beginPath();
  vctx.rect(px, py, w, h);
  vctx.clip();
  vctx.beginPath();
  for (let x = 0; x <= np.width(); x += gridSize) {
    const sx = Math.round(px + x * zoom) + 0.5;
    vctx.moveTo(sx, py);
    vctx.lineTo(sx, py + h);
  }
  for (let y = 0; y <= np.height(); y += gridSize) {
    const sy = Math.round(py + y * zoom) + 0.5;
    vctx.moveTo(px, sy);
    vctx.lineTo(px + w, sy);
  }
  vctx.lineWidth = 1;
  vctx.strokeStyle = "rgba(0,0,0,0.35)";
  vctx.stroke();
  vctx.strokeStyle = "rgba(255,255,255,0.35)";
  vctx.setLineDash([2, 2]);
  vctx.stroke();
  vctx.restore();
}

/** Hairlines between pixels once they are big enough to have room for one. */
function drawPixelGrid(px, py, zoom, w, h) {
  const left = Math.max(0, Math.floor(-px / zoom));
  const top = Math.max(0, Math.floor(-py / zoom));
  const right = Math.min(np.width(), Math.ceil((view.clientWidth - px) / zoom));
  const bottom = Math.min(np.height(), Math.ceil((view.clientHeight - py) / zoom));
  if (right <= left || bottom <= top) return;
  vctx.save();
  vctx.beginPath();
  vctx.rect(px, py, w, h);
  vctx.clip();
  vctx.beginPath();
  for (let x = left; x <= right; x++) {
    const sx = Math.round(px + x * zoom) + 0.5;
    vctx.moveTo(sx, py + top * zoom);
    vctx.lineTo(sx, py + bottom * zoom);
  }
  for (let y = top; y <= bottom; y++) {
    const sy = Math.round(py + y * zoom) + 0.5;
    vctx.moveTo(px + left * zoom, sy);
    vctx.lineTo(px + right * zoom, sy);
  }
  vctx.lineWidth = 1;
  vctx.strokeStyle = "rgba(128,128,128,0.35)";
  vctx.stroke();
  vctx.restore();
}

/** The subject tool's box, while it is drawn out and while the model runs. */
function drawSubjectBox(px, py, zoom) {
  const r = np.subject_box();
  if (!r.length) return;
  drawZoomMarquee([px + r[0] * zoom, py + r[1] * zoom, r[2] * zoom, r[3] * zoom]);
}

/** The scratch canvas the clone preview's patch is decoded into. */
const clonePatch = document.createElement("canvas");
const clonePatchCtx = clonePatch.getContext("2d");

/**
 * The clone stamp's source: the pixels it is about to lay down, drawn inside
 * the brush ring where they will land, and a crosshair where they are being
 * read from. Without it the offset is invisible until the paint is down and
 * the only way to line a copy up is to try it and undo.
 */
function drawClonePreview(px, py, zoom) {
  const anchor = np.clone_anchor();
  if (!anchor.length) return;
  const { at, radius } = brushRingAt(zoom);
  // With no pointer over the canvas there is nowhere to preview; the
  // crosshair still says where the source was left.
  if (!at) {
    drawCrosshair(px + anchor[0] * zoom, py + anchor[1] * zoom);
    return;
  }
  const [docX, docY] = np.screen_to_doc(at.x, at.y);
  const offset = np.clone_source_offset(docX, docY);
  if (!offset.length) return;
  const [dx, dy] = offset;
  drawCrosshair(at.x + dx * zoom, at.y + dy * zoom);
  if (radius < 1.5) return;

  // The dab's square, twice: where the pixels are read from, and where they
  // would be stamped. Drawing the first at the second is the preview.
  const size = np.size();
  const destX = Math.round(docX) - (size >> 1);
  const destY = Math.round(docY) - (size >> 1);
  const bytes = np.clone_source_patch(destX + dx, destY + dy, size, size);
  if (bytes.length !== size * size * 4) return;
  clonePatch.width = size;
  clonePatch.height = size;
  clonePatchCtx.putImageData(new ImageData(new Uint8ClampedArray(bytes), size, size), 0, 0);

  vctx.save();
  brushRingPath(at, radius);
  vctx.clip();
  vctx.imageSmoothingEnabled = zoom < 1;
  // Where the source is transparent the picture underneath should show, so
  // the patch is drawn over the canvas rather than onto a cleared square.
  vctx.drawImage(clonePatch, px + destX * zoom, py + destY * zoom, size * zoom, size * zoom);
  vctx.restore();
}

/** A small cross, light over dark so it shows against any picture. */
function drawCrosshair(x, y) {
  const arm = 7;
  vctx.save();
  vctx.beginPath();
  vctx.moveTo(x - arm, y);
  vctx.lineTo(x + arm, y);
  vctx.moveTo(x, y - arm);
  vctx.lineTo(x, y + arm);
  vctx.lineWidth = 3;
  vctx.strokeStyle = "rgba(0,0,0,0.45)";
  vctx.stroke();
  vctx.lineWidth = 1;
  vctx.strokeStyle = "rgba(255,255,255,0.95)";
  vctx.stroke();
  vctx.restore();
}

/** With the crop tool, everything outside the box is dimmed. */
function drawCropShade(px, py, zoom) {
  const r = np.selection_rect();
  if (!r.length) return;
  vctx.save();
  vctx.beginPath();
  vctx.rect(0, 0, view.clientWidth, view.clientHeight);
  vctx.rect(px + r[0] * zoom, py + r[1] * zoom, r[2] * zoom, r[3] * zoom);
  vctx.fillStyle = "rgba(0,0,0,0.5)";
  vctx.fill("evenodd");
  vctx.restore();
}

/** The height of the ruler bands, in CSS pixels. */
const RULER = 20;

/** A tick spacing in document pixels that puts labels ~60px apart. */
function rulerStep(zoom) {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
  return steps.find((s) => s * zoom >= 60) ?? 10000;
}

function drawRulers(px, py, zoom) {
  const W = view.clientWidth;
  const H = view.clientHeight;
  const step = rulerStep(zoom);
  vctx.save();
  vctx.fillStyle = "#2b2b2b";
  vctx.fillRect(0, 0, W, RULER);
  vctx.fillRect(0, 0, RULER, H);
  vctx.strokeStyle = "#111";
  vctx.lineWidth = 1;
  vctx.beginPath();
  vctx.moveTo(0, RULER + 0.5);
  vctx.lineTo(W, RULER + 0.5);
  vctx.moveTo(RULER + 0.5, 0);
  vctx.lineTo(RULER + 0.5, H);
  vctx.stroke();
  vctx.fillStyle = "#9a9a9a";
  vctx.strokeStyle = "#7a7a7a";
  vctx.font = "9px system-ui, sans-serif";
  vctx.textBaseline = "top";
  const minor = step / 5;
  // Across the top.
  vctx.beginPath();
  const x0 = Math.floor((RULER - px) / zoom / minor) * minor;
  const x1 = (W - px) / zoom;
  for (let x = x0; x <= x1; x += minor) {
    const sx = Math.round(px + x * zoom) + 0.5;
    if (sx < RULER) continue;
    const major = Math.abs(x / step - Math.round(x / step)) < 1e-6;
    vctx.moveTo(sx, RULER);
    vctx.lineTo(sx, major ? 8 : 14);
    if (major) vctx.fillText(String(Math.round(x)), sx + 2, 1);
  }
  vctx.stroke();
  // Down the side, with the labels turned.
  vctx.beginPath();
  const y0 = Math.floor((RULER - py) / zoom / minor) * minor;
  const y1 = (H - py) / zoom;
  for (let y = y0; y <= y1; y += minor) {
    const sy = Math.round(py + y * zoom) + 0.5;
    if (sy < RULER) continue;
    const major = Math.abs(y / step - Math.round(y / step)) < 1e-6;
    vctx.moveTo(RULER, sy);
    vctx.lineTo(major ? 8 : 14, sy);
    if (major) {
      vctx.save();
      vctx.translate(1, sy + 2);
      vctx.rotate(Math.PI / 2);
      vctx.fillText(String(Math.round(y)), 0, -9);
      vctx.restore();
    }
  }
  vctx.stroke();
  // The corner, and a marker for the pointer.
  vctx.fillStyle = "#2b2b2b";
  vctx.fillRect(0, 0, RULER, RULER);
  if (cursor) {
    vctx.strokeStyle = "#4ea3f2";
    vctx.beginPath();
    vctx.moveTo(Math.round(cursor.x) + 0.5, 0);
    vctx.lineTo(Math.round(cursor.x) + 0.5, RULER);
    vctx.moveTo(0, Math.round(cursor.y) + 0.5);
    vctx.lineTo(RULER, Math.round(cursor.y) + 0.5);
    vctx.stroke();
  }
  vctx.restore();
}

/** The guides, and the one being dragged. */
/** The mirror axes and the spokes of a radial symmetry, while one is on. */
function drawSymmetryAxes(px, py, zoom, w, h) {
  const [mx, my, n] = np.symmetry();
  if (!mx && !my && n <= 1) return;
  const cx = px + w / 2;
  const cy = py + h / 2;
  vctx.save();
  vctx.beginPath();
  vctx.rect(px, py, w, h);
  vctx.clip();
  vctx.lineWidth = 1;
  vctx.setLineDash([6, 4]);
  vctx.strokeStyle = "rgba(255, 120, 200, 0.75)";
  vctx.beginPath();
  if (mx) {
    vctx.moveTo(Math.round(cx) + 0.5, py);
    vctx.lineTo(Math.round(cx) + 0.5, py + h);
  }
  if (my) {
    vctx.moveTo(px, Math.round(cy) + 0.5);
    vctx.lineTo(px + w, Math.round(cy) + 0.5);
  }
  const reach = Math.hypot(w, h);
  for (let k = 0; k < (n > 1 ? n : 0); k++) {
    const angle = (Math.PI * 2 * k) / n - Math.PI / 2;
    vctx.moveTo(cx, cy);
    vctx.lineTo(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach);
  }
  vctx.stroke();
  vctx.restore();
}

function drawGuides(px, py, zoom) {
  const lines = [];
  for (const y of guides.h) lines.push(["h", y, false]);
  for (const x of guides.v) lines.push(["v", x, false]);
  if (guideDrag && guideDrag.at !== null) lines.push([guideDrag.axis, guideDrag.at, true]);
  if (!lines.length) return;
  vctx.save();
  vctx.lineWidth = 1;
  for (const [axis, at, live] of lines) {
    vctx.strokeStyle = live ? "#4ea3f2" : "rgba(0,200,255,0.9)";
    vctx.beginPath();
    if (axis === "h") {
      const sy = Math.round(py + at * zoom) + 0.5;
      vctx.moveTo(0, sy);
      vctx.lineTo(view.clientWidth, sy);
    } else {
      const sx = Math.round(px + at * zoom) + 0.5;
      vctx.moveTo(sx, 0);
      vctx.lineTo(sx, view.clientHeight);
    }
    vctx.stroke();
  }
  vctx.restore();
}

/** The tools whose size is worth seeing before the stroke starts. */
const BRUSH_TOOLS = new Set(["brush", "pencil", "eraser", "clone", "quickselect", "refine"]);
const showsBrushRing = () => BRUSH_TOOLS.has(tool);

/**
 * The brush, drawn where the pointer is and the size it will actually paint.
 * Two rings, light over dark, so it shows up against any picture.
 */
/** Where the ring is drawn, and how big: the dab the next stroke would lay. */
function brushRingAt(zoom) {
  return { at: sizing ? sizing.anchor : cursor, radius: (np.size() * zoom) / 2 };
}

/**
 * The outline of the dab, as a path on `vctx`: a square for the square tip,
 * the disc every other tip fits inside otherwise. The clone stamp's preview
 * is clipped to the same shape, so what it shows is exactly what it covers.
 */
function brushRingPath(at, radius) {
  vctx.beginPath();
  if (BRUSH_TOOLS.has(tool) && tool !== "quickselect" && tool !== "refine" && np.brush_tip() === "square") {
    vctx.rect(at.x - radius, at.y - radius, radius * 2, radius * 2);
  } else {
    vctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
  }
}

function drawBrushRing(zoom) {
  const { at, radius } = brushRingAt(zoom);
  // Below a pixel or two the ring is just noise; the crosshair says enough.
  if (radius < 1.5) return;
  vctx.save();
  brushRingPath(at, radius);
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

/**
 * The tools whose gestures change the selection. The engine does not
 * recomposite for them (nothing in the picture changed), so the page has
 * to know to retrace the ants itself.
 */
const SELECTION_TOOLS = new Set(["select", "ellipse-select", "lasso", "crop", "wand", "quickselect", "refine"]);

/** Which block of the toolbox each tool belongs in, in order. */
const TOOL_GROUPS = [
  ["select", "ellipse-select", "lasso", "crop", "wand", "quickselect", "subject", "refine"],
  ["move"],
  ["brush", "pencil", "eraser", "bucket", "gradient", "eyedropper"],
  ["line", "rectangle", "ellipse"],
  ["text"],
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
  commitText();
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
  const hasOpacity = tool === "brush" || tool === "eraser" || tool === "clone" || tool === "bucket" || tool === "gradient";
  const hasTip = tool === "brush" || tool === "pencil" || tool === "eraser" || tool === "clone";
  // The pencil is hard whatever the slider says, and chalk and spatter
  // have their grain and their dots in place of a soft rim.
  const hasHardness = (tool === "brush" || tool === "eraser" || tool === "clone") && np.brush_tip_has_hardness();
  const isText = tool === "text";
  const auto = tool === "wand" || tool === "quickselect" || tool === "refine";
  const subject = tool === "subject";
  const marquee = tool === "select" || tool === "ellipse-select" || tool === "lasso" || tool === "crop";
  const viewTool =
    marquee ||
    subject ||
    tool === "hand" ||
    tool === "zoom" ||
    tool === "move" ||
    tool === "wand" ||
    tool === "bucket" ||
    tool === "eyedropper" ||
    isText;
  const isGradient = tool === "gradient";
  const usesSize = !viewTool && !isGradient && !(isShape && np.fill());
  $("opt-opacity-wrap").hidden = !hasOpacity;
  $("opt-tip-wrap").hidden = !hasTip;
  $("opt-tip").value = np.brush_tip();
  $("opt-symmetry-wrap").hidden = !hasTip;
  $("opt-symmetry").value = np.symmetry().join(",");
  $("opt-smoothing-wrap").hidden = !hasTip;
  $("opt-smoothing").value = Math.round(np.smoothing() * 100);
  $("opt-smoothing-out").value = `${Math.round(np.smoothing() * 100)}%`;
  $("opt-pressure-wrap").hidden = !hasTip;
  $("opt-pressure").checked = np.pressure_size();
  $("opt-character").hidden = !isText;
  if (!isText) closeCharacterPanel();
  else syncCharacterPanel();
  $("opt-hardness-wrap").hidden = !hasHardness;
  $("opt-font-wrap").hidden = !isText;
  $("opt-font-size-wrap").hidden = !isText;
  $("opt-text-style-wrap").hidden = !isText;
  $("opt-align-wrap").hidden = !isText;
  $("text-bar").hidden = !textEdit;
  if (isText) {
    ensureFontOption(np.text_font());
    $("opt-font").value = np.text_font();
    if (document.activeElement !== $("opt-font-size")) $("opt-font-size").value = np.text_size();
    setPressed($("opt-bold"), np.text_bold());
    setPressed($("opt-italic"), np.text_italic());
    for (const a of ["left", "center", "right"]) setPressed($(`opt-align-${a}`), np.text_align() === a);
  }
  $("opt-hardness").value = Math.round(np.hardness() * 100);
  $("opt-hardness-out").value = `${Math.round(np.hardness() * 100)}%`;
  $("opt-fill-wrap").hidden = !isShape;
  $("opt-gradient-wrap").hidden = !isGradient;
  $("opt-gradient-reverse-wrap").hidden = !isGradient;
  $("opt-gradient-edit").hidden = !isGradient;
  $("opt-gradient").value = np.gradient_shape();
  $("opt-gradient-reverse").checked = np.gradient_reverse();
  if (isGradient) syncGradientButton();
  else if (gradientEditor) gradientEditor.close();
  // The tolerance is the wand's, quick select's and the bucket's; the refine
  // brush paints the selection by hand and has only a size.
  $("opt-tolerance-wrap").hidden = !(tool === "wand" || tool === "quickselect" || tool === "bucket");
  $("opt-sample-wrap").hidden = !(tool === "wand" || tool === "bucket");
  $("opt-aligned-wrap").hidden = tool !== "clone";
  $("opt-aligned").checked = np.clone_aligned();
  $("opt-all-layers-wrap").hidden = !(auto || tool === "bucket" || tool === "clone");
  $("opt-antialias-wrap").hidden = !(auto || tool === "bucket" || tool === "ellipse-select" || tool === "lasso");
  $("opt-subject").hidden = !(auto || subject);
  $("opt-quality-wrap").hidden = !(auto || subject);
  $("opt-tolerance").value = np.tolerance();
  $("opt-tolerance-out").value = np.tolerance();
  $("opt-all-layers").checked = np.sample_all_layers();
  $("opt-antialias").checked = np.antialias();
  syncCropBar();
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
  setPressed(onEl, first);
  setPressed(offEl, !first);
}

function setPressed(el, on) {
  el.classList.toggle("seg-on", on);
  el.setAttribute("aria-pressed", String(on));
}

/** The font list's last entry, which opens a file rather than picking a face. */
const LOAD_FONT = "__load-font-file__";

function addFontOption(family) {
  const o = document.createElement("option");
  o.value = family;
  o.textContent = family;
  o.style.fontFamily = `"${family}"`;
  const font = $("opt-font");
  const last = [...font.options].find((opt) => opt.value === LOAD_FONT) ?? null;
  font.insertBefore(o, last);
  return o;
}

/** A face the list lacks — a document set on another machine — joins it. */
function ensureFontOption(family) {
  if (![...$("opt-font").options].some((o) => o.value === family)) addFontOption(family);
}

/**
 * Loads a font file into the page under the file's name and offers it in
 * the list. The browser has it for the session; the document keeps only
 * the name.
 */
async function loadFontFile(file) {
  const family = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Loaded font";
  const face = new FontFace(family, await file.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  ensureFontOption(family);
  return family;
}

/**
 * The typefaces the text tool offers. The generic families are always
 * there; the named ones are the common web-safe set, and one the machine
 * lacks falls back to the family the browser thinks nearest. The file keeps
 * the name, so a document set in a face another machine lacks comes back
 * in the fallback there and in the face itself here.
 */
const FONTS = [
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "Arial",
  "Helvetica",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Georgia",
  "Times New Roman",
  "Garamond",
  "Palatino",
  "Courier New",
  "Impact",
  "Comic Sans MS",
  "Brush Script MT",
];

function bindOptions() {
  const size = $("opt-size");
  const sizeNum = $("opt-size-num");
  size.addEventListener("input", () => setSize(Number(size.value)));
  sizeNum.addEventListener("change", () => setSize(Number(sizeNum.value) || 1));

  const tip = $("opt-tip");
  const tipNames = NPaint.brush_tip_names();
  const tipLabels = NPaint.brush_tip_labels();
  tipNames.forEach((name, i) => {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = tipLabels[i];
    tip.appendChild(o);
  });
  tip.addEventListener("change", () => {
    np.set_brush_tip(tip.value);
    syncOptions();
  });
  const gradient = $("opt-gradient");
  const gradientNames = NPaint.gradient_shape_names();
  const gradientLabels = NPaint.gradient_shape_labels();
  gradientNames.forEach((name, i) => {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = gradientLabels[i];
    gradient.appendChild(o);
  });
  gradient.addEventListener("change", () => np.set_gradient_shape(gradient.value));
  $("opt-gradient-reverse").addEventListener("change", (e) => {
    np.set_gradient_reverse(e.target.checked);
    syncGradientButton();
  });
  $("opt-symmetry").addEventListener("change", (e) => {
    const [mx, my, n] = e.target.value.split(",").map(Number);
    np.set_symmetry(Boolean(mx), Boolean(my), n);
    needsDraw = true;
  });
  const smoothing = $("opt-smoothing");
  smoothing.addEventListener("input", () => {
    np.set_smoothing(Number(smoothing.value) / 100);
    $("opt-smoothing-out").value = `${smoothing.value}%`;
  });
  $("opt-pressure").addEventListener("change", (e) => np.set_pressure_size(e.target.checked));

  // The text tool's type settings. A change while a text layer is being
  // typed into sets that layer again at once.
  const font = $("opt-font");
  for (const family of FONTS) addFontOption(family);
  const load = document.createElement("option");
  load.value = LOAD_FONT;
  load.textContent = "Load font file…";
  font.appendChild(load);
  font.addEventListener("change", () => {
    if (font.value === LOAD_FONT) {
      font.value = np.text_font();
      $("font-input").click();
      return;
    }
    np.set_text_font(font.value);
    previewText();
  });
  $("font-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const family = await loadFontFile(file);
      np.set_text_font(family);
      syncOptions();
      previewText();
      message(`Loaded ${file.name}. The document keeps the font's name; load the file again on another machine.`);
    } catch (err) {
      message(`Could not load ${file.name}: ${err.message || err}`);
    }
  });
  bindCharacterPanel();
  const fontSize = $("opt-font-size");
  const applyFontSize = () => {
    np.set_text_size(Number(fontSize.value) || np.text_size());
    fontSize.value = np.text_size();
    previewText();
  };
  fontSize.addEventListener("change", applyFontSize);
  fontSize.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      applyFontSize();
      fontSize.blur();
    }
  });
  $("opt-bold").addEventListener("click", () => {
    np.set_text_bold(!np.text_bold());
    syncOptions();
    previewText();
  });
  $("opt-italic").addEventListener("click", () => {
    np.set_text_italic(!np.text_italic());
    syncOptions();
    previewText();
  });
  for (const a of ["left", "center", "right"]) {
    $(`opt-align-${a}`).addEventListener("click", () => {
      np.set_text_align(a);
      syncOptions();
      previewText();
    });
  }
  $("text-apply").addEventListener("click", commitText);
  $("text-cancel").addEventListener("click", cancelText);

  const opacity = $("opt-opacity");
  opacity.addEventListener("input", () => {
    np.set_opacity(Number(opacity.value) / 100);
    $("opt-opacity-out").value = `${opacity.value}%`;
  });
  const hardness = $("opt-hardness");
  hardness.addEventListener("input", () => {
    np.set_hardness(Number(hardness.value) / 100);
    $("opt-hardness-out").value = `${hardness.value}%`;
  });
  $("crop-apply").addEventListener("click", cropToSelection);
  $("crop-cancel").addEventListener("click", () => act(() => np.deselect()));

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
  $("opt-aligned").addEventListener("change", (e) => np.set_clone_aligned(e.target.checked));
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
  bindTransformFields();
}

/** The typed-in side of the transform bar. */
function bindTransformFields() {
  const num = (id) => Number($(id).value);
  const position = () => act(() => np.transform_set_position(num("tb-x"), num("tb-y")));
  $("tb-x").addEventListener("change", position);
  $("tb-y").addEventListener("change", position);
  const linked = () => $("tb-link").getAttribute("aria-pressed") === "true";
  $("tb-link").addEventListener("click", () => {
    $("tb-link").setAttribute("aria-pressed", String(!linked()));
    $("tb-link").classList.toggle("seg-on", linked());
  });
  $("tb-link").classList.add("seg-on");
  const size = (changed) => {
    const info = np.transform_info();
    if (info.length !== 7) return;
    let w = num("tb-w");
    let h = num("tb-h");
    if (linked() && info[2] > 0 && info[3] > 0) {
      if (changed === "w") h = (w * info[3]) / info[2];
      else w = (h * info[2]) / info[3];
    }
    act(() => np.transform_set_size(Math.max(1, w), Math.max(1, h)));
  };
  $("tb-w").addEventListener("change", () => size("w"));
  $("tb-h").addEventListener("change", () => size("h"));
  $("tb-angle").addEventListener("change", () => act(() => np.transform_set_angle(num("tb-angle"))));
  for (const id of ["tb-x", "tb-y", "tb-w", "tb-h", "tb-angle"]) {
    $(id).addEventListener("keydown", (e) => {
      // Enter applies the field, not the whole transform; Escape leaves it.
      if (e.key === "Enter") {
        e.preventDefault();
        $(id).dispatchEvent(new Event("change"));
        $(id).blur();
      }
      if (e.key === "Escape") $(id).blur();
      e.stopPropagation();
    });
  }
}

/** With the crop tool the options bar offers to crop to the box. */
function syncCropBar() {
  const on = tool === "crop";
  $("crop-bar").hidden = !on;
  if (on) $("crop-apply").disabled = !hasSelection();
}

function cropToSelection() {
  act(() => {
    if (!np.crop_to_selection()) message("Drag out the area to keep first.");
    else {
      fit();
      message(`Cropped to ${np.width()} × ${np.height()} px.`);
    }
  });
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
    const fields = { "tb-x": x.toFixed(0), "tb-y": y.toFixed(0), "tb-w": w.toFixed(0), "tb-h": h.toFixed(0), "tb-angle": angle.toFixed(1) };
    for (const [id, value] of Object.entries(fields)) {
      // A field being typed in keeps what is being typed.
      if (document.activeElement !== $(id)) $(id).value = value;
    }
    $("tb-label").textContent = np.is_transforming_selection() ? "Transform selection" : "Transform";
  }
}

// ---- Colours --------------------------------------------------------------------

function bindSwatches() {
  picker = createColorPicker($("color-popover"), {
    onChange: (hex) => {
      if (pickerTarget === "fg") np.set_color(hex);
      else if (pickerTarget === "bg") np.set_background(hex);
      else if (pickerTarget === "outline") {
        np.set_text_outline_color(hex);
        syncCharacterPanel();
        previewText();
      } else if (pickerHandler) {
        pickerHandler(hex);
      }
      syncSwatches();
    },
    // Picking the outline's colour mid-typing hands the keyboard back to
    // the text box, so Ctrl+Enter still keeps the text.
    onClose: () => {
      if (pickerTarget === "outline") refocusText();
    },
  });
  $("swatch-fg").addEventListener("click", () => openPicker("fg"));
  $("swatch-bg").addEventListener("click", () => openPicker("bg"));
  $("swatch-swap").addEventListener("click", swapColors);
  $("swatch-reset").addEventListener("click", resetColors);
  syncSwatches();
}

// ---- The gradient editor ---------------------------------------------------

/** The gradient shown on the options bar's button, in CSS pixels. */
const GRADIENT_PREVIEW_W = 64;
const GRADIENT_PREVIEW_H = 18;

function bindGradientEditor() {
  gradientEditor = createGradientEditor($("gradient-editor"), {
    onChange: (stops) => {
      np.set_gradient_stops(toFlat(stops));
      syncGradientButton();
    },
    pickColor: openPickerOn,
  });
  // The engine starts on the swatches; a gradient chosen last time is put
  // back, as the view furniture and the recent colours are.
  const saved = loadStops();
  if (saved.length) np.set_gradient_stops(toFlat(saved));
  $("opt-gradient-edit").addEventListener("click", () => {
    if (gradientEditor.isOpen()) gradientEditor.close();
    else gradientEditor.open($("opt-gradient-edit"), currentStops());
  });
  syncGradientButton();
}

/**
 * The stops the gradient tool would lay down now: the editor's, or the two
 * swatches while it is running from those.
 */
function currentStops() {
  const stops = fromFlat(np.gradient_stops());
  if (stops.length) return stops;
  return [
    { at: 0, color: np.color(), alpha: 255 },
    { at: 1, color: np.background(), alpha: 255 },
  ];
}

/** The button shows the run as the tool will lay it down, Reverse and all. */
function syncGradientButton() {
  const stops = currentStops();
  const shown = np.gradient_reverse() ? stops.map((s) => ({ ...s, at: 1 - s.at })).sort((a, b) => a.at - b.at) : stops;
  paintGradient($("opt-gradient-preview"), shown, { width: GRADIENT_PREVIEW_W, height: GRADIENT_PREVIEW_H });
}

// ---- The palette panel ------------------------------------------------------

function bindPalettePanel() {
  palettePanel = createPalettePanel({
    setForeground: (hex) => {
      np.set_color(hex);
      syncSwatches();
    },
    setBackground: (hex) => {
      np.set_background(hex);
      syncSwatches();
    },
    foreground: () => np.color(),
    pickColor: openPickerOn,
    imagePalette: (max, separation) => np.image_palette(max, separation),
    download,
    message,
  });
  syncPalettePanel();
}

function syncPalettePanel() {
  $("palette-panel").hidden = !showPalette;
  if (showPalette && palettePanel) palettePanel.refresh();
}

/**
 * Opens the picker on something with no swatch of its own — a gradient stop,
 * a palette colour — handing every colour it gives to `onChange`.
 */
function openPickerOn(anchor, hex, onChange) {
  pickerTarget = "custom";
  pickerHandler = onChange;
  picker.open(anchor, hex);
}

/** Opens the picker on a swatch: the foreground, the background, or the text outline's colour. */
function openPicker(target) {
  pickerTarget = target;
  pickerHandler = null;
  const anchors = { fg: "swatch-fg", bg: "swatch-bg", outline: "char-outline-color" };
  const colors = { fg: () => np.color(), bg: () => np.background(), outline: () => np.text_outline_color() };
  picker.open($(anchors[target]), colors[target]());
}

function syncSwatches() {
  $("swatch-fg").style.setProperty("--swatch", np.color());
  $("swatch-bg").style.setProperty("--swatch", np.background());
  // A gradient running from the swatches follows them.
  if (gradientEditor) syncGradientButton();
  // Text being typed is in the foreground colour: a new colour sets it again.
  if (textEdit && textEdit.color !== np.color()) previewText();
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
/** How many rows the panel has picked out; 1 is the active layer alone. */
const selectedCount = () => np.selected_layer_count();

/** The Image > Adjustments list: everything but the filters. */
function adjustmentItems() {
  return menuItemsFor((a) => a.group !== "filter");
}

/** The Filter menu: the ones that read more than the pixel they are at. */
function filterItems() {
  return menuItemsFor((a) => a.group === "filter");
}

function menuItemsFor(wanted) {
  return ADJUSTMENTS.filter(wanted).map((a) => ({
    label: a.label,
    shortcut: a.shortcut,
    action: () => adjust.open(a.name),
  }));
}

/** The same list as new adjustment layers, filters and all: the layer is
 *  made with neutral settings and its dialog opened straight away, if it has
 *  any. The filters go last, behind a rule, as they do in the menu bar. */
function adjustmentLayerItems() {
  const asLayer = (a) => ({
    label: a.label,
    action: () =>
      act(() => {
        const index = np.add_adjustment_layer(a.name, new Float32Array());
        adjust.openLayer(index);
      }),
  });
  return [
    ...ADJUSTMENTS.filter((a) => a.group !== "filter").map(asLayer),
    { sep: true },
    ...ADJUSTMENTS.filter((a) => a.group === "filter").map(asLayer),
  ];
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
    { label: "New Group", action: () => act(() => np.add_group()) },
    {
      label: () => (selectedCount() > 1 ? "Duplicate Layers" : "Duplicate Layer"),
      shortcut: "Ctrl+J",
      action: () => act(() => np.duplicate_selected_layers()),
    },
    {
      label: "Layer via Copy",
      enabled: () => hasSelection() && layerKind(i()) !== "group",
      action: () => act(() => np.layer_via_copy()),
    },
    {
      label: () => (selectedCount() > 1 ? "Delete Layers" : "Delete Layer"),
      enabled: () => layerCount() > 1,
      action: () => act(() => np.remove_selected_layers()),
    },
    { sep: true },
    {
      label: "Edit Adjustment…",
      enabled: () => layerKind(i()) === "adjustment",
      action: () => withActive(i(), () => editAdjustmentLayer(i())),
    },
    {
      label: "Edit Text…",
      enabled: () => layerKind(i()) === "text",
      action: () => editTextLayer(i()),
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
      enabled: () => layerKind(i()) === "smart" || layerKind(i()) === "text",
      action: () => act(() => np.rasterize_layer(i())),
    },
    {
      label: "Replace Contents…",
      enabled: () => layerKind(i()) === "smart",
      action: () => withActive(i(), () => pickFile("replace")),
    },
    { sep: true },
    { label: "Rename…", shortcut: "F2", action: () => act(() => renameLayer(i())) },
    {
      label: "Hide Layer",
      checked: () => !np.layer_visible(i()),
      action: () => act(() => np.set_layer_visible(i(), !np.layer_visible(i()))),
    },
    {
      label: "Lock Layer",
      checked: () => np.layer_locked(i()),
      action: () => act(() => np.set_layer_locked(i(), !np.layer_locked(i()))),
    },
    {
      label: "Lock Transparent Pixels",
      checked: () => np.layer_lock_alpha(i()),
      enabled: () => layerKind(i()) === "pixels",
      action: () => act(() => np.set_layer_lock_alpha(i(), !np.layer_lock_alpha(i()))),
    },
    { label: "Blend Mode", submenu: blendItems(i) },
    { sep: true },
    // Grouping a layer wraps it where it is, so the picture does not change.
    {
      label: () => (selectedCount() > 1 ? `Group ${selectedCount()} Layers` : "Group Layer"),
      shortcut: "Ctrl+G",
      action: () => act(() => np.group_selected_layers()),
    },
    {
      label: "Ungroup",
      shortcut: "Ctrl+Shift+G",
      enabled: () => layerKind(i()) === "group",
      action: () => act(() => np.ungroup(i())),
    },
    { sep: true },
    { label: "Move Up", enabled: () => np.can_reorder_layer(i(), true), action: () => act(() => np.reorder_layer(i(), true)) },
    { label: "Move Down", enabled: () => np.can_reorder_layer(i(), false), action: () => act(() => np.reorder_layer(i(), false)) },
    { sep: true },
    {
      label: () => (layerKind(i()) === "group" ? "Merge Group" : "Merge Down"),
      shortcut: "Ctrl+E",
      enabled: () => canMergeDown(i()),
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

/** The blend modes, as a submenu for one layer. */
function blendItems(i) {
  const names = NPaint.blend_mode_names();
  const labels = NPaint.blend_mode_labels();
  return names.map((name, k) => ({
    label: labels[k],
    checked: () => np.layer_blend(i()) === name,
    action: () => act(() => np.set_layer_blend(i(), name)),
  }));
}

/** Runs `fn` with `index` as the active layer — the context menu acts on
 *  the row that was clicked, not the one that happened to be active. */
function withActive(index, fn) {
  act(() => {
    np.set_active_layer(index);
    fn();
  });
}

/** The widths Edit > Stroke offers, so no dialog is needed. */
const STROKE_WIDTHS = [1, 2, 3, 4, 6, 8, 12, 16];

function editItems() {
  return [
    { label: "Undo", shortcut: "Ctrl+Z", enabled: () => np.can_undo(), action: () => act(() => np.undo()) },
    { label: "Redo", shortcut: "Ctrl+Shift+Z", enabled: () => np.can_redo(), action: () => act(() => np.redo()) },
    { sep: true },
    { label: "Cut", shortcut: "Ctrl+X", action: () => copyToClipboard("cut") },
    { label: "Copy", shortcut: "Ctrl+C", action: () => copyToClipboard("copy") },
    { label: "Copy Merged", shortcut: "Ctrl+Shift+C", action: () => copyToClipboard("merged") },
    { label: "Paste", shortcut: "Ctrl+V", action: pasteFromMenu },
    { sep: true },
    { label: "Free Transform…", shortcut: "T", action: beginTransform },
    { sep: true },
    { label: "Fill with Foreground", shortcut: "Alt+Backspace", action: () => act(() => np.fill_selection()) },
    { label: "Fill with Background", shortcut: "Ctrl+Backspace", action: () => act(() => np.fill_selection_background()) },
    {
      label: "Stroke Selection",
      submenu: STROKE_WIDTHS.map((n) => ({
        label: `${n} px, foreground colour`,
        enabled: hasSelection,
        action: () => act(() => np.stroke_selection(n)),
      })),
    },
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
    { sep: true },
    { label: "Transform Selection…", enabled: hasSelection, action: () => act(() => np.begin_transform_selection()) },
  ];
}

/** The View menu: what the page draws around the document. */
function viewItems() {
  return [
    { label: "Zoom In", shortcut: "Ctrl++", action: () => zoomStep(1) },
    { label: "Zoom Out", shortcut: "Ctrl+−", action: () => zoomStep(-1) },
    { label: "Fit on Screen", shortcut: "Ctrl+0", action: fit },
    { label: "Actual Pixels", shortcut: "Ctrl+1", action: actualSize },
    { sep: true },
    { label: "Rulers", shortcut: "Ctrl+R", checked: () => showRulers, action: toggleRulers },
    { label: "Grid", shortcut: "Ctrl+'", checked: () => showGrid, action: toggleGrid },
    {
      label: "Grid Size",
      submenu: [8, 16, 32, 64, 128].map((n) => ({
        label: `${n} px`,
        checked: () => gridSize === n,
        action: () => {
          gridSize = n;
          showGrid = true;
          saveViewPrefs();
          needsDraw = true;
        },
      })),
    },
    {
      label: "Pixel Grid",
      checked: () => showPixelGrid,
      action: () => {
        showPixelGrid = !showPixelGrid;
        saveViewPrefs();
        needsDraw = true;
      },
    },
    { sep: true },
    {
      label: "Snap to Guides",
      checked: () => snapToGuides,
      action: () => {
        snapToGuides = !snapToGuides;
        np.set_snap(snapToGuides);
        saveViewPrefs();
      },
    },
    { label: "Clear Guides", enabled: () => guides.h.length + guides.v.length > 0, action: clearGuides },
    { sep: true },
    {
      label: "Palette",
      checked: () => showPalette,
      action: () => {
        showPalette = !showPalette;
        saveViewPrefs();
        syncPalettePanel();
      },
    },
  ];
}

function toggleRulers() {
  showRulers = !showRulers;
  saveViewPrefs();
  needsDraw = true;
  if (showRulers) message("Drag out of a ruler to add a guide. Guides can be dragged with any tool; drag one off the canvas to remove it.");
}

function toggleGrid() {
  showGrid = !showGrid;
  saveViewPrefs();
  needsDraw = true;
}

/**
 * A "fake PNG" — a picture with the transparency checkerboard painted into
 * it — becomes a real one. The engine finds the board along the edges.
 */
function removeCheckerboard() {
  act(() => {
    if (np.remove_checkerboard()) {
      message("Checkerboard background made transparent. Any left inside enclosed areas can be taken out with the magic wand.");
    } else {
      message(np.edit_refusal() ? "This layer's pixels cannot be edited." : "No checkerboard found along the edges of this layer.");
    }
  });
}

function clearGuides() {
  guides = { h: [], v: [] };
  commitGuides("Clear Guides");
}

/** The engine keeps a copy of the guides to snap to. */
function syncGuides() {
  np.set_guides(Float64Array.from(guides.h), Float64Array.from(guides.v));
  needsDraw = true;
}

/** Hands the guides to the engine as an undo step under `label`. */
function commitGuides(label) {
  np.edit_guides(Float64Array.from(guides.h), Float64Array.from(guides.v), label);
  touch();
}

/**
 * Takes the guides back from the engine: undo and redo move them there. Not
 * while one is being dragged, when the page's copy is deliberately short
 * of it.
 */
function pullGuides() {
  if (guideDrag) return;
  const h = Array.from(np.guides_h());
  const v = Array.from(np.guides_v());
  const same = (a, b) => a.length === b.length && a.every((g, i) => g === b[i]);
  if (!same(h, guides.h) || !same(v, guides.v)) {
    guides = { h, v };
    needsDraw = true;
  }
}

/** The view furniture is remembered between visits. */
function saveViewPrefs() {
  try {
    const view = { rulers: showRulers, grid: showGrid, gridSize, pixelGrid: showPixelGrid, snap: snapToGuides, palette: showPalette };
    localStorage.setItem("npaint.view", JSON.stringify(view));
  } catch {
    // No storage: not remembered, nothing lost.
  }
}

function loadViewPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem("npaint.view") ?? "null");
    if (saved) {
      showRulers = Boolean(saved.rulers);
      showGrid = Boolean(saved.grid);
      showPixelGrid = saved.pixelGrid !== false;
      snapToGuides = saved.snap !== false;
      showPalette = saved.palette !== false;
      syncPalettePanel();
      if ([8, 16, 32, 64, 128].includes(saved.gridSize)) gridSize = saved.gridSize;
    }
    const limit = Number(localStorage.getItem("npaint.historyLimit"));
    if ([20, 40, 100, 200].includes(limit)) {
      np.set_history_limit(limit);
      $("history-limit").value = String(limit);
    }
  } catch {
    // The defaults stand.
  }
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

/**
 * The engine's own subject finder: no download, and never fails to answer.
 * With a `box`, only that part of the picture is searched.
 */
async function selectSubjectBuiltIn(why, box, mods) {
  working(why ?? "Looking for the subject…", null);
  await painted();
  const found = box ? np.select_subject_builtin_in_box(...box, mods.shift, mods.alt) : np.select_subject();
  touch();
  doneWorking();
  message(found ? "Selected the subject." : box ? "Could not find a subject in the box." : "Could not find a subject in this image.");
}

/**
 * Runs the model in a worker, so the page keeps drawing while it thinks.
 *
 * If the browser will not take a module worker, or the worker fails for any
 * reason, the same work happens here instead: the result is identical, it
 * just freezes the page while it runs. The pixels are copied rather than
 * handed over precisely so that fallback is still possible.
 */
function matteInBackground(model, rgba, width, height, onProgress) {
  const onThisThread = () => model.matte(rgba, width, height, subjectQuality, onProgress);
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
    worker.postMessage({ rgba, width, height, id: subjectQuality });
  });
}

/**
 * The model module, once it is deployed and (asked once) downloaded, with
 * whether it was already cached. Null means use the built-in finder.
 */
async function subjectModel() {
  let model;
  try {
    model = await import("./subject-model.js");
  } catch {
    // The module is not deployed alongside the page.
    return null;
  }
  const cached = await model.isCached(subjectQuality);
  if (!cached) {
    if (modelDeclined) return null;
    const ok = window.confirm(
      `Select Subject works best with a machine-learning model: about ${model.downloadMb(subjectQuality)} MB, ` +
        `downloaded once from this site and then kept in your browser for good. It runs on your ` +
        `machine — nothing is uploaded.\n\nDownload it now? Cancel to use the quick built-in ` +
        `version instead.`
    );
    if (!ok) {
      modelDeclined = true;
      return null;
    }
  }
  return { model, cached };
}

/**
 * Finds the subject with the model and selects it. With a `box` (`[x, y, w,
 * h]` in document pixels) only the pixels inside it go to the model, so a
 * small thing in a big picture gets the model's whole resolution, and
 * `mods` says how the result combines with the selection.
 */
async function selectSubjectWithModel(box, mods) {
  const got = await subjectModel();
  if (!got) {
    await selectSubjectBuiltIn(undefined, box, mods);
    return;
  }
  const { model, cached } = got;
  const thinking = model.isSlow(subjectQuality)
    ? "Finding the subject… (this one takes a few seconds)"
    : "Finding the subject…";
  const getting = cached ? "Loading the model…" : "Downloading the model…";
  working(cached ? thinking : getting, cached ? null : 0);
  await painted();
  try {
    let rgba, width, height;
    if (box) {
      rgba = np.frame_crop(...box);
      [, , width, height] = box;
    } else {
      rgba = np.frame_copy();
      width = np.width();
      height = np.height();
    }
    const started = performance.now();
    const out = await matteInBackground(model, rgba, width, height, (fraction) =>
      // Progress is the download; once it is in, the model is running.
      working(fraction >= 1 ? thinking : getting, fraction >= 1 ? null : fraction)
    );
    const found = box
      ? np.select_subject_in_box(...box, out.matte, out.width, out.height, mods.shift, mods.alt)
      : np.select_subject_from_matte(out.matte, out.width, out.height);
    touch();
    doneWorking();
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    message(
      found
        ? `Selected the subject (${seconds}s).`
        : box
          ? "The model did not find a subject in the box."
          : "The model did not find a subject in this image."
    );
  } catch (e) {
    doneWorking();
    // Anything at all — no network, no cache storage, a browser that will not
    // run it — still ends in a selection.
    await selectSubjectBuiltIn("The model could not run; looking for the subject…", box, mods);
    message(`The model could not run (${e.message ?? e}), so the built-in search was used.`);
  }
}

async function selectSubject() {
  await selectSubjectWithModel(null, null);
}

/** The modifiers held when the subject box was started: they pick the mode. */
let subjectMods = { shift: false, alt: false };

/** The subject tool's drag has ended: run the model over what it boxed. */
async function finishSubjectBox() {
  const box = np.subject_box();
  if (!box.length) return;
  if (box[2] < 4 || box[3] < 4) {
    np.clear_subject_box();
    needsDraw = true;
    message("Drag a box around the subject.");
    return;
  }
  await selectSubjectWithModel(box, subjectMods);
}

/** Every menu the bar shows. The command palette flattens the same list, so
 *  a new item is searchable without being named twice. */
function menuDefinitions() {
  return [
    {
      title: "File",
      items: [
        { label: "New…", shortcut: "Ctrl+N", action: showNewDialog },
        { label: "Open…", shortcut: "Ctrl+O", action: () => pickFile("open") },
        { label: "Open as Layer…", shortcut: "Ctrl+Shift+O", action: () => pickFile("layer") },
        { label: "Place as Smart Object…", action: () => pickFile("place") },
        { sep: true },
        { label: "Save…", shortcut: "Ctrl+S", action: saveDocument },
        { label: "Export Image…", shortcut: "Ctrl+Shift+S", action: showExportDialog },
      ],
    },
    { title: "Edit", items: editItems() },
    {
      title: "Image",
      items: [
        { label: "Adjustments", submenu: adjustmentItems() },
        { label: "Auto Levels", shortcut: "Ctrl+Shift+L", action: () => act(() => np.auto_levels(true)) },
        { label: "Auto Contrast", shortcut: "Ctrl+Alt+Shift+L", action: () => act(() => np.auto_levels(false)) },
        { label: "Remove Checkerboard Background", action: removeCheckerboard },
        { sep: true },
        { label: "Image Size…", shortcut: "Ctrl+Alt+I", action: showImageSizeDialog },
        { label: "Canvas Size…", shortcut: "Ctrl+Alt+C", action: showCanvasDialog },
        { label: "Crop to Selection", enabled: hasSelection, action: cropToSelection },
        { label: "Reveal All", enabled: hasHiddenContent, action: revealAll },
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
    { title: "Filter", items: filterItems() },
    { title: "Select", items: selectItems() },
    { title: "View", items: viewItems() },
  ];
}

function buildMenus() {
  createMenuBar($("menus"), menuDefinitions());
  commandPalette = createCommandPalette({
    dialog: $("dlg-command"),
    input: $("command-query"),
    list: $("command-list"),
    menus: menuDefinitions,
  });
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
    ...editItems().slice(3, 7),
    { sep: true },
    ...editItems().slice(8),
    { sep: true },
    {
      label: () => (selectedCount() > 1 ? "Duplicate Layers" : "Duplicate Layer"),
      shortcut: "Ctrl+J",
      action: () => act(() => np.duplicate_selected_layers()),
    },
    { label: "Layer via Copy", enabled: hasSelection, action: () => act(() => np.layer_via_copy()) },
    { label: "Adjustments", submenu: adjustmentItems() },
    { sep: true },
    { label: "Fit on Screen", shortcut: "Ctrl+0", action: fit },
    { label: "Actual Pixels", shortcut: "Ctrl+1", action: actualSize },
  ];
}

function beginTransform() {
  act(() => np.begin_transform());
}

// ---- Text -------------------------------------------------------------------------
//
// The engine has no fonts, so the page sets the type: it draws the text on
// a canvas in the chosen face and hands the pixels to the engine, which
// keeps them as a text layer (a smart object that remembers its text). While
// a layer is being typed into, a textarea sits over the canvas, put through
// the layer's placement and the zoom so its caret lands on the letters; its
// own text is invisible, and the canvas shows what the engine has.

/** The text layer being typed into, and the box over it. */
let textEdit = null;

/** The most a rendering may measure on a side, which is what browsers allow of a canvas. */
const MAX_TEXT_CANVAS = 8192;
const textCanvas = document.createElement("canvas");
const tctx = textCanvas.getContext("2d", { willReadFrequently: true });

function textFontCss() {
  return `${np.text_italic() ? "italic " : ""}${np.text_bold() ? "bold " : ""}${np.text_size()}px "${np.text_font()}"`;
}

/** The Character panel's settings, read once per rendering. */
function characterSettings() {
  const size = np.text_size();
  return {
    size,
    tracking: (np.text_param("tracking") / 1000) * size,
    leading: np.text_param("leading"),
    scaleX: np.text_param("scale_x"),
    scaleY: np.text_param("scale_y"),
    caps: np.text_param("caps") > 0.5,
    underline: np.text_param("underline") > 0.5,
    strike: np.text_param("strike") > 0.5,
    outline: np.text_param("outline"),
    outlineColor: np.text_outline_color(),
    shadow: np.text_param("shadow"),
  };
}

/** Whether the canvas spaces letters itself; older browsers get it a glyph at a time. */
const HAS_LETTER_SPACING = "letterSpacing" in CanvasRenderingContext2D.prototype;

/** Measures one line with tracking, on browsers with and without `letterSpacing`. */
function lineWidth(ctx, line, tracking) {
  if (!line) return 0;
  if (HAS_LETTER_SPACING) {
    ctx.letterSpacing = `${tracking}px`;
    // The canvas adds the spacing after every glyph, the last included.
    return ctx.measureText(line).width - tracking;
  }
  const glyphs = [...line];
  return glyphs.reduce((w, g) => w + ctx.measureText(g).width, 0) + tracking * (glyphs.length - 1);
}

/** Fills or strokes one line with tracking. */
function drawLine(ctx, line, x, y, tracking, stroke) {
  const put = (text, at) => (stroke ? ctx.strokeText(text, at, y) : ctx.fillText(text, at, y));
  if (HAS_LETTER_SPACING || !tracking) {
    if (HAS_LETTER_SPACING) ctx.letterSpacing = `${tracking}px`;
    put(line, x);
    return;
  }
  let at = x;
  for (const g of line) {
    put(g, at);
    at += ctx.measureText(g).width + tracking;
  }
}

/** How far across the block the anchored edge is: 0 left, ½ centre, 1 right. */
function textAnchor() {
  return { left: 0, center: 0.5, right: 1 }[np.text_align()] ?? 0;
}

/**
 * Lines, their widths, the line pitch and the font's ascent and descent for
 * `text` in the current style. The box and the rendering both come from
 * this, so they agree.
 */
function measureText(text) {
  const c = characterSettings();
  const size = c.size;
  tctx.font = textFontCss();
  const lines = text.split("\n").map((l) => (c.caps ? l.toUpperCase() : l));
  const widths = lines.map((l) => lineWidth(tctx, l, c.tracking));
  if (HAS_LETTER_SPACING) tctx.letterSpacing = "0px";
  const m = tctx.measureText("Hg");
  const asc = m.fontBoundingBoxAscent ?? size * 0.8;
  const desc = m.fontBoundingBoxDescent ?? size * 0.25;
  return { lines, widths, width: Math.ceil(Math.max(0, ...widths)), pitch: size * c.leading, asc, desc, size, c };
}

/**
 * Draws `text` in the current style and foreground colour, with padding
 * round the block for overhangs and antialiasing, and returns the pixels
 * with where the block begins in them.
 */
function rasterizeText(text) {
  const m = measureText(text);
  const c = m.c;
  // Room for overhangs and antialiasing, and for the outline and the shadow.
  const pad = Math.ceil(m.size * 0.5 + c.outline + c.shadow * 2);
  const w = Math.max(1, Math.min(MAX_TEXT_CANVAS, Math.ceil(m.width * c.scaleX) + 2 * pad));
  const h = Math.max(1, Math.min(MAX_TEXT_CANVAS, Math.ceil(m.lines.length * m.pitch * c.scaleY) + 2 * pad));
  textCanvas.width = w;
  textCanvas.height = h;
  tctx.save();
  tctx.translate(pad, pad);
  tctx.scale(c.scaleX, c.scaleY);
  tctx.font = textFontCss();
  tctx.textBaseline = "alphabetic";
  tctx.lineJoin = "round";
  const k = textAnchor();
  const thick = Math.max(1, m.size * 0.06);
  // Each line's baseline sits where a CSS line box of the same pitch puts
  // it: half the leading, then the ascent.
  const place = (i) => [(m.width - m.widths[i]) * k, i * m.pitch + (m.pitch - (m.asc + m.desc)) / 2 + m.asc];
  const pass = (stroke) => {
    m.lines.forEach((line, i) => {
      const [x, y] = place(i);
      drawLine(tctx, line, x, y, c.tracking, stroke);
      const rule = (ry) => (stroke ? tctx.strokeRect(x, ry, m.widths[i], thick) : tctx.fillRect(x, ry, m.widths[i], thick));
      if (c.underline) rule(y + m.size * 0.1);
      if (c.strike) rule(y - m.asc * 0.3);
    });
  };
  if (c.shadow > 0) {
    tctx.shadowColor = "rgba(0,0,0,0.5)";
    tctx.shadowOffsetX = c.shadow;
    tctx.shadowOffsetY = c.shadow;
    tctx.shadowBlur = c.shadow;
  }
  if (c.outline > 0) {
    // The outline goes under the fill, twice as wide, so half of it shows
    // outside the glyph; it carries the shadow, so the fill need not.
    tctx.strokeStyle = c.outlineColor;
    tctx.lineWidth = c.outline * 2;
    pass(true);
    tctx.shadowColor = "transparent";
  }
  tctx.fillStyle = np.color();
  pass(false);
  tctx.restore();
  const bytes = tctx.getImageData(0, 0, w, h).data;
  return { w, h, pad, bytes: new Uint8Array(bytes.buffer) };
}

// ---- The Character panel --------------------------------------------------------

/** What the panel calls each of the engine's settings, and how it is shown. */
const CHARACTER_ROWS = {
  tracking: { label: "Tracking", step: 10, title: "Space between letters, in thousandths of an em" },
  leading: { label: "Leading", step: 0.05, title: "Line pitch, as a multiple of the size (1.2 is the usual)" },
  scale_x: { label: "Horizontal", step: 0.05, title: "Stretch across, as a factor" },
  scale_y: { label: "Vertical", step: 0.05, title: "Stretch down, as a factor" },
  caps: { label: "Caps", flag: true },
  underline: { label: "Underline", flag: true },
  strike: { label: "Strike", flag: true },
  outline: { label: "Outline", step: 0.5, title: "An outline round every letter, in pixels, in the outline colour" },
  shadow: { label: "Shadow", step: 1, title: "A soft shadow, offset down and right by this many pixels" },
};

function bindCharacterPanel() {
  const grid = $("char-grid");
  const names = NPaint.text_param_names();
  const ranges = NPaint.text_param_ranges();
  const flags = document.createElement("div");
  flags.className = "char-flags";
  names.forEach((name, i) => {
    const row = CHARACTER_ROWS[name] ?? { label: name, step: 1 };
    const label = document.createElement("label");
    label.className = "char-row";
    label.title = row.title ?? "";
    const input = document.createElement("input");
    input.id = `char-${name}`;
    if (row.flag) {
      input.type = "checkbox";
      input.addEventListener("change", () => {
        setCharacter(name, input.checked ? 1 : 0);
        refocusText();
      });
      label.append(input, document.createTextNode(` ${row.label}`));
      flags.appendChild(label);
    } else {
      input.type = "number";
      input.min = ranges[2 * i];
      input.max = ranges[2 * i + 1];
      input.step = row.step;
      const apply = () => setCharacter(name, Number(input.value));
      input.addEventListener("change", apply);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          apply();
          refocusText() || input.blur();
        }
        if (e.key === "Escape") refocusText() || input.blur();
      });
      const span = document.createElement("span");
      span.textContent = row.label;
      label.append(span, input);
      grid.appendChild(label);
    }
  });
  grid.appendChild(flags);
  $("char-outline-color").addEventListener("click", () => openPicker("outline"));
  $("opt-character").addEventListener("click", () => {
    if ($("char-panel").hidden) openCharacterPanel();
    else closeCharacterPanel();
  });
  $("char-close").addEventListener("click", closeCharacterPanel);
}

function setCharacter(name, value) {
  act(() => np.set_text_param(name, value));
  syncCharacterPanel();
  previewText();
}

function openCharacterPanel() {
  $("char-panel").hidden = false;
  setPressed($("opt-character"), true);
  syncCharacterPanel();
}

function closeCharacterPanel() {
  if ($("char-panel").hidden) return;
  $("char-panel").hidden = true;
  setPressed($("opt-character"), false);
  if (pickerTarget === "outline") picker.close();
}

/** The panel shows the engine's settings — the layer's, while one is being edited. */
function syncCharacterPanel() {
  if ($("char-panel").hidden) return;
  for (const name of NPaint.text_param_names()) {
    const input = $(`char-${name}`);
    if (!input || document.activeElement === input) continue;
    const v = np.text_param(name);
    if (input.type === "checkbox") input.checked = v > 0.5;
    else input.value = Number.isInteger(v) ? v : Number(v.toFixed(2));
  }
  $("char-outline-color").style.setProperty("--swatch", np.text_outline_color());
}

/** A click with the text tool: edit the text layer there, or start one. */
function beginTextAt(x, y) {
  const hit = np.text_layer_at(x, y);
  act(() => {
    if (hit >= 0) np.begin_text_edit(hit);
    else np.begin_text_layer(x, y);
  });
  if (np.is_editing_text()) openTextBox(active());
}

/** Edits a text layer from the layers panel or the menu. */
function editTextLayer(index) {
  setTool("text");
  act(() => np.begin_text_edit(index));
  if (np.is_editing_text()) openTextBox(index);
}

function openTextBox(index) {
  const box = document.createElement("textarea");
  box.className = "text-edit";
  box.spellcheck = false;
  box.wrap = "off";
  box.setAttribute("aria-label", "Text");
  box.value = np.layer_text(index);
  box.addEventListener("input", previewText);
  box.addEventListener("keydown", (e) => {
    // The box's keys are its own: no tool shortcuts while typing.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      cancelText();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commitText();
    }
  });
  viewport.appendChild(box);
  textEdit = { index, box, color: np.color() };
  placeTextBox();
  box.focus();
  box.setSelectionRange(box.value.length, box.value.length);
  // The layer's own style is the options bar's now.
  syncOptions();
}

/** Sets the layer being typed into from the box, in the current style. */
function previewText() {
  if (!textEdit) return;
  const text = textEdit.box.value;
  const { w, h, pad, bytes } = rasterizeText(text);
  textEdit.color = np.color();
  act(() => np.preview_text(text, pad, pad, w, h, bytes));
  placeTextBox();
}

/**
 * Puts the box where the engine draws the text: the layer's placement
 * (source pixels to document pixels) and then the zoom, as one CSS matrix,
 * with the box laid out in source pixels inside it.
 */
function placeTextBox() {
  if (!textEdit) return;
  const { box, index } = textEdit;
  const m = np.layer_placement(index);
  if (m.length !== 6) return;
  const [ox, oy] = np.layer_text_origin(index);
  const zoom = np.zoom();
  const t = measureText(box.value);
  // Room for the caret when there is nothing typed yet, widened about the
  // anchored edge so the caret sits where the text will start.
  const width = Math.max(t.width, t.size);
  const left = ox - (width - t.width) * textAnchor();
  box.style.font = textFontCss();
  box.style.lineHeight = `${t.pitch}px`;
  box.style.textAlign = np.text_align();
  box.style.width = `${width + 2}px`;
  box.style.height = `${t.lines.length * t.pitch}px`;
  box.style.caretColor = np.color();
  box.style.letterSpacing = `${t.c.tracking}px`;
  box.style.textTransform = t.c.caps ? "uppercase" : "none";
  const [a, b, c, d, e, f] = m;
  const px = np.pan_x();
  const py = np.pan_y();
  // The box is laid out unscaled and stretched about the block's corner,
  // as the rendering was.
  const sx = t.c.scaleX;
  const sy = t.c.scaleY;
  box.style.transform = `matrix(${a * zoom}, ${b * zoom}, ${c * zoom}, ${d * zoom}, ${e * zoom + px}, ${f * zoom + py}) translate(${ox}px, ${oy}px) scale(${sx}, ${sy}) translate(${left - ox}px, 0)`;
}

/** Keeps the text. Nothing typed takes a new layer away again. */
/** Puts the keyboard back in the text box after a panel field took it. Returns whether there was one. */
function refocusText() {
  if (!textEdit) return false;
  textEdit.box.focus();
  return true;
}

function commitText() {
  if (!textEdit) return;
  act(() => np.commit_session());
  closeTextBox();
}

function cancelText() {
  if (!textEdit) return;
  act(() => np.cancel_session());
  closeTextBox();
}

function closeTextBox() {
  if (!textEdit) return;
  textEdit.box.remove();
  textEdit = null;
  syncOptions();
}

// ---- Dialogs --------------------------------------------------------------------

/**
 * The sizes New offers, so the common ones need no typing. Two more join
 * them when there is something to join with: whatever is on the clipboard,
 * and the document that is already open.
 */
const NEW_PRESETS = [
  { label: "720p", w: 1280, h: 720 },
  { label: "1080p", w: 1920, h: 1080 },
  { label: "1440p", w: 2560, h: 1440 },
  { label: "4K UHD", w: 3840, h: 2160 },
  { label: "Square", w: 1080, h: 1080 },
  { label: "Portrait", w: 1080, h: 1350 },
  { label: "A4 at 300 dpi", w: 2480, h: 3508 },
  { label: "US Letter at 300 dpi", w: 2550, h: 3300 },
];

/** The size of the image on the clipboard, if one is known to be there. */
let clipboardImageSize = null;

/** Says where the size in the dialog came from, or why the clipboard could
 *  not be read. Empty until there is something to say. */
function setNewNote(text) {
  $("new-note").textContent = text;
}

/** Fills the preset dropdown, clipboard entry and all, and picks `chosen`. */
function fillNewPresets(chosen) {
  const select = $("new-preset");
  const options = [];
  if (clipboardImageSize) options.push({ key: "clipboard", label: "Clipboard", w: clipboardImageSize[0], h: clipboardImageSize[1] });
  options.push({ key: "document", label: "This document", w: np.width(), h: np.height() });
  for (const p of NEW_PRESETS) options.push({ key: `${p.w}x${p.h}`, ...p });
  select.replaceChildren();
  for (const o of options) {
    const option = document.createElement("option");
    option.value = `${o.w}x${o.h}`;
    option.dataset.key = o.key;
    option.textContent = `${o.label} — ${o.w} × ${o.h}`;
    select.appendChild(option);
  }
  const custom = document.createElement("option");
  custom.value = "";
  custom.dataset.key = "custom";
  custom.textContent = "Custom";
  select.appendChild(custom);
  const pick = options.find((o) => o.key === chosen) || options[0];
  select.value = `${pick.w}x${pick.h}`;
  $("new-width").value = pick.w;
  $("new-height").value = pick.h;
}

/** Keeps the dropdown honest when the width or height is typed over. */
function syncNewPreset() {
  const size = `${$("new-width").value}x${$("new-height").value}`;
  const select = $("new-preset");
  select.value = [...select.options].some((o) => o.value === size) ? size : "";
}

/** Whether the preset in the dialog is still one the page chose, rather
 *  than something the person picked or typed. */
function newPresetUntouched() {
  const key = $("new-preset").selectedOptions[0]?.dataset.key;
  return key === "clipboard" || key === "document";
}

/** The hint for the route that always works, whatever the browser thinks of
 *  a page reading the clipboard by itself. */
const PASTE_HINT = "Press Ctrl+V here to take the size from an image on the clipboard.";

/**
 * Takes the size from an image the person pasted into the dialog. A paste
 * carries the clipboard with it, so this needs no permission and works in
 * every browser — it is the way out when `readClipboardSize` is refused.
 */
async function takeSizeFromPaste(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (e) {
    setNewNote(`Could not read that image: ${e.message || e}`);
    return;
  }
  clipboardImageSize = [bitmap.width, bitmap.height];
  bitmap.close();
  if (!$("dlg-new").open) return;
  fillNewPresets("clipboard");
  setNewNote(`Pasted: a ${clipboardImageSize[0]} × ${clipboardImageSize[1]} px image.`);
}

/**
 * Looks in the system clipboard for an image, so New can offer its size.
 * Every browser guards this and most refuse outright — Firefox does not
 * allow it from a page at all, and Chrome stops allowing it once the
 * permission has been refused — so the attempt is quiet, and a refusal says
 * nothing: the paste route above is what the dialog tells people to use.
 */
async function readClipboardSize() {
  if (!navigator.clipboard?.read) return;
  let items;
  try {
    items = await navigator.clipboard.read();
  } catch {
    return;
  }
  let found = null;
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith("image/"));
    if (!type) continue;
    const bitmap = await createImageBitmap(await item.getType(type));
    found = [bitmap.width, bitmap.height];
    bitmap.close();
    break;
  }
  if (!found) return;
  clipboardImageSize = found;
  // The answer arrives after the dialog is up: step in only while it is
  // still showing a size the page chose, never over a typed one.
  if (!$("dlg-new").open || !newPresetUntouched()) return;
  fillNewPresets("clipboard");
  setNewNote(`The clipboard holds a ${found[0]} × ${found[1]} px image.`);
}

function bindDialogs() {
  const dlg = $("dlg-new");
  // A paste into the dialog sets the size instead of pasting into the
  // document; the window's own paste handler already leaves dialogs alone.
  dlg.addEventListener("paste", (e) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const image = items.find((i) => i.kind === "file" && i.type.startsWith("image/"));
    e.preventDefault();
    e.stopPropagation();
    if (!image) {
      setNewNote("There was no image in that paste.");
      return;
    }
    takeSizeFromPaste(image.getAsFile());
  });
  $("new-preset").addEventListener("change", () => {
    const [w, h] = $("new-preset").value.split("x");
    if (!w) return;
    $("new-width").value = w;
    $("new-height").value = h;
  });
  for (const id of ["new-width", "new-height"]) $(id).addEventListener("input", syncNewPreset);
  dlg.addEventListener("close", () => {
    if (dlg.returnValue !== "ok") return;
    const w = clampInt($("new-width").value, 1, 8192, 1024);
    const h = clampInt($("new-height").value, 1, 8192, 768);
    np.new_document(w, h, $("new-bg").value);
    docName = "npaint";
    clearGuides();
    fit();
    touch();
  });
}

/** Warns before the tab closes on unsaved work. */
function bindUnload() {
  window.addEventListener("beforeunload", (e) => {
    if (!np || !np.is_modified()) return;
    e.preventDefault();
    // Older browsers want a value; newer ones ignore it and show their own text.
    e.returnValue = "";
  });
}

function showNewDialog() {
  if (np.is_modified() && !window.confirm("Start a new document and lose the unsaved changes to this one?")) return;
  // What is on the clipboard is the likeliest size to want; the engine's own
  // clipboard answers at once, and the system one is asked in the background.
  const [cw, ch] = np.clipboard_size();
  if (cw) clipboardImageSize = [cw, ch];
  fillNewPresets(clipboardImageSize ? "clipboard" : "document");
  if (cw) setNewNote(`Copied in NPaint: ${cw} × ${ch} px.`);
  else if (clipboardImageSize) setNewNote(`Last pasted: ${clipboardImageSize[0]} × ${clipboardImageSize[1]} px. ${PASTE_HINT}`);
  else setNewNote(PASTE_HINT);
  $("dlg-new").showModal();
  readClipboardSize();
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

/** Whether a file is one of NPaint's own, by name or by its first bytes. */
async function isNPaintFile(file) {
  if (/\.npaint$/i.test(file.name)) return true;
  const head = new Uint8Array(await file.slice(0, 6).arrayBuffer());
  return (head[0] === 0x1f && head[1] === 0x8b) || String.fromCharCode(...head) === "NPAINT";
}

/** Whether a file is a Photoshop document, by name or by its first bytes. */
async function isPsdFile(file) {
  if (/\.psd$/i.test(file.name)) return true;
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return String.fromCharCode(...head) === "8BPS";
}

/** The pixels of an image file, decoded, at the picture's own size. */
async function decodeImage(file) {
  const bitmap = await createImageBitmap(file);
  const scratch = document.createElement("canvas");
  const sctx = scratch.getContext("2d");
  scratch.width = bitmap.width;
  scratch.height = bitmap.height;
  sctx.drawImage(bitmap, 0, 0);
  const data = sctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return { width: data.width, height: data.height, bytes: new Uint8Array(data.data.buffer) };
}

/**
 * Opens a file: an NPaint document replaces the document whatever the mode;
 * an image goes in as a new document the size of the picture, with the
 * picture as a smart object (`open`), as a layer at its own size (`layer`),
 * as a smart object fitted to the document (`place`), or as the new contents
 * of the active smart object (`replace`). The engine works out the
 * placement, so a placed picture keeps every pixel it came with however
 * small it is shown.
 */
async function loadFile(file, mode) {
  const name = file.name.replace(/\.[^.]+$/, "") || "Image";
  if (await isNPaintFile(file)) {
    if (np.is_modified() && !window.confirm("Open this file and lose the unsaved changes to the current document?")) return;
    np.open_document(await inflate(new Uint8Array(await file.arrayBuffer())));
    docName = name;
    // The file carries its guides; the engine has them now.
    guides = { h: Array.from(np.guides_h()), v: Array.from(np.guides_v()) };
    syncGuides();
    fit();
    touch();
    message(`Opened ${file.name}.`);
    return;
  }
  // Photoshop's own file. A browser cannot decode one, so the engine reads
  // it — with all its layers, where it can. It always replaces the document:
  // a layered file is not something to drop into another one as a layer.
  if (await isPsdFile(file)) {
    if (np.is_modified() && !window.confirm("Open this file and lose the unsaved changes to the current document?")) return;
    let note;
    try {
      note = np.open_psd(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      message(`${file.name} could not be opened: ${e}`);
      return;
    }
    docName = name;
    clearGuides();
    fit();
    touch();
    const layers = np.layer_count();
    message(`Opened ${file.name} — ${layers} ${layers === 1 ? "layer" : "layers"}.${note ? " " + note : ""}`);
    return;
  }

  const { width, height, bytes } = await decodeImage(file);
  if (mode === "open") {
    if (np.is_modified() && !window.confirm("Open this image and lose the unsaved changes to the current document?")) return;
    np.open_image(name, width, height, bytes);
    docName = name;
    clearGuides();
    fit();
    message(`Opened ${file.name} as a smart object: transform it freely, or rasterize it to paint on it.`);
  } else if (mode === "layer") {
    act(() => np.add_layer_centred(name, width, height, bytes));
    message(`Added ${file.name} as a layer.`);
  } else if (mode === "replace") {
    act(() => np.replace_smart_contents(active(), width, height, bytes));
  } else {
    act(() => np.place_smart_object(name, width, height, bytes));
    message(`Placed ${file.name} as a smart object: transform it freely, it keeps its pixels.`);
  }
  touch();
}

// ---- Saving --------------------------------------------------------------------
//
// NPaint's own file keeps every layer. The engine writes it as a plain
// stream and the page gzips it, since the browser has a compressor and the
// engine does not; a file that arrives uncompressed still opens.

async function deflate(bytes) {
  if (typeof CompressionStream !== "function") return new Blob([bytes]);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

async function inflate(bytes) {
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!gzipped) return bytes;
  if (typeof DecompressionStream !== "function") throw new Error("this browser cannot read compressed files");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function saveDocument() {
  const name = window.prompt("Save as", `${docName}.npaint`);
  if (name === null) return;
  const base = name.replace(/\.npaint$/i, "").trim() || docName;
  docName = base;
  const blob = await deflate(np.save_document());
  download(blob, `${base}.npaint`);
  touch();
  // The work is on the user's disk now, so the safety net is no longer
  // holding anything they cannot get back.
  autosavedState = np.document_state();
  clearRecovery();
  message(`Saved ${base}.npaint (${Math.round(blob.size / 1024)} kB). Open it again with File > Open.`);
}

// ---- Autosave and recovery -----------------------------------------------------
//
// A copy of the document goes into the browser's own store every so often, so
// that a crash, a closed tab or a reload is an inconvenience rather than a
// lost afternoon. See `recovery.js` for the store itself.
//
// Three things decide when it runs.
//
// *Only when there is something to keep*: the document has to be modified,
// and to have changed since the last copy was taken. `np.document_state()`
// is the engine's own answer to the second — a number that changes whenever
// the document does and comes back on an undo — which is worth more than
// anything the page could count for itself, since most edits never pass
// through a function here at all.
//
// *Never in the middle of anything.* `snapshot_document` settles an open
// session and an unfinished gesture before it writes, which mid-stroke or
// mid-dialog would be the autosave throwing the user's work away to save it.
// So a tick that lands during either does nothing and waits for the next one.
//
// *Never taking more than a sliver of the time.* A copy is the whole
// document, and on a big one that is hundreds of megabytes through a gzip.
// Rather than pick an interval that is wrong for one document or the other,
// each round measures itself and asks for the next one twenty times further
// off, so the cost stays near five per cent of the clock whatever is open.

/** The document state the last copy was taken at; see `document_state`. */
let autosavedState = null;
/** The soonest and latest the next copy may be taken. */
const AUTOSAVE_MIN_MS = 15000;
const AUTOSAVE_MAX_MS = 300000;
/** How much of the clock a copy may cost: one part in twenty. */
const AUTOSAVE_DUTY = 20;
/** Set once the store has refused us, so the page stops asking. */
let autosaveOff = false;

function startRecovery() {
  if (!recoverySupported()) return;
  offerRecovery().finally(() => scheduleAutosave(AUTOSAVE_MIN_MS));
}

/** Offers back whatever the last session left behind, if anything. */
async function offerRecovery() {
  const found = await readRecovery();
  if (!found) return;
  const when = new Date(found.savedAt).toLocaleString();
  const what = found.name && found.name !== UNTITLED ? `"${found.name}"` : "an untitled document";
  const keep = window.confirm(
    `NPaint has unsaved work from a previous session — ${what}, kept at ${when}.\n\n` +
      `OK recovers it. Cancel throws it away for good.`,
  );
  if (!keep) {
    await clearRecovery();
    return;
  }
  try {
    np.open_document(await inflate(new Uint8Array(found.bytes)));
    // Opening a file counts as a clean start, but this is not one: nothing
    // here has ever reached the user's disk, and the close prompt has to go
    // on saying so. The copy in the store stays until it is saved for real.
    np.mark_unsaved();
    docName = found.name;
    guides = { h: Array.from(np.guides_h()), v: Array.from(np.guides_v()) };
    syncGuides();
    fit();
    touch();
    autosavedState = np.document_state();
    message(`Recovered ${what}. Save it with File > Save to keep it for good.`);
  } catch (e) {
    message(`That recovered document could not be opened: ${e}`);
    await clearRecovery();
  }
}

function scheduleAutosave(delay) {
  if (autosaveOff) return;
  setTimeout(autosaveTick, Math.min(AUTOSAVE_MAX_MS, Math.max(AUTOSAVE_MIN_MS, delay)));
}

async function autosaveTick() {
  // Nothing worth keeping, or the middle of something: come back later.
  const state = np.document_state();
  if (!np.is_modified() || state === autosavedState || np.has_session() || np.is_gesturing()) {
    scheduleAutosave(AUTOSAVE_MIN_MS);
    return;
  }
  const began = performance.now();
  let ok = false;
  try {
    const blob = await deflate(np.snapshot_document());
    ok = await writeRecovery(new Uint8Array(await blob.arrayBuffer()), docName);
  } catch {
    ok = false;
  }
  const cost = performance.now() - began;
  if (ok) {
    autosavedState = state;
    scheduleAutosave(cost * AUTOSAVE_DUTY);
    return;
  }
  // A store that will not take it is not going to take it next time either
  // — no quota, no permission — so say so once and stop.
  autosaveOff = true;
  message("Autosave is not available in this browser, so save your work with File > Save.");
}

// ---- Drag and drop -------------------------------------------------------------------

function bindDrop() {
  let depth = 0;
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    depth += 1;
    $("drop-hint").hidden = false;
  });
  window.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) $("drop-hint").hidden = true;
  });
  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("drop", (e) => {
    depth = 0;
    $("drop-hint").hidden = true;
    if (!hasFiles(e)) return;
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    const mode = e.altKey ? "place" : e.shiftKey ? "layer" : "open";
    loadFile(file, mode).catch((err) => message(`Could not open ${file.name}: ${err.message || err}`));
  });
}

const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

// ---- Clipboard ---------------------------------------------------------------------
//
// Copy keeps the pixels in the engine, where a paste can put them back in
// the same place, and also hands a PNG to the system clipboard so they can
// go to another program. Paste takes whichever is the better source: the
// engine's own copy when what the system holds is the same picture, and
// otherwise whatever image the system clipboard has.

function bindClipboard() {
  window.addEventListener("paste", (e) => {
    if (typingInField(e) || document.querySelector("dialog[open]")) return;
    const items = Array.from(e.clipboardData?.items ?? []);
    const image = items.find((i) => i.kind === "file" && i.type.startsWith("image/"));
    if (!image && !np.has_clipboard()) return;
    e.preventDefault();
    pasteImage(image ? image.getAsFile() : null);
  });
}

async function pasteImage(file) {
  if (file) {
    let decoded;
    try {
      decoded = await decodeImage(file);
    } catch (err) {
      message(`Could not paste that image: ${err.message || err}`);
      return;
    }
    const [cw, ch] = np.clipboard_size();
    const ours = np.has_clipboard() && cw === decoded.width && ch === decoded.height;
    act(() => {
      if (ours) np.paste();
      else np.paste_external("Pasted", decoded.width, decoded.height, decoded.bytes);
    });
    return;
  }
  act(() => {
    if (np.paste() === undefined) message("Nothing to paste.");
  });
}

/** Edit > Paste: asks the system clipboard, which needs permission; the
 *  engine's own clipboard is the fallback. Ctrl+V goes through the paste
 *  event instead and needs no permission. */
async function pasteFromMenu() {
  let file = null;
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) {
        file = await item.getType(type);
        break;
      }
    }
  } catch {
    // Not allowed, or not supported: the engine's clipboard will do.
  }
  await pasteImage(file);
}

function copyToClipboard(what) {
  const done = what === "cut" ? np.cut_selection() : np.copy_selection(what === "merged");
  touch();
  if (!done) {
    message("Nothing to copy: select something on a layer with pixels.");
    return;
  }
  const [w, h] = np.clipboard_size();
  message(`${what === "cut" ? "Cut" : "Copied"} ${w} × ${h} px.`);
  writeSystemClipboard().catch(() => {
    // The engine's clipboard still has it; only other programs miss out.
  });
}

async function writeSystemClipboard() {
  if (!navigator.clipboard || typeof ClipboardItem !== "function") return;
  const [w, h] = np.clipboard_size();
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(np.clipboard_rgba().buffer), w, h), 0, 0);
  const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
  if (blob) await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
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

/** Whether any layer reaches outside the canvas — a smart object placed or
 *  transformed past the edge, whose source still has those pixels. */
function hasHiddenContent() {
  const [w, h] = np.content_size();
  return w > np.width() || h > np.height();
}

/** Image > Reveal All: grows the canvas until nothing is hanging outside. */
function revealAll() {
  act(() => {
    if (np.reveal_all()) {
      fit();
      message(`Canvas ${np.width()} × ${np.height()} px: everything is inside it now.`);
    } else {
      message("Nothing is hanging outside the canvas.");
    }
  });
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

// ---- Image size ---------------------------------------------------------------------
//
// Scales the picture, unlike Canvas Size, which only adds or trims space.

function showImageSizeDialog() {
  $("image-width").value = np.width();
  $("image-height").value = np.height();
  $("image-percent").value = 100;
  syncImageSizeNote();
  $("dlg-image-size").showModal();
}

function syncImageSizeNote() {
  const w = Number($("image-width").value);
  const h = Number($("image-height").value);
  const note = $("image-note");
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
    note.textContent = "Give a width and a height of at least one pixel.";
    return;
  }
  if (w * h > np.max_pixels() || w > np.max_side() || h > np.max_side()) {
    note.textContent = `Too big: at most ${np.max_side()} px a side and ${Math.round(np.max_pixels() / 1e6)} megapixels.`;
    return;
  }
  const bigger = w > np.width() || h > np.height();
  note.textContent = bigger
    ? "Enlarging resamples the pixels; the picture will be softer than the original."
    : "Every layer is scaled to the new size; smart objects keep their originals.";
}

function bindImageSizeDialog() {
  const locked = () => $("image-lock").checked;
  const ratio = () => np.width() / np.height();
  const setPercent = () => ($("image-percent").value = ((Number($("image-width").value) / np.width()) * 100).toFixed(1));
  $("image-width").addEventListener("input", () => {
    if (locked()) $("image-height").value = Math.max(1, Math.round(Number($("image-width").value) / ratio()));
    setPercent();
    syncImageSizeNote();
  });
  $("image-height").addEventListener("input", () => {
    if (locked()) $("image-width").value = Math.max(1, Math.round(Number($("image-height").value) * ratio()));
    setPercent();
    syncImageSizeNote();
  });
  $("image-percent").addEventListener("input", () => {
    const k = Number($("image-percent").value) / 100;
    if (!(k > 0)) return;
    $("image-width").value = Math.max(1, Math.round(np.width() * k));
    $("image-height").value = Math.max(1, Math.round(np.height() * k));
    syncImageSizeNote();
  });
  $("image-cancel").addEventListener("click", () => $("dlg-image-size").close());
  $("image-size-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const w = Number($("image-width").value);
    const h = Number($("image-height").value);
    act(() => {
      if (np.resize_image(w, h)) {
        message(`Image ${w} × ${h} px.`);
        $("dlg-image-size").close();
        fit();
      } else {
        syncImageSizeNote();
      }
    });
  });
}

/** Opens the export dialog; the actual writing happens on submit. */
function showExportDialog() {
  const dialog = $("dlg-export");
  $("export-name").value = docName;
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
      const filename = `${name || "npaint"}.${EXTENSION[format] ?? "png"}`;
      download(blob, filename);
      message(`Exported ${filename} (${Math.round(blob.size / 1024)} kB).`);
    },
    format,
    quality
  );
}

// ---- Layers panel ---------------------------------------------------------------

function bindLayers() {
  $("layer-add").addEventListener("click", () => act(() => np.add_layer()));
  $("layer-dup").addEventListener("click", () => act(() => np.duplicate_selected_layers()));
  $("layer-delete").addEventListener("click", () => act(() => np.remove_selected_layers()));
  $("layer-merge").addEventListener("click", () => act(() => np.merge_down(active())));
  // Photoshop's add-mask button: the selection becomes the mask, or the
  // mask reveals everything when nothing is selected.
  $("layer-mask").addEventListener("click", () => act(() => np.add_layer_mask(active(), false)));
  $("layer-adjust").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showContextMenu(r.left, r.top - 4, adjustmentLayerItems());
  });
  $("layer-group").addEventListener("click", () => act(() => np.group_selected_layers()));
  // "Up" in the panel is towards the top of the stack, which is a higher
  // index. A layer steps over a group rather than into it, and out of the
  // group it is in when there is no sibling left that way.
  $("layer-up").addEventListener("click", () => act(() => np.reorder_layer(active(), true)));
  $("layer-down").addEventListener("click", () => act(() => np.reorder_layer(active(), false)));

  const opacity = $("layer-opacity");
  opacity.addEventListener("input", () => {
    np.set_layer_opacity(active(), Number(opacity.value) / 100);
    $("layer-opacity-out").value = `${opacity.value}%`;
  });

  // A group may also be Pass Through, which means nothing on any other
  // kind of layer; the option is built once and hidden when it does not
  // apply, rather than the list being rebuilt every render.
  const blend = $("layer-blend");
  const names = NPaint.group_blend_mode_names();
  const labels = NPaint.group_blend_mode_labels();
  names.forEach((name, k) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = labels[k];
    if (name === "pass-through") option.dataset.groupOnly = "1";
    blend.appendChild(option);
  });
  blend.addEventListener("change", () => act(() => np.set_layer_blend(active(), blend.value)));
  $("layer-lock").addEventListener("click", () => act(() => np.set_layer_locked(active(), !np.layer_locked(active()))));
  $("layer-lock-alpha").addEventListener("click", () =>
    act(() => np.set_layer_lock_alpha(active(), !np.layer_lock_alpha(active())))
  );

  $("layer-list").addEventListener("contextmenu", (e) => {
    const row = e.target.closest(".layer");
    if (!row) return;
    e.preventDefault();
    const index = Number(row.dataset.index);
    // Right-clicking inside a selection acts on the whole of it; on a row
    // outside it, that row becomes the selection first.
    if (!np.layer_selected(index)) act(() => np.set_active_layer(index));
    showContextMenu(e.clientX, e.clientY, layerItems(index));
  });

  // Clicking the empty space under the rows drops back to a single
  // selected layer. One layer is always active — the tools have to have
  // something to paint on — so that is as far as unselecting goes.
  $("layer-list").addEventListener("click", (e) => {
    if (e.target.closest(".layer")) return;
    act(() => np.clear_layer_selection());
  });

  bindLayerDragging();
}

// ---- Dragging a layer ----------------------------------------------------------
//
// A row is dropped in one of three places: above another row, below it, or —
// over the middle of a group's row — inside it. Which one is decided from
// where in the row the pointer is, so the whole gesture is one drag with a
// line (or a lit-up group) showing where the layers would land.
//
// The panel draws the stack upside down: "above" in the panel is a *higher*
// index, and the top of a group's contents is the row just under its own.
// The engine is told the row and the place, and works the indices out.
//
// The target is found by measuring against the rows rather than by asking
// which element the pointer is over. There is no gap between rows that way,
// and the space under the last row means "below the bottom layer" rather
// than nothing at all — dragging into it used to leave a line up that
// nothing would honour.

/** How much of a group's row, top and bottom, still means "beside it"
 *  rather than "into it". The middle is the drop zone. */
const DROP_EDGE = 0.3;

/** The row being dragged, as a layer index, or null. */
let dragging = null;

/** Which row a pointer at `y` is over, and how far down it: clamped to the
 *  ends, so every position in the panel resolves to somewhere. */
function rowAt(y) {
  const rows = [...$("layer-list").querySelectorAll(".layer")];
  if (!rows.length) return null;
  for (const row of rows) {
    const box = row.getBoundingClientRect();
    if (y < box.bottom) {
      return { row, t: Math.max(0, (y - box.top) / (box.height || 1)) };
    }
  }
  // Past the last row: below the bottom of the stack.
  return { row: rows[rows.length - 1], t: 1 };
}

/** Where the drag would land: the row's index and which side of it. */
function dropAt(y) {
  const hit = rowAt(y);
  if (!hit) return null;
  const index = Number(hit.row.dataset.index);
  // Only a group has an inside.
  const inside = layerKind(index) === "group" && hit.t > DROP_EDGE && hit.t < 1 - DROP_EDGE;
  return { row: hit.row, index, where: inside ? "inside" : hit.t < 0.5 ? "above" : "below" };
}

function clearDropMarks() {
  $("layer-list")
    .querySelectorAll(".drop-above, .drop-below, .drop-inside")
    .forEach((el) => el.classList.remove("drop-above", "drop-below", "drop-inside"));
}

function bindLayerDragging() {
  const list = $("layer-list");

  list.addEventListener("dragstart", (e) => {
    const row = e.target.closest(".layer");
    if (!row) return;
    dragging = Number(row.dataset.index);
    row.classList.add("dragging");
    // A drag that starts on a row the panel has picked out carries the
    // whole selection; the engine decides that, so both the line below and
    // the drop itself ask it rather than working it out twice.
    if (np.layer_selected(dragging)) {
      list.querySelectorAll(".layer").forEach((r) => {
        if (np.layer_selected(Number(r.dataset.index))) r.classList.add("dragging");
      });
    }
    e.dataTransfer.effectAllowed = "move";
    // Firefox starts no drag at all without something on the transfer.
    e.dataTransfer.setData("text/plain", String(dragging));
  });

  list.addEventListener("dragover", (e) => {
    if (dragging === null) return;
    clearDropMarks();
    const drop = dropAt(e.clientY);
    // No line where letting go would do nothing — dropping layers back
    // where they already are, or a group onto its own contents. The engine
    // answers for the whole drag, selection and all.
    if (!drop || !np.move_would_change(dragging, drop.index, drop.where)) {
      e.dataTransfer.dropEffect = "none";
      return;
    }
    // Only a `dragover` that prevents the default lets a `drop` follow.
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    drop.row.classList.add(`drop-${drop.where}`);
  });

  list.addEventListener("dragleave", (e) => {
    if (!list.contains(e.relatedTarget)) clearDropMarks();
  });

  list.addEventListener("drop", (e) => {
    if (dragging === null) return;
    const drop = dropAt(e.clientY);
    if (!drop) return;
    e.preventDefault();
    const from = dragging;
    clearDropMarks();
    act(() => np.move_layer_to(from, drop.index, drop.where));
  });

  // However the drag ended — dropped, cancelled with Esc, let go outside
  // the panel — the marks go and the rows stop looking dragged.
  list.addEventListener("dragend", () => {
    dragging = null;
    clearDropMarks();
    list.querySelectorAll(".dragging").forEach((el) => el.classList.remove("dragging"));
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
  text: { glyph: "T", title: "Text layer: double-click to edit the text" },
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

/** Whether a layer is folded away inside a collapsed group above it. */
function insideCollapsed(index) {
  for (let at = np.layer_parent(index); at >= 0; at = np.layer_parent(at)) {
    if (np.layer_collapsed(at)) return true;
  }
  return false;
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
    // A collapsed group's contents are still in the stack; the panel simply
    // does not draw their rows.
    if (insideCollapsed(i)) continue;
    const li = document.createElement("li");
    const visible = np.layer_visible(i);
    const kind = layerKind(i);
    const group = kind === "group";
    const masked = hasMask(i);
    const onMask = masked && np.layer_editing_mask(i);
    const picked = np.layer_selected(i);
    li.className =
      "layer" +
      (picked && i === act_ ? " active" : "") +
      (picked ? " selected" : "") +
      (visible ? "" : " hidden-layer") +
      (group ? " group" : "") +
      (visible && np.layer_hidden_by_group(i) ? " group-hidden" : "");
    li.dataset.index = i;
    li.style.setProperty("--depth", np.layer_depth(i));
    li.draggable = true;

    // The disclosure triangle. Every row has the cell so the thumbnails
    // line up; only a group's is visible.
    const twist = document.createElement("button");
    twist.className = "twist";
    if (group) {
      const shut = np.layer_collapsed(i);
      twist.textContent = shut ? "▶" : "▼";
      twist.title = shut ? "Show what is in this group" : "Fold this group away";
      twist.addEventListener("click", (e) => {
        e.stopPropagation();
        act(() => np.set_layer_collapsed(i, !shut));
      });
    }

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
    pixels.appendChild(
      group ? folderThumbnail() : kind === "adjustment" ? adjustmentThumbnail() : thumbnailCanvas(np.layer_thumbnail(i, tw, th), tw, th, "")
    );
    if (KIND_BADGE[kind]) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = KIND_BADGE[kind].glyph;
      pixels.appendChild(badge);
      pixels.title = KIND_BADGE[kind].title;
    } else if (group) {
      pixels.title = "A group: what it draws is the layers inside it";
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

    // The gesture the badge's tooltip promises: double-clicking an
    // adjustment layer's mark opens its settings, as the name does.
    if (kind === "adjustment") {
      pixels.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        withActive(i, () => editAdjustmentLayer(i));
      });
    } else if (kind === "text") {
      pixels.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        editTextLayer(i);
      });
    }

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
    if (np.layer_locked(i) || np.layer_lock_alpha(i)) {
      const lock = document.createElement("span");
      lock.className = "layer-lock-mark";
      lock.textContent = np.layer_locked(i) ? "🔒" : "▦";
      lock.title = np.layer_locked(i) ? "Locked" : "Transparent pixels locked";
      name.appendChild(lock);
    }
    name.title = "Double-click to rename (F2)";
    name.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      // The name renames whatever the layer is — a group included. What
      // opens an adjustment's settings or a text layer's text is a
      // double-click on its thumbnail, which is what its badge promises.
      beginRename(name, i);
    });

    li.append(twist, eye, thumbs, name);
    // Click picks one layer; Shift takes the run from the active one to
    // here, and Ctrl (Cmd) adds or removes this one — as in every layered
    // editor. The active layer is the anchor either way, and stays put.
    li.addEventListener("click", (e) => {
      act(() => {
        if (e.shiftKey) np.select_layer_range(i);
        else if (e.ctrlKey || e.metaKey) np.toggle_layer_selected(i);
        else np.set_active_layer(i);
      });
    });
    list.appendChild(li);
  }

  const opacity = Math.round(np.layer_opacity(act_) * 100);
  $("layer-opacity").value = opacity;
  $("layer-opacity-out").value = `${opacity}%`;
  const blend = $("layer-blend");
  blend.querySelectorAll("option[data-group-only]").forEach((o) => {
    o.hidden = layerKind(act_) !== "group";
  });
  blend.value = np.layer_blend(act_);
  $("layer-lock").classList.toggle("on", np.layer_locked(act_));
  $("layer-lock").setAttribute("aria-pressed", String(np.layer_locked(act_)));
  $("layer-lock-alpha").classList.toggle("on", np.layer_lock_alpha(act_));
  $("layer-lock-alpha").setAttribute("aria-pressed", String(np.layer_lock_alpha(act_)));
  $("layer-lock-alpha").disabled = layerKind(act_) !== "pixels";
  // Clicking past the rows picks out nothing, and then the operations
  // that act on a selection have no subject.
  const picked = selectedCount();
  $("layer-delete").disabled = count <= 1 || picked === 0;
  $("layer-dup").disabled = picked === 0;
  $("layer-group").disabled = picked === 0;
  $("layer-merge").disabled = !canMergeDown(act_);
  $("layer-mask").disabled = hasMask(act_);
  $("layer-up").disabled = !np.can_reorder_layer(act_, true);
  $("layer-down").disabled = !np.can_reorder_layer(act_, false);
}

/** A group's thumbnail: a folder, since what it draws is the rows below it. */
function folderThumbnail() {
  const folder = document.createElement("span");
  folder.className = "folder";
  folder.textContent = "🗀";
  return folder;
}

/** Whether Merge Down would do anything: a group merges into itself, and
 *  anything else needs a pixel layer directly below it at the same level. */
function canMergeDown(index) {
  if (layerKind(index) === "group") return true;
  const below = np.sibling_below(index);
  return below >= 0 && layerKind(below) === "pixels";
}

// ---- History panel --------------------------------------------------------------
//
// Every step the engine remembers, with the ones undone greyed below the
// current one; click a row to go there.

function bindHistory() {
  $("history-limit").addEventListener("change", (e) => {
    const limit = Number(e.target.value);
    np.set_history_limit(limit);
    try {
      localStorage.setItem("npaint.historyLimit", String(limit));
    } catch {
      // Not remembered; the choice still holds for this visit.
    }
    touch();
  });
  $("history-list").addEventListener("click", (e) => {
    const row = e.target.closest(".history-step");
    if (!row) return;
    act(() => np.history_go_to(Number(row.dataset.steps)));
  });
}

function renderHistory() {
  const list = $("history-list");
  const labels = np.history_labels();
  const position = np.history_position();
  list.replaceChildren();
  const row = (label, steps) => {
    const li = document.createElement("li");
    li.className = "history-step" + (steps === position ? " current" : "") + (steps > position ? " undone" : "");
    li.dataset.steps = steps;
    li.textContent = label;
    list.appendChild(li);
    return li;
  };
  row(docName === "npaint" ? "Open" : docName, 0);
  labels.forEach((label, k) => row(label, k + 1));
  // Keep the current step in view — scrolling the list itself, never the
  // page, which scrollIntoView would happily drag along.
  const current = list.querySelector(".current");
  if (current) {
    const top = current.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + current.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + current.offsetHeight - list.clientHeight;
  }
}

function renameLayer(index) {
  // A row inside a folded group has no field to type in, so the groups
  // above it are opened first.
  for (let at = np.layer_parent(index); at >= 0; at = np.layer_parent(at)) {
    if (np.layer_collapsed(at)) np.set_layer_collapsed(at, false);
  }
  renderLayers();
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
  // The render loop would replace the row — and the field with it — on the
  // next frame if the panel were still marked dirty. Committing or
  // cancelling marks it again.
  layersDirty = false;
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

/**
 * A pen's pressure, for the stroke's size. Anything else is 1: a mouse
 * reports 0.5 while its button is down, which is not pressure.
 */
function pressureOf(e) {
  if (e.pointerType !== "pen") return 1;
  const p = Number(e.pressure);
  return Number.isFinite(p) && p > 0 ? Math.min(1, Math.max(0.05, p)) : 1;
}

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
  // An open transform owns its box: a handle sitting on the canvas edge, or
  // hanging just past it, must beat the canvas resize grab. Outside the box
  // — where the drag would turn it — the edge still wins, as it does with no
  // transform open.
  const hit = np.is_transforming() ? np.transform_hit(x, y) : "";
  if (hit && hit !== "rotate") return null;
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

/** How close to a guide, in CSS pixels, counts as grabbing it. */
const GUIDE_GRAB = 4;

/** A guide near a screen point, as `{ axis, index }`, if there is one. */
function guideAt(x, y) {
  const zoom = np.zoom();
  const hy = guides.h.findIndex((g) => Math.abs(np.pan_y() + g * zoom - y) <= GUIDE_GRAB);
  if (hy >= 0) return { axis: "h", index: hy };
  const vx = guides.v.findIndex((g) => Math.abs(np.pan_x() + g * zoom - x) <= GUIDE_GRAB);
  if (vx >= 0) return { axis: "v", index: vx };
  return null;
}

/** Where a dragged guide is in document pixels, or null when it is off the
 *  canvas and would be dropped. */
function guidePosition(x, y) {
  const [dx, dy] = np.screen_to_doc(x, y);
  let at = guideDrag.axis === "h" ? dy : dx;
  const extent = guideDrag.axis === "h" ? np.height() : np.width();
  if (at < 0 || at > extent) return null;
  // A guide being placed snaps to the canvas centre, and to the pointer's
  // whole pixel otherwise. The engine snaps everything else.
  if (snapToGuides && Math.abs(at - extent / 2) * np.zoom() <= GUIDE_SNAP) at = extent / 2;
  return Math.round(at);
}

/** How close on screen, in CSS pixels, a dragged guide snaps to the centre. */
const GUIDE_SNAP = 6;

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
    if (textEdit) {
      // A click away from the text keeps it. With the text tool that is
      // all the click does; with any other tool it goes on to do its work.
      commitText();
      if (tool === "text" && e.button === 0) {
        e.preventDefault();
        return;
      }
    }
    // Space with Ctrl or Alt is a temporary zoom tool.
    if (spaceHeld && e.button === 0 && (e.ctrlKey || e.metaKey || e.altKey)) {
      if (e.altKey) np.zoom_out_about(x, y);
      else np.zoom_in_about(x, y);
      needsDraw = true;
      e.preventDefault();
      return;
    }
    const wantsPan = e.button === 1 || spaceHeld;
    const edge = wantsPan ? null : edgeAt(x, y);
    const onRuler = showRulers && !wantsPan && e.button === 0 && (x < RULER || y < RULER);
    // Guides are grabbed with whatever tool is in hand: they are thin, and
    // hunting for the move tool to shift one is worse than losing a couple
    // of pixels of paintable space along each.
    const grabbed = !wantsPan && e.button === 0 && !np.is_transforming() ? guideAt(x, y) : null;
    if (onRuler) {
      // Dragging out of a ruler makes a guide.
      guideDrag = { axis: y < RULER && x >= RULER ? "h" : x < RULER && y >= RULER ? "v" : y < x ? "h" : "v", at: null, index: null };
    } else if (grabbed) {
      guideDrag = { axis: grabbed.axis, at: guides[grabbed.axis][grabbed.index], index: grabbed.index };
      guides[grabbed.axis].splice(grabbed.index, 1);
      needsDraw = true;
    } else if (edge && e.button === 0) {
      // Dragging a canvas edge resizes the canvas, and only starts from
      // outside it, so it never gets in the way of painting.
      resizing = { edge, rect: { x0: 0, y0: 0, x1: np.width(), y1: np.height() } };
      needsDraw = true;
    } else if (wantsPan) {
      pan = { x, y };
      viewport.classList.add("panning", "dragging");
    } else if (e.button === 0 && tool === "text") {
      beginTextAt(x, y);
      e.preventDefault();
      return;
    } else if (e.button === 0) {
      // With the zoom tool, the options-bar "zoom out" acts like Alt.
      const alt = e.altKey || (tool === "zoom" && zoomOutMode);
      if (tool === "subject") subjectMods = { shift: e.shiftKey, alt: e.altKey };
      if (!np.pointer_down(x, y, e.shiftKey, alt, pressureOf(e))) {
        // A smart object's pixels, an adjustment layer's, or a locked
        // layer: the engine says which, and what to do instead.
        const why = np.edit_refusal();
        if (why) message(why.charAt(0).toUpperCase() + why.slice(1) + ".");
        return;
      }
      if (tool === "eyedropper" || alt) syncSwatches();
      if (SELECTION_TOOLS.has(tool)) antsDirty = true;
      needsDraw = true;
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
    if (showsBrushRing() || showRulers) {
      cursor = { x, y };
      needsDraw = true;
    }
    if (guideDrag) {
      guideDrag.at = guidePosition(x, y);
      needsDraw = true;
      return;
    }
    if (resizing) {
      resizing.rect = resizedRect(x, y);
      needsDraw = true;
      return;
    }
    if (!pan && !np.is_gesturing()) {
      const edge = edgeAt(x, y);
      const guide = !np.is_transforming() ? guideAt(x, y) : null;
      view.style.cursor = edge ? EDGE_CURSOR[edge] ?? "" : guide ? (guide.axis === "h" ? "row-resize" : "col-resize") : "";
    }
    if (pan) {
      np.pan_by(x - pan.x, y - pan.y);
      pan = { x, y };
      needsDraw = true;
    } else if (np.is_transforming()) {
      if (e.buttons & 1) np.pointer_move(x, y, e.shiftKey, e.altKey, pressureOf(e));
      else setHitCursor(np.transform_hit(x, y));
    } else if (np.is_gesturing()) {
      const changed = np.pointer_move(x, y, e.shiftKey, e.altKey, pressureOf(e));
      if (tool === "eyedropper") syncSwatches();
      if (changed && SELECTION_TOOLS.has(tool)) antsDirty = true;
      needsDraw = true;
    }
  });

  const end = (e) => {
    const [x, y] = canvasPoint(e);
    if (guideDrag) {
      const at = guidePosition(x, y);
      if (at !== null) guides[guideDrag.axis].push(at);
      const wasThere = guideDrag.index !== null;
      guideDrag = null;
      view.style.cursor = "";
      commitGuides(wasThere ? (at !== null ? "Move Guide" : "Remove Guide") : "Add Guide");
      return;
    }
    if (resizing) {
      const r = resizedRect(x, y);
      resizing = null;
      view.style.cursor = "";
      const w = r.x1 - r.x0;
      const h = r.y1 - r.y0;
      const zoom = np.zoom();
      act(() => {
        if (np.resize_canvas(w, h, -r.x0, -r.y0)) {
          // The pixels moved to (-x0, -y0) within the new canvas, so leaving
          // the pan alone would slide the picture across the screen by that
          // much. Move the origin the other way and the canvas stays under
          // the dashed outline the drag was showing.
          np.pan_by(r.x0 * zoom, r.y0 * zoom);
          message(`Canvas ${w} × ${h} px.`);
        }
      });
      return;
    }
    if (pan) {
      pan = null;
      viewport.classList.remove("panning", "dragging");
    } else if (np.is_transforming()) {
      np.pointer_up(x, y, e.shiftKey, e.altKey, pressureOf(e));
      layersDirty = true;
    } else if (np.is_gesturing()) {
      np.pointer_up(x, y, e.shiftKey, e.altKey, pressureOf(e));
      needsDraw = true;
      if (SELECTION_TOOLS.has(tool)) {
        antsDirty = true;
        historyDirty = true;
      }
      if (tool === "subject") finishSubjectBox();
    }
  };
  view.addEventListener("pointerup", end);
  view.addEventListener("pointercancel", () => {
    pan = null;
    resizing = null;
    guideDrag = null;
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
/** The keys a slider, a checkbox or a dropdown uses itself, which it should keep. */
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
 * editor. A text box takes everything; a tolerance slider, an "All layers"
 * checkbox or the symmetry dropdown takes only the keys it works with, so
 * clicking one does not leave every shortcut dead until you click somewhere
 * else — a dropdown keeps the focus after it is used, so giving it every key
 * put the whole keyboard out of action.
 */
function typingInField(e) {
  const t = e.target;
  if (!t) return false;
  if (t.isContentEditable || t.tagName === "TEXTAREA") return true;
  if (t.tagName === "SELECT") return CONTROL_KEYS.has(e.key);
  if (t.tagName !== "INPUT") return false;
  if (TEXT_ENTRY.has((t.type || "text").toLowerCase())) return true;
  return CONTROL_KEYS.has(e.key);
}

function bindKeyboard() {
  window.addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]")) return;
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

    if (tool === "crop" && key === "Enter" && hasSelection()) {
      cropToSelection();
      e.preventDefault();
      return;
    }

    switch (key) {
      case "F2":
        renameLayer(active());
        e.preventDefault();
        return;
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
        np.clear_subject_box();
        needsDraw = true;
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        return;
      case "Delete":
      case "Backspace":
        // With something selected, Delete clears those pixels (Alt fills
        // them). With nothing selected there are no pixels it could mean,
        // so it deletes the layer — which is what the key does in the
        // layers panel of every editor.
        act(() => {
          if (e.altKey) np.fill_selection();
          else if (hasSelection()) np.clear_selection();
          else np.remove_selected_layers();
        });
        e.preventDefault();
        return;
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown":
        nudge(key, e.shiftKey ? 10 : 1, tool === "move");
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
        // page, so plain T is the one that actually works. The text tool
        // is on Y, the key beside it, for the same reason.
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

    // A key shared by several tools cycles through them.
    const sharing = TOOLS.filter((t) => t.key.toLowerCase() === key);
    if (sharing.length && !e.altKey) {
      const at = sharing.findIndex((t) => t.name === tool);
      setTool(sharing[(at + 1) % sharing.length].name);
    }
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

/**
 * The arrow keys: with the move tool (or Ctrl held) they move the selected
 * pixels, otherwise the selection outline; Shift makes it ten pixels. With
 * the crop tool, Enter crops.
 */
function nudge(key, step, pixels) {
  const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
  const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
  act(() => {
    if (pixels) {
      if (!np.nudge_layer(dx, dy)) {
        const why = np.edit_refusal();
        if (why) message(why.charAt(0).toUpperCase() + why.slice(1) + ".");
      }
    } else if (!np.nudge_selection(dx, dy)) {
      message("Select something to move its outline, or use the move tool to move pixels.");
    }
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
    case "+":
    case "=":
      zoomStep(1);
      return true;
    case "-":
    case "_":
      zoomStep(-1);
      return true;
    case "n":
      if (shift) act(() => np.add_layer());
      else showNewDialog();
      return true;
    case "j":
      act(() => (hasSelection() ? np.layer_via_copy() : np.duplicate_selected_layers()));
      return true;
    case "e":
      act(() => (shift ? np.flatten() : np.merge_down(active())));
      return true;
    case "g":
      // Ctrl+G folds the layer into a group where it is; Ctrl+Shift+G
      // takes the group apart again, as everywhere else.
      act(() => (shift ? np.ungroup(active()) : np.group_selected_layers()));
      return true;
    case "i":
      if (alt) showImageSizeDialog();
      else if (shift) act(() => np.select_invert());
      else adjust.open("invert");
      return true;
    case "u":
      adjust.open(shift ? "desaturate" : "hue-saturation");
      return true;
    case "l":
      if (shift) act(() => np.auto_levels(!alt));
      else adjust.open("levels");
      return true;
    case "m":
      adjust.open("curves");
      return true;
    case "b":
      adjust.open("color-balance");
      return true;
    case "c":
      if (alt) showCanvasDialog();
      else copyToClipboard(shift ? "merged" : "copy");
      return true;
    case "x":
      copyToClipboard("cut");
      return true;
    case "v":
      // Left to the browser: its paste event carries the system clipboard,
      // which a key handler cannot read without asking permission.
      return false;
    case "o":
      pickFile(shift ? "layer" : "open");
      return true;
    case "s":
      if (shift) showExportDialog();
      else saveDocument();
      return true;
    case "k":
      // Not VS Code's Ctrl+Shift+P: Firefox opens a private window on that
      // and will not hand the key back. Ctrl+K is the chord every other
      // command palette on the web uses, and pages may cancel it.
      commandPalette.open();
      return true;
    case "r":
      toggleRulers();
      return true;
    case "'":
      toggleGrid();
      return true;
    case "ArrowLeft":
    case "ArrowRight":
    case "ArrowUp":
    case "ArrowDown":
      nudge(key, shift ? 10 : 1, true);
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
