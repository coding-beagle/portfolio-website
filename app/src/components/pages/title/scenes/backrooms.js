import React, { useEffect, useRef, useState, useContext } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";
import { colourToRGB, scaleColour, scaleValue } from "../utilities/usefulFunctions";
import { VirtualJoypad } from "../utilities/virtualJoypad";
import { MobileContext } from "../../../../contexts/MobileContext";

export default function Backrooms({ visibleUI }) {
  const { theme } = useTheme();
  const mobile = useContext(MobileContext);
  const themeRef = useRef(theme);
  const canvasRef = useRef(null);
  const moveSpeedRef = useRef(100);
  const turnSpeedRef = useRef(100);
  const fov = useRef(mobile ? 40 : 65);
  const joystickDragRef = useRef({ active: false, touchId: null, anchorX: 0, anchorY: 0 });
  const joystickInputRef = useRef({ x: 0, y: 0 });
  const [joystickVisible, setJoystickVisible] = useState(false);
  const [joystickPosition, setJoystickPosition] = useState({ x: 0, y: 0 });
  const [joystickOffset, setJoystickOffset] = useState({ x: 0, y: 0 });
  const [, setRender] = useState(0);

  const joystickSize = "10vh";

  const resetJoystick = () => {
    joystickDragRef.current = { active: false, touchId: null, anchorX: 0, anchorY: 0 };
    joystickInputRef.current = { x: 0, y: 0 };
    setJoystickOffset({ x: 0, y: 0 });
    setJoystickVisible(false);
  };

  const updateJoystickFromPoint = (clientX, clientY) => {
    const { anchorX, anchorY } = joystickDragRef.current;
    const sizePx = window.innerHeight * 0.1;
    const maxOffset = sizePx * 0.1;

    let dx = clientX - anchorX;
    let dy = clientY - anchorY;

    const distance = Math.hypot(dx, dy);

    if (distance > maxOffset && distance > 0) {
      const scale = maxOffset / distance;
      dx *= scale;
      dy *= scale;
    }

    joystickInputRef.current = {
      x: maxOffset > 0 ? dx / maxOffset : 0,
      y: maxOffset > 0 ? dy / maxOffset : 0,
    };

    setJoystickOffset({ x: dx, y: dy });
  };

  const activateJoystick = (clientX, clientY, touchId = null) => {
    joystickDragRef.current = {
      active: true,
      touchId,
      anchorX: clientX,
      anchorY: clientY,
    };

    joystickInputRef.current = { x: 0, y: 0 };
    setJoystickPosition({ x: clientX, y: clientY });
    setJoystickOffset({ x: 0, y: 0 });
    setJoystickVisible(true);
  };

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

    const drawBufferWidth = mobile ? 480 : 640;
    const drawBufferHeight = mobile ? 640 : 480;

    const screenBuffer = ctx.createImageData(drawBufferWidth, drawBufferHeight); // create a subcanvas to handle scaling??

    let fPlayerX = 8.0  // starting positions
    let fPlayerY = 8.0
    let fPlayerA = 0.0

    const fBaseMoveSpeed = 0.01
    const fBaseTurnSpeed = 0.003

    const maxDistToWall = 0.2

    const rayStep = 0.1
    const maxRayLength = 16.0

    let map = ""

    // todo make this doomscroll
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

    const nMapHeight = 17
    const nMapWidth = 16

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
    const floorRGB = colourToRGB(scaleColour('#000000', themeRef.current.quarternaryAccent, 0.2));
    const AOColour = colourToRGB("#000000")

    const maxShades = 128
    const distanceForShadingEdges = 1.0

    // pre calculate possible shades of wall colour
    let wallShades = []
    for (let i = 0; i < maxShades; i++) {
      const percentColour = i / (maxShades - 1)
      wallShades.push(colourToRGB(scaleColour('#000000', themeRef.current.quarternaryAccent, percentColour)))
    }

    let floorShades = []
    for (let i = 0; i < maxShades; i++) {
      const percentColour = i / (maxShades - 1)
      floorShades.push(colourToRGB(scaleColour('#000000', themeRef.current.primary, percentColour)))
    }


    // take in a map string, player pos and fill sub canvas
    const drawScreen = (map, fPlayerX, fPlayerY, fPlayerA) => {
      const fFov = (fov.current * Math.PI / 180)

      let distsToWall, prevDistsToWall, dxDistToWall // for 'AO' on edges

      distsToWall = 0
      prevDistsToWall = 0
      dxDistToWall = 0

      for (let x = -1.0; x < drawBufferWidth; x += 1.0) {
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

        const scaledDrawBufferHeight = mobile ? drawBufferHeight / 3.0 : drawBufferHeight / 3.0

        const nCeilingCurrent = scaledDrawBufferHeight - drawBufferHeight / (fDistanceToWall + 0.00000001) // avoid div by 0
        const nCeilingPrev = scaledDrawBufferHeight - drawBufferHeight / (prevDistsToWall + 0.00000001) // avoid div by 0

        const nCeiling = Math.min(nCeilingCurrent, nCeilingPrev)

        const nFloor = drawBufferHeight - nCeiling

        distsToWall = fDistanceToWall
        if (x > 0.0) {
          dxDistToWall = distsToWall - prevDistsToWall
        }

        const nShade = (fDistanceToWall) / (maxRayLength)

        let topOccluded = false
        let nextAmbientOccluded = false

        for (let y = 0; y < drawBufferHeight; y++) {
          if (y < nCeiling) {
            setCoordsColor(x, y, ceilingRGB.r, ceilingRGB.g, ceilingRGB.b)
          } else if (y >= nCeiling && y <= nFloor) {

            // shade external edges
            if (Math.abs(dxDistToWall) > distanceForShadingEdges || topOccluded === false) {
              setCoordsColor(x, y, AOColour.r, AOColour.g, AOColour.b)
              topOccluded = true
            }

            else {
              const colourShade = Math.floor(scaleValue(nShade, 0.0, 1.0, maxShades, 0));
              const col = wallShades[colourShade]
              setCoordsColor(x, y, col.r, col.g, col.b)
            }
            nextAmbientOccluded = true
          } else {
            if (nextAmbientOccluded) {
              setCoordsColor(x, y, AOColour.r, AOColour.g, AOColour.b) // fake AO
              nextAmbientOccluded = false
            } else {
              setCoordsColor(x, y, floorRGB.r, floorRGB.g, floorRGB.b)
            }
          }
        }

        prevDistsToWall = distsToWall

      }
    }

    const moveForward = (inputStrength = 1) => {
      const fMoveSpeed = fBaseMoveSpeed * moveSpeedRef.current / 100 * inputStrength // scale speeds to match scaling factor

      fPlayerX += Math.sin(fPlayerA) * fMoveSpeed;
      fPlayerY += Math.cos(fPlayerA) * fMoveSpeed;

      if (isInWall()) {
        fPlayerX -= Math.sin(fPlayerA) * fMoveSpeed;
        fPlayerY -= Math.cos(fPlayerA) * fMoveSpeed;
      }

    }

    const moveBackward = (inputStrength = 1) => {
      const fMoveSpeed = fBaseMoveSpeed * moveSpeedRef.current / 100 * inputStrength // scale speeds to match scaling factor

      fPlayerX -= Math.sin(fPlayerA) * fMoveSpeed;
      fPlayerY -= Math.cos(fPlayerA) * fMoveSpeed;

      if (isInWall()) {
        fPlayerX += Math.sin(fPlayerA) * fMoveSpeed;
        fPlayerY += Math.cos(fPlayerA) * fMoveSpeed;
      }
    }

    const turnLeft = (inputStrength = 1) => {
      const fTurnSpeed = fBaseTurnSpeed * turnSpeedRef.current / 100 * inputStrength
      fPlayerA -= fTurnSpeed;
    }

    const turnRight = (inputStrength = 1) => {
      const fTurnSpeed = fBaseTurnSpeed * turnSpeedRef.current / 100 * inputStrength
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

      const joystickX = joystickInputRef.current.x
      const joystickY = joystickInputRef.current.y

      if (joystickY < -0.05) {
        moveForward(Math.abs(joystickY))
      } else if (joystickY > 0.05) {
        moveBackward(Math.abs(joystickY))
      }

      if (joystickX < -0.05) {
        turnLeft(Math.abs(joystickX))
      } else if (joystickX > 0.05) {
        turnRight(Math.abs(joystickX))
      }

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

  useEffect(() => {
    const handleMouseMove = (event) => {
      if (!joystickDragRef.current.active || joystickDragRef.current.touchId !== null) return;
      updateJoystickFromPoint(event.clientX, event.clientY);
    };

    const handleMouseUp = () => {
      if (!joystickDragRef.current.active || joystickDragRef.current.touchId !== null) return;
      resetJoystick();
    };

    const handleTouchMove = (event) => {
      if (!joystickDragRef.current.active || joystickDragRef.current.touchId === null) return;

      const activeTouch = Array.from(event.touches).find(
        (touch) => touch.identifier === joystickDragRef.current.touchId
      );

      if (!activeTouch) return;

      if (event.cancelable) {
        event.preventDefault();
      }

      updateJoystickFromPoint(activeTouch.clientX, activeTouch.clientY);
    };

    const handleTouchEnd = (event) => {
      if (!joystickDragRef.current.active || joystickDragRef.current.touchId === null) return;

      const stillActive = Array.from(event.touches).some(
        (touch) => touch.identifier === joystickDragRef.current.touchId
      );

      if (!stillActive) {
        resetJoystick();
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, []);

  // Update colorRef and all particles' colors on theme change
  useEffect(() => {
    // Update all existing particles' colors
    themeRef.current = theme;
  }, [theme]);

  return (
    <>
      {joystickVisible && (
        <VirtualJoypad
          size={joystickSize}
          knobOffsetX={joystickOffset.x}
          knobOffsetY={joystickOffset.y}
          style={{
            zIndex: 3000,
            position: "absolute",
            left: joystickPosition.x,
            top: joystickPosition.y,
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
          }}
        />
      )}
      <canvas
        ref={canvasRef}
        onMouseDown={(event) => {
          activateJoystick(event.clientX, event.clientY)
        }}
        onTouchStart={(event) => {
          const touch = event.changedTouches[0]

          if (!touch) return

          if (event.cancelable) {
            event.preventDefault()
          }

          activateJoystick(touch.clientX, touch.clientY, touch.identifier)
        }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          touchAction: "none",
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
