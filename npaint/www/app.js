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
  { name: "move", label: "Move", key: "V", hint: "Drag to move the selected pixels, or the whole layer." },
  { name: "brush", label: "Brush", key: "B", hint: "Paint with the foreground colour at the chosen opacity." },
  { name: "pencil", label: "Pencil", key: "P", hint: "Hard, fully opaque strokes." },
  { name: "eraser", label: "Eraser", key: "E", hint: "Erase to transparent." },
  { name: "line", label: "Line", key: "L", hint: "Drag to draw a line. Shift snaps to 45°." },
  { name: "rectangle", label: "Rectangle", key: "U", hint: "Drag to draw. Shift for a square, Alt to draw from the centre." },
  { name: "ellipse", label: "Ellipse", key: "O", hint: "Drag to draw. Shift for a circle, Alt to draw from the centre." },
  { name: "zoom", label: "Zoom", key: "Z", hint: "Click to zoom in, Alt+click to zoom out, drag left or right to scrub." },
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
let dpr = 1;
let picker; // the colour picker
let pickerTarget = "fg"; // which swatch the picker is editing
let adjust; // the adjustment dialog

// ---- Boot -------------------------------------------------------------------

async function boot() {
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
  adjust = createAdjustDialog(np, { onChange: touch, onError: message });

  $("loading").hidden = true;
  $("app").hidden = false;

  new ResizeObserver(onResize).observe(viewport);
  onResize();
  np.fit_to_view(viewport.clientWidth, viewport.clientHeight);
  syncOptions();
  requestAnimationFrame(frame);
}

function onResize() {
  dpr = window.devicePixelRatio || 1;
  view.width = Math.max(1, Math.round(viewport.clientWidth * dpr));
  view.height = Math.max(1, Math.round(viewport.clientHeight * dpr));
  needsDraw = true;
}

/** Marks everything the engine may have changed as needing a refresh. */
function touch() {
  needsDraw = true;
  layersDirty = true;
}

let messageTimer = null;
function message(text) {
  $("status-message").textContent = text;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => ($("status-message").textContent = ""), 4000);
}

// ---- Render loop --------------------------------------------------------------

function frame(now) {
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
  }

  const selection = np.selection_rect();
  const transforming = np.is_transforming();
  if (needsDraw || selection.length || transforming) {
    draw(now, selection, transforming);
    needsDraw = false;
  }

  if (layersDirty && !np.is_gesturing()) {
    renderLayers();
    syncTransformBar();
    layersDirty = false;
  }

  requestAnimationFrame(frame);
}

