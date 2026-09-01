import React, { useContext, useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../../themes/ThemeProvider";
import { themes } from "../../../../../themes/themes";
import { INK_VAR } from "../../../../../themes/ink";
import { scaleColour } from "../usefulFunctions";
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
 * The sun and the moon are two hemispheres of one sphere, which turns — and the
 * fade is that turn rather than a transition of its own, so the light in the
 * sky is the light the sphere is actually showing.
 */

/** One sky: its gradient and its hill. */
function Sky({ dusk, green, opacity, mobile, children }) {
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
        opacity,
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

/**
 * Where the sphere hangs, as the fractions of the viewport it is placed by. It
 * keeps to the top-right corner, which is why a phone's shortcuts stop three
 * across rather than running a fourth one under it.
 */
const CELESTIAL = {
  desktop: { size: 132, top: 0.07, right: 0.09 },
  mobile: { size: 92, top: 0.05, right: 0.06 },
};

/**
 * How far into night the sky is, taken from the sphere's own angle rather than
 * from a clock of its own.
 *
 * The sun faces us at 0 and has turned right away at ±π, so what is left of the
 * daylight is the fraction of the sunlit hemisphere still pointing this way.
 * Cosine rather than the raw angle, because that is how much of a turning ball
 * you can actually see — the light holds while the sun crosses the front and
 * then goes quickly as it drops over the limb.
 */
export const nightFraction = (theta) => (1 - Math.cos(theta)) / 2;

/**
 * The colour the page's title and icons take over this wallpaper.
 *
 * Both ends are the accent the theme would have settled on anyway, so at rest
 * this is exactly the colour everything else on the site is written in; it is
 * only the journey between them that belongs to the sky.
 */
const inkFor = (night) =>
  scaleColour(themes.light.accent, themes.dark.accent, night);

export default function Wallpaper() {
  const { theme, themeName } = useTheme();
  const mobile = useContext(MobileContext);
  const luna = lunaPalette(themeName);
  const dusk = luna.dusk;
  const body = mobile ? CELESTIAL.mobile : CELESTIAL.desktop;

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

  const night = nightFraction(spin.theta);
  const ink = inkFor(night);

  // The title and the icon row sit over this wallpaper but are siblings of the
  // scene, so the colour reaches them as a custom property on the document.
  useEffect(() => {
    document.documentElement.style.setProperty(INK_VAR, ink);
  }, [ink]);

  // Handed back when the desktop is left, so every other scene is written in
  // the theme's own accent again.
  useEffect(
    () => () => document.documentElement.style.removeProperty(INK_VAR),
    []
  );

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <style>{`
        .utStars { position: absolute; inset: 0; }
      `}</style>

      {/*
        Day is the ground the night is drawn over, so there is never a frame
        part-way through where both are half-there and the hill goes pale.
      */}
      <Sky dusk={false} green={theme.secondaryAccent} opacity={1} mobile={mobile} />

      <Sky dusk green={theme.secondaryAccent} opacity={night} mobile={mobile}>
        {/* Squared, so the stars hold off until the sky is properly dark
            rather than hanging in a blue one. */}
        <div className="utStars" style={{ opacity: night * night }}>
          <StarField colour="#FFFFFF" active={dusk} />
        </div>
      </Sky>

      <div
        style={{
          position: "absolute",
          top: `${body.top * 100}%`,
          right: `${body.right * 100}%`,
          width: body.size,
          height: body.size,
        }}
      >
        <CelestialSphere
          size={body.size}
          theta={spin.theta}
          effort={spin.effort}
          sun={SUN}
          moon={MOON}
        />
      </div>
    </div>
  );
}
