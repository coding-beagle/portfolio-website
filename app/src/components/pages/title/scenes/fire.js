import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";
import MouseTooltip from "../utilities/popovers";

export default function Fire() {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const simulationSpeedRef = useRef(100);
  const fireSizeRef = useRef(25);

  const [, setRender] = React.useState(0);

  let fire = [];

  useEffect(() => {
    const canvas = canvasRef.current;
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    const ctx = canvas.getContext("2d");
    let animationFrameId;

    function getColourBasedOnTemperature(temperature) {
      const hottestColor = theme.accent; // Hex color, e.g., "#FF0000"
      const coldestColor = theme.tertiaryAccent; // Hex color, e.g., "#0000FF"

      // Interpolate between the two colors based on temperature (0 to 10 scale)
      const ratio = Math.min(Math.max(temperature / 10, 0), 1); // Clamp ratio between 0 and 1
      const interpolate = (start, end) =>
        Math.round(start + (end - start) * ratio);

      const hexToRgb = (hex) =>
        hex
          .replace("#", "")
          .match(/.{2}/g)
          .map((val) => parseInt(val, 16));

      const rgbToHex = (r, g, b) =>
        `#${[r, g, b]
          .map((val) => val.toString(16).padStart(2, "0"))
          .join("")}`;

      const [r1, g1, b1] = hexToRgb(hottestColor);
      const [r2, g2, b2] = hexToRgb(coldestColor);

      const r = interpolate(r2, r1);
      const g = interpolate(g2, g1);
      const b = interpolate(b2, b1);

      return rgbToHex(r, g, b);
    }

    // two rules ; more fireparticles closer together = hotter
    // hotter particles rise

    const speedLim = 2;

    class FireParticle {
      constructor(temperature, x, y, parent) {
        this.temperature = temperature;
        this.x = x;
        this.y = y;
        this.dx = 0;
        this.dy = 0;
        this.parent = parent;
        this.gravity = 0.01; // Gravity effect
        this.heatDissipationRate = 2; // Rate at which heat dissipates
      }

      insideOtherFire() {
        const distance = 20;
        for (let particle of this.parent.fireParticles) {
          if (particle !== this) {
            const dx = this.x - particle.x;
            const dy = this.y - particle.y;
            const dist = Math.sqrt(dx ** 2 + dy ** 2);
            if (dist < distance) {
              return { dx: dx, dy: dy };
            }
          }
        }
        return false;
      }

      calculateHeat() {
        let nearbyCount = 0;
        const distanceThreshold = 20; // Distance to consider "nearby"
        for (let particle of this.parent.fireParticles) {
          if (particle !== this) {
            const dx = this.x - particle.x;
            const dy = this.y - particle.y;
            const dist = Math.sqrt(dx ** 2 + dy ** 2);
            if (dist < distanceThreshold) {
              nearbyCount++;
            }
          }
        }
        this.temperature = Math.min(nearbyCount, 10); // Cap temperature at 10
      }

      update() {
        this.calculateHeat(); // Update temperature based on nearby particles

        this.dx_to_fire = this.parent.x - this.x;
        this.dy_to_fire = this.parent.y - this.y;

        this.dx += this.dx_to_fire / 200;
        this.dy += this.dy_to_fire / 200 - this.temperature / 80; // Hotter particles rise faster

        // Apply gravity
        this.dy += this.gravity;

        // Dissipate heat over time
        this.temperature = Math.max(
          this.temperature - this.heatDissipationRate,
          0
        );

        const currentSpeed = Math.sqrt(this.dx ** 2 + this.dy ** 2);
        if (currentSpeed > speedLim) {
          this.dx = this.dx * 0.9;
          this.dy = this.dy * 0.9;
        }

        const nearFire = this.insideOtherFire();
        if (nearFire) {
          const nearBirdDirection = Math.atan2(nearFire.dy, nearFire.dx);
          const currentDirection = Math.atan2(this.dy, this.dx);
          const newDirection = (nearBirdDirection + currentDirection) / 2;
          this.dx = this.dx + Math.cos(newDirection) * 1;
          this.dy = this.dy + Math.sin(newDirection) * 1;
        }

        this.x += this.dx * (simulationSpeedRef.current / 100);
        this.y += this.dy * (simulationSpeedRef.current / 100);
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = getColourBasedOnTemperature(this.temperature);
        ctx.fill();
        ctx.closePath();
      }
    }

    class Fire {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.fireParticles = [];
      }

      update(posX, posY) {
        this.x = posX;
        this.y = posY;

        this.fireParticles.forEach((fireParticle) => {
          fireParticle.update(posX, posY);
        });
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = theme.accent;
        ctx.fill();
        ctx.closePath();
      }
    }

    function init() {
      fire.push(new Fire(mousePosRef.current.x, mousePosRef.current.y));
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Adjust particle count
      const currentParticleCount = fire[0].fireParticles.length;
      if (currentParticleCount < fireSizeRef.current) {
        for (let i = currentParticleCount; i < fireSizeRef.current; i++) {
          fire[0].fireParticles.push(
            new FireParticle(
              0,
              mousePosRef.current.x,
              mousePosRef.current.y,
              fire[0]
            )
          );
        }
      } else if (currentParticleCount > fireSizeRef.current) {
        fire[0].fireParticles.length = fireSizeRef.current; // Truncate the array
      }

      fire.forEach((fireInstance) => {
        fireInstance.update(mousePosRef.current.x, mousePosRef.current.y);
        // fireInstance.draw();

        // Iterate over the updated fireParticles array
        fireInstance.fireParticles.forEach((fireParticle) => {
          fireParticle.update();
          fireParticle.draw();
        });
      });

      animationFrameId = requestAnimationFrame(animate);
    }

    init();
    animate();

    const handleMouseMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      mousePosRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };

    const handleResize = (event) => {
      resizeCanvas();
    };

    window.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

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
              title: "Fire Size:",
              valueRef: fireSizeRef,
              minValue: "1",
              maxValue: "800",
              type: "slider",
            },
            {
              title: "Simulation Speed:",
              valueRef: simulationSpeedRef,
              minValue: "1",
              maxValue: "200.0",
              type: "slider",
            },
          ]}
          rerenderSetter={setRender}
        />
      </div>
      <div style={{ position: "absolute", top: "1em", right: "1em" }}>
        <MouseTooltip />
      </div>
    </>
  );
}
