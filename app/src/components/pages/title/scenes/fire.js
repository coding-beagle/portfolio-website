import React, { useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import { IconGroup } from "../utilities/popovers";
import { clamp, colourToRGB, scaleColour } from "../utilities/usefulFunctions";
import {
  useCanvasScene,
  SceneCanvas,
  Particle,
  ParticleSystem,
  createPointerTracker,
  clearCanvas,
  scatterWithMinDistance,
} from "../utilities/engine";

const TAU = Math.PI * 2;

/**
 * How long an ember burns, in frames at normal simulation speed. The spread
 * matters more than the mean — a flame whose motes all die at the same height
 * has a flat top, which nothing in nature does.
 */
const MIN_LIFESPAN = 45;
const LIFESPAN_SPREAD = 70;

/** How many logs the hearth is stocked back up to, and when that happens. */
const LOG_TARGET = 8;
const LOG_REFILL_BELOW = 4;
const LOG_MIN_SEPARATION = 150;
const LOG_MIN_RADIUS = 11;
const LOG_RADIUS_SPREAD = 19;

/** Frames a log takes to burn away once it is fully alight. */
const LOG_BURN_FRAMES = 1400;
/** Frames a log takes to go from just-caught to fully alight. */
const LOG_CATCH_FRAMES = 90;
/**
 * The heat below which an ember has stopped being flame and become smoke.
 *
 * Above it the ember is still part of the column and is held to the fire's
 * axis — so the base of a fire carried on the cursor comes with it. Below it
 * the ember is let go entirely: whatever draught it drifts off on, it keeps,
 * and the plume left behind stays where it was made rather than swinging
 * around after the pointer.
 */
const DETACH_HEAT = 0.35;

/** How wide the flame the cursor carries is, in the absence of a log. */
const TORCH_RADIUS = 15;

/**
 * Wood, and what is left of it.
 *
 * No theme has a brown in it, and a log that is any other colour stops reading
 * as a log — so this is the one thing in the scene that is not drawn out of
 * the palette. Both ends sit dark enough to hold against the light theme and
 * warm enough to hold against the dark one.
 */
const WOOD_COLOUR = "#7a4a21";
const CHAR_COLOUR = "#2b1a10";

/**
 * The heat ramp is sampled into this many steps.
 *
 * Every ember re-reads its colour every frame, and building `#rrggbb` strings
 * hundreds of times a frame costs more than the physics does. Quantising the
 * ramp turns that into an array index, and keeps the number of distinct colour
 * strings the renderer has to parse down to this many for the whole scene.
 */
const HEAT_STEPS = 96;

/** Perceived brightness of a hex colour, 0..1. */
const luminanceOf = (hex) => {
  const { r, g, b } = colourToRGB(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/** Walk a list of colour stops as one continuous gradient. */
const sampleStops = (stops, t) => {
  const scaled = clamp(t, 0, 1) * (stops.length - 1);
  const index = Math.min(Math.floor(scaled), stops.length - 2);
  return scaleColour(stops[index], stops[index + 1], scaled - index);
};

/**
 * Build the cold-to-hot ramp an ember's colour is looked up in.
 *
 * On a dark page the flame is light the canvas adds to its background, so the
 * hot end is the brightest colour the theme has and the cold end dims away to
 * nothing. On a light page there is no headroom to add into: the flame is
 * painted over the background instead, so the ramp runs the other way — a
 * dying ember darkens into smoke rather than fading out.
 *
 * @param {object} theme
 * @param {boolean} additive  whether the flame is being added to the page
 */
const buildHeatRamp = (theme, additive) => {
  const stops = additive
    ? [theme.tertiaryAccent, theme.quarternaryAccent, theme.accent]
    : [theme.accent, theme.tertiaryAccent, theme.quarternaryAccent];

  // What "burnt out" looks like: black adds nothing, the page colour hides.
  const spent = additive ? "#000000" : theme.primary;

  const ramp = new Array(HEAT_STEPS);
  for (let step = 0; step < HEAT_STEPS; step++) {
    const heat = step / (HEAT_STEPS - 1);
    // The coolest fifth of the ramp is where an ember goes out, so the last
    // of its colour is spent over that stretch rather than at the very end.
    const remaining = clamp(heat / 0.2, 0, 1);
    ramp[step] = scaleColour(spent, sampleStops(stops, heat), remaining);
  }
  return ramp;
};

export default function Fire({ visibleUI }) {
  const { theme } = useTheme();
  // Well off-canvas, so nothing is alight until the pointer actually arrives.
  const mousePosRef = useRef({ x: -10000, y: -10000 });
  const simulationSpeedRef = useRef(100);
  const embersPerLogRef = useRef(45);
  const [, setRender] = useState(0);

  const canvasRef = useCanvasScene(({ canvas, ctx, onCleanup }) => {
    onCleanup(createPointerTracker(canvas, { posRef: mousePosRef }));

    const additive = luminanceOf(theme.primary) < 0.5;
    const heatRamp = buildHeatRamp(theme, additive);

    /**
     * Somewhere on a burning face for an ember to come off — flattened, and
     * lifted onto the top of the fuel rather than out through the middle of
     * it. Works for anything with a position and a radius, which is both a
     * log and the flame on the cursor.
     */
    const emissionPoint = (source) => {
      const angle = Math.random() * TAU;
      const radius = Math.sqrt(Math.random()) * source.radius * 0.85;
      return {
        x: source.x + Math.cos(angle) * radius,
        y: source.y + Math.sin(angle) * radius * 0.35 - source.radius * 0.35,
      };
    };

    /**
     * The flame the cursor carries.
     *
     * It is a fire source like a log is, except that it never burns down and
     * its position is read live — which is what makes the base of the flame
     * follow the pointer. Only the base: an ember that has cooled past
     * `DETACH_HEAT` stops being held to it, so what trails behind is smoke
     * standing where it was made.
     */
    const torch = {
      baseRadius: TORCH_RADIUS,
      radius: TORCH_RADIUS,
      ignition: 1,
      get x() {
        return mousePosRef.current.x;
      },
      get y() {
        return mousePosRef.current.y;
      },
      /** The pointer starts far off-canvas, so there is no flame until it
       * arrives — however it arrives, mouse or finger. */
      get lit() {
        return mousePosRef.current.x > -1000;
      },
    };

    /**
     * A log: fuel that has to be lit before it does anything.
     *
     * `ignition` is how far the fire has taken hold, and it is the log's whole
     * contribution to the scene — it sets how fast the fuel goes and how many
     * embers the log is entitled to.
     */
    class Log {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.baseRadius = LOG_MIN_RADIUS + Math.random() * LOG_RADIUS_SPREAD;
        this.fuel = 1;
        this.ignition = 0;
      }

      /** Burns down as its fuel goes, so a spent log is a stub. */
      get radius() {
        return this.baseRadius * (0.4 + 0.6 * this.fuel);
      }

      get alight() {
        return this.ignition > 0;
      }

      light() {
        // A hair above zero, so `alight` is true from this frame on and the
        // catch still has to run its course.
        if (this.ignition === 0) this.ignition = 0.001;
      }

      update(dt) {
        if (!this.alight) return;
        this.ignition = Math.min(1, this.ignition + dt / LOG_CATCH_FRAMES);
        this.fuel = Math.max(
          0,
          this.fuel - (dt / LOG_BURN_FRAMES) * this.ignition
        );
      }

      /** A brown circle, and nothing else. It chars and shrinks as it goes. */
      draw(context) {
        context.beginPath();
        context.arc(this.x, this.y, this.radius, 0, TAU);
        context.fillStyle = scaleColour(CHAR_COLOUR, WOOD_COLOUR, this.fuel);
        context.fill();
        context.closePath();
      }
    }

    const margin = LOG_MIN_RADIUS + LOG_RADIUS_SPREAD + 20;

    /**
     * How far apart logs are kept. A phone in portrait has nowhere near the
     * room a desktop does, so the separation gives way rather than the
     * scattering quietly failing to place anything.
     */
    const separation = () =>
      Math.min(LOG_MIN_SEPARATION, Math.min(canvas.width, canvas.height) / 3.2);

    /**
     * The hearth: keeps logs on the floor, and clears the ashes.
     *
     * Logs are only restocked once the pile has actually run down, rather than
     * one-in-one-out — a hearth that is always exactly full never looks like
     * anything is being consumed.
     */
    const hearth = {
      logs: [],
      /**
       * Set when a log burns away, cleared by the restock it triggers.
       *
       * Without the latch a canvas too cramped to hold `LOG_TARGET` logs would
       * sit permanently under the threshold and re-run the rejection sampling
       * every single frame. This way a restock is attempted once per log
       * consumed, and a hearth that can only fit four simply keeps four.
       */
      restockDue: true,

      /** Log positions are scattered, but never on top of one another. */
      restock() {
        const wanted = LOG_TARGET - this.logs.length;
        if (wanted <= 0) return;

        const minDistance = separation();
        const placed = scatterWithMinDistance({
          count: wanted,
          minDistance,
          sample: () => ({
            x: margin + Math.random() * Math.max(1, canvas.width - margin * 2),
            y: margin + Math.random() * Math.max(1, canvas.height - margin * 2),
          }),
        });

        // `scatterWithMinDistance` only knows about the points it is placing,
        // so the logs already burning have to be kept clear separately.
        placed.forEach((point) => {
          const crowded = this.logs.some(
            (log) => Math.hypot(log.x - point.x, log.y - point.y) < minDistance
          );
          if (!crowded) this.logs.push(new Log(point.x, point.y));
        });
      },

      /** Bring any log the viewport has shrunk past back onto the canvas. */
      reflow() {
        this.logs.forEach((log) => {
          log.x = clamp(log.x, margin, Math.max(margin, canvas.width - margin));
          log.y = clamp(log.y, margin, Math.max(margin, canvas.height - margin));
        });
      },

      update(dt) {
        const pointer = mousePosRef.current;

        this.logs.forEach((log) => {
          log.update(dt);

          // The cursor is the only thing that lights anything. Fire does not
          // spread between logs and nothing catches on its own, so the pile
          // stays dark until it is touched — and a log, once lit, is then
          // left to it. The pointer has no further hold over that flame,
          // which is why its smoke stands still while the cursor moves on.
          if (
            !log.alight &&
            Math.hypot(pointer.x - log.x, pointer.y - log.y) < log.radius + 10
          ) {
            log.light();
          }
        });

        const before = this.logs.length;
        this.logs = this.logs.filter((log) => log.fuel > 0);
        if (this.logs.length < before) this.restockDue = true;

        if (this.restockDue && this.logs.length < LOG_REFILL_BELOW) {
          this.restock();
          this.restockDue = false;
        }
      },

      /** Everything currently throwing embers: the lit logs, and the cursor. */
      sources() {
        const lit = this.logs.filter((log) => log.alight);
        return torch.lit ? [...lit, torch] : lit;
      },

      /**
       * The pool is shared out a slider's worth of embers per source, weighted
       * by how far each one has caught — so a log that has only just taken
       * smokes gently and works up to a full plume.
       */
      totalIgnition() {
        return this.sources().reduce((sum, source) => sum + source.ignition, 0);
      },

      /** Pick a source to emit from, favouring the ones burning hardest. */
      pickBurning() {
        const sources = this.sources();
        const total = sources.reduce((sum, source) => sum + source.ignition, 0);
        if (total === 0) return null;

        let choice = Math.random() * total;
        for (const source of sources) {
          choice -= source.ignition;
          if (choice <= 0) return source;
        }
        return sources[sources.length - 1];
      },

      draw(context) {
        this.logs.forEach((log) => log.draw(context));
      },
    };

    /**
     * One mote of burning gas, thrown off a particular log.
     *
     * The old version worked the other way round: an ember was hot because it
     * was crowded, which meant every ember measuring its distance to every
     * other one, twice, every frame — and crowding is not what makes a flame
     * hot in the first place. A flame is hot at the bottom and cools as it
     * climbs, so heat is just age here. That is O(1) per ember, and the shape
     * comes out right for free: hot motes are buoyant and shoot up through a
     * narrow throat, cool ones stall, spread and wander.
     */
    class Ember extends Particle {
      constructor() {
        super(0, 0, { size: 1 });
        this.reset(true);
      }

      /**
       * Send the ember back to a burning source — not necessarily the one it
       * came off last, since that one may since have burnt out.
       *
       * @param {boolean} [stagger] spread the starting age over the whole
       *   lifespan. Without it every ember in a freshly filled pool dies on
       *   the same frame and the flame pulses in lockstep for ever after.
       */
      reset(stagger = false) {
        const source = hearth.pickBurning();
        this.source = source;

        if (!source) {
          // Nothing is alight. Park it: a zero radius draws nothing on either
          // the GPU or the 2d path, and `sync` will be along to trim the pool.
          this.size = 0;
          this.baseSize = 0;
          this.age = 0;
          this.lifespan = 1;
          return;
        }

        const { x, y } = emissionPoint(source);
        this.x = x;
        this.y = y;

        this.vx = (Math.random() - 0.5) * 0.6;
        this.vy = -(0.3 + Math.random() * 0.6);

        this.baseSize = 0.7 + Math.random() * 1.6;
        this.size = this.baseSize;
        this.seed = Math.random() * TAU;

        // A bigger log carries a taller flame, because its embers live longer.
        const reach = 0.6 + source.baseRadius / 40;
        this.lifespan = (MIN_LIFESPAN + Math.random() * LIFESPAN_SPREAD) * reach;
        this.age = stagger ? Math.random() * this.lifespan : 0;

        // An ember that resets partway through a frame is drawn before its
        // next update, so it leaves here already looking like fresh fuel
        // rather than wearing the colour it died in.
        this.color = heatRamp[HEAT_STEPS - 1];
      }

      /**
       * @param {number} dt    frames elapsed, scaled by the speed slider
       * @param {number} time  seconds since the scene started, for the
       *   turbulence field — shared by every ember so they all swirl in the
       *   same draught rather than each in its own.
       */
      update(dt, time) {
        this.age += dt;
        if (this.age >= this.lifespan) {
          this.reset();
          return;
        }
        if (!this.source) return;

        const life = 1 - this.age / this.lifespan;
        // Squared, so the ember spends only a short stretch at full heat and a
        // long one cooling. That is what gives a compact bright throat under a
        // long dim plume, rather than an evenly lit column.
        const heat = life * life;

        // Hot gas is buoyant; once it has cooled it is just soot falling out
        // of the column.
        this.vy -= 0.2 * heat * dt;
        this.vy += 0.035 * (1 - heat) * dt;

        // Two waves of different wavelengths read as one irregular draught,
        // and the per-ember phase keeps neighbours from moving as a sheet.
        const wander =
          Math.sin(this.y * 0.022 + time * 1.6 + this.seed) +
          0.5 * Math.sin(this.y * 0.058 - time * 2.7 + this.seed * 1.7);
        // Only what has cooled gets pushed around — the throat holds steady
        // while the tip whips about.
        this.vx += wander * 0.09 * (1 - heat) * dt;

        // Fresh air is drawn in over the fire, which is what pinches the
        // flame in above the fuel instead of letting it splay straight out.
        //
        // Only while the ember is still flame. Past `DETACH_HEAT` it is smoke,
        // and smoke is let go: nothing pulls on it again. That is the whole
        // difference between a flame the cursor carries — whose base comes
        // along, because its hot embers are still held to the source — and the
        // old version, where the entire plume up to the last cold wisp snapped
        // sideways every time the pointer moved.
        if (heat > DETACH_HEAT) {
          this.vx += (this.source.x - this.x) * 0.008 * heat * dt;
        }

        // Linear drag, so nothing runs away at high simulation speeds.
        this.vx -= this.vx * 0.05 * dt;
        this.vy -= this.vy * 0.016 * dt;

        // Cooling gas expands, so the plume broadens as it rises.
        this.size = this.baseSize * (1 + (1 - life) * 1.8);
        this.color = heatRamp[Math.round(heat * (HEAT_STEPS - 1))];

        this.integrate(dt);
      }
    }

    const flame = new ParticleSystem({
      // Read fresh every frame by `sync`: the pool grows as logs catch and
      // shrinks as they burn out, without the scene having to say so.
      countRef: {
        get current() {
          return embersPerLogRef.current * hearth.totalIgnition();
        },
      },
      spawn: () => new Ember(),
      // Overlapping embers have to add up, or a hundred faint motes stay a
      // hundred faint motes instead of becoming a bright core. On a light
      // page there is nothing to add into, so they are painted normally.
      blend: additive ? "lighter" : "source-over",
    });

    hearth.restock();

    let time = 0;

    return {
      onResize: () => hearth.reflow(),
      frame: () => {
        clearCanvas(ctx, canvas);

        const dt = simulationSpeedRef.current / 100;
        time += dt / 60;

        hearth.update(dt);
        hearth.draw(ctx);
        flame.step(ctx, dt, time);
      },
      cleanup: () => {
        flame.clear();
        hearth.logs = [];
      },
    };
  }, [theme]);

  return (
    <>
      <SceneCanvas ref={canvasRef} />

      {visibleUI && (
        <div style={{ zIndex: 3000 }}>
          <ChangerGroup
            valueArrays={[
              {
                title: "Embers per Log:",
                valueRef: embersPerLogRef,
                minValue: "5",
                maxValue: "100",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Simulation Speed:",
                valueRef: simulationSpeedRef,
                minValue: "1",
                maxValue: "200.0",
                type: CHANGER_TYPE.SLIDER,
              },
            ]}
            rerenderSetter={setRender}
          />

          <IconGroup icons={[{ type: "MOUSE" }]} />
        </div>
      )}
    </>
  );
}
