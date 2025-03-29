import React, { useEffect, useRef, useState } from "react";
import defaultColours from "../../../../themes/themes";

export default function WindTunnel() {
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const particleCountRef = useRef(2000);
  const simulationSpeedRef = useRef(100);
  const mouseShieldRadiusRef = useRef(100);
  const [, setRender] = useState(0); // Dummy state to force re-render

  useEffect(() => {
    const element = document.getElementById("title");
    const element2 = document.getElementById("linkIcons");
    let rect_padded = { left: 0, right: 0, top: 0, bottom: 0 };
    let rect2_padded = { left: 0, right: 0, top: 0, bottom: 0 };
    let elementCenterX = 0;
    let elementCenterY = 0;
    let element2CenterX = 0;
    let element2CenterY = 0;

    let particles = [];
    const gravity = 0.0;
    const windSpeed = 0.2;
    const titleShieldRadiusVertical = 10;
    const titleShieldRadiusHorizontal = 200;

    const linksShieldRadiusVertical = 10;
    const linksShieldRadiusHorizontal = 120;
    let animationFrameId;
    const maxFallSpeed = 13;
    const maxWindSpeed = 5;

    const recalculateRect = () => {
      const rect = element.getBoundingClientRect();
      const rect2 = element2.getBoundingClientRect();
      rect_padded = {
        left: rect.left - titleShieldRadiusHorizontal,
        right: rect.right + titleShieldRadiusHorizontal,
        top: rect.top - titleShieldRadiusVertical,
        bottom: rect.bottom + titleShieldRadiusVertical,
      };
      rect2_padded = {
        left: rect2.left - linksShieldRadiusHorizontal,
        right: rect2.right + linksShieldRadiusHorizontal,
        top: rect2.top - linksShieldRadiusVertical,
        bottom: rect2.bottom + linksShieldRadiusVertical,
      };
      elementCenterX = rect.left + rect.width / 2;
      elementCenterY = rect.top + rect.height / 2;
      element2CenterX = rect2.left + rect2.width / 2;
      element2CenterY = rect2.top + rect2.height / 2;
    };

    const canvas = canvasRef.current;
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      recalculateRect();
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    const ctx = canvas.getContext("2d");

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

    const inElement = (rect, x, y) => {
      return (
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      );
    };

    recalculateRect();

    class Particle {
      constructor(x, y, vx = Math.random() * 2 - 1) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = 0;
        this.size = 1;
        this.color = defaultColours.accent;
      }

      update() {
        const dx = this.x - mousePosRef.current.x;
        const dy = this.y - mousePosRef.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (element) {
          const dxFromElementCenter = this.x - elementCenterX;
          const dyFromElementCenter = this.y - elementCenterY;

          if (inElement(rect_padded, this.x, this.y)) {
            const angle2 = Math.atan2(dyFromElementCenter, dxFromElementCenter);
            this.vx = this.vx * 0.99 + Math.cos(angle2) * 0.2;
            this.vy = this.vy + Math.sin(angle2) * 0.55;
          } else {
            this.vy *= 0.9;
          }
        }

        if (element2) {
          const dxFromElementCenter = this.x - element2CenterX;
          const dyFromElementCenter = this.y - element2CenterY;

          if (inElement(rect2_padded, this.x, this.y)) {
            const angle2 = Math.atan2(dyFromElementCenter, dxFromElementCenter);
            this.vx = this.vx + Math.cos(angle2) * 0.2;
            this.vy = this.vy + Math.sin(angle2) * 0.6 + Math.random();
          } else {
            this.vy *= 0.9;
          }
        }

        if (distance < mouseShieldRadiusRef.current && mouseClickRef.current) {
          const angle = Math.atan2(dy, dx);
          this.vx = this.vx + Math.cos(angle) * 0.3;
          this.vy = this.vy + Math.sin(angle) * 0.55;
        } else {
          if (this.vx < maxWindSpeed) {
            this.vx += windSpeed;
          }
        }

        this.x += (this.vx * simulationSpeedRef.current) / 100;
        this.y +=
          ((this.vy + Math.random() - 0.5) * simulationSpeedRef.current) / 100;

        if (this.x >= canvas.width + this.size * 3) {
          this.x = 0;
          this.y = Math.random() * canvas.height;
          this.vy = 0;
          this.vx = Math.random() * maxWindSpeed - maxWindSpeed / 2;
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

    canvas.addEventListener("pointermove", handleMouseMove);
    canvas.addEventListener("touchmove", handleMouseMove);
    canvas.addEventListener("pointerdown", handleMouseDown);
    canvas.addEventListener("pointerup", handleMouseUp);

    return () => {
      // Cleanup function to cancel the animation frame and remove event listeners
      cancelAnimationFrame(animationFrameId);
      canvas.removeEventListener("pointermove", handleMouseMove);
      canvas.removeEventListener("touchmove", handleMouseMove);
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
            Particle Count:
            <input
              type="range"
              min="10"
              max="20000"
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "0.5em",
            }}
          >
            Click Umbrella Radius:
            <input
              type="range"
              min="10.0"
              max="300.0"
              value={mouseShieldRadiusRef.current}
              onChange={(e) => {
                mouseShieldRadiusRef.current = Number(e.target.value);
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
