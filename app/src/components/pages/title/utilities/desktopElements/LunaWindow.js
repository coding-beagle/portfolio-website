import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMinus, faSquare, faXmark } from "@fortawesome/free-solid-svg-icons";
import { useTheme } from "../../../../../themes/ThemeProvider";
import { MobileContext } from "../../../../../contexts/MobileContext";
import { noSelect } from "../valueChangerElements/styles";
import { lunaPalette } from "./luna";

const TITLE_BAR = 28;
const FRAME = 4;
const MIN_WIDTH = 240;
const MIN_HEIGHT = 160;

/** Keeps a dragged window from being pushed somewhere it cannot be grabbed. */
const clampToViewport = (x, y, width, bottomInset) => ({
  x: Math.min(Math.max(x, 8 - width + 80), window.innerWidth - 80),
  y: Math.min(Math.max(y, 0), window.innerHeight - bottomInset - TITLE_BAR),
});

/**
 * A Luna window: the blue frame, the rounded top corners, the title in bold
 * white, and the three buttons with the red one on the end. Dragged by the
 * title bar and resized from the gripper in the bottom-right corner.
 *
 * Minimising is the parent's business — the window stays mounted and is only
 * hidden, so its position and size survive being put away and brought back
 * from the taskbar. Maximised it fills the desktop down to the top of the
 * taskbar, which is what `bottomInset` describes.
 */
export default function LunaWindow({
  title,
  icon,
  minimized = false,
  bottomInset = 0,
  onClose,
  onMinimize,
  onFocus,
  zIndex = 200,
  children,
}) {
  const { themeName } = useTheme();
  const luna = lunaPalette(themeName);
  const mobile = useContext(MobileContext);

  const [size, setSize] = useState(() => ({
    width: mobile ? Math.min(340, window.innerWidth - 24) : 520,
    height: mobile ? 320 : 380,
  }));
  const [position, setPosition] = useState(() => ({
    x: Math.max(12, Math.round((window.innerWidth - (mobile ? 340 : 520)) / 2)),
    y: Math.max(12, Math.round((window.innerHeight - (mobile ? 320 : 380)) / 2) - 40),
  }));
  const [maximized, setMaximized] = useState(false);

  // One gesture at a time: either moving the window or resizing it.
  const gesture = useRef(null);

  const startMove = (event) => {
    if (maximized) return;
    if (event.button !== undefined && event.button !== 0) return;
    onFocus?.();
    gesture.current = {
      kind: "move",
      dx: event.clientX - position.x,
      dy: event.clientY - position.y,
    };
  };

  const startResize = (event) => {
    if (maximized) return;
    if (event.button !== undefined && event.button !== 0) return;
    event.stopPropagation();
    onFocus?.();
    gesture.current = {
      kind: "resize",
      x: event.clientX,
      y: event.clientY,
      width: size.width,
      height: size.height,
    };
  };

  const onPointerMove = useCallback(
    (event) => {
      const active = gesture.current;
      if (!active) return;
      if (active.kind === "move") {
        setPosition(
          clampToViewport(
            event.clientX - active.dx,
            event.clientY - active.dy,
            size.width,
            bottomInset
          )
        );
        return;
      }
      setSize({
        width: Math.max(MIN_WIDTH, active.width + (event.clientX - active.x)),
        height: Math.max(MIN_HEIGHT, active.height + (event.clientY - active.y)),
      });
    },
    [size.width, bottomInset]
  );

  const endGesture = useCallback(() => {
    gesture.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", endGesture);
    return () => {
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("mouseup", endGesture);
    };
  }, [onPointerMove, endGesture]);

  const frame = maximized
    ? { left: 0, top: 0, width: "100%", height: `calc(100% - ${bottomInset}px)` }
    : { left: position.x, top: position.y, ...size };

  const button = (key, glyph, label, onClick, danger = false) => (
    <button
      key={key}
      className="lunaWindowButton"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        ...noSelect,
        width: danger ? 30 : 21,
        height: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "0.6rem",
        cursor: "default",
        color: "#ffffff",
        borderRadius: 3,
        border: `1px solid ${luna.buttonEdge}`,
        background: danger ? luna.closeGradient : luna.buttonGradient,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55)",
      }}
      data-danger={danger ? "true" : undefined}
    >
      <FontAwesomeIcon icon={glyph} />
    </button>
  );

  return (
    <section
      role="dialog"
      aria-label={title}
      onMouseDown={onFocus}
      style={{
        position: "absolute",
        ...frame,
        display: minimized ? "none" : "flex",
        flexDirection: "column",
        zIndex,
        boxSizing: "border-box",
        padding: `0 ${FRAME}px ${FRAME}px`,
        borderRadius: maximized ? 0 : "7px 7px 0 0",
        background: luna.frame,
        boxShadow: "2px 3px 10px rgba(0,0,0,0.5)",
      }}
    >
      <div
        onMouseDown={startMove}
        onDoubleClick={() => setMaximized((prev) => !prev)}
        style={{
          ...noSelect,
          height: TITLE_BAR,
          flex: `0 0 ${TITLE_BAR}px`,
          display: "flex",
          alignItems: "center",
          gap: "0.4em",
          margin: `0 -${FRAME}px 0`,
          padding: `0 3px 0 ${FRAME + 3}px`,
          borderRadius: maximized ? 0 : "7px 7px 0 0",
          background: luna.titleGradient,
          cursor: maximized ? "default" : "move",
        }}
      >
        {icon && (
          <FontAwesomeIcon
            icon={icon}
            style={{ fontSize: "0.8rem", color: "#ffffff" }}
          />
        )}
        <span
          style={{
            flex: 1,
            fontSize: "0.78rem",
            fontWeight: "bold",
            color: luna.titleText,
            textShadow: "1px 1px 1px rgba(0,0,0,0.45)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </span>
        <div style={{ display: "flex", gap: 2 }}>
          {button("min", faMinus, "Minimise", onMinimize)}
          {button("max", faSquare, maximized ? "Restore" : "Maximise", () =>
            setMaximized((prev) => !prev)
          )}
          {button("close", faXmark, "Close", onClose, true)}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: luna.face,
          color: luna.text,
          border: `1px solid ${luna.edge}`,
          padding: "0.6em",
        }}
      >
        {children}
      </div>

      {!maximized && (
        <div
          onMouseDown={startResize}
          role="separator"
          aria-label="Resize"
          title="Resize"
          style={{
            ...noSelect,
            position: "absolute",
            right: 0,
            bottom: 0,
            width: 16,
            height: 16,
            cursor: "nwse-resize",
            // The three diagonal ribs XP put in the corner of a sizeable window.
            background: `repeating-linear-gradient(135deg, transparent 0 2px, rgba(255,255,255,0.75) 2px 3px, transparent 3px 5px)`,
          }}
        />
      )}
    </section>
  );
}

/**
 * Hover states for the window buttons — the gloss brightening under the cursor
 * is the one part of Luna that has to be a rule rather than an inline style.
 */
export function LunaWindowStyles() {
  return (
    <style>{`
      .lunaWindowButton:hover { filter: brightness(1.2); }
      .lunaWindowButton:active { filter: brightness(0.85); }
      .lunaWindowButton:focus-visible { outline: 1px dotted #ffffff; outline-offset: 1px; }
    `}</style>
  );
}
