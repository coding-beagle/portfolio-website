import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { IconGroup } from "../utilities/popovers";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import { ElementCollisionHitbox } from "../utilities/usefulFunctions";
import {
  useCanvasScene,
  SceneCanvas,
  Particle,
  ParticleSystem,
  createPointerTracker,
  repelFromHitboxes,
  repelWithinRadius,
  clearCanvas,
  randomPointOnCanvas,
} from "../utilities/engine";

export default function Rain({ visibleUI }) {
  const { theme } = useTheme();

  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);

  const particleCountRef = useRef(2000);
  const simulationSpeedRef = useRef(100);
  const mouseShieldRadiusRef = useRef(100);
  const windspeedRef = useRef(Math.round((Math.random() - 0.5) * 100));
  const titleShieldRadiusRef = useRef(30);
  const recalculateRectRef = useRef(() => {});
  const visibleUIRef = useRef(visibleUI);
  const [, setRender] = useState(0);

  const canvasRef = useCanvasScene(({ canvas, ctx, onCleanup }) => {
    const gravity = 0.5;
    const maxFallSpeed = 13;
    const maxWindSpeed = 6;

    // The title acts as an umbrella — drops that reach it are flung aside.
    const hitboxes = [
      new ElementCollisionHitbox("title", 20, titleShieldRadiusRef),
    ];

    const recalculateRect = () =>
      hitboxes.forEach((hitbox) => hitbox.recalculate());
    recalculateRectRef.current = recalculateRect;
    recalculateRect();

    onCleanup(
      createPointerTracker(canvas, {
        posRef: mousePosRef,
        downRef: mouseClickRef,
        touchActiveRef: mouseClickRef,
      })
    );

    class Drop extends Particle {
      constructor(x, y) {
        super(x, y, { vy: Math.random() * 10 + 5, color: theme.secondary });
      }

      reset() {
        this.y = 0;
        this.x = Math.random() * canvas.width;
        this.vy = Math.random() * 10 + 5;
        this.vx = Math.random() * 2 - 1;
      }

      update() {
        if (visibleUIRef.current) repelFromHitboxes(this, hitboxes);

        if (mouseClickRef.current) {
          repelWithinRadius(
            this,
            mousePosRef.current,
            mouseShieldRadiusRef.current
          );
        }

        if (Math.abs(this.vx) < maxWindSpeed) {
          this.vx += windspeedRef.current / 50;
        }
        if (this.vy < maxFallSpeed) {
          this.vy += gravity;
        }

        this.integrate(simulationSpeedRef.current / 100);

        if (
          this.y > canvas.height ||
          this.x >= canvas.width + this.size * 3 ||
          this.x < 0 - this.size * 3
        ) {
          this.reset();
        }
      }
    }

    const system = new ParticleSystem({
      countRef: particleCountRef,
      spawn: () => {
        const { x, y } = randomPointOnCanvas(canvas);
        return new Drop(x, y);
      },
    }).fill();

    return {
      onResize: recalculateRect,
      frame: () => {
        clearCanvas(ctx, canvas);

        // The title is only an obstacle while it is actually on screen.
        hitboxes.forEach((hitbox) => {
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
                title: "Particle Count:",
                valueRef: particleCountRef,
                minValue: "100",
                maxValue: "10000",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Simulation Speed:",
                valueRef: simulationSpeedRef,
                minValue: "1",
                maxValue: "200.0",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Wind Speed:",
                valueRef: windspeedRef,
                minValue: "-100",
                maxValue: "100.0",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Click Umbrella Radius:",
                valueRef: mouseShieldRadiusRef,
                minValue: "10.0",
                maxValue: "300.0",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Title Umbrella Radius:",
                valueRef: titleShieldRadiusRef,
                minValue: "1.0",
                maxValue: "100.0",
                callback: recalculateRectRef.current,
                type: CHANGER_TYPE.SLIDER,
              },
            ]}
            rerenderSetter={setRender}
          />

          <IconGroup icons={[{ type: "MOUSE" }]} />
        </div>
      )}
    </>
  );
}
