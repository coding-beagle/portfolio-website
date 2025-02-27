import React, { useEffect, useRef } from "react";
import defaultColours from "../../themes/themes";

export default function Snow() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext("2d");
    let particles = [];
    const particleCount = 200;
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
        this.x += this.vx;
        this.y += this.vy;

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
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
      }}
    />
  );
}
