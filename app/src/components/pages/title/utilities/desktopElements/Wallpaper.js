import React from "react";
import { useTheme } from "../../../../../themes/ThemeProvider";
import { hillColours, lunaPalette } from "./luna";

/**
 * Bliss, more or less: a graded sky with one long green hill rolling across the
 * bottom of it, cresting left of centre and falling away to the right.
 *
 * The hill is an SVG path rather than a radial gradient because a gradient can
 * only give a symmetrical bulge, and the whole character of the original is
 * that the slope is uneven. It stretches rather than scales — the sky is not a
 * photograph, so distortion at odd aspect ratios does not read as wrong.
 */
export default function Wallpaper() {
  const { theme, themeName } = useTheme();
  const luna = lunaPalette(themeName);
  const hill = hillColours(theme.secondaryAccent, luna.dusk);

  return (
    <div style={{ position: "absolute", inset: 0, background: luna.sky, overflow: "hidden" }}>
      <svg
        viewBox="0 0 1200 400"
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          width: "100%",
          height: "46%",
          display: "block",
        }}
      >
        <defs>
          <linearGradient id="lunaHill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={hill.crest} />
            <stop offset="40%" stopColor={hill.body} />
            <stop offset="100%" stopColor={hill.foot} />
          </linearGradient>
        </defs>
        <path
          d="M0,400 L0,206 C180,126 372,72 606,112 C818,148 1012,204 1200,172 L1200,400 Z"
          fill="url(#lunaHill)"
        />
        {/* The sunlit rim along the ridge, which is what makes it read as grass. */}
        <path
          d="M0,206 C180,126 372,72 606,112 C818,148 1012,204 1200,172"
          fill="none"
          stroke={hill.rim}
          strokeWidth="7"
          opacity="0.45"
        />
      </svg>
    </div>
  );
}
