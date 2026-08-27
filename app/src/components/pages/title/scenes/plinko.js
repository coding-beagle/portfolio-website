import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import { drawCircleAt, getRandomColour } from "../utilities/usefulFunctions";
import {
  useCanvasScene,
  SceneCanvas,
  Particle,
  ParticleSystem,
  clearCanvas,
  randomPointOnCanvas,
} from "../utilities/engine";

const GRID_TYPES = { GRID: 0, TRIANGLE: 1 };

export default function Plinko({ visibleUI }) {
  const { theme } = useTheme();
  const particleCountRef = useRef(100);
  const gridSpacingX = useRef(100);
  const gridSpacingY = useRef(100);
  const bouncynessRef = useRef(100);
  const gridTypeRef = useRef(GRID_TYPES.GRID);
  const colorRef = useRef(theme.accent);
  const simulationSpeedRef = useRef(100);
  const [, setRender] = useState(0);

  const canvasRef = useCanvasScene(({ canvas, ctx }) => {
    const gravity = 0.05;
    const pegRadius = 5;

    /**
     * The field of pegs. It is rebuilt every frame because the spacing and the
     * layout are both live sliders — cheap enough at these counts, and it keeps
     * the peg positions and what is drawn from ever disagreeing.
     */
    class PegField {
      constructor() {
        this.pegs = [];
      }

      /** The peg a ball of `size` at (x, y) is currently overlapping, if any. */
      pegAt(x, y, size) {
        return this.pegs.find(
          ([pegX, pegY]) =>
            (x - pegX) ** 2 + (y - pegY) ** 2 < (pegRadius + size) ** 2
        );
      }

      addPeg(x, y) {
        this.pegs.push([x, y]);
        drawCircleAt(ctx, x, y, pegRadius, colorRef.current);
      }

      draw() {
        this.pegs = [];

        const midX = canvas.width / 2;
        const midY = canvas.height / 2;
        let offsetRow = false;

        if (gridTypeRef.current === GRID_TYPES.TRIANGLE) {
          // A widening wedge: each row is one spacing broader than the last.
          for (let y = 0; y < canvas.height; y += gridSpacingY.current) {
            offsetRow = !offsetRow;
            for (let x = 0; x < y; x += gridSpacingX.current) {
              const xVal = offsetRow ? x + gridSpacingX.current / 2 : x;
              this.addPeg(midX + xVal, y);
              this.addPeg(midX - xVal, y);
            }
          }
          return;
        }

        // Mirrored about both axes, so the lattice stays centred as it grows.
        for (let y = 0; y < midY; y += gridSpacingY.current) {
          offsetRow = !offsetRow;
          for (let x = 0; x < midX; x += gridSpacingX.current) {
            const xVal = offsetRow ? x + gridSpacingX.current / 2 : x;
            this.addPeg(midX + xVal, midY + y);
            this.addPeg(midX - xVal, midY + y);
            this.addPeg(midX + xVal, midY - y);
            this.addPeg(midX - xVal, midY - y);
          }
        }
      }
    }

    const pegField = new PegField();

    class Ball extends Particle {
      constructor(x, y) {
        super(x, y, {
          vx: Math.random() * 2 - 4,
          vy: Math.random() * 10 + 5,
          size: Math.random() * 10 + 5,
          color: getRandomColour(),
        });
      }

      reset() {
        this.vx = Math.random() * 4 - 2;

        // The wedge is fed from a narrow spout above its apex; the lattice
        // takes drops from anywhere along the top.
        if (gridTypeRef.current === GRID_TYPES.TRIANGLE) {
          this.x =
            canvas.width / 2 +
            ((Math.random() - 0.5) * canvas.width) / 10.0;
        } else {
          this.x = Math.random() * canvas.width;
        }

        if (gravity > 0.0) {
          this.y = 0;
          this.vy = 0.5;
        } else {
          this.y = canvas.height;
        }
      }

      update() {
        this.vy += gravity;

        const peg = pegField.pegAt(this.x, this.y, this.size);
        if (peg) {
          const angle = Math.atan2(this.y - peg[1], this.x - peg[0]);
          this.vx =
            (Math.cos(angle) * bouncynessRef.current) / 100 + this.vx / 2;
          this.vy = (Math.sin(angle) * bouncynessRef.current) / 100;
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
        return new Ball(x, y);
      },
    }).fill();

    return {
      frame: () => {
        clearCanvas(ctx, canvas);
        pegField.draw();
        system.step(ctx);
      },
      cleanup: () => system.clear(),
    };
  }, []);

  useEffect(() => {
    colorRef.current = theme.accent;
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
                maxValue: "3000",
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
                title: "Ball Bounce Factor:",
                valueRef: bouncynessRef,
                minValue: "100",
                maxValue: "300",
                type: CHANGER_TYPE.SLIDER,
              },
              [
                {
                  title: "Grid Type:",
                  type: CHANGER_TYPE.BUTTON,
                  buttonText: "Classic",
                  enabled: gridTypeRef.current === GRID_TYPES.GRID,
                  callback: () => {
                    gridTypeRef.current = GRID_TYPES.GRID;
                  },
                },
                {
                  type: CHANGER_TYPE.BUTTON,
                  buttonText: "Triangle",
                  enabled: gridTypeRef.current === GRID_TYPES.TRIANGLE,
                  callback: () => {
                    gridTypeRef.current = GRID_TYPES.TRIANGLE;
                  },
                },
              ],
              {
                title: "Grid Spacing X:",
                valueRef: gridSpacingX,
                minValue: "20",
                maxValue: "200",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Grid Spacing Y:",
                valueRef: gridSpacingY,
                minValue: "20",
                maxValue: "200",
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
