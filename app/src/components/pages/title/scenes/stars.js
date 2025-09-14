import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import MouseTooltip, { IconGroup } from "../utilities/popovers";
import { ChangerGroup } from "../utilities/valueChangers";

export default function Stars({ visibleUI }) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const [particleCount, setParticleCount] = useState(120);
  const simulationSpeedRef = useRef(100);
  const [, setRender] = useState(0);
  const [rerenderSim, setRerenderSim] = useState(false);

  const mouseClickRef = useRef(false);

  const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

  useEffect(() => {
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
    let blackHoles = [];
    const BLACK_HOLE_SIZE = 20;
    const BLACK_HOLE_LIFETIME = 2000; // frames
    const BLACK_HOLE_PULL_RADIUS = 200;
    const BLACK_HOLE_PULL_STRENGTH = 0.7;

    // Store explosion effects
    let explosions = [];

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
        this.colour = theme.accent;
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
          if (this.twinklingCounter === 0) {
            this.oldSize = this.size;
          }
          this.twinklingCounter++;
          this.colour = getCloseColour(theme.accent);
          if (this.twinklingCounter < maxTwinkleCounter / 2) {
            this.size = this.size + Math.random() * 0.05 + 0.01;
          } else {
            this.size = this.size - Math.random() * 0.05 - 0.01;
          }

          if (this.twinklingCounter > maxTwinkleCounter) {
            this.isTwinkling = false;
            this.twinklingCounter = 0;
            this.size = this.oldSize;
            this.colour = theme.accent;
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

    class BlackHole {
      constructor(x, y, size) {
        this.x = x;
        this.y = y;
        this.size = size;
        this.lifetime = BLACK_HOLE_LIFETIME;
        this.twist = 0;
        this.collapsing = false;
        this.collapseFrame = 0;
        this.collapseDuration = 400;
      }
      update() {
        if (!this.collapsing) {
          this.lifetime--;
          this.twist += 0.2;
          // Pull in nearby stars
          stars = stars.filter((star) => {
            const dx = this.x - star.x;
            const dy = this.y - star.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < this.size * 0.7) {
              // Consumed by black hole
              return false;
            }
            if (dist < BLACK_HOLE_PULL_RADIUS) {
              // Pull star towards black hole
              const angle =
                Math.atan2(dy, dx) + Math.sin(this.twist + dist / 30) * 0.2;
              const pull =
                BLACK_HOLE_PULL_STRENGTH * (1 - dist / BLACK_HOLE_PULL_RADIUS);
              star.x += Math.cos(angle) * pull;
              star.y += Math.sin(angle) * pull;
            }
            return true;
          });
          // Pull on other black holes
          blackHoles.forEach((other) => {
            if (other === this || other.collapsing) return;
            const dx = this.x - other.x;
            const dy = this.y - other.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 1 && dist < BLACK_HOLE_PULL_RADIUS * 1.5) {
              // Pull other black hole towards this one
              const angle = Math.atan2(dy, dx);
              const pull =
                BLACK_HOLE_PULL_STRENGTH *
                1.5 *
                (1 - dist / (BLACK_HOLE_PULL_RADIUS * 1.5));
              other.x += Math.cos(angle) * pull;
              other.y += Math.sin(angle) * pull;
            }
          });
          if (this.lifetime <= 0) {
            this.collapsing = true;
            this.collapseFrame = 0;
          }
        } else {
          this.collapseFrame++;
        }
      }
      draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.twist);
        let drawSize = this.size;
        let alpha = 1;
        if (this.collapsing) {
          drawSize = Math.max(
            0,
            this.size * (1 - this.collapseFrame / this.collapseDuration)
          );
          alpha = 1 - this.collapseFrame / this.collapseDuration;
        }
        // Draw twisting black hole
        const gradient = ctx.createRadialGradient(
          0,
          0,
          drawSize * 0.2,
          0,
          0,
          drawSize
        );
        gradient.addColorStop(0, `rgba(34,34,34,${alpha})`);
        gradient.addColorStop(0.5, `rgba(0,0,0,${alpha})`);
        gradient.addColorStop(1, `rgba(0,0,0,0)`);
        ctx.beginPath();
        ctx.arc(0, 0, drawSize, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.shadowColor = `rgba(0,0,0,${alpha})`;
        ctx.shadowBlur = 30 * alpha;
        ctx.globalAlpha = alpha;
        ctx.fill();
        ctx.closePath();
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }

    // Explosion effect class
    class BlackHoleExplosion {
      constructor(x, y, waveCount = 3) {
        this.x = x;
        this.y = y;
        this.waves = [];
        this.waveCount = waveCount;
        for (let i = 0; i < waveCount; i++) {
          this.waves.push({
            radius: 0,
            maxRadius: 350 + i * 120, // Each wave is much bigger
            alpha: 0.7 - i * 0.18, // Each wave is fainter
            speed: 3 + i * 1.2, // Each wave is slower and more dramatic
            delay: i * 22, // Delay each wave for a staggered effect
            started: false,
          });
        }
      }
      update() {
        this.waves.forEach((wave) => {
          if (wave.delay > 0) {
            wave.delay--;
            return;
          }
          wave.started = true;
          wave.radius += wave.speed;
          wave.alpha -= 0.004 + wave.speed * 0.0007;
        });
      }
      draw() {
        this.waves.forEach((wave, idx) => {
          if (!wave.started || wave.alpha <= 0) return;
          ctx.save();
          ctx.globalAlpha = Math.max(0, wave.alpha);
          const gradient = ctx.createRadialGradient(
            this.x,
            this.y,
            0,
            this.x,
            this.y,
            wave.radius
          );
          gradient.addColorStop(
            0,
            idx === 0 ? "rgba(255,255,255,0.8)" : "rgba(0,200,255,0.4)"
          );
          gradient.addColorStop(0.2, "rgba(0,200,255,0.25)");
          gradient.addColorStop(0.7, "rgba(0,0,0,0.08)");
          gradient.addColorStop(1, "rgba(0,0,0,0)");
          ctx.beginPath();
          ctx.arc(this.x, this.y, wave.radius, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
          ctx.closePath();
          ctx.globalAlpha = 1;
          ctx.restore();
        });
      }
      isDone() {
        // Done if all waves are faded or too big
        return this.waves.every(
          (wave) =>
            wave.started && (wave.alpha <= 0 || wave.radius > wave.maxRadius)
        );
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
        this.colour = theme.accent;
        this.isActive = false;
        this.isActiveCounter = 0;
        this.trailPositions = [{ x: this.x, y: this.y }];
        this.trailColours = [];
        this.fullColour = getCloseColour(theme.accent);
        this.fadeColours = graduallyChangeColour(
          theme.primary,
          this.fullColour,
          maxShootingStarCounter / 4
        );
        this.trailSizes = [this.size];
        this.shootingStarChance = Math.random() ** 10;
      }

      update() {
        if (!this.isActive && Math.random() < this.shootingStarChance / 2) {
          // Reduce the chance of activation to make it harder for all comets to be active at once
          this.isActive = true;
        }

        const mouseDx = mousePosRef.current.x - this.x;
        const mouseDy = mousePosRef.current.y - this.y;
        const distance = Math.sqrt(mouseDx ** 2 + mouseDy ** 2);

        if (this.isActive) {
          // Check for collisions with stars
          if (mouseClickRef.current) {
            stars = stars.filter((star) => {
              const dx = this.x - star.x;
              const dy = this.y - star.y;
              const distance = Math.sqrt(dx ** 2 + dy ** 2);

              if (distance < this.size + star.size) {
                this.size += 0.5; // Increase comet size slightly
                return false; // Remove the star
              }

              return true; // Keep the star
            });
          }

          if (!mouseClickRef.current) {
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

          if (mouseClickRef.current) {
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
          this.x += this.dx * (simulationSpeedRef.current / 100);
          this.y += this.dy * (simulationSpeedRef.current / 100);

          this.trailPositions.push({ x: this.x, y: this.y });
          this.trailColours.push(getCloseColour(theme.accent));
          this.trailSizes.push(this.size);

          this.trailSizes = this.trailSizes.map((size) => size - 0.1);

          if (
            this.size >= BLACK_HOLE_SIZE &&
            blackHoles.every(
              (bh) =>
                Math.hypot(this.x - bh.x, this.y - bh.y) > BLACK_HOLE_SIZE * 2
            )
          ) {
            // Collapse into black hole
            blackHoles.push(new BlackHole(this.x, this.y, this.size * 1.2));
            this.isActive = false;
            this.size = 0;
            return;
          }

          // Ensure fade-out completes before resetting
          if (
            this.isActiveCounter > maxShootingStarCounter &&
            this.size <= 0.01 // Check if the comet has fully faded out
          ) {
            this.isActive = false;
            this.isActiveCounter = 0;
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.colour = theme.accent;
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

    function findStarClusters(minStars = 8, clusterRadius = 60) {
      // Find clusters of stars within clusterRadius
      const clusters = [];
      const visited = new Set();
      for (let i = 0; i < stars.length; i++) {
        if (visited.has(i)) continue;
        const cluster = [i];
        visited.add(i);
        for (let j = 0; j < stars.length; j++) {
          if (i === j || visited.has(j)) continue;
          const dx = stars[i].x - stars[j].x;
          const dy = stars[i].y - stars[j].y;
          if (Math.sqrt(dx * dx + dy * dy) < clusterRadius) {
            cluster.push(j);
            visited.add(j);
          }
        }
        if (cluster.length >= minStars) {
          clusters.push(cluster);
        }
      }
      return clusters;
    }

    function getClusterCentroid(cluster) {
      let sumX = 0,
        sumY = 0;
      cluster.forEach((idx) => {
        sumX += stars[idx].x;
        sumY += stars[idx].y;
      });
      return {
        x: sumX / cluster.length,
        y: sumY / cluster.length,
      };
    }

    function handleBlackHoleCollisions() {
      const toRemove = new Set();
      for (let i = 0; i < blackHoles.length; i++) {
        for (let j = i + 1; j < blackHoles.length; j++) {
          const bh1 = blackHoles[i];
          const bh2 = blackHoles[j];
          const dist = Math.hypot(bh1.x - bh2.x, bh1.y - bh2.y);
          if (dist < BLACK_HOLE_SIZE * 1.5) {
            // Collision detected! Trigger explosion at midpoint
            const midX = (bh1.x + bh2.x) / 2;
            const midY = (bh1.y + bh2.y) / 2;
            explosions.push(new BlackHoleExplosion(midX, midY, 3));
            toRemove.add(i);
            toRemove.add(j);
          }
        }
      }
      // Remove collided black holes
      blackHoles = blackHoles.filter((_, idx) => !toRemove.has(idx));
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
      // Black hole cluster detection
      const clusters = findStarClusters();
      clusters.forEach((cluster) => {
        const centroid = getClusterCentroid(cluster);
        if (
          blackHoles.every(
            (bh) =>
              Math.hypot(centroid.x - bh.x, centroid.y - bh.y) >
              BLACK_HOLE_SIZE * 2
          )
        ) {
          blackHoles.push(
            new BlackHole(centroid.x, centroid.y, BLACK_HOLE_SIZE)
          );
        }
      });
      // Handle black hole collisions
      handleBlackHoleCollisions();
      // Update/draw all black holes, remove collapsed ones
      blackHoles = blackHoles.filter((bh) => {
        bh.update();
        bh.draw();
        return !(bh.collapsing && bh.collapseFrame > bh.collapseDuration);
      });
      // Draw and update explosions
      explosions.forEach((exp) => {
        exp.update();
        exp.draw();
      });
      explosions = explosions.filter((exp) => !exp.isDone());
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
  }, [particleCount, theme, rerenderSim]);

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
                title: "Star Count:",
                valueRef: particleCount,
                minValue: "1",
                maxValue: "1000",
                isState: true,
                valueSetter: setParticleCount,
                type: "slider",
              },
              {
                title: "Simulation Speed:",
                valueRef: simulationSpeedRef,
                minValue: "1",
                maxValue: "500.0",
                type: "slider",
              },
              {
                type: "button",
                buttonText: "Rerender Simulation",
                callback: () => {
                  setRerenderSim((prev) => !prev);
                },
              },
            ]}
            rerenderSetter={setRender}
          />
          <IconGroup icons={[
            { type: "MOUSE" },
          ]} />
        </div>
      )}
    </>
  );
}
