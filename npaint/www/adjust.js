// The adjustment dialog. Every adjustment is described as data — its engine
// name and its controls — and the dialog is built from that. Controls call
// `preview_adjustment` on every change, so the canvas shows the result live;
// OK commits it as one undo step and Cancel puts the pixels back.
//
// Most controls are sliders. Two are not: Curves is a tone curve drawn by
// hand on a small graph, and Map to Palette shows the palette panel's
// colours; both hand the engine a variable-length flat list, which is why
// they ride at the end of an adjustment's parameters.
// There are two small ones besides — a dropdown and a checkbox — which hand
// the engine a number like everything else: the option's index, or 0/1.
//
// A parameter may carry an `enabled(values)` predicate; the row greys out
// when it is false. The dither's cell size uses it, since only the ordered
// patterns have cells.
//
// One row is special: `channel: true` marks the colour channel the
// adjustment is aimed at. It shows at the top, where a channel belongs, but
// the engine reads it *after* the adjustment's own parameters (see
// `Adjustment::params`), so `build` and `values` put it at the end of the
// flat list. It also tints the dialog, which is how you can tell at a glance
// that the curve you are dragging is the red one.
//
// The same dialog edits an adjustment *layer*: `openLayer` opens it showing
// the layer's current settings, and the engine's session applies each change
// to the layer rather than to pixels. The dialog cannot tell the difference,
// which is the point.

// An adjustment may also carry a `demo`, which is what the hover card in
// `adjusthelp.js` shows for it. It is optional: without one the card sweeps
// the first slider from where it sits to most of the way to its maximum,
// which is a fair demo for a filter with one obvious knob and is what makes
// adding a filter enough to get a demo. It is there on almost every entry
// anyway, because the fair default is rarely the *good* one — Levels wants
// its gamma swept, not its black point, and Sharpen shows nothing at all
// unless it is held against the original.

import { currentPaletteFlat } from "./palette.js";

/**
 * The dither patterns, in the order `dither::DitherMethod::ALL` declares
 * them: the index is what the engine is handed. The ordered ones come first,
 * so the index also says which family a choice belongs to.
 */
const DITHER_PATTERNS = [
  "Ordered 2×2",
  "Ordered 4×4",
  "Ordered 8×8",
  "Noise",
  "Floyd–Steinberg",
  "Jarvis–Judice–Ninke",
  "Stucki",
  "Atkinson",
  "Sierra",
];
/** The first of the error-diffusion patterns, and the default. */
const DITHER_FLOYD_STEINBERG = 4;

/**
 * The channels, in the order `adjust::Channel::ALL` declares them: the index
 * is what the engine is handed. Only the per-channel adjustments offer it —
 * the ones `Kind::takes_channel` says yes to.
 */
const CHANNELS = ["RGB", "Red", "Green", "Blue"];
/** What each channel tints the dialog with; RGB leaves it alone. */
const CHANNEL_TINTS = [null, "#e4564a", "#3fa85c", "#4e7ff2"];
/** The channel row, shared by every adjustment that takes one. */
const channelParam = () => ({ kind: "choice", label: "Channel", value: 0, options: CHANNELS, channel: true });

/**
 * The palette filter's patterns: the dithers, with "None" in front of them,
 * so the index is one past `dither::DitherMethod::ALL` and zero is a plain
 * nearest-colour match. `adjust::Kind::Palette` reads it the same way.
 */
const PALETTE_PATTERNS = ["None", ...DITHER_PATTERNS];
/** The first error-diffusion pattern in that list, which has no cells. */
const PALETTE_DIFFUSION = DITHER_FLOYD_STEINBERG + 1;

