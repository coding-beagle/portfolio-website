// The adjustment dialog. Every adjustment is described as data — its engine
// name and its controls — and the dialog is built from that. Controls call
// `preview_adjustment` on every change, so the canvas shows the result live;
// OK commits it as one undo step and Cancel puts the pixels back.
//
// Most controls are sliders. Curves is the exception: a tone curve drawn by
// hand on a small graph, which hands the engine its points as a flat list.
//
// The same dialog edits an adjustment *layer*: `openLayer` opens it showing
// the layer's current settings, and the engine's session applies each change
// to the layer rather than to pixels. The dialog cannot tell the difference,
// which is the point.

export const ADJUSTMENTS = [
  {
    name: "brightness-contrast",
    label: "Brightness / Contrast…",
    shortcut: "",
    params: [
      { label: "Brightness", min: -100, max: 100, value: 0 },
      { label: "Contrast", min: -100, max: 100, value: 0 },
    ],
  },
  {
    name: "levels",
    label: "Levels…",
    shortcut: "Ctrl+L",
    params: [
      { label: "Black point", min: 0, max: 254, value: 0 },
      { label: "White point", min: 1, max: 255, value: 255 },
      { label: "Gamma", min: 0.1, max: 4, value: 1, step: 0.01 },
    ],
  },
  {
    name: "curves",
    label: "Curves…",
    shortcut: "Ctrl+M",
    params: [{ kind: "curve", label: "Curve", value: [0, 0, 255, 255] }],
  },
  {
    name: "hue-saturation",
    label: "Hue / Saturation…",
    shortcut: "Ctrl+U",
    params: [
      { label: "Hue", min: -180, max: 180, value: 0, unit: "°" },
      { label: "Saturation", min: -100, max: 100, value: 0 },
      { label: "Lightness", min: -100, max: 100, value: 0 },
    ],
  },
  {
    name: "color-balance",
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
  },
  { name: "posterize", label: "Posterize…", params: [{ label: "Levels", min: 2, max: 32, value: 4 }] },
  { name: "threshold", label: "Threshold…", params: [{ label: "Level", min: 0, max: 255, value: 128 }] },
  { name: "invert", label: "Invert", shortcut: "Ctrl+I", params: [] },
  { name: "desaturate", label: "Desaturate", shortcut: "Ctrl+Shift+U", params: [] },
];

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
    ctx.strokeStyle = "#e6e6e6";
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
  };
}

/**
 * Wires the adjustment dialog to the engine. Returns `open(name)`; the
 * parameterless adjustments apply straight away without a dialog.
 */
export function createAdjustDialog(np, { onChange, onError }) {
  const dlg = document.getElementById("dlg-adjust");
  const title = document.getElementById("adjust-title");
  const paramsRoot = document.getElementById("adjust-params");
  let spec = null;
  let controls = [];

  function values() {
    return new Float32Array(controls.flatMap((c) => c.values()));
  }

  function preview() {
    try {
      np.preview_adjustment(spec.name, values());
    } catch (e) {
      onError(String(e));
    }
    onChange();
  }

  /** The controls' defaults, in the same flat order the engine reads. */
  function defaults() {
    return spec.params.filter((p) => !p.heading).map((p) => (p.kind === "curve" ? p.value.slice() : p.value));
  }

  /** Builds the controls, starting at `flat` (or the defaults). */
  function build(flat) {
    paramsRoot.replaceChildren();
    controls = [];
    let at = 0;
    for (const p of spec.params) {
      if (p.heading) {
        const h = document.createElement("div");
        h.className = "adjust-heading";
        h.textContent = p.heading;
        paramsRoot.appendChild(h);
        continue;
      }
      let control;
      if (p.kind === "curve") {
        // The curve takes every remaining value: pairs of points.
        const initial = flat && flat.length - at >= 4 ? Array.from(flat.slice(at)) : p.value;
        at = flat ? flat.length : at;
        control = createCurveControl(initial, preview);
      } else {
        const v = flat && Number.isFinite(flat[at]) ? flat[at] : p.value;
        at += 1;
        control = createSliderControl(p, v, preview);
      }
      paramsRoot.appendChild(control.element);
      controls.push(control);
    }
  }

  function finish(commit) {
    if (!dlg.open) return;
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
