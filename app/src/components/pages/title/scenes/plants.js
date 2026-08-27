import React, { useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import { getCloseColour } from "../utilities/usefulFunctions";
import {
  useCanvasScene,
  SceneCanvas,
  ParticleSystem,
  clearCanvas,
} from "../utilities/engine";

export default function Plants({ visibleUI }) {
  const { theme } = useTheme();
  const [restart, setRestart] = useState(false);
  const particleCountRef = useRef(25);
  const simulationSpeedRef = useRef(500);
  const simulationLengthRef = useRef(100);
  const [, setRender] = useState(0);

  const canvasRef = useCanvasScene(({ canvas, ctx }) => {
    /**
     * A plant is a chain of circles, each grown from the last: a little
     * narrower, a little higher, and a shade off the previous colour.
     */
    class Plant {
      constructor(x, y, size) {
        this.x = x;
        this.y = y;
        this.growthPoints = [{ x, y }];
        this.colours = [theme.secondaryAccent];
        this.sizes = [size];
      }

      update() {
        // Growth is stochastic rather than per-frame, so the slider reads as
        // a growth rate rather than a frame rate.
        if (Math.random() * 1000 > simulationSpeedRef.current) return;

        const lastPoint = this.growthPoints[this.growthPoints.length - 1];
        const lastSize = this.sizes[this.sizes.length - 1];

        this.growthPoints.push({
          x: lastPoint.x + lastSize * (Math.random() - 0.5) * 2,
          y: lastPoint.y - lastSize * Math.random() * 2 + 1,
        });
        this.sizes.push(lastSize * (0.95 + Math.random() * 0.05));
        this.colours.push(
          getCloseColour(this.colours[this.colours.length - 1], 20, 10, 10)
        );

        // Fully grown: restart the whole scene so a new crop comes up.
        if (this.growthPoints.length > simulationLengthRef.current) {
          setRestart((previous) => !previous);
        }
      }

      draw(context) {
        context.beginPath();
        context.arc(this.x, this.y, this.sizes[0], 0, Math.PI * 2);
        context.fillStyle = this.colours[0];
        context.fill();
        context.closePath();

        this.growthPoints.forEach((point, index) => {
          context.beginPath();
          context.arc(point.x, point.y, this.sizes[index], 0, Math.PI * 2);
          context.fillStyle = this.colours[index];
          context.fill();
          context.closePath();
        });
      }
    }

    const system = new ParticleSystem({
      countRef: particleCountRef,
      spawn: () => {
        // Scale the seed size with the viewport, and plant it on the floor.
        const size = Math.random() * 20 + (10 * canvas.width) / 1920;
        return new Plant(
          Math.random() * (canvas.width - size),
          Math.random() + (canvas.height - size),
          size
        );
      },
    }).fill();

    return {
      frame: () => {
        clearCanvas(ctx, canvas);
        system.step(ctx);
      },
      cleanup: () => system.clear(),
    };
  }, [restart]);

  return (
    <>
      <SceneCanvas ref={canvasRef} />

      {visibleUI && (
        <div style={{ zIndex: 3000 }}>
          <ChangerGroup
            valueArrays={[
              {
                title: "Plant Count:",
                valueRef: particleCountRef,
                minValue: "1",
                maxValue: "50",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Simulation Speed:",
                valueRef: simulationSpeedRef,
                minValue: "1",
                maxValue: "1000.0",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Simulation Length:",
                valueRef: simulationLengthRef,
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