export const ADJUSTMENTS = [
  {
    name: "brightness-contrast",
    hint: "Lifts or drops the tones, and spreads or squeezes them about the middle.",
    label: "Brightness / Contrast…",
    shortcut: "",
    params: [
      channelParam(),
      { label: "Brightness", min: -100, max: 100, value: 0 },
      { label: "Contrast", min: -100, max: 100, value: 0 },
    ],
    demo: { param: "Brightness", from: -55, to: 55 },
  },
  {
    name: "levels",
    hint: "Sets which input tones become black and white, and how the rest sit between.",
    label: "Levels…",
    shortcut: "Ctrl+L",
    params: [
      channelParam(),
      { label: "Black point", min: 0, max: 254, value: 0 },
      { label: "White point", min: 1, max: 255, value: 255 },
      { label: "Gamma", min: 0.1, max: 4, value: 1, step: 0.01 },
    ],
    demo: { param: "Gamma", from: 2.2, to: 0.45 },
  },
  {
    name: "curves",
    hint: "The tone curve by hand: drag the line to say what each input becomes.",
    label: "Curves…",
    shortcut: "Ctrl+M",
    params: [channelParam(), { kind: "curve", label: "Curve", value: [0, 0, 255, 255] }],
    demo: { style: "wipe", set: { Curve: [0, 0, 64, 30, 192, 225, 255, 255] } },
  },
  {
    name: "hue-saturation",
    hint: "Turns every colour round the wheel, and how strong and how light it is.",
    label: "Hue / Saturation…",
    shortcut: "Ctrl+U",
    params: [
      { label: "Hue", min: -180, max: 180, value: 0, unit: "°" },
      { label: "Saturation", min: -100, max: 100, value: 0 },
      { label: "Lightness", min: -100, max: 100, value: 0 },
    ],
    demo: { param: "Hue", from: -180, to: 180 },
  },
  {
    name: "color-balance",
    hint: "Warms or cools shadows, midtones and highlights apart from each other.",
    label: "Colour Balance…",
    shortcut: "Ctrl+B",
    params: [
      { heading: "Shadows" },
      { label: "Cyan – Red", min: -100, max: 100, value: 0 },
      { label: "Magenta – Green", min: -100, max: 100, value: 0 },
      { label: "Yellow – Blue", min: -100, max: 100, value: 0 },
      { heading: "Midtones" },
      { label: "Cyan – Red", min: -100, max: 100, value: 0 },
      { label: "Magenta – Green", min: -100, max: 100, value: 0 },
      { label: "Yellow – Blue", min: -100, max: 100, value: 0 },
      { heading: "Highlights" },
      { label: "Cyan – Red", min: -100, max: 100, value: 0 },
      { label: "Magenta – Green", min: -100, max: 100, value: 0 },
      { label: "Yellow – Blue", min: -100, max: 100, value: 0 },
    ],
    demo: { param: "Midtones/Cyan – Red", from: -75, to: 75 },
  },
  {
    name: "dither",
    hint: "Trades tones for a pattern made of the few that are left.",
    label: "Dither…",
    params: [
      { kind: "choice", label: "Pattern", value: DITHER_FLOYD_STEINBERG, options: DITHER_PATTERNS },
      { label: "Levels", min: 2, max: 16, value: 2 },
      { label: "Strength", min: 0, max: 100, value: 100, unit: "%" },
      // Only the ordered patterns are laid out in cells; diffusion has none.
      { label: "Cell size", min: 1, max: 16, value: 1, unit: " px", enabled: (v) => v[0] < DITHER_FLOYD_STEINBERG },
      { kind: "toggle", label: "Greyscale", value: 0 },
    ],
    demo: { style: "wipe" },
  },
  {
    name: "posterize",
    hint: "Rounds every channel to a few evenly spaced levels.",
    label: "Posterize…",
    params: [channelParam(), { label: "Levels", min: 2, max: 32, value: 4 }],
    demo: { param: "Levels", from: 32, to: 3 },
  },
  {
    name: "threshold",
    hint: "Everything lighter than the level goes white, everything darker black.",
    label: "Threshold…",
    params: [{ label: "Level", min: 0, max: 255, value: 128 }],
    demo: { param: "Level", from: 100, to: 175 },
  },
  {
    name: "invert",
    hint: "Swaps every channel for its opposite.",
    label: "Invert",
    shortcut: "Ctrl+I",
    params: [],
  },
  // The filters. They are adjustments in every way that matters — the same
  // dialog, the same preview, the same life as an adjustment layer — and
  // are marked only so the menu bar can list them under Filter, where
  // people look for them. See `filter.rs` for why they are not lookup
  // tables like the rest.
  {
    name: "blur",
    hint: "Averages each pixel with its neighbours out to the radius.",
    label: "Blur…",
    group: "filter",
    params: [{ label: "Radius", min: 0, max: 50, value: 2, unit: " px" }],
    demo: { param: "Radius", from: 0, to: 8 },
  },
  {
    name: "motion-blur",
    hint: "Smears the picture along one direction, as a moving camera would.",
    label: "Motion Blur…",
    group: "filter",
    params: [
      { label: "Angle", min: -180, max: 180, value: 0, unit: "°" },
      { label: "Distance", min: 0, max: 200, value: 20, unit: " px" },
    ],
    demo: { param: "Distance", from: 0, to: 40 },
  },
  {
    name: "sharpen",
    hint: "Raises contrast at the edges, which reads as more detail.",
    label: "Sharpen…",
    group: "filter",
    params: [
      { label: "Radius", min: 1, max: 50, value: 1, unit: " px" },
      { label: "Amount", min: 0, max: 300, value: 100, unit: "%" },
    ],
    demo: { style: "wipe", set: { Radius: 2, Amount: 220 } },
  },
  {
    name: "median",
    hint: "Takes the middle of each pixel's neighbours: speckles go, edges stay.",
    label: "Median…",
    group: "filter",
    params: [{ label: "Radius", min: 0, max: 8, value: 2, unit: " px" }],
    demo: { style: "wipe", set: { Radius: 3 } },
  },
  {
    name: "noise",
    hint: "Scatters random values over the pixels, in colour or in grey alone.",
    label: "Add Noise…",
    group: "filter",
    params: [
      { label: "Amount", min: 0, max: 100, value: 10, unit: "%" },
      { kind: "toggle", label: "Monochromatic", value: 0 },
    ],
    demo: { param: "Amount", from: 0, to: 45 },
  },
  {
    name: "pixelate",
    hint: "Averages the picture into square cells.",
    label: "Pixelate…",
    group: "filter",
    params: [{ label: "Cell size", min: 1, max: 100, value: 8, unit: " px" }],
    demo: { param: "Cell size", from: 1, to: 22 },
  },
  {
    name: "emboss",
    hint: "Turns edges into light and shade from one direction, over flat grey.",
    label: "Emboss…",
    group: "filter",
    params: [
      { label: "Angle", min: -180, max: 180, value: 135, unit: "°" },
      { label: "Amount", min: 0, max: 300, value: 100, unit: "%" },
    ],
    demo: { style: "wipe" },
  },
  {
    name: "find-edges",
    hint: "Keeps where the picture changes and drops where it does not.",
    label: "Find Edges…",
    group: "filter",
    params: [{ label: "Amount", min: 0, max: 300, value: 100, unit: "%" }],
    demo: { style: "wipe" },
  },
  {
    // The colours are the palette panel's, and ride at the end of the
    // parameters as the curve's points do — see `src/palette.rs`.
    name: "palette",
    hint: "Maps every pixel to the nearest colour the palette panel holds.",
    label: "Map to Palette…",
    group: "filter",
    params: [
      { kind: "choice", label: "Dither", value: 0, options: PALETTE_PATTERNS },
      { label: "Strength", min: 0, max: 100, value: 100, unit: "%", enabled: (v) => v[0] > 0 },
      { label: "Cell size", min: 1, max: 16, value: 1, unit: " px", enabled: (v) => v[0] > 0 && v[0] < PALETTE_DIFFUSION },
      { kind: "palette", label: "Palette", value: [] },
    ],
    demo: { style: "wipe" },
  },
  {
    name: "age",
    hint: "Years pass: the tones fade and yellow, the edges brown, and foxing, dust and scratches gather.",
    label: "Age…",
    group: "filter",
    params: [
      { label: "Years", min: 0, max: 200, value: 60 },
      { label: "Foxing", min: 0, max: 100, value: 50, unit: "%" },
      { label: "Wear", min: 0, max: 100, value: 50, unit: "%" },
    ],
    demo: { param: "Years", from: 0, to: 170 },
  },
  {
    name: "desaturate",
    hint: "Drops the colour, keeping each pixel's brightness.",
    label: "Desaturate",
    shortcut: "Ctrl+Shift+U",
    params: [],
  },
];

