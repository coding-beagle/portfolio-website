import React, { useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import { IconGroup } from "../utilities/popovers";
import { scaleColour } from "../utilities/usefulFunctions";
import {
  useCanvasScene,
  SceneCanvas,
  Particle,
  ParticleSystem,
  createPointerTracker,
  clearCanvas,
} from "../utilities/engine";

export default function Fire({ visibleUI }) {
  const { theme } = useTheme();
  const mousePosRef = useRef({ x: 0, y: 0 });
  const simulationSpeedRef = useRef(100);
  const fireSizeRef = useRef(25);
  const [, setRender] = useState(0);

  const canvasRef = useCanvasScene(({ canvas, ctx, onCleanup }) => {
    onCleanup(createPointerTracker(canvas, { posRef: mousePosRef }));

    const speedLim = 2;
    const maxTemperature = 10;

    /** Cold embers sit at the tertiary accent, the hottest at the accent. */
    const colourForTemperature = (temperature) =>
      scaleColour(
        theme.tertiaryAccent,
        theme.accent,
        temperature / maxTemperature
      );

    /**
     * Two rules make the flame: particles crowded together run hot, and hot
     * particles rise. Everything else is drift back towards the cursor.
     */
    class Ember extends Particle {
      constructor(x, y, flame) {
        super(x, y, { vx: 0, vy: 0, size: 5 });
        this.temperature = 0;
        this.flame = flame;
        this.gravity = 0.01;
        this.heatDissipationRate = 2;
      }

      /** Offset to the first neighbour close enough to jostle. */
      nearestNeighbour() {
        const distance = 20;
        for (const other of this.flame.particles) {
          if (other === this) continue;
          const dx = this.x - other.x;
          const dy = this.y - other.y;
          if (Math.sqrt(dx ** 2 + dy ** 2) < distance) return { dx, dy };
        }
        return null;
      }

      /** Temperature is simply how crowded this ember is. */
      calculateHeat() {
        const distanceThreshold = 20;
        let nearbyCount = 0;

        for (const other of this.flame.particles) {
          if (other === this) continue;
          const dx = this.x - other.x;
          const dy = this.y - other.y;
          if (Math.sqrt(dx ** 2 + dy ** 2) < distanceThreshold) nearbyCount++;
        }

        this.temperature = Math.min(nearbyCount, maxTemperature);
      }

      update() {
        this.calculateHeat();

        const source = mousePosRef.current;
        this.vx += (source.x - this.x) / 200;
        // Hotter embers rise faster; gravity pulls the cool ones back down.
        this.vy += (source.y - this.y) / 200 - this.temperature / 80;
        this.vy += this.gravity;

        this.temperature = Math.max(
          this.temperature - this.heatDissipationRate,
          0
        );

        if (Math.sqrt(this.vx ** 2 + this.vy ** 2) > speedLim) {
          this.vx *= 0.9;
          this.vy *= 0.9;
        }

        const neighbour = this.nearestNeighbour();
        if (neighbour) {
          const away = Math.atan2(neighbour.dy, neighbour.dx);
          const heading = Math.atan2(this.vy, this.vx);
          const blended = (away + heading) / 2;
          this.vx += Math.cos(blended);
          this.vy += Math.sin(blended);
        }

        this.integrate(simulationSpeedRef.current / 100);
      }

      draw(context) {
        context.beginPath();
        context.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        context.fillStyle = colourForTemperature(this.temperature);
        context.fill();
        context.closePath();
      }
    }

    const flame = new ParticleSystem({
      countRef: fireSizeRef,
      spawn: () =>
        new Ember(mousePosRef.current.x, mousePosRef.current.y, flame),
    });

    return {
      frame: () => {
        clearCanvas(ctx, canvas);
        flame.step(ctx);
      },
      cleanup: () => flame.clear(),
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
                title: "Fire Size:",
                valueRef: fireSizeRef,
                minValue: "1",
                maxValue: "800",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Simulation Speed:",
                valueRef: simulationSpeedRef,
                minValue: "1",
                maxValue: "200.0",
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
