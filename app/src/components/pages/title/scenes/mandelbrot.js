import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { IconGroup } from "../utilities/popovers";
import Worker from "../utilities/workers/mandelbrot.worker";
import WorkerFactory from "../utilities/workerFactory";
import {
  createBigFloatLib,
  bfZero,
  bfFromNumber,
  bfToNumber,
  bfAdd,
  bfSub,
  bfSetPrec,
  bfToFixed,
  bfPrecisionForZoom,
} from "../utilities/bigFloat";
import {
  BASE_MAX_ITER,
  autoIterationMultiplier,
  colourSpanForZoom,
  maxIterationsForZoom,
} from "../utilities/iterationBudget";
import { createPalette } from "../utilities/palette";
import {
  ChangerGroup,
  CHANGER_TYPE,
} from "../utilities/valueChangers";
import {
  fitCanvasToWindow,
  attachListeners,
} from "../utilities/engine";

// Doubles run out of exponent below ~1e-308, which is what bounds the deltas
// the perturbed iteration works with. Everything above this is fair game.
const MAX_ZOOM = 1e290;

// One worker per core, leaving the main thread a core of its own, and capped:
// past a point the extra workers only add copies of the reference orbit, which
// is megabytes apiece at depth.
const WORKER_POOL_SIZE = Math.max(
  2,
  Math.min(
    (typeof navigator === "undefined" ? 4 : navigator.hardwareConcurrency || 4) - 1,
    12
  )
);

