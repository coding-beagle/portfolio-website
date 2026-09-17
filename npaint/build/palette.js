// The palette panel: a set of colours to draw in, the way a pixel-art
// editor keeps one.
//
// The palette is the page's own — it is no more part of the document than
// the strip of recent colours is — so it lives here and in `localStorage`,
// and only crosses into the engine when it is asked to do something with
// it: Filter > Map to Palette hands the colours over as that adjustment's
// parameters (see `src/palette.rs`), and "From image" asks the engine which
// colours the picture is mostly made of.
//
// `.gpl` is the exchange format, because it is what GIMP, Aseprite,
// Krita and Inkscape all read and write, and it is three numbers and a name
// per line.
//
// Editing a palette is undoable, but *not* through the document's history:
// the two have nothing to do with each other, and an undo that sometimes
// meant the picture and sometimes the swatches would be worse than none. The
// panel keeps its own stack and its own two buttons.

import { toHex, parseHex } from "./colorpicker.js";

/**
 * The orders the found colours can be put in. The engine hands them over by
 * how much of the picture each covers; the rest is the page's own doing, and
 * the order chosen is the order they go into the palette in.
 */
const ORDERS = [
  { name: "By area", keys: null },
  // Greys have no hue to sort by, so they lead rather than landing among
  // the reds, which is where a hue of zero would put them.
  { name: "By hue", keys: (hex) => [neutral(hex) ? 0 : 1, neutral(hex) ? 0 : hueOf(hex), lightnessOf(hex)] },
  { name: "By lightness", keys: (hex) => [lightnessOf(hex), hueOf(hex)] },
  {
    name: "By hue, then light",
    keys: (hex) => [neutral(hex) ? 0 : 1, neutral(hex) ? 0 : Math.round(hueOf(hex) / HUE_BAND), lightnessOf(hex)],
  },
];

/** How wide a band of hue counts as one colour when the two are combined. */
const HUE_BAND = 30;
/** Below this much saturation a colour is a grey, whatever its hue says. */
const NEUTRAL_SATURATION = 0.12;

/** Whether a colour is a grey: one with no hue worth sorting by. */
function neutral(hex) {
  const [r, g, b] = (parseHex(hex) ?? [0, 0, 0]).map((v) => v / 255);
  const max = Math.max(r, g, b);
  return max === 0 || (max - Math.min(r, g, b)) / max < NEUTRAL_SATURATION;
}

/** Where a colour sits round the wheel, `0..360`; grey counts as red. */
function hueOf(hex) {
  const [r, g, b] = (parseHex(hex) ?? [0, 0, 0]).map((v) => v / 255);
  const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)];
  if (max === min) return 0;
  const span = max - min;
  const h = max === r ? (g - b) / span + (g < b ? 6 : 0) : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return Math.round(h * 60);
}

