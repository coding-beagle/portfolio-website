import React, { useContext, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useTheme } from "../../../../../themes/ThemeProvider";
import { MobileContext } from "../../../../../contexts/MobileContext";
import { noSelect } from "../valueChangerElements/styles";
import { lunaPalette } from "./luna";

export const ICON_WIDTH = 84;
export const ICON_HEIGHT = 92;

/**
 * A shortcut on the desktop: glyph, label, and the two-step open that a desktop
 * has always had — one click to select, two to launch. It can also be dragged
 * anywhere on the desktop, which is the parent's business; this only reports
 * the press that starts one.
 *
 * It is an anchor rather than a button when it goes somewhere, so the browser's
 * own affordances still work: middle-click opens a tab, right-click offers
 * "copy link address", and a focused icon opens on Enter. A plain click has its
 * navigation cancelled so that it only selects; a keyboard activation (which
 * arrives with `detail === 0`) is let through.
 *
 * On touch there is no hover and no comfortable double-tap, so one tap opens.
 */
export default function DesktopIcon({
  icon,
  label,
  href = null,
  selected = false,
  position,
  onSelect,
  onOpen,
  onGrab,
}) {
  const { themeName } = useTheme();
  const luna = lunaPalette(themeName);
  const mobile = useContext(MobileContext);
  const [hovered, setHovered] = useState(false);

  const activate = (event) => {
    if (event) event.preventDefault();
    onOpen();
  };

  const handleClick = (event) => {
    // A keyboard Enter arrives as a click with no pointer behind it; let that
    // open rather than swallowing it into a selection.
    if (event.detail === 0) {
      activate(event);
      return;
    }
    event.preventDefault();
    // A click that was really the end of a drag is not a click.
    if (onGrab?.consumeDrag?.()) return;
    onSelect();
    if (mobile) onOpen();
  };

  const Tag = href ? "a" : "button";

  return (
    <Tag
      className="desktopIcon"
      href={href ?? undefined}
      // Without this the browser's own image/link dragging fights ours.
      draggable={false}
      onMouseDown={onGrab?.start}
      onClick={handleClick}
      onDoubleClick={activate}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={label}
      data-desktop-icon={label}
      style={{
        ...noSelect,
        position: position ? "absolute" : "relative",
        left: position?.x,
        top: position?.y,
        width: ICON_WIDTH,
        height: ICON_HEIGHT,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: 6,
        padding: "8px 4px 4px",
        boxSizing: "border-box",
        borderRadius: 2,
        textDecoration: "none",
        cursor: "default",
        font: "inherit",
        color: luna.desktopText,
        background: selected
          ? luna.selection
          : hovered
            ? luna.hover
            : "transparent",
        border: `1px dotted ${selected ? luna.selectionEdge : "transparent"}`,
      }}
    >
      <span
        style={{
          fontSize: "1.9rem",
          lineHeight: 1,
          filter: "drop-shadow(1px 1px 2px rgba(0,0,0,0.5))",
          color: luna.desktopText,
        }}
      >
        <FontAwesomeIcon icon={icon} />
      </span>
      <span
        style={{
          fontSize: "0.7rem",
          textAlign: "center",
          lineHeight: 1.2,
          textShadow: luna.desktopTextShadow,
          wordBreak: "break-word",
        }}
      >
        {label}
      </span>
    </Tag>
  );
}

/** Focus ring for the shortcuts, which :focus-visible cannot express inline. */
export function DesktopIconStyles({ hoverColour }) {
  return (
    <style>{`
      .desktopIcon:focus-visible {
        outline: 1px dotted currentColor;
        outline-offset: 1px;
      }
      /* Shortcuts inside a window use this class without the hover state that
         DesktopIcon tracks for itself, so the highlight is a rule as well. */
      button.desktopIcon:hover { background: ${hoverColour}; }
    `}</style>
  );
}
