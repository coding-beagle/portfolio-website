import React, { useEffect, useRef, useState } from "react";
import defaultColours from "../../../../themes/themes";

export default function Hexapod() {
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const simulationSpeedRef = useRef(100);
  const bodyRefs = useRef([]);
  const mouseShieldRadiusRef = useRef(100);
  const [, setRender] = useState(0); // Dummy state to force re-render

  useEffect(() => {
    const canvas = canvasRef.current;
    let animationFrameId;
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
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

    const originX = 0;
    const originY = 0;

    const sin30 = Math.sin((Math.PI / 180) * 30);
    const cos30 = Math.cos((Math.PI / 180) * 30);

    const hexapodStarting = { x: 700, y: 300, z: 0 };
    const bodyWidth = 100;
    const bodyLength = 200;

    const convert2DtoIsometric = (position) => {
      return [
        originX + (position.x - position.y) * cos30,
        originY + (position.x + position.y) * sin30 - position.z,
      ];
    };

    const rotatePointZ = (point, angle) => {
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      return {
        x: point.x * cosA - point.y * sinA,
        y: point.x * sinA + point.y * cosA,
        z: point.z,
      };
    };

    class Body {
      constructor(x, y, z, width = 50, length = 80, height = 30) {
        this.position = { x: x, y: y, z: z }; // Body's center in world 3D space
        this.angle = 0; // Current rotation angle around Z axis

        const w2 = width / 2;
        const l2 = length / 2;
        const h2 = height / 2;
        this.localVertices = [
          { x: -w2, y: -l2, z: -h2 }, // 0: bottom-left-back
          { x: -2 * w2, y: -6, z: -h2 }, // left middle?
          { x: w2, y: -l2, z: -h2 }, // 1: bottom-right-back
          { x: 2 * w2, y: 6, z: -h2 }, // right middle?
          { x: w2, y: l2, z: -h2 }, // 2: bottom-right-front
          { x: -w2, y: l2, z: -h2 }, // 3: bottom-left-front
        ];

        this.edges = [
          [0, 1],
          [1, 5],
          [5, 4],
          [4, 3],
          [3, 2],
          [2, 0],
        ];
        this.projectedCenter = convert2DtoIsometric(this.position);
      }

      update(targetMouseX, targetMouseY) {
        // Calculate angle from projected center to mouse
        this.projectedCenter = convert2DtoIsometric(this.position); // Recalculate in case position changes
        const dx = targetMouseX - this.projectedCenter[0];
        const dy = targetMouseY - this.projectedCenter[1];

        // const magnitudeDiff = Math.sqrt(dx ** 2 + dy ** 2);

        this.position.x += dx * 0.01;
        this.position.y += dy * 0.01;

        this.angle = Math.atan2(dy, dx) + Math.PI / 3;
      }

      draw() {
        const finalProjectedVertices = [];

        this.localVertices.forEach((vertex) => {
          const rotatedVertex = rotatePointZ(vertex, this.angle);
          const worldVertex = {
            x: rotatedVertex.x + this.position.x,
            y: rotatedVertex.y + this.position.y,
            z: rotatedVertex.z + this.position.z,
          };
          finalProjectedVertices.push(convert2DtoIsometric(worldVertex));
        });

        ctx.beginPath();
        ctx.strokeStyle = defaultColours.accent;
        this.edges.forEach((edgeIndices) => {
          const startPoint = finalProjectedVertices[edgeIndices[0]];
          const endPoint = finalProjectedVertices[edgeIndices[1]];
          ctx.moveTo(startPoint[0], startPoint[1]);
          ctx.lineTo(endPoint[0], endPoint[1]);
        });
        ctx.stroke();
        ctx.closePath(); // Close path after defining all lines
      }
    }
    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      bodyRefs.current.forEach((body) => {
        body.update(mousePosRef.current.x, mousePosRef.current.y);
        body.draw();
      });

      animationFrameId = requestAnimationFrame(animate);
    }

    const init = () => {
      if (bodyRefs.current.length === 0) {
        bodyRefs.current.push(new Body(100, 100, 0));
      }
    };

    init();
    animate();

    canvas.addEventListener("pointermove", handleMouseMove);
    canvas.addEventListener("touchmove", handleMouseMove);
    canvas.addEventListener("pointerdown", handleMouseDown);
    canvas.addEventListener("pointerup", handleMouseUp);

    return () => {
      // Cleanup function to cancel the animation frame and remove event listeners
      cancelAnimationFrame(animationFrameId);
      canvas.removeEventListener("pointermove", handleMouseMove);
      canvas.removeEventListener("touchmove", handleMouseMove);
      canvas.removeEventListener("pointerdown", handleMouseDown);
      canvas.removeEventListener("pointerup", handleMouseUp);
      window.removeEventListener("resize", resizeCanvas);
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
            Simulation Speed:
            <input
              type="range"
              min="1.0"
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
            Click Umbrella Radius:
            <input
              type="range"
              min="10.0"
              max="300.0"
              value={mouseShieldRadiusRef.current}
              onChange={(e) => {
                mouseShieldRadiusRef.current = Number(e.target.value);
                setRender((prev) => prev + 1); // Force re-render to update slider UI
              }}
              style={{ marginLeft: "0.5em" }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
