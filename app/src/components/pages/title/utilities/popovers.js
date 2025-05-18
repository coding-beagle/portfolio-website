import { useState } from "react";
import { faMouse } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useTheme } from "../../../../themes/ThemeProvider";

export default function MouseTooltip({ text }) {
  const [hovered, setHovered] = useState(false);
  const { theme } = useTheme();

  return (
    <span
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ fontSize: "2em", display: "inline-block" }}>
        <FontAwesomeIcon icon={faMouse} />
      </div>
      {hovered && text && (
        <div
          style={{
            position: "absolute",
            top: "110%",
            left: "100%", // align right edge of popover to right edge of icon
            transform: "translateX(-100%)", // shift popover left so its right edge is at the icon
            background: theme.primary,
            color: theme.accent,
            padding: "6px 12px",
            borderRadius: "6px",
            whiteSpace: "normal",
            boxShadow: `0 2px 8px ${theme.secondary}30`,
            zIndex: 1000,
            pointerEvents: "none",
            maxWidth: "15rem",
            minWidth: "15rem",
            overflowWrap: "break-word",
            wordBreak: "break-word",
          }}
        >
          {text.split("\n").map((line, idx) => (
            <div key={idx}>
              {line.includes(":") ? (
                <>
                  <b>{line.split(":")[0]}</b>:{line.split(":")[1]}
                </>
              ) : (
                line
              )}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
