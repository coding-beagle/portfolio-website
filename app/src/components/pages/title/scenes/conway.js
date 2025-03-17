import React, { useEffect, useRef, useState } from "react";
import defaultColours from "../../../../themes/themes";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleXmark,
  faDice,
  faForwardStep,
  faPause,
  faPlay,
} from "@fortawesome/free-solid-svg-icons";

const names = {
  SKIPCHECK: true,
};

export default function Conway() {
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const simulationSpeedRef = useRef(100);
  const numGridColumns = useRef(30);
  const numGridRows = useRef(70);
  const gridRef = useRef(null);
  const [, setRender] = useState(0); // Dummy state to force re-render
  const isPlaying = useRef(true);
  const gridManagerRef = useRef(null);
  const rightClickRef = useRef(false);
  const currentTimer = useRef(0);

  let isDebouncing = true;

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

    if (checkMobile) {
      numGridColumns.current = 70;
      numGridRows.current = 40;
    }

    // takes a constructor of an array of particles and renders them
    class Grid {
      constructor() {
        this.draw();
        this.numColumns = numGridColumns.current;
        this.numRows = numGridRows.current;
      }

      draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const rectWidth = canvas.width / numGridRows.current;
        const rectHeight = canvas.height / numGridColumns.current;

        for (let i = 0; i < numGridColumns.current; i++) {
          for (let j = 0; j < numGridRows.current; j++) {
            if (gridRef.current[i][j].isAlive) {
              ctx.fillStyle = defaultColours.secondary;
            } else {
              ctx.fillStyle = defaultColours.primary;
            }
            ctx.beginPath();
            ctx.rect(rectWidth * j, rectHeight * i, rectWidth, rectHeight);
            ctx.fill();
          }
        }
      }

      changeAlivePosition(gridX, gridY, aliveness) {
        gridRef.current[gridY][gridX].isAlive = aliveness;
        this.draw();
        setTimeout(() => {
          isDebouncing = true;
        }, 30);
      }

      update(skipCheck = false) {
        if (this.numColumns !== numGridColumns.current) {
          console.log(gridRef.current);
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

          if (isDebouncing) {
            if (rightClickRef.current) {
              this.changeAlivePosition(mouseClickPos.x, mouseClickPos.y, false);
            } else {
              this.changeAlivePosition(mouseClickPos.x, mouseClickPos.y, true);
            }

            isDebouncing = false;
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

            if (j != 0) {
              // check W neighbour
              if (gridRef.current[i][j - 1].isAlive) {
                aliveNeighbours += 1;
              }
              // check NW neighbour
              if (i != 0) {
                if (gridRef.current[i - 1][j - 1].isAlive) {
                  aliveNeighbours += 1;
                }
              }
              // check SW neighbour
              if (i != numGridColumns.current - 1) {
                if (gridRef.current[i + 1][j - 1].isAlive) {
                  aliveNeighbours += 1;
                }
              }
            }

            if (j != numGridRows.current - 1) {
              // check E neighbour
              if (gridRef.current[i][j + 1].isAlive) {
                aliveNeighbours += 1;
              }

              // check NE neighbour
              if (i != 0) {
                if (gridRef.current[i - 1][j + 1].isAlive) {
                  aliveNeighbours += 1;
                }
              }
              // check SE neighbour
              if (i != numGridColumns.current - 1) {
                if (gridRef.current[i + 1][j + 1].isAlive) {
                  aliveNeighbours += 1;
                }
              }
            }

            // check N neighbour
            if (i != 0) {
              if (gridRef.current[i - 1][j].isAlive) {
                aliveNeighbours += 1;
              }
            }
            if (i != numGridColumns.current - 1) {
              if (gridRef.current[i + 1][j].isAlive) {
                aliveNeighbours += 1;
              }
            }

            if (gridRef.current[i][j].isAlive) {
              // overpopulation
              if (aliveNeighbours > 3) {
                gridRef.current[i][j].nextState = false;
              } else if (aliveNeighbours == 2 || aliveNeighbours == 3) {
                gridRef.current[i][j].nextState = true; // stay alive
              } else if (aliveNeighbours < 2) {
                gridRef.current[i][j].nextState = false; // underpopulation
              }
            } else {
              if (aliveNeighbours == 3) {
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
            <button style={{ marginLeft: "0.5em" }}>
              <FontAwesomeIcon
                icon={faForwardStep}
                onClick={(e) => {
                  gridManagerRef.current.update(names.SKIPCHECK);
                }}
              />
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
      </div>
    </>
  );
}
