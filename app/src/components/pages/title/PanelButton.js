import React, { useContext, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useTheme } from "../../../themes/ThemeProvider";
import { MobileContext } from "../../../contexts/MobileContext";

/**
 * The round control used in the corners and edges of the inline panels: close,
 * back, and the carousel's next/previous arrows.
 *
 * It exists so those buttons stay one shape. Sized as a square (a circle needs
 * equal width and height, which per-side padding does not give), and it follows
 * the same hover language as IconHover/IconButton by moving to theme.secondary
 * rather than by fading opacity.
 *
 * `baseTransform` carries the panel's entry animation; the hover and press
 * scaling is composed on top of it.
 */
export default function PanelButton({
  icon,
  onClick,
  label,
  disabled = false,
  baseTransform = "",
  size = null,
  style = {},
}) {
  const { theme } = useTheme();
  const mobile = useContext(MobileContext);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  // Matches the 44px tap target the icon row keeps on touch devices.
  const diameter = size ?? (mobile ? 44 : 36);
  const active = hovered && !disabled;
  const scale = disabled ? 1 : pressed ? 0.92 : hovered ? 1.08 : 1;

  return (
    <button
      className="panelButton"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        position: "absolute",
        width: diameter,
        height: diameter,
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        // A disc of the panel's own background, so the arrows stay legible over
        // whatever image sits behind them without washing the artwork out.
        background: active ? `${theme.secondary}26` : `${theme.primary}D9`,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        border: `1px solid ${active ? theme.secondary : `${theme.accent}40`}`,
        color: active ? theme.secondary : theme.accent,
        boxShadow: `0 2px 10px ${theme.primary}80`,
        fontSize: mobile ? "1rem" : "0.95rem",
        lineHeight: 1,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
        transition:
          "background 0.25s ease, border-color 0.25s ease, color 0.25s ease, opacity 0.25s ease, transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        transform: `${baseTransform} scale(${scale})`.trim(),
        zIndex: 101,
        ...style,
      }}
    >
      <FontAwesomeIcon icon={icon} />
    </button>
  );
}

/**
 * Keyboard focus ring for the buttons above. It needs a real stylesheet rule
 * because :focus-visible cannot be expressed inline; currentColor keeps it on
 * theme in both light and dark.
 */
export function PanelButtonStyles() {
  return (
    <style>{`
      .panelButton:focus-visible {
        outline: 2px solid currentColor;
        outline-offset: 3px;
      }
    `}</style>
  );
}
