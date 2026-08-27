import React, { useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import { ElementCollisionHitbox } from "../utilities/usefulFunctions";
import {
  useCanvasScene,
  SceneCanvas,
  Particle,
  ParticleSystem,
  createPointerTracker,
  clearCanvas,
  randomPointOnCanvas,
} from "../utilities/engine";

export default function WindTunnel({ visibleUI }) {
  const { theme } = useTheme();
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const particleCountRef = useRef(2000);
  const simulationSpeedRef = useRef(100);
  const mouseShieldRadiusRef = useRef(100);
  const [, setRender] = useState(0);

  const canvasRef = useCanvasScene(({ canvas, ctx, onCleanup }) => {
    const windSpeed = 0.2;
    const maxWindSpeed = 5;

    // The page furniture deflects the airflow; wide horizontally, tight
    // vertically, so the stream parts around it rather than over it.
    const hitboxes = [
      new ElementCollisionHitbox("title", 0, null, 10, 10, 200, 200),
      new ElementCollisionHitbox("linkIcons", 0, null, 10, 10, 120, 120),
    ];

    const recalculateRect = () => hitboxes.forEach((box) => box.recalculate());
    recalculateRect();

    onCleanup(
      createPointerTracker(canvas, {
        target: canvas,
        posRef: mousePosRef,
        downRef: mouseClickRef,
      })
    );

    class Mote extends Particle {
      constructor(x, y) {
        super(x, y, { vy: 0, size: 1, color: theme.accent });
      }

      update(densityMap) {
        const dx = this.x - mousePosRef.current.x;
        const dy = this.y - mousePosRef.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Deflect around the page furniture, and settle back down outside it.
        hitboxes.forEach((hitbox, index) => {
          if (!hitbox.elementObject) return;

          if (hitbox.inElement(this.x, this.y)) {
            const angle = Math.atan2(
              this.y - hitbox.center.y,
              this.x - hitbox.center.x
            );
            if (index === 0) {
              this.vx = this.vx * 0.99 + Math.cos(angle) * 0.2;
              this.vy = this.vy + Math.sin(angle) * 0.55;
            } else {
              this.vx = this.vx + Math.cos(angle) * 0.2;
              this.vy = this.vy + Math.sin(angle) * 0.6 + Math.random();
            }
          } else {
            this.vy *= 0.9;
          }
        });

        if (distance < mouseShieldRadiusRef.current && mouseClickRef.current) {
          const angle = Math.atan2(dy, dx);
          this.vx = this.vx + Math.cos(angle) * 0.3;
          this.vy = this.vy + Math.sin(angle) * 0.55;
        } else if (this.vx < maxWindSpeed) {
          this.vx += windSpeed;
        }

        // Drift towards thinner air so the stream spreads out.
        const density = densityMap[Math.floor(this.y / 10)]?.[
          Math.floor(this.x / 10)
        ] || 0;
        if (density < 1) {
          const angle = Math.atan2(dy, dx);
          this.vx += Math.cos(angle) * 0.05;
          this.vy += Math.sin(angle) * 0.05;
        }

        const speedScale = simulationSpeedRef.current / 100;
        this.x += this.vx * speedScale;
        if (this.vx > maxWindSpeed) this.vx *= 0.99;
        this.y += (this.vy + Math.random() - 0.5) * speedScale;

        // Off the right-hand edge, back in on the left.
        if (this.x >= canvas.width + this.size * 3) {
          this.x = 0;
          this.y = Math.random() * canvas.height;
          this.vy = 0;
          this.vx = Math.random() * maxWindSpeed - maxWindSpeed / 2;
        }
      }
    }

    const system = new ParticleSystem({
      countRef: particleCountRef,
      spawn: () => {
        const { x, y } = randomPointOnCanvas(canvas);
        return new Mote(x, y);
      },
    }).fill();

    const calculateDensityMap = () => {
      const densityMap = [];
      const gridSize = 30;

      system.forEach((particle) => {
        const gridX = Math.floor(particle.x / gridSize);
        const gridY = Math.floor(particle.y / gridSize);

        if (!densityMap[gridY]) densityMap[gridY] = [];
        if (!densityMap[gridY][gridX]) densityMap[gridY][gridX] = 0;

        densityMap[gridY][gridX]++;
      });

      return densityMap;
    };

    return {
      onResize: recalculateRect,
      frame: () => {
        clearCanvas(ctx, canvas);
        system.sync();
        system.update(calculateDensityMap());
        system.draw(ctx);
      },
      cleanup: () => system.clear(),
    };
  }, []);

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
                minValue: "10",
                maxValue: "20000",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Simulation Speed:",
                valueRef: simulationSpeedRef,
                minValue: "1.0",
                maxValue: "200.0",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Click Shield Radius:",
                valueRef: mouseShieldRadiusRef,
                minValue: "10.0",
                maxValue: "300.0",
                type: CHANGER_TYPE.SLIDER,
              },
            ]}
            rerenderSetter={setRender}
          />
        </div>
      )}
    </>
  );
}
