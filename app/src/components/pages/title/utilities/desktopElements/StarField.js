import React, { useEffect, useRef } from "react";
import { getCloseColour } from "../usefulFunctions";

/**
 * The night sky over the desktop.
 *
 * A canvas rather than SVG nodes: a hundred stars redrawn thirty times a second
 * is a hundred DOM mutations a frame otherwise, on a layer that sits behind an
 * interactive desktop and must never cost it anything.
 *
 * Star positions are stored normalised, so a resize — or a phone rotating —
 * moves them with the sky instead of clipping them or leaving a bare corner.
 * They are also generated once and kept: the sky changes hands between day and
 * night, which restarts the loop below, and a field that was rebuilt each time
 * visibly jumped as the theme was toggled. The comets keep their flight for the
 * same reason.
 *
 * The comets follow the stars scene's: a round head drifting in a direction of
 * its own with a trail of circles shrinking behind it, fading up as it sets out
 * and away as it finishes, then respawning somewhere else. What it is not is a
 * drawn line — a streak at a fixed angle was the thing that looked wrong.
 */
const STAR_COUNT = 110;
const FRAME_MS = 1000 / 30;
const COMET_COUNT = 2;
const COMET_LIFE = 260;
const TRAIL_SHRINK = 0.1;

const createStars = () =>
  Array.from({ length: STAR_COUNT }, () => ({
    x: Math.random(),
    // Squared, so stars crowd towards the top of the sky and thin out where
    // the hill is going to be.
    y: Math.random() ** 2,
    radius: 0.4 + Math.random() * 1.3,
    phase: Math.random() * Math.PI * 2,
    speed: 0.6 + Math.random() * 1.4,
  }));

const spawnComet = (width, height) => ({
  x: Math.random() * width,
  y: Math.random() * height * 0.6,
  dx: Math.random() * 2 - 1,
  dy: Math.random() * 2 - 1,
  size: 2 + Math.random() * 2.5,
  life: 0,
  active: false,
  // The same steep power as the scene uses: most comets sit still for a long
  // time, so two of them rarely fly at once.
  chance: Math.random() ** 10,
  trail: [],
});

export default function StarField({ colour, active }) {
  const canvasRef = useRef(null);
  // Everything with a position of its own lives out here, so it survives the
  // effect being torn down and set up again when the sky changes hands.
  const starsRef = useRef(null);
  const cometsRef = useRef([]);
  if (starsRef.current === null) starsRef.current = createStars();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    // A browser can refuse a context — too many canvases on a page is the usual
    // reason. The sky behind is a complete picture on its own, so the stars
    // simply do not appear rather than taking the scene down with them.
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const stars = starsRef.current;
    const comets = cometsRef.current;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (comets.length === 0) {
        for (let i = 0; i < COMET_COUNT; i += 1) {
          comets.push(spawnComet(width, height));
        }
      }
    };
    resize();
    window.addEventListener("resize", resize);

    const stepComet = (comet, width, height) => {
      if (!comet.active) {
        if (Math.random() < comet.chance / 2) comet.active = true;
        return;
      }

      comet.life += 1;
      comet.x += comet.dx;
      comet.y += comet.dy;

      comet.trail.push({ x: comet.x, y: comet.y, size: comet.size });
      // Every mark left behind shrinks, which is what tapers the tail.
      comet.trail = comet.trail
        .map((mark) => ({ ...mark, size: mark.size - TRAIL_SHRINK }))
        .filter((mark) => mark.size > 0);

      const offScreen =
        comet.x < -80 || comet.x > width + 80 || comet.y < -80 || comet.y > height + 80;
      if (comet.life > COMET_LIFE || offScreen) {
        Object.assign(comet, spawnComet(width, height));
      }
    };

    /** Up over the first quarter of its life, away over the last. */
    const cometAlpha = (comet) => {
      const quarter = COMET_LIFE / 4;
      if (comet.life < quarter) return comet.life / quarter;
      if (comet.life > COMET_LIFE - quarter) {
        return Math.max(0, (COMET_LIFE - comet.life) / quarter);
      }
      return 1;
    };

    const draw = (now) => {
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);

      stars.forEach((star) => {
        const twinkle = reduceMotion
          ? 0.75
          : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin((now / 1000) * star.speed + star.phase));
        ctx.globalAlpha = twinkle;
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(star.x * width, star.y * height * 0.72, star.radius, 0, Math.PI * 2);
        ctx.fill();
      });

      if (!reduceMotion) {
        comets.forEach((comet) => {
          stepComet(comet, width, height);
          if (!comet.active) return;
          const alpha = cometAlpha(comet);
          comet.trail.forEach((mark) => {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = getCloseColour(colour, 20, 10, 10);
            ctx.beginPath();
            ctx.arc(mark.x, mark.y, mark.size, 0, Math.PI * 2);
            ctx.fill();
          });
        });
      }

      ctx.globalAlpha = 1;
    };

    let frame = null;
    let last = 0;
    const loop = (now) => {
      // Thirty frames a second is plenty for a twinkle, and half the battery of
      // sixty on a phone that is only showing a wallpaper.
      if (now - last >= FRAME_MS) {
        last = now;
        draw(now);
      }
      frame = requestAnimationFrame(loop);
    };

    if (active) {
      loop(performance.now());
    } else {
      draw(performance.now());
    }

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [colour, active]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
        // The desktop below owns the pointer: the marquee starts on the surface.
        pointerEvents: "none",
      }}
    />
  );
}
