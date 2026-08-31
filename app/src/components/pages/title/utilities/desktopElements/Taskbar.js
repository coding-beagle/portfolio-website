import React, { useContext, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faWindows } from "@fortawesome/free-brands-svg-icons";
import { useTheme } from "../../../../../themes/ThemeProvider";
import { MobileContext } from "../../../../../contexts/MobileContext";
import { noSelect } from "../valueChangerElements/styles";
import { lunaPalette } from "./luna";

/**
 * XP's own proportions. The page's corner buttons used to force a much taller
 * bar to avoid colliding with them; the desktop now hides those and offers the
 * same two controls as shortcuts, so the bar can sit in the corner at the
 * height it is supposed to be.
 */
export const TASKBAR_HEIGHT = 40;

/** The clock in the notification area, to the minute like the original. */
function Clock({ luna, compact }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // Ticking every second would be a wasted render for a display that only
    // changes every minute; a second is still checked so the minute turns over
    // promptly rather than up to a minute late.
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      style={{
        ...noSelect,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        alignSelf: "center",
        lineHeight: 1.3,
        height: TASKBAR_HEIGHT - 8,
        padding: "0 0.9em",
        // XP sank the notification area into the bar with an inner shadow.
        background: luna.tray,
        border: `1px solid ${luna.trayEdge}`,
        boxShadow: "inset 1px 1px 2px rgba(0,0,0,0.45)",
        color: "#ffffff",
        textShadow: "1px 1px 1px rgba(0,0,0,0.45)",
        fontSize: "0.72rem",
      }}
    >
      <span>
        {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
      </span>
      {!compact && (
        <span style={{ opacity: 0.75 }}>{now.toLocaleDateString()}</span>
      )}
    </div>
  );
}

/**
 * The taskbar: the green start button, a button per open window, and the clock
 * in its sunken tray.
 */
export default function Taskbar({
  startOpen,
  onToggleStart,
  windows = [],
  onWindowClick,
}) {
  const { themeName } = useTheme();
  const mobile = useContext(MobileContext);
  const luna = lunaPalette(themeName);

  return (
    <div
      role="toolbar"
      aria-label="Taskbar"
      style={{
        ...noSelect,
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: TASKBAR_HEIGHT,
        display: "flex",
        alignItems: "stretch",
        padding: "0 4px 0 0",
        background: luna.barGradient,
        // The bright line along the top edge, which XP had and Aero did not.
        borderTop: `1px solid ${luna.barTopLine}`,
        zIndex: 300,
      }}
    >
      <button
        className="startOrb"
        onClick={onToggleStart}
        aria-label="Start"
        aria-expanded={startOpen}
        title="Start"
        style={{
          alignSelf: "stretch",
          display: "flex",
          alignItems: "center",
          gap: "0.45em",
          padding: "0 1.4em 0 0.9em",
          // Square against the screen corner, rounded on the inside edge — the
          // shape the button only has when it is actually in the corner.
          borderRadius: "0 12px 12px 0",
          cursor: "pointer",
          border: "none",
          borderRight: `1px solid ${luna.startEdge}`,
          background: startOpen ? luna.startHoverGradient : luna.startGradient,
          boxShadow: startOpen
            ? `inset 0 2px 6px rgba(0,0,0,0.45)`
            : `inset 0 1px 0 rgba(255,255,255,0.5), 0 1px 3px rgba(0,0,0,0.35)`,
          color: "#ffffff",
          fontSize: "0.98rem",
          fontWeight: "bold",
          fontStyle: "italic",
          textShadow: "1px 1px 2px rgba(0,0,0,0.55)",
        }}
      >
        <FontAwesomeIcon icon={faWindows} style={{ fontStyle: "normal" }} />
        <span>start</span>
      </button>

      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "0 0.8em",
          overflow: "hidden",
        }}
      >
        {windows.map((entry) => (
          <button
            key={entry.id}
            className="taskbarButton"
            onClick={() => onWindowClick(entry.id)}
            title={entry.title}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5em",
              maxWidth: mobile ? 110 : 190,
              height: TASKBAR_HEIGHT - 12,
              padding: "0 0.7em",
              borderRadius: 3,
              cursor: "pointer",
              fontSize: "0.76rem",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: "#ffffff",
              textShadow: "1px 1px 1px rgba(0,0,0,0.4)",
              border: `1px solid ${luna.barFoot}`,
              // A pressed-in button is the open window; a raised one is put away.
              background: entry.minimized ? luna.barGradient : luna.tray,
              boxShadow: entry.minimized
                ? "inset 0 1px 0 rgba(255,255,255,0.4)"
                : "inset 0 2px 4px rgba(0,0,0,0.4)",
            }}
          >
            {entry.icon && <FontAwesomeIcon icon={entry.icon} />}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {entry.title}
            </span>
          </button>
        ))}
      </div>

      <Clock luna={luna} compact={mobile} />
    </div>
  );
}
