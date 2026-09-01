import React, { useEffect, useRef, useState } from "react";

/**
 * One being with two hemispheres — sun on one side, moon on the other — turning
 * about its vertical axis.
 *
 * A CSS `rotateY` cannot do this: it flips a flat plane, so the silhouette
 * collapses to a line edge-on and the markings slide as if painted on card. The
 * geometry here is the real projection instead, all of it a function of the
 * rotation `theta`:
 *
 *   a point at longitude φ sits at screen x = R·sin(φ + θ)
 *   and faces us only while cos(φ + θ) > 0
 *
 * Everything follows from that. The boundary between the hemispheres is a
 * meridian, and a meridian projects to an ellipse of half-width R·|cos θ| — so
 * the terminator bows out and flattens through the turn rather than wiping
 * across as a straight edge. Each face rides the same mapping: it slides
 * towards the limb and squashes to nothing as it arrives, which is what selling
 * it as a sphere actually depends on.
 */

export const SPIN_MS = 1350;

// How far back it winds before it goes, and how long it spends doing it, as
// fractions of the whole move.
const WIND_BACK = 0.2;
const WIND_UNTIL = 0.3;

/**
 * The turn: a pronounced wind-up the wrong way, easing out as it loads, then
 * the twist itself on a cubic in-out — slow to break away, quickest through the
 * middle where the terminator is crossing, and settling rather than stopping.
 */
export function spinEase(t) {
  if (t < WIND_UNTIL) {
    const u = t / WIND_UNTIL;
    return -WIND_BACK * (1 - (1 - u) ** 3);
  }
  const u = (t - WIND_UNTIL) / (1 - WIND_UNTIL);

  const cubic = u < 0.5
    ? (1 - Math.sqrt(1 - Math.pow(2 * u, 2))) / 2
    : (Math.sqrt(1 - Math.pow(-2 * u + 2, 2)) + 1) / 2;
  return -WIND_BACK + (1 + WIND_BACK) * cubic;
}

const CX = 50;
const CY = 50;
const R = 30;

/**
 * Trigonometry does not land on clean numbers — cos(π/2) comes out as 6e-17,
 * which reaches the DOM as "1.83697e-15". Legal in an SVG path, but there is no
 * reason to put exponents in front of a parser, and three decimals is finer
 * than a hundred-unit viewBox can show anyway.
 */
const n = (value) => Number(value.toFixed(3));
const MAX_PUPIL_OFFSET = 3.4;
const FULL_DEFLECTION_AT = 420;

