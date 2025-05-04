import React, { useEffect, useRef, useState } from "react";
import defaultColours from "../../../../themes/themes";
import MouseTooltip from "../utilities/popovers";
import Worker from "../utilities/workers/mandelbrot.worker";
import WorkerFactory from "../utilities/workerFactory";

export default function Mandelbrot() {
  const canvasRef = useRef(null);
  const drawAreaRef = useRef(400);
  const drawResolutionRef = useRef(15);
  const [, setRender] = useState(0);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const drawEverythingRef = useRef(() => {});
  const currentlyDrawingRef = useRef(false);
  const currentThemeRef = useRef(0);

  const maxIterColourRef = useRef("");
  const maxColourRef = useRef("");
  const minColourRef = useRef("");
  const colourMaxComponentsRef = useRef("");
  const colourMinComponentsRef = useRef("");
  const colourStepsRef = useRef("");

  const workerInstanceRef = useRef(null);

  useEffect(() => {
    workerInstanceRef.current = new WorkerFactory(Worker);

    return () => {
      workerInstanceRef.current.terminate();
      workerInstanceRef.current = null;
    };
  }, []);

  const themesList = [
    [
      "Default",
      defaultColours.primary,
      defaultColours.secondary,
      defaultColours.primary,
    ],
    [
      "Experimental",
      defaultColours.primary,
      defaultColours.tertiaryAccent,
      defaultColours.primary,
    ],
    [
      "Flashbang",
      defaultColours.tertiaryAccent,
      defaultColours.primary,
      defaultColours.accent,
    ],
  ];

  const maxIterCount = 2000;
  let transformX = 0;
  let transformY = 0;
  let startClick = { x: 0, y: 0 };
  let centerX = 0; // Center point X in the complex plane
  let centerY = 0; // Center point Y in the complex plane

  let zoomLevel = 1; // Zoom factor

  function mapToComplex(pixelX, pixelY) {
    // Return early if canvasRef.current is null
    if (!canvasRef.current) {
      return [0, 0];
    }

    // Calculate the view dimensions in the complex plane
    const viewWidth =
      ((canvasRef.current.width / canvasRef.current.height) * 2) / zoomLevel; // 4 units wide at zoom level 1
    const viewHeight = 2 / zoomLevel; // 2.25 units high at zoom level 1

    // Convert pixel coordinates to percentages of canvas
    const percentX = (pixelX + transformX) / canvasRef.current.width;
    const percentY = (pixelY + transformY) / canvasRef.current.height;

    // Map to complex plane coordinates, centered on centerX,centerY
    return [
      centerX + (percentX - 0.5) * viewWidth,
      centerY + (percentY - 0.5) * viewHeight,
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
    if (value == maxIterCount) {
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

  async function drawMandelbrotArea(
    position,
    resolution = 21 - drawResolutionRef.current,
    drawAll = false,
    drawWithWebworker = false
  ) {
    currentlyDrawingRef.current = true;
    const canvas = canvasRef.current;
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
      for (let y = startY; y < endY; y += resolution) {
        const x_array = [];
        for (let x = startX; x < endX; x += resolution) {
          x_array.push(x);
        }

        const chunkSize = 160; // Adjust this based on observed limits
        for (let i = 0; i < x_array.length; i += chunkSize) {
          const chunk = x_array.slice(i, i + chunkSize);
          const aspectRatio =
            (canvasRef.current.width / canvasRef.current.height) * 2;
          workerInstanceRef.current.postMessage({
            rowPixels: chunk,
            rowY: y,
            zoomLevel: zoomLevel,
            transformX: transformX,
            transformY: transformY,
            canvasWidth: canvasRef.current.width,
            canvasHeight: canvasRef.current.height,
            centerX: centerX,
            centerY: centerY,
            xAspectRatio: aspectRatio,
            yAspectRatio: 2,
          });

          let returned_data = [];
          await new Promise((resolve) => {
            workerInstanceRef.current.onmessage = (event) => {
              returned_data = event.data;
              resolve();
            };
          });

          returned_data.forEach((x_data, index) => {
            const x = chunk[index];
            ctx.fillStyle = colourInterp(x_data);
            ctx.fillRect(x, y, resolution, resolution);
          });
        }
      }
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

  useEffect(() => {
    const canvas = canvasRef.current;

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
      const viewWidth = 4 / zoomLevel;
      const viewHeight = 3 / zoomLevel;

      centerX -= (deltaX / canvas.width) * viewWidth;
      centerY -= (deltaY / canvas.height) * viewHeight;

      drawMandelbrotArea({ x: 0, y: 0 }, 15, true);
    }

    const handleMouseMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      mousePosRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      if (!mouseClickRef.current) {
        return;
      }

      const dx = mousePosRef.current.x - startClick.x;
      const dy = mousePosRef.current.y - startClick.y;

      handlePan(dx, dy);

      // Update startClick to the current mouse position
      startClick = { ...mousePosRef.current };
    };

    const handleMouseDown = (event) => {
      mouseClickRef.current = true;
      const rect = canvas.getBoundingClientRect();

      startClick = {
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
      zoomLevel *= zoomFactor;

      // Get complex coordinates after zoom
      const complexAfter = mapToComplex(mouseX, mouseY);

      // Adjust center to keep mouse position fixed in complex plane
      centerX += complexBefore[0] - complexAfter[0];
      centerY += complexBefore[1] - complexAfter[1];

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

        const zoomFactor = currentDistance / lastTouchDistance;
        zoomLevel *= zoomFactor;

        const currentCenter = {
          x: (event.touches[0].clientX + event.touches[1].clientX) / 2,
          y: (event.touches[0].clientY + event.touches[1].clientY) / 2,
        };

        const complexBefore = mapToComplex(
          lastTouchCenter.x,
          lastTouchCenter.y
        );
        const complexAfter = mapToComplex(currentCenter.x, currentCenter.y);

        centerX += complexBefore[0] - complexAfter[0];
        centerY += complexBefore[1] - complexAfter[1];

        lastTouchDistance = currentDistance;
        lastTouchCenter = currentCenter;

        drawMandelbrotArea({ x: 0, y: 0 }, 15, true);
      } else if (event.touches.length === 1) {
        // Single-finger pan
        const touch = event.touches[0];
        const dx = touch.clientX - mousePosRef.current.x;
        const dy = touch.clientY - mousePosRef.current.y;

        handlePan(dx, dy);

        mousePosRef.current = { x: touch.clientX, y: touch.clientY };
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
    window.addEventListener("touchmove", handleMouseMove);
    canvas.addEventListener("pointerdown", handleMouseDown);
    canvas.addEventListener("pointerup", handleMouseUp);
    window.addEventListener("wheel", handleWheel);
    window.addEventListener("resize", handleResize);
    canvas.addEventListener("touchstart", handleTouchStart);
    canvas.addEventListener("touchmove", handleTouchMove);
    canvas.addEventListener("touchend", handleTouchEnd);

    return () => {
      cancelAnimationFrame(animationFrameId);
      workerInstanceRef.current?.terminate();
      window.removeEventListener("pointermove", handleMouseMove);
      window.removeEventListener("resize", drawEverythingRef.current);
      window.removeEventListener("touchmove", handleMouseMove);
      canvas.removeEventListener("pointerdown", handleMouseDown);
      canvas.removeEventListener("pointerup", handleMouseUp);
      window.removeEventListener("resize", handleResize);
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
          position: "absolute",
          top: 0,
          left: 0,
        }}
      />
      <div style={{ zIndex: 10 }}>
        <div style={{ position: "absolute", top: "1em", left: "1em" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "0.5em",
            }}
          >
            Max Draw Resolution:
            <input
              type="range"
              min="1.0"
              max="20.0"
              value={drawResolutionRef.current}
              onChange={(e) => {
                drawResolutionRef.current = Number(e.target.value);
                setRender((prev) => prev + 1); // Force re-render to update slider UI
              }}
              style={{ marginLeft: "0.5em" }}
            />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "0.5em",
            }}
          >
            Toggle Theme:
            {themesList.map((theme, index) => (
              <button
                key={index}
                style={{ marginLeft: "0.5em" }}
                onClick={() => {
                  currentThemeRef.current = index;
                  calculateColourComponents(theme[1], theme[2], theme[3]);
                  drawEverythingRef.current();
                }}
              >
                {theme[0]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ zIndex: 10 }}>
        <div style={{ position: "absolute", top: "1em", right: "1em" }}>
          <MouseTooltip />
        </div>
      </div>
    </>
  );
}
