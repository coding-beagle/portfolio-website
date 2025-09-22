import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { IconGroup } from "../utilities/popovers";
import { ChangerGroup } from "../utilities/valueChangers";

export default function PID({ visibleUI }) {
  const { theme } = useTheme();
  const themeRef = useRef(theme)

  const particleCountRef = useRef(10);

  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const touchActiveRef = useRef(false);

  const randomiseRef = useRef(null);

  const propGain = useRef(1);
  const integralGain = useRef(0);
  const derivGain = useRef(0);

  const simulationSpeedRef = useRef(100);

  const visibleUIRef = useRef(visibleUI);
  const [, setRender] = useState(0); // Dummy state to force re-render

  useEffect(() => {

    let particles = [];

    let animationFrameId;


    const canvas = canvasRef.current;
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
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

    let d = new Date()
    let timeVal;

    class Particle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.target_vx = 0;
        this.target_vy = 0;
        this.last_vx = 0;
        this.last_vy = 0;
        this.size = Math.random() * 10 + 2.5;
        this.color = themeRef.current.secondary;
        this.counter = 0;
        this.lastTime = d.getTime();
        this.integral_dx = 0;
        this.integral_dy = 0;
        this.prev_dx = 0;
        this.prev_dy = 0;
      }

      update() {
        d = new Date();
        const thisTime = d.getTime()

        const dx = this.x - mousePosRef.current.x;
        const dy = this.y - mousePosRef.current.y;

        const dt = (thisTime - this.lastTime) + 0.000001;

        this.integral_dx = this.integral_dx + dx * dt;
        this.integral_dy = this.integral_dy + dy * dt;

        const maxIntegral = 1000;
        this.integral_dx = Math.max(-maxIntegral, Math.min(maxIntegral, this.integral_dx + dx * dt));
        this.integral_dy = Math.max(-maxIntegral, Math.min(maxIntegral, this.integral_dy + dy * dt));

        const distanceThreshold = 50;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < distanceThreshold) {
          this.integral_dx *= 0.95;
          this.integral_dy *= 0.95;
        }

        const dx_err = (dx - this.prev_dx) / dt;
        const dy_err = (dy - this.prev_dy) / dt;

        const dx_prop = dx * propGain.current / -100.0;
        const dy_prop = dy * propGain.current / -100.0;

        const dx_integral = this.integral_dx * integralGain.current / 1000.0;
        const dy_integral = this.integral_dy * integralGain.current / 1000.0;

        const dx_deriv = dx_err * derivGain.current / -10.0;
        const dy_deriv = dy_err * derivGain.current / -10.0;

        this.target_vx = dx_prop + dx_integral + dx_deriv;
        this.target_vy = dy_prop + dy_integral + dy_deriv;

        this.vx = 0.98 * this.last_vx + 0.02 * this.target_vx;
        this.vy = 0.98 * this.last_vy + 0.02 * this.target_vy;


        this.x += (this.vx * simulationSpeedRef.current) / 100;
        this.y += (this.vy * simulationSpeedRef.current) / 100;

        this.last_vx = this.vx
        this.last_vy = this.vy
        this.prev_dx = dx;
        this.prev_dy = dy;
        this.lastTime = thisTime;
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.closePath();
      }

      randomise() {
        this.x = Math.random() * canvasRef.current.width;
        this.y = Math.random() * canvasRef.current.height;
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

    function randomParticlePositions() {
      particles.forEach((particle) => {
        particle.randomise();
      })
    }

    randomiseRef.current = () => randomParticlePositions();

    function animate() {
      timeVal = d.getTime();
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
                minValue: "1",
                maxValue: "100",
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
                title: "P Gain",
                valueRef: propGain,
                minValue: "0.0",
                maxValue: "100.0",
                type: "slider",
              },
              {
                title: "I Gain",
                valueRef: integralGain,
                minValue: "-100.0",
                maxValue: "100.0",
                type: "slider",
              },
              {
                title: "D Gain",
                valueRef: derivGain,
                minValue: "0.0",
                maxValue: "1000.0",
                type: "slider",
              },
              {
                type: 'button',
                buttonText: 'Randomise Positions',
                callback: () => { randomiseRef.current() }
              }
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
