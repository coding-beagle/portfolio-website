import React, { useEffect, useRef, useState } from "react";
import defaultColours from "../../themes/themes";

export default function Stars() {
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const [particleCount, setParticleCount] = useState(120);
  const simulationSpeedRef = useRef(100);
  const [, setRender] = useState(0);
  const mouseClickRef = useRef(false);

  const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

  const getCloseColour = (colourHex) => {
    const colour = {
      r: parseInt(colourHex.slice(1, 3), 16),
      g: parseInt(colourHex.slice(3, 5), 16),
      b: parseInt(colourHex.slice(5, 7), 16),
    };

    const r = Math.floor(clamp(colour.r + Math.random() * 20 - 10, 0, 255));
    const g = Math.floor(clamp(colour.g + Math.random() * 10 - 5, 0, 255));
    const b = Math.floor(clamp(colour.b + Math.random() * 10 - 5, 0, 255));

    const rHex = r.toString(16).padStart(2, "0");
    const gHex = g.toString(16).padStart(2, "0");
    const bHex = b.toString(16).padStart(2, "0");

    return `#${rHex}${gHex}${bHex}`;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    const ctx = canvas.getContext("2d");
    const twinkleChance = 1.1;
    const maxTwinkleCounter = 100;
    const mouseTriggerDistance = 300;

    const shootingStars = [];
    const maxShootingStars = 3;
    const maxShootingStarCounter = 1000;

    let stars = [];
    let animationFrameId;

    const handleMouseMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      mousePosRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };

    const handleMouseDown = () => {
      mouseClickRef.current = true;
    };

    const handleMouseUp = () => {
      mouseClickRef.current = false;
    };

    class Star {
      constructor(x, y, size) {
        this.x = x;
        this.y = y;
        this.colour = defaultColours.accent;
        this.size = size;
        this.isTwinkling = false;
        this.twinklingCounter = 0;
        this.oldSize = 0;
      }

      update() {
        if (Math.random() * 1000 > simulationSpeedRef.current) return; // Throttle the update
        const dx = Math.random() * 0.2 - 0.1;
        const dy = Math.random() * 0.2 - 0.1;
        const mouseDx = mousePosRef.current.x - this.x;
        const mouseDy = mousePosRef.current.y - this.y;
        const distance = Math.sqrt(mouseDx ** 2 + mouseDy ** 2);

        if (distance < mouseTriggerDistance && !this.isTwinkling) {
          this.isTwinkling = true;
        }

        if (distance < mouseTriggerDistance && mouseClickRef.current) {
          this.x += dx;
          this.y += dy;
          const angle = Math.atan2(mouseDy, mouseDx);
          this.x += Math.cos(angle) * 0.1 * (simulationSpeedRef.current / 100);
          this.y += Math.sin(angle) * 0.1 * (simulationSpeedRef.current / 100);
        } else {
          this.x += dx * (simulationSpeedRef.current / 100);
          this.y += dy * (simulationSpeedRef.current / 100);
        }

        if (Math.random() > twinkleChance && !this.isTwinkling) {
          this.isTwinkling = true;
        }

        if (this.isTwinkling) {
          if (this.twinklingCounter == 0) {
            this.oldSize = this.size;
          }
          this.twinklingCounter++;
          this.colour = getCloseColour(defaultColours.accent);
          if (this.twinklingCounter < maxTwinkleCounter / 2) {
            this.size = this.size + Math.random() * 0.05 + 0.01;
          } else {
            this.size = this.size - Math.random() * 0.05 - 0.01;
          }

          if (this.twinklingCounter > maxTwinkleCounter) {
            this.isTwinkling = false;
            this.twinklingCounter = 0;
            this.size = this.oldSize;
            this.colour = defaultColours.accent;
          }
        }
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = getCloseColour(this.colour);
        ctx.fill();
        ctx.closePath();
      }
    }

    const graduallyChangeColour = (colour, targetColour, iterations) => {
      const r_current = parseInt(colour.slice(1, 3), 16);
      const g_current = parseInt(colour.slice(3, 5), 16);
      const b_current = parseInt(colour.slice(5, 7), 16);

      const targetR = parseInt(targetColour.slice(1, 3), 16);
      const targetG = parseInt(targetColour.slice(3, 5), 16);
      const targetB = parseInt(targetColour.slice(5, 7), 16);

      const rStep = (targetR - r_current) / iterations;
      const gStep = (targetG - g_current) / iterations;
      const bStep = (targetB - b_current) / iterations;

      const colours = [];

      for (let i = 0; i < iterations; i++) {
        const r = Math.floor(r_current + rStep * i);
        const g = Math.floor(g_current + gStep * i);
        const b = Math.floor(b_current + bStep * i);

        const rHex = r.toString(16).padStart(2, "0");
        const gHex = g.toString(16).padStart(2, "0");
        const bHex = b.toString(16).padStart(2, "0");

        colours.push(`#${rHex}${gHex}${bHex}`);
      }

      return colours;
    };

    class ShootingStar {
      constructor(x, y, size) {
        this.x = x;
        this.y = y;
        this.size = size;
        this.dx = Math.random() * 2 - 1;
        this.dy = Math.random() * 2 - 1;
        this.startingMagnitude = Math.sqrt(this.dx ** 2 + this.dy ** 2);
        this.colour = defaultColours.accent;
        this.isActive = false;
        this.isActiveCounter = 0;
        this.trailPositions = [{ x: this.x, y: this.y }];
        this.trailColours = [];
        this.fullColour = getCloseColour(defaultColours.accent);
        this.fadeColours = graduallyChangeColour(
          defaultColours.primary,
          this.fullColour,
          maxShootingStarCounter / 4
        );
        this.trailSizes = [this.size];
        this.shootingStarChance = Math.random() ** 10;
      }

      update() {
        if (!this.isActive && Math.random() < this.shootingStarChance) {
          this.isActive = true;
        }

        const mouseDx = mousePosRef.current.x - this.x;
        const mouseDy = mousePosRef.current.y - this.y;
        const distance = Math.sqrt(mouseDx ** 2 + mouseDy ** 2);

        if (this.isActive) {
          if (!(distance < mouseTriggerDistance && mouseClickRef.current)) {
            this.isActiveCounter++;
          }

          // fade in for first quarter
          if (this.isActiveCounter < maxShootingStarCounter / 4) {
            this.colour = this.fadeColours[this.isActiveCounter];
          }

          // fade out for last quarter
          if (this.isActiveCounter > (3 * maxShootingStarCounter) / 4) {
            const fadeIndex =
              this.isActiveCounter - (3 * maxShootingStarCounter) / 4;
            if (fadeIndex < this.fadeColours.length) {
              this.colour =
                this.fadeColours[this.fadeColours.length - fadeIndex];
              this.size = this.size - 0.01;
            }
          }

          if (distance < mouseTriggerDistance && mouseClickRef.current) {
            const angle = Math.atan2(mouseDy, mouseDx);
            this.dx =
              this.dx +
              Math.cos(angle) * 0.01 * (simulationSpeedRef.current / 100);
            this.dy =
              this.dy +
              Math.sin(angle) * 0.01 * (simulationSpeedRef.current / 100);
          } else {
            if (
              Math.sqrt(this.dx ** 2 + this.dy ** 2) > this.startingMagnitude
            ) {
              this.dx = this.dx * 0.99;
              this.dy = this.dy * 0.99;
            }
          }
          this.x += this.dx;
          this.y += this.dy;

          this.trailPositions.push({ x: this.x, y: this.y });
          this.trailColours.push(getCloseColour(defaultColours.accent));
          this.trailSizes.push(this.size);

          this.trailSizes = this.trailSizes.map((size) => size - 0.1);

          if (this.isActiveCounter > maxShootingStarCounter) {
            this.isActive = false;
            this.isActiveCounter = 0;
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.colour = defaultColours.accent;
            this.trailColours = [];
            this.trailPositions = [];
            this.trailSizes = [];
            this.size = Math.random() * 5 + 2.5;
          }
        }
      }

      draw() {
        if (this.isActive) {
          this.trailPositions.forEach((pos, index) => {
            const size = this.trailSizes[index];
            if (size <= 0) return;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, size, 0, Math.PI * 2);
            ctx.fillStyle = this.trailColours[index];
            ctx.fill();
            ctx.closePath();
          });
        }
      }
    }

    function initBlocks() {
      for (let i = 0; i < particleCount; i++) {
        const size = Math.random() * 5 + 2.5;
        const x = Math.random() * (canvas.width - size);
        const y = Math.random() * (canvas.height - size);
        stars.push(new Star(x, y, size));
      }
      for (let i = 0; i < maxShootingStars; i++) {
        const size = Math.random() * 5 + 2.5;
        const x = Math.random() * (canvas.width - size);
        const y = Math.random() * (canvas.height - size);
        shootingStars.push(new ShootingStar(x, y, size));
      }
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      stars.forEach((star) => {
        star.update();
        star.draw();
      });
      shootingStars.forEach((shootingStar) => {
        shootingStar.update();
        shootingStar.draw();
      });
      animationFrameId = requestAnimationFrame(animate);
    }

    initBlocks();
    animate();

    canvas.addEventListener("pointermove", handleMouseMove);
    canvas.addEventListener("pointerup", handleMouseUp);
    canvas.addEventListener("pointerdown", handleMouseDown);

    return () => {
      cancelAnimationFrame(animationFrameId);
      canvas.removeEventListener("pointermove", handleMouseMove);
      canvas.removeEventListener("pointerup", handleMouseUp);
      canvas.removeEventListener("pointerdown", handleMouseDown);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [particleCount]);

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
        <div style={{ position: "absolute", top: "1em", left: "1em" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "0.5em",
            }}
          >
            Star Count:
            <input
              type="range"
              min="1"
              max="50"
              value={particleCount}
              onChange={(e) => setParticleCount(Number(e.target.value))}
              style={{ marginLeft: "0.5em" }}
            />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "0.5em",
            }}
          >
            Simulation Speed:
            <input
              type="range"
              min="1.0"
              max="200.0"
              value={simulationSpeedRef.current}
              onChange={(e) => {
                simulationSpeedRef.current = Number(e.target.value);
                setRender((prev) => prev + 1);
              }}
              style={{ marginLeft: "0.5em" }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
