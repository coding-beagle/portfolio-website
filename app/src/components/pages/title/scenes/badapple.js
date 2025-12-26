import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";

export default function BadApple({ visibleUI }) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const videoCanvasRef = useRef(null);
  const videoRef = useRef(null);
  const particleCountRef = useRef(200);
  const simulationSpeedRef = useRef(100);
  const visibleUIRef = useRef(visibleUI);

  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const touchActiveRef = useRef(false);
  const mouseShieldRadiusRef = useRef(100);
  const mouseDisplacementStrengthRef = useRef(10);

  const scaleRef = useRef(4);
  const colorRef = useRef(theme.accent);
  const [, setRender] = useState(0);

  const titleShieldRadiusRef = useRef(20);

  const VID_WIDTH = 480;
  const VID_HEIGHT = 360;

  // const SCALE_FACTOR = scaleRef.current;
  let VIDEO_X = VID_WIDTH / scaleRef.current;
  let VIDEO_Y = VID_HEIGHT / scaleRef.current;

  useEffect(() => {
    const canvas = canvasRef.current;
    const vidCanvas = videoCanvasRef.current;

    let element = document.getElementById("title") ?? null;
    let rect_padded = { left: 0, right: 0, top: 0, bottom: 0 };

    const inElement = (rect, x, y) => {
      return (
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      );
    };

    const recalculateRect = () => {
      if (!element) return;
      let rect = element.getBoundingClientRect();
      rect_padded = {
        left: rect.left - titleShieldRadiusRef.current,
        right: rect.right + titleShieldRadiusRef.current,
        top: rect.top - titleShieldRadiusRef.current,
        bottom: rect.bottom + titleShieldRadiusRef.current,
      };
    };

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      recalculateRect();
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    const ctx = canvas.getContext("2d");
    const vidCtx = vidCanvas.getContext("2d");

    let particles = [];
    let animationFrameId;

    // converts a 480 x 360 x 4 array to 480 x 360
    const flattenRGBAarray = (arr) => {
      let output = []
      for (let i = 0; i < arr.length; i += 4) {
        output.push(arr[i]);
      }
      return output;
    }

    // change from 480 x 360 to VIDEO_X x VIDEO_Y
    const reduceArraySize = (arr) => {
      let output = []
      const xStep = Math.floor(VID_WIDTH / VIDEO_X);
      const yStep = Math.floor(VID_HEIGHT / VIDEO_Y);

      for (let y = 0; y < VIDEO_Y; y++) {
        for (let x = 0; x < VIDEO_X; x++) {

          const srcX = x * xStep;
          const srcY = y * yStep;
          const index = srcY * VID_WIDTH + srcX;
          output.push(arr[index]);
        }
      }
      return output;
    }

    const calculateTotalParticles = () => {
      VIDEO_X = VID_WIDTH / scaleRef.current;
      VIDEO_Y = VID_HEIGHT / scaleRef.current;
      return VIDEO_X * VIDEO_Y;
    }

    const opacityToHex = (opacity) => {
      return opacity.toString(16).padStart(2, '0');
    };

    class Particle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.targetX = x;
        this.targetY = y;
        this.opacity = 255;
        const XSPACING = canvasRef.current.width / VIDEO_X;
        const YSPACING = canvasRef.current.height / VIDEO_Y;
        this.size = Math.min(XSPACING, YSPACING) / 2; // Half the spacing so particles don't overlap
        this.color = colorRef.current;
      }

      resize(size) {
        this.size = size;
      }

      update(color) {
        if ((inElement(rect_padded, this.x, this.y)) && visibleUIRef.current) {
          this.color = theme.primary;
        } else
          this.color = color;

        const dx = this.x - mousePosRef.current.x;
        const dy = this.y - mousePosRef.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < mouseShieldRadiusRef.current) {
          if ((mouseClickRef.current || touchActiveRef.current)) {
            const angle = Math.atan2(dy, dx);
            this.vx = Math.cos(angle) * mouseDisplacementStrengthRef.current;
            this.vy = Math.sin(angle) * mouseDisplacementStrengthRef.current;
          } else {
            this.opacity = 220
            this.vx *= 0.99;
            this.vy *= 0.99;
          }
        } else {
          this.vx *= 0.99;
          this.vy *= 0.99;
          if (this.opacity < 255) {
            this.opacity++;
          }
        }

        this.x += (this.vx * simulationSpeedRef.current) / 100;
        this.y += (this.vy * simulationSpeedRef.current) / 100;

        const ease = 0.5 * (simulationSpeedRef.current / 100);
        this.x += (this.targetX - this.x) * ease;
        this.y += (this.targetY - this.y) * ease;
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color + opacityToHex(this.opacity);
        ctx.fill();
        ctx.closePath();
      }
    }

    const regenGrid = () => {
      if (canvasRef.current) {
        const XSPACING = canvasRef.current.width / VIDEO_X;
        const YSPACING = canvasRef.current.height / VIDEO_Y;
        let index = 0;
        for (let y = 0; y < VIDEO_Y; y++) {
          for (let x = 0; x < VIDEO_X; x++) {
            particles[index].targetX = x * XSPACING;
            particles[index].targetY = y * YSPACING
            index++;
          }
        }
      }
    }

    function initParticles() {
      if (canvasRef.current) {
        const XSPACING = canvasRef.current.width / VIDEO_X;
        const YSPACING = canvasRef.current.height / VIDEO_Y;
        for (let y = 0; y < VIDEO_Y; y++) {
          for (let x = 0; x < VIDEO_X; x++) {
            particles.push(new Particle(x * XSPACING, y * YSPACING));
          }
        }
      }
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // incase element changes location or we hide ui
      if (visibleUIRef.current && !element) {
        element = document.getElementById("title");
        recalculateRect();
      } else {
        element = null
      }

      if (element) {
        const rect_temp = element.getBoundingClientRect();
        const padded_hypothetical_rect = {
          left: rect_temp.left - titleShieldRadiusRef.current,
          right: rect_temp.right + titleShieldRadiusRef.current,
          top: rect_temp.top - titleShieldRadiusRef.current,
          bottom: rect_temp.bottom + titleShieldRadiusRef.current,
        };
        if (rect_padded.top !== padded_hypothetical_rect.top) {
          recalculateRect()
        }

      }

      // Adjust particle count when scaling changes
      // const currentParticleCount = particles.length;
      // if (currentParticleCount < calculateTotalParticles()) {
      //   for (let i = currentParticleCount; i < calculateTotalParticles(); i++) {
      //     const x = Math.random() * canvas.width;
      //     const y = Math.random() * canvas.height;
      //     particles.push(new Particle(x, y));
      //   }
      // } else if (currentParticleCount > particleCountRef.current) {
      //   particles.splice(particleCountRef.current);
      // }

      // console.log(Object.getOwnPropertyNames(videoRef.current))
      const frameData = videoRef.current
      vidCtx.drawImage(frameData, 0, 0)
      const imageData = vidCtx.getImageData(0, 0, 480, 360);
      const pixels = imageData.data; // Uint8ClampedArray
      const arr_data = reduceArraySize(flattenRGBAarray(pixels))
      let index = 0;

      regenGrid()

      particles.forEach((particle) => {
        const col = arr_data[index] === 0 ? theme.primary : theme.accent;
        particle.update(col);
        const XSPACING = canvasRef.current.width / VIDEO_X;
        const YSPACING = canvasRef.current.height / VIDEO_Y;
        particle.resize(Math.min(XSPACING, YSPACING) / 2);
        particle.draw();
        index++;
      });
      animationFrameId = requestAnimationFrame(animate);
    }

    initParticles();
    animate();

    // Attach particles array to canvas for theme effect access
    canvas._particles = particles;

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
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("pointermove", handleMouseMove);
      window.removeEventListener("pointerdown", handleMouseDown);
      window.removeEventListener("pointerup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("resize", resizeCanvas);
      particles = [];
    };
  }, []);

  useEffect(() => {
    visibleUIRef.current = visibleUI;
  }, [visibleUI]);

  // Update colorRef and all particles' colors on theme change
  useEffect(() => {
    colorRef.current = theme.accent;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas._particles) {
      canvas._particles.forEach((particle) => {
        particle.color = theme.accent;
      });
    }
  }, [theme]);

  return (
    <>
      <video
        ref={videoRef}
        autoPlay={true}
        muted={true}
        style={{
          position: "absolute",
          display: "none",
          top: 0,
          left: 0,
        }}
      >
        <source src="badapple/badapple.mp4" type="video/mp4" />
        Your browser does not support the video tag.
      </video >

      <canvas
        ref={videoCanvasRef}
        width={VID_WIDTH}
        height={VID_HEIGHT}
        style={{
          // width: VID_WIDTH,
          // height: VID_HEIGHT,
          display: "none"
        }}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
        }}
      />


      {
        visibleUI && (
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
                // {
                //   title: "Scaling:",
                //   valueRef: scaleRef,
                //   minValue: "1",
                //   maxValue: "8",
                //   type: "slider",
                // },
                {
                  title: "Click Radius:",
                  valueRef: mouseShieldRadiusRef,
                  minValue: "10.0",
                  maxValue: "300.0",
                  type: "slider",
                },
                {
                  title: "Click Strength:",
                  valueRef: mouseDisplacementStrengthRef,
                  minValue: "1.0",
                  maxValue: "100.0",
                  type: "slider",
                },

              ]}
              rerenderSetter={setRender}
            />
          </div>
        )
      }
    </>
  );
}
