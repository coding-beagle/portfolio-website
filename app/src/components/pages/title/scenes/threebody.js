import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";

export default function ThreeBody() {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const particleCountRef = useRef(3);
  const simulationSpeedRef = useRef(100);
  const colorRef = useRef(theme.accent);
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
    let animationFrameId;

    const GravitationalConstant = 500;
    const TimeStep = 0.001;

    class Body {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = Math.random() * 2 - 1; // random initial velocities
        this.vy = Math.random() * 2 - 1; // random initial velocities
        this.size = Math.random() * 10 + 5; // random size
        this.mass = this.size * this.size * 3.14 * 1; // mass proportional to size
        this.color = colorRef.current;
        this.acceleration = 0;
        this.acceleration_angle = 0;
      }

      update() {
        let fx = 0; // Force components
        let fy = 0;

        particles.forEach((particle) => {
          if (particle === this) return;

          const dx = particle.x - this.x;
          const dy = particle.y - this.y;
          const r = Math.sqrt(dx ** 2 + dy ** 2);

          // Add minimum distance to prevent extreme forces
          const minDistance = this.size + particle.size;
          const effectiveDistance = Math.max(r, minDistance);

          if (r > 0) {
            // Avoid division by zero
            const force =
              (GravitationalConstant * this.mass * particle.mass) /
              effectiveDistance ** 2;
            fx += (force * dx) / r; // Force components
            fy += (force * dy) / r;
          }
        });

        // Calculate acceleration from force
        const ax = fx / this.mass;
        const ay = fy / this.mass;

        // Update velocity by adding acceleration
        this.vx += ax * TimeStep;
        this.vy += ay * TimeStep;

        // vx + vy calculation here based on acceleration and acceleration_angle
        this.x += (this.vx * simulationSpeedRef.current) / 100;
        this.y += (this.vy * simulationSpeedRef.current) / 100;
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.closePath();
      }
    }

    function initParticles() {
      for (let i = 0; i < particleCountRef.current; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        particles.push(new Body(x, y));
      }
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Adjust particle count
      const currentParticleCount = particles.length;
      if (currentParticleCount < particleCountRef.current) {
        for (let i = currentParticleCount; i < particleCountRef.current; i++) {
          const x = Math.random() * canvas.width;
          const y = Math.random() * canvas.height;
          particles.push(new Body(x, y));
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
    // Update all existing particles' colors
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas._particles) {
      canvas._particles.forEach((particle) => {
        particle.color = theme.accent;
      });
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

      <div style={{ zIndex: 3000 }}>
        <ChangerGroup
          valueArrays={[
            // {
            //   title: "Particle Count:",
            //   valueRef: particleCountRef,
            //   minValue: "100",
            //   maxValue: "10000",
            //   type: "slider",
            // },
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
    </>
  );
}
