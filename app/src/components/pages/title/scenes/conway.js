import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import MouseTooltip, {
  PannableToolTip,
  ZoomableToolTip,
} from "../utilities/popovers";
import { ChangerGroup } from "../utilities/valueChangers";
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
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const simulationSpeedRef = useRef(175);
  const numGridColumns = useRef(300);
  const numGridRows = useRef(700);
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

  // Add state for pattern browser and list
  const [patternList, setPatternList] = useState([]);
  const [showPatternBrowser, setShowPatternBrowser] = useState(false);

  // Viewport and zoom state
  const zoomRef = useRef(20); // cell size in px
  const viewportRef = useRef({ x: 100, y: 100 }); // top-left cell
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOrigin = useRef({ x: 0, y: 0 });

  // Fetch the local manifest for .cells files
  async function fetchPatternList() {
    try {
      const resp = await fetch("/cells/manifest.json");
      const list = await resp.json();
      setPatternList(list);
    } catch (err) {
      alert("Failed to fetch pattern list: " + err.message);
    }
  }

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

  // Escape key handler for pattern modal
  useEffect(() => {
    function handleEscape(e) {
      if (e.key === "Escape") {
        if (showPatternPreviewRef.current)
          showPatternPreviewRef.current = false;
        else setPatternText("");
        setRender((r) => r + 1);
      }
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

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

    // --- Touch gesture state ---
    let lastTouch = null; // for single finger pan
    let lastPinchDist = null; // for pinch zoom
    let pinchOrigin = null; // for pinch zoom center
    let pinchStartZoom = null;
    let pinchStartViewport = null;

    // --- Touch event handlers ---
    function getTouchPos(touch) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    }

    function getPinchDistance(touches) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function handleTouchStart(e) {
      if (e.touches.length === 1) {
        lastTouch = getTouchPos(e.touches[0]);
      } else if (e.touches.length === 2) {
        lastPinchDist = getPinchDistance(e.touches);
        pinchOrigin = {
          x:
            (e.touches[0].clientX + e.touches[1].clientX) / 2 -
            canvas.getBoundingClientRect().left,
          y:
            (e.touches[0].clientY + e.touches[1].clientY) / 2 -
            canvas.getBoundingClientRect().top,
        };
        pinchStartZoom = zoomRef.current;
        pinchStartViewport = { ...viewportRef.current };
      }
      e.preventDefault();
    }

    function handleTouchMove(e) {
      if (e.touches.length === 1 && lastTouch) {
        // Pan
        const touch = getTouchPos(e.touches[0]);
        const dx = touch.x - lastTouch.x;
        const dy = touch.y - lastTouch.y;
        // Calculate max allowed viewport values
        const maxX = Math.max(
          0,
          numGridRows.current - Math.floor(canvas.width / zoomRef.current)
        );
        const maxY = Math.max(
          0,
          numGridColumns.current - Math.floor(canvas.height / zoomRef.current)
        );
        viewportRef.current = {
          x: Math.max(
            0,
            Math.min(
              maxX,
              viewportRef.current.x - Math.round(dx / zoomRef.current)
            )
          ),
          y: Math.max(
            0,
            Math.min(
              maxY,
              viewportRef.current.y - Math.round(dy / zoomRef.current)
            )
          ),
        };
        lastTouch = touch;
        setRender((r) => r + 1);
      } else if (e.touches.length === 2 && lastPinchDist !== null) {
        // Pinch zoom
        const newDist = getPinchDistance(e.touches);
        let scale = newDist / lastPinchDist;
        let newZoom = Math.max(
          8,
          Math.min(60, Math.round(pinchStartZoom * scale))
        );
        // Zoom to pinch origin
        const gridX = Math.floor(
          pinchStartViewport.x + pinchOrigin.x / pinchStartZoom
        );
        const gridY = Math.floor(
          pinchStartViewport.y + pinchOrigin.y / pinchStartZoom
        );
        // Calculate max allowed viewport values
        const maxX = Math.max(
          0,
          numGridRows.current - Math.floor(canvas.width / newZoom)
        );
        const maxY = Math.max(
          0,
          numGridColumns.current - Math.floor(canvas.height / newZoom)
        );
        zoomRef.current = newZoom;
        viewportRef.current = {
          x: Math.max(
            0,
            Math.min(maxX, gridX - Math.floor(pinchOrigin.x / newZoom))
          ),
          y: Math.max(
            0,
            Math.min(maxY, gridY - Math.floor(pinchOrigin.y / newZoom))
          ),
        };
        setRender((r) => r + 1);
      }
      e.preventDefault();
    }

    function handleTouchEnd(e) {
      if (e.touches.length === 0) {
        lastTouch = null;
        lastPinchDist = null;
        pinchOrigin = null;
        pinchStartZoom = null;
        pinchStartViewport = null;
      }
      e.preventDefault();
    }

    const checkMobile = () => {
      return canvas.width < canvas.height;
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    const ctx = canvas.getContext("2d");

    // Update getGridFromMousePos to use viewport and zoom
    const getGridFromMousePos = () => {
      return {
        x: Math.floor(
          viewportRef.current.x + mousePosRef.current.x / zoomRef.current
        ),
        y: Math.floor(
          viewportRef.current.y + mousePosRef.current.y / zoomRef.current
        ),
      };
    };

    if (checkMobile()) {
      numGridColumns.current = 700;
      numGridRows.current = 300;
      squarifyGrid(true);
    } else {
      squarifyGrid(false);
    }

    const MAX_ZOOM = 8;
    const MIN_ZOOM = 60;

    // --- Mouse pan/zoom handlers ---
    const handleWheel = (e) => {
      e.preventDefault();
      let newZoom = zoomRef.current + (e.deltaY < 0 ? 2 : -2);
      newZoom = Math.max(MAX_ZOOM, Math.min(MIN_ZOOM, newZoom));
      // Zoom to mouse position
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const gridX = Math.floor(
        viewportRef.current.x + mouseX / zoomRef.current
      );
      const gridY = Math.floor(
        viewportRef.current.y + mouseY / zoomRef.current
      );
      zoomRef.current = newZoom;
      // Calculate max allowed viewport values
      const maxX = Math.max(
        0,
        numGridRows.current - Math.floor(canvas.width / newZoom)
      );
      const maxY = Math.max(
        0,
        numGridColumns.current - Math.floor(canvas.height / newZoom)
      );
      viewportRef.current = {
        x: Math.max(0, Math.min(maxX, gridX - Math.floor(mouseX / newZoom))),
        y: Math.max(0, Math.min(maxY, gridY - Math.floor(mouseY / newZoom))),
      };
      setRender((r) => r + 1);
    };
    const handlePointerDown = (e) => {
      if (e.button === 1) {
        isPanning.current = true;
        panStart.current = { x: e.clientX, y: e.clientY };
        panOrigin.current = { ...viewportRef.current };
        e.preventDefault();
      } else if (e.buttons === 2) {
        rightClickRef.current = true;
      } else {
        mouseClickRef.current = true;
      }
    };
    const handlePointerMove = (e) => {
      if (isPanning.current) {
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        // Calculate max allowed viewport values
        const maxX = Math.max(
          0,
          numGridRows.current - Math.floor(canvas.width / zoomRef.current)
        );
        const maxY = Math.max(
          0,
          numGridColumns.current - Math.floor(canvas.height / zoomRef.current)
        );
        viewportRef.current = {
          x: Math.max(
            0,
            Math.min(
              maxX,
              panOrigin.current.x - Math.round(dx / zoomRef.current)
            )
          ),
          y: Math.max(
            0,
            Math.min(
              maxY,
              panOrigin.current.y - Math.round(dy / zoomRef.current)
            )
          ),
        };
        setRender((r) => r + 1);
      }
      const rect = canvas.getBoundingClientRect();
      mousePosRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      mouseGridPos.current = {
        x: Math.floor(
          viewportRef.current.x + mousePosRef.current.x / zoomRef.current
        ),
        y: Math.floor(
          viewportRef.current.y + mousePosRef.current.y / zoomRef.current
        ),
      };
    };
    const handlePointerUp = (e) => {
      if (e.button === 1) {
        isPanning.current = false;
      }
      mouseClickRef.current = false;
      rightClickRef.current = false;
    };

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
        const cols = Math.ceil(canvas.width / zoomRef.current);
        const rows = Math.ceil(canvas.height / zoomRef.current);
        for (let i = 0; i < rows; i++) {
          for (let j = 0; j < cols; j++) {
            const gridY = viewportRef.current.y + i;
            const gridX = viewportRef.current.x + j;
            if (
              gridY < numGridColumns.current &&
              gridX < numGridRows.current &&
              gridY >= 0 &&
              gridX >= 0
            ) {
              if (gridRef.current[gridY][gridX].isAlive) {
                ctx.fillStyle = secondaryColorRef.current;
              } else {
                ctx.fillStyle = primaryColorRef.current;
              }
              ctx.beginPath();
              ctx.rect(
                j * zoomRef.current,
                i * zoomRef.current,
                zoomRef.current,
                zoomRef.current
              );
              ctx.fill();
            }
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
          for (let i = 0; i < patRows; i++) {
            for (
              let j = 0;
              j < (parsedPattern[i] ? parsedPattern[i].length : 0);
              j++
            ) {
              if (parsedPattern[i][j]) {
                const gridY = mouseGridPos.current.y + i;
                const gridX = mouseGridPos.current.x + j;
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
                    (gridX - viewportRef.current.x) * zoomRef.current + 1,
                    (gridY - viewportRef.current.y) * zoomRef.current + 1,
                    zoomRef.current - 2,
                    zoomRef.current - 2
                  );
                  ctx.globalAlpha = 0.3;
                  ctx.fillStyle = secondaryColorRef.current;
                  ctx.fillRect(
                    (gridX - viewportRef.current.x) * zoomRef.current + 1,
                    (gridY - viewportRef.current.y) * zoomRef.current + 1,
                    zoomRef.current - 2,
                    zoomRef.current - 2
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
        // --- Robust grid resizing logic ---
        // Ensure gridRef.current has correct number of rows
        while (gridRef.current.length < numGridColumns.current) {
          let newRow = [];
          for (let i = 0; i < numGridRows.current; i++) {
            newRow.push(new Particle());
          }
          gridRef.current.push(newRow);
        }
        while (gridRef.current.length > numGridColumns.current) {
          gridRef.current.pop();
        }
        // Ensure each row has correct number of columns
        for (let i = 0; i < gridRef.current.length; i++) {
          while (gridRef.current[i].length < numGridRows.current) {
            gridRef.current[i].push(new Particle());
          }
          while (gridRef.current[i].length > numGridRows.current) {
            gridRef.current[i].pop();
          }
        }
        this.numColumns = numGridColumns.current;
        this.numRows = numGridRows.current;
        // --- End robust grid resizing logic ---

        // Only clear and draw once per frame
        this.draw();
        // Paste pattern on click
        if (
          mouseClickRef.current &&
          parsedPatternRef.current &&
          mouseGridPos.current
        ) {
          const pattern = parsedPatternRef.current;
          const patRows = pattern.length;
          for (let i = 0; i < patRows; i++) {
            for (let j = 0; j < (pattern[i] ? pattern[i].length : 0); j++) {
              if (pattern[i][j]) {
                const gridY = mouseGridPos.current.y + i;
                const gridX = mouseGridPos.current.x + j;
                if (
                  gridY >= 0 &&
                  gridY < numGridColumns.current &&
                  gridX >= 0 &&
                  gridX < numGridRows.current
                ) {
                  gridRef.current[gridY][gridX].isAlive = true;
                }
              }
            }
          }
          mouseClickRef.current = false; // Prevent repeated pasting
        }
        if (mouseClickRef.current || rightClickRef.current) {
          let mouseClickPos = getGridFromMousePos();

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

    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("contextmenu", handleContextMenu);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    // --- Add touch listeners ---
    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd, { passive: false });

    return () => {
      // Cleanup function to cancel the animation frame and remove event listeners
      cancelAnimationFrame(animationFrameId);
      canvas.removeEventListener("pointermove", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("resize", resizeCanvas);
      document.removeEventListener("contextmenu", handleContextMenu);
      // --- Remove touch listeners ---
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
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

  // ValueChangers config for Conway
  const setRerender = setRender;
  const valueChangers = [
    [
      {
        type: "display",
        title: "Position:",
        valueRef: viewportRef,
      },
      {
        type: "display",
        title: "Zoom level:",
        valueRef: zoomRef,
      },
    ],

    [
      {
        type: "button",
        title: "",
        buttonText: showPatternPreviewRef.current
          ? "Close Pattern Preview"
          : "Open Pattern Preview",
        callback: () => {
          showPatternPreviewRef.current = !showPatternPreviewRef.current;
          setRender((r) => r + 1);
        },
      },
      {
        type: "button",
        title: "",
        buttonText: "Clear Pattern",
        callback: () => {
          setPatternText("");
          setPatternPreview(null);
        },
      },
    ],
    {
      type: "slider",
      title: "Simulation Speed:",
      valueRef: simulationSpeedRef,
      minValue: 100,
      maxValue: 200,
      callback: () => {},
    },
    [
      {
        type: "button",
        title: "Stop / Start Simulation:",
        buttonText: (
          <FontAwesomeIcon icon={isPlaying.current ? faPause : faPlay} />
        ),
        callback: () => {
          isPlaying.current = !isPlaying.current;
          setRender((prev) => prev + 1);
        },
      },
      {
        type: "button",
        title: "",
        buttonText: <FontAwesomeIcon icon={faForwardStep} />,
        callback: () => {
          gridManagerRef.current.update(names.SKIPCHECK);
        },
      },
    ],
    {
      type: "button",
      title: "Clear All Cells:",
      buttonText: <FontAwesomeIcon icon={faCircleXmark} />,
      callback: () => {
        for (let i = 0; i < numGridColumns.current; i++) {
          for (let j = 0; j < numGridRows.current; j++) {
            gridRef.current[i][j].isAlive = false;
          }
        }
        gridManagerRef.current.draw();
      },
    },
    {
      type: "button",
      title: "Generate White Noise:",
      buttonText: <FontAwesomeIcon icon={faDice} />,
      callback: () => {
        for (let i = 0; i < numGridColumns.current; i++) {
          for (let j = 0; j < numGridRows.current; j++) {
            let isAlive = Math.random() > 0.5;
            gridRef.current[i][j].isAlive = isAlive;
          }
        }
        gridManagerRef.current.draw();
      },
    },
  ];

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
      <div style={{ zIndex: 3000 }}>
        <ChangerGroup
          rerenderSetter={setRerender}
          valueArrays={valueChangers}
        />
        {/* Pattern preview window, only visible if showPatternPreviewRef.current is true */}
        {showPatternPreviewRef.current && (
          <div
            style={{
              marginBottom: "1em",
              background: theme.primary,
              color: theme.text,
              padding: "1em",
              borderRadius: 8,
              position: "absolute",
              top: "3.5em",
              left: "1em",
              zIndex: 30,
              minWidth: 320,
              boxShadow: "0 2px 16px #000a",
              border: `1px solid ${theme.border || "#333"}`,
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
                background: theme.inputBackground || theme.background,
                color: theme.text,
                border: `1px solid ${theme.border || "#333"}`,
                borderRadius: 4,
                padding: 4,
              }}
            />
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button
                onClick={() => {
                  setPatternText("");
                  setPatternPreview(null);
                }}
                style={{ fontSize: 12 }}
                title="Clear pattern text"
              >
                Clear Pattern
              </button>
              <button
                onClick={async () => {
                  setShowPatternBrowser((v) => !v);
                  if (patternList.length === 0) await fetchPatternList();
                }}
                style={{ fontSize: 12 }}
                title="Browse local patterns"
              >
                {showPatternBrowser ? "Close Browser" : "Browse Patterns"}
              </button>
            </div>
            {showPatternBrowser && (
              <div
                style={{
                  maxHeight: 300,
                  overflowY: "auto",
                  background: theme.modalBrowserBackground || theme.background,
                  border: `1px solid ${theme.border || "#333"}`,
                  borderRadius: 4,
                  marginBottom: 8,
                  padding: 4,
                }}
              >
                {patternList.length === 0 && <div>Loading patterns...</div>}
                {patternList.map((pattern) => (
                  <div
                    key={pattern.filename}
                    style={{
                      cursor: "pointer",
                      padding: "2px 0",
                      color: theme.link || "#8cf",
                      textDecoration: "underline",
                      fontSize: 13,
                    }}
                    title={
                      pattern.description +
                      (pattern.author ? `\nBy: ${pattern.author}` : "")
                    }
                    onClick={async () => {
                      const url = `/cells/${pattern.filename}`;
                      try {
                        const resp = await fetch(url);
                        if (!resp.ok) {
                          alert("Pattern not found in local cells folder");
                          return;
                        }
                        const text = await resp.text();
                        setPatternText(text);
                        setPatternPreview(parseCellsPattern(text));
                        setShowPatternBrowser(false);
                      } catch (err) {
                        alert("Failed to fetch pattern: " + err.message);
                      }
                    }}
                  >
                    <b>{pattern.name}</b>{" "}
                    <span
                      style={{
                        color: theme.subtleText || "#aaa",
                        fontSize: 11,
                      }}
                    >
                      ({pattern.filename})
                    </span>
                    <div
                      style={{
                        color: theme.subtleText || "#ccc",
                        fontSize: 11,
                      }}
                    >
                      {pattern.description}
                    </div>
                    {pattern.author && (
                      <div
                        style={{
                          color: theme.subtleText || "#aaa",
                          fontSize: 11,
                        }}
                      >
                        By: {pattern.author}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div style={{ margin: "0.5em 0", fontWeight: 500 }}>Preview:</div>
            <div
              style={{
                display: "inline-block",
                background: theme.previewBackground || theme.background,
                padding: 8,
                borderRadius: 4,
              }}
            >
              {patternPreview}
            </div>
          </div>
        )}
      </div>
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
        <ZoomableToolTip text={"Scroll: Zoom in and out"} />
        <PannableToolTip text={"Middle Mouse: Pan"} />
        <MouseTooltip
          text={"Left mouse: Place Alive Cell\nRight mouse: Place Dead Cell"}
        />
      </div>
    </>
  );
}
