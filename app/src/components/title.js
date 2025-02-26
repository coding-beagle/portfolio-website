import { useState, useEffect, use } from "react";
import defaultColours from "../themes/themes";

export default function Title() {
  const [isHover, setIsHover] = useState(false);
  let particles = [];
  const particleCount = 500;
  const gravity = 0.05;
  const maxSpeed = 1;

  useEffect(() => {
    const canvas = document.querySelector("canvas");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext("2d");

    class Particle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = Math.random() * 2 - 1;
        this.vy = Math.random() * 2 - 1;
        this.size = Math.random() * 2 + 1;
        this.color = defaultColours.accent;
        this.gravity = gravity;
      }

      changeDirection() {
        this.gravity *= -1;
      }

      update() {
        this.vy += this.gravity;
        this.x += this.vx;
        this.y += this.vy;

        if (this.y + this.size > canvas.height) {
          this.y = 0;
          this.vy *= -0.5;
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
      requestAnimationFrame(animate);
    }

    initParticles();
    animate();
  }, []);

  useEffect(() => {
    console.log("hovering", isHover);
    for (let i = 0; i < particles.length; i++) {
      particles[i].changeDirection();
    }
  }, [isHover, particles]);

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        flexDirection: "column",
        position: "relative",
      }}
    >
      <canvas
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: 1,
        }}
      />
      <header
        onMouseEnter={() => setIsHover(true)}
        onMouseLeave={() => setIsHover(false)}
        style={{
          fontSize: "8em",
          textAlign: "center",
          color: isHover ? defaultColours.secondary : defaultColours.accent,
          fontWeight: "bold",
          zIndex: 10,
          transition: "color 0.3s ease, transform 0.3s ease",
          position: "relative",
          transform: isHover ? "rotate(2deg)" : "rotate(0deg)",
        }}
      >
        Nicholas Teague
      </header>
    </div>
  );
}
