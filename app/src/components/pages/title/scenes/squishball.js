import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { IconGroup } from "../utilities/popovers";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import {
  ElementCollisionHitbox,
  safeNegativeModulo,
} from "../utilities/usefulFunctions";
import {
  useCanvasScene,
  SceneCanvas,
  ParticleSystem,
  createPointerTracker,
  clearCanvas,
  randomPointOnCanvas,
} from "../utilities/engine";

export default function SquishBall({ visibleUI }) {
  const { theme } = useTheme();
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const ballSizeRef = useRef(100);
  const areaRef = useRef(0);
  const touchActiveRef = useRef(false);
  const particleCountRef = useRef(1);
  const simulationSpeedRef = useRef(100);
  const mouseShieldRadiusRef = useRef(100);
  const showControlPointsRef = useRef(false);

  const squishFactorRef = useRef(1);
  const desiredAreaRef = useRef(50);

  const recalculateRectRef = useRef(() => { });
  const visibleUIRef = useRef(visibleUI);
  const [, setRender] = useState(0); // Dummy state to force re-render

  const titleHitbox = new ElementCollisionHitbox('title', 20);
  const collisionHitboxes = [titleHitbox];

  const canvasRef = useCanvasScene(({ canvas, ctx, onCleanup }) => {
    const gravity = 0.5;

    const recalculateRect = () => {
      collisionHitboxes.forEach((hitbox) => { hitbox.recalculate() })
    };
    recalculateRectRef.current = recalculateRect;
    recalculateRect();

    onCleanup(
      createPointerTracker(canvas, {
        posRef: mousePosRef,
        downRef: mouseClickRef,
        touchActiveRef,
      })
    );

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

        this.points.forEach((point, index) => {
          const normal = this.getNormalOfPoint(index);
          point.applyForce(normal.x * pressure, normal.y * pressure)
        })

        for (let iter = 0; iter < 20; iter++) {
          this.solveConstraints();
        }

        // Update positions
        this.points.forEach((point) => {
          point.update()
        })
      }

      draw() {
        if (this.points.length < 3) return;

        if (showControlPointsRef.current) {
          for (let i = 0; i < this.points.length; i++) {
            // draw circle at each point
            const point = this.points[i];
            ctx.save();
            ctx.beginPath();
            ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = theme.accent;
            ctx.fill();
            ctx.closePath();
          }
        }

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

      checkCollisions(x, y) {
        let colliding = false
        if (!visibleUIRef.current) return colliding
        collisionHitboxes.forEach(hitbox => {
          if (hitbox.inElement(x, y)) {
            colliding = true; // latch
          }
        });
        return colliding;
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

        const inRange = distance < mouseShieldRadiusRef.current;
        const activeTouch = (mouseClickRef.current || touchActiveRef.current);
        const beingDragged = draggingPoint === this;

        // inRange + activeTouch + no draggingPoint = this point should become the draggingPoint
        if (inRange && activeTouch && !draggingPoint) {
          draggingPoint = this;
        }


        if (beingDragged) {
          const dragStrength = 0.6;
          const targetX = mousePosRef.current.x;
          const targetY = mousePosRef.current.y;

          this.x += (targetX - this.x) * dragStrength;
          this.y += (targetY - this.y) * dragStrength;
        }


        if (!activeTouch && draggingPoint === this) {
          draggingPoint = null;
        }
        this.a_y += gravity;
        const step = simulationSpeedRef.current / 100;


        const next_x = vx + (this.a_x * step);
        const next_y = vy + (this.a_y * step);

        if (!this.checkCollisions(this.x + next_x, this.y + next_y)) {
          this.x += next_x;
          this.y += next_y;
        }

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

      draw() {
        // ctx.beginPath();
        // ctx.arc(this.x, this.y, 50, 0, Math.PI * 2);
        // ctx.fillStyle = "white";
        // ctx.fill();
        // ctx.closePath();
      }
    }

    const system = new ParticleSystem({
      countRef: particleCountRef,
      spawn: () => {
        const { x, y } = randomPointOnCanvas(canvas);
        return new Body(8, 100, x, y);
      },
    }).fill();

    return {
      onResize: recalculateRect,
      frame: () => {
        clearCanvas(ctx, canvas);

        // The title only pushes back while it is actually on screen.
        collisionHitboxes.forEach((hitbox) => {
          if (visibleUIRef.current && !hitbox.elementObject) {
            hitbox.tryUpdateElement(hitbox.elementName);
          } else if (!visibleUIRef.current) {
            hitbox.elementObject = null;
          }
          hitbox.recalculate();
        });

        system.step(ctx);
      },
      cleanup: () => system.clear(),
    };
  }, [theme.secondary]);

  useEffect(() => {
    visibleUIRef.current = visibleUI;
  }, [visibleUI]);

  return (
    <>
      <SceneCanvas ref={canvasRef} />
      {visibleUI && (
        <div style={{ zIndex: 3000 }}>
          <ChangerGroup
            valueArrays={[
              {
                title: "Simulation Speed:",
                valueRef: simulationSpeedRef,
                minValue: "1",
                maxValue: "200.0",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Ball pressure",
                valueRef: desiredAreaRef,
                minValue: "1.0",
                maxValue: "100.0",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                type: CHANGER_TYPE.BUTTON,
                title: "",
                buttonText: showControlPointsRef.current
                  ? "Hide control points"
                  : "Show control points",
                callback: () => {
                  showControlPointsRef.current = !showControlPointsRef.current;
                  setRender((r) => r + 1);
                },
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
