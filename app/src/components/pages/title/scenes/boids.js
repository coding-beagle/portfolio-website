import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { IconGroup } from "../utilities/popovers";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import {
  useCanvasScene,
  SceneCanvas,
  Particle,
  ParticleSystem,
  createPointerTracker,
  clearCanvas,
  randomPointOnCanvas,
} from "../utilities/engine";

export default function Boids({ visibleUI }) {
  const { theme } = useTheme();
  const mousePosRef = useRef({ x: 0, y: 0 });
  const particleCountRef = useRef(10);
  const simulationSpeedRef = useRef(100);
  const primaryColorRef = useRef(theme.accent);
  const secondaryColorRef = useRef(theme.secondaryAccent);
  const attractionStrengthRef = useRef(100);
  const secondaryAttractionStrengthRef = useRef(100);
  const flockRef = useRef(null);
  const [, setRender] = useState(0);

  const canvasRef = useCanvasScene(({ canvas, ctx, onCleanup }) => {
    const speedLim = 5;

    onCleanup(
      createPointerTracker(canvas, { target: canvas, posRef: mousePosRef })
    );

    class Bird extends Particle {
      constructor(x, y, color) {
        super(x, y, { size: Math.random() * 8 + 6, color });
      }

      /** Bleed speed off once over the limit, rather than clipping it. */
      limitSpeed(damping) {
        if (Math.sqrt(this.vx ** 2 + this.vy ** 2) > speedLim) {
          this.vx *= damping;
          this.vy *= damping;
        }
      }

      /** Steer towards `target` at a strength the slider scales. */
      seek(target, strength) {
        this.vx += ((target.x - this.x) * strength) / 100000;
        this.vy += ((target.y - this.y) * strength) / 100000;
      }
    }

    /** The one bird that chases the cursor; everyone else chases it. */
    class LeadBird extends Bird {
      constructor(x, y) {
        super(x, y, primaryColorRef.current);
      }

      update() {
        this.seek(mousePosRef.current, attractionStrengthRef.current);
        this.limitSpeed(0.95);
        this.integrate(simulationSpeedRef.current / 100);
      }
    }

    class FlockBird extends Bird {
      constructor(x, y, leader, flock) {
        super(x, y, secondaryColorRef.current);
        this.vx = Math.random();
        this.vy = Math.random();
        this.leader = leader;
        this.flock = flock;
      }

      /** Offset to the first neighbour inside the separation radius. */
      nearestCrowding() {
        const separation = 50;
        for (const other of this.flock.particles) {
          if (other === this) continue;
          const dx = this.x - other.x;
          const dy = this.y - other.y;
          if (Math.sqrt(dx ** 2 + dy ** 2) < separation) return { dx, dy };
        }
        return null;
      }

      update() {
        this.seek(this.leader, secondaryAttractionStrengthRef.current);
        this.limitSpeed(0.99);

        // Split the difference between where it is heading and away from the
        // bird it is crowding — cohesion and separation in one nudge.
        const crowding = this.nearestCrowding();
        if (crowding) {
          const away = Math.atan2(crowding.dy, crowding.dx);
          const heading = Math.atan2(this.vy, this.vx);
          const blended = (away + heading) / 2;
          this.vx += Math.cos(blended) * 0.1;
          this.vy += Math.sin(blended) * 0.1;
        }

        this.integrate(simulationSpeedRef.current / 100);
      }
    }

    const start = randomPointOnCanvas(canvas);
    const leader = new LeadBird(start.x, start.y);

    const flock = new ParticleSystem({
      countRef: particleCountRef,
      spawn: () => {
        const { x, y } = randomPointOnCanvas(canvas);
        return new FlockBird(x, y, leader, flock);
      },
    });
    flock.fill();

    flockRef.current = { leader, flock };

    return {
      frame: () => {
        clearCanvas(ctx, canvas);

        leader.update();
        leader.draw(ctx);
        flock.step(ctx);
      },
      cleanup: () => {
        flock.clear();
        flockRef.current = null;
      },
    };
  }, []);

  // Recolour in place on a theme change, without restarting the flock.
  useEffect(() => {
    primaryColorRef.current = theme.accent;
    secondaryColorRef.current = theme.secondaryAccent;

    if (!flockRef.current) return;
    flockRef.current.leader.color = theme.accent;
    flockRef.current.flock.forEach((bird) => {
      bird.color = theme.secondaryAccent;
    });
  }, [theme]);

  return (
    <>
      <SceneCanvas ref={canvasRef} />

      {visibleUI && (
        <div style={{ zIndex: 3000 }}>
          <ChangerGroup
            valueArrays={[
              {
                title: "Bird Count:",
                valueRef: particleCountRef,
                minValue: "2",
                maxValue: "300",
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
                title: "Attraction to Mouse (Main Bird):",
                valueRef: attractionStrengthRef,
                minValue: "1",
                maxValue: "200",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Attraction to Main Bird (Other Birds):",
                valueRef: secondaryAttractionStrengthRef,
                minValue: "1",
                maxValue: "200",
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
