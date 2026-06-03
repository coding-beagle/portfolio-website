import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";
import { colourToRGB } from "../utilities/usefulFunctions";
import { PI } from "three/src/nodes/math/MathNode.js";

export default function Backrooms({ visibleUI }) {
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  const canvasRef = useRef(null);
  const particleCountRef = useRef(200);
  const simulationSpeedRef = useRef(100);
  const colorRef = useRef(theme.accent);
  const [, setRender] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;

    const keysPressed = new Set();
    let keyPressCallbacks = [];

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // recalculateRect();
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    const ctx = canvas.getContext("2d");

    const drawBufferWidth = 640;
    const drawBufferHeight = 480;

    const screenBuffer = ctx.createImageData(drawBufferWidth, drawBufferHeight); // create a subcanvas to handle scaling??

    let fPlayerX = 8.0  // starting positions
    let fPlayerY = 8.0
    let fPlayerA = 0.0

    const fBaseMoveSpeed = 0.02
    const fBaseTurnSpeed = 0.005
    const fMoveSpeed = fBaseMoveSpeed // scale speeds to match scaling factor
    const fTurnSpeed = fBaseTurnSpeed

    const maxDistToWall = 0.2

    const nMapHeight = 16
    const nMapWidth = 16

    const fFov = 3.1415 / 4.0
    const rayStep = 0.1
    const maxRayLength = 16.0

    let map = ""

    map += "################"
    map += "#..............#"
    map += "#..###.........#"
    map += "#..............#"
    map += "#..............#"
    map += "#...########...#"
    map += "#..............#"
    map += "#..............#"
    map += "#..............#"
    map += "#..............#"
    map += "#.........###..#"
    map += "#..............#"
    map += "#..............#"
    map += "#...####.......#"
    map += "#..............#"
    map += "#..............#"
    map += "################"

    const isWall = (x, y) => {
      const tileX = Math.floor(x)
      const tileY = Math.floor(y)
      if (tileX < 0 || tileX >= nMapWidth || tileY < 0 || tileY >= nMapHeight) return true
      return map[tileY * nMapWidth + tileX] === "#"
    }

    // check player bubble is inside wall by generating areas around player bubble 
    const isInWall = () => {
      return (
        isWall(fPlayerX + maxDistToWall, fPlayerY) ||
        isWall(fPlayerX - maxDistToWall, fPlayerY) ||
        isWall(fPlayerX, fPlayerY + maxDistToWall) ||
        isWall(fPlayerX, fPlayerY - maxDistToWall)
      )
    }

    const coordsToIndex = (x, y) => {
      return (y * drawBufferWidth + x) * 4
    }

    const setCoordsColor = (x, y, r, g, b, a = 255) => {
      const rIndex = coordsToIndex(x, y)

      screenBuffer.data[rIndex] = r
      screenBuffer.data[rIndex + 1] = g
      screenBuffer.data[rIndex + 2] = b
      screenBuffer.data[rIndex + 3] = a
    }

    const ceilingRGB = colourToRGB(themeRef.current.primary);
    const floorRGB = colourToRGB(themeRef.current.secondary);

    // take in a map string, player pos and fill sub canvas
    const drawScreen = (map, fPlayerX, fPlayerY, fPlayerA) => {
      for (let x = 0.0; x < drawBufferWidth; x += 1.0) {
        const fRayAngle = (fPlayerA - fFov / 2.0) + (x / (drawBufferWidth * 1.0)) * fFov // convert nScreenWidth to float?

        let fDistanceToWall = 0.0

        const fEyeX = Math.sin(fRayAngle)
        const fEyeY = Math.cos(fRayAngle)

        // cast ray until it reaches a wall, or goes out of bounds
        for (let deltaRay = 0.0; deltaRay < maxRayLength; deltaRay += rayStep) {
          const nTestX = Math.floor(fPlayerX + fEyeX * fDistanceToWall)
          const nTestY = Math.floor(fPlayerY + fEyeY * fDistanceToWall)

          fDistanceToWall = deltaRay

          // ray has exceeded map boundary
          if (nTestX < 0 || nTestX >= nMapWidth || nTestY < 0 || nTestY >= nMapHeight)
            break
          // ray has reached a wall
          else if (map[nTestY * nMapWidth + nTestX] === "#") {
            break
          }
        }

        const nCeiling = (drawBufferHeight / 2.0) - drawBufferHeight / (fDistanceToWall + 0.00000001) // avoid div by 0
        const nFloor = drawBufferHeight - nCeiling

        const nShade = (fDistanceToWall) * 255 / (maxRayLength)


        for (let y = 0; y < drawBufferHeight; y++) {

          if (y < nCeiling) {
            setCoordsColor(x, y, ceilingRGB.r, ceilingRGB.g, ceilingRGB.b)
          } else if (y >= nCeiling && y <= nFloor) {
            setCoordsColor(x, y, 255 - nShade, 255 - nShade, 255 - nShade)
          } else {
            setCoordsColor(x, y, 0, 0, 0)
          }
        }

      }
    }

    const moveForward = () => {
      fPlayerX += Math.sin(fPlayerA) * fMoveSpeed;
      fPlayerY += Math.cos(fPlayerA) * fMoveSpeed;

      if (isInWall()) {
        fPlayerX -= Math.sin(fPlayerA) * fMoveSpeed;
        fPlayerY -= Math.cos(fPlayerA) * fMoveSpeed;
      }

    }

    const moveBackward = () => {
      fPlayerX -= Math.sin(fPlayerA) * fMoveSpeed;
      fPlayerY -= Math.cos(fPlayerA) * fMoveSpeed;

      if (isInWall()) {
        fPlayerX += Math.sin(fPlayerA) * fMoveSpeed;
        fPlayerY += Math.cos(fPlayerA) * fMoveSpeed;
      }
    }

    const turnLeft = () => {
      fPlayerA -= fTurnSpeed;
    }

    const turnRight = () => {
      fPlayerA += fTurnSpeed;
    }

    const forwardHandler = { key: 'i', callback: moveForward }
    const backwardHandler = { key: 'k', callback: moveBackward }
    const turnLHandler = { key: 'j', callback: turnLeft }
    const turnRHandler = { key: 'l', callback: turnRight }

    keyPressCallbacks = [forwardHandler, backwardHandler, turnLHandler, turnRHandler]

    const offscreen = document.createElement("canvas");
    offscreen.width = drawBufferWidth;
    offscreen.height = drawBufferHeight;
    const offCtx = offscreen.getContext("2d");

    let animationFrameId;
    // redraw loop
    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawScreen(map, fPlayerX, fPlayerY, fPlayerA);

      offCtx.putImageData(screenBuffer, 0, 0);
      ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);

      keyPressCallbacks.forEach((cb) => {
        if (keysPressed.has(cb.key)) {
          cb.callback()
        }
      })

      animationFrameId = requestAnimationFrame(animate);
    }

    animate();

    const handleKeyDown = (event) => {
      keysPressed.add(event.key);
    }

    const handleKeyUp = (event) => {
      keysPressed.delete(event.key);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Update colorRef and all particles' colors on theme change
  useEffect(() => {
    // Update all existing particles' colors
    themeRef.current = theme;
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

      {
        visibleUI && (
          <div style={{ zIndex: 3000 }}>
            <ChangerGroup
              valueArrays={[
                {
                  title: "Particle Count:",
                  valueRef: particleCountRef,
                  minValue: "100",
                  maxValue: "10000",
                  type: "slider",
                },
                {
                  title: "Simulation Speed:",
                  valueRef: simulationSpeedRef,
                  minValue: "1",
                  maxValue: "200.0",
                  type: "slider",
                },
              ]}
              rerenderSetter={setRender}
            />
          </div>
        )
      }
    </>
  );
}
