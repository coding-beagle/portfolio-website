import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { IconGroup } from "../utilities/popovers";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import { clamp, scaleColour } from "../utilities/usefulFunctions";
import {
  useCanvasScene,
  SceneCanvas,
  createPointerTracker,
  clearCanvas,
} from "../utilities/engine";

/**
 * Lissajous figures — the curves you get by driving x and y with two sine
 * waves at different frequencies. One figure fills the screen by default, with
 * its two frequencies on sliders; the table mode lays the family out as a grid
 * instead, where column i drives x at (i+1) Hz and row j drives y at (j+1) Hz,
 * so the diagonal is the degenerate 1:1, 2:2, ... ellipses.
 *
 * The phase offset between the two waves is what makes a figure move: at δ=0
 * a 1:1 is a diagonal line, at δ=π/2 it is a circle, and everything in between
 * is an ellipse. Each figure carries its own δ and drifts it, so the table is
 * never quite in step with itself.
 */

/**
 * Samples needed to draw a curve without visible faceting. Higher frequencies
 * fold the curve more times through the same box, so they need more.
 */
const sampleCount = (xFreq, yFreq) =>
  clamp(64 * Math.max(xFreq, yFreq), 128, 420);

export default function Lissajous({ visibleUI }) {
  const { theme } = useTheme();
  const themeRef = useRef(theme);

  // Parked off-canvas so nothing is excited until the pointer actually moves —
  // otherwise the top-left figure lights up on load.
  const mousePosRef = useRef({ x: -1e6, y: -1e6 });
  const mouseDownRef = useRef(false);
  const touchActiveRef = useRef(false);

  const gridSizeRef = useRef(4);
  const phaseSpeedRef = useRef(100);
  const traceSpeedRef = useRef(100);
  const trailLengthRef = useRef(30);
  const lineWidthRef = useRef(3);
  const bloomRef = useRef(14);
  const cursorRadiusRef = useRef(140);
  const xFreqRef = useRef(3);
  const yFreqRef = useRef(2);
  const singleRef = useRef(true);
  const [, setRender] = useState(0);

  const canvasRef = useCanvasScene(({ canvas, ctx, onCleanup }) => {
    const maxGrid = 6;

    onCleanup(
      createPointerTracker(canvas, {
        posRef: mousePosRef,
        downRef: mouseDownRef,
        touchActiveRef,
      })
    );

    /** One curve: its two frequencies, its phase, and where it sits. */
    class Figure {
      constructor(xFreq, yFreq, mix) {
        this.xFreq = xFreq;
        this.yFreq = yFreq;
        // Where this figure sits in the colour sweep across the table, kept as
        // a fraction rather than a colour so a theme change lands on it too.
        this.mix = mix;
        // A random starting phase per figure, so the table opens up already
        // spread across the family rather than every cell showing a line.
        this.phase = Math.random() * Math.PI * 2;
        this.head = Math.random();
        this.excitation = 0;
        this.cx = 0;
        this.cy = 0;
        this.radius = 1;
      }

      place(cx, cy, radius) {
        this.cx = cx;
        this.cy = cy;
        this.radius = radius;
      }

      /** The curve point at parameter `t`, in canvas coordinates. */
      pointAt(t) {
        return {
          x: this.cx + this.radius * Math.sin(this.xFreq * t + this.phase),
          y: this.cy + this.radius * Math.sin(this.yFreq * t),
        };
      }

      update() {
        const dx = mousePosRef.current.x - this.cx;
        const dy = mousePosRef.current.y - this.cy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const reach = cursorRadiusRef.current + this.radius;

        // Held down, the cursor's pull is stronger and reaches no further —
        // pressing on a figure winds it up rather than grabbing its neighbours.
        const pressed = mouseDownRef.current || touchActiveRef.current;
        const target =
          distance < reach
            ? clamp((1 - distance / reach) * (pressed ? 2.0 : 1.0), 0, 1)
            : 0;
        this.excitation += (target - this.excitation) * 0.08;

        const excited = 1 + 4 * this.excitation;
        this.phase += 0.004 * (phaseSpeedRef.current / 100) * excited;
        this.phase %= Math.PI * 2;

        const traced = 1 + 2 * this.excitation;
        this.head =
          (this.head + 0.0025 * (traceSpeedRef.current / 100) * traced) % 1;
      }

      draw(context) {
        const samples = sampleCount(this.xFreq, this.yFreq);
        const step = (Math.PI * 2) / samples;
        const colour = scaleColour(
          scaleColour(
            themeRef.current.secondary,
            themeRef.current.tertiaryAccent,
            this.mix
          ),
          themeRef.current.quarternaryAccent,
          this.excitation
        );
        const width = lineWidthRef.current * (1 + this.excitation);

        context.save();
        context.lineJoin = "round";
        context.lineCap = "round";
        context.strokeStyle = colour;

        // The curve itself, held back so the tracer reads as the bright part.
        context.globalAlpha = 0.22 + 0.28 * this.excitation;
        context.lineWidth = width;
        context.beginPath();
        for (let i = 0; i <= samples; i++) {
          const { x, y } = this.pointAt(i * step);
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();

        // The tracer: the stretch of curve the point has just come through.
        const trail = Math.max(
          2,
          Math.round((trailLengthRef.current / 100) * samples)
        );
        const headIndex = this.head * samples;

        context.globalAlpha = 1;
        context.shadowColor = colour;
        context.shadowBlur = bloomRef.current * (0.5 + this.excitation);
        context.lineWidth = width;
        context.beginPath();
        for (let i = trail; i >= 0; i--) {
          const { x, y } = this.pointAt((headIndex - i) * step);
          if (i === trail) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();

        const head = this.pointAt(headIndex * step);
        context.fillStyle = colour;
        context.beginPath();
        context.arc(head.x, head.y, width * 1.4, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }
    }

    /**
     * How far through the table a cell sits, so the grid reads as one colour
     * sweep rather than as a set of unrelated curves.
     */
    const mixFor = (i, j, size) =>
      size < 2 ? 0.5 : (i + j) / (2 * (size - 1));

    let figures = [];
    let builtSize = 0;
    let builtSingle = null;

    /** Rebuild the figure set when the grid size or the mode changes. */
    const build = () => {
      const single = singleRef.current;
      const size = clamp(Math.round(gridSizeRef.current), 1, maxGrid);

      figures = [];
      if (single) {
        figures.push(new Figure(xFreqRef.current, yFreqRef.current, 0));
      } else {
        for (let j = 0; j < size; j++) {
          for (let i = 0; i < size; i++) {
            figures.push(new Figure(i + 1, j + 1, mixFor(i, j, size)));
          }
        }
      }

      builtSize = size;
      builtSingle = single;
      layout();
    };

    /** Fit the figures to the canvas — one big one, or a grid of cells. */
    const layout = () => {
      if (singleRef.current) {
        const radius = Math.min(canvas.width, canvas.height) * 0.38;
        figures[0]?.place(canvas.width / 2, canvas.height / 2, radius);
        return;
      }

      const size = builtSize;
      const margin = Math.min(canvas.width, canvas.height) * 0.06;
      // Cells spread over the whole canvas, but the figures inside them stay
      // round: a wide screen gets more space between the columns rather than
      // ellipses stretched out to fill it.
      const cellWidth = (canvas.width - margin * 2) / size;
      const cellHeight = (canvas.height - margin * 2) / size;
      const radius = Math.min(cellWidth, cellHeight) * 0.38;

      figures.forEach((figure, index) => {
        const i = index % size;
        const j = Math.floor(index / size);
        figure.place(
          margin + cellWidth * (i + 0.5),
          margin + cellHeight * (j + 0.5),
          radius
        );
      });
    };

    build();

    return {
      onResize: layout,
      frame: () => {
        const size = clamp(Math.round(gridSizeRef.current), 1, maxGrid);
        if (size !== builtSize || singleRef.current !== builtSingle) build();

        if (singleRef.current) {
          // The single figure follows its sliders directly rather than being
          // rebuilt, so changing a frequency does not restart its phase.
          const figure = figures[0];
          figure.xFreq = Math.round(xFreqRef.current);
          figure.yFreq = Math.round(yFreqRef.current);
        }

        clearCanvas(ctx, canvas);
        figures.forEach((figure) => {
          figure.update();
          figure.draw(ctx);
        });
      },
      cleanup: () => {
        figures = [];
      },
    };
  }, []);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  const modeButtons = [
    {
      title: "Mode:",
      type: CHANGER_TYPE.BUTTON,
      enabled: !singleRef.current,
      buttonText: "Table",
      callback: () => {
        singleRef.current = false;
      },
    },
    {
      type: CHANGER_TYPE.BUTTON,
      enabled: singleRef.current,
      buttonText: "Single",
      callback: () => {
        singleRef.current = true;
      },
    },
  ];

  // The table has no frequencies to set — every ratio is already on screen —
  // and the single figure has no grid, so each mode shows only its own.
  const modeSliders = singleRef.current
    ? [
        {
          title: "X Frequency:",
          valueRef: xFreqRef,
          minValue: "1",
          maxValue: "12",
          type: CHANGER_TYPE.SLIDER,
        },
        {
          title: "Y Frequency:",
          valueRef: yFreqRef,
          minValue: "1",
          maxValue: "12",
          type: CHANGER_TYPE.SLIDER,
        },
      ]
    : [
        {
          title: "Grid Size:",
          valueRef: gridSizeRef,
          minValue: "1",
          maxValue: "6",
          type: CHANGER_TYPE.SLIDER,
        },
      ];

  return (
    <>
      <SceneCanvas ref={canvasRef} />

      {visibleUI && (
        <div style={{ zIndex: 3000 }}>
          <ChangerGroup
            valueArrays={[
              modeButtons,
              ...modeSliders,
              {
                title: "Phase Speed:",
                valueRef: phaseSpeedRef,
                minValue: "0",
                maxValue: "300",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Trace Speed:",
                valueRef: traceSpeedRef,
                minValue: "0",
                maxValue: "300",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Trail Length:",
                valueRef: trailLengthRef,
                minValue: "2",
                maxValue: "100",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Line Width:",
                valueRef: lineWidthRef,
                minValue: "1",
                maxValue: "12",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Cursor Radius:",
                valueRef: cursorRadiusRef,
                minValue: "0",
                maxValue: "400",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "NT UltraFidelity Bloom(TM):",
                valueRef: bloomRef,
                minValue: "0",
                maxValue: "40",
                type: CHANGER_TYPE.SLIDER,
              },
            ]}
            rerenderSetter={setRender}
          />

          <IconGroup
            icons={[
              {
                type: "MOUSE",
                text: "Hover to wind a figure up, hold to push it harder",
              },
            ]}
          />
        </div>
      )}
    </>
  );
}
