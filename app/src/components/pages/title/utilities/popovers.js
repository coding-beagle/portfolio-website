import { useState } from "react";
import {
  faArrowsUpDownLeftRight,
  faKeyboard,
  faMagnifyingGlass,
  faMouse,
  faRotate,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useTheme } from "../../../../themes/ThemeProvider";

function GenericToolTip(text, icon) {
  const [hovered, setHovered] = useState(false);
  const { theme } = useTheme();

  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Flex + lineHeight:1 pins the row's height to the glyph (1em = 2em here),
          so other fixed UI can line up with it deterministically. */}
      <div
        style={{
          fontSize: "2em",
          display: "flex",
          alignItems: "center",
          lineHeight: 1,
        }}
      >
        <FontAwesomeIcon icon={icon} />
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

export default function MouseTooltip({ text }) {
  return GenericToolTip(text, faMouse);
}

export function ZoomableToolTip({ text }) {
  return GenericToolTip(text, faMagnifyingGlass);
}

export function PannableToolTip({ text }) {
  return GenericToolTip(text, faArrowsUpDownLeftRight);
}

export function GyroToolTip({ text }) {
  return GenericToolTip(text, faRotate);
}

export function KeyboardToolTip({ text }) {
  return GenericToolTip(text, faKeyboard);
}

export const iconTypes = {
  MOUSE: MouseTooltip,
  ZOOMABLE: ZoomableToolTip,
  PANNABLE: PannableToolTip,
  GYRO: GyroToolTip,
  KEY: KeyboardToolTip
}

// icons is an array of {type: validType, text: 'text'}
export function IconGroup({ icons }) {
  return (
    <div style={{ zIndex: 3000 }} >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          // Padded to the mobile Options pill's 44px height so the 2em glyphs
          // share its centre line rather than sitting proud of it.
          minHeight: "2.75em",
          position: "absolute",
          top: "calc(1em + env(safe-area-inset-top, 0px))",
          right: "1em",
          gap: "0.5em",
        }}
        id="iconGroup"
      >
        {icons.map((icon, index) => {
          const IconComponent = iconTypes[icon.type];
          return IconComponent ? (
            <IconComponent key={index} text={icon.text} />
          ) : null;
        })}
      </div>
    </div>
  );
}
