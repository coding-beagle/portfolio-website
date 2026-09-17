// The adjustment demos, all of them at once, for judging them.
//
// A tool's clip is judged by hovering it, recording it again and hovering it
// again — `demos/README.md` describes that loop. An adjustment's demo is not
// recorded, so there is nothing to retake; what is worth judging is the
// choice in its `demo` entry, and the question is always comparative. Is the
// Emboss sweep mud? Is Threshold's range wide enough to be worth sweeping at
// all? Hovering nineteen menu rows one at a time is a bad way to find out.
//
// So: `?demos=1` puts every one of them in a grid over the editor, running
// the same source the hover card runs, over the same document. Change a
// `demo` entry in `adjust.js`, reload, look at the sheet.
//
// Development-only, and asked for by hand: nothing here is fetched otherwise.

import { ADJUSTMENTS } from "./adjust.js";
import { demoTile } from "./adjusthelp.js";

/** Puts the sheet up. Returns a function that takes it down again. */
export function createDemoSheet() {
  const sheet = document.createElement("div");
  sheet.className = "demosheet";

  const bar = document.createElement("div");
  bar.className = "demosheet-bar";
  const title = document.createElement("span");
  title.textContent = `Adjustment demos (${ADJUSTMENTS.length})`;
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  bar.append(title, close);

  const grid = document.createElement("div");
  grid.className = "demosheet-grid";

  /** Every tile's `stop`, so closing the sheet takes them all off the loop. */
  const running = [];

  // One cycle start for the lot. Building nineteen demos takes long enough
  // that tiles left to start their own clocks end up scattered across the
  // loop, and demos at different points of their sweeps cannot be compared.
  const startAt = performance.now();

  for (const adjustment of ADJUSTMENTS) {
    const cell = document.createElement("figure");
    cell.className = "demosheet-cell";
    const caption = document.createElement("figcaption");
    const style = adjustment.demo?.style === "wipe" || !adjustment.demo ? "wipe" : "sweep";
    caption.innerHTML = `<b>${adjustment.label.replace(/…$/, "")}</b> <span>${style}</span>`;
    const tile = demoTile(adjustment.name, startAt);
    if (tile) {
      cell.appendChild(tile.canvas);
      running.push(tile.stop);
    } else {
      cell.appendChild(document.createTextNode("(no demo)"));
    }
    cell.appendChild(caption);
    grid.appendChild(cell);
  }

  sheet.append(bar, grid);
  document.body.appendChild(sheet);

  const stop = () => {
    for (const stopTile of running) stopTile();
    sheet.remove();
  };
  close.addEventListener("click", stop);
  return stop;
}
