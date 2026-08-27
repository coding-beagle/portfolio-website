import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { IconGroup } from "../utilities/popovers";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import {
  clamp,
  ElementCollisionHitbox,
  getCloseColour,
  getRandomColour,
  scaleColour,
} from "../utilities/usefulFunctions";
import {
  useCanvasScene,
  SceneCanvas,
  Particle,
  ParticleSystem,
  Spark,
  createPointerTracker,
  clearCanvas,
  scatterWithMinDistance,
} from "../utilities/engine";

export default function Runes({ visibleUI }) {
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  const mousePosRef = useRef({ x: 0, y: 0 });

  const particleCountRef = useRef(10);
  const bloomEffectRef = useRef(6);
  const simulationSpeedRef = useRef(100);
  const mouseShieldRadiusRef = useRef(100);
  const titleShieldRadiusRef = useRef(30);
  const recalculateRectRef = useRef(() => {});
  const visibleUIRef = useRef(visibleUI);
  const [, setRender] = useState(0);

  const canvasRef = useCanvasScene(({ canvas, ctx, onCleanup }) => {
    const maxSize = 200;
    const minDistanceBetweenPoints = 50;
    const minDistanceBetweenRunes = 200;
    const maxPoints = 10;
    const minPoints = 4;
    const maxChargeCount = 150;
    const maxActiveCount = 500;
    const shatterCount = 200;
    const postShatterLife = 1000;
    const gravity = 0.05;

    const hitboxes = [
      new ElementCollisionHitbox("title", 20, titleShieldRadiusRef),
    ];

    const recalculateRect = () =>
      hitboxes.forEach((hitbox) => hitbox.recalculate());
    recalculateRectRef.current = recalculateRect;
    recalculateRect();

    onCleanup(
      createPointerTracker(canvas, { posRef: mousePosRef })
    );

    /**
     * A glyph drawn as a polyline through a handful of scattered points. Hold
     * the cursor over one and it charges, then lights up, then shatters.
     */
    class Rune extends Particle {
      constructor(x, y) {
        super(x, y, { vx: 0, vy: 0, color: getRandomColour() });

        this.points = scatterWithMinDistance({
          count: clamp(Math.round(Math.random() * 10), minPoints, maxPoints),
          minDistance: minDistanceBetweenPoints,
          sample: () => ({
            x: (Math.random() - 0.5) * maxSize,
            y: (Math.random() - 0.5) * maxSize,
          }),
        });

        this.closedRune = Math.random() > 0.5;
        this.charging = false;
        this.chargeCount = 0;
        this.active = false;
        this.activeCount = 0;
        this.hoveredWhileActive = 0;
        this.shattered = false;
        this.shatteredCount = 0;
        this.childParticles = [];
      }

      /** Burst into sparks, once. */
      shatter() {
        if (this.shattered) return;

        const chaffCount = Math.floor(Math.random() * 20) + 5;
        const angleStep = (Math.PI * 2) / chaffCount;
        const color = getCloseColour(this.color);

        for (let i = 0; i < chaffCount; i++) {
          const angle = i * angleStep;
          const speed = Math.random() * 2 + 1;

          this.childParticles.push(
            new Spark(this.x, this.y, {
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              color,
              size: Math.random() * 20 + 5,
              sizeDecayRate: Math.random() * 0.05 + 0.01,
              gravity,
            })
          );
        }

        this.shattered = true;
      }

      update() {
        if (this.distanceTo(mousePosRef.current) < mouseShieldRadiusRef.current) {
          if (this.chargeCount < maxChargeCount) {
            this.chargeCount += 1;
          } else {
            // Fully charged and still hovered: hold it there long enough and
            // the rune gives out.
            if (this.hoveredWhileActive < shatterCount) {
              this.hoveredWhileActive++;
            } else {
              this.shatter();
            }
            this.activeCount = maxActiveCount;
          }
        } else if (this.chargeCount > 0 && !this.active) {
          this.chargeCount -= 2;
        } else if (this.activeCount > 0 && this.active) {
          this.activeCount -= 2;
        } else if (this.hoveredWhileActive > 0 && this.active) {
          this.hoveredWhileActive--;
        }

        this.charging = this.chargeCount !== 0;
        this.active = this.activeCount !== 0;

        // The more charge, the more it rattles about.
        const jitter = this.chargeCount / maxChargeCount;
        this.vx = (Math.random() - 0.5) * 2 * jitter;
        this.vy = (Math.random() - 0.5) * 2 * jitter;
        this.integrate(simulationSpeedRef.current / 100);

        if (this.shattered) {
          this.shatteredCount++;
          const speedScale = simulationSpeedRef.current / 100;
          this.childParticles.forEach((spark) =>
            spark.update(speedScale)
          );
        }
      }

      draw(context) {
        if (this.shattered) {
          this.childParticles.forEach((spark) =>
            spark.draw(context, bloomEffectRef.current)
          );
          return;
        }

        context.beginPath();
        this.points.forEach((point, index) => {
          const x = point.x + this.x;
          const y = point.y + this.y;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        if (this.closedRune) context.closePath();

        // Charging bleeds the glyph from the theme accent to its own colour.
        context.strokeStyle = this.charging
          ? scaleColour(
              themeRef.current.accent,
              this.color,
              this.chargeCount / maxChargeCount
            )
          : themeRef.current.accent;
        context.lineWidth = 10;

        if (this.active) {
          context.shadowColor = this.color;
          context.shadowBlur = Math.round(
            (this.activeCount / maxActiveCount) * bloomEffectRef.current
          );
        } else {
          context.shadowBlur = 0;
        }

        context.stroke();
      }
    }

    const system = new ParticleSystem({
      countRef: particleCountRef,
      spawn: () => new Rune(Math.random() * canvas.width, Math.random() * canvas.height),
    });

    // Seed the first crop spread out; top-ups afterwards land anywhere.
    scatterWithMinDistance({
      count: particleCountRef.current,
      minDistance: minDistanceBetweenRunes,
      sample: () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
      }),
    }).forEach((point) => system.add(new Rune(point.x, point.y)));

    return {
      onResize: recalculateRect,
      frame: () => {
        clearCanvas(ctx, canvas);

        hitboxes.forEach((hitbox) => {
          if (visibleUIRef.current && !hitbox.elementObject) {
            hitbox.tryUpdateElement(hitbox.elementName);
          } else if (!visibleUIRef.current) {
            hitbox.elementObject = null;
          }
          hitbox.recalculate();
        });

        system.step(ctx);

        // Sweep up runes whose sparks have long since burned out.
        system.prune(
          (rune) => rune.shattered && rune.shatteredCount > postShatterLife
        );
      },
      cleanup: () => system.clear(),
    };
  }, []);

  useEffect(() => {
    visibleUIRef.current = visibleUI;
  }, [visibleUI]);

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
                title: "Rune Count:",
                valueRef: particleCountRef,
                minValue: "5",
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
                title: "Glow Radius:",
                valueRef: bloomEffectRef,
                minValue: "1",
                maxValue: "24.0",
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
