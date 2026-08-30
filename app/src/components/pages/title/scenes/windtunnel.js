import React, { useContext, useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { MobileContext } from "../../../../contexts/MobileContext";
import { IconGroup } from "../utilities/popovers";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import { clamp, colourToRGB, scaleColour } from "../utilities/usefulFunctions";
import { FluidGrid } from "../utilities/fluid";
import {
  useCanvasScene,
  SceneCanvas,
  Particle,
  ParticleSystem,
  createPointerTracker,
  clearCanvas,
} from "../utilities/engine";

/** What the grid itself is painted as, behind the smoke. */
const VIEW = Object.freeze({
  NONE: 0,
  SMOKE: 1,
  SPEED: 2,
  PRESSURE: 3,
});

const VIEW_NAMES = ["Off", "Smoke", "Speed", "Pressure"];

/** The order the field views are offered in. */
const VIEW_ORDER = [VIEW.NONE, VIEW.SMOKE, VIEW.SPEED, VIEW.PRESSURE];

/** Sixty frames a second of simulated time, whatever the display manages. */
const FRAME_TIME = 1 / 60;

export default function WindTunnel({ visibleUI }) {
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  const mobile = useContext(MobileContext);
  const visibleUIRef = useRef(visibleUI);

  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseDownRef = useRef(false);

  const windSpeedRef = useRef(260);
  const particleCountRef = useRef(mobile ? 800 : 1800);
  const simulationSpeedRef = useRef(100);
  const gridDetailRef = useRef(mobile ? 45 : 70);
  const probeRadiusRef = useRef(45);
  const angleOfAttackRef = useRef(0);
  const viewRef = useRef(VIEW.NONE);

  const [, setRender] = useState(0);

  const canvasRef = useCanvasScene(({ canvas, ctx, onCleanup }) => {
    // How long a mote may live before it is recycled, so the ones that get
    // caught in a recirculation bubble behind the title do not sit there
    // forever while the ports upstream run dry.
    const MAX_MOTE_AGE = 9;
    const SOLVER_PASSES = mobile ? 12 : 20;

    // The page furniture is the test article: the title and the row of link
    // icons are what the air has to get around, and the angle of attack pitches
    // them into the wind.
    const BODY_IDS = ["title", "sceneLabel", "linkIcons"];
    const BODY_PAD = 6;
    // Where along the chord the wing is hung. A quarter back from the leading
    // edge is where a real section's lift acts.
    const PIVOT_ALONG_CHORD = 0.25;

    /**
     * The tight box around an element's text, rather than the element.
     *
     * The title is a full-width `<header>` with its text centred in it, so its
     * own box is a wall across the whole tunnel — a range over its contents
     * measures the letters instead. The same goes for the scene label, and for
     * the icon row it gives the union of the icons.
     */
    const textRect = (element) => {
      if (typeof document.createRange !== "function") return null;
      const range = document.createRange();
      range.selectNodeContents(element);
      if (typeof range.getBoundingClientRect !== "function") return null;

      const rect = range.getBoundingClientRect();
      return rect && rect.width > 0 && rect.height > 0 ? rect : null;
    };

    /** Missing is not the same as transparent: no answer means visible. */
    const opacityOf = (element) => {
      const raw = window.getComputedStyle(element).opacity;
      const value = raw === "" || raw === undefined ? 1 : Number(raw);
      return Number.isFinite(value) ? value : 1;
    };

    /**
     * Undo the rotation a client rect has already been through.
     *
     * Client rects are upright boxes around what is on screen, so a pitched
     * body measures as `w|cos| + h|sin|` across — bigger than the body, and
     * bigger the further it is pitched. Inverting that pair of equations gets
     * the body back. It degenerates at 45 degrees, where both sides
     * contribute equally; the pitch never goes near that, and the raw box is
     * the fallback if it ever does.
     */
    const unrotateSize = (width, height, radians) => {
      const cos = Math.abs(Math.cos(radians));
      const sin = Math.abs(Math.sin(radians));
      const det = cos * cos - sin * sin;
      if (Math.abs(det) < 0.2) return { width, height };
      return {
        width: (width * cos - height * sin) / det,
        height: (height * cos - width * sin) / det,
      };
    };

    const rotateAbout = (point, centre, radians) => {
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const dx = point.x - centre.x;
      const dy = point.y - centre.y;
      return {
        x: centre.x + dx * cos - dy * sin,
        y: centre.y + dx * sin + dy * cos,
      };
    };

    /*
     * The three bodies pitch as one wing, about a single point rather than
     * each about its own middle.
     *
     * That makes the pivot depend on where the bodies are, and where they are
     * depends on the pivot. The way out is that undoing a rotation with the
     * same pivot it was applied with returns the level geometry exactly,
     * whatever that pivot was — so each frame undoes the pitch it last applied,
     * measures the wing level, and pitches again about the point that falls
     * out. A frame where the page does not match what was last set — a body
     * React has just handed back, which carries no rotation yet — costs one
     * frame of wobble and is exact again on the next. The scene starts level,
     * so the first frame measures the truth outright.
     */
    let pivot = null;
    let appliedRadians = 0;

    const unpitchPoint = (point) =>
      pivot ? rotateAbout(point, pivot, -appliedRadians) : point;

    /**
     * One body as it would sit with the wing level: its own box, which is what
     * a transform origin is measured from, and its text, which is what the air
     * actually meets.
     */
    const bodyGeometry = (element) => {
      const box = element.getBoundingClientRect();
      const text = textRect(element);

      const boxCentre = unpitchPoint({
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
      });
      const boxSize = unrotateSize(box.width, box.height, appliedRadians);

      const textCentre = text
        ? unpitchPoint({
            x: text.left + text.width / 2,
            y: text.top + text.height / 2,
          })
        : boxCentre;
      const textSize = text
        ? unrotateSize(text.width, text.height, appliedRadians)
        : { width: element.offsetWidth, height: element.offsetHeight };

      if (!(textSize.width > 0) || !(textSize.height > 0)) return null;
      return { element, boxCentre, boxSize, textCentre, textSize };
    };

    /**
     * Where the wing is hung.
     *
     * The chord is how far the assembly reaches across the flow, and a wing is
     * mounted a quarter of the way along it — which is where its lift acts, and
     * so the point it would naturally turn about.
     */
    const wingPivot = (bodies) => {
      let left = Infinity;
      let right = -Infinity;
      let top = Infinity;
      let bottom = -Infinity;

      bodies.forEach(({ textCentre, textSize }) => {
        left = Math.min(left, textCentre.x - textSize.width / 2);
        right = Math.max(right, textCentre.x + textSize.width / 2);
        top = Math.min(top, textCentre.y - textSize.height / 2);
        bottom = Math.max(bottom, textCentre.y + textSize.height / 2);
      });

      return {
        x: left + (right - left) * PIVOT_ALONG_CHORD,
        y: (top + bottom) / 2,
      };
    };

    /**
     * Pitch one body about the shared point.
     *
     * `rotate` and `transform-origin` are their own CSS properties rather than
     * a transform, so they compose with the shake animation the title already
     * runs instead of fighting it. The origin is measured from the element's
     * own top-left corner, so the shared point has to be expressed per element.
     *
     * Writing a style invalidates the element, so it is only written when it
     * actually changes — including when React has handed back a fresh element
     * that never carried the rotation.
     */
    const pitchBody = ({ element, boxCentre, boxSize }, degrees, at) => {
      const originX = at.x - (boxCentre.x - boxSize.width / 2);
      const originY = at.y - (boxCentre.y - boxSize.height / 2);
      const origin = `${originX.toFixed(2)}px ${originY.toFixed(2)}px`;
      const rotate = `${degrees}deg`;

      const applied = pitched.get(element);
      if (applied && applied.origin === origin && applied.rotate === rotate) {
        return;
      }

      element.style.setProperty("transform-origin", origin);
      element.style.setProperty("rotate", rotate);
      pitched.set(element, { origin, rotate });
    };

    const pitched = new Map();

    const unpitchAll = () => {
      if (pitched.size === 0) return;
      BODY_IDS.forEach((id) => {
        const element = document.getElementById(id);
        if (!element) return;
        element.style.removeProperty("rotate");
        element.style.removeProperty("transform-origin");
      });
      pitched.clear();
    };

    /** A body as a tilted rectangle in canvas coordinates. */
    const bodyPolygon = ({ textCentre, textSize }, radians, at) => {
      const halfW = textSize.width / 2 + BODY_PAD;
      const halfH = textSize.height / 2 + BODY_PAD;

      return [
        [-halfW, -halfH],
        [halfW, -halfH],
        [halfW, halfH],
        [-halfW, halfH],
      ].map(([dx, dy]) =>
        rotateAbout(
          { x: textCentre.x + dx, y: textCentre.y + dy },
          at,
          radians
        )
      );
    };

    onCleanup(
      createPointerTracker(canvas, {
        posRef: mousePosRef,
        downRef: mouseDownRef,
        touchActiveRef: mouseDownRef,
      })
    );

    // Grid detail runs backwards from cell size: more detail, smaller cells.
    const cellSizeFor = (detail) => Math.round(34 - (clamp(detail, 0, 100) / 100) * 22);
    // A frame costs what the grid holds, so a big display gets bigger cells
    // rather than a slideshow.
    const MAX_CELLS = mobile ? 4500 : 9000;

    let grid = null;
    let cellSize = 0;
    let ports = 1;

    const buildGrid = () => {
      cellSize = cellSizeFor(gridDetailRef.current);
      grid = new FluidGrid({
        width: canvas.width,
        height: canvas.height,
        cellSize,
        maxCells: MAX_CELLS,
      });
      // One smoke port every few cells, which is close enough to the rake of
      // nozzles a real tunnel puts across its inlet.
      ports = Math.max(6, Math.floor(grid.numY / 3));
    };

    buildGrid();

    // The pointer doubles as a body you can hold in the flow; its own velocity
    // is what lets you stir the air rather than just block it.
    const probe = { x: 0, y: 0, vx: 0, vy: 0, held: false };
    // How readily the probe takes up the speed the pointer is asking for.
    const PROBE_INERTIA = 0.25;

    /** Where dye enters the tunnel: a band around every port row. */
    const smokeAt = (j) => {
      const spacing = grid.numY / ports;
      return (j + spacing / 2) % spacing < spacing * 0.4 ? 1 : 0;
    };

    class Mote extends Particle {
      constructor() {
        super(0, 0, { size: 1 });
        this.reset(true);
      }

      reset(anywhere = false) {
        const spacing = canvas.height / ports;
        const port = Math.floor(Math.random() * ports);

        // Inside the first column of open air: the column left of it is the
        // inflow wall, and a mote sitting in a wall is culled on sight, which
        // would quietly retire the whole rake of ports one mote at a time.
        this.x = anywhere
          ? cellSize + Math.random() * (canvas.width - 2 * cellSize)
          : cellSize * (1 + Math.random());
        this.y = clamp(
          (port + 0.5) * spacing + (Math.random() - 0.5) * spacing * 0.35,
          cellSize * 1.5,
          canvas.height - cellSize * 1.5
        );
        this.prevX = this.x;
        this.prevY = this.y;
        this.age = Math.random() * MAX_MOTE_AGE;
        this.speed = 0;
      }

      update(dt) {
        this.prevX = this.x;
        this.prevY = this.y;

        const flow = grid.sampleVelocity(this.x, this.y);
        this.x += flow.x * dt;
        this.y += flow.y * dt;
        this.speed = Math.sqrt(flow.x * flow.x + flow.y * flow.y);
        this.age += dt;

        if (
          this.x > canvas.width ||
          this.y < 0 ||
          this.y > canvas.height ||
          this.age > MAX_MOTE_AGE ||
          grid.isSolidAt(this.x, this.y)
        ) {
          this.reset();
        }
      }

      draw(context) {
        context.strokeStyle = speedColour(this.speed);
        context.beginPath();
        context.moveTo(this.prevX, this.prevY);
        context.lineTo(this.x, this.y);
        context.stroke();
      }
    }

    // Colouring per mote would be a few thousand string conversions a frame, so
    // the speed ramp is precomputed and indexed into.
    const RAMP_STEPS = 32;
    let ramp = [];
    let rampTheme = null;

    const buildRamp = () => {
      const currentTheme = themeRef.current;
      ramp = Array.from({ length: RAMP_STEPS }, (_, step) => {
        const t = step / (RAMP_STEPS - 1);
        return t < 0.5
          ? scaleColour(currentTheme.secondaryAccent, currentTheme.accent, t * 2)
          : scaleColour(
              currentTheme.accent,
              currentTheme.secondary,
              (t - 0.5) * 2
            );
      });
      rampTheme = currentTheme;
    };

    const speedColour = (speed) => {
      const scale = Math.max(windSpeedRef.current, 1) * 1.6;
      return ramp[clamp(Math.round((speed / scale) * (RAMP_STEPS - 1)), 0, RAMP_STEPS - 1)];
    };

    buildRamp();

    // The field views are painted at grid resolution and stretched up, which
    // is both cheaper and smoother than a fillRect per cell.
    const fieldCanvas = document.createElement("canvas");
    const fieldCtx = fieldCanvas.getContext("2d");
    let fieldImage = null;

    /** 256 RGB triples from the background through to the hot end. */
    let fieldLut = null;
    let fieldLutTheme = null;

    const buildFieldLut = () => {
      const currentTheme = themeRef.current;
      fieldLut = new Uint8ClampedArray(256 * 3);
      for (let step = 0; step < 256; step++) {
        const t = step / 255;
        const colour =
          t < 0.5
            ? scaleColour(currentTheme.primary, currentTheme.secondary, t * 2)
            : scaleColour(
                currentTheme.secondary,
                currentTheme.tertiaryAccent,
                (t - 0.5) * 2
              );
        const { r, g, b } = colourToRGB(colour);
        fieldLut[step * 3] = r;
        fieldLut[step * 3 + 1] = g;
        fieldLut[step * 3 + 2] = b;
      }
      fieldLutTheme = currentTheme;
    };

    buildFieldLut();

    /*
     * Pressure is the one view that will not sit still on its own.
     *
     * It is the solver's accumulated correction, rebuilt from zero on every
     * pass, so a cell's value jitters from frame to frame — and it used to be
     * spread over its own frame's smallest and largest values, so a probe
     * being dragged through the air, whose cells swing hardest of all, rescaled
     * the entire picture with every frame. That is what made it strobe.
     *
     * Worse, what the solve leaves behind is only pressure *differences*: a
     * projection fixes no absolute level, so the whole field is free to sit
     * wherever it likes from one frame to the next, and it moves most when the
     * air is being disturbed most. Drawn against a fixed zero that lifts and
     * drops the entire picture at once, which is exactly what the strobing
     * was. The old code hid it by chance, by spreading each frame between its
     * own smallest and largest value — until a probe was dragged through and
     * became both of them.
     *
     * So three things settle it. The field is carried forward as a running
     * average rather than taken fresh; it is drawn relative to its own middle,
     * which throws the meaningless constant away; and the spread it is drawn
     * against comes from percentiles rather than extremes, so the handful of
     * cells under a probe — which run far past anything the open air does —
     * cannot wash out the other nine thousand as the probe speeds up and
     * slows down.
     */
    // A quarter of a second of averaging: enough to ride over the swings, not
    // so much that the field stops answering to what the air is doing.
    const PRESSURE_SMOOTHING = 0.04;
    // The band of the open air's pressures the ramp is spread over.
    const PRESSURE_LOW = 0.1;
    const PRESSURE_HIGH = 0.9;
    // Sampling the field is plenty to place a percentile, and saves sorting
    // every cell in the grid every frame.
    const PRESSURE_SAMPLE_STRIDE = 7;
    // How many frames of middle and spread the mapping is taken across.
    const PRESSURE_HISTORY = 31;

    let smoothedPressure = null;
    let pressureSamples = null;
    const middleHistory = new Float64Array(PRESSURE_HISTORY);
    const spreadHistory = new Float64Array(PRESSURE_HISTORY);
    const sortScratch = new Float64Array(PRESSURE_HISTORY);
    let historyCount = 0;
    let historyNext = 0;
    let pressureCentre = 0;
    let pressureScale = 0;

    const percentileOf = (sorted, count, fraction) =>
      sorted[Math.floor((count - 1) * fraction)];

    /**
     * The middle of the last few dozen frames.
     *
     * A running average would do for smoothness, but it would also take a
     * hundred frames to climb down from whatever the field looked like when
     * the view was switched on — the tunnel is still settling then, and the
     * pressures are orders of magnitude out. A median is over that within half
     * a buffer, and shrugs off the frames where a probe is being thrown about.
     */
    const medianOverHistory = (history) => {
      sortScratch.set(history);
      const taken = sortScratch.subarray(0, historyCount).sort();
      return percentileOf(taken, historyCount, 0.5);
    };

    const smoothPressure = () => {
      if (!smoothedPressure || smoothedPressure.length !== grid.numCells) {
        smoothedPressure = new Float32Array(grid.numCells);
        pressureSamples = new Float64Array(
          Math.ceil(grid.numCells / PRESSURE_SAMPLE_STRIDE)
        );
        historyCount = 0;
        historyNext = 0;
        pressureCentre = 0;
        pressureScale = 0;
      }

      const { p, s: solid, numCells } = grid;
      let sampled = 0;

      for (let cell = 0; cell < numCells; cell++) {
        const value =
          smoothedPressure[cell] +
          (p[cell] - smoothedPressure[cell]) * PRESSURE_SMOOTHING;
        smoothedPressure[cell] = value;

        // Solid cells hold no pressure, so they would drag the middle of the
        // open air's spread towards zero.
        if (cell % PRESSURE_SAMPLE_STRIDE === 0 && solid[cell] !== 0) {
          pressureSamples[sampled] = value;
          sampled += 1;
        }
      }

      if (sampled === 0) return;

      const taken = pressureSamples.subarray(0, sampled).sort();
      middleHistory[historyNext] = percentileOf(taken, sampled, 0.5);
      spreadHistory[historyNext] =
        (percentileOf(taken, sampled, PRESSURE_HIGH) -
          percentileOf(taken, sampled, PRESSURE_LOW)) /
        2;
      historyNext = (historyNext + 1) % PRESSURE_HISTORY;
      historyCount = Math.min(historyCount + 1, PRESSURE_HISTORY);

      pressureCentre = medianOverHistory(middleHistory);
      pressureScale = medianOverHistory(spreadHistory);
    };

    const drawField = (view) => {
      if (view === VIEW.NONE) return;
      if (view === VIEW.PRESSURE) smoothPressure();

      if (fieldCanvas.width !== grid.numX || fieldCanvas.height !== grid.numY) {
        fieldCanvas.width = grid.numX;
        fieldCanvas.height = grid.numY;
        fieldImage = null;
      }
      if (!fieldImage) {
        fieldImage = fieldCtx.createImageData(grid.numX, grid.numY);
      }

      const pixels = fieldImage.data;
      const speedScale = 1 / (Math.max(windSpeedRef.current, 1) * 2);
      const pressureSpan = 1 / (2 * (pressureScale || 1));

      for (let j = 0; j < grid.numY; j++) {
        for (let i = 0; i < grid.numX; i++) {
          const cell = grid.index(i, j);
          let value;
          if (view === VIEW.SMOKE) value = grid.m[cell];
          else if (view === VIEW.SPEED) value = grid.speedAt(i, j) * speedScale;
          else {
            value = 0.5 + (smoothedPressure[cell] - pressureCentre) * pressureSpan;
          }

          const solid = grid.s[cell] === 0;
          const shade = solid ? 0 : clamp(Math.round(value * 255), 0, 255);
          const pixel = (j * grid.numX + i) * 4;
          pixels[pixel] = fieldLut[shade * 3];
          pixels[pixel + 1] = fieldLut[shade * 3 + 1];
          pixels[pixel + 2] = fieldLut[shade * 3 + 2];
          pixels[pixel + 3] = solid ? 0 : 255;
        }
      }

      fieldCtx.putImageData(fieldImage, 0, 0);
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(fieldCanvas, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    };

    /** Close every cell the page furniture and the held pointer stand on. */
    const markObstacles = (dt) => {
      grid.resetSolids();

      // Angle of attack is measured off the oncoming air, which arrives from
      // the left: the leading edge is the left-hand side, and lifting it is a
      // clockwise turn on a screen whose y runs downwards.
      const pitch = angleOfAttackRef.current;

      if (visibleUIRef.current) {
        const radians = (pitch * Math.PI) / 180;
        const bodies = BODY_IDS.map((id) => document.getElementById(id))
          .filter(Boolean)
          .map(bodyGeometry)
          .filter(Boolean);

        if (bodies.length > 0) {
          // A faded body still belongs to the wing even though the air passes
          // straight through it, so that the scene label going does not shift
          // the pivot out from under the other two.
          pivot = wingPivot(bodies);

          bodies.forEach((body) => {
            pitchBody(body, pitch, pivot);
            if (opacityOf(body.element) < 0.15) return;
            grid.addSolidPolygon(bodyPolygon(body, radians, pivot));
          });

          appliedRadians = radians;
        }
      } else {
        unpitchAll();
        pivot = null;
        appliedRadians = 0;
      }

      const pointer = mousePosRef.current;
      if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return;

      if (mouseDownRef.current) {
        if (probe.held && dt > 0) {
          // A flick of the wrist covers a lot of pixels in one frame; the air
          // it drags along is capped so the tunnel is stirred, not detonated.
          const limit = Math.max(windSpeedRef.current, 100) * 3;
          const targetX = clamp((pointer.x - probe.x) / dt, -limit, limit);
          const targetY = clamp((pointer.y - probe.y) / dt, -limit, limit);

          // Pointer positions arrive jumpy, and feeding that straight in shoves
          // the air a different way every frame — which the pressure view then
          // has to be smoothed half to death to hide. A body has some inertia,
          // so the probe gets some too, and the whole tunnel is calmer for it.
          probe.vx += (targetX - probe.vx) * PROBE_INERTIA;
          probe.vy += (targetY - probe.vy) * PROBE_INERTIA;
        } else {
          probe.vx = 0;
          probe.vy = 0;
        }
        probe.x = pointer.x;
        probe.y = pointer.y;
        probe.held = true;
        grid.addSolidCircle(
          probe.x,
          probe.y,
          probeRadiusRef.current,
          probe.vx,
          probe.vy
        );
      } else {
        probe.held = false;
      }
    };

    const system = new ParticleSystem({
      countRef: particleCountRef,
      spawn: () => new Mote(),
      // Motes are drawn as streaks along the flow, not as circles.
      gpu: false,
    }).fill();

    return {
      onResize: () => buildGrid(),
      frame: () => {
        if (themeRef.current !== rampTheme) buildRamp();
        if (themeRef.current !== fieldLutTheme) buildFieldLut();
        if (cellSizeFor(gridDetailRef.current) !== cellSize) buildGrid();

        const view = viewRef.current;
        const dt = FRAME_TIME * clamp(simulationSpeedRef.current / 100, 0.05, 3);

        markObstacles(dt);
        grid.setInflow(windSpeedRef.current, view === VIEW.SMOKE ? smokeAt : null);
        grid.step(dt, {
          iterations: SOLVER_PASSES,
          smoke: view === VIEW.SMOKE,
        });

        clearCanvas(ctx, canvas);
        drawField(view);

        ctx.save();
        ctx.lineWidth = 1.4;
        ctx.lineCap = "round";
        system.step(ctx, dt);
        ctx.restore();
      },
      cleanup: () => {
        unpitchAll();
        system.clear();
      },
    };
  }, [mobile]);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    visibleUIRef.current = visibleUI;
  }, [visibleUI]);

  return (
    <>
      <SceneCanvas ref={canvasRef} />

      {visibleUI && (
        <div style={{ zIndex: 3000 }}>
          <ChangerGroup
            valueArrays={[
              {
                title: "Wind Speed:",
                valueRef: windSpeedRef,
                minValue: "0",
                maxValue: "700",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Smoke Motes:",
                valueRef: particleCountRef,
                minValue: "100",
                maxValue: "6000",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Simulation Speed:",
                valueRef: simulationSpeedRef,
                minValue: "10",
                maxValue: "200",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Grid Detail:",
                valueRef: gridDetailRef,
                minValue: "0",
                maxValue: "100",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Angle Of Attack:",
                valueRef: angleOfAttackRef,
                minValue: "-20",
                maxValue: "20",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Probe Size:",
                valueRef: probeRadiusRef,
                minValue: "10",
                maxValue: "200",
                type: CHANGER_TYPE.SLIDER,
              },
              // One button per view rather than one that cycles, so which one
              // is on can be read off rather than clicked through.
              VIEW_ORDER.map((view, index) => ({
                type: CHANGER_TYPE.BUTTON,
                title: index === 0 ? "Flow Field:" : undefined,
                buttonText: VIEW_NAMES[view],
                enabled: viewRef.current === view,
                callback: () => {
                  viewRef.current = view;
                },
              })),
            ]}
            rerenderSetter={setRender}
          />

          <IconGroup
            icons={[
              {
                type: "MOUSE",
                text: "Hold: to hold a body in the airflow\nDrag: to stir the air with it",
              },
            ]}
          />
        </div>
      )}
    </>
  );
}
