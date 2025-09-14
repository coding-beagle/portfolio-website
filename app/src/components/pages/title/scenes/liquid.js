import React, { useContext, useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import MouseTooltip, { IconGroup } from "../utilities/popovers";
import { ChangerGroup } from "../utilities/valueChangers";
import { clamp, colourToRGB, DIRECTIONS, getIndexFromBrushSize, getNeighbourIndexFromGrid, inRect, scaleValue } from "../utilities/usefulFunctions";
import { MobileContext } from "../../../../contexts/MobileContext";

export default function Liquid({ visibleUI }) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });

  const [reset, setReset] = useState(false);
  const brushSizeRef = useRef(1);
  const fluidSpeedRef = useRef(100);
  const maxFlowRate = useRef(400);
  const simulationSpeedRef = useRef(100);

  const clearRef = useRef(null);

  const mouseClickRef = useRef(false);
  const rightClickRef = useRef(false);
  const touchActiveRef = useRef(false);
  const titleShieldRadiusRef = useRef(30);
  const recalculateRectRef = useRef(() => { });

  const tapFrequencyRef = useRef(20);
  const tapOnTime = useRef(5);

  const TOOLS = { WATER: 0, WALL: 1, ERASE: 2, SPONGE: 3, TAP: 4, DRAIN: 5 }

  const currentToolRef = useRef(TOOLS.WATER)

  const themeRef = useRef(theme);

  const visibleUIRef = useRef(visibleUI);
  const [, setRender] = useState(0); // Dummy state to force re-render

  const mobile = useContext(MobileContext);

  useEffect(() => {
    let element = document.getElementById("title") ?? null;
    let rect_padded = { left: 0, right: 0, top: 0, bottom: 0 };
    let elementCenterX = 0;
    let elementCenterY = 0;

    let animationFrameId;

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

    const handleMouseDown = (e) => {
      // e.preventDefault()
      if (e.buttons === 2) {
        rightClickRef.current = true;
      } else {
        mouseClickRef.current = true;
      }
    };

    const handleContextMenu = (e) => {
      e.preventDefault();
    }

    const handleMouseUp = (e) => {

      mouseClickRef.current = false;
      rightClickRef.current = false;
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

    const gridWidth = mobile ? 50 : 300;
    const gridHeight = mobile ? 100 : 150;

    const cellTypes = {
      WATER: 0,
      WALL: 1,
      TAP: 2,
      DRAIN: 3
    }

    // Max and min cell liquid values
    const MaxValue = 1.0;
    const MinValue = 0.005;

    // Extra liquid a cell can store than the cell above it
    const MaxCompression = 0.25;

    // Lowest and highest amount of liquids allowed to flow per iteration
    const MinFlow = 0.005;


    const CalculateVerticalFlowValue = (remainingLiquid, destinationLiquid) => {
      const sum = remainingLiquid + destinationLiquid;
      let value = 0;

      if (sum <= MaxValue) {
        value = MaxValue;
      } else if (sum < 2 * MaxValue + MaxCompression) {
        value = (MaxValue * MaxValue + sum * MaxCompression) / (MaxValue + MaxCompression);
      } else {
        value = (sum + MaxCompression) / 2.0;
      }

      return value;
    }

    class Water {
      constructor(x, y, parent, initType = cellTypes.WATER, phase = 0) {
        this.x = x;
        this.y = y;
        this.value = 0;
        this.pressure = 1;
        this.parent = parent;
        this.type = initType;
        this.nextValue = 0;
        this.canTransition = true;
        this.tapCounter = phase;
        this.phase = phase;
      }

      tapLogic() {
        this.tapCounter += 1 * (tapFrequencyRef.current / 100.0);

        const cyclePosition = (this.tapCounter + this.phase) % 100;

        if (cyclePosition <= tapOnTime.current) {
          const checkGrid = (direction) => {
            return getNeighbourIndexFromGrid(gridWidth, gridHeight, direction, (this.x + this.y * gridWidth))
          }

          const checkNeighbourAndSpawn = (direction) => {
            const hasNeighbourInDirection = checkGrid(direction)
            if (hasNeighbourInDirection !== -1) {
              const block = this.parent.grid[hasNeighbourInDirection]
              if (block.type === cellTypes.WATER) {
                block.value = 1;
              }
            }
          }

          checkNeighbourAndSpawn(DIRECTIONS.S);
          // checkNeighbourAndSpawn(DIRECTIONS.W);
          // checkNeighbourAndSpawn(DIRECTIONS.E);
        }

        if (this.tapCounter > 100) {
          this.tapCounter = 0;
        }
      }

      update() {

        if (this.type === cellTypes.TAP) {
          this.tapLogic()
        }

        if (this.type !== cellTypes.WATER) { return }

        const MaxFlow = maxFlowRate.current / 100;
        const FlowSpeed = fluidSpeedRef.current / 100.0;

        const checkGrid = (direction) => {
          return getNeighbourIndexFromGrid(gridWidth, gridHeight, direction, (this.x + this.y * gridWidth))
        }

        const startValue = this.value;
        let remainingValue = this.value;
        let flow = 0;

        const hasBottomNeighbour = checkGrid(DIRECTIONS.S);
        const hasLeftNeighbour = checkGrid(DIRECTIONS.W);
        const hasRightNeighbour = checkGrid(DIRECTIONS.E);
        const hasTopNeighbour = checkGrid(DIRECTIONS.N);


        // Calculate all potential flows without modifying nextValue yet
        if (hasBottomNeighbour !== -1) {
          const bottomNeighbour = this.parent.grid[hasBottomNeighbour];
          if (bottomNeighbour.type === cellTypes.WATER) {
            flow = CalculateVerticalFlowValue(this.value, bottomNeighbour.value) - bottomNeighbour.value;
            if (bottomNeighbour.value > 0 && flow > MinFlow)
              flow *= FlowSpeed;

            flow = Math.max(flow, 0);
            if (flow > Math.min(MaxFlow, this.value))
              flow = Math.min(MaxFlow, this.value);

            // Update temp values
            if (flow != 0) {
              remainingValue -= flow;
              this.nextValue -= flow;
              bottomNeighbour.nextValue += flow;
            }
          } else if (bottomNeighbour.type === cellTypes.DRAIN) {
            this.nextValue -= this.value;
          }
        }

        // Check to ensure we still have liquid in this cell
        if (remainingValue < MinValue) {
          this.nextValue -= remainingValue;
          return;
        }

        if (hasLeftNeighbour !== -1) {
          const leftNeighbour = this.parent.grid[hasLeftNeighbour];
          if (leftNeighbour.type === cellTypes.WATER) {
            // Calculate flow rate
            flow = (remainingValue - leftNeighbour.value) / 4.0;
            if (flow > MinFlow)
              flow *= FlowSpeed;

            // constrain flow
            flow = Math.max(flow, 0);
            if (flow > Math.min(MaxFlow, remainingValue))
              flow = Math.min(MaxFlow, remainingValue);

            // Adjust temp values
            if (flow != 0) {
              remainingValue -= flow;
              this.nextValue -= flow;
              leftNeighbour.nextValue += flow;
            }
          } else if (leftNeighbour.type === cellTypes.DRAIN) {
            this.nextValue -= this.value;
          }
        }

        // Check to ensure we still have liquid in this cell
        if (remainingValue < MinValue) {
          this.nextValue -= remainingValue;
          return;
        }

        if (hasRightNeighbour !== -1) {
          const rightNeighbour = this.parent.grid[hasRightNeighbour];
          if (rightNeighbour.type === cellTypes.WATER) {
            // Calculate flow rate
            flow = (remainingValue - rightNeighbour.value) / 4.0;
            if (flow > MinFlow)
              flow *= FlowSpeed;

            // constrain flow
            flow = Math.max(flow, 0);
            if (flow > Math.min(MaxFlow, remainingValue))
              flow = Math.min(MaxFlow, remainingValue);

            // Adjust temp values
            if (flow != 0) {
              remainingValue -= flow;
              this.nextValue -= flow;
              rightNeighbour.nextValue += flow;
            }
          } else if (rightNeighbour.type === cellTypes.DRAIN) {
            this.nextValue -= this.value;
          }
        }

        // Check to ensure we still have liquid in this cell
        if (remainingValue < MinValue) {
          this.nextValue -= remainingValue;
          return;
        }

        if (hasTopNeighbour !== -1) {
          const topNeighbour = this.parent.grid[hasTopNeighbour];
          if (topNeighbour.type === cellTypes.WATER) {
            flow = remainingValue - CalculateVerticalFlowValue(remainingValue, topNeighbour.value);
            if (flow > MinFlow)
              flow *= FlowSpeed;

            // constrain flow
            flow = Math.max(flow, 0);
            if (flow > Math.min(MaxFlow, remainingValue))
              flow = Math.min(MaxFlow, remainingValue);

            // Adjust values
            if (flow != 0) {
              remainingValue -= flow;
              this.nextValue -= flow;
              topNeighbour.nextValue += flow;
            }
          }
        }

      }
    }

    class GridManager {
      constructor() {
        this.grid = []

        this.initScene()



        this.image = ctx.createImageData(gridWidth, gridHeight);
        this.clearImage()

        this.hoveredGrid = []

        this.simValue = 0;
      }

      initScene() {
        // init scene with top row as taps, bottom row as drains, everything else as water
        for (let y = 0; y < gridHeight; y++) {
          for (let x = 0; x < gridWidth; x++) {
            let type, phase;
            phase = Math.floor((x / gridWidth) * 100.0);
            if (y === 0) { type = cellTypes.TAP }
            else if (y === gridHeight - 1) { type = cellTypes.DRAIN }
            else { type = cellTypes.WATER }

            this.grid.push(new Water(x, y, this, type, phase));
          }
        }

        // create random arrangement of crosses
        for (let y = 0; y < gridHeight; y++) {
          for (let x = 0; x < gridWidth; x++) {
            const ignoreCenterX = mobile ? (x < gridWidth / 4 || x > 3 * gridWidth / 4) : (x < gridWidth / 2.5 || x > 1.5 * gridWidth / 2.5)
            const ignoreCenterY = (y < gridHeight / 3 || y > 1.5 * gridHeight / 2.5)
            if (Math.random() > 0.99 && (ignoreCenterX || ignoreCenterY)) {
              const setNeighbourToWallFromDirection = (direction) => {
                const index = getNeighbourIndexFromGrid(gridWidth, gridHeight, direction, x + y * gridWidth);
                if (index !== -1) {
                  this.grid[index].type = cellTypes.WALL;
                }
              }
              setNeighbourToWallFromDirection(DIRECTIONS.N);
              setNeighbourToWallFromDirection(DIRECTIONS.W);
              setNeighbourToWallFromDirection(DIRECTIONS.E);
              setNeighbourToWallFromDirection(DIRECTIONS.S);
              this.grid[x + y * gridWidth].type = cellTypes.WALL
            }
          }
        }


      }

      clearScene() {
        this.grid.forEach((cell) => {
          cell.value = 0;
          cell.type = cellTypes.WATER;
        })
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

      setXYRGB(x, y, r, g, b, a = 255) {
        const pixelIndex = (y * gridWidth + x) * 4;
        this.image.data[pixelIndex] = r;
        this.image.data[pixelIndex + 1] = g;
        this.image.data[pixelIndex + 2] = b;
        this.image.data[pixelIndex + 3] = a;
      }

      setIndexRGB(index, r, g, b, a = 255, add = false) {
        if (add) {
          this.image.data[index] += r;
          this.image.data[index + 1] += g;
          this.image.data[index + 2] += b;
          this.image.data[index + 3] += a;
        } else {
          this.image.data[index] = r;
          this.image.data[index + 1] = g;
          this.image.data[index + 2] = b;
          this.image.data[index + 3] = a;
        }
      }

      update() {

        this.simValue += simulationSpeedRef.current;
        if (this.simValue < 100) { return }
        else {
          this.simValue = 0;
        }

        this.grid.forEach((cell) => {
          cell.nextValue = cell.value;
        })

        this.grid.forEach((cell) => {
          cell.update();
        })

        this.grid.forEach((cell) => {
          cell.value = Math.max(0, cell.nextValue); // Ensure no negative values
        })
      }

      draw() {
        this.clearImage();
        this.grid.forEach((cell) => {
          switch (cell.type) {
            case cellTypes.WALL:
              const wallColour = colourToRGB(themeRef.current.accent);
              this.setXYRGB(cell.x, cell.y, wallColour.r, wallColour.g, wallColour.b);
              break;

            case cellTypes.WATER:
              if (cell.value > 0.05) {
                const waterColour = colourToRGB(themeRef.current.secondary);
                this.setXYRGB(cell.x, cell.y, waterColour.r, waterColour.g - Math.floor(cell.value * 10), waterColour.b - Math.floor(cell.value * 10));
              }
              break;
            case cellTypes.TAP:
              const tapColour = colourToRGB(themeRef.current.secondaryAccent);
              this.setXYRGB(cell.x, cell.y, tapColour.r, tapColour.g, tapColour.b);
              break;
            case cellTypes.DRAIN:
              const drainColour = colourToRGB(themeRef.current.tertiaryAccent);
              this.setXYRGB(cell.x, cell.y, drainColour.r, drainColour.g, drainColour.b);
              break;
            default:
              this.setXYRGB(cell.x, cell.y, 0, 0, 0, 0);
          }
        })

        this.hoveredGrid.forEach((index) => {
          this.setIndexRGB(index * 4, 255, 255, 255, 50, true);
        })
      }
    }

    const gridManager = new GridManager();

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = gridWidth;
    tempCanvas.height = gridHeight;
    const tempCtx = tempCanvas.getContext('2d');

    tempCtx.imageSmoothingEnabled = false;

    function animate() {

      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
      const mouseX = Math.floor(scaleValue(mousePosRef.current.x, 0, canvasRef.current.width, 0, gridWidth));
      const mouseY = Math.floor(scaleValue(mousePosRef.current.y, 0, canvasRef.current.height, 0, gridHeight));
      const index = mouseX + gridWidth * mouseY;
      const indexes = getIndexFromBrushSize(gridWidth, gridHeight, index, brushSizeRef.current - 1);

      gridManager.hoveredGrid = indexes;
      clearRef.current = () => gridManager.clearScene();

      if (mouseClickRef.current) {
        switch (currentToolRef.current) {
          case TOOLS.WATER:
            indexes.forEach((index) => {
              const item = gridManager.grid[Math.floor(index)]
              if (item.type === cellTypes.WATER) {
                gridManager.grid[Math.floor(index)].value = 1;
              }
            })
            break;
          case TOOLS.WALL:
            indexes.forEach((index) => {
              const item = gridManager.grid[Math.floor(index)]
              if (item.type === cellTypes.WATER) {
                item.type = cellTypes.WALL;
              }
            })
            break;

          case TOOLS.ERASE:
            indexes.forEach((index) => {
              const item = gridManager.grid[Math.floor(index)]
              if (item.type !== cellTypes.WATER) {
                item.type = cellTypes.WATER;
              }
            })
            break;
          case TOOLS.SPONGE:
            indexes.forEach((index) => {
              const item = gridManager.grid[Math.floor(index)]
              if (item.type === cellTypes.WATER) {
                item.value = 0.0;
              }
            })
            break;
          case TOOLS.TAP:
            indexes.forEach((index) => {
              const item = gridManager.grid[Math.floor(index)]
              item.type = cellTypes.TAP;

            })
            break;

          case TOOLS.DRAIN:
            indexes.forEach((index) => {
              const item = gridManager.grid[Math.floor(index)]
              item.type = cellTypes.DRAIN;

            })
            break;

          default:
            console.log("Lmao")
        }


      }

      gridManager.update();
      gridManager.draw();

      // Put image data to the temp canvas (reuse existing canvas)
      tempCtx.putImageData(gridManager.image, 0, 0);

      // Disable smoothing on main context for crisp pixels
      ctx.imageSmoothingEnabled = false;

      // Draw scaled to main canvas
      ctx.drawImage(tempCanvas, 0, 0, canvasRef.current.width, canvasRef.current.height);

      animationFrameId = requestAnimationFrame(animate);
    }

    animate();

    canvas.addEventListener("pointermove", handleMouseMove);
    canvas.addEventListener("pointerdown", handleMouseDown);
    canvas.addEventListener("pointerup", handleMouseUp);
    canvas.addEventListener("touchmove", handleTouchMove);
    canvas.addEventListener("touchstart", handleTouchStart);
    canvas.addEventListener("touchend", handleTouchEnd);
    canvas.addEventListener("contextmenu", handleContextMenu);
    // Prevent default scroll on touch drag over canvas
    if (canvas) {
      canvas.addEventListener("touchmove", handleTouchDragPreventScroll, {
        passive: false,
      });
    }

    return () => {
      // Cleanup function to cancel the animation frame and remove event listeners
      cancelAnimationFrame(animationFrameId);
      canvas.removeEventListener("contextmenu", handleContextMenu);
      canvas.removeEventListener("pointermove", handleMouseMove);
      canvas.removeEventListener("pointerdown", handleMouseDown);
      canvas.removeEventListener("pointerup", handleMouseUp);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchend", handleTouchEnd);
      canvas.removeEventListener("resize", resizeCanvas);
      if (canvas) {
        canvas.removeEventListener("touchmove", handleTouchDragPreventScroll);
      }
    };
  }, [reset]);

  useEffect(() => {
    visibleUIRef.current = visibleUI;
  }, [visibleUI]);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme])

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
              {
                title: "Simulation Speed:",
                valueRef: simulationSpeedRef,
                minValue: "0.0",
                maxValue: "100.0",
                type: "slider",
              },
              {
                title: "Brush Size:",
                valueRef: brushSizeRef,
                minValue: "1.0",
                maxValue: "10.0",
                type: "slider",
              },
              [
                {
                  title: "Tool Selection:",
                  type: "button",
                  enabled: currentToolRef.current === TOOLS.ERASE,
                  buttonText: "Erase",
                  callback: () => {
                    currentToolRef.current = TOOLS.ERASE
                  }
                },
                {
                  type: "button",
                  enabled: currentToolRef.current === TOOLS.SPONGE,
                  buttonText: "Sponge",
                  callback: () => {
                    currentToolRef.current = TOOLS.SPONGE
                  }
                }
              ],
              [{
                title: "Block Selection:",
                type: "button",
                enabled: currentToolRef.current === TOOLS.WATER,
                buttonText: "Water",
                callback: () => {
                  currentToolRef.current = TOOLS.WATER
                }
              },
              {
                type: "button",
                enabled: currentToolRef.current === TOOLS.WALL,
                buttonText: "Wall",
                callback: () => {
                  currentToolRef.current = TOOLS.WALL
                }
              },
              {
                type: "button",
                enabled: currentToolRef.current === TOOLS.TAP,
                buttonText: "Tap",
                callback: () => {
                  currentToolRef.current = TOOLS.TAP
                }
              },
              {
                type: "button",
                enabled: currentToolRef.current === TOOLS.DRAIN,
                buttonText: "Drain",
                callback: () => {
                  currentToolRef.current = TOOLS.DRAIN
                }
              },
              ],
              [
                {
                  title: "Tap Spawn Rate:",
                  valueRef: tapFrequencyRef,
                  minValue: "1.0",
                  maxValue: "200.0",
                  type: "slider",
                },
                {
                  title: "Tap Spawn Duration:",
                  valueRef: tapOnTime,
                  minValue: "1.0",
                  maxValue: "100.0",
                  type: "slider",
                },],
              [{
                type: "button",
                buttonText: "Reset",
                callback: () => {
                  setReset((prev) => { return !prev });
                }
              },
              {
                type: "button",
                buttonText: "Clear",
                callback: () => {
                  if (clearRef.current) {
                    clearRef.current()
                  }
                }
              }]

            ]}
            rerenderSetter={setRender}
          />

          <IconGroup icons={[
            { type: "MOUSE" },
          ]} />
        </div>
      )}
    </>
  );
}
