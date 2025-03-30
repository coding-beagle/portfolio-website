import React, { useEffect, useRef, useState } from "react";
import defaultColours from "../../../../themes/themes";

export default function Snow() {
  const canvasRef = useRef(null);
  const particleCountRef = useRef(200);
  const simulationSpeedRef = useRef(100);
  const [, setRender] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    // const element = document.getElementById("title");
    // let rect_padded = { left: 0, right: 0, top: 0, bottom: 0 };
    // let elementCenterX = 0;
    // let elementCenterY = 0;
    const titleShieldRadius = 30;

    // const recalculateRect = () => {
    //   let rect = element.getBoundingClientRect();

    //   rect_padded = {
    //     left: rect.left - titleShieldRadius,
    //     right: rect.right + titleShieldRadius,
    //     top: rect.top - titleShieldRadius,
    //     bottom: rect.bottom + titleShieldRadius,
    //   };
    //   elementCenterX = rect.left + rect.width / 2;
    //   elementCenterY = rect.top + rect.height / 2;
    // };

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // recalculateRect();
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    const ctx = canvas.getContext("2d");

    let particles = [];
    const gravity = 0.05;
    const maxSpeed = 1;
    let animationFrameId;

    // const getMousePos = (canvas, evt) => {
    //   let rect = canvas.getBoundingClientRect();
    //   return {
    //     x: evt.clientX - rect.left,
    //     y: evt.clientY - rect.top,
    //   };
    // };

    // const inElement = (rect, x, y) => {
    //   return (
    //     x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    //   );
    // };

    // recalculateRect();

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
