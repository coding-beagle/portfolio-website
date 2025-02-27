import React, { useEffect, useRef } from "react";
import defaultColours from "../../themes/themes";

export default function Rain() {
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext("2d");
    let particles = [];
    const particleCount = 2000;
    const gravity = 13;
    const rainX = (Math.random() - 0.5) * 15;
    const mouseShieldRadius = 100;
    const titleShieldRadius = 200;
    let animationFrameId;

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
        this.vx = rainX;
        this.vy = gravity;
        this.size = Math.random() * 2 + 1;
        this.color = defaultColours.secondary;
      }

      update() {
        const dx = this.x - mousePosRef.current.x;
        const dy = this.y - mousePosRef.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        const dxFromTitle = this.x - window.innerWidth / 1.5;
        const dyFromTitle = this.y - window.innerHeight / 2;
        const distanceFromTitle = Math.sqrt(
          dxFromTitle * dxFromTitle + dyFromTitle * dyFromTitle
        );

        const dxFromTitle2 = this.x - window.innerWidth / 3;
        const dyFromTitle2 = this.y - window.innerHeight / 2;
        const distanceFromTitle2 = Math.sqrt(
          dxFromTitle2 * dxFromTitle2 + dyFromTitle2 * dyFromTitle2
        );

        const dxFromTitle3 = this.x - window.innerWidth / 2;
        const dyFromTitle3 = this.y - window.innerHeight / 2.2;
        const distanceFromTitle3 = Math.sqrt(
          dxFromTitle3 * dxFromTitle3 + dyFromTitle3 * dyFromTitle3
        );

        if (distance < mouseShieldRadius && mouseClickRef.current) {
          const angle = Math.atan2(dy, dx);
          this.vx = Math.cos(angle) * 5;
          this.vy = Math.sin(angle) * 5;
        } else if (distanceFromTitle < titleShieldRadius) {
          const angle2 = Math.atan2(dyFromTitle, dxFromTitle);
          this.vx = Math.cos(angle2) * 5;
          this.vy = Math.sin(angle2) * 5;
        } else if (distanceFromTitle2 < titleShieldRadius) {
          const angle3 = Math.atan2(dyFromTitle2, dxFromTitle2);
          this.vx = Math.cos(angle3) * 5;
          this.vy = Math.sin(angle3) * 5;
        } else if (distanceFromTitle3 < titleShieldRadius * 2) {
          const angle4 = Math.atan2(dyFromTitle3, dxFromTitle3);
          this.vx = Math.cos(angle4) * 5;
          this.vy = Math.sin(angle4) * 5;
        } else {
          this.vx = rainX;
          this.vy = gravity;
        }

        this.x += this.vx + (Math.random() - 0.5) * 2;
        this.y += this.vy;

        if (this.y > canvas.height) {
          this.y = 0;
          this.x = Math.random() * canvas.width;
        }

        if (this.x >= canvas.width + this.size * 3) {
          this.x = 0;
        }

        if (this.x < 0 - this.size * 3) {
          this.x = canvas.width;
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
