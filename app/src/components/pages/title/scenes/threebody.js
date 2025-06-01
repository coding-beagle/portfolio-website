import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";

export default function ThreeBody() {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const particleCountRef = useRef(10);
  const gravConstantRef = useRef(500);
  const futurePredictionRef = useRef(100);
  const simulationSpeedRef = useRef(100);
  const colorRef = useRef(theme.accent);
  const [, setRender] = useState(0);
  const [rerenderSim, setRerenderSim] = useState(false);

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
        this.nextPositions = [{ x: this.x, y: this.y }];
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
            const force =
              (gravConstantRef.current * this.mass * particle.mass) /
              effectiveDistance ** 2;
            fx += (force * dx) / r;
            fy += (force * dy) / r;
          }
        });

        // Calculate acceleration from force
        const ax = fx / this.mass;
        const ay = fy / this.mass;

        // Update velocity by adding acceleration
        this.vx += ax * TimeStep;
        this.vy += ay * TimeStep;

        // Update actual position
        const nextX = (this.vx * simulationSpeedRef.current) / 100;
        const nextY = (this.vy * simulationSpeedRef.current) / 100;
        this.x += nextX;
        this.y += nextY;

        // Calculate future positions (prediction)
        this.calculateFuturePositions();
      }

      calculateFuturePositions() {
        this.nextPositions = [{ x: this.x, y: this.y }]; // Start with current position

        // Create temporary copies for simulation
        let tempX = this.x;
        let tempY = this.y;
        let tempVx = this.vx;
        let tempVy = this.vy;

        const predictionSteps = futurePredictionRef.current; // How many steps ahead to predict
        const predictionTimeStep = TimeStep * 2; // Larger time steps for prediction

        for (let step = 0; step < predictionSteps; step++) {
          let fx = 0;
          let fy = 0;

          // Calculate forces from all other particles at their CURRENT positions
          particles.forEach((particle) => {
            if (particle === this) return;

            const dx = particle.x - tempX;
            const dy = particle.y - tempY;
            const r = Math.sqrt(dx ** 2 + dy ** 2);

            const minDistance = this.size + particle.size;
            const effectiveDistance = Math.max(r, minDistance);

            if (r > 0) {
              const force =
                (gravConstantRef.current * this.mass * particle.mass) /
                effectiveDistance ** 2;
              fx += (force * dx) / r;
              fy += (force * dy) / r;
            }
          });

          // Update temporary velocity and position
          const ax = fx / this.mass;
          const ay = fy / this.mass;

          tempVx += ax * predictionTimeStep;
          tempVy += ay * predictionTimeStep;

          tempX += (tempVx * simulationSpeedRef.current) / 100;
          tempY += (tempVy * simulationSpeedRef.current) / 100;

          // Store every few steps to avoid too many points
          if (step % 5 === 0) {
            this.nextPositions.push({ x: tempX, y: tempY });
          }
        }
      }

      draw() {
        // Draw the prediction trail
        if (this.nextPositions.length > 1) {
          ctx.strokeStyle = theme.secondary;
          ctx.globalAlpha = 0.3; // Make trail semi-transparent
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(this.nextPositions[0].x, this.nextPositions[0].y);
          for (let i = 1; i < this.nextPositions.length; i++) {
            ctx.lineTo(this.nextPositions[i].x, this.nextPositions[i].y);
          }
          ctx.stroke();
          ctx.globalAlpha = 1.0; // Reset alpha
        }

        // Draw the current particle
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
  }, [rerenderSim]);

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
            {
              title: "Particle Count:",
              valueRef: particleCountRef,
              minValue: "1",
              maxValue: "30.0",
              type: "slider",
            },
            {
              title: "Simulation Speed:",
              valueRef: simulationSpeedRef,
              minValue: "0",
              maxValue: "200.0",
              type: "slider",
            },
            {
              title: "",
              type: "button",
              buttonText: "Rerender Simulation",
              callback: () => {
                setRerenderSim((prev) => !prev);
              },
            },
            {
              title: "Future Predictions:",
              valueRef: futurePredictionRef,
              minValue: "0.0",
              maxValue: "500.0",
              type: "slider",
            },
          ]}
          rerenderSetter={setRender}
        />
      </div>
    </>
  );
}
