import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import MouseTooltip from "../utilities/popovers";
import { ChangerGroup } from "../utilities/valueChangers";
import { checkMouseInRadius, getMiddleOfRectangle } from "../utilities/usefulFunctions";

export default function Pinball({ visibleUI }) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const touchActiveRef = useRef(false);
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

    class Particle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.size = 10;
        this.color = theme.secondary;
      }

      update() {
        if (element && visibleUIRef.current) {
          const dxFromElementCenter = this.x - elementCenterX;
          const dyFromElementCenter = this.y - elementCenterY;

          if (inElement(rect_padded, this.x, this.y)) {
            const angle2 = Math.atan2(dyFromElementCenter, dxFromElementCenter);
            this.vx = Math.cos(angle2) * 5;
            this.vy = Math.sin(angle2) * 5;
          }
        }

        if (this.vy < maxFallSpeed) {
          this.vy += gravity;
        }

        this.x += (this.vx * simulationSpeedRef.current) / 100;
        this.y += (this.vy * simulationSpeedRef.current) / 100;

        if (this.y > canvas.height) {
          this.y = 0;
          this.x = Math.random() * canvas.width;
          this.vy = 0;
          this.vx = 0;
        }

        if (this.x >= canvas.width + this.size * 3) {
          this.x = Math.random() * canvas.width;
          this.y = 0;
          this.vx = 0;
        }

        if (this.x < 0 - this.size * 3) {
          this.x = Math.random() * canvas.width;
          this.y = 0;
          this.vx = 0;
        }
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.closePath();
      }
    }

    const MAX_ROTATION = 0.5;
    const MAX_ROTATION_COUNT = 50;

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

        this.rotation = 0.0;
        this.rotation_count = 0;
        this.rotating = false;
      }

      update() {
        if (checkMouseInRadius(getMiddleOfRectangle(this.x, this.y, this.width, this.height)
          , mousePosRef.current, this.width) && this.rotating === false &&
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
            this.rotation = 0.0;
            this.d_theta = 0.0;
          } else {
            this.rotation_count += 1;
          }
        }
      }

      draw() {
        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = theme.secondary;

        const rect_midpoints = getMiddleOfRectangle(this.x, this.y, this.width, this.height);
        const rotate_offset = this.rotate_left ? this.width / 3 : -this.width / 3
        if (this.rotating) {
          ctx.translate(rect_midpoints.x - rotate_offset, rect_midpoints.y)
          ctx.rotate(this.rotation);
          ctx.translate(-(rect_midpoints.x - rotate_offset), -rect_midpoints.y)
        }
        ctx.rect(this.x, this.y, this.width, this.height);


        ctx.fill();
        ctx.closePath();


        ctx.restore();
      }
    }

    function initParticles() {
      ballRef.current = new Particle(Math.random() * canvas.width, Math.random() * canvas.height);

      const paddle_width = canvas.width / 5;

      const left_paddle_x = canvas.width / 4;
      const right_paddle_x = 3 * canvas.width / 4 - paddle_width;
      const paddle_y = canvas.height * 5 / 6

      const left_paddle = new ForceApplicator(left_paddle_x, paddle_y, paddle_width, 20, true, 20, 10);
      const right_paddle = new ForceApplicator(right_paddle_x, paddle_y, paddle_width, 20, false, paddle_width - 20, 10);

      controllables.current.push(left_paddle);
      controllables.current.push(right_paddle);
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

      animationFrameId = requestAnimationFrame(animate);
    }

    initParticles();
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
