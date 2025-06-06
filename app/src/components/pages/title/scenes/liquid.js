import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import MouseTooltip from "../utilities/popovers";
import { ChangerGroup } from "../utilities/valueChangers";
import { getCloseColour } from "../utilities/usefulFunctions";

export default function Liquid() {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const particleCountRef = useRef(0);
  const clearParticles = useRef(null);

  const simulationSpeedRef = useRef(100);
  const brushRadiusRef = useRef(100);
  const titleShieldRadiusRef = useRef(0);
  const recalculateRectRef = useRef(() => {});
  const [, setRender] = useState(0); // Dummy state to force re-render

  useEffect(() => {
    const element = document.getElementById("title");
    let rect_padded = { left: 0, right: 0, top: 0, bottom: 0 };
    let elementCenterX = 0;
    let elementCenterY = 0;

    let particles = [];
    const gravity = 0.2;
    let animationFrameId;

    const recalculateRect = () => {
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

    const map = (x, in_min, in_max, out_min, out_max) => {
      return Math.floor(
        ((x - in_min) * (out_max - out_min)) / (in_max - in_min) + out_min
      );
    };

    const num_particle_rows = 100;
    const num_particle_columns = 100;

    class Particle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = Math.random() * 10 + 5;
        this.size = Math.random() * 10 + 5;
        this.color = getCloseColour(theme.secondary, 10, 10, 60);
        this.grid = { x: 0, y: 0 };
      }

      colliding() {
        return particles.find((particle) => {
          if (particle === this) return false;
          if (
            Math.abs(particle.grid.x - this.grid.x) < 2 &&
            Math.abs(particle.grid.y - this.grid.y) < 2
          ) {
            const dx = (this.x - particle.x) ** 2;
            const dy = (this.y - particle.y) ** 2;
            if (dx + dy < (particle.size + this.size) ** 2) {
              return particle;
            }
          }
        });
      }

      update() {
        if (element) {
          if (inElement(rect_padded, this.x, this.y)) {
            this.vy = 0;
          }
        }

        const colliding_particle = this.colliding();
        if (colliding_particle) {
          const dx = this.x - colliding_particle.x;
          const dy = this.y - colliding_particle.y;

          const angle2 = Math.atan2(dy, dx);

          this.vx += Math.cos(angle2);
          this.vy += Math.sin(angle2);
        }

        this.vx *= 0.9;

        if (this.y + this.size < canvasRef.current.height) {
          this.vy += gravity;
        }

        if (this.x < 0.0) {
          this.vx += 10;
        }

        if (this.x > canvasRef.current.width) {
          this.vx -= 10;
        }

        this.x += (this.vx * simulationSpeedRef.current) / 100;
        this.y += (this.vy * simulationSpeedRef.current) / 100;

        if (this.y + this.size * 3 > canvasRef.current.height) {
          this.vy = 0;
        }

        this.update_grid_from_pos();
      }

      update_grid_from_pos() {
        this.grid = {
          x: map(this.x, 0, canvasRef.current.width, 0, num_particle_columns),
          y: map(this.y, 0, canvasRef.current.height, 0, num_particle_rows),
        };
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.closePath();
      }
    }

    clearParticles.current = () => {
      particles = [];
    };

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particleCountRef.current = particles.length;

      if (mouseClickRef.current) {
        for (let i = 0; i < Math.floor(Math.random() * 10); i++) {
          const x =
            (Math.random() - 0.5) * brushRadiusRef.current +
            mousePosRef.current.x;
          const y =
            (Math.random() - 0.5) * brushRadiusRef.current +
            mousePosRef.current.y;
          particles.push(new Particle(x, y));
        }
      }

      particles.forEach((particle) => {
        particle.update();
        particle.draw();
      });
      animationFrameId = requestAnimationFrame(animate);
    }

    // initParticles();
    animate();

    window.addEventListener("pointermove", handleMouseMove);
    window.addEventListener("touchmove", handleMouseMove);
    window.addEventListener("pointerdown", handleMouseDown);
    window.addEventListener("pointerup", handleMouseUp);
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
      window.removeEventListener("touchmove", handleMouseMove);
      window.removeEventListener("pointerdown", handleMouseDown);
      window.removeEventListener("pointerup", handleMouseUp);
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("popstate", recalculateRect);
      if (canvas) {
        canvas.removeEventListener("touchmove", handleTouchDragPreventScroll);
      }
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
      <div style={{ zIndex: 3000 }}>
        <ChangerGroup
          valueArrays={[
            {
              title: "Particles:",
              valueRef: particleCountRef,
              minValue: "1",
              maxValue: "200.0",
              type: "display",
            },
            {
              title: "Simulation Speed:",
              valueRef: simulationSpeedRef,
              minValue: "1",
              maxValue: "200.0",
              type: "slider",
            },
            {
              title: "Brush Radius:",
              valueRef: brushRadiusRef,
              minValue: "10.0",
              maxValue: "300.0",
              type: "slider",
            },
            {
              title: "",
              type: "button",
              callback: () => {
                clearParticles.current();
              },
              buttonText: "Clear Screen",
            },
          ]}
          rerenderSetter={setRender}
        />

        <div style={{ position: "absolute", top: "1em", right: "1em" }}>
          <MouseTooltip />
        </div>
      </div>
    </>
  );
}
