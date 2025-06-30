import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";

export default function GravitalOrbs({ visibleUI }) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const particleCountRef = useRef(10);
  const gravConstantRef = useRef(3);
  const futurePredictionRef = useRef(0);
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

    let TimeStep = 0.001;
    let lastTime = Date.now();

    const gravConstantDivider = 5;

    // Shared future prediction cache to avoid recalculating for each particle
    let sharedFuturePredictions = null;
    let lastPredictionFrame = -1;

    class Body {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = Math.random() * 2 - 1; // random initial velocities
        this.vy = Math.random() * 2 - 1; // random initial velocities
        this.size = Math.random() * 10 + 5; // random size
        this.mass = this.size ** 2 * 3.14 * 60; // mass proportional to size
        this.color = colorRef.current;
        this.acceleration = 0;
        this.acceleration_angle = 0;
        this.nextPositions = [{ x: this.x, y: this.y }];
        this.active = true;
      }
      update() {
        let fx = 0; // Force components
        let fy = 0;

        particles.forEach((particle) => {
          if (particle === this) return;
          if (!particle.active) return;

          const dx = particle.x - this.x;
          const dy = particle.y - this.y;
          const r = Math.sqrt(dx ** 2 + dy ** 2);
          const minDistance = this.size + particle.size;

          // Check for collision (only process if this particle has lower index to avoid double processing)
          if (
            r < minDistance &&
            r > 0 &&
            particles.indexOf(this) < particles.indexOf(particle)
          ) {
            this.handleCollision(particle, dx, dy, r, minDistance);
          }

          // Add minimum distance to prevent extreme forces
          const effectiveDistance = Math.max(r, minDistance);

          if (r > 0) {
            const force =
              ((gravConstantRef.current / gravConstantDivider) *
                this.mass *
                particle.mass) /
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
        // this.calculateFuturePositions();
      }
      handleCollision(particle) {
        if (!particle.active) return;
        this.size =
          particle.size < this.size
            ? this.size + particle.size / 2
            : particle.size + this.size / 2;
        this.mass = this.size ** 2 * 3.14 * 60; // mass proportional to size

        particle.active = false;
        // const index = particles.indexOf(particle);
        // if (index !== -1) {
        //   particles.splice(index, 1);
        // }
      }
      /**
       * The function calculates future positions of particles based on shared future prediction cache
       * to avoid recalculating for each particle.
       * @returns The `calculateFuturePositions()` function returns the next predicted positions for a
       * particle based on future prediction settings and shared cache of future predictions. If future
       * prediction is not enabled, it sets the next positions to the current position of the particle.
       * If future prediction is enabled, it retrieves the predicted positions for the particle from
       * the shared cache or sets it to the current position if no prediction is available.
       */
      // calculateFuturePositions() {
      //   // Only calculate predictions if future prediction is enabled
      //   if (futurePredictionRef.current <= 0) {
      //     this.nextPositions = [{ x: this.x, y: this.y }];
      //     return;
      //   }

      //   // Use shared future prediction cache to avoid recalculating for each particle
      //   const currentFrame = Date.now();

      //   if (!sharedFuturePredictions || currentFrame !== lastPredictionFrame) {
      //     sharedFuturePredictions = this.simulateAllParticlesFuture();
      //     lastPredictionFrame = currentFrame;
      //   }

      //   // Extract this particle's predicted positions from shared cache
      //   const thisParticleIndex = particles.indexOf(this);
      //   this.nextPositions = sharedFuturePredictions[thisParticleIndex] || [
      //     { x: this.x, y: this.y },
      //   ];
      // }
      // simulateAllParticlesFuture() {
      //   // Optimize prediction steps based on particle count to maintain performance
      //   const baseSteps = futurePredictionRef.current;
      //   const particleCount = particles.length;
      //   const maxStepsForPerformance = Math.max(50, 500 / particleCount);
      //   const predictionSteps = Math.min(baseSteps, maxStepsForPerformance);

      //   const predictionTimeStep = TimeStep * 2;

      //   // Create temporary copies of all particles
      //   const tempParticles = particles.map((particle) => ({
      //     x: particle.x,
      //     y: particle.y,
      //     vx: particle.vx,
      //     vy: particle.vy,
      //     mass: particle.mass,
      //     size: particle.size,
      //     predictions: [{ x: particle.x, y: particle.y }],
      //   }));

      //   // Simulate all particles together step by step
      //   for (let step = 0; step < predictionSteps; step++) {
      //     // Calculate forces for all particles
      //     const forces = tempParticles.map(() => ({ fx: 0, fy: 0 }));

      //     for (let i = 0; i < tempParticles.length; i++) {
      //       for (let j = i + 1; j < tempParticles.length; j++) {
      //         const p1 = tempParticles[i];
      //         const p2 = tempParticles[j];

      //         const dx = p2.x - p1.x;
      //         const dy = p2.y - p1.y;
      //         const r = Math.sqrt(dx ** 2 + dy ** 2);
      //         const minDistance = p1.size + p2.size;

      //         // Handle collisions
      //         if (r <= minDistance && r > 0) {
      //           // Separate particles
      //           const overlap = minDistance - r;
      //           const separationX = (dx / r) * overlap * 0.5;
      //           const separationY = (dy / r) * overlap * 0.5;

      //           p1.x -= separationX;
      //           p1.y -= separationY;
      //           p2.x += separationX;
      //           p2.y += separationY;

      //           // Calculate collision response
      //           const relativeVx = p1.vx - p2.vx;
      //           const relativeVy = p1.vy - p2.vy;
      //           const normalVelocity =
      //             relativeVx * (dx / r) + relativeVy * (dy / r);

      //           if (normalVelocity < 0) {
      //             const restitution = 0.8;
      //             const impulse = -(1 + restitution) * normalVelocity;
      //             const totalMass = p1.mass + p2.mass;
      //             const impulseScalar = impulse / totalMass;

      //             const impulseX = impulseScalar * (dx / r);
      //             const impulseY = impulseScalar * (dy / r);

      //             p1.vx += impulseX * p2.mass;
      //             p1.vy += impulseY * p2.mass;
      //             p2.vx -= impulseX * p1.mass;
      //             p2.vy -= impulseY * p1.mass;

      //             // Apply dampening
      //             p1.vx *= 0.98;
      //             p1.vy *= 0.98;
      //             p2.vx *= 0.98;
      //             p2.vy *= 0.98;
      //           }
      //         }

      //         // Calculate gravitational forces
      //         const effectiveDistance = Math.max(r, minDistance);
      //         if (r > 0) {
      //           const force =
      //             ((gravConstantRef.current / gravConstantDivider) *
      //               p1.mass *
      //               p2.mass) /
      //             effectiveDistance ** 2;
      //           const forceX = (force * dx) / r;
      //           const forceY = (force * dy) / r;

      //           forces[i].fx += forceX;
      //           forces[i].fy += forceY;
      //           forces[j].fx -= forceX;
      //           forces[j].fy -= forceY;
      //         }
      //       }
      //     }

      //     // Update all particles
      //     for (let i = 0; i < tempParticles.length; i++) {
      //       const particle = tempParticles[i];
      //       const force = forces[i];

      //       // Update velocity with gravity
      //       const ax = force.fx / particle.mass;
      //       const ay = force.fy / particle.mass;

      //       particle.vx += ax * predictionTimeStep;
      //       particle.vy += ay * predictionTimeStep;

      //       // Update position
      //       particle.x += (particle.vx * simulationSpeedRef.current) / 100;
      //       particle.y += (particle.vy * simulationSpeedRef.current) / 100;

      //       // Store position every few steps
      //       if (step % 5 === 0) {
      //         particle.predictions.push({ x: particle.x, y: particle.y });
      //       }
      //     }
      //   }

      //   // Return all predictions
      //   return tempParticles.map((p) => p.predictions);
      // }
      draw() {
        // Draw the prediction trail only if future prediction is enabled and we have positions
        if (futurePredictionRef.current > 0 && this.nextPositions.length > 1) {
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
        if (this.active) {
          ctx.beginPath();
          ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
          ctx.fillStyle = this.color;
          ctx.fill();
          ctx.closePath();
        }
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

      const currentTime = Date.now();
      TimeStep = (currentTime - lastTime) / 1000; // Convert to seconds
      lastTime = currentTime; // Adjust particle count
      const currentParticleCount = particles.length;
      if (currentParticleCount < particleCountRef.current) {
        for (let i = currentParticleCount; i < particleCountRef.current; i++) {
          const x = Math.random() * canvas.width;
          const y = Math.random() * canvas.height;
          particles.push(new Body(x, y));
        }
        // Reset prediction cache when particles are added
        sharedFuturePredictions = null;
      } else if (currentParticleCount > particleCountRef.current) {
        particles.splice(particleCountRef.current);
        // Reset prediction cache when particles are removed
        sharedFuturePredictions = null;
      }
      particles.forEach((particle) => {
        particle.update();
        particle.draw();
      });
      animationFrameId = requestAnimationFrame(animate);

      const allParticlesOffScreen = particles.every(
        (particle) =>
          particle.x > canvas.width ||
          particle.x < 0 ||
          particle.y > canvas.height ||
          particle.y < 0
      );

      if (allParticlesOffScreen) setRerenderSim((prev) => !prev);
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
  }, [rerenderSim, theme.secondary]);

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

      {visibleUI && (
        <div style={{ zIndex: 3000 }}>
          <ChangerGroup
            valueArrays={[
              {
                title: "Particle Count:",
                valueRef: particleCountRef,
                minValue: "1",
                maxValue: "100.0",
                type: "slider",
              },
              {
                title: "Simulation Speed:",
                valueRef: simulationSpeedRef,
                minValue: "0",
                maxValue: "200.0",
                type: "slider",
              },

              // {
              //   title: "Future Predictions:",
              //   valueRef: futurePredictionRef,
              //   minValue: "0.0",
              //   maxValue: "500.0",
              //   type: "slider",
              // },
              {
                title: "Gravitational Constant:",
                valueRef: gravConstantRef,
                minValue: "0.0",
                maxValue: "10.0",
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
            ]}
            rerenderSetter={setRender}
          />
        </div>
      )}
    </>
  );
}
