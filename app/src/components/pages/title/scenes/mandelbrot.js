import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { PannableToolTip, ZoomableToolTip } from "../utilities/popovers";
import Worker from "../utilities/workers/mandelbrot.worker";
import WorkerFactory from "../utilities/workerFactory";
import { ChangerGroup } from "../utilities/valueChangers";

export default function Mandelbrot({ visibleUI }) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const drawAreaRef = useRef(400);
  const drawResolutionRef = useRef(20);
  const [, setRender] = useState(0);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const drawEverythingRef = useRef(() => {});
  const currentlyDrawingRef = useRef(false);
  const currentThemeRef = useRef(0);

  const complexPosRef = useRef({ Re: 0, Im: 0 });

  const maxIterColourRef = useRef("");
  const maxColourRef = useRef("");
  const minColourRef = useRef("");
  const colourMaxComponentsRef = useRef("");
  const colourMinComponentsRef = useRef("");
  const colourStepsRef = useRef("");
  const workerPoolRef = useRef([]);
  const workerPoolSize = 4; // Number of workers to use
  const drawGenerationRef = useRef(0); // Track current draw generation
  const centerXRef = useRef(0); // Center point X in the complex plane
  const centerYRef = useRef(0); // Center point Y in the complex plane
  const zoomLevelRef = useRef(1); // Zoom factor
  const startClickRef = useRef({ x: 0, y: 0 });

  const [customColours, setCustomColours] = useState([
    "#ff0000", // Custom max iteration colour
    "#00ff00", // Custom max interp colour
    "#0000ff", // Custom min interp colour
  ]);

  useEffect(() => {
    // Initialize worker pool
    for (let i = 0; i < workerPoolSize; i++) {
      workerPoolRef.current.push(new WorkerFactory(Worker));
    }

    return () => {
      // Terminate all workers
      workerPoolRef.current.forEach((worker) => {
        worker.terminate();
      });
      workerPoolRef.current = [];
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

  const maxIterCount = 2000;

  function mapToComplex(pixelX, pixelY) {
    // Return early if canvasRef.current is null
    if (!canvasRef.current) {
      return [0, 0];
    }

    // Calculate the view dimensions in the complex plane
    const viewWidth =
      ((canvasRef.current.width / canvasRef.current.height) * 2) /
      zoomLevelRef.current; // 4 units wide at zoom level 1
    const viewHeight = 2 / zoomLevelRef.current; // 2.25 units high at zoom level 1

    // Convert pixel coordinates to percentages of canvas
    const percentX = pixelX / canvasRef.current.width;
    const percentY = pixelY / canvasRef.current.height;
    // Map to complex plane coordinates, centered on centerX,centerY
    return [
      centerXRef.current + (percentX - 0.5) * viewWidth,
      centerYRef.current + (percentY - 0.5) * viewHeight,
    ];
  }

  function calculateMandelbrot(pixelX, pixelY) {
    const c = mapToComplex(pixelX, pixelY); // real or fake it is what it is ykwim
    const cX = c[0];
    const cY = c[1];
    let zReal = 0;
    let zIm = 0;
    let count = 0;
    let nextZReal, nextZIm;
    while (zReal ** 2 + zIm ** 2 <= 4 && count < maxIterCount) {
      nextZReal = zReal * zReal - zIm * zIm + cX;
      nextZIm = 2 * zReal * zIm + cY;

      zReal = nextZReal;
      zIm = nextZIm;

      count += 1;
    }

    return count;
  }

  const calculateColourComponents = (
    maxIterationColour,
    maxInterpColour,
    minInterpColour
  ) => {
    maxIterColourRef.current = maxIterationColour;
    maxColourRef.current = maxInterpColour;
    minColourRef.current = minInterpColour;

    colourMaxComponentsRef.current = {
      r: parseInt(maxColourRef.current.slice(1, 3), 16),
      g: parseInt(maxColourRef.current.slice(3, 5), 16),
      b: parseInt(maxColourRef.current.slice(5, 7), 16),
    };

    colourMinComponentsRef.current = {
      r: parseInt(minColourRef.current.slice(1, 3), 16),
      g: parseInt(minColourRef.current.slice(3, 5), 16),
      b: parseInt(minColourRef.current.slice(5, 7), 16),
    };

    colourStepsRef.current = {
      r:
        (colourMaxComponentsRef.current.r - colourMinComponentsRef.current.r) /
        maxIterCount,
      g:
        (colourMaxComponentsRef.current.g - colourMinComponentsRef.current.g) /
        maxIterCount,
      b:
        (colourMaxComponentsRef.current.b - colourMinComponentsRef.current.b) /
        maxIterCount,
    };
  };

  calculateColourComponents(
    themesList[currentThemeRef.current][1],
    themesList[currentThemeRef.current][2],
    themesList[currentThemeRef.current][3]
  );

  const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

  function colourInterp(value) {
    if (value === maxIterCount) {
      return maxIterColourRef.current;
    }

    const r = Math.floor(
      clamp(
        colourMinComponentsRef.current.r + value * colourStepsRef.current.r,
        0,
        255
      )
    );
    const g = Math.floor(
      clamp(
        colourMinComponentsRef.current.g + value * colourStepsRef.current.g,
        0,
        255
      )
    );
    const b = Math.floor(
      clamp(
        colourMinComponentsRef.current.b + value * colourStepsRef.current.b,
        0,
        255
      )
    );

    const rHex = r.toString(16).padStart(2, "0");
    const gHex = g.toString(16).padStart(2, "0");
    const bHex = b.toString(16).padStart(2, "0");

    return `#${rHex}${gHex}${bHex}`;
  }

  const setRerender = useState(0)[1]; // For ChangerGroup forced rerender
  const valueChangers = [
    {
      type: "display",
      title: "Position:",
      valueRef: complexPosRef,
    },

    {
      type: "display",
      title: "Zoom Intensity:",
      valueRef: zoomLevelRef,
    },
    {
      type: "slider",
      title: "Max Draw Resolution:",
      valueRef: drawResolutionRef,
      minValue: 1,
      maxValue: 20,
      callback: () => {},
    },
    [
      {
        type: "button",
        title: "Toggle Theme:",
        buttonText: themesList[0][0],
        callback: () => {
          currentThemeRef.current = 0;
          calculateColourComponents(
            themesList[0][1],
            themesList[0][2],
            themesList[0][3]
          );
          setRender((prev) => prev + 1);
          // Restart Mandelbrot rerendering cycle
          if (typeof window !== "undefined") {
            window._mandelbrotCurrentRes = 10;
          }
          drawEverythingRef.current();
        },
      },
      {
        type: "button",
        title: "",
        buttonText: themesList[1][0],
        callback: () => {
          currentThemeRef.current = 1;
          calculateColourComponents(
            themesList[1][1],
            themesList[1][2],
            themesList[1][3]
          );
          setRender((prev) => prev + 1);
          if (typeof window !== "undefined") {
            window._mandelbrotCurrentRes = 10;
          }
          drawEverythingRef.current();
        },
      },
      {
        type: "button",
        title: "",
        buttonText: themesList[2][0],
        callback: () => {
          currentThemeRef.current = 2;
          calculateColourComponents(
            themesList[2][1],
            themesList[2][2],
            themesList[2][3]
          );
          setRender((prev) => prev + 1);
          if (typeof window !== "undefined") {
            window._mandelbrotCurrentRes = 10;
          }
          drawEverythingRef.current();
        },
      },
      {
        type: "button",
        title: "",
        buttonText: themesList[3][0],
        callback: () => {
          currentThemeRef.current = 3;
          calculateColourComponents(
            themesList[3][1],
            themesList[3][2],
            themesList[3][3]
          );
          setRender((prev) => prev + 1);
          if (typeof window !== "undefined") {
            window._mandelbrotCurrentRes = 10;
          }
          drawEverythingRef.current();
        },
      },
    ],
    // Add color pickers if Custom theme is selected
    ...(currentThemeRef.current === themesList.length - 1
      ? [
          [
            {
              type: "color",
              title: "Max Iteration Colour:",
              colorValue: customColours[0],
              onChange: (newColor) => {
                const newColours = [
                  newColor,
                  customColours[1],
                  customColours[2],
                ];
                setCustomColours(newColours);
                calculateColourComponents(
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
              type: "color",
              title: "Max Interp Colour:",
              colorValue: customColours[1],
              onChange: (newColor) => {
                const newColours = [
                  customColours[0],
                  newColor,
                  customColours[2],
                ];
                setCustomColours(newColours);
                calculateColourComponents(
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
              type: "color",
              title: "Min Interp Colour:",
              colorValue: customColours[2],
              onChange: (newColor) => {
                const newColours = [
                  customColours[0],
                  customColours[1],
                  newColor,
                ];
                setCustomColours(newColours);
                calculateColourComponents(
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

    // Helper function to process a single work unit with a specific worker
    async function processWorkUnit(workerIdx, workUnit, drawGeneration, ctx) {
      const worker = workerPoolRef.current[workerIdx];
      const { chunk, y } = workUnit;

      return new Promise((resolve) => {
        const aspectRatio =
          (canvasRef.current.width / canvasRef.current.height) * 2;

        worker.postMessage({
          rowPixels: chunk,
          rowY: y,
          zoomLevel: zoomLevelRef.current,
          canvasWidth: canvasRef.current.width,
          canvasHeight: canvasRef.current.height,
          centerX: centerXRef.current,
          centerY: centerYRef.current,
          xAspectRatio: aspectRatio,
          yAspectRatio: 2,
          drawGeneration: drawGeneration,
        });

        worker.onmessage = (event) => {
          // Only use the result if the drawGeneration matches
          if (event.data.drawGeneration !== drawGeneration) {
            resolve();
            return;
          }

          const returned_data = event.data.results;

          // Cancel if a new draw has started
          if (drawGenerationRef.current !== drawGeneration) {
            resolve();
            return;
          }

          returned_data.forEach((x_data, index) => {
            const x = chunk[index];
            ctx.fillStyle = colourInterp(x_data);
            ctx.fillRect(
              x,
              y,
              21 - drawResolutionRef.current,
              21 - drawResolutionRef.current
            );
          });

          resolve();
        };
      });
    }

    async function drawMandelbrotArea(
      position,
      resolution = 21 - drawResolutionRef.current,
      drawAll = false,
      drawWithWebworker = false
    ) {
      currentlyDrawingRef.current = true;
      drawGenerationRef.current += 1; // Increment generation for each new draw
      const thisDrawGeneration = drawGenerationRef.current;
      const ctx = canvas.getContext("2d");
      let startX, startY, endX, endY;
      if (drawAll) {
        if (!drawWithWebworker) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        startX = 0;
        startY = 0;
        endX = canvas.width;
        endY = canvas.height;
      } else {
        startX = position.x - drawAreaRef.current / 2;
        startY = position.y - drawAreaRef.current / 2;
        endX = position.x + drawAreaRef.current / 2;
        endY = position.y + drawAreaRef.current / 2;
      }

      if (drawWithWebworker) {
        // Collect all work units first
        const workUnits = [];
        for (let y = startY; y < endY; y += resolution) {
          const x_array = [];
          for (let x = startX; x < endX; x += resolution) {
            x_array.push(x);
          }
          const chunkSize = 800; // Increased chunk size for better performance
          for (let i = 0; i < x_array.length; i += chunkSize) {
            const chunk = x_array.slice(i, i + chunkSize);
            workUnits.push({ chunk, y });
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
          if (workIndex < workUnits.length) {
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
        }

        // Process remaining work units as workers become available
        while (
          workIndex < workUnits.length &&
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
      } else {
        for (let y = startY; y < endY; y += resolution) {
          for (let x = startX; x < endX; x += resolution) {
            ctx.fillStyle = colourInterp(calculateMandelbrot(x, y));
            ctx.fillRect(x, y, resolution, resolution);
          }
        }
      }

      currentlyDrawingRef.current = false;
    }

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

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
        await drawMandelbrotArea({ x: 0, y: 0 }, currentRes, true, true);
      }

      drawEverythingRef.current = async () => {
        currentRes = 10;
        await drawMandelbrotArea({ x: 0, y: 0 }, 10, true);
      };

      // Request the next frame
      animationFrameId = requestAnimationFrame(animate);
    }

    drawMandelbrotArea({ x: 0, y: 0 }, 10, true);
    animate();

    function handlePan(deltaX, deltaY) {
      currentRes = 10;
      const viewWidth = 4 / zoomLevelRef.current;
      const viewHeight = 3 / zoomLevelRef.current;

      centerXRef.current -= (deltaX / canvas.width) * viewWidth;
      centerYRef.current -= (deltaY / canvas.height) * viewHeight;

      drawMandelbrotArea({ x: 0, y: 0 }, 15, true);
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

      complexPosRef.current.Re = complexMousePos[0];
      complexPosRef.current.Im = complexMousePos[1];

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
      currentRes = 10;

      // Get complex coordinates before zoom
      const complexBefore = mapToComplex(mouseX, mouseY);

      // Apply zoom factor (e.g., multiply by 1.1 for zoom in, 0.9 for zoom out)
      const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
      zoomLevelRef.current *= zoomFactor;

      // Get complex coordinates after zoom
      const complexAfter = mapToComplex(mouseX, mouseY);

      // Adjust center to keep mouse position fixed in complex plane
      centerXRef.current += complexBefore[0] - complexAfter[0];
      centerYRef.current += complexBefore[1] - complexAfter[1];

      drawMandelbrotArea({ x: 0, y: 0 }, 15, true);
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

        const zoomSense = 1;

        const zoomFactor = (currentDistance * zoomSense) / lastTouchDistance;
        zoomLevelRef.current *= zoomFactor;

        const currentCenter = {
          x: (event.touches[0].clientX + event.touches[1].clientX) / 2,
          y: (event.touches[0].clientY + event.touches[1].clientY) / 2,
        };

        const complexBefore = mapToComplex(
          lastTouchCenter.x,
          lastTouchCenter.y
        );
        const complexAfter = mapToComplex(currentCenter.x, currentCenter.y);

        centerXRef.current += complexBefore[0] - complexAfter[0];
        centerYRef.current += complexBefore[1] - complexAfter[1];

        lastTouchDistance = currentDistance;
        lastTouchCenter = currentCenter;

        drawMandelbrotArea({ x: 0, y: 0 }, 15, true);
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
        complexPosRef.current.Re = complexMousePos[0];
        complexPosRef.current.Im = complexMousePos[1];

        const panSens = 0.5;

        handlePan(dx * panSens, dy * panSens);
      }
    };

    const handleTouchEnd = () => {
      lastTouchDistance = null;
      lastTouchCenter = null;
    };

    const handleResize = () => {
      resizeCanvas();
      drawEverythingRef.current();
    };

    window.addEventListener("pointermove", handleMouseMove);
    canvas.addEventListener("pointerdown", handleMouseDown);
    canvas.addEventListener("pointerup", handleMouseUp);
    window.addEventListener("wheel", handleWheel);
    window.addEventListener("resize", handleResize);
    canvas.addEventListener("touchstart", handleTouchStart);
    canvas.addEventListener("touchmove", handleTouchMove);
    canvas.addEventListener("touchend", handleTouchEnd);

    return () => {
      cancelAnimationFrame(animationFrameId);
      // Terminate all workers in the pool
      workerPoolRef.current.forEach((worker) => {
        worker.terminate();
      });
      window.removeEventListener("pointermove", handleMouseMove);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("touchmove", handleMouseMove);
      canvas.removeEventListener("pointerdown", handleMouseDown);
      canvas.removeEventListener("pointerup", handleMouseUp);
      window.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
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
          height: "100vh", // ensure canvas fills viewport
          maxWidth: "100vw", // prevent overflow
          maxHeight: "100vh", // prevent overflow
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
        <div style={{ zIndex: 3000 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              position: "absolute",
              top: "1em",
              right: "1em",
              gap: "0.5em",
            }}
          >
            <ZoomableToolTip text={"Scroll wheel: Zoom in and out!"} />
            <PannableToolTip text={"Left click: Pan around!"} />
          </div>
        </div>
      )}
    </>
  );
}
