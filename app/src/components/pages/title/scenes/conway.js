import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleXmark,
  faDice,
  faForwardStep,
  faPause,
  faPlay,
} from "@fortawesome/free-solid-svg-icons";
import MouseTooltip from "../utilities/popovers";

const names = {
  SKIPCHECK: true,
};

export default function Conway() {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const simulationSpeedRef = useRef(175);
  const numGridColumns = useRef(30);
  const numGridRows = useRef(70);
  const gridRef = useRef(null);
  const [, setRender] = useState(0); // Dummy state to force re-render
  const isPlaying = useRef(true);
  const gridManagerRef = useRef(null);
  const rightClickRef = useRef(false);
  const currentTimer = useRef(0);

  // Use refs for theme colors
  const primaryColorRef = useRef(theme.primary);
  const secondaryColorRef = useRef(theme.secondary);

  // Add state for pattern preview
  const [patternText, setPatternText] = useState("");
  const [patternPreview, setPatternPreview] = useState(null);

  // Add ref for parsed pattern array and state for mouse grid position
  const parsedPatternRef = useRef(null);
  const mouseGridPos = useRef(null);
  // Add state for pattern preview window visibility
  const showPatternPreviewRef = useRef(false);

  // Function to parse .cells pattern text and generate a preview grid
  function parseCellsPattern(text) {
    // Remove comments and blank lines
    const lines = text
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("!"));
    if (!lines.length) return null;
    return lines.map((line, rowIdx) => (
      <div key={rowIdx} style={{ display: "flex", height: "1em" }}>
        {line.split("").map((cell, colIdx) => (
          <div
            key={colIdx}
            style={{
              width: "1em",
              height: "1em",
              background:
                cell === "O"
                  ? secondaryColorRef.current
                  : primaryColorRef.current,
              border: "1px solid #2222",
              boxSizing: "border-box",
            }}
          />
        ))}
      </div>
    ));
  }

  // Handler for textarea or file input
  function handlePatternInput(e) {
    const value = e.target.value;
    setPatternText(value);
    setPatternPreview(parseCellsPattern(value));
  }

  // Update parsedPatternRef whenever patternText changes
  useEffect(() => {
    if (!patternText) {
      parsedPatternRef.current = null;
      if (
        gridManagerRef.current &&
        typeof gridManagerRef.current.draw === "function"
      )
        gridManagerRef.current.draw();
      return;
    }
    // Parse .cells pattern into 2D array of booleans (alive = true)
    const lines = patternText
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("!"));
    if (!lines.length) {
      parsedPatternRef.current = null;
      if (
        gridManagerRef.current &&
        typeof gridManagerRef.current.draw === "function"
      )
        gridManagerRef.current.draw();
      return;
    }
    const arr = lines.map((line) => line.split("").map((cell) => cell === "O"));
    parsedPatternRef.current = arr;
    if (
      gridManagerRef.current &&
      typeof gridManagerRef.current.draw === "function"
    )
      gridManagerRef.current.draw();
  }, [patternText]);

  const squarifyGrid = (columns = false) => {
    if (columns) {
      // yeah these are swapped unfortunately hahhaah
      const newColumns = Math.round(
        (numGridRows.current / canvasRef.current.width) *
          canvasRef.current.height
      );
      numGridColumns.current = newColumns;
    } else {
      // yeah these are swapped unfortunately hahhaah
      const newRows = Math.round(
        (numGridColumns.current / canvasRef.current.height) *
          canvasRef.current.width
      );
      numGridRows.current = newRows;
    }
  };

  useEffect(() => {
    let animationFrameId;

    const handleContextMenu = (e) => {
      // prevent the right-click menu from appearing
      e.preventDefault();
    };

    const canvas = canvasRef.current;
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      try {
        gridManagerRef.current.draw();
      } catch (e) {}
    };

    const checkMobile = () => {
      return canvas.width < canvas.height;
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    const ctx = canvas.getContext("2d");

    const getGridFromMousePos = (gridRows, gridColumns) => {
      const rectWidth = canvas.width / gridRows;
      let gridX = mousePosRef.current.x / rectWidth;

      const rectHeight = canvas.height / gridColumns;
      let gridY = mousePosRef.current.y / rectHeight;

      return { x: Math.floor(gridX), y: Math.floor(gridY) };
    };

    if (checkMobile()) {
      numGridColumns.current = 70;
      numGridRows.current = 40;
      squarifyGrid(true);
    } else {
      squarifyGrid(false);
    }

    // takes a constructor of an array of particles and renders them
    class Grid {
      constructor() {
        this.draw = this.draw.bind(this); // Ensure 'this' context
        this.numColumns = numGridColumns.current;
        this.numRows = numGridRows.current;
        this.draw();
      }

      draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const rectWidth = canvas.width / numGridRows.current;
        const rectHeight = canvas.height / numGridColumns.current;
        for (let i = 0; i < numGridColumns.current; i++) {
          for (let j = 0; j < numGridRows.current; j++) {
            if (gridRef.current[i][j].isAlive) {
              ctx.fillStyle = secondaryColorRef.current;
            } else {
              ctx.fillStyle = primaryColorRef.current;
            }
            ctx.beginPath();
            ctx.rect(rectWidth * j, rectHeight * i, rectWidth, rectHeight);
            ctx.fill();
          }
        }
        // Overlay pattern preview if present and mouse is over grid
        const parsedPattern = parsedPatternRef.current;
        if (
          parsedPattern &&
          mouseGridPos.current &&
          Array.isArray(parsedPattern) &&
          parsedPattern.length > 0
        ) {
          const patRows = parsedPattern.length;
          // Defensive: handle ragged arrays
          for (let i = 0; i < patRows; i++) {
            for (
              let j = 0;
              j < (parsedPattern[i] ? parsedPattern[i].length : 0);
              j++
            ) {
              if (parsedPattern[i][j]) {
                const gridY = mouseGridPos.y + i;
                const gridX = mouseGridPos.x + j;
                if (
                  gridY >= 0 &&
                  gridY < numGridColumns.current &&
                  gridX >= 0 &&
                  gridX < numGridRows.current
                ) {
                  ctx.save();
                  ctx.globalAlpha = 0.7;
                  ctx.strokeStyle = secondaryColorRef.current;
                  ctx.lineWidth = 2;
                  ctx.strokeRect(
                    rectWidth * gridX + 1,
                    rectHeight * gridY + 1,
                    rectWidth - 2,
                    rectHeight - 2
                  );
                  ctx.globalAlpha = 0.3;
                  ctx.fillStyle = secondaryColorRef.current;
                  ctx.fillRect(
                    rectWidth * gridX + 1,
                    rectHeight * gridY + 1,
                    rectWidth - 2,
                    rectHeight - 2
                  );
                  ctx.restore();
                }
              }
            }
          }
        }
      }

      changeAlivePosition(gridX, gridY, aliveness) {
        gridRef.current[gridY][gridX].isAlive = aliveness;
        this.draw();
      }

      update(skipCheck = false) {
        if (this.numColumns !== numGridColumns.current) {
          this.updating = true;
          let rowDiff = numGridColumns.current - this.numColumns;
          if (rowDiff > 0) {
            for (let diff = 0; diff < rowDiff; diff++) {
              let newRow = [];
              for (let i = 0; i < numGridRows.current; i++) {
                newRow.push(new Particle());
              }
              gridRef.current.push(newRow);
            }
          } else {
            for (let diff = 0; diff > rowDiff; diff--) {
              gridRef.current.pop();
            }
          }

          this.draw();
          this.numColumns = numGridColumns.current;
          return;
        }

        if (this.numRows !== numGridRows.current) {
          let currentRow;
          for (let i = 0; i < numGridColumns.current; i++) {
            currentRow = gridRef.current[i];
            let rowDiff = numGridRows.current - this.numRows;
            if (rowDiff > 0) {
              for (let diff = 0; diff < rowDiff; diff++) {
                currentRow.push(new Particle());
              }
            }
            gridRef.current[i] = currentRow;
          }
          this.draw();
          this.numRows = numGridRows.current;
          return;
        }

        if (mouseClickRef.current || rightClickRef.current) {
          let mouseClickPos = getGridFromMousePos(
            numGridRows.current,
            numGridColumns.current
          );

          if (rightClickRef.current) {
            this.changeAlivePosition(mouseClickPos.x, mouseClickPos.y, false);
          } else {
            this.changeAlivePosition(mouseClickPos.x, mouseClickPos.y, true);
          }
        }

        if (!isPlaying.current && !skipCheck) {
          return;
        }

        currentTimer.current += 1;

        if (
          currentTimer.current < 200 - simulationSpeedRef.current &&
          !skipCheck
        )
          return; // Throttle the update

        currentTimer.current = 0;

        for (let i = 0; i < numGridColumns.current; i++) {
          for (let j = 0; j < numGridRows.current; j++) {
            // check surrounding neighbours to see if they are alive
            let aliveNeighbours = 0;

            if (j !== 0) {
              // check W neighbour
              if (gridRef.current[i][j - 1].isAlive) {
                aliveNeighbours += 1;
              }
              // check NW neighbour
              if (i !== 0) {
                if (gridRef.current[i - 1][j - 1].isAlive) {
                  aliveNeighbours += 1;
                }
              }
              // check SW neighbour
              if (i !== numGridColumns.current - 1) {
                if (gridRef.current[i + 1][j - 1].isAlive) {
                  aliveNeighbours += 1;
                }
              }
            }

            if (j !== numGridRows.current - 1) {
              // check E neighbour
              if (gridRef.current[i][j + 1].isAlive) {
                aliveNeighbours += 1;
              }

              // check NE neighbour
              if (i !== 0) {
                if (gridRef.current[i - 1][j + 1].isAlive) {
                  aliveNeighbours += 1;
                }
              }
              // check SE neighbour
              if (i !== numGridColumns.current - 1) {
                if (gridRef.current[i + 1][j + 1].isAlive) {
                  aliveNeighbours += 1;
                }
              }
            }

            // check N neighbour
            if (i !== 0) {
              if (gridRef.current[i - 1][j].isAlive) {
                aliveNeighbours += 1;
              }
            }
            if (i !== numGridColumns.current - 1) {
              if (gridRef.current[i + 1][j].isAlive) {
                aliveNeighbours += 1;
              }
            }

            if (gridRef.current[i][j].isAlive) {
              // overpopulation
              if (aliveNeighbours > 3) {
                gridRef.current[i][j].nextState = false;
              } else if (aliveNeighbours === 2 || aliveNeighbours === 3) {
                gridRef.current[i][j].nextState = true; // stay alive
              } else if (aliveNeighbours < 2) {
                gridRef.current[i][j].nextState = false; // underpopulation
              }
            } else {
              if (aliveNeighbours === 3) {
                gridRef.current[i][j].nextState = true; // reproduction
              } else {
                gridRef.current[i][j].nextState = false; // reproduction
              }
            }
          }
        }

        for (let i = 0; i < numGridColumns.current; i++) {
          for (let j = 0; j < numGridRows.current; j++) {
            gridRef.current[i][j].isAlive = gridRef.current[i][j].nextState;
          }
        }

        this.draw();
      }
    }

    class Particle {
      constructor(override = false, alive = true) {
        this.isAlive = Math.random() > 0.9 ? true : false;
        if (override) {
          this.isAlive = alive;
        }
        this.nextState = this.isAlive;
      }
    }

    let grid = [];

    for (let i = 0; i < numGridColumns.current; i++) {
      let row = [];
      for (let j = 0; j < numGridRows.current; j++) {
        const particle = new Particle();
        row.push(particle);
      }
      grid.push(row);
    }

    gridRef.current = grid;

    const gridDrawer = new Grid();
    gridManagerRef.current = gridDrawer;

    function animate() {
      gridDrawer.update();
      animationFrameId = requestAnimationFrame(animate);
    }

    animate();

    const handleMouseMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      mousePosRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      mouseGridPos.current = getGridFromMousePos(
        numGridColumns.current,
        numGridRows.current
      );

      console.log(mouseGridPos.current);
    };

    const handleMouseDown = (e) => {
      if (e.buttons === 2) {
        rightClickRef.current = true;
      } else {
        mouseClickRef.current = true;
      }
    };

    const handleMouseUp = () => {
      mouseClickRef.current = false;
      rightClickRef.current = false;
    };

    canvas.addEventListener("pointermove", handleMouseMove);
    canvas.addEventListener("pointerdown", handleMouseDown);
    canvas.addEventListener("pointerup", handleMouseUp);
    document.addEventListener("contextmenu", handleContextMenu);

    return () => {
      // Cleanup function to cancel the animation frame and remove event listeners
      cancelAnimationFrame(animationFrameId);
      canvas.removeEventListener("pointermove", handleMouseMove);
      canvas.removeEventListener("pointerdown", handleMouseDown);
      canvas.removeEventListener("pointerup", handleMouseUp);
      window.removeEventListener("resize", resizeCanvas);
      document.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  // Update colorRefs and redraw grid on theme change
  useEffect(() => {
    primaryColorRef.current = theme.primary;
    secondaryColorRef.current = theme.secondary;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Redraw grid with new colors
    if (
      gridManagerRef.current &&
      typeof gridManagerRef.current.draw === "function"
    ) {
      gridManagerRef.current.draw();
    }
  }, [theme]);

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
          {/* Pattern preview toggle button moved here */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "0.5em",
            }}
          >
            <button
              onClick={() => {
                showPatternPreviewRef.current = !showPatternPreviewRef.current;
                setRender((r) => r + 1);
              }}
            >
              {showPatternPreviewRef.current
                ? "Close Pattern Preview"
                : "Open Pattern Preview"}
            </button>
          </div>
          {/* Pattern preview window, only visible if showPatternPreviewRef.current is true */}
          {showPatternPreviewRef.current && (
            <div
              style={{
                marginBottom: "1em",
                background: "#222",
                padding: "1em",
                borderRadius: 8,
                position: "absolute",
                top: "3.5em",
                left: "1em",
                zIndex: 30,
                minWidth: 320,
                boxShadow: "0 2px 16px #000a",
              }}
            >
              <div style={{ marginBottom: 4, fontWeight: 600 }}>
                Paste a <code>.cells</code> pattern here to preview:
              </div>
              <textarea
                value={patternText}
                onChange={handlePatternInput}
                placeholder={"Paste .cells pattern here..."}
                rows={6}
                style={{
                  width: "100%",
                  fontFamily: "monospace",
                  marginBottom: 8,
                }}
              />
              <div style={{ margin: "0.5em 0", fontWeight: 500 }}>Preview:</div>
              <div
                style={{
                  display: "inline-block",
                  background: "#111",
                  padding: 8,
                  borderRadius: 4,
                }}
              >
                {patternPreview}
              </div>
            </div>
          )}
          {/* Simulation settings sliders/buttons below */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "0.5em",
            }}
          >
            Row Count:
            <input
              type="range"
              min="6"
              max="300"
              value={numGridColumns.current}
              onChange={(e) => {
                numGridColumns.current = Number(e.target.value);
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
            Column Count:
            <input
              type="range"
              min="6"
              max="300"
              value={numGridRows.current}
              onChange={(e) => {
                numGridRows.current = Number(e.target.value);
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
            Squarify Tiles Via:
            <button
              style={{ marginLeft: "0.5em" }}
              onClick={(e) => {
                squarifyGrid(true);
                setRender((prev) => prev + 1); // Force re-render to update slider UI
              }}
            >
              Columns
            </button>
            <button
              style={{ marginLeft: "0.5em" }}
              onClick={(e) => {
                squarifyGrid(false);
                setRender((prev) => prev + 1); // Force re-render to update slider UI
              }}
            >
              Rows
            </button>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "0.5em",
            }}
          >
            Simulation Speed:
            <input
              type="range"
              min="100.0"
              max="200.0"
              value={simulationSpeedRef.current}
              onChange={(e) => {
                simulationSpeedRef.current = Number(e.target.value);
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
            Stop / Start Simulation:
            <button
              style={{ marginLeft: "0.5em" }}
              onClick={(e) => {
                isPlaying.current = !isPlaying.current;
                setRender((prev) => prev + 1); // Force re-render to update slider UI
              }}
            >
              <FontAwesomeIcon icon={isPlaying.current ? faPause : faPlay} />
            </button>
            <button
              style={{ marginLeft: "0.5em" }}
              onClick={(e) => {
                gridManagerRef.current.update(names.SKIPCHECK);
              }}
            >
              <FontAwesomeIcon icon={faForwardStep} />
            </button>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "0.5em",
            }}
          >
            Clear All Cells:
            <button
              style={{ marginLeft: "0.5em" }}
              onClick={(e) => {
                for (let i = 0; i < numGridColumns.current; i++) {
                  for (let j = 0; j < numGridRows.current; j++) {
                    gridRef.current[i][j].isAlive = false;
                  }
                }
                gridManagerRef.current.draw();
              }}
            >
              <FontAwesomeIcon icon={faCircleXmark} />
            </button>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "0.5em",
            }}
          >
            Generate White Noise:
            <button
              style={{ marginLeft: "0.5em" }}
              onClick={(e) => {
                for (let i = 0; i < numGridColumns.current; i++) {
                  for (let j = 0; j < numGridRows.current; j++) {
                    let isAlive = Math.random() > 0.5;
                    gridRef.current[i][j].isAlive = isAlive;
                  }
                }
                gridManagerRef.current.draw();
              }}
            >
              <FontAwesomeIcon icon={faDice} />
            </button>
          </div>
        </div>
        <div style={{ position: "absolute", top: "1em", right: "1em" }}>
          <MouseTooltip />
        </div>
      </div>
    </>
  );
}
