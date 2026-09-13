// The adjustment dialog. Every adjustment is described as data — its engine
// name and its sliders — and the dialog is built from that. Sliders call
// `preview_adjustment` on every input, so the canvas shows the result live;
// OK commits it as one undo step and Cancel puts the pixels back.

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
    name: "levels",
    label: "Levels…",
    shortcut: "Ctrl+L",
    params: [
      { label: "Black point", min: 0, max: 254, value: 0 },
      { label: "White point", min: 1, max: 255, value: 255 },
      { label: "Gamma", min: 0.1, max: 4, value: 1, step: 0.01 },
    ],
  },
  { name: "posterize", label: "Posterize…", params: [{ label: "Levels", min: 2, max: 32, value: 4 }] },
  { name: "threshold", label: "Threshold…", params: [{ label: "Level", min: 0, max: 255, value: 128 }] },
  { name: "invert", label: "Invert", shortcut: "Ctrl+I", params: [] },
  { name: "desaturate", label: "Desaturate", shortcut: "Ctrl+Shift+U", params: [] },
];

/**
 * Wires the adjustment dialog to the engine. Returns `open(name)`; the
 * parameterless adjustments apply straight away without a dialog.
 */
export function createAdjustDialog(np, { onChange, onError }) {
  const dlg = document.getElementById("dlg-adjust");
  const title = document.getElementById("adjust-title");
  const paramsRoot = document.getElementById("adjust-params");
  let spec = null;
  let inputs = [];

  function values() {
    return new Float32Array(inputs.map((i) => Number(i.value)));
  }

  function preview() {
    try {
      np.preview_adjustment(spec.name, values());
    } catch (e) {
      onError(String(e));
    }
    onChange();
  }

  function build() {
    paramsRoot.replaceChildren();
    inputs = [];
    for (const p of spec.params) {
      const row = document.createElement("div");
      row.className = "adjust-row";
      const label = document.createElement("label");
      label.textContent = p.label;
      const range = document.createElement("input");
      range.type = "range";
      range.min = p.min;
      range.max = p.max;
      range.step = p.step || 1;
      range.value = p.value;
      const out = document.createElement("output");
      const show = () => (out.value = `${range.value}${p.unit || ""}`);
      range.addEventListener("input", () => {
        show();
        preview();
      });
      show();
      row.append(label, range, out);
      paramsRoot.appendChild(row);
      inputs.push(range);
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

  document.getElementById("adjust-ok").addEventListener("click", () => finish(true));
  document.getElementById("adjust-cancel").addEventListener("click", () => finish(false));
  document.getElementById("adjust-reset").addEventListener("click", () => {
    inputs.forEach((i, k) => {
      i.value = spec.params[k].value;
      i.dispatchEvent(new Event("input"));
    });
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
    inputs[0].focus();
  }

  return { open, isOpen: () => dlg.open, cancel: () => finish(false), commit: () => finish(true) };
}