/** How far toward its maximum a slider is swept when no demo says. */
const DEMO_SWEEP_FRACTION = 0.6;

/** The parameters of `spec` that carry a value, in declaration order. */
const valueParams = (spec) => spec.params.filter((p) => !p.heading);

/**
 * What a parameter answers to in a demo's `param` and `set`: its label, or
 * `Heading/Label` where a label alone would not say which — Colour Balance
 * has three rows called "Cyan – Red".
 */
function paramKeys(spec) {
  const keys = new Map();
  let heading = "";
  for (const p of spec.params) {
    if (p.heading) {
      heading = p.heading;
      continue;
    }
    keys.set(p, heading ? `${heading}/${p.label}` : p.label);
  }
  return keys;
}

/** The values a parameter contributes to the engine's flat list. */
function flatten(param, value) {
  if (param.kind === "palette") {
    const colors = Array.isArray(value) && value.length >= 3 ? value : currentPaletteFlat();
    return colors;
  }
  if (param.kind === "curve") return Array.isArray(value) ? value : param.value;
  return [Number(value)];
}

/**
 * One adjustment's parameters in the order the engine reads them — the
 * adjustment's own first, the channel last, as `values()` hands them over —
 * starting from the dialog's defaults. `overrides` replaces values by the
 * keys `paramKeys` gives.
 */