/** How light a colour is, `0..255`, by the usual weighting of the channels. */
function lightnessOf(hex) {
  const [r, g, b] = parseHex(hex) ?? [0, 0, 0];
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/** How many colours "From image" may be asked for, and what it asks by default. */
const FROM_IMAGE_MIN = 2;
const FROM_IMAGE_DEFAULT = 32;
/** How far apart the colours are held by default, of `MAX_SEPARATION`: far
 *  enough that a photograph's answers are colours rather than shades. */
const FROM_IMAGE_BIAS_DEFAULT = 50;
/** How many palette edits can be taken back. */
const UNDO_DEPTH = 30;
/** As many as `palette::MAX_COLORS` allows. */
const MAX_COLORS = 256;
/** Where the palette in hand is kept between visits. */
const STORE_KEY = "npaint.palette";

/**
 * The palettes offered out of the box: the ones a piece of pixel art is
 * most likely to be drawn in, plus the two that are not really palettes at
 * all but are what a photograph is usually reduced to.
 */
const BUILT_IN = [
  { name: "Black & white", colors: ["#000000", "#ffffff"] },
  {
    name: "Greys (8)",
    colors: ["#000000", "#242424", "#494949", "#6d6d6d", "#929292", "#b6b6b6", "#dbdbdb", "#ffffff"],
  },
  {
    name: "CGA (16)",
    colors: [
      "#000000", "#0000aa", "#00aa00", "#00aaaa", "#aa0000", "#aa00aa", "#aa5500", "#aaaaaa",
      "#555555", "#5555ff", "#55ff55", "#55ffff", "#ff5555", "#ff55ff", "#ffff55", "#ffffff",
    ],
  },
  {
    name: "PICO-8 (16)",
    colors: [
      "#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
      "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa",
    ],
  },
  {
    name: "DawnBringer (16)",
    colors: [
      "#140c1c", "#442434", "#30346d", "#4e4a4e", "#854c30", "#346524", "#d04648", "#757161",
      "#597dce", "#d27d2c", "#8595a1", "#6daa2c", "#d2aa99", "#6dc2ca", "#dad45e", "#deeed6",
    ],
  },
  {
    name: "Sweetie (16)",
    colors: [
      "#1a1c2c", "#5d275d", "#b13e53", "#ef7d57", "#ffcd75", "#a7f070", "#38b764", "#257179",
      "#29366f", "#3b5dc9", "#41a6f6", "#73eff7", "#f4f4f4", "#94b0c2", "#566c86", "#333c57",
    ],
  },
];

/** The palette the page has in hand. `adjust.js` reads it for the filter. */
let current = { name: BUILT_IN[3].name, colors: [...BUILT_IN[3].colors] };
/** How many colours "From image" is set to ask for, how distinct they have
 *  to be (`0..=100`), and in what order they are shown. */
let fromImageColors = FROM_IMAGE_DEFAULT;
let fromImageBias = FROM_IMAGE_BIAS_DEFAULT;
let fromImageOrder = 0;

/** The colours in hand, as `#rrggbb`. */
export function currentPalette() {
  return [...current.colors];
}

/** The same as the flat `[r, g, b]` list the engine's palette takes. */
export function currentPaletteFlat() {
  return current.colors.flatMap((hex) => parseHex(hex) ?? [0, 0, 0]);
}

/** A `.gpl` file's colours, and its name if it says one. */
export function parseGpl(text) {
  const colors = [];
  let name = "";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^GIMP Palette$/i.test(trimmed)) continue;
    const named = trimmed.match(/^Name:\s*(.+)$/i);
    if (named) {
      name = named[1].trim();
      continue;
    }
    // A file that is only a list of hexes is a palette too, and people do
    // pass those around — so a `#` line is a colour where it reads as one
    // and a comment where it does not.
    const token = trimmed.split(/\s+/)[0];
    const hex = token.startsWith("#") ? parseHex(token) : null;
    if (hex) {
      colors.push(toHex(...hex));
      continue;
    }
    if (/^(Columns:|#)/i.test(trimmed)) continue;
    const numbers = trimmed.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/);
    if (numbers) {
      const [r, g, b] = numbers.slice(1, 4).map((n) => Math.min(255, Number(n)));
      colors.push(toHex(r, g, b));
    }
  }
  return { name, colors: colors.slice(0, MAX_COLORS) };
}

/** The palette as a `.gpl` file. */
export function toGpl(palette) {
  const lines = ["GIMP Palette", `Name: ${palette.name || "NPaint"}`, "Columns: 8", "#"];
  for (const hex of palette.colors) {
    const [r, g, b] = parseHex(hex) ?? [0, 0, 0];
    const pad = (n) => String(n).padStart(3, " ");
    lines.push(`${pad(r)} ${pad(g)} ${pad(b)}\t${hex}`);
  }
  return lines.join("\n") + "\n";
}

/** A typed number of colours, held to what a palette can hold. */
function clampColors(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return FROM_IMAGE_DEFAULT;
  return Math.min(MAX_COLORS, Math.max(FROM_IMAGE_MIN, n));
}

