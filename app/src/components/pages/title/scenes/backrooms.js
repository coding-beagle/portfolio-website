import React, { useEffect, useRef, useState, useContext } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";
import { colourToRGB, scaleColour, scaleValue } from "../utilities/usefulFunctions";
import { VirtualJoypad } from "../utilities/virtualJoypad";
import { MobileContext } from "../../../../contexts/MobileContext";
import { IconGroup } from "../utilities/popovers";

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

    const CHUNK_SIZE = 16
    const worldChunkMap = new Map()
    const maxVisibleTiles = Math.ceil(maxRayLength)
    const chunkLoadRadius = Math.ceil((maxVisibleTiles + 8) / CHUNK_SIZE) + 1

    const getChunkKey = (chunkX, chunkY) => `${chunkX},${chunkY}`

    const worldToChunk = (tileX, tileY) => {
      const chunkX = Math.floor(tileX / CHUNK_SIZE)
      const chunkY = Math.floor(tileY / CHUNK_SIZE)
      const localX = ((tileX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE
      const localY = ((tileY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE

      return { chunkX, chunkY, localX, localY }
    }

    const generateChunk = () => {
      const tiles = new Array(CHUNK_SIZE * CHUNK_SIZE)

      for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const border = x === 0 || y === 0 || x === CHUNK_SIZE - 1 || y === CHUNK_SIZE - 1
          const borderChance = border ? 0.45 : 0.2
          tiles[y * CHUNK_SIZE + x] = Math.random() < borderChance ? "#" : "."
        }
      }

      // add a couple random doorways to avoid fully-sealed borders
      const doorwayCount = 1 + Math.floor(Math.random() * 3)
      for (let i = 0; i < doorwayCount; i++) {
        const side = Math.floor(Math.random() * 4)
        const offset = 1 + Math.floor(Math.random() * (CHUNK_SIZE - 2))
        if (side === 0) tiles[offset] = "." // top
        if (side === 1) tiles[(CHUNK_SIZE - 1) * CHUNK_SIZE + offset] = "." // bottom
        if (side === 2) tiles[offset * CHUNK_SIZE] = "." // left
        if (side === 3) tiles[offset * CHUNK_SIZE + (CHUNK_SIZE - 1)] = "." // right
      }

      return tiles
    }

    const ensureChunk = (chunkX, chunkY) => {
      const key = getChunkKey(chunkX, chunkY)
      if (!worldChunkMap.has(key)) {
        worldChunkMap.set(key, generateChunk())
      }
      return worldChunkMap.get(key)
    }

    const carveOpenAreaAt = (worldX, worldY, radius = 1) => {
      const centerTileX = Math.floor(worldX)
      const centerTileY = Math.floor(worldY)

      for (let y = centerTileY - radius; y <= centerTileY + radius; y++) {
        for (let x = centerTileX - radius; x <= centerTileX + radius; x++) {
          const { chunkX, chunkY, localX, localY } = worldToChunk(x, y)
          const chunk = ensureChunk(chunkX, chunkY)
          chunk[localY * CHUNK_SIZE + localX] = "."
        }
      }
    }

    const maintainLoadedChunks = (worldX, worldY) => {
      const centerChunkX = Math.floor(worldX / CHUNK_SIZE)
      const centerChunkY = Math.floor(worldY / CHUNK_SIZE)

      for (let chunkY = centerChunkY - chunkLoadRadius; chunkY <= centerChunkY + chunkLoadRadius; chunkY++) {
        for (let chunkX = centerChunkX - chunkLoadRadius; chunkX <= centerChunkX + chunkLoadRadius; chunkX++) {
          ensureChunk(chunkX, chunkY)
        }
      }

      // keep a little extra margin and drop far chunks so memory stays bounded while world appears infinite
      const unloadRadius = chunkLoadRadius + 1
      for (const key of worldChunkMap.keys()) {
        const [chunkXText, chunkYText] = key.split(",")
        const chunkX = Number(chunkXText)
        const chunkY = Number(chunkYText)
        if (
          Math.abs(chunkX - centerChunkX) > unloadRadius ||
          Math.abs(chunkY - centerChunkY) > unloadRadius
        ) {
          worldChunkMap.delete(key)
        }
      }

    }

    const getTile = (tileX, tileY) => {
      const { chunkX, chunkY, localX, localY } = worldToChunk(tileX, tileY)
      const chunk = ensureChunk(chunkX, chunkY)
      return chunk[localY * CHUNK_SIZE + localX]
    }

    const isWall = (x, y) => {
      const tileX = Math.floor(x)
      const tileY = Math.floor(y)
      return getTile(tileX, tileY) === "#"
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

    const ceilingRGB = colourToRGB(scaleColour('#000000', themeRef.current.quarternaryAccent, 0.2));
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
    const drawScreen = (fPlayerX, fPlayerY, fPlayerA) => {
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

          // ray has reached a wall
          if (getTile(nTestX, nTestY) === "#") {
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

    const drawMiniMap = (playerX, playerY, playerA) => {
      const tileRadius = mobile ? 5 : 6
      const tileSize = mobile ? 15 : 15
      const miniMapPadding = mobile ? 50 : 20
      const borderSize = 2

      const tilesPerSide = tileRadius * 2 + 1
      const mapWidth = tilesPerSide * tileSize
      const mapHeight = tilesPerSide * tileSize
      const panelX = (canvas.width - mapWidth) * 0.5
      const panelY = miniMapPadding
      const centerX = panelX + mapWidth * 0.5
      const centerY = panelY + mapHeight * 0.5

      const wallColor = `rgb(${Math.round(scaleValue(ceilingRGB.r, 0, 255, 110, 240))}, ${Math.round(scaleValue(ceilingRGB.g, 0, 255, 110, 240))}, ${Math.round(scaleValue(ceilingRGB.b, 0, 255, 110, 240))})`
      const floorColor = `rgb(${Math.round(scaleValue(floorRGB.r, 0, 255, 15, 90))}, ${Math.round(scaleValue(floorRGB.g, 0, 255, 15, 90))}, ${Math.round(scaleValue(floorRGB.b, 0, 255, 15, 90))})`
      const playerColor = `rgb(${Math.round(255 - ceilingRGB.r * 0.4)}, ${Math.round(240 - ceilingRGB.g * 0.35)}, ${Math.round(80 + ceilingRGB.b * 0.15)})`

      ctx.save()
      ctx.globalAlpha = 0.92
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)"
      ctx.fillRect(panelX - borderSize, panelY - borderSize, mapWidth + borderSize * 2, mapHeight + borderSize * 2)
      ctx.beginPath()
      ctx.rect(panelX, panelY, mapWidth, mapHeight)
      ctx.clip()

      const startTileX = Math.floor(playerX) - tileRadius - 1
      const endTileX = Math.floor(playerX) + tileRadius + 1
      const startTileY = Math.floor(playerY) - tileRadius - 1
      const endTileY = Math.floor(playerY) + tileRadius + 1

      for (let worldTileY = startTileY; worldTileY <= endTileY; worldTileY++) {
        for (let worldTileX = startTileX; worldTileX <= endTileX; worldTileX++) {
          const tile = getTile(worldTileX, worldTileY)

          const drawX = centerX + (worldTileX - playerX) * tileSize
          const drawY = centerY + (worldTileY - playerY) * tileSize

          ctx.fillStyle = tile === "#" ? wallColor : floorColor
          ctx.fillRect(drawX, drawY, tileSize, tileSize)
        }
      }

      const playerMapX = centerX
      const playerMapY = centerY
      const playerRadius = Math.max(2, Math.floor(tileSize * 0.22))
      const coneLength = tileSize * 2.2
      const fovRadians = (fov.current * Math.PI / 180)
      const halfFov = fovRadians * 0.5

      ctx.fillStyle = playerColor
      ctx.beginPath()
      ctx.arc(playerMapX, playerMapY, playerRadius, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = `rgba(${Math.round(255 - ceilingRGB.r * 0.4)}, ${Math.round(240 - ceilingRGB.g * 0.35)}, ${Math.round(80 + ceilingRGB.b * 0.15)}, 0.22)`
      ctx.beginPath()
      ctx.moveTo(playerMapX, playerMapY)
      ctx.arc(playerMapX, playerMapY, coneLength, - playerA - halfFov + (Math.PI / 2), - playerA + halfFov + (Math.PI / 2))
      ctx.closePath()
      ctx.fill()

      ctx.strokeStyle = playerColor
      ctx.lineWidth = Math.max(1, Math.floor(tileSize * 0.16))
      ctx.beginPath()
      ctx.moveTo(playerMapX, playerMapY)
      ctx.lineTo(
        playerMapX + Math.sin(playerA - halfFov) * coneLength,
        playerMapY + Math.cos(playerA - halfFov) * coneLength
      )
      ctx.moveTo(playerMapX, playerMapY)
      ctx.lineTo(
        playerMapX + Math.sin(playerA + halfFov) * coneLength,
        playerMapY + Math.cos(playerA + halfFov) * coneLength
      )
      ctx.stroke()
      ctx.restore()
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

    maintainLoadedChunks(fPlayerX, fPlayerY)
    // one-time spawn safety so the player doesn't initialize inside a wall
    carveOpenAreaAt(fPlayerX, fPlayerY, 1)

    let animationFrameId;
    // redraw loop
    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      maintainLoadedChunks(fPlayerX, fPlayerY)
      drawScreen(fPlayerX, fPlayerY, fPlayerA);

      offCtx.putImageData(screenBuffer, 0, 0);
      ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
      drawMiniMap(fPlayerX, fPlayerY, fPlayerA)

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
  }, [mobile]);

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
            <IconGroup icons={[{ type: "MOUSE", text: "Click and drag the virtual joypad\n to move around" },
            { type: "KEY", text: "Use I,J,K,L to move as well!" }
            ]} />
          </div>
        )
      }
    </>
  );
}