export function paramsFor(spec, overrides = {}) {
  const keys = paramKeys(spec);
  const own = [];
  const channel = [];
  for (const param of valueParams(spec)) {
    const key = keys.get(param);
    const value = key in overrides ? overrides[key] : param.value;
    (param.channel ? channel : own).push(...flatten(param, value));
  }
  return new Float32Array([...own, ...channel]);
}

/**
 * A demo's settings filled in: which parameter it sweeps and between what,
 * with the rest of the adjustment pinned where `set` puts it. Returns null
 * for a demo with nothing to sweep, which the card shows as a wipe against
 * the original instead.
 */
export function demoSweep(spec) {
  const demo = spec.demo ?? {};
  if (demo.style === "wipe") return null;
  const keys = paramKeys(spec);
  const sliders = valueParams(spec).filter((p) => !p.channel && !p.kind);
  const param = demo.param ? sliders.find((p) => keys.get(p) === demo.param) : sliders[0];
  if (!param) return null;
  const from = demo.from ?? param.value;
  const to = demo.to ?? param.value + (param.max - param.value) * DEMO_SWEEP_FRACTION;
  return { key: keys.get(param), from, to };
}

/** The size of the curves graph, in CSS pixels. */
const CURVE_SIZE = 200;
/** How close a click must be to a point to pick it up, in CSS pixels. */
const CURVE_GRAB = 8;
/** Dragging a point this far off the graph throws it away. */
const CURVE_DROP = 24;

/**
 * A monotone cubic (Fritsch–Carlson) through the points, the same shape the
 * engine builds its lookup table with, so what is drawn is what is done.
 * Returns the output for every input 0..=255.
 */
function curveTable(points) {
  const n = points.length;
  const out = new Array(256);
  if (n < 2) {
    for (let i = 0; i < 256; i++) out[i] = i;
    return out;
  }
  const delta = [];
  for (let i = 0; i < n - 1; i++) delta.push((points[i + 1][1] - points[i][1]) / Math.max(1e-6, points[i + 1][0] - points[i][0]));
  const m = new Array(n).fill(0);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / delta[i];
    const b = m[i + 1] / delta[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * delta[i];
      m[i + 1] = t * b * delta[i];
    }
  }
  for (let x = 0; x < 256; x++) {
    let y;
    if (x <= points[0][0]) y = points[0][1];
    else if (x >= points[n - 1][0]) y = points[n - 1][1];
    else {
      let i = 0;
      while (i < n - 2 && x >= points[i + 1][0]) i++;
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      const h = Math.max(1e-6, x1 - x0);
      const t = (x - x0) / h;
      const t2 = t * t;
      const t3 = t2 * t;
      y = (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m[i + 1];
    }
    out[x] = Math.max(0, Math.min(255, y));
  }
  return out;
}

