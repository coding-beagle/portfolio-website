import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";
import { getCloseColour } from "../utilities/usefulFunctions";

export default function Fireworks() {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const simulationSpeedRef = useRef(100);
  const bloomEffectRef = useRef(6);
  const colorRef = useRef(theme.accent);
  const [, setRender] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    // const titleShieldRadius = 30;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // recalculateRect();
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    const ctx = canvas.getContext("2d");

    let fireworks = [];
    // const gravity = Math.random() > 0.1 ? 0.05 : -0.05;
    const gravity = 0.05;
    const maxSpeed = 1;
    let animationFrameId;

    const fireWorkTypes = {
      0: "Circle", // spawn a circle of particles that go out around
      1: "Star", // star-shaped explosion
      2: "Spiral", // new: spiral explosion
    };

    const maxFireworkSpeed = 10;
    const maxFireworkRiseSpeed = 2;
    const fireWorkLifeSpan = 2000;

    class FireworkChaff {
      constructor(x, y, vx, vy, colour, initialSize, sizeFallOff) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.colour = colour;
        this.size = initialSize;
        this.sizeDecayRate = sizeFallOff;
      }

      update() {
        this.x += (this.vx * simulationSpeedRef.current) / 100;
        this.vy += gravity;
        this.y += (this.vy * simulationSpeedRef.current) / 100;
        this.initialSize -= this.sizeDecayRate;

        if (simulationSpeedRef.current < Math.random() * 400)
          this.colour = getCloseColour(this.colour, 0.1, 0.1, 0.1);
      }

      draw() {
        ctx.save();
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.shadowColor = this.colour;
        ctx.shadowBlur = Math.min(24, this.size * bloomEffectRef.current); // Glow effect
        ctx.fillStyle = this.colour;
        ctx.fill();
        ctx.closePath();
        ctx.restore();
      }
    }

    class Firework {
      constructor() {
        this.x = Math.random() * canvasRef.current.width;
        this.y = canvasRef.current.height;
        this.vx = (Math.random() - 0.5) * maxFireworkSpeed;
        this.vy = -(Math.random() + 2 * maxFireworkRiseSpeed);
        this.size = Math.random() * 2 + 1;
        this.color = colorRef.current;
        this.points = [];
        const fireworkTypesKeys = Object.keys(fireWorkTypes);
        this.type =
          fireWorkTypes[Math.floor(Math.random() * fireworkTypesKeys.length)];
        this.exploded = false;
        this.explodeCount = 0;
        this.postExplodeCount = 0;
        this.explodeDelay = Math.floor((Math.random() + 500) * 100);
      }

      update() {
        if (!this.exploded) {
          this.y += (this.vy * simulationSpeedRef.current) / 100;
          this.x += (this.vx * simulationSpeedRef.current) / 100;

          if (
            this.y > 0 && // Top portion of the screen
            this.y < canvasRef.current.height / 3 // Adjusted to top third
          ) {
            this.explodeCount += 1;
            if (this.explodeCount > this.explodeDelay || !this.exploded) {
              this.exploded = true;
            }

            if (this.type === "Circle") {
              const chaffCount = Math.floor(Math.random() * 100) + 20;
              const angleStep = (Math.PI * 2) / chaffCount;
              const colour = `#${Math.floor(
                (Math.random() * 0.5 + 0.5) * 16777215
              )
                .toString(16)
                .padStart(6, "0")}`;
              for (let i = 0; i < chaffCount; i++) {
                const angle = i * angleStep;
                const speed = Math.random() * 2 + 1;
                const vx = Math.cos(angle) * speed;
                const vy = Math.sin(angle) * speed;
                const initialSize = Math.random() * 2 + 1;
                const sizeFallOff = Math.random() * 0.05 + 0.01;
                this.points.push(
                  new FireworkChaff(
                    this.x,
                    this.y,
                    vx,
                    vy,
                    colour,
                    initialSize,
                    sizeFallOff
                  )
                );
              }
            } else if (this.type === "Star") {
              const points = 2 + Math.floor(Math.random() * 10);
              const chaffPerArm = 16;
              const outerRadius = Math.random() * 2 + 7;
              const innerRadius = outerRadius * 0.45;
              const colour = `#${Math.floor(
                (Math.random() * 0.5 + 0.5) * 16777215
              )
                .toString(16)
                .padStart(6, "0")}`;
              for (let arm = 0; arm < points; arm++) {
                const armAngle = (Math.PI * 2 * arm) / points;
                for (let j = 0; j < chaffPerArm; j++) {
                  const frac = j / chaffPerArm;
                  const isOuter = j % 2 === 0;
                  // Add a small random offset to radius and angle for a natural look
                  const r =
                    (isOuter ? outerRadius : innerRadius) *
                    (0.97 + Math.random() * 0.06);
                  const angle =
                    armAngle +
                    (frac * (Math.PI * 2)) / points / 2 +
                    (Math.random() - 0.5) * 0.07;
                  const speed = 1.7 * (0.97 + Math.random() * 0.06);
                  const vx = Math.cos(angle) * r * speed * 0.18;
                  const vy = Math.sin(angle) * r * speed * 0.18;
                  const initialSize = Math.random() * 2 + 1;
                  const sizeFallOff = Math.random() * 0.05 + 0.01;
                  this.points.push(
                    new FireworkChaff(
                      this.x,
                      this.y,
                      vx,
                      vy,
                      colour,
                      initialSize,
                      sizeFallOff
                    )
                  );
                }
              }
            } else if (this.type === "Spiral") {
              // Spiral shape: particles spiral out from the center
              const spiralArms = 2 + Math.floor(Math.random() * 3); // 2-4 arms
              const chaffCount = 60 + Math.floor(Math.random() * 40);
              const spiralTurns = 2.5 + Math.random();
              const spiralSpread = Math.random() * 2 + 7;
              const colour = `#${Math.floor(
                (Math.random() * 0.5 + 0.5) * 16777215
              )
                .toString(16)
                .padStart(6, "0")}`;
              for (let i = 0; i < chaffCount; i++) {
                const arm = i % spiralArms;
                const frac = i / chaffCount;
                const angle =
                  Math.PI * 2 * spiralTurns * frac +
                  (arm * (Math.PI * 2)) / spiralArms;
                const r = spiralSpread * frac * (0.95 + Math.random() * 0.1);
                const speed = 1.2 + Math.random() * 0.7;
                const vx = Math.cos(angle) * r * speed * 0.18;
                const vy = Math.sin(angle) * r * speed * 0.18;
                const initialSize = Math.random() * 2 + 1;
                const sizeFallOff = Math.random() * 0.05 + 0.01;
                this.points.push(
                  new FireworkChaff(
                    this.x,
                    this.y,
                    vx,
                    vy,
                    colour,
                    initialSize,
                    sizeFallOff
                  )
                );
              }
            }
          }
        } else {
          this.postExplodeCount += 1;
        }
      }

      draw() {
        if (!this.exploded) {
          ctx.beginPath();
          ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
          ctx.fillStyle = this.color;
          ctx.fill();
          ctx.closePath();
        }
      }
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (Math.random() > 0.99) {
        fireworks.push(new Firework());
      }
      fireworks.forEach((firework) => {
        firework.update();
        firework.draw();

        if (firework.postExplodeCount > fireWorkLifeSpan) {
          fireworks = fireworks.filter((f) => f !== firework);
        } else {
          firework.points.forEach((fireworkPoint) => {
            fireworkPoint.update();
            fireworkPoint.draw();
          });
        }
      });
      animationFrameId = requestAnimationFrame(animate);
    }

    // Attach fireworks array to canvas for theme effect access
    canvas._fireworks = fireworks;
    window.fireworks = fireworks;

    animate();

    return () => {
      // Cleanup function to cancel the animation frame
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resizeCanvas);
      fireworks = [];
    };
  }, []);

  // Update colorRef and all fireworks' colors on theme change
  useEffect(() => {
    colorRef.current = theme.accent;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas._fireworks) {
      canvas._fireworks.forEach((firework) => {
        firework.color = theme.accent;
      });
    }
  }, [theme]);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
        }}
      />

      <div style={{ zIndex: 10 }}>
        <ChangerGroup
          valueArrays={[
            {
              title: "Simulation Speed:",
              valueRef: simulationSpeedRef,
              minValue: "1",
              maxValue: "200.0",
              type: "slider",
            },
            {
              title: "Glow Radius:",
              valueRef: bloomEffectRef,
              minValue: "1",
              maxValue: "24.0",
              type: "slider",
            },
          ]}
          rerenderSetter={setRender}
        />
      </div>
    </>
  );
}
