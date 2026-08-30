import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { IconGroup } from "../utilities/popovers";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import {
  clamp,
  colourToRGB,
  getCloseColour,
  scaleColour,
} from "../utilities/usefulFunctions";
import {
  useCanvasScene,
  SceneCanvas,
  Particle,
  ParticleSystem,
  createPointerTracker,
  clearCanvas,
} from "../utilities/engine";

export default function Hyperspace({ visibleUI }) {
  const { theme } = useTheme();
  const themeRef = useRef(theme);

  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseDownRef = useRef(false);

  const starCountRef = useRef(700);
  const warpSpeedRef = useRef(45);
  const fieldOfViewRef = useRef(120);
  const dopplerRef = useRef(70);
  const steerRef = useRef(0);

  // Set by the scene so the "Punch it" button can reach into the running loop.
  const punchItRef = useRef(() => {});
  const [, setRender] = useState(0);

  const canvasRef = useCanvasScene(({ canvas, ctx, onCleanup }) => {
    // Stars travel down the z axis towards the viewer: 1 is the far plane, and
    // they are recycled once they reach zNear — by which point they are long
    // past the edges of the screen anyway.
    const Z_FAR = 1;
    const Z_NEAR = 0.02;
    // The nearest the opening field is seeded, so it does not begin with a
    // wave of stars already on top of the viewer.
    const Z_SEED = 0.15;

    // How hard holding the pointer pushes the throttle, and how much a jump
    // adds on top of that.
    const HOLD_BOOST = 3;
    const JUMP_BOOST = 9;

    onCleanup(
      createPointerTracker(canvas, {
        posRef: mousePosRef,
        downRef: mouseDownRef,
        touchActiveRef: mouseDownRef,
      })
    );

    // The vanishing point, eased towards wherever the pointer is steering.
    const view = { cx: canvas.width / 2, cy: canvas.height / 2 };
    let steered = false;

    let boost = 1;
    // Decays every frame; a jump slams it back to 1 and it bleeds away, which
    // drives both the speed surge and the flash that goes with it.
    let surge = 0;

    // Recolouring every star every frame is a few thousand string conversions,
    // so the colours are precomputed: TONES shades of starlight, each one
    // shifted through DEPTH_BINS steps of the tunnel. A star only holds its
    // tone, and looks up the bin its depth falls in.
    const TONES = 24;
    const DEPTH_BINS = 16;

    let tones = [];
    let palette = [];
    let paletteTheme = null;
    let paletteShift = -1;

    const buildTones = () => {
      const currentTheme = themeRef.current;
      const tints = [
        currentTheme.secondary,
        currentTheme.tertiaryAccent,
        currentTheme.quarternaryAccent,
      ];

      tones = Array.from({ length: TONES }, (_, index) => {
        const starlight = getCloseColour(currentTheme.accent, 30, 30, 30);
        // Roughly a third of the field is tinted, so the streaks are not all
        // the same shade of white.
        if (index % 3 !== 0) return starlight;
        return scaleColour(
          starlight,
          tints[index % tints.length],
          Math.random() * 0.6 + 0.3
        );
      });

      paletteTheme = currentTheme;
    };

    /**
     * The doppler ramp: light from a star still bearing down on you piles up
     * into the blue, and slides back down towards the red as it passes. At
     * zero the whole tunnel is plain starlight.
     */
    const buildPalette = () => {
      const shift = dopplerRef.current / 100;
      const currentTheme = themeRef.current;

      palette = tones.map((tone) =>
        Array.from({ length: DEPTH_BINS }, (_, bin) => {
          const depth = bin / (DEPTH_BINS - 1);
          const target =
            depth < 0.5 ? currentTheme.secondary : currentTheme.tertiaryAccent;
          return scaleColour(tone, target, shift * Math.abs(depth - 0.5) * 2);
        })
      );

      paletteShift = shift;
    };

    buildTones();
    buildPalette();

    class Star extends Particle {
      constructor() {
        super(0, 0);
        // Fixed for the star's whole life: how long a trail it draws, how
        // thick it is, and which shade of starlight it burns. Varying them per
        // star rather than per field is what stops the streaks looking combed.
        this.trail = 3 + Math.random() * 7;
        this.width = 0.6 + Math.random() * 1.6;
        this.tone = Math.floor(Math.random() * TONES);
        this.respawn(true);
      }

      /**
       * A star is placed by where it should appear on screen and how far down
       * the tunnel it is; `x` and `y` are that screen offset scaled by `z`, so
       * dividing by `z` again projects it. Working back from the screen keeps
       * the field covering the viewport whatever its shape.
       *
       * `seed` spreads the opening field through the tunnel rather than
       * releasing it all from the far plane, so the scene starts mid-flight.
       */
      respawn(seed = false) {
        const spread = fieldOfViewRef.current / 100;
        const screenX = (Math.random() * 2 - 1) * (canvas.width / 2) * spread;
        const screenY = (Math.random() * 2 - 1) * (canvas.height / 2) * spread;

        this.z = seed ? Z_SEED + Math.random() * (Z_FAR - Z_SEED) : Z_FAR;
        this.x = screenX * this.z;
        this.y = screenY * this.z;
        this.trailZ = this.z;
      }

      update(speed) {
        this.trailZ = this.z + speed * this.trail;
        this.z -= speed;

        if (this.z <= Z_NEAR) {
          this.respawn();
          return;
        }

        // Recycle anything that has flown off the edges, or the pool would
        // slowly empty out into the corners.
        if (this.z < 0.9) {
          const margin = 40;
          const screenX = view.cx + this.x / this.z;
          const screenY = view.cy + this.y / this.z;
          if (
            screenX < -margin ||
            screenX > canvas.width + margin ||
            screenY < -margin ||
            screenY > canvas.height + margin
          ) {
            this.respawn();
          }
        }
      }

      draw(ctx) {
        const near = 1 / this.z;
        const far = 1 / Math.min(this.trailZ, Z_FAR);
        const bin = clamp(
          Math.floor((1 - this.z) * DEPTH_BINS),
          0,
          DEPTH_BINS - 1
        );

        ctx.globalAlpha = clamp(0.15 + (1 - this.z) * 1.4, 0, 1);
        ctx.strokeStyle = palette[this.tone][bin];
        ctx.lineWidth = clamp(this.width * (0.7 + near * 0.12), 0.4, 14);
        ctx.beginPath();
        ctx.moveTo(view.cx + this.x * far, view.cy + this.y * far);
        ctx.lineTo(view.cx + this.x * near, view.cy + this.y * near);
        ctx.stroke();
      }
    }

    const system = new ParticleSystem({
      countRef: starCountRef,
      spawn: () => new Star(),
      // Stars are streaks rather than circles, so the GPU batch could not
      // reproduce them anyway.
      gpu: false,
    }).fill();

    punchItRef.current = () => {
      surge = 1;
    };

    /** The white-out at the moment the drive engages. */
    const drawFlash = (intensity) => {
      if (intensity <= 0.01) return;
      ctx.save();
      ctx.globalAlpha = intensity * 0.55;
      ctx.fillStyle = themeRef.current.accent;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    };

    /** The bloom that builds around the vanishing point at speed. */
    const drawGlow = (intensity) => {
      if (intensity <= 0.01) return;
      const radius = Math.min(canvas.width, canvas.height) * 0.55;
      const { r, g, b } = colourToRGB(themeRef.current.secondary);
      const glow = ctx.createRadialGradient(
        view.cx,
        view.cy,
        0,
        view.cx,
        view.cy,
        radius
      );
      glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.35 * intensity})`);
      glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

      ctx.save();
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    };

    return {
      onResize: () => {
        view.cx = canvas.width / 2;
        view.cy = canvas.height / 2;
        steered = false;
      },
      frame: () => {
        if (themeRef.current !== paletteTheme) {
          buildTones();
          buildPalette();
        } else if (dopplerRef.current / 100 !== paletteShift) {
          buildPalette();
        }

        surge *= 0.94;
        const target =
          1 + (mouseDownRef.current ? HOLD_BOOST : 0) + surge * JUMP_BOOST;
        boost += (target - boost) * 0.08;

        // Steering pivots the whole field about the pointer rather than
        // snapping to it, so the tunnel banks instead of jumping.
        const pull = steerRef.current / 100;
        const pointer = mousePosRef.current;
        // Until the pointer has actually been somewhere, fly straight down the
        // middle rather than towards the (0, 0) it starts at.
        const pointed =
          Number.isFinite(pointer.x) &&
          Number.isFinite(pointer.y) &&
          (pointer.x !== 0 || pointer.y !== 0);
        if (pointed) steered = true;
        const targetX =
          canvas.width / 2 +
          (steered ? (pointer.x - canvas.width / 2) * pull : 0);
        const targetY =
          canvas.height / 2 +
          (steered ? (pointer.y - canvas.height / 2) * pull : 0);
        view.cx += (targetX - view.cx) * 0.04;
        view.cy += (targetY - view.cy) * 0.04;

        const throttle = clamp((boost - 1) / (HOLD_BOOST + JUMP_BOOST), 0, 1);
        const speed = (warpSpeedRef.current / 10000) * boost;

        clearCanvas(ctx, canvas);
        drawGlow(throttle);

        ctx.save();
        ctx.lineCap = "round";
        system.step(ctx, speed);
        ctx.restore();

        drawFlash(surge * surge * surge);
      },
      cleanup: () => {
        punchItRef.current = () => {};
        system.clear();
      },
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
                title: "Star Count:",
                valueRef: starCountRef,
                minValue: "50",
                maxValue: "4000",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Warp Speed:",
                valueRef: warpSpeedRef,
                minValue: "1",
                maxValue: "200",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Field Of View:",
                valueRef: fieldOfViewRef,
                minValue: "20",
                maxValue: "200",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Doppler Shift:",
                valueRef: dopplerRef,
                minValue: "0",
                maxValue: "100",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Steering:",
                valueRef: steerRef,
                minValue: "0",
                maxValue: "100",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                type: CHANGER_TYPE.BUTTON,
                buttonText: "Punch it!",
                callback: () => punchItRef.current(),
              },
            ]}
            rerenderSetter={setRender}
          />

          <IconGroup
            icons={[
              {
                type: "MOUSE",
                text: "Hold: to open the throttle\nSteering: turn it up to fly towards the cursor",
              },
            ]}
          />
        </div>
      )}
    </>
  );
}
