import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";

export default function Plants() {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const [restart, setRestart] = useState(false);
  const particleCountRef = useRef(25);
  const simulationSpeedRef = useRef(500);
  const simulationLengthRef = useRef(100);
  const [, setRender] = React.useState(0);

  const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

  const getCloseColour = (colourHex) => {
    const colour = {
      r: parseInt(colourHex.slice(1, 3), 16),
      g: parseInt(colourHex.slice(3, 5), 16),
      b: parseInt(colourHex.slice(5, 7), 16),
    };

    const r = Math.floor(clamp(colour.r + Math.random() * 20 - 10, 0, 255));
    const g = Math.floor(clamp(colour.g + Math.random() * 10 - 5, 0, 255));
    const b = Math.floor(clamp(colour.b + Math.random() * 10 - 5, 0, 255));

    const rHex = r.toString(16).padStart(2, "0");
    const gHex = g.toString(16).padStart(2, "0");
    const bHex = b.toString(16).padStart(2, "0");

    return `#${rHex}${gHex}${bHex}`;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    const ctx = canvas.getContext("2d");
    let plants = [];
    let animationFrameId;

    const handleMouseMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      mousePosRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };

    class Plant {
      constructor(x, y, size) {
        this.x = x;
        this.y = y;
        this.growthPoints = [{ x: x, y: y }];
        this.colours = [theme.secondaryAccent];
        this.sizes = [size];
      }

      update() {
        if (Math.random() * 1000 > simulationSpeedRef.current) return; // Throttle the update

        const lastPoint = this.growthPoints[this.growthPoints.length - 1];
        this.growthPoints.push({
          x:
            lastPoint.x +
            this.sizes[this.sizes.length - 1] * (Math.random() - 0.5) * 2,
          y:
            lastPoint.y -
            this.sizes[this.sizes.length - 1] * Math.random() * 2 +
            1,
        });

        this.sizes.push(
          this.sizes[this.sizes.length - 1] * (0.95 + Math.random() * 0.05)
        );

        this.colours.push(
          getCloseColour(this.colours[this.colours.length - 1])
        );

        if (this.growthPoints.length > simulationLengthRef.current) {
          setRestart(!restart);
        }
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.sizes[0], 0, Math.PI * 2);
        ctx.fillStyle = this.colours[0];
        ctx.fill();
        ctx.closePath();

        this.growthPoints.forEach((point, index) => {
          ctx.beginPath();
          ctx.arc(point.x, point.y, this.sizes[index], 0, Math.PI * 2);
          ctx.fillStyle = this.colours[index];
          ctx.fill();
          ctx.closePath();
        });
      }
    }

    function initBlocks() {
      plants = []; // Clear existing plants
      for (let i = 0; i < particleCountRef.current; i++) {
        const size = Math.random() * 20 + (10 * canvas.width) / 1920;
        const x = Math.random() * (canvas.width - size);
        const y = Math.random() + (canvas.height - size);
        plants.push(new Plant(x, y, size));
      }
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Adjust particle count
      const currentParticleCount = plants.length;
      if (currentParticleCount < particleCountRef.current) {
        for (let i = currentParticleCount; i < particleCountRef.current; i++) {
          const size = Math.random() * 20 + (10 * canvas.width) / 1920;
          const x = Math.random() * (canvas.width - size);
          const y = Math.random() + (canvas.height - size);
          plants.push(new Plant(x, y, size));
        }
      } else if (currentParticleCount > particleCountRef.current) {
        plants.splice(particleCountRef.current);
      }
      plants.forEach((plant) => {
        plant.update();
        plant.draw();
      });
      animationFrameId = requestAnimationFrame(animate);
    }

    initBlocks();
    animate();

    canvas.addEventListener("mousemove", handleMouseMove);

    return () => {
      cancelAnimationFrame(animationFrameId);
      canvas.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [restart]);

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
          valueArrays={[
            {
              title: "Plant Count:",
              valueRef: particleCountRef,
              minValue: "1",
              maxValue: "50",
              type: "slider",
            },
            {
              title: "Simulation Speed:",
              valueRef: simulationSpeedRef,
              minValue: "1",
              maxValue: "1000.0",
              type: "slider",
            },
            {
              title: "Simulation Length:",
              valueRef: simulationLengthRef,
              minValue: "1",
              maxValue: "200.0",
              type: "slider",
            },
          ]}
          rerenderSetter={setRender}
        />
      </div>
    </>
  );
}
