import React, { useEffect, useRef, useState } from "react";
import defaultColours from "../../themes/themes";

export default function Boids() {
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const particleCountRef = useRef(10);
  const simulationSpeedRef = useRef(100);
  const speedLim = 5;
  const [, setRender] = useState(0); // Dummy state to force re-render

  useEffect(() => {
    const element = document.getElementById("title");
    let rect_padded = { left: 0, right: 0, top: 0, bottom: 0 };
    let elementCenterX = 0;
    let elementCenterY = 0;
    let animationFrameId;

    let particles = [];

    const canvas = canvasRef.current;
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    const ctx = canvas.getContext("2d");

    class PrimaryBird {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.dx = Math.random() * 2 - 1;
        this.dy = Math.random() * 2 - 1;
        this.size = 10;
        this.colour = defaultColours.secondaryAccent;
      }

      draw() {
        ctx.fillStyle = this.colour;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, 2 * Math.PI);
        ctx.fill();
      }

      update() {
        this.dx_to_mouse = mousePosRef.current.x - this.x;
        this.dy_to_mouse = mousePosRef.current.y - this.y;

        this.dx += this.dx_to_mouse / 1000;
        this.dy += this.dy_to_mouse / 1000;

        const currentSpeed = Math.sqrt(this.dx ** 2 + this.dy ** 2);
        if (currentSpeed > speedLim) {
          this.dx = this.dx * 0.95;
          this.dy = this.dy * 0.95;
        }

        this.x += this.dx;
        this.y += this.dy;
      }
    }

    class SecondaryBird {
      constructor(x, y, PrimaryBird, particles) {
        this.PrimaryBird = PrimaryBird;
        this.particles = particles;
        this.x = x;
        this.y = y;
        this.dx = Math.random();
        this.dy = Math.random();
        this.size = 10;
        this.colour = defaultColours.secondaryAccent;
      }

      draw() {
        ctx.fillStyle = this.colour;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, 2 * Math.PI);
        ctx.fill();
      }
      nearOtherBirds() {
        const distance = 50;
        let count = 0;
        this.particles.forEach((particle) => {
          if (particle !== this) {
            const dx = this.x - particle.x;
            const dy = this.y - particle.y;
            const dist = Math.sqrt(dx ** 2 + dy ** 2);
            if (dist < distance) {
              return { dx: particle.x, dy: particle.y };
            }
          }
        });
        return false;
      }

      update() {
        this.dx_to_bird = this.PrimaryBird.x - this.x;
        this.dy_to_bird = this.PrimaryBird.y - this.y;

        this.dx += this.dx_to_bird / 1000;
        this.dy += this.dy_to_bird / 1000;

        const currentSpeed = Math.sqrt(this.dx ** 2 + this.dy ** 2);
        if (currentSpeed > speedLim) {
          this.dx = this.dx * 0.99;
          this.dy = this.dy * 0.99;
        }

        const nearBirds = this.nearOtherBirds();
        if (nearBirds) {
          const nearBirdDirection = Math.atan2(nearBirds.dy, nearBirds.dx);
          const currentDirection = Math.atan2(this.dy, this.dx);
          const newDirection = (nearBirdDirection + currentDirection) / 2;
          this.dx = Math.cos(newDirection);
          this.dy = Math.sin(newDirection);
        }

        this.x += this.dx;
        this.y += this.dy;
      }
    }

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

    function initParticles() {
      particles = [];

      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      particles.push(new PrimaryBird(x, y));
      for (let i = 0; i < particleCountRef.current; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        particles.push(new SecondaryBird(x, y, particles[0], particles));
      }
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Adjust particle count
      const currentParticleCount = particles.length;
      if (currentParticleCount < particleCountRef.current) {
        for (
          let i = currentParticleCount;
          i < particleCountRef.current + 1;
          i++
        ) {
          const x = Math.random() * canvas.width;
          const y = Math.random() * canvas.height;
          particles.push(new SecondaryBird(x, y, particles[0], particles));
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

    canvas.addEventListener("pointermove", handleMouseMove);
    canvas.addEventListener("pointerdown", handleMouseDown);
    canvas.addEventListener("pointerup", handleMouseUp);

    return () => {
      // Cleanup function to cancel the animation frame and remove event listeners
      cancelAnimationFrame(animationFrameId);
      canvas.removeEventListener("pointermove", handleMouseMove);
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
            Bird Count:
            <input
              type="range"
              min="2"
              max="300"
              value={particleCountRef.current}
              onChange={(e) => {
                particleCountRef.current = Number(e.target.value);
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
        </div>
      </div>
    </>
  );
}
