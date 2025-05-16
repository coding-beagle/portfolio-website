import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { SliderGroup } from "../utilities/valueChangers";

export default function Snow() {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const particleCountRef = useRef(200);
  const simulationSpeedRef = useRef(100);
  const [, setRender] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    // const titleShieldRadius = 30;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // recalculateRect();
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    const ctx = canvas.getContext("2d");

    let particles = [];
    const gravity = Math.random() > 0.1 ? 0.05 : -0.05;
    const maxSpeed = 1;
    let animationFrameId;

    class Particle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = Math.random() * 2 - 1;
        this.vy = Math.random() * 2 - 1;
        this.size = Math.random() * 2 + 1;
        this.color = theme.accent;
      }

      reset() {
        if (gravity > 0.0) {
          this.y = 0;
          this.vy *= -0.5;
          this.x = Math.random() * canvas.width;
          this.vx = Math.random() * 2 - 1;
        } else {
          this.y = canvas.height;
          this.x = Math.random() * canvas.width;
          this.vx = Math.random() * 2 - 1;
        }
      }

      update() {
        this.vy += gravity;
        this.x += (this.vx * simulationSpeedRef.current) / 100;
        this.y += (this.vy * simulationSpeedRef.current) / 100;

        // if (element) {
        //   const dxFromElementCenter = this.x - elementCenterX;
        //   const dyFromElementCenter = this.y - elementCenterY;

        //   if (inElement(rect_padded, this.x, this.y)) {
        //     const angle2 = Math.atan2(dyFromElementCenter, dxFromElementCenter);
        //     this.vx = Math.cos(angle2);
        //     this.vy = Math.sin(angle2);
        //   }
        // }

        if (this.y + this.size > canvas.height && gravity > 0.0) {
          this.reset();
        }

        if (this.y + this.size < 0.0 && gravity < 0.0) {
          this.reset();
        }

        if (Math.abs(this.vy) > maxSpeed) {
          this.vy -= Math.random(0.1, 0.5) * Math.sign(gravity);
        }

        if (Math.abs(this.vy) < maxSpeed) {
          this.vy += Math.random(0.1, 0.5) * Math.sign(gravity);
        }

        if (this.x + this.size > canvas.width || this.x - this.size < 0) {
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

    function initParticles() {
      for (let i = 0; i < particleCountRef.current; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        particles.push(new Particle(x, y));
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

    return () => {
      // Cleanup function to cancel the animation frame
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resizeCanvas);
      particles = [];
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
        <SliderGroup
          valueArrays={[
            {
              title: "Particle Count:",
              valueRef: particleCountRef,
              minValue: "100",
              maxValue: "10000",
            },
            {
              title: "Simulation Speed:",
              valueRef: simulationSpeedRef,
              minValue: "1",
              maxValue: "200.0",
            },
          ]}
          rerenderSetter={setRender}
        />
      </div>
    </>
  );
}
