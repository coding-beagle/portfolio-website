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

/** How many colours "From image" may be asked for, and what it asks by default. */
const FROM_IMAGE_CHOICES = [8, 16, 24, 32, 64, 128, 256];
const FROM_IMAGE_DEFAULT = 32;
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
/** How many colours "From image" is set to ask for. */
let fromImageColors = FROM_IMAGE_DEFAULT;

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

function store() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...current, fromImageColors }));
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
    if (FROM_IMAGE_CHOICES.includes(saved?.fromImageColors)) fromImageColors = saved.fromImageColors;
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
  const countChoice = $("palette-colors");
  let selected = 0;
  // Palettes as they were before each edit, newest last, and how far back
  // through them the panel has been taken.
  let past = [];
  let future = [];

  restore();

  for (const n of FROM_IMAGE_CHOICES) {
    const option = document.createElement("option");
    option.value = String(n);
    option.textContent = `${n} colours`;
    countChoice.appendChild(option);
  }
  countChoice.value = String(fromImageColors);
  countChoice.addEventListener("change", () => {
    fromImageColors = Number(countChoice.value);
    store();
  });

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

  $("palette-from-image").addEventListener("click", () => {
    const flat = Array.from(imagePalette(fromImageColors));
    if (flat.length < 3) return message("There is nothing in the picture to take a palette from.");
    const colors = [];
    for (let i = 0; i + 2 < flat.length; i += 3) colors.push(toHex(flat[i], flat[i + 1], flat[i + 2]));
    edit(() => use({ name: "From image", colors }));
    // Fewer than were asked for means the picture had no more to give.
    const short = colors.length < fromImageColors ? ", which is all the picture has" : "";
    const count = `${colors.length} colour${colors.length === 1 ? "" : "s"}`;
    message(`Palette taken from the picture: ${count}, most used first${short}.`);
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
