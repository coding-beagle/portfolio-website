import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import MouseTooltip from "../utilities/popovers";
import { ChangerGroup } from "../utilities/valueChangers";
import { checkMouseInRadius, getMiddleOfRectangle, getRandomColour, inRect, padRect } from "../utilities/usefulFunctions";

export default function Pinball({ visibleUI }) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const touchActiveRef = useRef(false);
  const ballRefVX = useRef(0);
  const ballRefVY = useRef(0);
  const gridSpacingX = useRef(200);
  const gridSpacingY = useRef(200);
  const ballRef = useRef(null);
  const controllables = useRef([]);
  const simulationSpeedRef = useRef(100);
  const recalculateRectRef = useRef(() => { });
  const visibleUIRef = useRef(visibleUI);
  const [, setRender] = useState(0); // Dummy state to force re-render

  useEffect(() => {
    let element = document.getElementById("title") ?? null;
    let rect_padded = { left: 0, right: 0, top: 0, bottom: 0 };
    let elementCenterX = 0;
    let elementCenterY = 0;

    const gravity = 0.02;
    let animationFrameId;
    const maxFallSpeed = 13;

    const recalculateRect = () => {
      if (!element) return;
      let rect = element.getBoundingClientRect();
      elementCenterX = rect.left + rect.width / 2;
      elementCenterY = rect.top + rect.height / 2;
    };

    recalculateRectRef.current = recalculateRect;

    const canvas = canvasRef.current;
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      recalculateRect();
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("popstate", recalculateRect);
    const ctx = canvas.getContext("2d");

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

    const handleTouchMove = (event) => {
      if (event.touches && event.touches.length > 0) {
        const rect = canvas.getBoundingClientRect();
        const touch = event.touches[0];
        mousePosRef.current = {
          x: touch.clientX - rect.left,
          y: touch.clientY - rect.top,
        };
      }
    };

    const handleTouchStart = () => {
      touchActiveRef.current = true;
    };

    const handleTouchEnd = () => {
      touchActiveRef.current = false;
    };

    // --- Touch event handler to prevent scroll on drag ---
    function handleTouchDragPreventScroll(e) {
      if (e.touches && e.touches.length > 0) {
        e.preventDefault();
      }
    }

    const inElement = (rect, x, y) => {
      return (
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      );
    };

    recalculateRect();

    const BALL_MAX_VX = 8.0
    const BALL_MAX_VY = 8.0

    class Particle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 3 * (Math.random() - 0.5) + Math.sign(Math.random() - 0.5) * 0.2;
        this.vy = 0;
        this.size = 20;
        this.color = theme.secondary;
        this.canBeHit = true;
      }

      update() {
        if (this.vy < maxFallSpeed) {
          this.vy += gravity;
        }

        if (Math.abs(this.vx) > BALL_MAX_VX) {
          this.vx = Math.sign(this.vx) * BALL_MAX_VX;
        }

        if (Math.abs(this.vy) > BALL_MAX_VY) {
          this.vy = Math.sign(this.vy) * BALL_MAX_VY;
        }

        this.x += (this.vx * simulationSpeedRef.current) / 100;
        this.y += (this.vy * simulationSpeedRef.current) / 100;

        if (this.y > canvas.height) {
          this.y = this.size * 2;
          this.x = Math.random() * canvas.width;
          this.vy = 0;
          this.vx = 0;
        }

        if (this.y - this.size < 0.0) {
          this.vy *= -1;
        }

        if (this.x >= canvas.width - this.size) {
          this.vx *= -1;
        }

        if (this.x < 0 + this.size) {
          this.vx *= -1;
        }

        ballRefVX.current = this.vx;
        ballRefVY.current = this.vy;
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.closePath();
      }

      startPaddleHitCooldown() {
        this.canBeHit = false;
        setTimeout(() => {
          this.canBeHit = true;
        }, 1000)
      }
    }

    const MAX_ROTATION = 0.5;
    const MAX_ROTATION_COUNT = 50;

    const MIN_UP_VELOCITY = -3;

    class ForceApplicator {
      constructor(x, y, width, height, left, pivot_x, pivot_y) {
        this.x = x;
        this.y = y;

        this.pivot_x = pivot_x + x;
        this.pivot_y = pivot_y + y;

        this.d_theta = 0; // rotation velocity

        this.width = width;
        this.height = height;
        this.rotate_left = left;

        this.rect_midpoints = getMiddleOfRectangle(this.x, this.y, this.width, this.height);
        this.rotate_offset = this.rotate_left ? this.width / 2.2 : -this.width / 2.2

        this.rotation = 0.0;
        this.rotation_count = 0;
        this.rotating = false;
      }

      update() {
        if (checkMouseInRadius(getMiddleOfRectangle(this.x, this.y, this.width, this.height)
          , mousePosRef.current, this.width) && (Math.abs(this.rotation) < 0.01) &&
          mouseClickRef.current) {
          this.rotating = true;
          this.rotation_count = 0;
        }
        if (this.rotating) {
          if (Math.abs(this.rotation) < MAX_ROTATION) {
            this.rotation += this.rotate_left ? -this.d_theta : this.d_theta;
            this.d_theta += 0.02;
          } else if (this.rotation_count > MAX_ROTATION_COUNT) {
            this.rotating = false;
            this.d_theta = 0.0;
          } else {
            this.rotation_count += 1;
          }
        } else {
          if (Math.abs(this.rotation) > 0.1) {
            this.rotation += this.rotate_left ? -this.d_theta : this.d_theta;
            this.d_theta -= 0.001;
          } else {
            this.d_theta = 0.0;
            this.rotation = 0.0;
          }
        }
        this.check_ball_collision();
      }

      // transform the ball's coordinate system into the paddle's
      check_ball_collision() {
        if (!ballRef.current.canBeHit) { return }
        const ball_pos = { x: ballRef.current.x, y: ballRef.current.y }

        const point_x = this.rect_midpoints.x - this.rotate_offset;
        const point_y = this.rect_midpoints.y;

        const dx = ball_pos.x - point_x;
        const dy = ball_pos.y - point_y;

        const new_x = point_x + dx * Math.cos(-this.rotation) - dy * Math.sin(-this.rotation);
        const new_y = point_y + dy * Math.cos(-this.rotation) + dx * Math.sin(-this.rotation);
        const ball_pos_transformed = { x: new_x, y: new_y };

        const rect_paddle = { left: this.x, right: this.x + this.width, top: this.y, bottom: this.y + this.height }
        // kinky
        const paddle_padded = padRect(rect_paddle, 2, 5);

        // check collision
        if (inRect(paddle_padded, ball_pos_transformed.x, ball_pos_transformed.y, ballRef.current.size)) {
          if (Math.abs(this.rotation) > 0.0) {
            const normalAngle = -Math.PI / 2 + this.rotation;
            const normalX = Math.cos(normalAngle);
            const normalY = Math.sin(normalAngle);

            const dotProduct = ballRef.current.vx * normalX + ballRef.current.vy * normalY;
            ballRef.current.vx -= 2 * dotProduct * normalX;
            ballRef.current.vy -= (2 * dotProduct * normalY);

            const speedMultiplier = 2.0;
            ballRef.current.vx *= speedMultiplier;
            ballRef.current.vy *= speedMultiplier;

            if (this.rotating && this.d_theta > 0) {
              const tangentialForce = this.d_theta * 15;
              ballRef.current.vx += this.rotate_left ? -tangentialForce : tangentialForce;
              ballRef.current.vy -= (tangentialForce);
            }
          } else {
            ballRef.current.vy = -ballRef.current.vy * 1.1;
          }

          if (ballRef.current.vy < 0.0 && ballRef.current.vy > MIN_UP_VELOCITY) {
            ballRef.current.vy = MIN_UP_VELOCITY;
          }

          this.d_theta = 0.0;
          this.rotation_count = 0;
          this.rotating = false;

          ballRef.current.startPaddleHitCooldown();
        }
      }

      draw() {
        ctx.save();

        ctx.beginPath();

        if (Math.abs(this.rotation) > 0.01) {
          ctx.translate(this.rect_midpoints.x - this.rotate_offset, this.rect_midpoints.y)
          ctx.rotate(this.rotation);
          ctx.translate(-(this.rect_midpoints.x - this.rotate_offset), -this.rect_midpoints.y)
        } else {
          this.rotation = 0.0;
        }
        ctx.fillStyle = theme.secondary;
        ctx.rect(this.x, this.y, this.width, this.height);


        ctx.fill();
        ctx.closePath();

        ctx.beginPath();
        ctx.arc(this.rect_midpoints.x - this.rotate_offset, this.rect_midpoints.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = theme.primary;
        ctx.fill();
        ctx.closePath();


        ctx.restore();
      }
    }

    const ticks_to_stop_glowing = 300;

    class Dingers {
      constructor(x, y, size) {
        this.x = x;
        this.y = y;
        this.size = size;
        this.starting_size = size;
        this.color = getRandomColour();
        this.shadow_size = 0;
        this.ticks = 0;
        this.justHit = false;
        this.canBeHit = true;
      }

      startHitCooldown() {
        this.canBeHit = false;
        setTimeout(() => {
          this.canBeHit = true;
        }, 400)
      }

      update() {
        const collision_result = this.check_ball_collision()
        if (collision_result !== false) {
          this.shadow = 20;



          ballRef.current.y -= 10;

          this.justHit = true;
        }

        if (this.justHit) {
          this.size += 3
          this.sizeTickStart = true;
          this.justHit = false;
          this.startHitCooldown();
        }

        if (this.size > this.starting_size) {
          this.size -= 0.01
        }

        if (this.shadow > 0) {
          this.shadow -= 0.01;
        }

      }

      check_ball_collision() {
        let dx, dy;
        dx = (ballRef.current.x - this.x) ** 2;
        dy = (ballRef.current.y - this.y) ** 2;
        if (dx + dy < (this.size + ballRef.current.size) ** 2) {
          return { x: this.x, y: this.y };
        }
        return false
      }

      draw() {
        ctx.save();
        ctx.beginPath();
        ctx.shadowBlur = this.shadow;
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.closePath();
        ctx.restore();
      }
    }

    function initScene() {
      initDingers();
      ballRef.current = new Particle(760, Math.random() * 0.5 * canvas.height + 20);

      const paddle_width = canvas.width / 5;

      const left_paddle_x = canvas.width / 4;
      const right_paddle_x = 3 * canvas.width / 4 - paddle_width;
      const paddle_y = canvas.height * 5 / 6

      const left_paddle = new ForceApplicator(left_paddle_x, paddle_y, paddle_width, 20, true, 20, 10);
      const right_paddle = new ForceApplicator(right_paddle_x, paddle_y, paddle_width, 20, false, paddle_width - 20, 10);

      controllables.current.push(left_paddle);
      controllables.current.push(right_paddle);
    }

    class DingerManager {
      constructor() {
        this.childDingerPositions = [];
        this.dingers = [];
        this.change_existing_dingers_to_grid();
      }

      change_existing_dingers_to_grid() {
        // dingers in the main play area:
        let offsetRow = false;
        let dinger_index = 0;

        for (
          let y = 50;
          y < canvasRef.current.height;
          y += gridSpacingY.current
        ) {
          offsetRow = !offsetRow;
          for (
            let x = 5;
            x < canvasRef.current.width;
            x += gridSpacingX.current
          ) {
            let xVal = offsetRow ? x + gridSpacingX.current / 2 : x;
            if (dinger_index < this.dingers.length) {
              this.dingers[dinger_index].x = xVal;
              this.dingers[dinger_index].y = y;
            } else {
              this.dingers.push(new Dingers(xVal, y, 5))
            }
            dinger_index++;
          }
        }
      }

      update_and_draw() {
        this.change_existing_dingers_to_grid()
        this.dingers.forEach((dinger) => {
          dinger.update();
          dinger.draw();
        })
      }
    }

    let dingers = [];

    const dingerMan = new DingerManager()

    function initDingers() {
      // line of dingers at the bottom
      const dinger_y = canvas.height * 5 / 6;

      for (let i = 0; i < 5; i++) {
        dingers.push(new Dingers(i * 100 + 30, dinger_y, 30))
      }

      for (let i = 0; i < 5; i++) {
        dingers.push(new Dingers(canvas.width - (i * 100 + 30), dinger_y, 30))
      }
    }


    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (ballRef.current) {
        ballRef.current.update()
        ballRef.current.draw()
      }

      controllables.current.forEach((controllable) => {
        controllable.update();
        controllable.draw();
      })

      dingers.forEach((dinger) => {
        dinger.update();
        dinger.draw();
      })

      dingerMan.update_and_draw();

      animationFrameId = requestAnimationFrame(animate);
    }

    initScene();
    animate();

    window.addEventListener("pointermove", handleMouseMove);
    window.addEventListener("pointerdown", handleMouseDown);
    window.addEventListener("pointerup", handleMouseUp);
    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchstart", handleTouchStart);
    window.addEventListener("touchend", handleTouchEnd);
    // Prevent default scroll on touch drag over canvas
    if (canvas) {
      canvas.addEventListener("touchmove", handleTouchDragPreventScroll, {
        passive: false,
      });
    }

    return () => {
      // Cleanup function to cancel the animation frame and remove event listeners
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("pointermove", handleMouseMove);
      window.removeEventListener("pointerdown", handleMouseDown);
      window.removeEventListener("pointerup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("popstate", recalculateRect);

      controllables.current = [];
      ballRef.current = null;

      if (canvas) {
        canvas.removeEventListener("touchmove", handleTouchDragPreventScroll);
      }
    };
  }, [theme.secondary]);

  useEffect(() => {
    visibleUIRef.current = visibleUI;
  }, [visibleUI]);

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
                title: "Grid Spacing X:",
                valueRef: gridSpacingX,
                minValue: "100",
                maxValue: "400",
                type: "slider",
              },
              {
                title: "Grid Spacing Y:",
                valueRef: gridSpacingY,
                minValue: "100",
                maxValue: "400",
                type: "slider",
              },
              [{
                title: "Ball Velocity X",
                valueRef: ballRefVX,
                type: "display",
              }, {
                title: "Ball Velocity Y",
                valueRef: ballRefVY,
                type: "display",
              },]
            ]}
            rerenderSetter={setRender}
          />

          <div style={{ position: "absolute", top: "1em", right: "1em" }}>
            <MouseTooltip />
          </div>
        </div>
      )}
    </>
  );
}
