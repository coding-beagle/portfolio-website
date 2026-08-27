import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import { IconGroup } from "../utilities/popovers";
import { addColour, ElementCollisionHitbox } from "../utilities/usefulFunctions";
import {
  useCanvasScene,
  SceneCanvas,
  createPointerTracker,
  clearCanvas,
} from "../utilities/engine";

export default function BadApple({ visibleUI }) {
  const { theme } = useTheme();
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
  const particlesRef = useRef([]);
  const [, setRender] = useState(0);

  const VID_WIDTH = 480;
  const VID_HEIGHT = 360;

  const canvasRef = useCanvasScene(({ canvas, ctx, onCleanup }) => {
    const vidCanvas = videoCanvasRef.current;

    // How many source pixels each on-screen dot stands for; driven by the
    // resolution slider, so it changes while the video plays.
    let VIDEO_X = VID_WIDTH / scaleRef.current;
    let VIDEO_Y = VID_HEIGHT / scaleRef.current;

    const titleHitbox = new ElementCollisionHitbox("title", 20)
    const iconsHitbox = new ElementCollisionHitbox("linkIcons", 20)
    const changerGroupHitbox = new ElementCollisionHitbox("changerGroup", 20)
    const iconGroupHitbox = new ElementCollisionHitbox("iconGroup", 20)

    const collisionElements = [titleHitbox, iconsHitbox, changerGroupHitbox, iconGroupHitbox];

    const recalculateRect = () => {
      collisionElements.forEach((hitbox) => { hitbox.recalculate() })
    };
    recalculateRect();

    const vidCtx = vidCanvas.getContext("2d");

    let particles = [];
    particlesRef.current = particles;

    onCleanup(
      createPointerTracker(canvas, {
        posRef: mousePosRef,
        downRef: mouseClickRef,
        touchActiveRef,
      })
    );

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

    const XSPACING = canvas.width / VIDEO_X;
    const YSPACING = canvas.height / VIDEO_Y;
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
        this.color = themeRef.current.accent;
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

    /** Re-aim every dot at its cell centre after a resize or scale change. */
    const regenGrid = () => {
      const XSPACING = canvas.width / VIDEO_X;
      const YSPACING = canvas.height / VIDEO_Y;
      const size = Math.min(XSPACING, YSPACING) / 2;

      let index = 0;
      for (let y = 0; y < VIDEO_Y; y++) {
        for (let x = 0; x < VIDEO_X; x++) {
          particles[index].targetX = x * XSPACING + size / 2;
          particles[index].targetY = y * YSPACING + size / 2;
          index++;
        }
      }
    }

    function initParticles() {
      const XSPACING = canvas.width / VIDEO_X;
      const YSPACING = canvas.height / VIDEO_Y;
      for (let y = 0; y < VIDEO_Y; y++) {
        for (let x = startingSize; x < VIDEO_X; x++) {
          particles.push(new Particle(x * XSPACING + Math.ceil(startingSize / 2), y * YSPACING + Math.ceil(startingSize / 2)));
        }
      }
    }

    function animate() {
      clearCanvas(ctx, canvas);

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
        const XSPACING = canvas.width / VIDEO_X;
        const YSPACING = canvas.height / VIDEO_Y;
        particle.resize(Math.min(XSPACING, YSPACING) / 2);
        particle.draw();
        index++;
      });
    }

    initParticles();

    return {
      onResize: recalculateRect,
      frame: animate,
      cleanup: () => {
        particles = [];
        particlesRef.current = [];
      },
    };
  }, []);

  useEffect(() => {
    visibleUIRef.current = visibleUI;
  }, [visibleUI]);

  // Recolour in place, without restarting the video.
  useEffect(() => {
    themeRef.current = theme;
    particlesRef.current.forEach((particle) => {
      particle.color = theme.accent;
    });
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
      <SceneCanvas ref={canvasRef} />

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
                  type: CHANGER_TYPE.SLIDER,
                },
                {
                  title: "Scaling:",
                  valueRef: scaleRef,
                  minValue: "2",
                  maxValue: "8",
                  type: CHANGER_TYPE.SLIDER,
                },
                {
                  title: "Restore Speed:",
                  valueRef: restoreSpeedRef,
                  minValue: "1",
                  maxValue: "99",
                  type: CHANGER_TYPE.SLIDER,
                },
                {
                  title: "Click Radius:",
                  valueRef: mouseShieldRadiusRef,
                  minValue: "10.0",
                  maxValue: "300.0",
                  type: CHANGER_TYPE.SLIDER,
                },
                {
                  title: "Click Strength:",
                  valueRef: mouseDisplacementStrengthRef,
                  minValue: "1.0",
                  maxValue: "100.0",
                  type: CHANGER_TYPE.SLIDER,
                },
                {
                  title: "Volume:",
                  valueRef: volumeRef,
                  minValue: "0.0",
                  maxValue: "100.0",
                  type: CHANGER_TYPE.SLIDER,
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
