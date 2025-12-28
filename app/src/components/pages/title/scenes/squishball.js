import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import MouseTooltip, { IconGroup } from "../utilities/popovers";
import { ChangerGroup } from "../utilities/valueChangers";
import { getIndexFromBrushSize, safeNegativeModulo } from "../utilities/usefulFunctions";

export default function SquishBall({ visibleUI }) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const areaRef = useRef(0);
  const touchActiveRef = useRef(false);
  const particleCountRef = useRef(1);
  const simulationSpeedRef = useRef(100);
  const mouseShieldRadiusRef = useRef(300);

  const squishFactorRef = useRef(1);
  const desiredAreaRef = useRef(50);

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
    const windSpeed = 0.2;
    let animationFrameId;
    const maxFallSpeed = 13;
    const maxWindSpeed = (Math.random() - 0.5) * 10;

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

    const midPoint = (particle1, particle2) => {
      return ({ x: (particle1.x + particle2.x) / 2, y: (particle1.y + particle2.y) / 2 })
    }

    const vectorBetweenParticles = (particle1, particle2) => {
      return { x: particle1.x - particle2.x, y: particle1.y - particle2.y }
    }

    const vectorLength = (vector) => {
      return Math.sqrt(vector.x ** 2 + vector.y ** 2);
    }

    const getUnitVector = (vector) => {
      const length = vectorLength(vector);

      return { x: vector.x / length, y: vector.y / length }
    }

    const scaleVector = (vector, scale) => {
      return { x: vector.x * scale, y: vector.y * scale }
    }

    class Body {
      constructor(pointCount, distanceFromEachSegment, x, y) {
        this.points = [];
        // create random points around x, y
        for (let i = 0; i < pointCount; i++) {
          const angle = (i / pointCount) * Math.PI * 2;
          const rx = x + Math.cos(angle) * 10;
          const ry = y + Math.sin(angle) * 10;
          this.points.push(new Particle(rx, ry));
        }
        let index = 0;
        this.points.forEach((point) => {
          point.addDistanceConstraint((this.points[++index % this.points.length]), distanceFromEachSegment)
        })
      }

      calculateAreaOfSelf() {
        let area = 0;
        this.points.forEach((point, index) => {
          area += (point.x - this.points[(index + 1) % this.points.length].x) * (point.y + this.points[index % this.points.length].y) / 2
        })
        return Math.abs(area);
      }

      getNormalOfPoint(index) {
        const adjacent1 = this.points[safeNegativeModulo((index - 1), this.points.length)]
        const adjacent2 = this.points[(index + 1) % this.points.length]

        const distance = vectorBetweenParticles(adjacent1, adjacent2);
        const distanceRotated = { x: -distance.y, y: distance.x };

        return getUnitVector(distanceRotated);
      }

      update() {
        const squishFactor = squishFactorRef.current / 10000;
        const area = this.calculateAreaOfSelf();
        const areaDiff = desiredAreaRef.current * 1000 - area;
        const pressure = areaDiff * squishFactor;

        areaRef.current = area;

        // nudge points initially
        this.points.forEach((point, index) => {
          const normal = this.getNormalOfPoint(index);
          point.applyForce(normal.x * pressure, normal.y * pressure)
          // point.x += normal.x * pressure;
          // point.y += normal.y * pressure;

        })

        this.points.forEach((point) => {
          point.update()
        })
      }

      draw() {
        this.points.forEach((point) => {
          point.draw()
        })
      }
    }

    class TrackingDot {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.size = 10;
        this.color = theme.accent;
      }
      update(x, y) {
        this.x = x;
        this.y = y;
      }
      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.closePath();
      }
    }

    let draggingPoint = null; // so we can only drag one point

    class Particle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.oldX = x;
        this.oldY = y;
        this.vx = 0;
        this.vy = 0;
        this.a_x = 0;
        this.a_y = gravity;
        this.prev_mouse_pos = { x: mousePosRef.current.x, y: mousePosRef.current.y }
        this.size = 10;
        this.color = theme.secondary;

        this.distanceConstraints = [] // array of {particle: particle, distance: int}
      }

      addDistanceConstraint(particle, distance) {
        this.distanceConstraints.push({ particle: particle, distance: distance })
        particle.distanceConstraints.push({ particle: this, distance: distance })
      }

      applyForce(fx, fy) {
        this.a_x += fx;
        this.a_y += fy;
      }

      update() {
        const friction = 0.99;
        const bounce = 1;

        let vx = (this.x - this.oldX) * friction;
        let vy = (this.y - this.oldY) * friction;

        this.oldX = this.x;
        this.oldY = this.y;

        if (this.distanceConstraints.length > 0) {
          this.distanceConstraints.forEach((constraint) => {
            const target = constraint.particle;

            const dx = target.x - this.x;
            const dy = target.y - this.y;
            const currentDist = Math.sqrt(dx * dx + dy * dy) || 0.0001; // avoid division by zero

            const delta = (currentDist - constraint.distance) / currentDist;

            const offsetX = dx * 0.5 * delta;
            const offsetY = dy * 0.5 * delta;

            this.x += offsetX;
            this.y += offsetY;
            target.x -= offsetX;
            target.y -= offsetY;
          })

          // this.x = vxFromConstraints / this.distanceConstraints.length;
          // this.y = vyFromConstraints / this.distanceConstraints.length;
        }


        const dx = this.x - mousePosRef.current.x;
        const dy = this.y - mousePosRef.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < mouseShieldRadiusRef.current && (mouseClickRef.current || touchActiveRef.current) && (!draggingPoint || draggingPoint === this)) {
          draggingPoint = this;
          this.x = mousePosRef.current.x;
          this.y = mousePosRef.current.y;

          // this.oldX = this.x + (mousePosRef.current.x - this.prev_mouse_pos.x);
          // this.oldY = this.y + (mousePosRef.current.y - this.prev_mouse_pos.y);
          // this.prev_mouse_pos = mousePosRef.current;
        } else {
          if (draggingPoint === this) {
            draggingPoint = null;
          }
          this.a_y += gravity;
          const step = simulationSpeedRef.current / 100;

          this.x += vx + (this.a_x * step);
          this.y += vy + (this.a_y * step);

          if (this.x > canvas.width - this.size) {
            this.x = canvas.width - this.size;
            this.oldX = this.x + vx * bounce;
          } else if (this.x < this.size) {
            this.x = this.size;
            this.oldX = this.x + vx * bounce;
          }

          if (this.y > canvas.height - this.size) {
            this.y = canvas.height - this.size;
            this.oldY = this.y + vy * bounce;
          } else if (this.y < this.size) {
            this.y = this.size;
            this.oldY = this.y + vy * bounce;
          }
          this.a_x = 0.0
          this.a_y = 0.0
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

    // const trackingDot = new TrackingDot(0, 0);

    function initParticles() {
      particles = [];
      for (let i = 0; i < particleCountRef.current; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        particles.push(new Body(8, 100, x, y));
      }

      // particles[0].addDistanceConstraint(particles[1], 200);
      // particles[0].addDistanceConstraint(particles[2], 150);
      // particles[1].addDistanceConstraint(particles[2], 100);
      // particles.push(new ConstrainedSegment(300, { x: x, y: y }))

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

      // const mid = midPoint(particles[0], particles[1]);
      // trackingDot.update(mid.x, mid.y);
      // trackingDot.draw();

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
              // {
              //   title: "Particle Count:",
              //   valueRef: particleCountRef,
              //   minValue: "100",
              //   maxValue: "10000",
              //   type: "slider",
              // },
              {
                title: "Simulation Speed:",
                valueRef: simulationSpeedRef,
                minValue: "1",
                maxValue: "200.0",
                type: "slider",
              },
              {
                title: "Ball pressure",
                valueRef: desiredAreaRef,
                minValue: "1.0",
                maxValue: "100.0",
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