function store() {
  try {
    const found = { fromImageColors, fromImageBias, fromImageOrder };
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...current, ...found }));
  } catch {
    // No storage: this session has it, later ones will not.
  }
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
    if (saved && Array.isArray(saved.colors) && saved.colors.length) {
      current = { name: String(saved.name ?? "Palette"), colors: saved.colors.filter(parseHex).slice(0, MAX_COLORS) };
    }
    fromImageColors = clampColors(saved?.fromImageColors);
    if (ORDERS[saved?.fromImageOrder]) fromImageOrder = saved.fromImageOrder;
    const bias = Math.round(Number(saved?.fromImageBias));
    if (Number.isFinite(bias)) fromImageBias = Math.min(100, Math.max(0, bias));
  } catch {
    // The default palette stands.
  }
}

/**
 * Wires the palette panel. The page passes in what only it can do: setting
 * the swatches, opening the colour picker, asking the engine for the
 * picture's colours, saving a file and saying something in the status bar.
 */
export function createPalettePanel({ setForeground, setBackground, foreground, pickColor, imagePalette, download, message }) {
  const $ = (id) => document.getElementById(id);
  const grid = $("palette-grid");
  const presets = $("palette-preset");
  const fileInput = $("palette-input");
  const countField = $("palette-colors");
  let selected = 0;
  // Palettes as they were before each edit, newest last, and how far back
  // through them the panel has been taken.
  let past = [];
  let future = [];

  restore();

  countField.min = String(FROM_IMAGE_MIN);
  countField.max = String(MAX_COLORS);
  countField.value = String(fromImageColors);
  // Read on the way out as well as on every keystroke, so a number typed
  // and left is the one "From image" is asked for.
  const readCount = ({ show } = {}) => {
    fromImageColors = clampColors(countField.value);
    if (show) countField.value = String(fromImageColors);
    store();
  };
  countField.addEventListener("input", () => readCount());
  countField.addEventListener("change", () => readCount({ show: true }));

  for (const palette of BUILT_IN) {
    const option = document.createElement("option");
    option.value = option.textContent = palette.name;
    presets.appendChild(option);
  }

  function draw() {
    grid.replaceChildren();
    current.colors.forEach((hex, i) => {
      const swatch = document.createElement("button");
      swatch.className = "palette-swatch" + (i === selected ? " palette-on" : "");
      swatch.style.setProperty("--swatch", hex);
      swatch.title = `${hex} — click to paint with it, Shift-click for the background, double-click to change it`;
      swatch.addEventListener("click", (e) => {
        selected = i;
        if (e.shiftKey) setBackground(hex);
        else setForeground(hex);
        draw();
      });
      swatch.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        selected = i;
        setBackground(hex);
        draw();
      });
      swatch.addEventListener("dblclick", () => {
        selected = i;
        pickColor(swatch, hex, (picked) => {
          edit(() => {
            current.colors[i] = picked;
            current.name = named(current.name);
          });
        });
      });
      grid.appendChild(swatch);
    });
    presets.value = BUILT_IN.some((p) => p.name === current.name) ? current.name : "";
    $("palette-remove").disabled = current.colors.length <= 1;
    const count = current.colors.length;
    $("palette-count").textContent = `${count} colour${count === 1 ? "" : "s"}`;
    $("palette-undo").disabled = past.length === 0;
    $("palette-redo").disabled = future.length === 0;
  }

  /** A built-in palette that has been edited is no longer that palette. */
  function named(name) {
    return BUILT_IN.some((p) => p.name === name) ? `${name} (edited)` : name;
  }

  /** The palette as it is now, to put back on the undo stack. */
  const copy = () => ({ name: current.name, colors: [...current.colors] });

  /**
   * Records what the palette was before an edit and shows what it is now.
   * Every route that changes the colours goes through here, which is what
   * makes the panel's Undo mean anything.
   */
  function changed() {
    store();
    draw();
  }

  function edit(change) {
    const before = copy();
    change();
    past.push(before);
    if (past.length > UNDO_DEPTH) past.shift();
    future = [];
    changed();
  }

  function step(from, to) {
    if (from.length === 0) return;
    to.push(copy());
    const back = from.pop();
    current = back;
    selected = Math.min(selected, current.colors.length - 1);
    changed();
  }

  function use(palette) {
    current = { name: palette.name || "Palette", colors: palette.colors.slice(0, MAX_COLORS) };
    selected = 0;
  }

  presets.addEventListener("change", () => {
    const found = BUILT_IN.find((p) => p.name === presets.value);
    if (found) edit(() => use({ name: found.name, colors: [...found.colors] }));
  });

  $("palette-undo").addEventListener("click", () => step(past, future));
  $("palette-redo").addEventListener("click", () => step(future, past));

  $("palette-add").addEventListener("click", () => {
    if (current.colors.length >= MAX_COLORS) return message(`A palette holds at most ${MAX_COLORS} colours.`);
    const hex = foreground();
    if (current.colors.includes(hex)) {
      selected = current.colors.indexOf(hex);
      return draw();
    }
    edit(() => {
      current.colors.push(hex);
      current.name = named(current.name);
      selected = current.colors.length - 1;
    });
  });

  $("palette-remove").addEventListener("click", () => {
    if (current.colors.length <= 1) return;
    edit(() => {
      current.colors.splice(selected, 1);
      current.name = named(current.name);
      selected = Math.min(selected, current.colors.length - 1);
    });
  });

  // ---- From image ----------------------------------------------------------
  //
  // The engine says which colours the picture is mostly made of; the dialog
  // shows them and the user says which of those are wanted, and whether they
  // join the palette or become it. Nothing changes until one of those two
  // buttons is pressed, so looking is free.

  const dialog = $("dlg-from-image");
  const order = $("from-image-order");
  const bias = $("from-image-bias");
  const found = { colors: [], chosen: new Set() };

  ORDERS.forEach((row, i) => {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = row.name;
    order.appendChild(option);
  });
  order.value = String(fromImageOrder);
  order.addEventListener("change", () => {
    fromImageOrder = Number(order.value);
    store();
    sortFound();
    drawFound();
  });

  /** Puts the found colours in the chosen order, keeping which are chosen. */
  function sortFound() {
    const chosen = new Set(chosenColors());
    const keys = ORDERS[fromImageOrder]?.keys;
    if (keys) {
      const ranked = found.colors.map((hex) => [keys(hex), hex]);
      ranked.sort(([a, ahex], [b, bhex]) => {
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
        return ahex.localeCompare(bhex);
      });
      found.colors = ranked.map(([, hex]) => hex);
    }
    found.chosen = new Set(found.colors.map((hex, i) => (chosen.has(hex) ? i : -1)).filter((i) => i >= 0));
  }

  bias.value = String(fromImageBias);
  const showBias = () => ($("from-image-bias-out").value = `${bias.value}%`);
  showBias();
  // Dragging only moves the readout: every search recomposites the picture,
  // so the colours are looked for again when the slider is let go.
  bias.addEventListener("input", showBias);
  bias.addEventListener("change", () => {
    showBias();
    fromImageBias = Number(bias.value);
    store();
    findColors();
  });

  /** Asks the engine again and shows what came back, all of it chosen. */
  function findColors() {
    readCount({ show: true });
    fromImageBias = Number(bias.value);
    const flat = Array.from(imagePalette(fromImageColors, fromImageBias / 100));
    found.colors = [];
    for (let i = 0; i + 2 < flat.length; i += 3) found.colors.push(toHex(flat[i], flat[i + 1], flat[i + 2]));
    found.chosen = new Set(found.colors.keys());
    sortFound();
    drawFound();
  }

  function drawFound() {
    const foundGrid = $("from-image-grid");
    foundGrid.replaceChildren();
    found.colors.forEach((hex, i) => {
      const swatch = document.createElement("button");
      swatch.type = "button";
      const have = current.colors.includes(hex);
      swatch.className =
        "from-image-swatch" + (found.chosen.has(i) ? " from-image-on" : "") + (have ? " from-image-have" : "");
      swatch.style.setProperty("--swatch", hex);
      // A colour the palette has already says so, since adding it would do
      // nothing.
      const already = have ? " — in the palette already" : "";
      swatch.title = `${hex}${already}. Click to leave it out or take it back.`;
      swatch.addEventListener("click", () => {
        if (found.chosen.has(i)) found.chosen.delete(i);
        else found.chosen.add(i);
        drawFound();
      });
      foundGrid.appendChild(swatch);
    });
    const chosen = found.chosen.size;
    // Fewer than were asked for means the picture had no more to give —
    // which, with the slider wound up, is usually the slider's doing.
    const short = found.colors.length < fromImageColors ? (fromImageBias > 0 ? `, this far apart` : `, which is all the picture has`) : "";
    const note = found.colors.length
      ? `${found.colors.length} colour${found.colors.length === 1 ? "" : "s"} found${short}. ${chosen} chosen.`
      : "There is nothing in the picture to take a palette from.";
    $("from-image-note").textContent = note;
    $("from-image-add").disabled = chosen === 0;
    $("from-image-replace").disabled = chosen === 0;
  }

  /** The chosen colours, in the order the picture put them in. */
  const chosenColors = () => found.colors.filter((_, i) => found.chosen.has(i));

  function takeColors(replace) {
    const colors = chosenColors();
    if (!colors.length) return;
    if (replace) {
      edit(() => use({ name: "From image", colors }));
      message(`Palette taken from the picture: ${colors.length} colour${colors.length === 1 ? "" : "s"}.`);
    } else {
      const added = colors.filter((hex) => !current.colors.includes(hex)).slice(0, MAX_COLORS - current.colors.length);
      if (!added.length) return message("Every colour chosen is in the palette already.");
      edit(() => {
        current.colors.push(...added);
        current.name = named(current.name);
        selected = current.colors.length - 1;
      });
      const missed = colors.length - added.length;
      const already = missed ? `; ${missed} ${missed === 1 ? "was" : "were"} there already` : "";
      message(`Added ${added.length} colour${added.length === 1 ? "" : "s"} from the picture${already}.`);
    }
    dialog.close();
  }

  $("palette-from-image").addEventListener("click", () => {
    findColors();
    dialog.showModal();
  });
  $("from-image-find").addEventListener("click", findColors);
  $("from-image-all").addEventListener("click", () => {
    found.chosen = new Set(found.colors.keys());
    drawFound();
  });
  $("from-image-none").addEventListener("click", () => {
    found.chosen.clear();
    drawFound();
  });
  $("from-image-cancel").addEventListener("click", () => dialog.close());
  $("from-image-replace").addEventListener("click", () => takeColors(true));
  $("from-image-form").addEventListener("submit", (e) => {
    e.preventDefault();
    takeColors(false);
  });

  $("palette-load").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    const parsed = parseGpl(await file.text());
    if (!parsed.colors.length) return message(`No colours found in ${file.name}.`);
    edit(() => use({ name: parsed.name || file.name.replace(/\.[^.]+$/, ""), colors: parsed.colors }));
    const loaded = parsed.colors.length;
    message(`Loaded ${loaded} colour${loaded === 1 ? "" : "s"} from ${file.name}.`);
  });

  $("palette-save").addEventListener("click", () => {
    const name = window.prompt("Save palette as", `${current.name.replace(/\s+/g, "-").toLowerCase()}.gpl`);
    if (name === null) return;
    const file = name.trim() || "palette.gpl";
    download(new Blob([toGpl(current)], { type: "text/plain" }), file.endsWith(".gpl") ? file : `${file}.gpl`);
  });

  draw();
  return { refresh: draw, undo: () => step(past, future), redo: () => step(future, past) };
}
