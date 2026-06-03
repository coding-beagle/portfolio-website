import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";
import { colourToRGB, scaleColour, scaleValue } from "../utilities/usefulFunctions";

export default function Backrooms({ visibleUI }) {
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  const canvasRef = useRef(null);
  const moveSpeedRef = useRef(100);
  const turnSpeedRef = useRef(100);
  const fov = useRef(90);
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

    let fPlayerX = 4.5  // starting positions (centred in a room cell, away from grid walls)
    let fPlayerY = 4.5
    let fPlayerA = 0.0

    const fBaseMoveSpeed = 0.02
    const fBaseTurnSpeed = 0.005

    const maxDistToWall = 0.2

    const rayStep = 0.1
    const maxRayLength = 16.0

    // deterministic hash: returns 0.0–1.0 for any integer tile coordinate
    const tileHash = (tx, ty) => {
      let h = Math.imul(tx, 374761393) + Math.imul(ty, 668265263)
      h = Math.imul(h ^ (h >>> 13), 1274126177)
      h = h ^ (h >>> 16)
      return (h >>> 0) / 0xffffffff
    }

    // room grid: walls placed on a regular room grid + random interior walls
    const roomSize = 8          // corridor grid period
    const wallDensity = 0.18    // probability of a random interior wall tile

    const isWall = (x, y) => {
      const tx = Math.floor(x)
      const ty = Math.floor(y)

      // periodic room-grid walls (backrooms corridor structure)
      if (tx % roomSize === 0 || ty % roomSize === 0) {
        // leave doorways: open one tile per wall segment
        const doorHash = tileHash(Math.floor(tx / roomSize), Math.floor(ty / roomSize))
        const doorPos = Math.floor(doorHash * (roomSize - 1)) + 1
        const localX = ((tx % roomSize) + roomSize) % roomSize
        const localY = ((ty % roomSize) + roomSize) % roomSize
        if (tx % roomSize === 0 && localY === doorPos) return false
        if (ty % roomSize === 0 && localX === doorPos) return false
        return true
      }

      // random interior walls, except near spawn
      const spawnDist = Math.max(Math.abs(tx - Math.floor(fPlayerX)), Math.abs(ty - Math.floor(fPlayerY)))
      if (spawnDist <= 2) return false

      return tileHash(tx, ty) < wallDensity
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
    const floorRGB = colourToRGB(scaleColour('#000000', themeRef.current.quarternaryAccent, 0.2));

    const maxShades = 128

    // pre calculate possible shades of wall colour
    let wallShades = []
    for (let i = 0; i < maxShades; i++) {
      const percentColour = i / (maxShades - 1)
      wallShades.push(colourToRGB(scaleColour('#000000', theme.quarternaryAccent, percentColour)))
    }

    let floorShades = []
    for (let i = 0; i < maxShades; i++) {
      const percentColour = i / (maxShades - 1)
      floorShades.push(colourToRGB(scaleColour('#000000', theme.primary, percentColour)))
    }


    // fill sub canvas
    const drawScreen = (fPlayerX, fPlayerY, fPlayerA) => {
      const fFov = (fov.current * Math.PI / 180)

      for (let x = 0.0; x < drawBufferWidth; x += 1.0) {
        const fRayAngle = (fPlayerA - fFov / 2.0) + (x / (drawBufferWidth * 1.0)) * fFov

        let fDistanceToWall = 0.0

        const fEyeX = Math.sin(fRayAngle)
        const fEyeY = Math.cos(fRayAngle)

        // cast ray until it reaches a wall or max distance
        for (let deltaRay = 0.0; deltaRay < maxRayLength; deltaRay += rayStep) {
          fDistanceToWall = deltaRay
          if (isWall(fPlayerX + fEyeX * fDistanceToWall, fPlayerY + fEyeY * fDistanceToWall)) {
            break
          }
        }

        const nCeiling = (drawBufferHeight / 3.0) - drawBufferHeight / (fDistanceToWall + 0.00000001) // avoid div by 0
        const nFloor = drawBufferHeight - nCeiling

        const nShade = (fDistanceToWall) / (maxRayLength)


        for (let y = 0; y < drawBufferHeight; y++) {

          if (y < nCeiling) {
            setCoordsColor(x, y, ceilingRGB.r, ceilingRGB.g, ceilingRGB.b)
          } else if (y >= nCeiling && y <= nFloor) {
            const colourShade = Math.min(maxShades - 1, Math.floor(scaleValue(nShade, 0.0, 1.0, maxShades, 0)));
            const col = wallShades[colourShade]
            setCoordsColor(x, y, col.r, col.g, col.b)
          } else {
            setCoordsColor(x, y, floorRGB.r, floorRGB.g, floorRGB.b)
          }
        }

      }
    }

    const moveForward = () => {
      const fMoveSpeed = fBaseMoveSpeed * moveSpeedRef.current / 100 // scale speeds to match scaling factor

      fPlayerX += Math.sin(fPlayerA) * fMoveSpeed;
      fPlayerY += Math.cos(fPlayerA) * fMoveSpeed;

      if (isInWall()) {
        fPlayerX -= Math.sin(fPlayerA) * fMoveSpeed;
        fPlayerY -= Math.cos(fPlayerA) * fMoveSpeed;
      }

    }

    const moveBackward = () => {
      const fMoveSpeed = fBaseMoveSpeed * moveSpeedRef.current / 100 // scale speeds to match scaling factor

      fPlayerX -= Math.sin(fPlayerA) * fMoveSpeed;
      fPlayerY -= Math.cos(fPlayerA) * fMoveSpeed;

      if (isInWall()) {
        fPlayerX += Math.sin(fPlayerA) * fMoveSpeed;
        fPlayerY += Math.cos(fPlayerA) * fMoveSpeed;
      }
    }

    const turnLeft = () => {
      const fTurnSpeed = fBaseTurnSpeed * turnSpeedRef.current / 100
      fPlayerA -= fTurnSpeed;
    }

    const turnRight = () => {
      const fTurnSpeed = fBaseTurnSpeed * turnSpeedRef.current / 100
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
      drawScreen(fPlayerX, fPlayerY, fPlayerA);

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
                  title: "Move speed:",
                  valueRef: moveSpeedRef,
                  minValue: "1",
                  maxValue: "200.0",
                  type: "slider",
                },
                {
                  title: "Turn speed:",
                  valueRef: turnSpeedRef,
                  minValue: "1",
                  maxValue: "200.0",
                  type: "slider",
                },
                {
                  title: "FoV angle:",
                  valueRef: fov,
                  minValue: "40",
                  maxValue: "110.0",
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
