import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";

export default function Plinko({ visibleUI }) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const particleCountRef = useRef(100);
  const gridSpacingX = useRef(100);
  const gridSpacingY = useRef(100);
  const bouncynessRef = useRef(100);
  const colorRef = useRef(theme.accent);
  const simulationSpeedRef = useRef(100);
  const [, setRender] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    const ctx = canvas.getContext("2d");

    let particles = [];
    const gravity = 0.05;
    const maxSpeed = 1;
    let animationFrameId;

    const gridTypes = { grid: 0, triangle: 1 };

    const hitbox = 5;

    class PlinkoGrid {
      constructor() {
        this.gridType = gridTypes.grid;
        this.gridPositions = [];
      }

      inGrid(x, y, size) {
        return this.gridPositions.find((val) => {
          let dx, dy;
          dx = (x - val[0]) ** 2;
          dy = (y - val[1]) ** 2;
          if (dx + dy < (hitbox + size) ** 2) {
            return val;
          }
        });
      }

      draw() {
        this.gridPositions = [];
        let offsetRow = false;

        switch (this.gridType) {
          case gridTypes.grid: {
            for (
              let y = 50;
              y < canvasRef.current.height;
              y += gridSpacingY.current
            ) {
              offsetRow = !offsetRow;
              for (
                let x = 5;
                x < canvasRef.current.width;
                x += gridSpacingX.current
              ) {
                let xVal = offsetRow ? x + gridSpacingX.current / 2 : x;
                this.gridPositions.push([xVal, y]);
                ctx.beginPath();
                ctx.arc(xVal, y, hitbox, 0, Math.PI * 2);
                ctx.fillStyle = colorRef.current;
                ctx.fill();
                ctx.closePath();
              }
            }

            break;
          }
          case gridTypes.triangle: {
            // draw here
            break;
          }
          default: {
          }
        }
      }
    }

    class Particle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = Math.random() * 2 - 4;
        this.vy = Math.random() * 10 + 5;
        this.size = Math.random() * 10 + 5;
        this.color = `#${Math.floor((Math.random() * 0.5 + 0.5) * 16777215)
          .toString(16)
          .padStart(6, "0")}`;
      }

      reset() {
        if (gravity > 0.0) {
          this.y = 0;
          this.vy *= -0.5;
          this.x = Math.random() * canvas.width;
          this.vx = Math.random() * 4 - 2;
        } else {
          this.y = canvas.height;
          this.x = Math.random() * canvas.width;
          this.vx = Math.random() * 4 - 2;
        }
      }

      update() {
        this.vy += gravity;
        const inGridVal = grid.inGrid(this.x, this.y, this.size);
        if (inGridVal) {
          const dx = this.x - inGridVal[0];
          const dy = this.y - inGridVal[1];
          const angle2 = Math.atan2(dy, dx);

          this.vx =
            (Math.cos(angle2) * bouncynessRef.current) / 100 + this.vx / 2;
          this.vy = (Math.sin(angle2) * bouncynessRef.current) / 100;
        }

        this.x += (this.vx * simulationSpeedRef.current) / 100;
        this.y += (this.vy * simulationSpeedRef.current) / 100;

        if (this.y > canvas.height) {
          this.reset();
        }

        if (this.x >= canvas.width + this.size * 3) {
          this.reset();
        }

        if (this.x < 0 - this.size * 3) {
          this.reset();
        }
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.closePath();
      }
    }

    const grid = new PlinkoGrid();

    function initParticles() {
      for (let i = 0; i < particleCountRef.current; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        particles.push(new Particle(x, y));
      }
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      grid.draw();

      // Adjust particle count
      const currentParticleCount = particles.length;
      if (currentParticleCount < particleCountRef.current) {
        for (let i = currentParticleCount; i < particleCountRef.current; i++) {
          const x = Math.random() * canvas.width;
          const y = Math.random() * canvas.height;
          particles.push(new Particle(x, y));
        }
      } else if (currentParticleCount > particleCountRef.current) {
        particles.splice(particleCountRef.current);
      }

      particles.forEach((particle) => {
        particle.update();
        particle.draw();
      });
      animationFrameId = requestAnimationFrame(animate);
    }

    initParticles();
    animate();

    // Attach particles array to canvas for theme effect access
    canvas._particles = particles;

    return () => {
      // Cleanup function to cancel the animation frame
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resizeCanvas);
      particles = [];
    };
  }, []);

  // Update colorRef and all particles' colors on theme change
  useEffect(() => {
    colorRef.current = theme.accent;
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

      {visibleUI && (
        <div style={{ zIndex: 3000 }}>
          <ChangerGroup
            valueArrays={[
              {
                title: "Particle Count:",
                valueRef: particleCountRef,
                minValue: "10",
                maxValue: "3000",
                type: "slider",
              },
              {
                title: "Simulation Speed:",
                valueRef: simulationSpeedRef,
                minValue: "1",
                maxValue: "200.0",
                type: "slider",
              },
              {
                title: "Ball Bounce Factor:",
                valueRef: bouncynessRef,
                minValue: "100",
                maxValue: "300",
                type: "slider",
              },
              {
                title: "Grid Spacing X:",
                valueRef: gridSpacingX,
                minValue: "20",
                maxValue: "200",
                type: "slider",
              },
              {
                title: "Grid Spacing Y:",
                valueRef: gridSpacingY,
                minValue: "20",
                maxValue: "200",
                type: "slider",
              },
            ]}
            rerenderSetter={setRender}
          />
        </div>
      )}
    </>
  );
}
