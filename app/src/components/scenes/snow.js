import React, { useEffect, useRef } from "react";
import defaultColours from "../../themes/themes";

export default function Snow() {
  const canvasRef = useRef(null);
  const [particleCount, setParticleCount] = React.useState(200);
  const [simulationSpeed, setSimulationSpeed] = React.useState(100);

  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext("2d");
    let particles = [];
    const gravity = 0.05;
    const maxSpeed = 1;
    let animationFrameId;

    const getMousePos = (canvas, evt) => {
      let rect = canvas.getBoundingClientRect();
      return {
        x: evt.clientX - rect.left,
        y: evt.clientY - rect.top,
      };
    };

    class Particle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = Math.random() * 2 - 1;
        this.vy = Math.random() * 2 - 1;
        this.size = Math.random() * 2 + 1;
        this.color = defaultColours.accent;
      }

      update() {
        this.vy += gravity;
        this.x += (this.vx * simulationSpeed) / 100;
        this.y += (this.vy * simulationSpeed) / 100;

        if (this.y + this.size > canvas.height) {
          this.y = 0;
          this.vy *= -0.5;
          this.x = Math.random() * canvas.width;
        }

        if (this.y + this.size < 0) {
          this.y = canvas.height;
          this.vy *= -0.5;
        }

        if (this.vy > maxSpeed) {
          this.vy -= Math.random(0.1, 0.5);
        }

        if (this.vy < maxSpeed) {
          this.vy += Math.random(0.1, 0.5);
        }

        if (this.x + this.size > canvas.width || this.x - this.size < 0) {
          this.vx *= -1;
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

    function initParticles() {
      for (let i = 0; i < particleCount; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        particles.push(new Particle(x, y));
      }
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((particle) => {
        particle.update();
        particle.draw();
      });
      animationFrameId = requestAnimationFrame(animate);
    }

    initParticles();
    animate();

    return () => {
      // Cleanup function to cancel the animation frame
      cancelAnimationFrame(animationFrameId);
    };
  }, [particleCount, simulationSpeed]);

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
            Particle Count:
            <input
              type="range"
              min="100"
              max="10000"
              value={particleCount}
              onChange={(e) => setParticleCount(Number(e.target.value))}
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
            Simulation Speed:
            <input
              type="range"
              min="1.0"
              max="200.0"
              value={simulationSpeed}
              onChange={(e) => setSimulationSpeed(Number(e.target.value))}
              style={{ marginLeft: "0.5em" }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
