import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faDisplay,
  faEye,
  faEyeSlash,
  faFolder,
  faMoon,
  faSun,
} from "@fortawesome/free-solid-svg-icons";
import { useTheme } from "../../../../themes/ThemeProvider";
import { MobileContext } from "../../../../contexts/MobileContext";
import { noSelect } from "../utilities/valueChangerElements/styles";
import { SUBDOMAIN_APPS, appHref, launchApp } from "../../../../subdomains";
import { lunaPalette } from "../utilities/desktopElements/luna";
import Wallpaper from "../utilities/desktopElements/Wallpaper";
import ShortcutArrow from "../utilities/desktopElements/ShortcutArrow";
import DesktopIcon, {
  DesktopIconStyles,
  ICON_HEIGHT,
  ICON_WIDTH,
} from "../utilities/desktopElements/DesktopIcon";
import LunaWindow, {
  LunaWindowStyles,
} from "../utilities/desktopElements/LunaWindow";
import Taskbar, { TASKBAR_HEIGHT } from "../utilities/desktopElements/Taskbar";
import StartMenu, {
  StartMenuStyles,
} from "../utilities/desktopElements/StartMenu";
import BalloonTip, {
  BalloonTipStyles,
} from "../utilities/desktopElements/BalloonTip";

const SCENES_FOLDER = "scenes";
const CHANGE_THEME = "changeTheme";
const SHOW_DESKTOP = "showDesktop";
const GRID_GAP = 6;
// Once the pointer crosses back over where the drag started, the band collapses
// to a line in that axis and Windows stopped drawing it — there is no area left
// to fill. Two pixels rather than zero so it blinks out cleanly instead of
// leaving a sliver of border behind.
const MARQUEE_MIN = 2;
const GRID_TOP = 16;
const GRID_LEFT = 16;
const CELL_WIDTH = ICON_WIDTH + GRID_GAP;
const CELL_HEIGHT = ICON_HEIGHT + GRID_GAP;
// A press has to travel this far before it counts as a drag rather than a click.
const DRAG_THRESHOLD = 4;
// A finger that lifts is followed by a mouse press in the same place, which is
// how a phone lets pages that only know about mice work at all. This is how
// long that echo is watched for.
const TOUCH_ECHO_MS = 700;

/** The point a press or a move is at, whether a mouse or a finger carried it. */
const pointOf = (event) =>
  event.touches?.[0] ?? event.changedTouches?.[0] ?? event;

// A phone's row stops at three even where a fourth would fit, because the sun
// and moon hangs in the top-right corner and the fourth icon lands on its face.
const MOBILE_COLUMNS = 3;

/** How many shortcuts fit across and down, once the taskbar is accounted for. */
const measureGrid = (mobile) => {
  const across = Math.max(
    1,
    Math.floor((window.innerWidth - GRID_LEFT + GRID_GAP) / CELL_WIDTH)
  );
  return {
    columns: mobile ? Math.min(MOBILE_COLUMNS, across) : across,
    rows: Math.max(
      1,
      Math.floor(
        (window.innerHeight - TASKBAR_HEIGHT - GRID_TOP + GRID_GAP) / CELL_HEIGHT
      )
    ),
  };
};

function useGridExtent(mobile) {
  const [extent, setExtent] = useState(() => measureGrid(mobile));
  useEffect(() => {
    const onResize = () => setExtent(measureGrid(mobile));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mobile]);
  return extent;
}

/**
 * Where a shortcut sits before anyone has moved it.
 *
 * Windows fills a column and then starts the next one, which is right on a
 * screen taller than it is wide. A phone is the other way round: a single
 * column runs off the bottom while the whole width goes unused, so there the
 * icons fill a row at a time instead.
 */
const homePosition = (index, extent, mobile) => {
  const column = mobile ? index % extent.columns : Math.floor(index / extent.rows);
  const row = mobile ? Math.floor(index / extent.columns) : index % extent.rows;
  return { x: GRID_LEFT + column * CELL_WIDTH, y: GRID_TOP + row * CELL_HEIGHT };
};

/** Dropped icons land on the grid, the way "Align to Grid" always did. */
const snapToGrid = (x, y, bottomInset) => {
  const column = Math.max(0, Math.round((x - GRID_LEFT) / CELL_WIDTH));
  const row = Math.max(0, Math.round((y - GRID_TOP) / CELL_HEIGHT));
  const maxRow = Math.max(
    0,
    Math.floor((window.innerHeight - bottomInset - GRID_TOP - ICON_HEIGHT) / CELL_HEIGHT)
  );
  const maxColumn = Math.max(
    0,
    Math.floor((window.innerWidth - GRID_LEFT - ICON_WIDTH) / CELL_WIDTH)
  );
  return {
    x: GRID_LEFT + Math.min(column, maxColumn) * CELL_WIDTH,
    y: GRID_TOP + Math.min(row, maxRow) * CELL_HEIGHT,
  };
};

