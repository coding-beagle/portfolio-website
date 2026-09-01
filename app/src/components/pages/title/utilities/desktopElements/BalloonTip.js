import React, { useContext } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleInfo, faXmark } from "@fortawesome/free-solid-svg-icons";
import { useTheme } from "../../../../../themes/ThemeProvider";
import { MobileContext } from "../../../../../contexts/MobileContext";
import { noSelect } from "../valueChangerElements/styles";
import { scaleColour } from "../usefulFunctions";
import { lunaPalette } from "./luna";

/**
 * XP's balloon tip: the note that grew out of the notification area whenever
 * Windows wanted a word.
 *
 * The rest of Luna keeps XP's own colours, because the taskbar blue and the
 * green start button *are* the recognition. The balloon does not — it carries
 * the page's message rather than the desktop's, so it wears the theme's accent
 * and reads as part of the site. XP's cream is close enough to the accent in
 * the dark theme that the shape survives the swap either way.
 *
 * The one thing that does not follow the theme is the "i", which stays the blue
 * of the window frames — it is the glyph that says notification, and the site's
 * cyan in its place read as decoration.
 */
const TAIL = 12;

/**
 * The tail: a right triangle with its upright edge on the right and its point
 * at the bottom, which is the lean XP's balloons had towards the tray they
 * came out of.
 *
 * It is drawn twice — the edge colour, then the face a hair inside it — so the
 * balloon's one-pixel border carries on down the sloping edge. The face copy is
 * nudged left off the upright and up over the body's own bottom border, which
 * is what joins the tail to the balloon rather than parking it underneath.
 */
function Tail({ right, face, edge }) {
  const triangle = (colour, dx, dy) => ({
    position: "absolute",
    top: `calc(100% + ${dy}px)`,
    right: right + dx,
    width: 0,
    height: 0,
    borderLeft: `${TAIL}px solid transparent`,
    borderTop: `${TAIL}px solid ${colour}`,
  });

  return (
    <>
      <div style={triangle(edge, 0, 0)} />
      <div style={triangle(face, 1, -2)} />
    </>
  );
}

/**
 * A balloon anchored above the notification area.
 *
 * `bottomInset` is the taskbar it grows out of; the tail is drawn below the
 * body so the balloon's own box still clears the bar.
 */
export default function BalloonTip({
  title,
  children,
  bottomInset = 0,
  onClose,
  zIndex = 350,
}) {
  const mobile = useContext(MobileContext);
  const { theme, themeName } = useTheme();
  const luna = lunaPalette(themeName);

  // The accent is the face, so everything drawn on it comes off the primary it
  // is meant to sit against — which keeps the note legible whichever way round
  // the theme has those two.
  const face = theme.accent;
  const edge = theme.primary;
  const dim = scaleColour(theme.primary, theme.accent, 0.45);

  return (
    <div
      role="status"
      aria-live="polite"
      className="lunaBalloon"
      style={{
        ...noSelect,
        position: "absolute",
        right: mobile ? 10 : 16,
        bottom: bottomInset + TAIL + 4,
        maxWidth: mobile ? "min(19em, calc(100vw - 20px))" : "22em",
        padding: "0.6em 0.7em",
        background: face,
        border: `1px solid ${edge}`,
        borderRadius: 4,
        boxShadow: "2px 2px 6px rgba(0,0,0,0.4)",
        color: edge,
        font: "inherit",
        fontSize: mobile ? "0.72rem" : "0.78rem",
        lineHeight: 1.4,
        zIndex,
      }}
    >
      <Tail right={mobile ? 14 : 22} face={face} edge={edge} />

      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5em" }}>
        <FontAwesomeIcon
          icon={faCircleInfo}
          style={{ color: luna.frame, fontSize: "1.1rem", marginTop: 1 }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: "bold", marginBottom: "0.15em" }}>{title}</div>
          <div>{children}</div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close notification"
            title="Close"
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 16,
              height: 16,
              padding: 0,
              border: "none",
              borderRadius: 2,
              background: "transparent",
              color: dim,
              cursor: "pointer",
              fontSize: "0.7rem",
            }}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        )}
      </div>
    </div>
  );
}

/** The balloon eased itself out of the tray rather than appearing all at once. */
export function BalloonTipStyles() {
  return (
    <style>{`
      .lunaBalloon {
        animation: lunaBalloonIn 0.35s ease-out;
      }
      @keyframes lunaBalloonIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .lunaBalloon { animation: none; }
      }
    `}</style>
  );
}
