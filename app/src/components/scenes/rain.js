import React, { useEffect, useRef, useState } from "react";
import defaultColours from "../../themes/themes";

export default function Rain() {
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const [particleCount, setParticleCount] = useState(2000);
  const [simulationSpeed, setSimulationSpeed] = useState(100);
  const [mouseShieldRadius, setMouseShieldRadius] = useState(100);

  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext("2d");
    let particles = [];
    const gravity = 0.5;
    const windSpeed = 0.2;
    const titleShieldRadius = 300;
    let animationFrameId;
    const maxFallSpeed = 13;
    const maxWindSpeed = Math.random() * 10;

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

    class Particle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = Math.random() * 2 - 1;
        this.vy = Math.random() * 10 + 5;
        this.size = Math.random() * 2 + 1;
        this.color = defaultColours.secondary;
      }

      update() {
        const dx = this.x - mousePosRef.current.x;
        const dy = this.y - mousePosRef.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        const dxFromTitle = this.x - window.innerWidth / 2;
        const dyFromTitle = this.y - window.innerHeight / 2;
        const distanceFromTitle = Math.sqrt(
          0.2 * dxFromTitle * dxFromTitle + 3 * dyFromTitle * dyFromTitle
        );

        if (distance < mouseShieldRadius && mouseClickRef.current) {
          const angle = Math.atan2(dy, dx);
          this.vx = Math.cos(angle) * 5;
          this.vy = Math.sin(angle) * 5;
        } else if (distanceFromTitle < titleShieldRadius) {
          const angle2 = Math.atan2(dyFromTitle, dxFromTitle);
          this.vx = Math.cos(angle2) * 10;
          this.vy = Math.sin(angle2) * 10;
        } else {
          if (this.vy < maxWindSpeed) {
            this.vx += windSpeed;
          }
          if (this.vy < maxFallSpeed) {
            this.vy += gravity;
          }
        }

        this.x += (this.vx * simulationSpeed) / 100;
        this.y += (this.vy * simulationSpeed) / 100;

        if (this.y > canvas.height) {
          this.y = 0;
          this.x = Math.random() * canvas.width;
          this.vy = Math.random() * 10 + 5;
          this.vx = Math.random() * 2 - 1;
        }

        if (this.x >= canvas.width + this.size * 3) {
          this.x = Math.random() * canvas.width;
          this.y = 0;
          this.vx = 0;
        }

        if (this.x < 0 - this.size * 3) {
          this.x = Math.random() * canvas.width;
          this.y = 0;
          this.vx = 0;
        }

        if (this.y + this.size < 0) {
          this.y = canvas.height;
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
      particles = [];
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

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mouseup", handleMouseUp);

    return () => {
      // Cleanup function to cancel the animation frame and remove event listeners
      cancelAnimationFrame(animationFrameId);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mouseup", handleMouseUp);
    };
  }, [particleCount, simulationSpeed, mouseShieldRadius]);

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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "0.5em",
            }}
          >
            Mouse Umbrella Radius:
            <input
              type="range"
              min="10.0"
              max="200.0"
              value={mouseShieldRadius}
              onChange={(e) => setMouseShieldRadius(Number(e.target.value))}
              style={{ marginLeft: "0.5em" }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
