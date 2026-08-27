import React, { useContext, useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { IconGroup } from "../utilities/popovers";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import {
  clamp,
  colourToRGB,
  getIndexFromBrushSize,
  scaleColour,
  scaleValue,
} from "../utilities/usefulFunctions";
import { MobileContext } from "../../../../contexts/MobileContext";
import {
  useCanvasScene,
  SceneCanvas,
  createPointerTracker,
  attachListeners,
} from "../utilities/engine";

/**
 * The Belousov-Zhabotinsky reaction, as the three-reagent cellular automaton
 * Turner describes: every cell holds concentrations of an activator (a), an
 * inhibitor (b) and a catalyst (c), and each step replaces them with a
 * reaction on the local 3x3 average.
 *
 *   a' = a + a(alpha*b - gamma*c)
 *   b' = b + b(beta*c  - alpha*a)
 *   c' = c + c(gamma*a - beta*b)
 *
 * The averaging is the diffusion term and the products cycle a -> b -> c -> a,
 * which is the whole trick: a lone excited cell becomes a ring, a broken ring
 * curls into the spiral the real reaction paints across a petri dish.
 *
 * The grid wraps, so waves leaving one edge arrive at the other and the dish
 * never settles into a quiet border.
 */
export default function BZ({ visibleUI }) {
  const { theme } = useTheme();
  const mobile = useContext(MobileContext);

  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const rightClickRef = useRef(false);
  const touchActiveRef = useRef(false);

  // Reaction rates, held as hundredths so the integer sliders can carry them.
  const alphaRef = useRef(120);
  const betaRef = useRef(100);
  const gammaRef = useRef(100);

  // Deliberately slow by default. A full-screen reaction running at frame rate
  // is a large-area luminance flicker, which is exactly the thing that trips
  // photosensitive epilepsy — see the step cap and the eased render below.
  const simulationSpeedRef = useRef(20);
  const contrastRef = useRef(35);
  const brushSizeRef = useRef(6);
  const autoCycleRef = useRef(true);
  const smoothRef = useRef(true);

  const seedRef = useRef(null);
  const quietRef = useRef(null);

  const themeRef = useRef(theme);
  const [, setRender] = useState(0); // Dummy state to force re-render

  const canvasRef = useCanvasScene(({ canvas, ctx, onCleanup }) => {
    onCleanup(
      createPointerTracker(canvas, {
        target: canvas,
        posRef: mousePosRef,
        downRef: mouseClickRef,
        rightDownRef: rightClickRef,
        touchActiveRef,
        blockContextMenu: true,
      })
    );

    // Cells are square: the grid follows the canvas aspect rather than a fixed
    // shape, or the spirals would come out as ellipses on a wide window.
    const targetWidth = mobile ? 110 : 260;

    let gridWidth = 0;
    let gridHeight = 0;
    let a, b, c, nextA, nextB, nextC;
    // What is actually painted. It chases the reaction rather than tracking it
    // exactly, so a cell that flips in one step still fades across several
    // frames and no pixel can jump from one end of the palette to the other.
    let shownA, shownB;
    // Distance of each cell from the centre, 0 at the middle and 1 at the
    // corners. The reveal is a threshold on this, so it costs a compare a
    // pixel rather than a square root.
    let dist;
    let image, pixels;

    // The dish starts hidden under the page background and is uncovered by a
    // ring spreading from the centre. The wait is not just for show: the
    // reaction needs a few seconds before it has any spirals worth showing,
    // and revealing it cold means opening on a screen of noise.
    const WARMUP_STEPS = 180;     // before the first reveal
    const RESEED_WARMUP = 140;    // before a reveal the scene triggers later
    // Under the mask there is nothing on screen to flicker, so the warmup runs
    // as fast as the frame allows rather than at the display rate. 180 steps is
    // where the blobs have finished curling into spirals.
    const WARMUP_STEPS_PER_FRAME = 4;
    const WARMUP_MAX_FRAMES = 900; // failsafe: never sit blank forever
    const REVEAL_PER_FRAME = 1 / 170;
    const REVEAL_EDGE = 0.18;     // width of the soft front, in reveal units

    let revealRadius = 0;
    let revealDone = false;
    let warmupSteps = 0;
    let warmupFrames = 0;

    const beginReveal = (steps) => {
      warmupSteps = steps;
      warmupFrames = 0;
      revealRadius = 0;
      revealDone = false;
    };

    // Mean change in the activator over the last step: how alive the dish is.
    // A quenched or collapsed dish sits at exactly zero.
    let activity = 1;
    let quietSteps = 0;
    const QUIET_LEVEL = 0.0005;
    const QUIET_STEPS = 40;

    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d");

    const seed = () => {
      for (let i = 0; i < a.length; i++) {
        a[i] = Math.random();
        b[i] = Math.random();
        c[i] = Math.random();
      }
    };

    // A dish full of unreacted activator: quiet until something disturbs it.
    const quieten = () => {
      for (let i = 0; i < a.length; i++) {
        a[i] = 1;
        b[i] = 0;
        c[i] = 0;
      }
    };

    const configure = () => {
      const width = targetWidth;
      const height = Math.max(
        16,
        Math.round((targetWidth * canvas.height) / Math.max(canvas.width, 1))
      );
      if (width === gridWidth && height === gridHeight) return;

      gridWidth = width;
      gridHeight = height;
      const cells = gridWidth * gridHeight;

      a = new Float32Array(cells);
      b = new Float32Array(cells);
      c = new Float32Array(cells);
      nextA = new Float32Array(cells);
      nextB = new Float32Array(cells);
      nextC = new Float32Array(cells);
      shownA = new Float32Array(cells);
      shownB = new Float32Array(cells);

      dist = new Float32Array(cells);
      const cx = (gridWidth - 1) / 2;
      const cy = (gridHeight - 1) / 2;
      const maxDist = Math.hypot(cx, cy) || 1;
      for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
          dist[y * gridWidth + x] = Math.hypot(x - cx, y - cy) / maxDist;
        }
      }

      image = ctx.createImageData(gridWidth, gridHeight);
      pixels = image.data;
      tempCanvas.width = gridWidth;
      tempCanvas.height = gridHeight;

      seed();
      beginReveal(WARMUP_STEPS);
    };

    configure();

    // One entry per rendered level, rebuilt whenever the theme changes so the
    // dish is tinted like the rest of the page rather than by its own palette.
    //
    // Every stop is mixed back towards the page background by `contrast`, which
    // caps how far the whole picture can swing. At the default the waves sit a
    // little above the background rather than running the theme's full range
    // from near-black to near-white.
    let lut = null;
    let lutTheme = null;
    let lutContrast = null;
    let frontR = 0, frontG = 0, frontB = 0;
    const LEVELS = 256;

    const buildLut = () => {
      const current = themeRef.current;
      const contrast = contrastRef.current / 100;

      // Muted stops: the mid-tone and the crest, both held well short of the
      // accent so no part of the dish reaches full brightness.
      const mid = scaleColour(current.primary, current.secondaryAccent, 0.55 * contrast);
      const high = scaleColour(current.primary, current.secondary, 0.75 * contrast);

      lut = { r: new Uint8Array(LEVELS), g: new Uint8Array(LEVELS), b: new Uint8Array(LEVELS) };
      for (let i = 0; i < LEVELS; i++) {
        const t = i / (LEVELS - 1);
        const hex =
          t < 0.5
            ? scaleColour(current.primary, mid, t * 2)
            : scaleColour(mid, high, (t - 0.5) * 2);
        const rgb = colourToRGB(hex);
        lut.r[i] = rgb.r;
        lut.g[i] = rgb.g;
        lut.b[i] = rgb.b;
      }

      const front = colourToRGB(
        scaleColour(current.primary, current.tertiaryAccent, 0.5 * contrast)
      );
      frontR = front.r;
      frontG = front.g;
      frontB = front.b;

      lutTheme = current;
      lutContrast = contrastRef.current;
    };

    buildLut();

    const step = () => {
      let changed = 0;
      const alpha = alphaRef.current / 100;
      const beta = betaRef.current / 100;
      const gamma = gammaRef.current / 100;

      for (let y = 0; y < gridHeight; y++) {
        const rowUp = ((y - 1 + gridHeight) % gridHeight) * gridWidth;
        const row = y * gridWidth;
        const rowDown = ((y + 1) % gridHeight) * gridWidth;

        for (let x = 0; x < gridWidth; x++) {
          const left = (x - 1 + gridWidth) % gridWidth;
          const right = (x + 1) % gridWidth;

          const i0 = rowUp + left;
          const i1 = rowUp + x;
          const i2 = rowUp + right;
          const i3 = row + left;
          const i4 = row + x;
          const i5 = row + right;
          const i6 = rowDown + left;
          const i7 = rowDown + x;
          const i8 = rowDown + right;

          const sa =
            (a[i0] + a[i1] + a[i2] + a[i3] + a[i4] + a[i5] + a[i6] + a[i7] + a[i8]) / 9;
          const sb =
            (b[i0] + b[i1] + b[i2] + b[i3] + b[i4] + b[i5] + b[i6] + b[i7] + b[i8]) / 9;
          const sc =
            (c[i0] + c[i1] + c[i2] + c[i3] + c[i4] + c[i5] + c[i6] + c[i7] + c[i8]) / 9;

          nextA[i4] = clamp(sa + sa * (alpha * sb - gamma * sc), 0, 1);
          changed += nextA[i4] > a[i4] ? nextA[i4] - a[i4] : a[i4] - nextA[i4];
          nextB[i4] = clamp(sb + sb * (beta * sc - alpha * sa), 0, 1);
          nextC[i4] = clamp(sc + sc * (gamma * sa - beta * sb), 0, 1);
        }
      }

      let swap = a; a = nextA; nextA = swap;
      swap = b; b = nextB; nextB = swap;
      swap = c; c = nextC; nextC = swap;

      activity = changed / a.length;
    };

    // How far the painted image is allowed to close on the reaction each
    // frame. Low enough that a step lands as a fade rather than a switch.
    const EASE = 0.12;

    const draw = () => {
      if (themeRef.current !== lutTheme || contrastRef.current !== lutContrast) {
        buildLut();
      }

      // The bottom of the gradient is the page background, which is also what
      // the mask is made of — so an unrevealed pixel is indistinguishable from
      // the page behind the canvas.
      const maskR = lut.r[0];
      const maskG = lut.g[0];
      const maskB = lut.b[0];
      const invEdge = 1 / REVEAL_EDGE;
      // Nothing is on screen yet during the warmup, so there is nothing to
      // ease towards: track the reaction exactly and let the easing take over
      // once the mask starts lifting.
      const hidden = revealRadius <= 0;

      for (let i = 0; i < a.length; i++) {
        if (hidden) {
          shownA[i] = a[i];
          shownB[i] = b[i];
        } else {
          shownA[i] += (a[i] - shownA[i]) * EASE;
          shownB[i] += (b[i] - shownB[i]) * EASE;
        }

        const level = (shownA[i] * (LEVELS - 1)) | 0;
        // Where the inhibitor is high the front is nudged towards the warm
        // accent, just enough to give the rings an edge.
        const mix = shownB[i] * 0.25;
        let r = lut.r[level] + (frontR - lut.r[level]) * mix;
        let g = lut.g[level] + (frontG - lut.g[level]) * mix;
        let bl = lut.b[level] + (frontB - lut.b[level]) * mix;

        if (!revealDone) {
          // A soft-edged ring rather than a hard circle, so the mask lifts as
          // a wash instead of a wipe.
          const uncovered = clamp((revealRadius - dist[i]) * invEdge, 0, 1);
          r = maskR + (r - maskR) * uncovered;
          g = maskG + (g - maskG) * uncovered;
          bl = maskB + (bl - maskB) * uncovered;
        }

        const p = i * 4;
        pixels[p] = r;
        pixels[p + 1] = g;
        pixels[p + 2] = bl;
        pixels[p + 3] = 255;
      }
    };

    // Stirring the dish: fresh randomness nucleates new spirals, which is how
    // the real thing behaves when it is disturbed.
    const stir = (indexes) => {
      indexes.forEach((index) => {
        a[index] = Math.random();
        b[index] = Math.random();
        c[index] = Math.random();
      });
    };

    const quench = (indexes) => {
      indexes.forEach((index) => {
        a[index] = 1;
        b[index] = 0;
        c[index] = 0;
      });
    };

    let simValue = 0;

    const reseed = () => {
      seed();
      quietSteps = 0;
      beginReveal(RESEED_WARMUP);
    };

    function animate() {
      seedRef.current = reseed;
      quietRef.current = quieten;

      if (mouseClickRef.current || rightClickRef.current) {
        const mouseX = Math.floor(
          scaleValue(mousePosRef.current.x, 0, canvas.width, 0, gridWidth)
        );
        const mouseY = Math.floor(
          scaleValue(mousePosRef.current.y, 0, canvas.height, 0, gridHeight)
        );
        if (
          mouseX >= 0 &&
          mouseX < gridWidth &&
          mouseY >= 0 &&
          mouseY < gridHeight
        ) {
          const indexes = getIndexFromBrushSize(
            gridWidth,
            gridHeight,
            mouseX + mouseY * gridWidth,
            Math.floor(brushSizeRef.current)
          );
          if (rightClickRef.current) quench(indexes);
          else stir(indexes);

          // Someone reaching for the dish should not be made to wait out the
          // warmup, nor have their work reseeded from under them.
          warmupSteps = 0;
          quietSteps = 0;
        }
      }

      // The speed control buys whole steps, and any change left over is
      // carried into the next frame so slow settings still creep forwards.
      // One step per frame is the ceiling: past that the waves stop reading as
      // motion and start reading as flicker.
      if (warmupSteps > 0) {
        // Bringing the reaction up to speed behind the mask. The speed control
        // does not apply here: this is a transition, not the simulation.
        for (let i = 0; i < WARMUP_STEPS_PER_FRAME && warmupSteps > 0; i++) {
          step();
          warmupSteps -= 1;
        }
      } else {
        simValue += simulationSpeedRef.current;
        if (simValue >= 100) {
          simValue -= 100;
          step();

          // A dish that has stopped changing is a dead screen. Once it has been
          // still for a while, start again — but only after a sustained quiet,
          // so a deliberately settled dish stays settled long enough to draw on.
          if (autoCycleRef.current && revealDone) {
            quietSteps = activity < QUIET_LEVEL ? quietSteps + 1 : 0;
            if (quietSteps >= QUIET_STEPS) reseed();
          }
        }
      }

      warmupFrames += 1;
      if (warmupFrames > WARMUP_MAX_FRAMES) warmupSteps = 0;

      if (warmupSteps <= 0 && !revealDone) {
        revealRadius += REVEAL_PER_FRAME;
        if (revealRadius >= 1 + REVEAL_EDGE) revealDone = true;
      }

      draw();

      tempCtx.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = smoothRef.current;
      ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
    }

    // Scrolling over the canvas resizes the brush rather than the page.
    const handleWheel = (e) => {
      e.preventDefault();
      const newSize = brushSizeRef.current - Math.sign(e.deltaY);
      brushSizeRef.current = clamp(newSize, 1, 30);
    };

    onCleanup(attachListeners([[canvas, "wheel", handleWheel]]));

    return { frame: animate, onResize: configure };
  }, [mobile]);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  return (
    <>
      <SceneCanvas ref={canvasRef} />
      {visibleUI && (
        <div style={{ zIndex: 3000 }}>
          <ChangerGroup
            valueArrays={[
              {
                title: "Simulation Speed:",
                valueRef: simulationSpeedRef,
                minValue: "0",
                maxValue: "100",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Contrast:",
                valueRef: contrastRef,
                minValue: "5",
                maxValue: "100",
                type: CHANGER_TYPE.SLIDER,
              },
              [
                {
                  title: "Alpha:",
                  valueRef: alphaRef,
                  minValue: "20",
                  maxValue: "300",
                  type: CHANGER_TYPE.SLIDER,
                },
                {
                  title: "Beta:",
                  valueRef: betaRef,
                  minValue: "20",
                  maxValue: "300",
                  type: CHANGER_TYPE.SLIDER,
                },
                {
                  title: "Gamma:",
                  valueRef: gammaRef,
                  minValue: "20",
                  maxValue: "300",
                  type: CHANGER_TYPE.SLIDER,
                },
              ],
              {
                title: "Brush Size:",
                valueRef: brushSizeRef,
                minValue: "1",
                maxValue: "30",
                type: CHANGER_TYPE.SLIDER,
              },
              [
                {
                  title: "Rendering:",
                  type: CHANGER_TYPE.BUTTON,
                  enabled: smoothRef.current,
                  buttonText: "Smooth",
                  callback: () => {
                    smoothRef.current = true;
                  },
                },
                {
                  type: CHANGER_TYPE.BUTTON,
                  enabled: !smoothRef.current,
                  buttonText: "Pixelated",
                  callback: () => {
                    smoothRef.current = false;
                  },
                },
              ],
              [
                {
                  title: "Auto Cycle:",
                  type: CHANGER_TYPE.BUTTON,
                  enabled: autoCycleRef.current,
                  buttonText: "On",
                  callback: () => {
                    autoCycleRef.current = true;
                  },
                },
                {
                  type: CHANGER_TYPE.BUTTON,
                  enabled: !autoCycleRef.current,
                  buttonText: "Off",
                  callback: () => {
                    autoCycleRef.current = false;
                  },
                },
              ],
              [
                {
                  type: CHANGER_TYPE.BUTTON,
                  buttonText: "Reseed",
                  callback: () => {
                    if (seedRef.current) seedRef.current();
                  },
                },
                {
                  type: CHANGER_TYPE.BUTTON,
                  buttonText: "Settle",
                  callback: () => {
                    if (quietRef.current) quietRef.current();
                  },
                },
              ],
            ]}
            rerenderSetter={setRender}
          />

          <IconGroup
            icons={[
              {
                type: "MOUSE",
                text: "Left click to stir in new waves\nRight click to settle the dish\nScroll to resize the brush",
              },
            ]}
          />
        </div>
      )}
    </>
  );
}
