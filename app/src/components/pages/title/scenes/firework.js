import React, { useContext, useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import { getCloseColour, getRandomColour } from "../utilities/usefulFunctions";
import { MobileContext } from "../../../../contexts/MobileContext";
import {
  useCanvasScene,
  SceneCanvas,
  Spark,
  clearCanvas,
} from "../utilities/engine";

const FIREWORK_TYPES = ["Circle", "Star", "Spiral", "Trailer"];

export default function Fireworks({ visibleUI }) {
  const { theme } = useTheme();
  const simulationSpeedRef = useRef(100);
  const launchRateRef = useRef(36);
  const bloomEffectRef = useRef(6);
  const colorRef = useRef(theme.accent);
  const fireworksRef = useRef([]);
  const [, setRender] = useState(0);

  const mobile = useContext(MobileContext);

  const canvasRef = useCanvasScene(({ canvas, ctx }) => {
    const gravity = 0.05;
    const maxFireworkSpeed = 10;
    const maxFireworkRiseSpeed = 2;
    const fireWorkLifeSpan = 2000;
    // The loop is a plain rAF with no delta, so rates are expressed in frames
    // and this is what turns the per-minute slider into a per-frame chance.
    const framesPerMinute = 60 * 60;

    /** Every burst pattern builds its sparks the same way; only the aim differs. */
    const makeSpark = (x, y, vx, vy, color) =>
      new Spark(x, y, {
        vx,
        vy,
        color,
        size: Math.random() * 2 + 1,
        sizeDecayRate: Math.random() * 0.05 + 0.01,
        gravity,
      });

    class Firework {
      constructor() {
        // Phones are narrow, so keep the shells over the middle half of the
        // screen and rising near-vertically.
        this.x = mobile
          ? canvas.width * 0.25 + Math.random() * canvas.width * 0.5
          : Math.random() * canvas.width;
        this.y = canvas.height;
        this.vx = mobile
          ? Math.random() - 0.5
          : (Math.random() - 0.5) * maxFireworkSpeed;
        this.vy = -(Math.random() + 2 * maxFireworkRiseSpeed);
        this.size = Math.random() * 2 + 1;

        this.points = [];
        this.type =
          FIREWORK_TYPES[Math.floor(Math.random() * FIREWORK_TYPES.length)];
        this.color =
          this.type === "Trailer" ? getRandomColour() : colorRef.current;

        this.sparklingIntensity = Math.random() * 0.5;
        this.exploded = false;
        this.postExplodeCount = 0;

        // Burst somewhere in the top 10%–33% of the screen.
        this.explodeY =
          Math.random() * (canvas.height / 3 - canvas.height * 0.1) +
          canvas.height * 0.1;
      }

      /** An even ring of sparks. */
      explodeCircle(color) {
        const chaffCount = Math.floor(Math.random() * 100) + 20;
        const angleStep = (Math.PI * 2) / chaffCount;

        for (let i = 0; i < chaffCount; i++) {
          const angle = i * angleStep;
          const speed = Math.random() * 2 + 1;
          this.points.push(
            makeSpark(
              this.x,
              this.y,
              Math.cos(angle) * speed,
              Math.sin(angle) * speed,
              color
            )
          );
        }
      }

      /** Arms of alternating long and short spokes. */
      explodeStar(color) {
        const points = 2 + Math.floor(Math.random() * 10);
        const chaffPerArm = 16;
        const outerRadius = Math.random() * 2 + 7;
        const innerRadius = outerRadius * 0.45;

        for (let arm = 0; arm < points; arm++) {
          const armAngle = (Math.PI * 2 * arm) / points;

          for (let j = 0; j < chaffPerArm; j++) {
            const radius =
              (j % 2 === 0 ? outerRadius : innerRadius) *
              (0.97 + Math.random() * 0.06);
            const angle =
              armAngle +
              ((j / chaffPerArm) * (Math.PI * 2)) / points / 2 +
              (Math.random() - 0.5) * 0.07;
            const speed = 1.7 * (0.97 + Math.random() * 0.06);

            this.points.push(
              makeSpark(
                this.x,
                this.y,
                Math.cos(angle) * radius * speed * 0.18,
                Math.sin(angle) * radius * speed * 0.18,
                color
              )
            );
          }
        }
      }

      /** Curling arms — radial velocity plus a tangential kick to spin them. */
      explodeSpiral(color) {
        const spiralArms = 2 + Math.floor(Math.random() * 3);
        const chaffCount = 60 + Math.floor(Math.random() * 40);
        const spiralTurns = 2.5 + Math.random();
        const spiralSpread = Math.random() * 2 + 7;
        const spin = (spiralTurns >= 0 ? 1 : -1) * 0.25;

        for (let i = 0; i < chaffCount; i++) {
          const frac = i / chaffCount;
          const angle =
            Math.PI * 2 * spiralTurns * frac +
            ((i % spiralArms) * (Math.PI * 2)) / spiralArms;
          const radius = spiralSpread * frac * (0.95 + Math.random() * 0.1);
          const speed = 1.2 + Math.random() * 0.7;
          const tangential = angle + Math.PI / 2;

          this.points.push(
            makeSpark(
              this.x,
              this.y,
              Math.cos(angle) * radius * speed * 0.18 +
                Math.cos(tangential) * radius * spin,
              Math.sin(angle) * radius * speed * 0.18 +
                Math.sin(tangential) * radius * spin,
              color
            )
          );
        }
      }

      explode() {
        const color = getRandomColour();

        if (this.type === "Circle") this.explodeCircle(color);
        else if (this.type === "Star") this.explodeStar(color);
        else if (this.type === "Spiral") this.explodeSpiral(color);
      }

      update() {
        const speedScale = simulationSpeedRef.current / 100;

        if (this.exploded) {
          // Age in simulation time, not frames, so slow motion gives the
          // sparks longer to spread out rather than killing them early.
          this.postExplodeCount += speedScale;
          return;
        }

        this.y += this.vy * speedScale;
        this.vy += gravity * 0.2 * speedScale;
        this.x += this.vx * speedScale;

        // Bounce off the sides rather than drifting out of frame.
        if (this.x >= canvas.width || this.x <= 0) this.vx *= -1;

        // A trailer never bursts; it just sheds sparks the whole way up. The
        // shed chance is per unit of simulation time, so slow motion doesn't
        // pack the trail into a solid line.
        const shedChance = (1 - this.sparklingIntensity) * speedScale;
        if (this.type === "Trailer" && Math.random() < shedChance) {
          this.points.push(
            makeSpark(
              this.x,
              this.y,
              Math.random() - 0.5,
              Math.random() - 0.5,
              getCloseColour(this.color)
            )
          );
        }

        if (this.y > 0 && this.y <= this.explodeY) {
          this.exploded = true;
          this.explode();
        }
      }

      draw(context) {
        if (this.exploded) return;

        context.beginPath();
        context.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        context.fillStyle = this.color;
        context.fill();
        context.closePath();
      }
    }

    fireworksRef.current = [];

    return {
      frame: () => {
        clearCanvas(ctx, canvas);

        const speedScale = simulationSpeedRef.current / 100;

        // Launches are counted in simulation time too, so slow motion stretches
        // the gaps between shells instead of crowding the sky with them.
        const launchChance =
          (launchRateRef.current / framesPerMinute) * speedScale;
        if (Math.random() < launchChance) {
          fireworksRef.current.push(new Firework());
        }

        fireworksRef.current = fireworksRef.current.filter(
          (firework) => firework.postExplodeCount <= fireWorkLifeSpan
        );

        fireworksRef.current.forEach((firework) => {
          firework.update();
          firework.draw(ctx);

          firework.points.forEach((spark) => {
            spark.update(speedScale);
            spark.draw(ctx, bloomEffectRef.current);
          });
        });
      },
      cleanup: () => {
        fireworksRef.current = [];
      },
    };
  }, []);

  useEffect(() => {
    colorRef.current = theme.accent;
    fireworksRef.current.forEach((firework) => {
      firework.color = theme.accent;
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
                title: "Simulation Speed:",
                valueRef: simulationSpeedRef,
                minValue: "1",
                maxValue: "200.0",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Launches / Min:",
                valueRef: launchRateRef,
                minValue: "1",
                maxValue: "240",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Glow Radius:",
                valueRef: bloomEffectRef,
                minValue: "1",
                maxValue: "24.0",
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
