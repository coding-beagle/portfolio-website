import React, { useEffect, useRef, useState } from "react";
import defaultColours from "../../../../themes/themes";
import MouseTooltip from "../utilities/popovers";

export default function Mandelbrot() {
  const canvasRef = useRef(null);
  const drawAreaRef = useRef(400);
  const drawResolutionRef = useRef(15);
  const [, setRender] = useState(0);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const drawEverythingRef = useRef(() => {});
  const currentlyDrawingRef = useRef(false);

  const maxIterCount = 1000;
  let transformX = 0;
  let transformY = 0;
  let startClick = { x: 0, y: 0 };
  let centerX = 0; // Center point X in the complex plane
  let centerY = 0; // Center point Y in the complex plane

  let zoomLevel = 1; // Zoom factor

  function mapToComplex(pixelX, pixelY) {
    // Calculate the view dimensions in the complex plane
    const viewWidth = 4 / zoomLevel; // 4 units wide at zoom level 1
    const viewHeight = 2.25 / zoomLevel; // 3 units high at zoom level 1

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

  const maxIterColour = defaultColours.primary;
  const maxColour = defaultColours.secondary;
  const minColour = defaultColours.primary;

  const colourMaxComponents = {
    r: parseInt(maxColour.slice(1, 3), 16),
    g: parseInt(maxColour.slice(3, 5), 16),
    b: parseInt(maxColour.slice(5, 7), 16),
  };

  const colourMinComponents = {
    r: parseInt(minColour.slice(1, 3), 16),
    g: parseInt(minColour.slice(3, 5), 16),
    b: parseInt(minColour.slice(5, 7), 16),
  };

  const colourSteps = {
    r: (colourMaxComponents.r - colourMinComponents.r) / maxIterCount,
    g: (colourMaxComponents.g - colourMinComponents.g) / maxIterCount,
    b: (colourMaxComponents.b - colourMinComponents.b) / maxIterCount,
  };

  const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

  function colourInterp(value) {
    if (value == maxIterCount) {
      return maxIterColour;
    }

    const r = Math.floor(
      clamp(colourMinComponents.r + value * colourSteps.r, 0, 255)
    );
    const g = Math.floor(
      clamp(colourMinComponents.g + value * colourSteps.g, 0, 255)
    );
    const b = Math.floor(
      clamp(colourMinComponents.b + value * colourSteps.b, 0, 255)
    );

    const rHex = r.toString(16).padStart(2, "0");
    const gHex = g.toString(16).padStart(2, "0");
    const bHex = b.toString(16).padStart(2, "0");

    return `#${rHex}${gHex}${bHex}`;
  }

  function drawMandelbrotArea(
    position,
    resolution = 21 - drawResolutionRef.current,
    drawAll = false
  ) {
    currentlyDrawingRef.current = true;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let startX, startY, endX, endY;
    if (drawAll) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
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

    // Use nested loops instead of recursion for pixel-by-pixel drawing
    for (let y = startY; y < endY; y += resolution) {
      for (let x = startX; x < endX; x += resolution) {
        ctx.fillStyle = colourInterp(calculateMandelbrot(x, y));
        ctx.fillRect(x, y, resolution, resolution);
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

    function animate() {
      // Cancel previous animation frame if it exists
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }

      if (
        currentRes > 21 - drawResolutionRef.current &&
        !currentlyDrawingRef.current
      ) {
        currentRes -= 1;
        drawMandelbrotArea({ x: 0, y: 0 }, currentRes, true);
      }

      // Request the next frame
      animationFrameId = requestAnimationFrame(animate);
    }

    // Start the animation
    drawEverythingRef.current = () => {
      drawMandelbrotArea({ x: 0, y: 0 }, 21 - drawResolutionRef.current, true);
    };

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

    window.addEventListener("pointermove", handleMouseMove);
    window.addEventListener("touchmove", handleMouseMove);
    canvas.addEventListener("pointerdown", handleMouseDown);
    canvas.addEventListener("pointerup", handleMouseUp);
    window.addEventListener("wheel", handleWheel);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("pointermove", handleMouseMove);
      window.removeEventListener("touchmove", handleMouseMove);
      canvas.removeEventListener("pointerdown", handleMouseDown);
      canvas.removeEventListener("pointerup", handleMouseUp);
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("wheel", handleWheel);
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
