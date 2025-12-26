import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";

export default function BadApple({ visibleUI }) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const videoCanvasRef = useRef(null);
  const videoRef = useRef(null);
  const particleCountRef = useRef(200);
  // const simulationSpeedRef = useRef(100);

  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const touchActiveRef = useRef(false);

  const scaleRef = useRef(4);
  const colorRef = useRef(theme.accent);
  const [, setRender] = useState(0);

  const VID_WIDTH = 480;
  const VID_HEIGHT = 360;

  // const SCALE_FACTOR = scaleRef.current;
  let VIDEO_X = VID_WIDTH / scaleRef.current;
  let VIDEO_Y = VID_HEIGHT / scaleRef.current;

  useEffect(() => {
    const canvas = canvasRef.current;
    const vidCanvas = videoCanvasRef.current;
    // const titleShieldRadius = 30;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // recalculateRect();
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

    class Particle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.dx = 0;
        this.dy = 0;
        this.targetX = x;
        this.targetY = y;
        const XSPACING = canvasRef.current.width / VIDEO_X;
        const YSPACING = canvasRef.current.height / VIDEO_Y;
        this.size = Math.min(XSPACING, YSPACING) / 2; // Half the spacing so particles don't overlap
        this.color = colorRef.current;
      }

      resize(size) {
        this.size = size;
      }

      update(color) {
        this.color = color;

        // make this move towards the target position
        if (Math.abs(this.targetX - this.x) > 2.0) {
          this.dx = this.targetX - this.x;
        }
        if (Math.abs(this.targetY - this.y) > 2.0) {
          this.dy = this.targetY - this.y;
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

    const regenGrid = () => {
      if (canvasRef.current) {
        const XSPACING = canvasRef.current.width / VIDEO_X;
        const YSPACING = canvasRef.current.height / VIDEO_Y;
        let index = 0;
        for (let y = 0; y < VIDEO_Y; y++) {
          for (let x = 0; x < VIDEO_X; x++) {
            particles[index].x = x * XSPACING;
            particles[index].y = y * YSPACING
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

      // Adjust particle count
      // const currentParticleCount = particles.length;
      // if (currentParticleCount < particleCountRef.current) {
      //   for (let i = currentParticleCount; i < particleCountRef.current; i++) {
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

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resizeCanvas);
      particles = [];
    };
  }, []);

  // Update colorRef and all particles' colors on theme change
  useEffect(() => {
    colorRef.current = theme.accent;
    // Update all existing particles' colors
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
                  title: "Scaling:",
                  valueRef: scaleRef,
                  minValue: "1",
                  maxValue: "8",
                  type: "slider",
                },
                // {
                //   title: "Simulation Speed:",
                //   valueRef: simulationSpeedRef,
                //   minValue: "1",
                //   maxValue: "200.0",
                //   type: "slider",
                // },
              ]}
              rerenderSetter={setRender}
            />
          </div>
        )
      }
    </>
  );
}
