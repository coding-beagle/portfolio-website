import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMoon, faSun } from "@fortawesome/free-solid-svg-icons";
import { useTheme } from "../../themes/ThemeProvider";
import { noSelect } from "../pages/title/utilities/valueChangerElements/styles";

/**
 * The light/dark switch for the subdomain tools.
 *
 * It sits in the header beside the link back to the site rather than floating
 * in a corner: the tools scroll, and a pinned corner button ends up over the
 * content it is supposed to sit beside — on a phone it landed squarely on
 * uploadthat's session controls.
 *
 * Styled to the weight of the back link next to it, not as a primary action.
 * The portfolio keeps its own larger corner button; that one sits over a
 * fullscreen canvas with nothing to collide with.
 */
export default function ThemeToggle({ style = {} }) {
  const { theme, themeName, toggleTheme } = useTheme();
  const [hovered, setHovered] = useState(false);
  const label =
    themeName === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      className="utControl hexControl"
      onClick={toggleTheme}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={label}
      title={label}
      style={{
        ...noSelect,
        width: "2.2em",
        height: "2.2em",
        flex: "0 0 auto",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        cursor: "pointer",
        fontSize: "0.95rem",
        color: hovered ? theme.secondary : theme.accent,
        opacity: hovered ? 1 : 0.65,
        background: hovered ? `${theme.accent}14` : "transparent",
        border: "none",
        transition: "color 0.2s ease, opacity 0.2s ease, background 0.2s ease",
        ...style,
      }}
    >
      <FontAwesomeIcon icon={themeName === "dark" ? faSun : faMoon} />
    </button>
  );
}