/**
 * The curves control: a graph of input (across) against output (up).
 * Click to add a point, drag to move one, drag it well off the graph to
 * remove it. The two end points stay on their edges.
 */
function createCurveControl(initial, onChange) {
  const row = document.createElement("div");
  row.className = "curve-row";
  const canvas = document.createElement("canvas");
  canvas.className = "curve-graph";
  const dpr = window.devicePixelRatio || 1;
  canvas.width = CURVE_SIZE * dpr;
  canvas.height = CURVE_SIZE * dpr;
  const readout = document.createElement("output");
  readout.className = "curve-readout";
  row.append(canvas, readout);
  const ctx = canvas.getContext("2d");
  let points = [];
  let dragging = null; // index of the point being dragged

  function set(flat) {
    points = [];
    for (let i = 0; i + 1 < flat.length; i += 2) points.push([flat[i], flat[i + 1]]);
    if (points.length < 2) points = [[0, 0], [255, 255]];
    points.sort((a, b) => a[0] - b[0]);
    draw();
  }

  const toScreen = ([x, y]) => [(x / 255) * CURVE_SIZE, CURVE_SIZE - (y / 255) * CURVE_SIZE];
  const toCurve = (sx, sy) => [Math.max(0, Math.min(255, (sx / CURVE_SIZE) * 255)), Math.max(0, Math.min(255, 255 - (sy / CURVE_SIZE) * 255))];

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CURVE_SIZE, CURVE_SIZE);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, CURVE_SIZE, CURVE_SIZE);
    ctx.strokeStyle = "#3a3a3a";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const p = (i * CURVE_SIZE) / 4 + 0.5;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, CURVE_SIZE);
      ctx.moveTo(0, p);
      ctx.lineTo(CURVE_SIZE, p);
      ctx.stroke();
    }
    ctx.strokeStyle = "#555";
    ctx.beginPath();
    ctx.moveTo(0, CURVE_SIZE);
    ctx.lineTo(CURVE_SIZE, 0);
    ctx.stroke();
    const table = curveTable(points);
    ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue("--adjust-accent").trim() || "#e6e6e6";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x < 256; x++) {
      const [sx, sy] = toScreen([x, table[x]]);
      if (x === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    points.forEach((p, i) => {
      const [sx, sy] = toScreen(p);
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.fillStyle = i === dragging ? "#4ea3f2" : "#fff";
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    readout.value = dragging === null ? `${points.length} points` : `in ${Math.round(points[dragging][0])} → out ${Math.round(points[dragging][1])}`;
  }

  function local(e) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * CURVE_SIZE, ((e.clientY - r.top) / r.height) * CURVE_SIZE];
  }

  canvas.addEventListener("pointerdown", (e) => {
    const [sx, sy] = local(e);
    let nearest = -1;
    let best = CURVE_GRAB;
    points.forEach((p, i) => {
      const [px, py] = toScreen(p);
      const d = Math.hypot(px - sx, py - sy);
      if (d <= best) {
        best = d;
        nearest = i;
      }
    });
    if (nearest < 0) {
      const p = toCurve(sx, sy);
      // No two points on the same input: nudge along until it is free.
      while (points.some((q) => Math.abs(q[0] - p[0]) < 1)) p[0] += 1;
      if (p[0] > 255) return;
      points.push(p);
      points.sort((a, b) => a[0] - b[0]);
      nearest = points.findIndex((q) => q === p);
    }
    dragging = nearest;
    canvas.setPointerCapture(e.pointerId);
    draw();
    onChange();
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragging === null) return;
    const [sx, sy] = local(e);
    const i = dragging;
    const isEnd = i === 0 || i === points.length - 1;
    if (!isEnd && (sx < -CURVE_DROP || sx > CURVE_SIZE + CURVE_DROP || sy < -CURVE_DROP || sy > CURVE_SIZE + CURVE_DROP)) {
      points.splice(i, 1);
      dragging = null;
      draw();
      onChange();
      return;
    }
    const [x, y] = toCurve(sx, sy);
    // Keep the point between its neighbours, and the ends on the edges.
    const lo = i === 0 ? 0 : points[i - 1][0] + 1;
    const hi = i === points.length - 1 ? 255 : points[i + 1][0] - 1;
    points[i] = [isEnd ? points[i][0] : Math.max(lo, Math.min(hi, x)), y];
    draw();
    onChange();
  });
  const release = () => {
    if (dragging === null) return;
    dragging = null;
    draw();
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  set(initial);
  return {
    element: row,
    values: () => points.flat(),
    reset: (flat) => set(flat),
    focus: () => canvas.focus(),
    setEnabled: () => {},
    restyle: draw,
  };
}

