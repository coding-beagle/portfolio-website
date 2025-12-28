import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import MouseTooltip, { IconGroup } from "../utilities/popovers";
import { ChangerGroup } from "../utilities/valueChangers";
import { ElementCollisionHitbox, getIndexFromBrushSize, safeNegativeModulo } from "../utilities/usefulFunctions";

export default function SquishBall({ visibleUI }) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const ballSizeRef = useRef(100);
  const areaRef = useRef(0);
  const touchActiveRef = useRef(false);
  const particleCountRef = useRef(1);
  const simulationSpeedRef = useRef(100);
  const mouseShieldRadiusRef = useRef(300);

  const squishFactorRef = useRef(1);
  const desiredAreaRef = useRef(50);

  const recalculateRectRef = useRef(() => { });
  const visibleUIRef = useRef(visibleUI);
  const [, setRender] = useState(0); // Dummy state to force re-render

  const titleHitbox = new ElementCollisionHitbox('title', 20);
  const collisionHitboxes = [titleHitbox];

  useEffect(() => {

    let particles = [];
    const gravity = 0.5;
    let animationFrameId;

    const recalculateRect = () => {
      collisionHitboxes.forEach((hitbox) => { hitbox.recalculate() })
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
        for (let i = 0; i < pointCount; i++) {
          const angle = (i / pointCount) * Math.PI * 2;
          const rx = x + Math.cos(angle) * 10;
          const ry = y + Math.sin(angle) * 10;
          this.points.push(new Particle(rx, ry));
        }
        this.constraints = [];
        this.changeDistanceConstraints(distanceFromEachSegment);
      }

      changeDistanceConstraints(distance) {
        this.constraints = [];
        for (let i = 0; i < this.points.length; i++) {
          this.constraints.push({
            p1: this.points[i],
            p2: this.points[(i + 1) % this.points.length],
            distance: distance
          });
        }
      }

      calculateAreaOfSelf() {
        let area = 0;
        this.points.forEach((point, index) => {
          area += (point.x - this.points[(index + 1) % this.points.length].x) *
            (point.y + this.points[index % this.points.length].y) / 2
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

      shuffleArray(array) {
        const shuffled = [...array]; // Create copy
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const temp = shuffled[i];
          shuffled[i] = shuffled[j];
          shuffled[j] = temp;
        }
        return shuffled;
      }

      solveConstraints() {
        const shuffled = this.shuffleArray(this.constraints);
        shuffled.forEach(constraint => {
          const { p1, p2, distance } = constraint;

          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const currentDist = Math.sqrt(dx * dx + dy * dy) || 0.0001;

          const delta = (currentDist - distance) / currentDist;

          const offsetX = dx * 0.5 * delta;
          const offsetY = dy * 0.5 * delta;

          p1.x += offsetX;
          p1.y += offsetY;
          p2.x -= offsetX;
          p2.y -= offsetY;
        });
      }

      update() {
        this.changeDistanceConstraints(ballSizeRef.current);
        const squishFactor = squishFactorRef.current / 10000;
        const area = this.calculateAreaOfSelf();
        const areaDiff = (desiredAreaRef.current * 100 * Math.sqrt(ballSizeRef.current)) - area;
        const pressure = areaDiff * squishFactor;

        areaRef.current = area;

        // Apply pressure forces ONCE
        this.points.forEach((point, index) => {
          const normal = this.getNormalOfPoint(index);
          point.applyForce(normal.x * pressure, normal.y * pressure)
        })

        // Solve constraints multiple times with shuffling
        for (let iter = 0; iter < 5; iter++) {
          this.solveConstraints();
        }

        // Update positions
        this.points.forEach((point) => {
          point.update()
        })
      }

      draw() {
        if (this.points.length < 3) return;

        ctx.beginPath();
        ctx.fillStyle = theme.secondary;

        // Start at the midpoint between last and first point
        const lastPoint = this.points[this.points.length - 1];
        const firstPoint = this.points[0];
        const startX = (lastPoint.x + firstPoint.x) / 2;
        const startY = (lastPoint.y + firstPoint.y) / 2;

        ctx.moveTo(startX, startY);

        // Draw curves through all points
        for (let i = 0; i < this.points.length; i++) {
          const current = this.points[i];
          const next = this.points[(i + 1) % this.points.length];

          const xc = (current.x + next.x) / 2;
          const yc = (current.y + next.y) / 2;

          ctx.quadraticCurveTo(current.x, current.y, xc, yc);
        }

        ctx.closePath();
        ctx.fill();
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

      checkCollisions() {
        if (!visibleUIRef.current) return
        collisionHitboxes.forEach(hitbox => {
          if (hitbox.inElement(this.x, this.y)) {
            const rect = hitbox.rect_padded;
            const bounce = 0.2; // Match your edge detection bounce

            // Calculate velocity for bounce direction
            const vx = (this.x - this.oldX);
            const vy = (this.y - this.oldY);

            // Find closest edge
            const distToLeft = this.x - rect.left;
            const distToRight = rect.right - this.x;
            const distToTop = this.y - rect.top;
            const distToBottom = rect.bottom - this.y;

            const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);

            // Push out from nearest edge and set oldX/oldY for bounce
            if (minDist === distToLeft) {
              this.x = rect.left - this.size;
              this.oldX = this.x + vx * bounce;
            } else if (minDist === distToRight) {
              this.x = rect.right + this.size;
              this.oldX = this.x + vx * bounce;
            } else if (minDist === distToTop) {
              this.y = rect.top - this.size;
              this.oldY = this.y + vy * bounce;
            } else {
              this.y = rect.bottom + this.size;
              this.oldY = this.y + vy * bounce;
            }
          }
        });
      }

      update() {
        const friction = 0.93;
        const bounce = 1;

        let vx = (this.x - this.oldX) * friction;
        let vy = (this.y - this.oldY) * friction;

        this.oldX = this.x;
        this.oldY = this.y;

        const dx = this.x - mousePosRef.current.x;
        const dy = this.y - mousePosRef.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < mouseShieldRadiusRef.current && (mouseClickRef.current || touchActiveRef.current) && (!draggingPoint || draggingPoint === this)) {
          draggingPoint = this;
          const dragStrength = 0.3; // Adjust this (0.1 = gentle, 0.5 = medium, 1.0 = instant)
          const targetX = mousePosRef.current.x;
          const targetY = mousePosRef.current.y;

          this.x += (targetX - this.x) * dragStrength;
          this.y += (targetY - this.y) * dragStrength;
        } else {
          if (draggingPoint === this) {
            draggingPoint = null;
          }
          this.a_y += gravity;
          const step = simulationSpeedRef.current / 100;

          this.x += vx + (this.a_x * step);
          this.y += vy + (this.a_y * step);

          this.checkCollisions();

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
        // ctx.beginPath();
        // ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        // ctx.fillStyle = this.color;
        // ctx.fill();
        // ctx.closePath();
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

      // handle updating dead elements
      collisionHitboxes.forEach((element) => {
        if (visibleUIRef.current && !element.elementObject) {
          element.tryUpdateElement(element.elementName);
        } else {
          element.elementObject = null;
        }

        if (element) {
          element.recalculate()
        }
      })

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
