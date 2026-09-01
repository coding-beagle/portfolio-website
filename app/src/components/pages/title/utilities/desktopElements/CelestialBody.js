import React, { useCallback, useEffect, useRef, useState } from "react";
import CelestialSphere from "./CelestialSphere";
import { HILL_VIEW, ridgeSlope, ridgeY } from "./hill";

/**
 * The sun and moon, and what happens when you will not leave it alone.
 *
 * Poking it once is a face: it scowls, and gets over it. Keep poking and it
 * gives up on the sky altogether — it drops out, lands on the hill and rolls
 * until it finds somewhere flat, and from then on it is a ball to be pushed
 * around until it is carried back to where it belongs.
 *
 * The physics is deliberately small: gravity, a bounce off the ridge resolved
 * about the surface normal, and enough rolling resistance that it settles into
 * a hollow rather than trundling forever. It only runs while the ball is
 * actually moving; once it is asleep the loop stops.
 */

// A poke counts for this long, and this many inside that window is the end of
// its patience.
const POKE_WINDOW = 2200;
const POKES_TO_FALL = 5;

const GRAVITY = 2400;
const RESTITUTION = 0.42;
// Per frame while it is touching the ground, which is what brings it to a stop.
const ROLL_FRICTION = 0.985;
const REST_SPEED = 18;
// A press has to travel this far before it is a drag rather than a poke.
const DRAG_THRESHOLD = 4;
// How near its own place it has to be let go to be back in the sky, as a
// multiple of its size.
const RESTORE_WITHIN = 1;
// The disc fills this much of its box; the rest is the halo, which is not a
// thing you can grab hold of.
const DISC = 0.6;

/** The point a press or a move is at, whether a mouse or a finger carried it. */
const pointOf = (event) =>
  event.touches?.[0] ?? event.changedTouches?.[0] ?? event;

