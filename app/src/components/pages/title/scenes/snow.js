import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import {
  useCanvasScene,
  SceneCanvas,
  Particle,
  ParticleSystem,
  clearCanvas,
  randomPointOnCanvas,
} from "../utilities/engine";

export default function Snow({ visibleUI }) {
  const { theme } = useTheme();
  const particleCountRef = useRef(200);
  const simulationSpeedRef = useRef(100);
  const colorRef = useRef(theme.accent);
  const systemRef = useRef(null);
  const [, setRender] = useState(0);

  const canvasRef = useCanvasScene(({ canvas, ctx }) => {
    // Most of the time it snows; occasionally it snows upwards.
    const gravity = Math.random() > 0.1 ? 0.05 : -0.05;
    const maxSpeed = 1;

    class SnowFlake extends Particle {
      constructor(x, y) {
        super(x, y, { color: colorRef.current });
      }

      reset() {
        this.x = Math.random() * canvas.width;
        this.vx = Math.random() * 2 - 1;
        if (gravity > 0.0) {
          this.y = 0;
          this.vy *= -0.5;
        } else {
          this.y = canvas.height;
        }
      }

      update() {
        this.vy += gravity;
        this.integrate(simulationSpeedRef.current / 100);

        if (this.y + this.size > canvas.height && gravity > 0.0) this.reset();
        if (this.y + this.size < 0.0 && gravity < 0.0) this.reset();

        if (Math.abs(this.vy) > maxSpeed) this.vy *= 0.97;
        if (Math.abs(this.vy) < maxSpeed) {
          this.vy += Math.random() * Math.sign(gravity);
        }

        if (this.x - this.size > canvas.width || this.x + this.size < 0) {
          this.reset();
        }
      }
    }

    const system = new ParticleSystem({
      countRef: particleCountRef,
      spawn: () => {
        const { x, y } = randomPointOnCanvas(canvas);
        return new SnowFlake(x, y);
      },
    }).fill();

    systemRef.current = system;

    return {
      frame: () => {
        clearCanvas(ctx, canvas);
        system.step(ctx);
      },
      cleanup: () => {
        system.clear();
        systemRef.current = null;
      },
    };
  }, []);

  // Recolour the falling snow when the theme changes, without restarting it.
  useEffect(() => {
    colorRef.current = theme.accent;
    if (systemRef.current) {
      systemRef.current.forEach((particle) => {
        particle.color = theme.accent;
      });
    }
  }, [theme]);

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
            ]}
            rerenderSetter={setRender}
          />
        </div>
      )}
    </>
  );
}
