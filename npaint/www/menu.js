// A menu component: the menu bar's drop-downs and right-click context menus
// are the same popup, built from the same item shape.
//
// An item is { label, shortcut?, action, enabled?, checked?, submenu? } or
// { sep: true }. `enabled` and `checked` are functions evaluated when the
// menu opens, so a menu built once always shows the current state.

let openPopup = null; // the root popup element currently showing
let openBarButton = null; // the menu-bar title it belongs to, if any

const host = () => document.getElementById("menu-layer");

/** Closes any open menu. */
export function closeMenus() {
  if (openPopup) {
    openPopup.remove();
    openPopup = null;
  }
  if (openBarButton) {
    openBarButton.classList.remove("open");
    openBarButton = null;
  }
  host().hidden = true;
  host().replaceChildren();
}

function buildPopup(items) {
  const popup = document.createElement("div");
  popup.className = "popup-menu";
  for (const item of items) {
    if (item.sep) {
      const sep = document.createElement("div");
      sep.className = "menu-sep";
      popup.appendChild(sep);
      continue;
    }
    const row = document.createElement("div");
    row.className = "menu-item";
    const enabled = item.enabled ? item.enabled() : true;
    if (!enabled) row.classList.add("disabled");
    if (item.checked && item.checked()) row.classList.add("checked");
    const label = document.createElement("span");
    label.textContent = item.label;
    row.appendChild(label);
    if (item.submenu) {
      row.classList.add("has-submenu");
      const arrow = document.createElement("span");
      arrow.className = "arrow";
      arrow.textContent = "▸";
      row.appendChild(arrow);
      let sub = null;
      row.addEventListener("mouseenter", () => {
        closeSiblingsOf(popup);
        sub = buildPopup(item.submenu);
        sub.classList.add("submenu");
        popup._child = sub;
        host().appendChild(sub);
        const r = row.getBoundingClientRect();
        place(sub, r.right - 2, r.top - 5);
      });
    } else {
      if (item.shortcut) {
        const sc = document.createElement("span");
        sc.className = "shortcut";
        sc.textContent = item.shortcut;
        row.appendChild(sc);
      }
      row.addEventListener("mouseenter", () => closeSiblingsOf(popup));
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!enabled) return;
        closeMenus();
        item.action();
      });
    }
    popup.appendChild(row);
  }
  return popup;
}

function closeSiblingsOf(popup) {
  if (popup._child) {
    closeSiblingsOf(popup._child);
    popup._child.remove();
    popup._child = null;
  }
}

/** Positions a popup at (x, y), nudged back on-screen if it would overflow. */
function place(el, x, y) {
  el.style.left = "0px";
  el.style.top = "0px";
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const maxX = window.innerWidth - w - 4;
  const maxY = window.innerHeight - h - 4;
  el.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
  el.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
}

/** Shows `items` as a context menu at a screen position. */
export function showContextMenu(x, y, items) {
  closeMenus();
  const popup = buildPopup(items);
  host().hidden = false;
  host().appendChild(popup);
  place(popup, x, y);
  openPopup = popup;
}

function openBarMenu(button, items) {
  closeMenus();
  const popup = buildPopup(items);
  host().hidden = false;
  host().appendChild(popup);
  const r = button.getBoundingClientRect();
  place(popup, r.left, r.bottom + 2);
  openPopup = popup;
  openBarButton = button;
  button.classList.add("open");
}

/**
 * Builds a menu bar into `container` from [{ title, items }]. Clicking a
 * title opens it; hovering another title while one is open switches, the way
 * every desktop menu bar works.
 */
export function createMenuBar(container, menus) {
  for (const menu of menus) {
    const button = document.createElement("button");
    button.className = "menu-title";
    button.textContent = menu.title;
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      if (openBarButton === button) closeMenus();
      else openBarMenu(button, menu.items);
    });
    button.addEventListener("mouseenter", () => {
      if (openBarButton && openBarButton !== button) openBarMenu(button, menu.items);
    });
    container.appendChild(button);
  }
}

// The host layer sits over everything; anything else that is clicked closes
// the menu. Escape does too.
window.addEventListener("pointerdown", (e) => {
  if (openPopup && !host().contains(e.target) && !(openBarButton && openBarButton.contains(e.target))) {
    closeMenus();
  }
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && openPopup) {
    closeMenus();
    e.stopPropagation();
  }
}, true);
window.addEventListener("blur", closeMenus);
