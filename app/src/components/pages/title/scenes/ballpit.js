import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { IconGroup } from "../utilities/popovers";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import {
  ElementCollisionHitbox,
  getRandomColour,
  scaleValue,
} from "../utilities/usefulFunctions";
import {
  useCanvasScene,
  SceneCanvas,
  Particle,
  ParticleSystem,
  createPointerTracker,
  repelWithinRadius,
  clearCanvas,
} from "../utilities/engine";

export default function BallPit({ visibleUI }) {
  const { theme } = useTheme();
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const rightClickRef = useRef(false);
  const mouseShieldRadiusRef = useRef(100);
  const particleCountRef = useRef(0);
  const clearParticles = useRef(null);
  const visibleUIRef = useRef(visibleUI);

  // zero is straight down
  const gravityDirectionRef = useRef(0);

  const simulationSpeedRef = useRef(100);
  const brushRadiusRef = useRef(100);
  const titleShieldRadiusRef = useRef(0);
  const recalculateRectRef = useRef(() => {});
  const [, setRender] = useState(0);

  const canvasRef = useCanvasScene(({ canvas, ctx, onCleanup }) => {
    const gravity = 0.2;
    const numParticleRows = 30;
    const numParticleColumns = 30;
    const lifespan = 1000;

    // The title acts as a shelf — balls that reach it are bounced back down.
    const hitboxes = [
      new ElementCollisionHitbox("title", 0, titleShieldRadiusRef),
    ];

    const recalculateRect = () =>
      hitboxes.forEach((hitbox) => hitbox.recalculate());
    recalculateRectRef.current = recalculateRect;
    recalculateRect();

    let lastGravity, gravityHorizontal, gravityVertical;

    const recalcGravity = () => {
      const radians = gravityDirectionRef.current * (Math.PI / 180);
      gravityVertical = gravity * Math.cos(radians);
      gravityHorizontal = gravity * Math.sin(radians);
    };

    class Ball extends Particle {
      constructor(x, y) {
        const radians = gravityDirectionRef.current * (Math.PI / 180);
        super(x, y, {
          vx: 2 * gravity * Math.sin(radians),
          vy: 2 * gravity * Math.cos(radians),
          size: Math.random() * 10 + 5,
          color: getRandomColour(),
        });
        this.grid = { x: 0, y: 0 };
        this.timeAlive = 0;
      }

      /**
       * The first ball overlapping this one. The grid check keeps the scan
       * local — only balls within a cell of this one are measured properly.
       */
      colliding() {
        return system.particles.find((particle) => {
          if (particle === this) return false;
          if (
            Math.abs(particle.grid.x - this.grid.x) < 2 &&
            Math.abs(particle.grid.y - this.grid.y) < 2
          ) {
            const dx = (this.x - particle.x) ** 2;
            const dy = (this.y - particle.y) ** 2;
            return dx + dy < (particle.size + this.size) ** 2;
          }
          return false;
        });
      }

      update() {
        this.timeAlive += 1;

        hitboxes.forEach((hitbox) => {
          if (visibleUIRef.current && hitbox.inElement(this.x, this.y)) {
            this.vy *= -1;
          }
        });

        if (rightClickRef.current) {
          repelWithinRadius(
            this,
            mousePosRef.current,
            mouseShieldRadiusRef.current
          );
        }

        const collidingParticle = this.colliding();
        if (collidingParticle) {
          const angle = Math.atan2(
            this.y - collidingParticle.y,
            this.x - collidingParticle.x
          );
          this.vx += Math.cos(angle);
          this.vy += Math.sin(angle);
        }

        this.vx += gravityHorizontal;
        this.vy += gravityVertical;

        this.integrate(simulationSpeedRef.current / 100);
        this.bounce(canvas);

        this.vx *= 0.98;
        this.vy *= 0.98;

        this.updateGridFromPos();
      }

      updateGridFromPos() {
        this.grid = {
          x: scaleValue(this.x, 0, canvas.width, 0, numParticleColumns),
          y: scaleValue(this.y, 0, canvas.height, 0, numParticleRows),
        };
      }
    }

    // Balls are painted and cleared by hand rather than by `step`: the pool has
    // no target count to sync to, it grows under the brush and shrinks as balls
    // age out.
    const system = new ParticleSystem({ spawn: () => new Ball(0, 0) });

    /** Paint a burst of balls around a point, brush-style. */
    const spawnBrush = (position, count) => {
      for (let i = 0; i < count; i++) {
        system.add(
          new Ball(
            (Math.random() - 0.5) * brushRadiusRef.current + position.x,
            (Math.random() - 0.5) * brushRadiusRef.current + position.y
          )
        );
      }
    };

    onCleanup(
      createPointerTracker(canvas, {
        posRef: mousePosRef,
        downRef: mouseClickRef,
        rightDownRef: rightClickRef,
        blockContextMenu: true,
        // Swiping paints balls along the path of the finger.
        onTouchMove: (position) =>
          spawnBrush(position, Math.floor(Math.random() * 5) + 2),
      })
    );

    // Tilting the phone tips the whole pit.
    const handleOrientation = (event) => {
      gravityDirectionRef.current = event.gamma;
      recalcGravity();
    };
    window.addEventListener("deviceorientation", handleOrientation, true);
    onCleanup(() =>
      window.removeEventListener("deviceorientation", handleOrientation)
    );

    clearParticles.current = () => system.clear();

    return {
      onResize: recalculateRect,
      frame: () => {
        clearCanvas(ctx, canvas);

        if (lastGravity !== gravityDirectionRef.current) recalcGravity();
        lastGravity = gravityDirectionRef.current;

        particleCountRef.current = system.length;

        // The title only deflects balls while it is actually on screen.
        hitboxes.forEach((hitbox) => {
          if (visibleUIRef.current && !hitbox.elementObject) {
            hitbox.tryUpdateElement(hitbox.elementName);
          } else if (!visibleUIRef.current) {
            hitbox.elementObject = null;
          }
          hitbox.recalculate();
        });

        if (mouseClickRef.current) {
          spawnBrush(mousePosRef.current, Math.floor(Math.random() * 10));
        }

        system.prune((particle) => particle.timeAlive > lifespan);
        system.update();
        system.draw(ctx);
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
                title: "Particles:",
                valueRef: particleCountRef,
                minValue: "1",
                maxValue: "200.0",
                type: CHANGER_TYPE.DISPLAY,
              },
              {
                title: "Simulation Speed:",
                valueRef: simulationSpeedRef,
                minValue: "1",
                maxValue: "200.0",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Right Click Umbrella Radius:",
                valueRef: mouseShieldRadiusRef,
                minValue: "10.0",
                maxValue: "300.0",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Brush Radius:",
                valueRef: brushRadiusRef,
                minValue: "10.0",
                maxValue: "300.0",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Gravity Direction:",
                valueRef: gravityDirectionRef,
                minValue: "-180.0",
                maxValue: "180.0",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "",
                type: CHANGER_TYPE.BUTTON,
                callback: () => {
                  clearParticles.current();
                },
                buttonText: "Clear Screen",
              },
            ]}
            rerenderSetter={setRender}
          />

          <IconGroup
            icons={[{ type: "MOUSE" }, { type: "GYRO", text: "Tilt your phone!" }]}
          />
        </div>
      )}
    </>
  );
}