export default function Mandelbrot({ visibleUI }) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const drawResolutionRef = useRef(20);
  const [, setRender] = useState(0);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const drawEverythingRef = useRef(() => { });
  const currentlyDrawingRef = useRef(false);
  const currentThemeRef = useRef(0);

  const complexPosRef = useRef({ Re: "0", Im: "0" });
  const zoomDisplayRef = useRef("1.00e+0");
  const iterDisplayRef = useRef(`${BASE_MAX_ITER}  (auto x1.0)`);

  const imageDataRef = useRef(null);
  const pixelBufferRef = useRef(null);
  const paletteColoursRef = useRef(null);
  const paletteRef = useRef(null);
  const colourSpanRef = useRef(BASE_MAX_ITER);
  const workerPoolRef = useRef([]);
  const referenceWorkerRef = useRef(null);

  const drawGenerationRef = useRef(0); // Track current draw generation

  // The view centre lives in arbitrary precision; the zoom factor stays a
  // double (it only ever needs an exponent, never 300 digits of mantissa).
  const precisionRef = useRef(bfPrecisionForZoom(1));
  const centerXRef = useRef(bfZero(precisionRef.current));
  const centerYRef = useRef(bfZero(precisionRef.current));
  const zoomLevelRef = useRef(1);
  const iterBiasRef = useRef(1);
  const maxIterRef = useRef(BASE_MAX_ITER);
  const startClickRef = useRef({ x: 0, y: 0 });

  // Reference orbit shared by every pixel: its centre (arbitrary precision),
  // the orbit itself as doubles, and the iteration count it was computed for.
  const referenceRef = useRef(null);
  const referenceGenerationRef = useRef(0);
  const referencePendingRef = useRef(false);
  const onReferenceReadyRef = useRef(() => { });

  const [customColours, setCustomColours] = useState([
    "#ff0000", // Custom max iteration colour
    "#00ff00", // Custom max interp colour
    "#0000ff", // Custom min interp colour
  ]);

  useEffect(() => {
    // Initialize worker pool. The BigFloat library is injected into each blob
    // worker because the stringified worker body cannot carry its imports.
    for (let i = 0; i < WORKER_POOL_SIZE; i++) {
      workerPoolRef.current.push(new WorkerFactory(Worker, [createBigFloatLib]));
    }
    // A dedicated worker for the (expensive, arbitrary precision) reference
    // orbit, so it never blocks the pixel workers or the UI.
    referenceWorkerRef.current = new WorkerFactory(Worker, [createBigFloatLib]);

    return () => {
      // Terminate all workers
      workerPoolRef.current.forEach((worker) => {
        worker.terminate();
      });
      workerPoolRef.current = [];
      if (referenceWorkerRef.current) {
        referenceWorkerRef.current.terminate();
        referenceWorkerRef.current = null;
      }
    };
  }, []);

  // Restart Mandelbrot rendering when the global theme changes
  useEffect(() => {
    // Reset progressive rendering resolution and trigger full redraw
    if (drawEverythingRef.current) {
      drawEverythingRef.current();
    }
  }, [theme]);

  const themesList = [
    ["Default", theme.primary, theme.secondary, theme.primary],
    ["Pink Innit", theme.tertiaryAccent, theme.primary, theme.secondary],
    ["Adorned", theme.secondary, theme.accent, theme.primary],
    ["Custom", customColours[0], customColours[1], customColours[2]],
  ];

  /** Half-width / half-height of the view in the complex plane. */
  function viewSize() {
    const canvas = canvasRef.current;
    if (!canvas) return { width: 4, height: 2, pixelSpacing: 0.01 };
    const height = 2 / zoomLevelRef.current;
    const width = (canvas.width / canvas.height) * height;
    return { width, height, pixelSpacing: height / canvas.height };
  }

  /** Pixel -> complex plane, in arbitrary precision. */
  function mapToComplex(pixelX, pixelY) {
    const canvas = canvasRef.current;
    if (!canvas) return [bfZero(precisionRef.current), bfZero(precisionRef.current)];
    const { width, height } = viewSize();
    const p = precisionRef.current;
    return [
      bfAdd(centerXRef.current, bfFromNumber((pixelX / canvas.width - 0.5) * width, p)),
      bfAdd(centerYRef.current, bfFromNumber((pixelY / canvas.height - 0.5) * height, p)),
    ];
  }

  /** Deeper zooms need both more precision in the centre and more iterations. */
  function updateZoomDerivedState() {
    zoomLevelRef.current = Math.min(Math.max(zoomLevelRef.current, 0.05), MAX_ZOOM);
    const zoom = zoomLevelRef.current;

    const precision = bfPrecisionForZoom(zoom);
    if (precision !== precisionRef.current) {
      precisionRef.current = precision;
      centerXRef.current = bfSetPrec(centerXRef.current, precision);
      centerYRef.current = bfSetPrec(centerYRef.current, precision);
    }

    maxIterRef.current = maxIterationsForZoom(zoom, iterBiasRef.current);

    zoomDisplayRef.current = zoom.toExponential(2);
    iterDisplayRef.current = `${maxIterRef.current}  (auto x${autoIterationMultiplier(
      zoom
    ).toFixed(1)})`;
    colourSpanRef.current = colourSpanForZoom(zoom);
    rebuildPalette();
  }

  const setPaletteColours = (
    maxIterationColour,
    maxInterpColour,
    minInterpColour
  ) => {
    paletteColoursRef.current = {
      maxIterationColour,
      maxInterpColour,
      minInterpColour,
    };
    rebuildPalette();
  };

  function rebuildPalette() {
    if (!paletteColoursRef.current) return;
    paletteRef.current = createPalette({
      ...paletteColoursRef.current,
      span: colourSpanRef.current,
    });
  }

  setPaletteColours(
    themesList[currentThemeRef.current][1],
    themesList[currentThemeRef.current][2],
    themesList[currentThemeRef.current][3]
  );

  const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

  const setRerender = useState(0)[1]; // For ChangerGroup forced rerender

  const applyTheme = (index) => {
    currentThemeRef.current = index;
    setPaletteColours(
      themesList[index][1],
      themesList[index][2],
      themesList[index][3]
    );
    setRender((prev) => prev + 1);
    drawEverythingRef.current();
  };

  const valueChangers = [
    {
      type: CHANGER_TYPE.DISPLAY,
      title: "Position:",
      valueRef: complexPosRef,
    },
    {
      type: CHANGER_TYPE.DISPLAY,
      title: "Zoom Intensity:",
      valueRef: zoomDisplayRef,
    },
    {
      type: CHANGER_TYPE.DISPLAY,
      title: "Max Iterations:",
      valueRef: iterDisplayRef,
    },
    {
      type: CHANGER_TYPE.SLIDER,
      title: "Max Draw Resolution:",
      valueRef: drawResolutionRef,
      minValue: 1,
      maxValue: 20,
      callback: () => { },
    },
    {
      type: CHANGER_TYPE.SLIDER,
      title: "Extra Iterations:",
      valueRef: iterBiasRef,
      minValue: 1,
      maxValue: 10,
      callback: () => {
        updateZoomDerivedState();
        drawEverythingRef.current();
      },
    },
    themesList.map((themeEntry, index) => ({
      type: CHANGER_TYPE.BUTTON,
      title: index === 0 ? "Toggle Theme:" : "",
      buttonText: themeEntry[0],
      callback: () => applyTheme(index),
    })),
    // Add color pickers if Custom theme is selected
    ...(currentThemeRef.current === themesList.length - 1
      ? [
        [
          {
            type: CHANGER_TYPE.COLOR,
            title: "Max Iteration Colour:",
            colorValue: customColours[0],
            onChange: (newColor) => {
              const newColours = [
                newColor,
                customColours[1],
                customColours[2],
              ];
              setCustomColours(newColours);
              setPaletteColours(
                newColours[0],
                newColours[1],
                newColours[2]
              );
              drawEverythingRef.current();
            },
          },
        ],
        [
          {
            type: CHANGER_TYPE.COLOR,
            title: "Max Interp Colour:",
            colorValue: customColours[1],
            onChange: (newColor) => {
              const newColours = [
                customColours[0],
                newColor,
                customColours[2],
              ];
              setCustomColours(newColours);
              setPaletteColours(
                newColours[0],
                newColours[1],
                newColours[2]
              );
              drawEverythingRef.current();
            },
          },
        ],
        [
          {
            type: CHANGER_TYPE.COLOR,
            title: "Min Interp Colour:",
            colorValue: customColours[2],
            onChange: (newColor) => {
              const newColours = [
                customColours[0],
                customColours[1],
                newColor,
              ];
              setCustomColours(newColours);
              setPaletteColours(
                newColours[0],
                newColours[1],
                newColours[2]
              );
              drawEverythingRef.current();
            },
          },
        ],
      ]
      : []),
  ];

  useEffect(() => {
    const canvas = canvasRef.current;

    // StrictMode mounts, tears down and mounts again; anything latched by the
    // previous run (a pending orbit request whose worker is now dead, a draw
    // that will never resolve) would otherwise wedge this one permanently.
    referenceRef.current = null;
    referencePendingRef.current = false;
    currentlyDrawingRef.current = false;

    // Draws are async and outlive the effect; once this run is torn down its
    // workers are gone, so anything still in flight has to stop touching them.
    let disposed = false;

    /**
     * A reference orbit stays usable while its centre is still comfortably
     * inside the view and it ran for at least as many iterations as we now
     * need — panning and zooming reuse it until one of those stops holding.
     */
    function referenceIsUsable() {
      const reference = referenceRef.current;
      if (!reference) return false;
      if (reference.maxIter < maxIterRef.current) return false;
      const { width, height } = viewSize();
      const offsetX = bfToNumber(bfSub(centerXRef.current, reference.cx));
      const offsetY = bfToNumber(bfSub(centerYRef.current, reference.cy));
      return Math.abs(offsetX) < width * 0.4 && Math.abs(offsetY) < height * 0.4;
    }

    function requestReference() {
      if (referencePendingRef.current || disposed || !referenceWorkerRef.current) return;
      referencePendingRef.current = true;
      referenceGenerationRef.current += 1;
      const generation = referenceGenerationRef.current;
      const cx = centerXRef.current;
      const cy = centerYRef.current;
      const maxIter = maxIterRef.current;

      referenceWorkerRef.current.postMessage({
        type: "reference",
        cx,
        cy,
        maxIter,
        refGeneration: generation,
      });

      // Remember what we asked for so the reply can be matched up.
      referencePendingRef.current = { generation, cx, cy, maxIter };
    }

    onReferenceReadyRef.current = (data) => {
      if (disposed) return;
      const pending = referencePendingRef.current;
      referencePendingRef.current = false;
      if (!pending || data.refGeneration !== pending.generation) return;

      referenceRef.current = {
        cx: pending.cx,
        cy: pending.cy,
        maxIter: pending.maxIter,
        refLen: data.refLen,
      };

      // Each worker needs its own copy — a transferred buffer is detached.
      workerPoolRef.current.forEach((worker) => {
        worker.postMessage({
          type: "orbit",
          Zx: data.Zx.slice(),
          Zy: data.Zy.slice(),
          refLen: data.refLen,
        });
      });

      drawEverythingRef.current();
    };

    referenceWorkerRef.current.onmessage = (event) => {
      if (event.data.type === "reference") {
        onReferenceReadyRef.current(event.data);
      }
    };

    /** Kick off a new reference orbit if the current one no longer serves. */
    function ensureReference() {
      if (!referenceIsUsable()) requestReference();
    }

    // A zoom or a pan starts a new draw while the previous one still has work
    // out with the pool, so replies are matched to the request that asked for
    // them by id. Each worker keeps one handler for its whole life: swapping
    // the handler per request let a later draw consume an earlier draw's
    // reply, which stranded that earlier draw waiting for a reply that had
    // already been delivered to someone else.
    const pendingRequests = new Map();
    let nextRequestId = 1;

    workerPoolRef.current.forEach((worker) => {
      worker.onmessage = (event) => {
        const settle = pendingRequests.get(event.data.requestId);
        if (!settle) return;
        pendingRequests.delete(event.data.requestId);
        settle(event.data);
      };
    });

    /**
     * Writes one work unit's counts into the pixel buffer and blits just the
     * strip they cover. Colours come from the palette's packed lookup table
     * and each block is a `fill` over a run of the buffer, so a full frame
     * costs a few milliseconds instead of two million `fillRect` calls with a
     * freshly built colour string apiece.
     */
    function paintWorkUnit(results, workUnit, ctx) {
      const pixels = pixelBufferRef.current;
      const image = imageDataRef.current;
      if (!pixels || !image) return;

      const { startX, step, y, resolution } = workUnit;
      const palette = paletteRef.current;
      const maxIter = maxIterRef.current;
      const canvasWidth = image.width;
      const rowEnd = Math.min(y + resolution, image.height);

      if (resolution === 1) {
        // The final pass is the expensive one and its blocks are single
        // pixels, where a fill call per block costs more than the store does.
        const offset = y * canvasWidth + startX;
        for (let i = 0; i < results.length; i++) {
          pixels[offset + i] = palette.packedFor(results[i], maxIter);
        }
      } else {
        for (let i = 0; i < results.length; i++) {
          const packed = palette.packedFor(results[i], maxIter);
          const blockStart = startX + i * step;
          const blockEnd = Math.min(blockStart + resolution, canvasWidth);
          for (let row = y; row < rowEnd; row++) {
            const offset = row * canvasWidth;
            for (let x = offset + blockStart; x < offset + blockEnd; x++) {
              pixels[x] = packed;
            }
          }
        }
      }

      const dirtyWidth =
        Math.min(startX + (results.length - 1) * step + resolution, canvasWidth) -
        startX;
      ctx.putImageData(image, 0, 0, startX, y, dirtyWidth, rowEnd - y);
    }

    function processWorkUnit(workerIdx, workUnit, drawGeneration, ctx) {
      const worker = workerPoolRef.current[workerIdx];

      return new Promise((resolve) => {
        if (!worker || disposed) {
          resolve();
          return;
        }

        const requestId = nextRequestId++;

        pendingRequests.set(requestId, (data) => {
          // The work is only worth painting if this draw is still the current
          // one; either way the worker is free again, so always resolve.
          if (
            !disposed &&
            data.drawGeneration === drawGeneration &&
            drawGenerationRef.current === drawGeneration
          ) {
            paintWorkUnit(data.results, workUnit, ctx);
          }
          resolve();
        });

        worker.postMessage({
          type: "tile",
          startX: workUnit.startX,
          count: workUnit.count,
          step: workUnit.step,
          rowY: workUnit.y,
          dcx0: workUnit.dcx0,
          dcy0: workUnit.dcy0,
          pixelSpacing: workUnit.pixelSpacing,
          maxIter: workUnit.maxIter,
          drawGeneration,
          requestId,
        });
      });
    }

    async function drawMandelbrotArea(resolution = 21 - drawResolutionRef.current) {
      if (disposed) return;
      ensureReference();
      const reference = referenceRef.current;
      if (!reference) return; // first orbit still cooking; the reply redraws

      currentlyDrawingRef.current = true;
      drawGenerationRef.current += 1; // Increment generation for each new draw
      const thisDrawGeneration = drawGenerationRef.current;
      const ctx = canvas.getContext("2d");

      // Per-pixel offsets from the reference point, in plain doubles: this is
      // the whole point of perturbation, the deltas stay small and the
      // arbitrary precision work is confined to the single reference orbit.
      const { width, height, pixelSpacing } = viewSize();
      const dcx0 =
        bfToNumber(bfSub(centerXRef.current, reference.cx)) - width / 2;
      const dcy0 =
        bfToNumber(bfSub(centerYRef.current, reference.cy)) - height / 2;
      const maxIter = maxIterRef.current;

      // Collect all work units first. A unit is a run of evenly spaced pixels
      // along one row — start, count and step — rather than a list of
      // coordinates, so nothing per-pixel crosses the worker boundary.
      const workUnits = [];
      const columns = Math.ceil(canvas.width / resolution);
      const chunkSize = 800; // Increased chunk size for better performance
      for (let y = 0; y < canvas.height; y += resolution) {
        for (let first = 0; first < columns; first += chunkSize) {
          workUnits.push({
            startX: first * resolution,
            count: Math.min(chunkSize, columns - first),
            step: resolution,
            y,
            resolution,
            dcx0,
            dcy0,
            pixelSpacing,
            maxIter,
          });
        }
      }

      // Process work units with worker pool
      let workIndex = 0;
      const workerPromises = [];

      // Start initial work on all available workers
      for (
        let workerIdx = 0;
        workerIdx < Math.min(workerPoolRef.current.length, workUnits.length);
        workerIdx++
      ) {
        workerPromises.push(
          processWorkUnit(
            workerIdx,
            workUnits[workIndex],
            thisDrawGeneration,
            ctx
          )
        );
        workIndex++;
      }

      // Process remaining work units as workers become available
      while (
        workIndex < workUnits.length &&
        !disposed &&
        drawGenerationRef.current === thisDrawGeneration
      ) {
        // Wait for any worker to finish
        const completedWorkerIdx = await Promise.race(
          workerPromises.map((promise, idx) => promise.then(() => idx))
        );

        // Start new work on the completed worker
        if (workIndex < workUnits.length) {
          workerPromises[completedWorkerIdx] = processWorkUnit(
            completedWorkerIdx,
            workUnits[workIndex],
            thisDrawGeneration,
            ctx
          );
          workIndex++;
        }
      }

      // Wait for all remaining work to complete
      await Promise.all(workerPromises);

      // A newer draw is now the one in progress; leave the flag to it.
      if (drawGenerationRef.current === thisDrawGeneration) {
        currentlyDrawingRef.current = false;
      }
    }

    // The frame is assembled in this buffer and blitted from it, so it has to
    // be rebuilt whenever the canvas changes size, and a resize also has to
    // kick off a fresh draw.
    const rebuildFrameBuffer = () => {
      const ctx = canvas.getContext("2d");
      const image = ctx.createImageData(canvas.width, canvas.height);
      imageDataRef.current = image;
      pixelBufferRef.current = new Uint32Array(image.data.buffer);
    };

    const fitted = fitCanvasToWindow(canvas, () => {
      rebuildFrameBuffer();
      if (drawEverythingRef.current) drawEverythingRef.current();
    });
    rebuildFrameBuffer();

    let animationFrameId;
    let currentRes = 10;

    async function animate() {
      // Cancel previous animation frame if it exists
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }

      if (
        currentRes > 21 - drawResolutionRef.current &&
        !currentlyDrawingRef.current
      ) {
        currentRes -= 1;
        await drawMandelbrotArea(currentRes);
      }

      // Request the next frame
      animationFrameId = requestAnimationFrame(animate);
    }

    drawEverythingRef.current = async () => {
      currentRes = 10;
      await drawMandelbrotArea(10);
    };

    updateZoomDerivedState();
    drawMandelbrotArea(10);
    animate();

    function handlePan(deltaX, deltaY, redraw = true) {
      currentRes = 10;
      const { width, height } = viewSize();
      const p = precisionRef.current;

      centerXRef.current = bfSub(
        centerXRef.current,
        bfFromNumber((deltaX / canvas.width) * width, p)
      );
      centerYRef.current = bfSub(
        centerYRef.current,
        bfFromNumber((deltaY / canvas.height) * height, p)
      );

      if (redraw) drawMandelbrotArea(15);
    }

    function applyZoom(factor, anchorX, anchorY) {
      currentRes = 10;

      // Keep the point under the cursor fixed: everything is done on the
      // arbitrary precision centre so this stays exact at any depth.
      const before = mapToComplex(anchorX, anchorY);
      zoomLevelRef.current *= factor;
      updateZoomDerivedState();
      const after = mapToComplex(anchorX, anchorY);

      centerXRef.current = bfAdd(
        centerXRef.current,
        bfSub(before[0], after[0])
      );
      centerYRef.current = bfAdd(
        centerYRef.current,
        bfSub(before[1], after[1])
      );

      drawMandelbrotArea(15);
    }

    /** Digits worth showing: enough to resolve a pixel at the current zoom. */
    function positionDigits() {
      return clamp(Math.ceil(Math.log10(zoomLevelRef.current)) + 4, 6, 60);
    }

    const handleMouseMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      mousePosRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      const complexMousePos = mapToComplex(
        mousePosRef.current.x,
        mousePosRef.current.y
      );

      const digits = positionDigits();
      complexPosRef.current.Re = bfToFixed(complexMousePos[0], digits);
      complexPosRef.current.Im = bfToFixed(complexMousePos[1], digits);

      if (!mouseClickRef.current) {
        return;
      }

      const dx = mousePosRef.current.x - startClickRef.current.x;
      const dy = mousePosRef.current.y - startClickRef.current.y;

      handlePan(dx, dy);

      // Update startClick to the current mouse position
      startClickRef.current = { ...mousePosRef.current };
    };

    const handleMouseDown = (event) => {
      mouseClickRef.current = true;
      const rect = canvas.getBoundingClientRect();

      startClickRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };

    const handleMouseUp = () => {
      mouseClickRef.current = false;
    };

    const handleWheel = (event) => {
      const mouseX = event.clientX - canvas.offsetLeft;
      const mouseY = event.clientY - canvas.offsetTop;
      applyZoom(event.deltaY < 0 ? 1.1 : 0.9, mouseX, mouseY);
    };

    let lastTouchDistance = null;
    let lastTouchCenter = null;

    const handleTouchStart = (event) => {
      if (event.touches.length === 2) {
        // Pinch start
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        lastTouchDistance = Math.sqrt(dx * dx + dy * dy);

        lastTouchCenter = {
          x: (event.touches[0].clientX + event.touches[1].clientX) / 2,
          y: (event.touches[0].clientY + event.touches[1].clientY) / 2,
        };
      }
    };

    const handleTouchMove = (event) => {
      event.preventDefault();
      if (event.touches.length === 2 && lastTouchDistance !== null) {
        // Pinch-to-zoom
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        const currentDistance = Math.sqrt(dx * dx + dy * dy);

        const currentCenter = {
          x: (event.touches[0].clientX + event.touches[1].clientX) / 2,
          y: (event.touches[0].clientY + event.touches[1].clientY) / 2,
        };

        // Pan by however far the pinch centre travelled, then zoom about it.
        handlePan(
          currentCenter.x - lastTouchCenter.x,
          currentCenter.y - lastTouchCenter.y,
          false
        );
        applyZoom(
          currentDistance / lastTouchDistance,
          currentCenter.x,
          currentCenter.y
        );

        lastTouchDistance = currentDistance;
        lastTouchCenter = currentCenter;
      } else if (event.touches.length === 1) {
        // Single-finger pan
        const touch = event.touches[0];
        const dx = touch.clientX - mousePosRef.current.x;
        const dy = touch.clientY - mousePosRef.current.y;

        // Update mousePosRef and complexPosRef for display
        mousePosRef.current = { x: touch.clientX, y: touch.clientY };
        const rect = canvas.getBoundingClientRect();
        const complexMousePos = mapToComplex(
          touch.clientX - rect.left,
          touch.clientY - rect.top
        );
        const digits = positionDigits();
        complexPosRef.current.Re = bfToFixed(complexMousePos[0], digits);
        complexPosRef.current.Im = bfToFixed(complexMousePos[1], digits);

        const panSens = 0.5;

        handlePan(dx * panSens, dy * panSens);
      }
    };

    const handleTouchEnd = () => {
      lastTouchDistance = null;
      lastTouchCenter = null;
    };

    // Panning, pinch-zoom and the wheel are all bespoke here, so the bindings
    // are declared once and torn down from that same list.
    const disposeListeners = attachListeners([
      [window, "pointermove", handleMouseMove],
      [window, "wheel", handleWheel],
      [canvas, "pointerdown", handleMouseDown],
      [canvas, "pointerup", handleMouseUp],
      [canvas, "touchstart", handleTouchStart],
      [canvas, "touchmove", handleTouchMove],
      [canvas, "touchend", handleTouchEnd],
    ]);

    return () => {
      disposed = true;
      pendingRequests.forEach((settle) => settle({ results: [] }));
      pendingRequests.clear();
      cancelAnimationFrame(animationFrameId);
      referencePendingRef.current = false;
      currentlyDrawingRef.current = false;
      disposeListeners();
      fitted.dispose();
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: "fixed", // changed from absolute to fixed
          top: 0,
          left: 0,
          width: "100vw", // ensure canvas fills viewport
          height: "var(--app-height)", // ensure canvas fills viewport
          maxWidth: "100vw", // prevent overflow
          maxHeight: "var(--app-height)", // prevent overflow
          zIndex: 0,
        }}
      />
      {visibleUI && (
        <ChangerGroup
          rerenderSetter={setRerender}
          valueArrays={valueChangers}
        />
      )}
      {visibleUI && (
        <IconGroup icons={
          [{ type: 'ZOOMABLE', text: "Scroll wheel: Zoom in and out!" },
          { type: 'PANNABLE', text: "Left click: Pan around!" }
          ]
        } />
      )}
    </>
  );
}
