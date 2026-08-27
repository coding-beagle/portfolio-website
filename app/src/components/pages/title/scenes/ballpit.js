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
  createPointerTracker,
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
    let particles = [];
    const gravity = 0.2;

    const titleHitbox = new ElementCollisionHitbox(
      "title",
      0,
      titleShieldRadiusRef
    );

    const recalculateRect = () => titleHitbox.recalculate();
    recalculateRectRef.current = recalculateRect;

    let lastGravity, gravity_horizontal, gravity_vertical;

    const recalcGravity = () => {
      const radians = gravityDirectionRef.current * (Math.PI / 180);
      gravity_vertical = gravity * Math.cos(radians);
      gravity_horizontal = gravity * Math.sin(radians);
    };

    /** Paint a burst of balls around a point, brush-style. */
    const spawnBrush = (position, count) => {
      for (let i = 0; i < count; i++) {
        particles.push(
          new Particle(
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

    recalculateRect();

    const num_particle_rows = 30;
    const num_particle_columns = 30;
    const lifespan = 1000;


    class Particle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 2 * gravity * Math.sin(gravityDirectionRef.current * (Math.PI / 180));;
        this.vy = 2 * gravity * Math.cos(gravityDirectionRef.current * (Math.PI / 180));;
        this.size = Math.random() * 10 + 5;
        this.color = getRandomColour();
        this.grid = { x: 0, y: 0 };
        this.timeAlive = 0;
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
              return true;
            }
          }
          return false;
        });
      }

      update() {
        this.timeAlive += 1;
        if (this.timeAlive > lifespan) {
          const me = particles.findIndex((particle) => {
            return particle === this;
          });
          if (me !== -1) {
            particles.splice(me, 1);
          }
        }
        if (visibleUIRef.current && titleHitbox.inElement(this.x, this.y)) {
          this.vy *= -1;
        }

        const dx = this.x - mousePosRef.current.x;
        const dy = this.y - mousePosRef.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < mouseShieldRadiusRef.current && rightClickRef.current) {
          const angle = Math.atan2(dy, dx);
          this.vx = Math.cos(angle) * 5;
          this.vy = Math.sin(angle) * 5;
        }

        const colliding_particle = this.colliding();
        if (colliding_particle) {
          const dx = this.x - colliding_particle.x;
          const dy = this.y - colliding_particle.y;

          const angle2 = Math.atan2(dy, dx);

          this.vx += Math.cos(angle2);
          this.vy += Math.sin(angle2);
        }

        // this.vx *= 0.9;

        this.vx += gravity_horizontal;
        this.vy += gravity_vertical;

        let next_x = this.x + (this.vx * simulationSpeedRef.current) / 100;
        let next_y = this.y + (this.vy * simulationSpeedRef.current) / 100;

        if (next_x >= canvas.width - this.size) {
          next_x = canvas.width - this.size;
          this.vx *= -1;
        }

        if (next_x <= 0 + this.size) {
          next_x = this.size;
          this.vx *= -1;
        }

        if (next_y >= canvas.height - this.size) {
          this.vy *= -1;
          next_y = canvas.height - this.size;
        }

        if (next_y - this.size <= 0) {
          this.vy *= -1;
          next_y = 0 + this.size;
        }


        this.x = next_x;
        this.y = next_y;
        this.vx *= 0.98;
        this.vy *= 0.98;

        // this.x += (this.vx * simulationSpeedRef.current) / 100;
        // this.y += (this.vy * simulationSpeedRef.current) / 100;

        this.update_grid_from_pos();
      }

      update_grid_from_pos() {
        this.grid = {
          x: scaleValue(this.x, 0, canvasRef.current.width, 0, num_particle_columns),
          y: scaleValue(this.y, 0, canvasRef.current.height, 0, num_particle_rows),
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

    return {
      onResize: recalculateRect,
      frame: () => {
        clearCanvas(ctx, canvas);

        if (lastGravity !== gravityDirectionRef.current) recalcGravity();
        lastGravity = gravityDirectionRef.current;

        particleCountRef.current = particles.length;

        // The title only deflects balls while it is actually on screen.
        if (visibleUIRef.current && !titleHitbox.elementObject) {
          titleHitbox.tryUpdateElement(titleHitbox.elementName);
        } else if (!visibleUIRef.current) {
          titleHitbox.elementObject = null;
        }
        recalculateRect();

        if (mouseClickRef.current) {
          spawnBrush(mousePosRef.current, Math.floor(Math.random() * 10));
        }

        particles.forEach((particle) => {
          particle.update();
          particle.draw();
        });
      },
      cleanup: () => {
        particles = [];
      },
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

          <IconGroup icons={
            [{ type: 'MOUSE' },
            { type: 'GYRO', text: "Tilt your phone!" }
            ]
          } />
        </div>
      )}
    </>
  );
}
