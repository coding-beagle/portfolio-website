import React, { useContext, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faGithub,
  faLinkedin,
  faYoutube,
} from "@fortawesome/free-brands-svg-icons";
import { faPowerOff } from "@fortawesome/free-solid-svg-icons";
import { useTheme } from "../../../../../themes/ThemeProvider";
import { MobileContext } from "../../../../../contexts/MobileContext";
import { noSelect } from "../valueChangerElements/styles";
import { lunaPalette } from "./luna";
import SiteLogo from "./SiteLogo";
import { TASKBAR_HEIGHT } from "./Taskbar";

const LINKS = [
  { label: "GitHub", icon: faGithub, href: "https://www.github.com/coding-beagle" },
  {
    label: "LinkedIn",
    icon: faLinkedin,
    href: "https://www.linkedin.com/in/nicholasp-teague/",
  },
  { label: "YouTube", icon: faYoutube, href: "https://www.youtube.com/@ntprod" },
];

/**
 * The XP start menu: a blue header with the user on it, two columns — the
 * shortcuts on the left and the site's real links on the right — and the blue
 * strip along the bottom that turned the computer off.
 *
 * Items here open on a single click. A menu is not a desktop.
 */
export default function StartMenu({ entries, onLaunch, onShutDown, onClose }) {
  const { themeName } = useTheme();
  const mobile = useContext(MobileContext);
  const luna = lunaPalette(themeName);
  const panel = useRef(null);
  const [hovered, setHovered] = useState(null);

  /**
   * XP filled a hovered row solid blue and inverted its text. This has to be
   * inline state rather than a `:hover` rule, because every row sets its own
   * background inline — and an inline background wins, which left the rule
   * turning the text white over a row that was still white.
   */
  const rowStyle = (key) => ({
    background: hovered === key ? luna.menuHover : "transparent",
    color: hovered === key ? luna.menuHoverText : luna.text,
  });

  const rowEvents = (key) => ({
    onMouseEnter: () => setHovered(key),
    onMouseLeave: () => setHovered((prev) => (prev === key ? null : prev)),
    onFocus: () => setHovered(key),
    onBlur: () => setHovered((prev) => (prev === key ? null : prev)),
  });

  useEffect(() => {
    const onPointerDown = (event) => {
      // The start button owns its own toggle, so a click on it must not also be
      // read here as a click-away, or the menu would close and reopen at once.
      if (panel.current?.contains(event.target)) return;
      if (event.target.closest?.(".startOrb")) return;
      onClose();
    };
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const heading = (text) => (
    <p
      style={{
        ...noSelect,
        margin: "0 0 0.3em 0.5em",
        fontSize: "0.6rem",
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: luna.dimText,
      }}
    >
      {text}
    </p>
  );

  return (
    <div
      ref={panel}
      role="menu"
      aria-label="Start menu"
      style={{
        position: "absolute",
        // In the corner, over the start button it belongs to.
        left: 0,
        bottom: TASKBAR_HEIGHT,
        width: mobile ? "calc(100% - 16px)" : 400,
        display: "flex",
        flexDirection: "column",
        borderRadius: "0 8px 0 0",
        border: `2px solid ${luna.frame}`,
        borderBottom: "none",
        background: luna.content,
        color: luna.text,
        boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
        overflow: "hidden",
        zIndex: 310,
      }}
    >
      <div
        style={{
          ...noSelect,
          display: "flex",
          alignItems: "center",
          gap: "0.7em",
          padding: "0.5em 0.8em",
          background: luna.barGradient,
          color: "#ffffff",
          textShadow: "1px 1px 1px rgba(0,0,0,0.5)",
        }}
      >
        <span
          style={{
            width: 34,
            height: 34,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
            border: "2px solid rgba(255,255,255,0.7)",
            background: luna.tray,
          }}
        >
          <SiteLogo size={22} />
        </span>
        <span style={{ fontWeight: "bold", fontSize: "0.92rem" }}>
          Nicholas Teague
        </span>
      </div>

      <div style={{ display: "flex", minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, padding: "0.6em 0.4em" }}>
          {heading("Utilities")}
          {entries.map((entry) => (
            <button
              key={entry.key}
              className="startItem"
              onClick={() => onLaunch(entry)}
              {...rowEvents(entry.key)}
              style={{
                ...noSelect,
                display: "flex",
                alignItems: "center",
                gap: "0.7em",
                width: "100%",
                padding: "0.45em 0.5em",
                border: "1px solid transparent",
                borderRadius: 3,
                cursor: "default",
                textAlign: "left",
                font: "inherit",
                ...rowStyle(entry.key),
              }}
            >
              <FontAwesomeIcon
                icon={entry.icon}
                style={{
                  fontSize: "1.1rem",
                  color: hovered === entry.key ? luna.menuHoverText : luna.frame,
                }}
              />
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontSize: "0.84rem" }}>{entry.name}</span>
                {entry.description && (
                  <span
                    style={{
                      fontSize: "0.66rem",
                      color:
                        hovered === entry.key ? luna.menuHoverText : luna.dimText,
                      opacity: hovered === entry.key ? 0.85 : 1,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {entry.description}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
        <div
          style={{
            width: mobile ? 116 : 140,
            padding: "0.6em 0.4em",
            background: luna.menuSide,
            borderLeft: `1px solid ${luna.edge}`,
          }}
        >
          {heading("Links")}
          {LINKS.map((link) => (
            <a
              key={link.label}
              className="startItem"
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              {...rowEvents(link.label)}
              style={{
                ...noSelect,
                display: "flex",
                alignItems: "center",
                gap: "0.6em",
                padding: "0.42em 0.5em",
                border: "1px solid transparent",
                borderRadius: 3,
                textDecoration: "none",
                fontSize: "0.8rem",
                ...rowStyle(link.label),
              }}
            >
              <FontAwesomeIcon
                icon={link.icon}
                style={{
                  color:
                    hovered === link.label ? luna.menuHoverText : luna.frame,
                }}
              />
              {link.label}
            </a>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: "0.35em 0.6em",
          background: luna.barGradient,
        }}
      >
        <button
          className="startItem"
          onClick={onShutDown}
          {...rowEvents("shutdown")}
          style={{
            ...noSelect,
            display: "flex",
            alignItems: "center",
            gap: "0.5em",
            padding: "0.35em 0.6em",
            border: "1px solid transparent",
            borderRadius: 3,
            background:
              hovered === "shutdown" ? "rgba(255,255,255,0.25)" : "transparent",
            color: "#ffffff",
            textShadow: "1px 1px 1px rgba(0,0,0,0.5)",
            cursor: "pointer",
            font: "inherit",
            fontSize: "0.8rem",
          }}
        >
          <FontAwesomeIcon icon={faPowerOff} />
          Turn Off Computer
        </button>
      </div>
    </div>
  );
}

/** Hover state for the menu rows, which cannot be written inline. */
/** The focus ring, which is the one thing :focus-visible has to express. */
export function StartMenuStyles() {
  return (
    <style>{`
      .startItem:focus-visible { outline: 1px dotted currentColor; outline-offset: -3px; }
    `}</style>
  );
}
