import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";
import { IconGroup } from "../utilities/popovers";
import { addColour, ElementCollisionHitbox } from "../utilities/usefulFunctions";

export default function BadApple({ visibleUI }) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const videoCanvasRef = useRef(null);
  const videoRef = useRef(null);
  const restoreSpeedRef = useRef(65);
  const simulationSpeedRef = useRef(100);
  const visibleUIRef = useRef(visibleUI);

  const themeRef = useRef(theme);

  const volumeRef = useRef(0.0);

  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const touchActiveRef = useRef(false);
  const mouseShieldRadiusRef = useRef(100);
  const mouseDisplacementStrengthRef = useRef(10);

  const scaleRef = useRef(4);
  const colorRef = useRef(themeRef.current.accent);
  const [, setRender] = useState(0);

  const VID_WIDTH = 480;
  const VID_HEIGHT = 360;

  // const SCALE_FACTOR = scaleRef.current;
  let VIDEO_X = VID_WIDTH / scaleRef.current;
  let VIDEO_Y = VID_HEIGHT / scaleRef.current;

  useEffect(() => {
    const canvas = canvasRef.current;
    const vidCanvas = videoCanvasRef.current;

    const titleHitbox = new ElementCollisionHitbox("title", 20)
    const iconsHitbox = new ElementCollisionHitbox("linkIcons", 20)
    const changerGroupHitbox = new ElementCollisionHitbox("changerGroup", 20)
    const iconGroupHitbox = new ElementCollisionHitbox("iconGroup", 20)

    const collisionElements = [titleHitbox, iconsHitbox, changerGroupHitbox, iconGroupHitbox];

    const recalculateRect = () => {
      collisionElements.forEach((hitbox) => { hitbox.recalculate() })
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
      VIDEO_X = Math.floor(VID_WIDTH / (8 - scaleRef.current + 2));
      VIDEO_Y = Math.floor(VID_HEIGHT / (8 - scaleRef.current + 2));

      return VIDEO_X * VIDEO_Y;
    }

    const opacityToHex = (opacity) => {
      return opacity.toString(16).padStart(2, '0');
    };

    const XSPACING = canvasRef.current.width / VIDEO_X;
    const YSPACING = canvasRef.current.height / VIDEO_Y;
    const startingSize = Math.min(XSPACING, YSPACING) / 2; // Half the spacing so particles don't overlap

    class Particle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.targetX = x;
        this.targetY = y;
        this.opacity = 255;
        this.size = startingSize; // Half the spacing so particles don't overlap
        this.color = colorRef.current;
      }

      resize(size) {
        this.size = size;
      }

      update(color) {
        if (collisionElements.some((hitbox) => { return hitbox.inElement(this.x, this.y) }) && visibleUIRef.current) {
          this.color = themeRef.current.primary;
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
            this.color = addColour(this.color, 20, 20, 20);
            this.vx *= 0.99;
            this.vy *= 0.99;
          }
        } else {
          this.vx *= 0.99;
          this.vy *= 0.99;
        }

        this.x += (this.vx * simulationSpeedRef.current) / 100;
        this.y += (this.vy * simulationSpeedRef.current) / 100;

        const ease = (restoreSpeedRef.current / 100) * (simulationSpeedRef.current / 100);
        this.x += (this.targetX - this.x) * ease;
        this.y += (this.targetY - this.y) * ease;
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.closePath();
      }
    }

    const regenGrid = () => {
      if (canvasRef.current) {
        const XSPACING = canvasRef.current.width / VIDEO_X;
        const YSPACING = canvasRef.current.height / VIDEO_Y;
        const size = Math.min(XSPACING, YSPACING) / 2; // Half the spacing so particles don't overlap

        let index = 0;
        for (let y = 0; y < VIDEO_Y; y++) {
          for (let x = 0; x < VIDEO_X; x++) {
            particles[index].targetX = x * XSPACING + size / 2;
            particles[index].targetY = y * YSPACING + size / 2;
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
          for (let x = startingSize; x < VIDEO_X; x++) {
            particles.push(new Particle(x * XSPACING + Math.ceil(startingSize / 2), y * YSPACING + Math.ceil(startingSize / 2)));
          }
        }
      }
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      videoRef.current.playbackRate = simulationSpeedRef.current / 100.0;
      videoRef.current.defaultPlaybackRate = simulationSpeedRef.current / 100.0;

      if (volumeRef.current > 0.0) {
        videoRef.current.volume = volumeRef.current / 100.0;
        videoRef.current.muted = false;
      } else {
        videoRef.current.muted = true;
      }

      // handle updating dead elements
      collisionElements.forEach((element) => {
        if (visibleUIRef.current && !element.elementObject) {
          element.tryUpdateElement(element.elementName);
        } else {
          element.elementObject = null;
        }

        if (element) {
          element.recalculate()
        }
      })

      // Adjust particle count when scaling changes
      const currentParticleCount = particles.length;
      if (currentParticleCount < calculateTotalParticles()) {
        for (let i = currentParticleCount; i < calculateTotalParticles(); i++) {
          const x = Math.random() * canvas.width;
          const y = Math.random() * canvas.height;
          particles.push(new Particle(x, y));
        }
      } else if (currentParticleCount > calculateTotalParticles()) {
        particles.splice(calculateTotalParticles());
      }

      // console.log(Object.getOwnPropertyNames(videoRef.current))
      const frameData = videoRef.current
      vidCtx.drawImage(frameData, 0, 0)
      const imageData = vidCtx.getImageData(0, 0, 480, 360);
      const pixels = imageData.data; // Uint8ClampedArray
      const arr_data = reduceArraySize(flattenRGBAarray(pixels))
      let index = 0;

      regenGrid()

      particles.forEach((particle) => {
        const col = arr_data[index] === 0 ? themeRef.current.primary : themeRef.current.accent;
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
    themeRef.current = theme;
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
        loop={true}
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
          <div style={{ zIndex: 3000 }} >
            <ChangerGroup
              valueArrays={[
                {
                  title: "Simulation Speed:",
                  valueRef: simulationSpeedRef,
                  minValue: "1",
                  maxValue: "400.0",
                  type: "slider",
                },
                {
                  title: "Scaling:",
                  valueRef: scaleRef,
                  minValue: "2",
                  maxValue: "8",
                  type: "slider",
                },
                {
                  title: "Restore Speed:",
                  valueRef: restoreSpeedRef,
                  minValue: "1",
                  maxValue: "99",
                  type: "slider",
                },
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
                {
                  title: "Volume:",
                  valueRef: volumeRef,
                  minValue: "0.0",
                  maxValue: "100.0",
                  type: "slider",
                },

              ]}
              rerenderSetter={setRender}
            />

            <IconGroup icons={
              [{ type: 'MOUSE' },
              ]
            } />
          </div>

        )
      }
    </>
  );
}