/** Do two rectangles touch at all? Used by the marquee. */
const overlaps = (a, b) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** The marquee's two corners, in either drag direction, as a rectangle. */
const rectBetween = (from, to) => ({
  left: Math.min(from.x, to.x),
  right: Math.max(from.x, to.x),
  top: Math.min(from.y, to.y),
  bottom: Math.max(from.y, to.y),
});

/**
 * A Windows 7 desktop, as a scene.
 *
 * The shortcuts are the utilities that live on their own subdomains, plus a
 * folder holding every other scene — so this one doubles as the way around the
 * rest of them. Double-click opens, the way a desktop always has; the icon
 * itself explains the touch and keyboard equivalents.
 *
 * `onOpenScene` comes from the title page, which owns the scene registry. The
 * launcher is a prop so a test can watch it rather than navigate the runner.
 *
 * Every other scene nudges a first-time visitor by shaking the title. A title
 * jittering over a desktop read as a glitch rather than an invitation, so here
 * the same nudge arrives as XP always delivered one: a balloon out of the tray.
 */
export default function Desktop({
  sceneNames = [],
  currentSceneName = null,
  onOpenScene = () => {},
  onLaunch = launchApp,
  visibleUI = true,
  onToggleTheme = () => {},
  onToggleVisibleUI = () => {},
  showHint = false,
  onDismissHint = () => {},
}) {
  const { themeName } = useTheme();
  const mobile = useContext(MobileContext);
  const luna = lunaPalette(themeName);

  // A list, not one key: a marquee selects however many it covers, and dropping
  // that selection on release was why dragging a band appeared to do nothing.
  const [selected, setSelected] = useState([]);
  const [positions, setPositions] = useState({});
  const extent = useGridExtent(mobile);
  // The press in progress, and whether it has travelled far enough to be a drag.
  const iconDrag = useRef(null);
  const draggedRef = useRef(false);
  // When a finger last touched anything, so the mouse press it echoes can be
  // told apart from a real one.
  const lastTouch = useRef(0);
  const [startOpen, setStartOpen] = useState(false);
  const [folder, setFolder] = useState(null); // null | "open" | "minimized"
  const [marquee, setMarquee] = useState(null);
  const surface = useRef(null);
  const dragStart = useRef(null);

  // The page's own theme and hide-UI buttons are suppressed on this scene —
  // two floating circles over a desktop looked like something that had landed
  // on it — so the desktop offers the same two controls as programs.
  const shortcuts = [
    ...SUBDOMAIN_APPS,
    {
      key: SCENES_FOLDER,
      name: "Scenes",
      icon: faFolder,
      description: `${sceneNames.length} scenes`,
    },
    {
      key: CHANGE_THEME,
      name: "Change Theme",
      // The glyph is the theme being offered rather than the one in force, the
      // same way round as the page's own toggle.
      icon: themeName === "dark" ? faSun : faMoon,
      description: "Switch between light and dark",
      run: onToggleTheme,
    },
    {
      key: SHOW_DESKTOP,
      name: visibleUI ? "Show Desktop" : "Show Page",
      icon: visibleUI ? faEyeSlash : faEye,
      description: visibleUI
        ? "Hide the page's title and links"
        : "Bring the page's title and links back",
      run: onToggleVisibleUI,
    },
  ];

  const positionOf = (entry, index) =>
    positions[entry.key] ?? homePosition(index, extent, mobile);

  /**
   * Press, move, release on a shortcut. A press that never travels is left
   * alone so the icon's own click handling still selects and opens; one that
   * does is a move, and the click it ends with is swallowed by `consumeDrag`.
   */
  const grabHandlers = (entry, index) => ({
    start: (event) => {
      if (event.type === "touchstart") {
        lastTouch.current = Date.now();
      } else {
        // A finger that lifts is followed by a mouse press in the same place.
        // Letting that echo start a second gesture would clear the drag the
        // icon is about to swallow its click with, and the shortcut would open
        // under a finger that had only moved it.
        if (Date.now() - lastTouch.current < TOUCH_ECHO_MS) return;
        if (event.button !== 0) return;
      }
      const point = pointOf(event);

      // Dragging an icon that is part of a selection takes the whole selection
      // with it, which is what a selection is for. Dragging one that is not
      // replaces the selection with it first, the way Windows does.
      const group = selected.includes(entry.key) ? selected : [entry.key];
      if (!selected.includes(entry.key)) setSelected([entry.key]);

      // Where every icon in the group started, so they all move by one delta
      // and keep their arrangement rather than piling onto the cursor.
      const origins = {};
      shortcuts.forEach((other, otherIndex) => {
        if (group.includes(other.key)) origins[other.key] = positionOf(other, otherIndex);
      });

      iconDrag.current = {
        primary: entry.key,
        keys: group,
        origins,
        originX: point.clientX,
        originY: point.clientY,
      };
      draggedRef.current = false;
    },
    consumeDrag: () => {
      const dragged = draggedRef.current;
      draggedRef.current = false;
      return dragged;
    },
  });

  useEffect(() => {
    const move = (event) => {
      const active = iconDrag.current;
      if (!active) return;
      const point = pointOf(event);
      if (point.clientX === undefined) return;
      if (
        !draggedRef.current &&
        Math.hypot(point.clientX - active.originX, point.clientY - active.originY) <
          DRAG_THRESHOLD
      )
        return;
      draggedRef.current = true;
      // Once it is a drag the finger belongs to the icon; without this the page
      // rubber-bands under it and the browser sends a click afterwards anyway.
      if (event.cancelable) event.preventDefault();
      const dx = point.clientX - active.originX;
      const dy = point.clientY - active.originY;
      setPositions((prev) => {
        const next = { ...prev };
        active.keys.forEach((key) => {
          const from = active.origins[key];
          if (from) next[key] = { x: from.x + dx, y: from.y + dy };
        });
        return next;
      });
    };
    const end = (event) => {
      if (event?.type?.startsWith("touch")) lastTouch.current = Date.now();
      const active = iconDrag.current;
      iconDrag.current = null;
      if (!active || !draggedRef.current) return;
      setPositions((prev) => {
        const dropped = prev[active.primary];
        if (!dropped) return prev;
        // The icon under the cursor is the one that lands on a cell; the rest
        // shift by the same amount, so a group keeps its shape instead of every
        // icon snapping onto the same square.
        const landed = snapToGrid(dropped.x, dropped.y, TASKBAR_HEIGHT);
        const dx = landed.x - dropped.x;
        const dy = landed.y - dropped.y;
        const next = { ...prev };
        active.keys.forEach((key) => {
          const at = prev[key];
          if (at) next[key] = { x: at.x + dx, y: at.y + dy };
        });
        return next;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    // A phone sends no mouse event until the finger has already come back up,
    // which is far too late to drag anything with, so the same gesture is
    // followed in touch events as well.
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, [mobile]);

  const open = useCallback(
    (entry) => {
      setStartOpen(false);
      if (entry.run) {
        entry.run();
        return;
      }
      if (entry.key === SCENES_FOLDER) {
        setFolder("open");
        return;
      }
      onLaunch(entry);
    },
    [onLaunch]
  );

  /** Turning the computer off leaves the desktop, for a scene picked at random. */
  const shutDown = useCallback(() => {
    setStartOpen(false);
    const others = sceneNames.filter((name) => name !== currentSceneName);
    if (others.length === 0) return;
    onOpenScene(others[Math.floor(Math.random() * others.length)]);
  }, [sceneNames, currentSceneName, onOpenScene]);

  // --- Marquee selection -------------------------------------------------
  // Windows lets you rubber-band over the desktop to pick icons out. Only the
  // bare surface starts one; a drag that began on a shortcut or the chrome is
  // that control's business.
  const beginMarquee = (event) => {
    if (event.button !== 0) return;
    if (event.target.closest(".desktopIcon, [role='dialog'], [role='menu'], .startOrb, .taskbarButton"))
      return;
    setSelected([]);
    const bounds = surface.current.getBoundingClientRect();
    dragStart.current = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
  };

  useEffect(() => {
    const move = (event) => {
      if (!dragStart.current || !surface.current) return;
      const bounds = surface.current.getBoundingClientRect();
      setMarquee(
        rectBetween(dragStart.current, {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        })
      );
    };
    const end = () => {
      if (!dragStart.current) return;
      dragStart.current = null;
      // Commit what the band was covering. Without this the highlight only
      // lasted as long as the drag, so releasing looked like nothing happened.
      setSelected(marqueeSelectionRef.current);
      setMarquee(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
    };
  }, []);

  // Every shortcut's box is known from its position, so which ones a marquee
  // covers is geometry rather than a measurement of the DOM each frame.
  const marqueeSelection = marquee
    ? shortcuts
        .filter((entry, index) => {
          const { x, y } = positionOf(entry, index);
          return overlaps(marquee, {
            left: x,
            right: x + ICON_WIDTH,
            top: y,
            bottom: y + ICON_HEIGHT,
          });
        })
        .map((entry) => entry.key)
    : [];

  // The band is authoritative while it is being dragged; the committed
  // selection takes over the moment it is released.
  const marqueeSelectionRef = useRef([]);
  marqueeSelectionRef.current = marqueeSelection;

  const isSelected = (entry) =>
    (marquee ? marqueeSelection : selected).includes(entry.key);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") setSelected([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const windows =
    folder === null
      ? []
      : [
          {
            id: SCENES_FOLDER,
            title: "Scenes",
            icon: faFolder,
            minimized: folder === "minimized",
          },
        ];

  return (
    <div
      ref={surface}
      onMouseDown={beginMarquee}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
      }}
    >
      <Wallpaper />
      <DesktopIconStyles hoverColour={luna.hover} />
      <LunaWindowStyles />
      <StartMenuStyles />
      <BalloonTipStyles />

      <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
        {shortcuts.map((entry, index) => (
          <DesktopIcon
            key={entry.key}
            icon={entry.icon}
            label={entry.name}
            href={entry.url ? appHref(entry) : null}
            shortcut={Boolean(entry.url)}
            selected={isSelected(entry)}
            position={positionOf(entry, index)}
            onSelect={() => setSelected([entry.key])}
            onOpen={() => open(entry)}
            onGrab={grabHandlers(entry, index)}
          />
        ))}
      </div>

      {marquee &&
        marquee.right - marquee.left >= MARQUEE_MIN &&
        marquee.bottom - marquee.top >= MARQUEE_MIN && (
          <div
            className="desktopMarquee"
            style={{
              position: "absolute",
              left: marquee.left,
              top: marquee.top,
              width: marquee.right - marquee.left,
              height: marquee.bottom - marquee.top,
              background: luna.selection,
              border: `1px solid ${luna.selectionEdge}`,
              pointerEvents: "none",
              zIndex: 3,
            }}
          />
        )}

      {folder !== null && (
        <LunaWindow
          title="Scenes"
          icon={faFolder}
          minimized={folder === "minimized"}
          bottomInset={TASKBAR_HEIGHT}
          onClose={() => setFolder(null)}
          onMinimize={() => setFolder("minimized")}
          onFocus={() => setStartOpen(false)}
          zIndex={200}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fill, minmax(${mobile ? 84 : 96}px, 1fr))`,
              gap: 4,
            }}
          >
            {sceneNames.map((name) => {
              const current = name === currentSceneName;
              return (
                <button
                  key={name}
                  className="desktopIcon"
                  onDoubleClick={() => onOpenScene(name)}
                  onClick={(event) => {
                    if (event.detail === 0 || mobile) onOpenScene(name);
                  }}
                  title={current ? `${name} (current scene)` : name}
                  style={{
                    ...noSelect,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 5,
                    padding: "0.6em 0.2em",
                    borderRadius: 4,
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: "0.7rem",
                    color: luna.text,
                    background: current ? luna.selection : "transparent",
                    border: `1px solid ${current ? luna.selectionEdge : "transparent"}`,
                  }}
                >
                  {/* Every scene in here is a shortcut to somewhere else, and
                      Windows said so with a corner arrow. */}
                  <span style={{ position: "relative", display: "inline-flex" }}>
                    <FontAwesomeIcon
                      icon={faDisplay}
                      style={{ fontSize: "1.4rem", color: luna.frame }}
                    />
                    <ShortcutArrow size={11} />
                  </span>
                  <span
                    style={{ wordBreak: "break-word", textAlign: "center" }}
                  >
                    {name}
                  </span>
                </button>
              );
            })}
          </div>
        </LunaWindow>
      )}

      {startOpen && (
        <StartMenu
          entries={shortcuts}
          onLaunch={open}
          onShutDown={shutDown}
          onClose={() => setStartOpen(false)}
        />
      )}

      {/*
        The taskbar and windows have to clear the page's own furniture: the
        title sits at z-index 10 in this same stacking context and the icon row
        at 100. The site's corner buttons stay above everything at 9999.
      */}
      {/*
        The hint only makes sense while the title is actually on screen — with
        the page hidden there is nothing for it to point at.
      */}
      {showHint && visibleUI && (
        <BalloonTip
          title="Tip"
          bottomInset={TASKBAR_HEIGHT}
          onClose={onDismissHint}
        >
          Hey, do you know that you can change scenes by clicking the title
          button?
        </BalloonTip>
      )}

      <Taskbar
        startOpen={startOpen}
        onToggleStart={() => setStartOpen((prev) => !prev)}
        windows={windows}
        onWindowClick={() =>
          setFolder((prev) => (prev === "minimized" ? "open" : "minimized"))
        }
      />
    </div>
  );
}