/**
 * The palette the filter maps onto: the colours the palette panel has in
 * hand, shown as swatches. The panel is where a palette is edited, so this
 * only shows what will be used and offers to take the panel's colours again
 * when they have moved on since the dialog opened.
 */
function createPaletteControl(initial, onChange) {
  const row = document.createElement("div");
  row.className = "adjust-row adjust-palette";
  const label = document.createElement("label");
  label.textContent = "Palette";
  const swatches = document.createElement("div");
  swatches.className = "adjust-swatches";
  const take = document.createElement("button");
  take.type = "button";
  take.textContent = "Use current palette";
  take.title = "Take the colours the palette panel has now";
  let colors = initial.length >= 3 ? [...initial] : currentPaletteFlat();

  function draw() {
    swatches.replaceChildren();
    for (let i = 0; i + 2 < colors.length; i += 3) {
      const dot = document.createElement("span");
      dot.className = "adjust-swatch";
      dot.style.background = `rgb(${colors[i]}, ${colors[i + 1]}, ${colors[i + 2]})`;
      swatches.appendChild(dot);
    }
    const count = colors.length / 3;
    take.disabled = false;
    label.textContent = count ? `Palette (${count})` : "Palette (empty)";
  }

  take.addEventListener("click", () => {
    colors = currentPaletteFlat();
    draw();
    onChange();
  });
  draw();
  row.append(label, swatches, take);
  return {
    element: row,
    values: () => colors,
    reset: () => {
      colors = currentPaletteFlat();
      draw();
    },
    focus: () => take.focus(),
    setEnabled: () => {},
  };
}

/** A slider control, with its label and readout. */
function createSliderControl(p, value, onChange) {
  const row = document.createElement("div");
  row.className = "adjust-row";
  const label = document.createElement("label");
  label.textContent = p.label;
  const range = document.createElement("input");
  range.type = "range";
  range.min = p.min;
  range.max = p.max;
  range.step = p.step || 1;
  range.value = Number.isFinite(value) ? value : p.value;
  const out = document.createElement("output");
  const show = () => (out.value = `${range.value}${p.unit || ""}`);
  range.addEventListener("input", () => {
    show();
    onChange();
  });
  show();
  row.append(label, range, out);
  return {
    element: row,
    values: () => [Number(range.value)],
    reset: (v) => {
      range.value = v;
      show();
    },
    focus: () => range.focus(),
    setEnabled: (on) => {
      range.disabled = !on;
      row.classList.toggle("adjust-off", !on);
    },
  };
}

/** A dropdown; its value is the chosen option's index. */
function createChoiceControl(p, value, onChange) {
  const row = document.createElement("div");
  row.className = "adjust-row";
  const label = document.createElement("label");
  label.textContent = p.label;
  const select = document.createElement("select");
  p.options.forEach((name, i) => {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = name;
    select.appendChild(option);
  });
  select.value = String(Number.isFinite(value) ? Math.round(value) : p.value);
  label.htmlFor = select.id = `adjust-choice-${p.label.replace(/\W+/g, "-").toLowerCase()}`;
  select.addEventListener("change", onChange);
  row.append(label, select);
  return {
    element: row,
    values: () => [Number(select.value)],
    reset: (v) => {
      select.value = String(v);
    },
    focus: () => select.focus(),
    setEnabled: (on) => {
      select.disabled = !on;
      row.classList.toggle("adjust-off", !on);
    },
  };
}

