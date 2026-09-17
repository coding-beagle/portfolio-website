// The command palette: every menu item, flattened into one searchable list.
//
// The menu definitions are the only description of what NPaint can do, so the
// palette is built from them rather than from a list of its own. Nothing has
// to be kept in step: a new menu item is in the palette the moment it exists,
// with its shortcut, which is what makes the palette the place to go looking
// for the shortcuts that are otherwise spread over seven menus.
//
// `label`, `enabled` and `checked` are evaluated when the palette opens, the
// same contract the menus have.

const PATH_SEP = " › ";

/** Walks the menu tree into flat commands, deepest labels last in `path`. */
function flatten(menus) {
  const out = [];
  const walk = (items, path) => {
    for (const item of items) {
      if (item.sep) continue;
      const label = typeof item.label === "function" ? item.label() : item.label;
      if (item.submenu) {
        walk(item.submenu, [...path, label]);
        continue;
      }
      const prefix = path.length ? path.join(PATH_SEP) + PATH_SEP : "";
      out.push({
        text: prefix + label,
        leafStart: prefix.length,
        shortcut: item.shortcut || "",
        enabled: item.enabled ? item.enabled() : true,
        checked: Boolean(item.checked && item.checked()),
        action: item.action,
      });
    }
  };
  for (const menu of menus) walk(menu.items, [menu.title]);
  return out;
}

/**
 * Finds `query` in `text` as a subsequence, tightened towards the end of the
 * match: a forward pass takes the earliest character each time, then a
 * backward pass from where that ended takes the latest, which pulls the
 * match into the closest run available. Returns the matched positions, or
 * null if the characters are not all there in order.
 */
function matchPositions(lower, query) {
  const positions = new Array(query.length);
  let at = 0;
  for (let qi = 0; qi < query.length; qi++) {
    const found = lower.indexOf(query[qi], at);
    if (found < 0) return null;
    positions[qi] = found;
    at = found + 1;
  }
  let end = positions[positions.length - 1];
  for (let qi = query.length - 1; qi >= 0; qi--) {
    const found = lower.lastIndexOf(query[qi], end);
    positions[qi] = found;
    end = found - 1;
  }
  return positions;
}

const isWordChar = (ch) => /[a-z0-9]/.test(ch);

/** How well a set of matched positions reads: runs and word starts win. */
function score(lower, positions, leafStart) {
  let total = 0;
  for (let k = 0; k < positions.length; k++) {
    const p = positions[k];
    total += 1;
    if (k > 0 && p === positions[k - 1] + 1) total += 8;
    if (p === 0 || !isWordChar(lower[p - 1])) total += 10;
    if (p >= leafStart) total += 6; // the command's own name beats its path
  }
  // A match that starts early, in a short label, is the more likely one.
  return total - positions[0] * 0.2 - lower.length * 0.05;
}

/**
 * The commands `query` finds, best first; every command when it is empty.
 *
 * A command's own name is tried before its whole path, so typing "lay" finds
 * "Layer › New Layer" by its second word rather than settling for the "Lay"
 * that opens the menu title.
 */
function search(commands, query) {
  if (!query) return commands.map((command) => ({ command, positions: [] }));
  const found = [];
  for (const command of commands) {
    const lower = command.text.toLowerCase();
    const leafStart = command.leafStart;
    let positions = matchPositions(lower.slice(leafStart), query);
    if (positions) positions = positions.map((p) => p + leafStart);
    else positions = matchPositions(lower, query);
    if (positions) found.push({ command, positions, rank: score(lower, positions, leafStart) });
  }
  found.sort((a, b) => b.rank - a.rank);
  return found;
}

/** Writes `text` into `parent`, with the matched characters marked. */
function appendHighlighted(parent, text, positions, from, to) {
  let at = from;
  for (const p of positions) {
    if (p < from || p >= to) continue;
    if (p > at) parent.appendChild(document.createTextNode(text.slice(at, p)));
    const mark = document.createElement("mark");
    mark.textContent = text[p];
    parent.appendChild(mark);
    at = p + 1;
  }
  if (at < to) parent.appendChild(document.createTextNode(text.slice(at, to)));
}

/**
 * Wires up the palette. `menus` is called each time it opens, so the list is
 * as current as the menu bar's own.
 */
export function createCommandPalette({ dialog, input, list, menus }) {
  let commandList = [];
  let results = [];
  let selected = 0;

  const rowOf = (i) => list.children[i];

  function render() {
    list.replaceChildren();
    if (!results.length) {
      const none = document.createElement("div");
      none.className = "command-none";
      none.textContent = "No matching command";
      list.appendChild(none);
      return;
    }
    for (const { command, positions } of results) {
      const row = document.createElement("div");
      row.className = "command-row";
      if (!command.enabled) row.classList.add("disabled");
      if (command.checked) row.classList.add("checked");
      if (command.leafStart) {
        const path = document.createElement("span");
        path.className = "command-path";
        appendHighlighted(path, command.text, positions, 0, command.leafStart);
        row.appendChild(path);
      }
      const label = document.createElement("span");
      label.className = "command-label";
      appendHighlighted(label, command.text, positions, command.leafStart, command.text.length);
      row.appendChild(label);
      if (command.shortcut) {
        const shortcut = document.createElement("span");
        shortcut.className = "command-shortcut";
        shortcut.textContent = command.shortcut;
        row.appendChild(shortcut);
      }
      list.appendChild(row);
    }
    highlight();
  }

  function highlight() {
    for (let i = 0; i < results.length; i++) rowOf(i).classList.toggle("active", i === selected);
    if (results[selected]) rowOf(selected).scrollIntoView({ block: "nearest" });
  }

  /** The next runnable row in `step`'s direction; disabled rows are passed
   *  over rather than hidden, so a command still shows why it is not there. */
  function move(step) {
    for (let i = selected + step; i >= 0 && i < results.length; i += step) {
      if (results[i].command.enabled) {
        selected = i;
        highlight();
        return;
      }
    }
  }

  /** The first runnable row from either end, or -1 when none of them are —
   *  a list of only greyed-out commands highlights nothing. */
  function edgeRunnable(fromEnd) {
    const order = fromEnd ? [...results.keys()].reverse() : results.keys();
    for (const i of order) if (results[i].command.enabled) return i;
    return -1;
  }

  function refilter() {
    // Spaces separate words in the query without having to be in the label,
    // so "adj lev" finds "Image › Adjustments › Levels".
    results = search(commandList, input.value.toLowerCase().replace(/\s+/g, ""));
    selected = edgeRunnable(false);
    render();
  }

  function run(index) {
    const hit = results[index];
    if (!hit || !hit.command.enabled) return;
    dialog.close();
    hit.command.action();
  }

  input.addEventListener("input", refilter);
  input.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowDown":
        move(1);
        break;
      case "ArrowUp":
        move(-1);
        break;
      case "Home":
      case "End":
        selected = edgeRunnable(e.key === "End");
        highlight();
        break;
      case "Enter":
        run(selected);
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  list.addEventListener("click", (e) => {
    const row = e.target.closest(".command-row");
    if (row) run([...list.children].indexOf(row));
  });
  list.addEventListener("mousemove", (e) => {
    const row = e.target.closest(".command-row");
    if (!row) return;
    const i = [...list.children].indexOf(row);
    if (i !== selected && results[i].command.enabled) {
      selected = i;
      highlight();
    }
  });

  return {
    open() {
      if (dialog.open) return;
      commandList = flatten(menus());
      input.value = "";
      refilter();
      dialog.showModal();
      input.focus();
    },
  };
}
