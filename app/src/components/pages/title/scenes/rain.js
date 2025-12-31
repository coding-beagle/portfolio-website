import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import MouseTooltip, { IconGroup } from "../utilities/popovers";
import { ChangerGroup } from "../utilities/valueChangers";

export default function Rain({ visibleUI }) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const touchActiveRef = useRef(false);
  const particleCountRef = useRef(2000);
  const simulationSpeedRef = useRef(100);
  const mouseShieldRadiusRef = useRef(100);
  const windspeedRef = useRef(Math.round((Math.random() - 0.5) * 100));
  // const maxWindSpeedRef = useRef(Math.round((Math.random()) * 20));
  const titleShieldRadiusRef = useRef(30);
  const recalculateRectRef = useRef(() => { });
  const visibleUIRef = useRef(visibleUI);
  const [, setRender] = useState(0); // Dummy state to force re-render

  useEffect(() => {
    let element = document.getElementById("title") ?? null;
    let rect_padded = { left: 0, right: 0, top: 0, bottom: 0 };
    let elementCenterX = 0;
    let elementCenterY = 0;

    let particles = [];
    const gravity = 0.5;
    let animationFrameId;
    const maxFallSpeed = 13;
    const maxWindSpeed = 6;

    const recalculateRect = () => {
      if (!element) return;
      let rect = element.getBoundingClientRect();
      rect_padded = {
        left: rect.left - titleShieldRadiusRef.current,
        right: rect.right + titleShieldRadiusRef.current,
        top: rect.top - titleShieldRadiusRef.current,
        bottom: rect.bottom + titleShieldRadiusRef.current,
      };
      elementCenterX = rect.left + rect.width / 2;
      elementCenterY = rect.top + rect.height / 2;
    };

    recalculateRectRef.current = recalculateRect;

    const canvas = canvasRef.current;
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      recalculateRect();
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("popstate", recalculateRect);
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

    const handleTouchMove = (event) => {
      if (event.touches && event.touches.length > 0) {
        const rect = canvas.getBoundingClientRect();
        const touch = event.touches[0];
        mousePosRef.current = {
          x: touch.clientX - rect.left,
          y: touch.clientY - rect.top,
        };
      }
    };

    const handleTouchStart = () => {
      touchActiveRef.current = true;
    };

    const handleTouchEnd = () => {
      touchActiveRef.current = false;
    };

    // --- Touch event handler to prevent scroll on drag ---
    function handleTouchDragPreventScroll(e) {
      if (e.touches && e.touches.length > 0) {
        e.preventDefault();
      }
    }

    const inElement = (rect, x, y) => {
      return (
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      );
    };

    recalculateRect();

    class Particle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = Math.random() * 2 - 1;
        this.vy = Math.random() * 10 + 5;
        this.size = Math.random() * 2 + 1;
        this.color = theme.secondary;
      }

      reset() {
        this.y = 0;
        this.x = Math.random() * canvas.width;
        this.vy = Math.random() * 10 + 5;
        this.vx = Math.random() * 2 - 1;
      }

      update() {
        const dx = this.x - mousePosRef.current.x;
        const dy = this.y - mousePosRef.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (element && visibleUIRef.current) {
          const dxFromElementCenter = this.x - elementCenterX;
          const dyFromElementCenter = this.y - elementCenterY;

          if (inElement(rect_padded, this.x, this.y)) {
            const angle2 = Math.atan2(dyFromElementCenter, dxFromElementCenter);
            this.vx = Math.cos(angle2) * 5;
            this.vy = Math.sin(angle2) * 5;
          }
        }

        if (distance < mouseShieldRadiusRef.current && (mouseClickRef.current || touchActiveRef.current)) {
          const angle = Math.atan2(dy, dx);
          this.vx = Math.cos(angle) * 5;
          this.vy = Math.sin(angle) * 5;
        }

        if (Math.abs(this.vx) < maxWindSpeed) {
          this.vx += windspeedRef.current / 50
        }
        if (this.vy < maxFallSpeed) {
          this.vy += gravity;
        }

        this.x += (this.vx * simulationSpeedRef.current) / 100;
        this.y += (this.vy * simulationSpeedRef.current) / 100;

        if (this.y > canvas.height) {
          this.reset()
        }

        if (this.x >= canvas.width + this.size * 3) {
          this.reset()
        }

        if (this.x < 0 - this.size * 3) {
          this.reset()
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

      if (element) {
        const rect = element.getBoundingClientRect();
        const padded_hypothetical_rect = {
          left: rect.left - titleShieldRadiusRef.current,
          right: rect.right + titleShieldRadiusRef.current,
          top: rect.top - titleShieldRadiusRef.current,
          bottom: rect.bottom + titleShieldRadiusRef.current,
        };
        if (rect_padded.top !== padded_hypothetical_rect.top) {
          recalculateRect()
        }
      }

      if (!element && document.getElementById("title")) {
        element = document.getElementById("title");
        recalculateRect();
      }

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

    window.addEventListener("pointermove", handleMouseMove);
    window.addEventListener("pointerdown", handleMouseDown);
    window.addEventListener("pointerup", handleMouseUp);
    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchstart", handleTouchStart);
    window.addEventListener("touchend", handleTouchEnd);
    // Prevent default scroll on touch drag over canvas
    if (canvas) {
      canvas.addEventListener("touchmove", handleTouchDragPreventScroll, {
        passive: false,
      });
    }

    return () => {
      // Cleanup function to cancel the animation frame and remove event listeners
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("pointermove", handleMouseMove);
      window.removeEventListener("pointerdown", handleMouseDown);
      window.removeEventListener("pointerup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("popstate", recalculateRect);
      if (canvas) {
        canvas.removeEventListener("touchmove", handleTouchDragPreventScroll);
      }
      particles = [];
    };
  }, [theme.secondary]);

  useEffect(() => {
    visibleUIRef.current = visibleUI;
  }, [visibleUI]);

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
                minValue: "100",
                maxValue: "10000",
                type: "slider",
              },
              {
                title: "Simulation Speed:",
                valueRef: simulationSpeedRef,
                minValue: "1",
                maxValue: "200.0",
                type: "slider",
              },
              {
                title: "Wind Speed:",
                valueRef: windspeedRef,
                minValue: "-100",
                maxValue: "100.0",
                type: "slider",
              },
              {
                title: "Click Umbrella Radius:",
                valueRef: mouseShieldRadiusRef,
                minValue: "10.0",
                maxValue: "300.0",
                type: "slider",
              },
              {
                title: "Title Umbrella Radius:",
                valueRef: titleShieldRadiusRef,
                minValue: "1.0",
                maxValue: "100.0",
                callback: recalculateRectRef.current,
                type: "slider",
              },
            ]}
            rerenderSetter={setRender}
          />

          <IconGroup icons={[
            { type: "MOUSE" },
          ]} />
        </div>
      )}
    </>
  );
}