/** A checkbox; its value is 0 or 1. */
function createToggleControl(p, value, onChange) {
  const row = document.createElement("div");
  row.className = "adjust-row";
  const label = document.createElement("label");
  label.textContent = p.label;
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = (Number.isFinite(value) ? value : p.value) >= 0.5;
  label.htmlFor = box.id = `adjust-toggle-${p.label.replace(/\W+/g, "-").toLowerCase()}`;
  box.addEventListener("change", onChange);
  row.append(label, box);
  return {
    element: row,
    values: () => [box.checked ? 1 : 0],
    reset: (v) => {
      box.checked = v >= 0.5;
    },
    focus: () => box.focus(),
    setEnabled: (on) => {
      box.disabled = !on;
      row.classList.toggle("adjust-off", !on);
    },
  };
}

/**
 * Wires the adjustment dialog to the engine. Returns `open(name)`; the
 * parameterless adjustments apply straight away without a dialog.
 */
export function createAdjustDialog(np, { onChange, onError, mayEdit }) {
  const dlg = document.getElementById("dlg-adjust");
  const title = document.getElementById("adjust-title");
  const paramsRoot = document.getElementById("adjust-params");
  let spec = null;
  let controls = [];
  let specs = []; // the parameter spec behind each control, in step

  /** The controls' values as the engine reads them: the channel last. */
  function values() {
    const own = controls.filter((c, k) => !specs[k].channel).flatMap((c) => c.values());
    const channel = controls.filter((c, k) => specs[k].channel).flatMap((c) => c.values());
    return new Float32Array([...own, ...channel]);
  }

  /**
   * Greys the rows whose `enabled` predicate says they do not apply, and
   * tints the dialog to the channel being edited.
   */
  function refreshRows() {
    const flat = Array.from(values());
    specs.forEach((p, k) => p.enabled && controls[k].setEnabled(!!p.enabled(flat)));
    const channel = specs.findIndex((p) => p.channel);
    const tint = channel < 0 ? null : CHANNEL_TINTS[controls[channel].values()[0]];
    if (tint) paramsRoot.style.setProperty("--adjust-accent", tint);
    else paramsRoot.style.removeProperty("--adjust-accent");
    controls.forEach((c) => c.restyle && c.restyle());
  }

  /** The queued preview pass, or 0 when none is waiting. */
  let pending = 0;

  function runPreview() {
    pending = 0;
    try {
      np.preview_adjustment(spec.name, values());
    } catch (e) {
      onError(String(e));
    }
    onChange();
  }

  // A slider fires `input` faster than the canvas redraws, so a pass a
  // frame is as many as anyone can see — and with a filter as slow as the
  // median the ones in between are answers that are stale before they
  // finish. The newest values win.
  function preview() {
    refreshRows();
    if (!pending) pending = requestAnimationFrame(runPreview);
  }

  /**
   * Settles a queued pass before the session ends: `run` to work it out now,
   * which is what commit needs so that the last slider move is in what it
   * keeps, or false to drop it — a pass after the session has gone would
   * have nothing to preview into.
   */
  function settlePreview(run) {
    if (!pending) return;
    cancelAnimationFrame(pending);
    pending = 0;
    if (run) runPreview();
  }

  /** The controls' defaults, in the same flat order the engine reads. */
  function defaults() {
    return spec.params.filter((p) => !p.heading).map((p) => (p.kind === "curve" ? p.value.slice() : p.value));
  }

  /** Builds the controls, starting at `flat` (or the defaults). */
  function build(flat) {
    paramsRoot.replaceChildren();
    controls = [];
    specs = [];
    // The channel rides at the end of the engine's list though it shows at
    // the top, so the adjustment's own values stop short of it.
    const end = flat ? flat.length - spec.params.filter((p) => p.channel).length : 0;
    let at = 0; // the next of the adjustment's own values
    let tail = end; // the next channel value
    for (const p of spec.params) {
      if (p.heading) {
        const h = document.createElement("div");
        h.className = "adjust-heading";
        h.textContent = p.heading;
        paramsRoot.appendChild(h);
        continue;
      }
      let control;
      if (p.channel) {
        const v = flat && Number.isFinite(flat[tail]) ? flat[tail] : p.value;
        tail += 1;
        control = createChoiceControl(p, v, preview);
      } else if (p.kind === "palette") {
        // The palette takes every remaining value: colours, three at a time.
        const initial = flat ? Array.from(flat.slice(at, end)) : [];
        at = end;
        control = createPaletteControl(initial, preview);
      } else if (p.kind === "curve") {
        // The curve takes every remaining value up to the channel: pairs of
        // points.
        const initial = flat && end - at >= 4 ? Array.from(flat.slice(at, end)) : p.value;
        at = end;
        control = createCurveControl(initial, preview);
      } else {
        const v = flat && Number.isFinite(flat[at]) ? flat[at] : p.value;
        at += 1;
        const make = p.kind === "choice" ? createChoiceControl : p.kind === "toggle" ? createToggleControl : createSliderControl;
        control = make(p, v, preview);
      }
      paramsRoot.appendChild(control.element);
      controls.push(control);
      specs.push(p);
    }
    refreshRows();
  }

  function finish(commit) {
    if (!dlg.open) return;
    settlePreview(commit);
    if (commit) np.commit_session();
    else np.cancel_session();
    dlg.close();
    spec = null;
    onChange();
  }

  /** Closes the dialog when the engine has already dropped the session —
   *  another layer was clicked while it was open, say. */
  function abandon() {
    if (!dlg.open) return;
    settlePreview(false);
    dlg.close();
    spec = null;
    onChange();
  }

  document.getElementById("adjust-ok").addEventListener("click", () => finish(true));
  document.getElementById("adjust-cancel").addEventListener("click", () => finish(false));
  document.getElementById("adjust-reset").addEventListener("click", () => {
    const d = defaults();
    controls.forEach((c, k) => c.reset(d[k]));
    preview();
  });
  dlg.addEventListener("cancel", (e) => {
    e.preventDefault();
    finish(false);
  });
  dlg.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    }
    e.stopPropagation();
  });

  function open(name) {
    const found = ADJUSTMENTS.find((a) => a.name === name);
    if (!found) return;
    // An adjustment is a pixel edit, so the layer has to be able to take one
    // before a dialog goes up over a preview that could never be committed.
    if (mayEdit && !mayEdit()) return;
    if (found.params.length === 0) {
      try {
        np.apply_adjustment(name);
      } catch (e) {
        onError(String(e));
      }
      onChange();
      return;
    }
    if (dlg.open) finish(false);
    try {
      np.begin_adjustment();
    } catch (e) {
      onError(String(e));
      return;
    }
    spec = found;
    title.textContent = found.label.replace(/…$/, "");
    build();
    dlg.show();
    preview();
    controls[0].focus();
  }

  /**
   * Opens the dialog on an adjustment layer, showing what it has now.
   * Returns false when there is nothing to show: not an adjustment layer,
   * or one without parameters (Invert, Desaturate).
   */
  function openLayer(index) {
    let name;
    try {
      name = np.layer_adjustment_name(index);
    } catch {
      return false;
    }
    const found = ADJUSTMENTS.find((a) => a.name === name);
    if (!found || found.params.length === 0) return false;
    if (dlg.open) finish(false);
    let flat;
    try {
      flat = np.layer_adjustment_params(index);
      np.begin_adjustment_layer(index);
    } catch (e) {
      onError(String(e));
      return true;
    }
    spec = found;
    title.textContent = found.label.replace(/…$/, "");
    build(flat);
    dlg.show();
    onChange();
    controls[0].focus();
    return true;
  }

  return { open, openLayer, abandon, isOpen: () => dlg.open, cancel: () => finish(false), commit: () => finish(true) };
}
