import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import MouseTooltip from "../utilities/popovers";
import { ChangerGroup } from "../utilities/valueChangers";
import { clamp, colourToRGB, DIRECTIONS, getNeighbourIndexFromGrid, scaleValue } from "../utilities/usefulFunctions";

export default function Liquid({ visibleUI }) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const touchActiveRef = useRef(false);
  const particleCountRef = useRef(2000);
  const simulationSpeedRef = useRef(100);
  const mouseShieldRadiusRef = useRef(100);
  const titleShieldRadiusRef = useRef(30);
  const recalculateRectRef = useRef(() => { });

  const visibleUIRef = useRef(visibleUI);
  const [, setRender] = useState(0); // Dummy state to force re-render

  useEffect(() => {
    let element = document.getElementById("title") ?? null;
    let rect_padded = { left: 0, right: 0, top: 0, bottom: 0 };
    let elementCenterX = 0;
    let elementCenterY = 0;

    let particles = [];
    const gravity = 0.5;
    const windSpeed = 0.2;
    let animationFrameId;
    const maxFallSpeed = 13;
    const maxWindSpeed = (Math.random() - 0.5) * 10;

    const recalculateRect = () => {
      if (!element) return;
      let rect = element.getBoundingClientRect();
      rect_padded = {
        left: rect.left - titleShieldRadiusRef.current,
        right: rect.right + titleShieldRadiusRef.current,
        top: rect.top - titleShieldRadiusRef.current,
        bottom: rect.bottom + titleShieldRadiusRef.current,
      };
      elementCenterX = rect.left + rect.width / 2;
      elementCenterY = rect.top + rect.height / 2;
    };

    recalculateRectRef.current = recalculateRect;

    const canvas = canvasRef.current;
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      recalculateRect();
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("popstate", recalculateRect);
    const ctx = canvas.getContext("2d");

    const handleMouseMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      mousePosRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };

    const handleMouseDown = () => {
      mouseClickRef.current = true;
    };

    const handleMouseUp = () => {
      mouseClickRef.current = false;
    };

    const handleTouchMove = (event) => {
      if (event.touches && event.touches.length > 0) {
        const rect = canvas.getBoundingClientRect();
        const touch = event.touches[0];
        mousePosRef.current = {
          x: touch.clientX - rect.left,
          y: touch.clientY - rect.top,
        };
      }
    };

    const handleTouchStart = () => {
      touchActiveRef.current = true;
    };

    const handleTouchEnd = () => {
      touchActiveRef.current = false;
    };

    // --- Touch event handler to prevent scroll on drag ---
    function handleTouchDragPreventScroll(e) {
      if (e.touches && e.touches.length > 0) {
        e.preventDefault();
      }
    }

    const inElement = (rect, x, y) => {
      return (
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      );
    };

    recalculateRect();

    const gridWidth = 200;
    const gridHeight = 100;

    const cellTypes = {
      WATER: 0,
      WALL: 1,
    }

    class Water {
      constructor(x, y, parent) {
        this.x = x;
        this.y = y;
        this.value = 0;
        this.pressure = 1;
        this.parent = parent;
        this.type = cellTypes.WATER;
      }

      update() {
        const checkGrid = (direction) => {
          return getNeighbourIndexFromGrid(gridWidth, gridHeight, direction, (this.x + this.y * gridWidth))
        }

        this.pressure = this.value;

        const hasBottomNeighbour = checkGrid(DIRECTIONS.S);
        const hasLeftNeighbour = checkGrid(DIRECTIONS.W);
        const hasRightNeighbour = checkGrid(DIRECTIONS.E);
        const hasTopNeighbour = checkGrid(DIRECTIONS.N);

        if (hasBottomNeighbour !== -1) {
          const bottomNeighbour = this.parent.grid[hasBottomNeighbour]
          if (bottomNeighbour.type === cellTypes.WATER) {
            // if this cell has more water than the bottom water cell
            // then distribute half the difference, maybe this will be sort of realistic?
            if (this.value > bottomNeighbour.value) {
              // const halfDifference = (this.value - bottomNeighbour.value) / 2.0;
              // this.value -= halfDifference;
              bottomNeighbour.value += this.value;
              this.value = 0;
              if (this.value < 0.01) { this.value = 0 }
            }
          }
        }

        if (hasLeftNeighbour !== -1) {
          const leftNeighbour = this.parent.grid[hasLeftNeighbour]

          if (leftNeighbour.type === cellTypes.WATER) {
            if (this.value > leftNeighbour.value) {
              const halfDifference = (this.value - leftNeighbour.value) / 2.0;
              this.value -= halfDifference;
              leftNeighbour.value += halfDifference;
            }
          }

        }

        if (hasRightNeighbour !== -1) {
          const rightNeighbour = this.parent.grid[hasRightNeighbour]

          if (rightNeighbour.type === cellTypes.WATER) {
            if (this.value > rightNeighbour.value) {
              const halfDifference = (this.value - rightNeighbour.value) / 2.0;
              this.value -= halfDifference;
              rightNeighbour.value += halfDifference;
            }
          }
        }

        if (hasTopNeighbour !== -1 && this.pressure >= 1.0) {
          const topNeighbour = this.parent.grid[hasTopNeighbour]

          if (topNeighbour.type === cellTypes.WATER) {
            if (this.value > topNeighbour.value) {
              const halfDifference = (this.value - topNeighbour.value) / 2.0;
              this.value -= halfDifference;
              topNeighbour.value += halfDifference;
            }
          }
        }
      }
    }

    class GridManager {
      constructor() {
        this.grid = []

        for (let y = 0; y < gridHeight; y++) {
          for (let x = 0; x < gridWidth; x++) {
            this.grid.push(new Water(x, y, this));
          }
        }

        this.image = ctx.createImageData(gridWidth, gridHeight);
        this.clearImage()
      }

      clearImage() {
        for (let y = 0; y < gridHeight; y++) {
          for (let x = 0; x < gridWidth; x++) {
            const pixelIndex = (y * gridWidth + x) * 4;
            this.image.data[pixelIndex] = 0;
            this.image.data[pixelIndex + 1] = 0;
            this.image.data[pixelIndex + 2] = 0;
            this.image.data[pixelIndex + 3] = 0;
          }
        }
      }

      setImageRGB(x, y, r, g, b, a = 255) {
        const pixelIndex = (y * gridWidth + x) * 4;
        this.image.data[pixelIndex] = r;
        this.image.data[pixelIndex + 1] = g;
        this.image.data[pixelIndex + 2] = b;
        this.image.data[pixelIndex + 3] = a;
      }

      update() {
        this.grid.forEach((child) => {
          child.update();
        })
      }

      draw() {
        this.clearImage();
        this.grid.forEach((child) => {
          const isWater = child.value > 0.0 && child.type === cellTypes.WATER;
          const waterColour = colourToRGB(theme.secondary);
          if (isWater) { this.setImageRGB(child.x, child.y, waterColour.r, waterColour.g, waterColour.b); }
          else {
            this.setImageRGB(child.x, child.y, 0, 0, 0, 0);
          }
        })
      }
    }

    const gridManager = new GridManager();

    function animate() {

      if (mouseClickRef.current) {
        const mouseX = Math.floor(scaleValue(mousePosRef.current.x, 0, canvasRef.current.width, 0, gridWidth));
        const mouseY = Math.floor(scaleValue(mousePosRef.current.y, 0, canvasRef.current.height, 0, gridHeight));
        const index = mouseX + gridWidth * mouseY;
        gridManager.grid[Math.floor(index)].value = 1;
      }

      gridManager.update();
      gridManager.draw();

      // Put image data to a temporary canvas and scale it
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = gridWidth;
      tempCanvas.height = gridHeight;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.putImageData(gridManager.image, 0, 0);

      // Draw scaled to main canvas
      ctx.drawImage(tempCanvas, 0, 0, canvasRef.current.width, canvasRef.current.height);

      animationFrameId = requestAnimationFrame(animate);
    }

    animate();

    window.addEventListener("pointermove", handleMouseMove);
    window.addEventListener("pointerdown", handleMouseDown);
    window.addEventListener("pointerup", handleMouseUp);
    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchstart", handleTouchStart);
    window.addEventListener("touchend", handleTouchEnd);
    // Prevent default scroll on touch drag over canvas
    if (canvas) {
      canvas.addEventListener("touchmove", handleTouchDragPreventScroll, {
        passive: false,
      });
    }

    return () => {
      // Cleanup function to cancel the animation frame and remove event listeners
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("pointermove", handleMouseMove);
      window.removeEventListener("pointerdown", handleMouseDown);
      window.removeEventListener("pointerup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("popstate", recalculateRect);
      if (canvas) {
        canvas.removeEventListener("touchmove", handleTouchDragPreventScroll);
      }
      particles = [];
    };
  }, [theme.secondary]);

  useEffect(() => {
    visibleUIRef.current = visibleUI;
  }, [visibleUI]);

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
      {visibleUI && (
        <div style={{ zIndex: 3000 }}>
          <ChangerGroup
            valueArrays={[
              // {
              //   title: "Particle Count:",
              //   valueRef: particleCountRef,
              //   minValue: "100",
              //   maxValue: "10000",
              //   type: "slider",
              // },
              // {
              //   title: "Simulation Speed:",
              //   valueRef: simulationSpeedRef,
              //   minValue: "1",
              //   maxValue: "200.0",
              //   type: "slider",
              // },
              // {
              //   title: "Click Umbrella Radius:",
              //   valueRef: mouseShieldRadiusRef,
              //   minValue: "10.0",
              //   maxValue: "300.0",
              //   type: "slider",
              // },
              // {
              //   title: "Title Umbrella Radius:",
              //   valueRef: titleShieldRadiusRef,
              //   minValue: "1.0",
              //   maxValue: "100.0",
              //   callback: recalculateRectRef.current,
              //   type: "slider",
              // },
            ]}
            rerenderSetter={setRender}
          />

          <div style={{ position: "absolute", top: "1em", right: "1em" }}>
            <MouseTooltip />
          </div>
        </div>
      )}
    </>
  );
}