function draw(now, selection, transforming) {
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

  if (selection.length) {
    const [sx, sy, sw, sh] = selection;
    const x = Math.round(px + sx * zoom) + 0.5;
    const y = Math.round(py + sy * zoom) + 0.5;
    const rw = Math.round(sw * zoom);
    const rh = Math.round(sh * zoom);
    vctx.lineWidth = 1;
    vctx.setLineDash([5, 4]);
    vctx.lineDashOffset = -((now / 60) % 9);
    vctx.strokeStyle = "#fff";
    vctx.strokeRect(x, y, rw, rh);
    vctx.lineDashOffset = -((now / 60) % 9) + 4.5;
    vctx.strokeStyle = "#000";
    vctx.strokeRect(x, y, rw, rh);
    vctx.setLineDash([]);
  }

  if (transforming) drawTransformBox();

  $("btn-zoom-level").textContent = `${Math.round(zoom * 100)}%`;
  $("status-size").textContent = `${np.width()} × ${np.height()} px`;
  $("status-selection").textContent = selection.length
    ? `Selection ${selection[2]} × ${selection[3]} at ${selection[0]}, ${selection[1]}`
    : "";
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

// ---- Toolbox and options ------------------------------------------------------

function buildToolbox() {
  const box = $("tools");
  for (const t of TOOLS) {
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

/** Shows the options that apply to the current tool. */
function syncOptions() {
  const isShape = tool === "rectangle" || tool === "ellipse";
  const hasOpacity = tool === "brush" || tool === "eraser";
  const viewTool = tool === "select" || tool === "hand" || tool === "zoom" || tool === "move";
  const usesSize = !viewTool && !(isShape && np.fill());
  $("opt-opacity-wrap").hidden = !hasOpacity;
  $("opt-fill-wrap").hidden = !isShape;
  $("opt-zoom-wrap").hidden = tool !== "zoom";
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

/** The items that act on one layer; shared by the Layer menu and the
 *  layer row's context menu. */
function layerItems(index) {
  const i = () => (index === undefined ? active() : index);
  return [
    { label: "New Layer", shortcut: "Ctrl+Shift+N", action: () => act(() => np.add_layer()) },
    { label: "Duplicate Layer", shortcut: "Ctrl+J", action: () => act(() => np.duplicate_layer(i())) },
    { label: "Layer via Copy", enabled: hasSelection, action: () => act(() => np.layer_via_copy()) },
    { label: "Delete Layer", enabled: () => layerCount() > 1, action: () => act(() => np.remove_layer(i())) },
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
    { label: "Merge Down", shortcut: "Ctrl+E", enabled: () => i() > 0, action: () => act(() => np.merge_down(i())) },
    { label: "Flatten Image", shortcut: "Ctrl+Shift+E", enabled: () => layerCount() > 1, action: () => act(() => np.flatten()) },
    { sep: true },
    {
      label: "Transform",
      submenu: [
        { label: "Free Transform…", shortcut: "Ctrl+T", action: () => withActive(i(), beginTransform) },
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
    { label: "Free Transform…", shortcut: "Ctrl+T", action: beginTransform },
    { sep: true },
    { label: "Fill with Foreground", shortcut: "Alt+Backspace", action: () => act(() => np.fill_selection()) },
    { label: "Fill with Background", shortcut: "Ctrl+Backspace", action: () => act(() => np.fill_selection_background()) },
    { label: "Clear", shortcut: "Delete", action: () => act(() => np.clear_selection()) },
    { sep: true },
    { label: "Swap Colours", shortcut: "X", action: swapColors },
    { label: "Default Colours", shortcut: "D", action: resetColors },
  ];
}

function selectItems() {
  return [
    { label: "All", shortcut: "Ctrl+A", action: () => act(() => np.select_all()) },
    { label: "Deselect", shortcut: "Ctrl+D", enabled: hasSelection, action: () => act(() => np.deselect()) },
  ];
}

function buildMenus() {
  createMenuBar($("menus"), [
    {
      title: "File",
      items: [
        { label: "New…", shortcut: "Ctrl+N", action: showNewDialog },
        { label: "Open…", shortcut: "Ctrl+O", action: () => pickFile("open") },
        { label: "Place…", action: () => pickFile("place") },
        { sep: true },
        { label: "Export PNG", shortcut: "Ctrl+S", action: exportPng },
      ],
    },
    { title: "Edit", items: editItems() },
    {
      title: "Image",
      items: [
        { label: "Adjustments", submenu: adjustmentItems() },
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

/** Decodes an image file and either opens it as a document or places it as
 *  a layer, scaled to fit the current document. */
async function loadFile(file, mode) {
  const bitmap = await createImageBitmap(file);
  const name = file.name.replace(/\.[^.]+$/, "") || "Image";
  const scratch = document.createElement("canvas");
  const sctx = scratch.getContext("2d");

  if (mode === "open") {
    scratch.width = bitmap.width;
    scratch.height = bitmap.height;
    sctx.drawImage(bitmap, 0, 0);
    const data = sctx.getImageData(0, 0, bitmap.width, bitmap.height);
    np.open_image(name, bitmap.width, bitmap.height, new Uint8Array(data.data.buffer));
    fit();
  } else {
    const w = np.width();
    const h = np.height();
    scratch.width = w;
    scratch.height = h;
    const scale = Math.min(1, w / bitmap.width, h / bitmap.height);
    const dw = Math.round(bitmap.width * scale);
    const dh = Math.round(bitmap.height * scale);
    sctx.drawImage(bitmap, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh);
    const data = sctx.getImageData(0, 0, w, h);
    np.add_layer_from_rgba(name, w, h, new Uint8Array(data.data.buffer));
  }
  bitmap.close();
  touch();
}

function exportPng() {
  const w = np.width();
  const h = np.height();
  const bytes = np.frame_copy();
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer), w, h), 0, 0);
  c.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "npaint.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
}

// ---- Layers panel ---------------------------------------------------------------

function bindLayers() {
  $("layer-add").addEventListener("click", () => act(() => np.add_layer()));
  $("layer-dup").addEventListener("click", () => act(() => np.duplicate_layer(active())));
  $("layer-delete").addEventListener("click", () => act(() => np.remove_layer(active())));
  $("layer-merge").addEventListener("click", () => act(() => np.merge_down(active())));
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

function renderLayers() {
  const list = $("layer-list");
  const count = layerCount();
  const act_ = active();
  list.replaceChildren();

  for (let i = count - 1; i >= 0; i--) {
    const li = document.createElement("li");
    const visible = np.layer_visible(i);
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

    const thumb = document.createElement("canvas");
    thumb.className = "thumb";
    thumb.width = 40;
    thumb.height = 30;
    const bytes = np.layer_thumbnail(i, 40, 30);
    thumb.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer), 40, 30), 0, 0);

    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = np.layer_name(i);
    name.title = "Double-click to rename";
    name.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      beginRename(name, i);
    });

    li.append(eye, thumb, name);
    li.addEventListener("click", () => act(() => np.set_active_layer(i)));
    list.appendChild(li);
  }

  const opacity = Math.round(np.layer_opacity(act_) * 100);
  $("layer-opacity").value = opacity;
  $("layer-opacity-out").value = `${opacity}%`;
  $("layer-delete").disabled = count <= 1;
  $("layer-merge").disabled = act_ === 0;
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

function bindPointer() {
  view.addEventListener("pointerdown", (e) => {
    closeMenus();
    const [x, y] = canvasPoint(e);
    if (e.button === 2) return; // the context menu handler has it
    const wantsPan = e.button === 1 || spaceHeld;
    if (wantsPan) {
      pan = { x, y };
      viewport.classList.add("panning", "dragging");
    } else if (e.button === 0) {
      // With the zoom tool, the options-bar "zoom out" acts like Alt.
      const alt = e.altKey || (tool === "zoom" && zoomOutMode);
      if (!np.pointer_down(x, y, e.shiftKey, alt)) return;
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
    viewport.classList.remove("panning", "dragging");
    np.cancel_gesture();
  });
  view.addEventListener("pointerleave", () => {
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

function typingInField(e) {
  const t = e.target;
  return t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

function bindKeyboard() {
  window.addEventListener("keydown", (e) => {
    if ($("dlg-new").open || adjust.isOpen()) return;
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
      case "Escape":
        closeMenus();
        picker.close();
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
      adjust.open("invert");
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
      exportPng();
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