export default function CelestialBody({
  size,
  top,
  right,
  theta,
  effort = 0,
  sun,
  moon,
  mobile = false,
  hillFraction,
}) {
  // "sky" is where it belongs; "loose" is everything after it has fallen out,
  // whether it is bouncing, rolling, sitting there or being carried.
  const [mode, setMode] = useState("sky");
  const [place, setPlace] = useState(null);
  const [held, setHeld] = useState(false);
  // Awake while it still has somewhere to go. Sleeping stops the loop.
  const [awake, setAwake] = useState(false);
  const [pokes, setPokes] = useState([]);
  // Counted rather than flagged: the two animations below are identical, and
  // alternating between them is what restarts the shake on a second poke
  // without remounting the sphere and losing its blink.
  const [nudges, setNudges] = useState(0);

  const motion = useRef({ x: 0, y: 0, vx: 0, vy: 0, angle: 0 });
  const press = useRef(null);

  const radius = size * (DISC / 2);

  /** Where in the sky it sits, as the centre of the disc. */
  const home = useCallback(
    () => ({
      x: window.innerWidth * (1 - right) - size / 2,
      y: window.innerHeight * top + size / 2,
    }),
    [right, top, size]
  );

  /** The top of the hill under a point, and which way it is leaning there. */
  const ground = useCallback(
    (x) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const band = height * hillFraction;
      const across = (x / width) * HILL_VIEW.width;
      return {
        y: height - band + (ridgeY(across) / HILL_VIEW.height) * band,
        slope:
          ridgeSlope(across) * (HILL_VIEW.width / width) * (band / HILL_VIEW.height),
      };
    },
    [hillFraction]
  );

  // --- Being prodded -----------------------------------------------------

  const poke = useCallback(() => {
    const now = Date.now();
    setPokes((prev) => [...prev.filter((at) => now - at < POKE_WINDOW), now]);
    setNudges((prev) => prev + 1);
  }, []);

  // Each poke is forgotten on its own, so annoyance ebbs away rather than
  // being dropped all at once when the last one expires.
  useEffect(() => {
    if (pokes.length === 0) return undefined;
    const timer = setTimeout(
      () => setPokes((prev) => prev.slice(1)),
      POKE_WINDOW
    );
    return () => clearTimeout(timer);
  }, [pokes]);

  useEffect(() => {
    if (mode !== "sky" || pokes.length < POKES_TO_FALL) return;
    const from = home();
    motion.current = {
      ...from,
      // Whichever way it was last poked from is roughly the way it topples.
      vx: (Math.random() - 0.5) * 220,
      vy: 40,
      angle: 0,
    };
    setPlace({ ...from, angle: 0 });
    setPokes([]);
    setMode("loose");
    setAwake(true);
  }, [pokes, mode, home]);

  // --- Falling and rolling ----------------------------------------------

  useEffect(() => {
    if (mode !== "loose" || held || !awake) return undefined;

    let frame = null;
    let last = performance.now();

    const tick = (now) => {
      // Capped, so a tab coming back from the background does not teleport it
      // through the hill in one enormous step.
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;

      const state = motion.current;
      state.vy += GRAVITY * dt;
      state.x += state.vx * dt;
      state.y += state.vy * dt;

      const width = window.innerWidth;
      if (state.x < radius) {
        state.x = radius;
        state.vx = Math.abs(state.vx) * RESTITUTION;
      } else if (state.x > width - radius) {
        state.x = width - radius;
        state.vx = -Math.abs(state.vx) * RESTITUTION;
      }
      // The top of the page is as solid as the sides: thrown hard enough it
      // comes back off the ceiling rather than disappearing above it.
      if (state.y < radius) {
        state.y = radius;
        state.vy = Math.abs(state.vy) * RESTITUTION;
      }

      const { y: surface, slope } = ground(state.x);
      const resting = surface - radius;
      let touching = false;
      if (state.y >= resting) {
        touching = true;
        state.y = resting;
        // Resolved about the slope rather than about the horizontal: bouncing
        // straight up off a hillside is what makes a ball look weightless.
        const length = Math.hypot(1, slope);
        const tx = 1 / length;
        const ty = slope / length;
        const nx = slope / length;
        const ny = -1 / length;

        let along = state.vx * tx + state.vy * ty;
        let into = state.vx * nx + state.vy * ny;
        if (into < 0) into = -into * RESTITUTION;
        along *= ROLL_FRICTION;

        state.vx = along * tx + into * nx;
        state.vy = along * ty + into * ny;
      }

      // A ball rolls as far as it travels: a full turn per circumference.
      state.angle += ((state.vx * dt) / radius) * (180 / Math.PI);
      setPlace({ x: state.x, y: state.y, angle: state.angle });

      if (touching && Math.hypot(state.vx, state.vy) < REST_SPEED) {
        state.vx = 0;
        state.vy = 0;
        setAwake(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [mode, held, awake, ground, radius]);

  // --- Carrying it about -------------------------------------------------

  const startPress = (event) => {
    if (event.type === "mousedown" && event.button !== 0) return;
    const point = pointOf(event);
    press.current = {
      x: point.clientX,
      y: point.clientY,
      travelled: false,
      // Grabbed where it was actually taken hold of, so it does not jump to
      // centre itself under the pointer.
      offsetX: motion.current.x - point.clientX,
      offsetY: motion.current.y - point.clientY,
      lastX: point.clientX,
      lastY: point.clientY,
      at: performance.now(),
      vx: 0,
      vy: 0,
    };
  };

  useEffect(() => {
    const move = (event) => {
      const grip = press.current;
      if (!grip) return;
      const point = pointOf(event);
      if (point.clientX === undefined) return;

      if (
        !grip.travelled &&
        Math.hypot(point.clientX - grip.x, point.clientY - grip.y) < DRAG_THRESHOLD
      )
        return;
      // Only something already on the ground can be carried; in the sky it is
      // fixed, and a drag across it is nothing more than a missed poke.
      if (mode !== "loose") return;

      if (!grip.travelled) {
        grip.travelled = true;
        setHeld(true);
      }
      if (event.cancelable) event.preventDefault();

      const now = performance.now();
      const gap = Math.max(1, now - grip.at) / 1000;
      grip.vx = (point.clientX - grip.lastX) / gap;
      grip.vy = (point.clientY - grip.lastY) / gap;
      grip.lastX = point.clientX;
      grip.lastY = point.clientY;
      grip.at = now;

      motion.current.x = point.clientX + grip.offsetX;
      motion.current.y = point.clientY + grip.offsetY;
      setPlace({
        x: motion.current.x,
        y: motion.current.y,
        angle: motion.current.angle,
      });
    };

    const end = () => {
      const grip = press.current;
      press.current = null;
      if (!grip) return;

      if (!grip.travelled) {
        poke();
        return;
      }

      setHeld(false);
      const back = home();
      if (Math.hypot(motion.current.x - back.x, motion.current.y - back.y) <
        size * RESTORE_WITHIN) {
        // Put back where it belongs, and no longer sulking about it.
        motion.current = { ...back, vx: 0, vy: 0, angle: 0 };
        setPokes([]);
        setPlace(null);
        setMode("sky");
        setAwake(false);
        return;
      }

      // Thrown rather than dropped, if it was moving when it was let go.
      motion.current.vx = grip.vx;
      motion.current.vy = grip.vy;
      setAwake(true);
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, [mode, home, poke, size]);

  // On the ground it is put out about it whatever else is going on, and a poke
  // on top of that only makes it worse.
  const annoy = Math.min(
    1,
    Math.max(mode === "loose" ? 0.55 : 0, pokes.length / POKES_TO_FALL)
  );

  const box =
    mode === "sky" || !place
      ? { top: `${top * 100}%`, right: `${right * 100}%` }
      : {
          left: place.x - size / 2,
          top: place.y - size / 2,
          transform: `rotate(${place.angle}deg)`,
        };

  return (
    <>
      <style>{`
        @keyframes utBodyShakeA {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          20% { transform: translate(-3%, 1.5%) rotate(-6deg); }
          45% { transform: translate(3%, -1.5%) rotate(5deg); }
          70% { transform: translate(-1.5%, 0.5%) rotate(-2.5deg); }
        }
        @keyframes utBodyShakeB {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          20% { transform: translate(-3%, 1.5%) rotate(-6deg); }
          45% { transform: translate(3%, -1.5%) rotate(5deg); }
          70% { transform: translate(-1.5%, 0.5%) rotate(-2.5deg); }
        }
        .celestialShake {
          width: 100%;
          height: 100%;
          animation-duration: 380ms;
          animation-timing-function: ease-out;
        }
        @media (prefers-reduced-motion: reduce) {
          .celestialShake { animation: none; }
        }
      `}</style>

      {/* Where it goes back to. Only worth showing while it is in the air in
          someone's hand, which is the only moment the answer matters. */}
      {held && (
        <div
          data-celestial-home=""
          aria-hidden="true"
          style={{
            position: "absolute",
            top: `${top * 100}%`,
            right: `${right * 100}%`,
            width: size,
            height: size,
            zIndex: 2,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: `${((1 - DISC) / 2) * 100}%`,
              borderRadius: "50%",
              border: "2px dashed rgba(255,255,255,0.55)",
            }}
          />
        </div>
      )}

      <div
        className="celestialBody"
        style={{
          position: "absolute",
          width: size,
          height: size,
          // Above the desktop's shortcuts, so a ball on the floor can be
          // picked up rather than sitting under the icons.
          zIndex: 2,
          // The box is square and the body is not; only the disc takes presses.
          pointerEvents: "none",
          ...box,
        }}
      >
        {/* The shake lives on its own wrapper: the box outside it is carrying
            the roll, and one transform cannot do both. */}
        <div
          className="celestialShake"
          data-celestial-shake={nudges || undefined}
          style={{
            animationName:
              nudges === 0 ? "none" : nudges % 2 ? "utBodyShakeA" : "utBodyShakeB",
          }}
        >
          <CelestialSphere
            size={size}
            theta={theta}
            effort={effort}
            annoy={annoy}
            sun={sun}
            moon={moon}
          />
        </div>
        <div
          data-celestial-grab=""
          onMouseDown={startPress}
          onTouchStart={startPress}
          style={{
            position: "absolute",
            inset: `${((1 - DISC) / 2) * 100}%`,
            borderRadius: "50%",
            pointerEvents: "auto",
            touchAction: "none",
            // The desktop's own arrow the whole way through: a hand or a
            // grabbing fist over the sky is a cursor Windows never had.
            cursor: "default",
          }}
        />
      </div>
    </>
  );
}
