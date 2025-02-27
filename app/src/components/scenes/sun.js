import React, { useEffect, useRef } from "react";
import defaultColours from "../../themes/themes";

export default function Sun() {
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext("2d");
    let blocks = [];
    const blockCount = 50;
    let animationFrameId;

    const handleMouseMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      mousePosRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };

    class Block {
      constructor(x, y, size) {
        this.x = x;
        this.y = y;
        this.size = size;
        this.color = defaultColours.secondary;
      }

      draw() {
        const dx = this.x + this.size / 2 - mousePosRef.current.x;
        const dy = this.y + this.size / 2 - mousePosRef.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const shadowLength = Math.min(100, 2000 / distance);

        const shadowX = (dx / distance) * shadowLength;
        const shadowY = (dy / distance) * shadowLength;

        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.size, this.size);

        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.beginPath();
        ctx.moveTo(this.x + this.size, this.y + this.size);
        ctx.lineTo(this.x + this.size + shadowX, this.y + this.size + shadowY);
        ctx.lineTo(this.x + shadowX, this.y + shadowY);
        ctx.lineTo(this.x, this.y);
        ctx.closePath();
        ctx.fill();
      }
    }

    function initBlocks() {
      for (let i = 0; i < blockCount; i++) {
        const size = Math.random() * 50 + 20;
        const x = Math.random() * (canvas.width - size);
        const y = Math.random() * (canvas.height - size);
        blocks.push(new Block(x, y, size));
      }
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      blocks.forEach((block) => {
        block.draw();
      });
      animationFrameId = requestAnimationFrame(animate);
    }

    initBlocks();
    animate();

    canvas.addEventListener("mousemove", handleMouseMove);

    return () => {
      cancelAnimationFrame(animationFrameId);
      canvas.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
      }}
    />
  );
}
