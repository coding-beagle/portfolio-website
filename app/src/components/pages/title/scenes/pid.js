import React, { useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { IconGroup } from "../utilities/popovers";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import { clamp, randomFloatBetweenTwo } from "../utilities/usefulFunctions";
import {
  useCanvasScene,
  SceneCanvas,
  Particle,
  ParticleSystem,
  createPointerTracker,
  clearCanvas,
  randomPointOnCanvas,
} from "../utilities/engine";

export default function PID({ visibleUI }) {
  const { theme } = useTheme();
  const themeRef = useRef(theme);

  const particleCountRef = useRef(10);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const randomiseRef = useRef(null);

  const propGain = useRef(1);
  const integralGain = useRef(0);
  const derivGain = useRef(0);

  const simulationSpeedRef = useRef(100);
  const [, setRender] = useState(0);

  const canvasRef = useCanvasScene(({ canvas, ctx, onCleanup }) => {
    onCleanup(createPointerTracker(canvas, { posRef: mousePosRef }));

    const maxIntegral = 1000;
    // Close to the cursor, bleed the integral off so it does not wind up and
    // send the particle into orbit.
    const settleDistance = 50;

    class Follower extends Particle {
      constructor(x, y) {
        super(x, y, {
          vx: 0,
          vy: 0,
          size: Math.random() * 10 + 2.5,
          color: themeRef.current.secondary,
        });

        this.target_vx = 0;
        this.target_vy = 0;
        this.last_vx = 0;
        this.last_vy = 0;
        this.integral_dx = 0;
        this.integral_dy = 0;
        this.prev_dx = 0;
        this.prev_dy = 0;
        this.lastTime = Date.now();
      }

      update() {
        const thisTime = Date.now();
        const dt = thisTime - this.lastTime + 0.000001;

        const dx = this.x - mousePosRef.current.x;
        const dy = this.y - mousePosRef.current.y;

        this.integral_dx = clamp(
          this.integral_dx + dx * dt,
          -maxIntegral,
          maxIntegral
        );
        this.integral_dy = clamp(
          this.integral_dy + dy * dt,
          -maxIntegral,
          maxIntegral
        );

        if (Math.sqrt(dx * dx + dy * dy) < settleDistance) {
          this.integral_dx *= 0.95;
          this.integral_dy *= 0.95;
        }

        const dx_err = (dx - this.prev_dx) / dt;
        const dy_err = (dy - this.prev_dy) / dt;

        this.target_vx =
          (dx * propGain.current) / -100.0 +
          (this.integral_dx * integralGain.current) / 1000.0 +
          (dx_err * derivGain.current) / -10.0;
        this.target_vy =
          (dy * propGain.current) / -100.0 +
          (this.integral_dy * integralGain.current) / 1000.0 +
          (dy_err * derivGain.current) / -10.0;

        // Heavy low-pass on the output, so the gains read as a smooth response.
        this.vx = 0.98 * this.last_vx + 0.02 * this.target_vx + randomFloatBetweenTwo(-0.5 * simulationSpeedRef.current / 100.0, 0.5 * simulationSpeedRef.current / 100.0);
        this.vy = 0.98 * this.last_vy + 0.02 * this.target_vy + randomFloatBetweenTwo(-0.5 * simulationSpeedRef.current / 100.0, 0.5 * simulationSpeedRef.current / 100.0);

        this.integrate(simulationSpeedRef.current / 100);

        this.last_vx = this.vx;
        this.last_vy = this.vy;
        this.prev_dx = dx;
        this.prev_dy = dy;
        this.lastTime = thisTime;
      }

      randomise() {
        const { x, y } = randomPointOnCanvas(canvas);
        this.x = x;
        this.y = y;
      }
    }

    const system = new ParticleSystem({
      countRef: particleCountRef,
      spawn: () => {
        const { x, y } = randomPointOnCanvas(canvas);
        return new Follower(x, y);
      },
    }).fill();

    randomiseRef.current = () =>
      system.forEach((particle) => particle.randomise());

    return {
      frame: () => {
        clearCanvas(ctx, canvas);
        system.step(ctx);
      },
      cleanup: () => system.clear(),
    };
  }, [theme.secondary]);

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
                minValue: "1",
                maxValue: "100",
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
                title: "P Gain",
                valueRef: propGain,
                minValue: "0.0",
                maxValue: "100.0",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "I Gain",
                valueRef: integralGain,
                minValue: "-100.0",
                maxValue: "100.0",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "D Gain",
                valueRef: derivGain,
                minValue: "0.0",
                maxValue: "1000.0",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                type: "button",
                buttonText: "Randomise Positions",
                callback: () => randomiseRef.current(),
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