/** Where the pupils should sit, given where the pointer is. */
function useEyeTracking(wrapperRef) {
  const [look, setLook] = useState({ x: 0, y: 0 });

  useEffect(() => {
    let frame = null;
    let pending = null;

    const apply = () => {
      frame = null;
      const node = wrapperRef.current;
      if (!node || !pending) return;
      const box = node.getBoundingClientRect();
      const dx = pending.x - (box.left + box.width / 2);
      const dy = pending.y - (box.top + box.height / 2);
      const distance = Math.hypot(dx, dy) || 1;
      // Normalised direction, scaled by how close the pointer is: a cursor on
      // the far side of the screen barely moves them.
      const reach = Math.min(1, distance / FULL_DEFLECTION_AT);
      setLook({
        x: (dx / distance) * MAX_PUPIL_OFFSET * reach,
        y: (dy / distance) * MAX_PUPIL_OFFSET * reach,
      });
    };

    const onPointer = (event) => {
      pending = { x: event.clientX, y: event.clientY };
      // Coalesced into a frame: pointermove fires far faster than anything can
      // usefully be drawn.
      if (frame === null) frame = requestAnimationFrame(apply);
    };

    window.addEventListener("pointermove", onPointer, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointer);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [wrapperRef]);

  return look;
}

/** An occasional blink, because a face that never blinks is unsettling. */
function useBlink() {
  const [blinking, setBlinking] = useState(false);
  useEffect(() => {
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return undefined;

    let timer = null;
    const schedule = () => {
      timer = setTimeout(() => {
        setBlinking(true);
        setTimeout(() => setBlinking(false), 130);
        schedule();
      }, 3800 + Math.random() * 4200);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
  return blinking;
}

/**
 * The transform that puts a hemisphere's markings where the rotation would.
 * Composed about the sphere's centre, so a feature `u` from the middle of its
 * face lands at `R·sin(φ+θ) + u·cos(φ+θ)` — the projection, not an impression
 * of one.
 */
export function faceProjection(theta, longitude) {
  const angle = theta + longitude;
  const cos = Math.cos(angle);
  return {
    facing: cos > 0.001,
    transform:
      `translate(${n(CX + R * Math.sin(angle))} ${CY}) ` +
      `scale(${n(cos)} 1) translate(${-CX} ${-CY})`,
  };
}

/**
 * The sun hemisphere as a path: an ellipse arc down the terminator, then the
 * limb back up whichever side the sun is on. An `rx` of zero is not a special
 * case — SVG draws that arc as the straight line it geometrically is, which is
 * exactly what a meridian looks like halfway through the turn.
 *
 * Both of the sun's bounding meridians sit at |x| = R·|cos θ|, but only one is
 * on the near side, and which one flips with the direction of travel. Assuming
 * it is always the same one works right until the sphere turns the other way,
 * and then the terminator lands on the wrong side of the face.
 */
export function litHemispherePath(theta) {
  const turningRight = Math.sin(theta) >= 0;
  // The near meridian: φ = −90° while turning one way, φ = +90° the other.
  const offset = (turningRight ? -1 : 1) * R * Math.cos(theta);
  const bulge = offset > 0 ? 1 : 0;
  // The sun lies on the side its own centre is, so the limb closes that side.
  const limb = turningRight ? 0 : 1;
  return (
    `M ${CX} ${CY - R} ` +
    `A ${n(Math.abs(offset))} ${R} 0 0 ${bulge} ${CX} ${CY + R} ` +
    `A ${R} ${R} 0 0 ${limb} ${CX} ${CY - R}`
  );
}

/**
 * The mouth, from an easy curve at rest to a grimace under load, and the eyes
 * narrowing with it. Turning yourself half way round is work.
 */
export function mouthPath(effort) {
  const corners = n(58 + 2 * effort);
  const middle = n(64 - 9 * effort);
  return `M43 ${corners} Q50 ${middle} 57 ${corners}`;
}

export const eyeHeight = (effort, shut) => (shut ? 0.7 : n(6 - 3.4 * effort));

function Face({ palette, projection, look, blinking, effort, craters = [], name }) {
  if (!projection.facing) return null;
  // Already screwed shut with effort, so a blink on top would read as a glitch.
  const shut = blinking && effort < 0.15;

  return (
    <g data-face={name} transform={projection.transform}>
      {craters.map(([cx, cy, r]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill={palette.face} opacity="0.16" />
      ))}
      {[41, 59].map((cx) => (
        <g key={cx}>
          <ellipse
            cx={cx}
            cy="46"
            rx="4.6"
            ry={eyeHeight(effort, shut)}
            fill={palette.face}
          />
          {!shut && (
            <circle
              cx={cx + look.x}
              cy={46 + look.y}
              r={n(2.4 - 0.9 * effort)}
              fill={palette.disc}
            />
          )}
        </g>
      ))}
      {/* A single arc for a mouth — anything more stops reading as minimal. */}
      <path
        data-mouth=""
        d={mouthPath(effort)}
        fill="none"
        stroke={palette.face}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </g>
  );
}

export default function CelestialSphere({ size, theta, effort = 0, sun, moon }) {
  const wrapper = useRef(null);
  const look = useEyeTracking(wrapper);
  const blinking = useBlink();

  const cos = Math.cos(theta);

  return (
    <div ref={wrapper} aria-hidden="true" style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        data-celestial="sphere"
        style={{ display: "block", overflow: "visible" }}
      >
        <defs>
          <clipPath id="utSphereClip">
            <circle cx={CX} cy={CY} r={R} />
          </clipPath>
          {[
            ["utGlowSun", sun.glow],
            ["utGlowMoon", moon.glow],
          ].map(([id, colour]) => (
            <radialGradient key={id} id={id}>
              <stop offset="55%" stopColor={colour} stopOpacity="0.55" />
              <stop offset="100%" stopColor={colour} stopOpacity="0" />
            </radialGradient>
          ))}
          {/* Fixed to the viewer, not to the surface: light does not rotate
              with the thing it is falling on. */}
          <radialGradient id="utSphereShade" cx="35%" cy="30%" r="78%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.34" />
            <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.32" />
          </radialGradient>
        </defs>

        {/* The halo belongs to whichever hemisphere is facing us, so it turns
            over with them rather than switching at a threshold. */}
        <circle cx={CX} cy={CY} r="50" fill="url(#utGlowSun)" opacity={Math.max(0, cos)} />
        <circle cx={CX} cy={CY} r="50" fill="url(#utGlowMoon)" opacity={Math.max(0, -cos)} />

        <g clipPath="url(#utSphereClip)">
          <circle cx={CX} cy={CY} r={R} fill={moon.disc} />
          <path data-terminator="" d={litHemispherePath(theta)} fill={sun.disc} />

          <Face
            name="sun"
            palette={sun}
            projection={faceProjection(theta, 0)}
            look={look}
            blinking={blinking}
            effort={effort}
          />
          <Face
            name="moon"
            palette={moon}
            projection={faceProjection(theta, Math.PI)}
            look={look}
            blinking={blinking}
            effort={effort}
            craters={[
              [36, 34, 5],
              [64, 30, 3.4],
              [60, 68, 4.2],
            ]}
          />

          <circle cx={CX} cy={CY} r={R} fill="url(#utSphereShade)" />
        </g>
      </svg>
    </div>
  );
}
