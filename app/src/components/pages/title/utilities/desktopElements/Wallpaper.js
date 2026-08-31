import React, { useContext, useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../../themes/ThemeProvider";
import { MobileContext } from "../../../../../contexts/MobileContext";
import { hillColours, lunaPalette, skyGradient } from "./luna";
import StarField from "./StarField";
import CelestialSphere, { SPIN_MS, spinEase } from "./CelestialSphere";

/**
 * Bliss, more or less: a graded sky with one long green hill rolling across the
 * bottom of it, cresting left of centre and falling away to the right.
 *
 * The hill is an SVG path rather than a radial gradient because a gradient can
 * only give a symmetrical bulge, and the whole character of the original is
 * that the slope is uneven. It stretches rather than scales — the sky is not a
 * photograph, so distortion at odd aspect ratios does not read as wrong.
 *
 * Both times of day stay mounted and cross-fade, because a theme toggle should
 * look like dusk falling rather than like one image being swapped for another.
 * The cost of that is one idle canvas; the star field only animates when it is
 * the sky you can actually see.
 *
 * The sun and the moon are two hemispheres of one sphere, which turns.
 */

/** One sky: its gradient and its hill. */
function Sky({ dusk, green, active, mobile, children }) {
  const hill = hillColours(green, dusk);
  const gradientId = dusk ? "lunaHillDusk" : "lunaHillDay";

  return (
    <div
      className="utWallpaperLayer"
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: skyGradient(dusk),
        opacity: active ? 1 : 0,
      }}
    >
      {children}
      <svg
        viewBox="0 0 1200 400"
        preserveAspectRatio="none"
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          width: "100%",
          height: mobile ? "34%" : "46%",
          display: "block",
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={hill.crest} />
            <stop offset="40%" stopColor={hill.body} />
            <stop offset="100%" stopColor={hill.foot} />
          </linearGradient>
        </defs>
        <path
          d="M0,400 L0,206 C180,126 372,72 606,112 C818,148 1012,204 1200,172 L1200,400 Z"
          fill={`url(#${gradientId})`}
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

const SUN = {
  disc: "#F6C544",
  discLight: "#FFEBA6",
  discDark: "#C98A15",
  glow: "#FFE9A3",
  face: "#7A4A12",
};

const MOON = {
  disc: "#DDE4EE",
  discLight: "#FBFDFF",
  discDark: "#94A6C2",
  glow: "#AFC4E4",
  face: "#33415C",
};

export default function Wallpaper() {
  const { theme, themeName } = useTheme();
  const mobile = useContext(MobileContext);
  const luna = lunaPalette(themeName);
  const dusk = luna.dusk;
  const bodySize = mobile ? 92 : 132;

  /*
   * A single turn, driven frame by frame rather than by a CSS transition: the
   * sphere's geometry is a non-linear function of the angle, so the angle
   * itself has to be the thing that is animated.
   */
  // Negative, so the near surface travels leftwards: the sun goes out at the
  // left limb and the moon comes round from the right. The wind-up runs against
  // that, which is the direction it should have been going all along.
  const target = dusk ? -Math.PI : 0;
  const [spin, setSpin] = useState({ theta: target, effort: 0 });
  const from = useRef(target);

  useEffect(() => {
    const start = from.current;
    if (start === target) return undefined;

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      from.current = target;
      setSpin({ theta: target, effort: 0 });
      return undefined;
    }

    let frame = null;
    const began = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - began) / SPIN_MS);
      setSpin({
        theta: start + (target - start) * spinEase(progress),
        // Peaks in the middle of the move and eases off at both ends, so the
        // strain builds through the wind-up and lets go as it settles.
        effort: Math.sin(Math.PI * progress),
      });
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      } else {
        from.current = target;
      }
    };
    frame = requestAnimationFrame(step);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      from.current = target;
    };
  }, [target]);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <style>{`
        .utWallpaperLayer { transition: opacity 900ms ease; }
        .utStars { position: absolute; inset: 0; transition: opacity 1100ms ease 200ms; }
        @media (prefers-reduced-motion: reduce) {
          .utWallpaperLayer, .utStars { transition-duration: 1ms; }
        }
      `}</style>

      <Sky dusk={false} green={theme.secondaryAccent} active={!dusk} mobile={mobile} />

      <Sky dusk green={theme.secondaryAccent} active={dusk} mobile={mobile}>
        <div className="utStars" style={{ opacity: dusk ? 1 : 0 }}>
          <StarField colour="#FFFFFF" active={dusk} />
        </div>
      </Sky>

      <div
        style={{
          position: "absolute",
          top: mobile ? "5%" : "7%",
          right: mobile ? "6%" : "9%",
          width: bodySize,
          height: bodySize,
        }}
      >
        <CelestialSphere
          size={bodySize}
          theta={spin.theta}
          effort={spin.effort}
          sun={SUN}
          moon={MOON}
        />
      </div>
    </div>
  );
}
