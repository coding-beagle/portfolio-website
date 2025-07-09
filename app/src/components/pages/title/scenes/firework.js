import React, { useContext, useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";
import { getCloseColour, getRandomColour } from "../utilities/usefulFunctions";
import { MobileContext } from "../../../../contexts/MobileContext";

export default function Fireworks({ visibleUI }) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const simulationSpeedRef = useRef(100);
  const bloomEffectRef = useRef(6);
  const colorRef = useRef(theme.accent);
  const [, setRender] = useState(0);

  const mobile = useContext(MobileContext);

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
      3: "Trailer",
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
        // Detect if on mobile

        let x = Math.random() * canvasRef.current.width;
        if (mobile) {
          // Reduce x range for mobile (e.g., center fireworks more)
          x =
            canvasRef.current.width * 0.25 +
            Math.random() * canvasRef.current.width * 0.5;
        }
        this.x = x;
        this.y = canvasRef.current.height;
        this.vx = mobile
          ? Math.random() - 0.5
          : (Math.random() - 0.5) * maxFireworkSpeed;
        this.vy = -(Math.random() + 2 * maxFireworkRiseSpeed);
        this.size = Math.random() * 2 + 1;

        this.points = [];
        const fireworkTypesKeys = Object.keys(fireWorkTypes);
        this.type =
          fireWorkTypes[Math.floor(Math.random() * fireworkTypesKeys.length)];

        this.color =
          this.type === "Trailer" ? getRandomColour() : colorRef.current;

        this.sparklingIntensity = Math.random() * 0.5;
        this.exploded = false;
        this.explodeCount = 0;
        this.postExplodeCount = 0;
        this.explodeDelay = Math.floor((Math.random() + 500) * 100);
        this.hasExplodedParticles = false; // Track if particles have been generated
        // Randomize explosion height in the top portion (10% to 33% of screen)
        this.explodeY =
          Math.random() *
            (canvasRef.current.height / 3 - canvasRef.current.height * 0.1) +
          canvasRef.current.height * 0.1;
      }

      explode() {
        if (this.hasExplodedParticles) return;
        this.hasExplodedParticles = true;
        if (this.type === "Circle") {
          const chaffCount = Math.floor(Math.random() * 100) + 20;
          const angleStep = (Math.PI * 2) / chaffCount;
          const colour = getRandomColour();
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
          const colour = getRandomColour();
          for (let arm = 0; arm < points; arm++) {
            const armAngle = (Math.PI * 2 * arm) / points;
            for (let j = 0; j < chaffPerArm; j++) {
              const frac = j / chaffPerArm;
              const isOuter = j % 2 === 0;
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
          const spiralArms = 2 + Math.floor(Math.random() * 3); // 2-4 arms
          const chaffCount = 60 + Math.floor(Math.random() * 40);
          const spiralTurns = 2.5 + Math.random();
          const spiralSpread = Math.random() * 2 + 7;
          const colour = getRandomColour();
          // Add a random spin direction and magnitude for this explosion
          // Make spin direction match spiral direction and increase effect
          const spiralDirection = spiralTurns >= 0 ? 1 : -1; // positive = CCW, negative = CW
          const spin = spiralDirection * 0.25; // Stronger, always matches spiral
          for (let i = 0; i < chaffCount; i++) {
            const arm = i % spiralArms;
            const frac = i / chaffCount;
            const angle =
              Math.PI * 2 * spiralTurns * frac +
              (arm * (Math.PI * 2)) / spiralArms;
            const r = spiralSpread * frac * (0.95 + Math.random() * 0.1);
            const speed = 1.2 + Math.random() * 0.7;
            // Base velocity (radial)
            let vx = Math.cos(angle) * r * speed * 0.18;
            let vy = Math.sin(angle) * r * speed * 0.18;
            // Add tangential (rotational) velocity for inertia
            const tangentialAngle = angle + Math.PI / 2;
            vx += Math.cos(tangentialAngle) * r * spin;
            vy += Math.sin(tangentialAngle) * r * spin;
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

      update() {
        if (!this.exploded) {
          this.y += (this.vy * simulationSpeedRef.current) / 100;
          this.vy += gravity * 0.2;
          this.x += (this.vx * simulationSpeedRef.current) / 100;

          if (this.x >= canvas.width) {
            this.vx *= -1;
          }
          if (this.x <= 0) {
            this.vx *= -1;
          }

          if (this.type === "Trailer") {
            if (Math.random() > this.sparklingIntensity) {
              const colour = getCloseColour(this.color);
              const vx = Math.random() - 0.5;
              const vy = Math.random() - 0.5;
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

          // Explode when reaching the randomized explodeY

          if (
            this.y > 0 && // Top portion of the screen
            this.y < canvasRef.current.height / 3 &&
            !this.exploded // Adjusted to top third
          ) {
            this.explodeCount += 1;
            if (this.y <= this.explodeY) {
              this.exploded = true;
              this.explode(); // Only generate particles once
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

      {visibleUI && (
        <div style={{ zIndex: 3000 }}>
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
      )}
    </>
  );
}
