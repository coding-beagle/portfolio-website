import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import {
  getCloseColour,
  randomFloatBetweenTwo,
  scaleColour,
} from "../utilities/usefulFunctions";
import {
  useCanvasScene,
  SceneCanvas,
  Particle,
  ParticleSystem,
  clearCanvas,
  randomPointOnCanvas,
} from "../utilities/engine";

export default function Leaves({ visibleUI }) {
  const { theme } = useTheme();
  const particleCountRef = useRef(50);
  const simulationSpeedRef = useRef(100);
  const themeRef = useRef(theme);
  const autumnalRef = useRef(0);
  const [, setRender] = useState(0);

  const canvasRef = useCanvasScene(({ canvas, ctx }) => {
    const gravity = 0.05;
    const maxLateralSpeed = 0.2;
    const maxSpeed = 0.01;

    const maxWindSpeed = 0.1;
    const minWindSpeed = -0.1;
    const maxWindTargetCount = 200;

    let windSpeed = 0;
    let windCount = 0;
    let windTargetCount = 0;
    let windTarget = randomFloatBetweenTwo(maxWindSpeed, minWindSpeed);

    const newWindTargetCount = () => {
      windCount = 0;
      windTargetCount = Math.round(randomFloatBetweenTwo(0, maxWindTargetCount));
      windTarget = randomFloatBetweenTwo(maxWindSpeed, minWindSpeed);
    };

    newWindTargetCount();

    // Three detuned sines, so no two leaves ever sway quite together.
    const getSway = (phase) =>
      Math.random() * Math.sin(phase / 80) +
      0.2 * Math.sin(phase / 30) +
      0.1 * Math.sin(phase / 13);

    class Leaf extends Particle {
      constructor(x, y) {
        super(x, y, {
          vx: 0.1 * (Math.random() * 2 - 1) + 0.2 * windSpeed,
          size: Math.random() * 10 + 3,
        });
        this.recolour();
        this.swayPhase = Math.round(Math.random() * 1000);
      }

      recolour() {
        this.normalColor = getCloseColour(
          themeRef.current.secondaryAccent,
          40,
          40,
          40
        );
        this.autumnalColour = getCloseColour(
          themeRef.current.tertiaryAccent,
          40,
          40,
          40
        );
      }

      reset() {
        this.recolour();

        // Half the leaves blow in from the side, half from the top or bottom.
        if (Math.random() > 0.5) {
          this.y = gravity > 0.0 ? 0 : canvas.height;
          this.x = Math.random() * canvas.width;
        } else {
          this.y = Math.random() * canvas.height;
          this.x = Math.random() > 0.5 ? 0 : canvas.width;
        }

        if (gravity > 0.0) this.vy *= -0.5;
        this.vx = 0.1 * (Math.random() * 2 - 1) + 0.2 * windSpeed;
      }

      update() {
        this.color = scaleColour(
          this.normalColor,
          this.autumnalColour,
          autumnalRef.current / 100
        );

        this.vy += gravity;
        this.vx += windSpeed * Math.random();
        this.swayPhase += 1;

        const speedScale = simulationSpeedRef.current / 100;
        this.x += (this.vx + getSway(this.swayPhase)) * speedScale;
        this.y += this.vy * speedScale;

        if (this.y + this.size > canvas.height && gravity > 0.0) this.reset();
        if (this.y + this.size < 0.0 && gravity < 0.0) this.reset();

        if (Math.abs(this.vy) > maxSpeed) {
          this.vy *= 0.9;
        } else {
          this.vy += randomFloatBetweenTwo(0.01, 0.5) * Math.sign(gravity);
        }

        // Bigger leaves catch more wind before they are dragged back.
        if (Math.abs(this.vx) > maxLateralSpeed * this.size) {
          this.vx *= 0.9;
        } else {
          this.vx +=
            randomFloatBetweenTwo(0.01, Math.abs(windSpeed)) *
            Math.sign(windTarget);
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
        return new Leaf(x, y);
      },
    }).fill();

    return {
      frame: () => {
        clearCanvas(ctx, canvas);

        // Ease the wind towards its target, then pick a new one periodically.
        windSpeed = windTarget * 0.001 + windSpeed * 0.999;
        windCount++;
        if (windCount > windTargetCount) newWindTargetCount();

        system.step(ctx);
      },
      cleanup: () => system.clear(),
    };
  }, []);

  useEffect(() => {
    themeRef.current = theme;
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
                minValue: "10",
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
                title: "Autumn Percentage:",
                valueRef: autumnalRef,
                minValue: "0",
                maxValue: "100.0",
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
