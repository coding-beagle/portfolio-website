import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faDisplay,
  faEye,
  faEyeSlash,
  faFolder,
  faPalette,
} from "@fortawesome/free-solid-svg-icons";
import { useTheme } from "../../../../themes/ThemeProvider";
import { MobileContext } from "../../../../contexts/MobileContext";
import { noSelect } from "../utilities/valueChangerElements/styles";
import { SUBDOMAIN_APPS, appHref, launchApp } from "../../../../subdomains";
import { lunaPalette } from "../utilities/desktopElements/luna";
import Wallpaper from "../utilities/desktopElements/Wallpaper";
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

const SCENES_FOLDER = "scenes";
const DISPLAY_PROPERTIES = "display";
const SHOW_DESKTOP = "showDesktop";
const GRID_GAP = 6;
const GRID_TOP = 16;
const GRID_LEFT = 16;
const CELL_WIDTH = ICON_WIDTH + GRID_GAP;
const CELL_HEIGHT = ICON_HEIGHT + GRID_GAP;
// A press has to travel this far before it counts as a drag rather than a click.
const DRAG_THRESHOLD = 4;

/** Where a shortcut sits before anyone has moved it: one column, top-left. */
const homePosition = (index) => ({
  x: GRID_LEFT,
  y: GRID_TOP + index * CELL_HEIGHT,
});

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
 */
export default function Desktop({
  sceneNames = [],
  currentSceneName = null,
  onOpenScene = () => {},
  onLaunch = launchApp,
  visibleUI = true,
  onToggleTheme = () => {},
  onToggleVisibleUI = () => {},
}) {
  const { themeName } = useTheme();
  const mobile = useContext(MobileContext);
  const luna = lunaPalette(themeName);

  const [selected, setSelected] = useState(null);
  const [positions, setPositions] = useState({});
  // The press in progress, and whether it has travelled far enough to be a drag.
  const iconDrag = useRef(null);
  const draggedRef = useRef(false);
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
      key: DISPLAY_PROPERTIES,
      name: "Display Properties",
      icon: faPalette,
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

  const positionOf = (entry, index) => positions[entry.key] ?? homePosition(index);

  /**
   * Press, move, release on a shortcut. A press that never travels is left
   * alone so the icon's own click handling still selects and opens; one that
   * does is a move, and the click it ends with is swallowed by `consumeDrag`.
   */
  const grabHandlers = (entry, index) => ({
    start: (event) => {
      if (event.button !== 0) return;
      const from = positionOf(entry, index);
      iconDrag.current = {
        key: entry.key,
        dx: event.clientX - from.x,
        dy: event.clientY - from.y,
        originX: event.clientX,
        originY: event.clientY,
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
      if (
        !draggedRef.current &&
        Math.hypot(event.clientX - active.originX, event.clientY - active.originY) <
          DRAG_THRESHOLD
      )
        return;
      draggedRef.current = true;
      setSelected(active.key);
      setPositions((prev) => ({
        ...prev,
        [active.key]: { x: event.clientX - active.dx, y: event.clientY - active.dy },
      }));
    };
    const end = () => {
      const active = iconDrag.current;
      iconDrag.current = null;
      if (!active || !draggedRef.current) return;
      setPositions((prev) => {
        const dropped = prev[active.key];
        if (!dropped) return prev;
        return {
          ...prev,
          [active.key]: snapToGrid(dropped.x, dropped.y, TASKBAR_HEIGHT),
        };
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
    };
  }, []);

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
    setSelected(null);
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
      dragStart.current = null;
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

  const isSelected = (entry) =>
    marquee ? marqueeSelection.includes(entry.key) : selected === entry.key;

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") setSelected(null);
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

      <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
        {shortcuts.map((entry, index) => (
          <DesktopIcon
            key={entry.key}
            icon={entry.icon}
            label={entry.name}
            href={entry.url ? appHref(entry) : null}
            selected={isSelected(entry)}
            position={positionOf(entry, index)}
            onSelect={() => setSelected(entry.key)}
            onOpen={() => open(entry)}
            onGrab={grabHandlers(entry, index)}
          />
        ))}
      </div>

      {marquee && (
        <div
          style={{
            position: "absolute",
            left: marquee.left,
            top: marquee.top,
            width: marquee.right - marquee.left,
            height: marquee.bottom - marquee.top,
            background: luna.selection,
            border: `1px solid ${luna.selectionEdge}`,
            pointerEvents: "none",
            zIndex: 2,
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
                  <FontAwesomeIcon
                    icon={faDisplay}
                    style={{ fontSize: "1.4rem", color: luna.frame }}
                  />
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
