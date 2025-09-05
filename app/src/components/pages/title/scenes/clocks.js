import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";

// named enum for convenience innit
const NAMED_ANGLE = {
  NINETY: 0.0,
  ONE_EIGHTY: Math.PI / 2.0,
  TWO_SEVENTY: Math.PI,
  ZERO: 3 * Math.PI / 2.0,
  UNUSED: 5 * Math.PI / 4.0,
}

const CPOS = {
  UNUSED: [NAMED_ANGLE.UNUSED, NAMED_ANGLE.UNUSED],
  TOP_LEFT: [NAMED_ANGLE.ONE_EIGHTY, NAMED_ANGLE.NINETY],
  TOP_RIGHT: [NAMED_ANGLE.TWO_SEVENTY, NAMED_ANGLE.ONE_EIGHTY],
  HORIZONTAL: [NAMED_ANGLE.NINETY, NAMED_ANGLE.TWO_SEVENTY],
  VERTICAL: [NAMED_ANGLE.ZERO, NAMED_ANGLE.ONE_EIGHTY],
  BOTTOM_LEFT: [NAMED_ANGLE.ZERO, NAMED_ANGLE.NINETY],
  BOTTOM_RIGHT: [NAMED_ANGLE.ZERO, NAMED_ANGLE.TWO_SEVENTY],
}

const clock_angle_dict = {
  0: [CPOS.TOP_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.TOP_RIGHT,
  CPOS.VERTICAL, CPOS.TOP_LEFT, CPOS.TOP_RIGHT, CPOS.VERTICAL,
  CPOS.VERTICAL, CPOS.VERTICAL, CPOS.VERTICAL, CPOS.VERTICAL,
  CPOS.VERTICAL, CPOS.VERTICAL, CPOS.VERTICAL, CPOS.VERTICAL,
  CPOS.VERTICAL, CPOS.BOTTOM_LEFT, CPOS.BOTTOM_RIGHT, CPOS.VERTICAL,
  CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.BOTTOM_RIGHT
  ],
  1: [CPOS.UNUSED, CPOS.TOP_LEFT, CPOS.TOP_RIGHT, CPOS.UNUSED,
  CPOS.UNUSED, CPOS.VERTICAL, CPOS.VERTICAL, CPOS.UNUSED,
  CPOS.UNUSED, CPOS.VERTICAL, CPOS.VERTICAL, CPOS.UNUSED,
  CPOS.UNUSED, CPOS.VERTICAL, CPOS.VERTICAL, CPOS.UNUSED,
  CPOS.UNUSED, CPOS.VERTICAL, CPOS.VERTICAL, CPOS.UNUSED,
  CPOS.UNUSED, CPOS.BOTTOM_LEFT, CPOS.BOTTOM_RIGHT, CPOS.UNUSED
  ],
  0: [CPOS.TOP_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.TOP_RIGHT,
  CPOS.VERTICAL, CPOS.TOP_LEFT, CPOS.TOP_RIGHT, CPOS.VERTICAL,
  CPOS.VERTICAL, CPOS.VERTICAL, CPOS.VERTICAL, CPOS.VERTICAL,
  CPOS.VERTICAL, CPOS.VERTICAL, CPOS.VERTICAL, CPOS.VERTICAL,
  CPOS.VERTICAL, CPOS.BOTTOM_LEFT, CPOS.BOTTOM_RIGHT, CPOS.VERTICAL,
  CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.BOTTOM_RIGHT
  ],
  8: [CPOS.TOP_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.TOP_RIGHT,
  CPOS.VERTICAL, CPOS.TOP_LEFT, CPOS.TOP_RIGHT, CPOS.VERTICAL,
  CPOS.VERTICAL, CPOS.BOTTOM_LEFT, CPOS.BOTTOM_RIGHT, CPOS.VERTICAL,
  CPOS.VERTICAL, CPOS.TOP_LEFT, CPOS.TOP_RIGHT, CPOS.VERTICAL,
  CPOS.VERTICAL, CPOS.BOTTOM_LEFT, CPOS.BOTTOM_RIGHT, CPOS.VERTICAL,
  CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.BOTTOM_RIGHT
  ]
}

export default function Clocks({ visibleUI }) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const digitRef = useRef(null);
  const target_hr_ref = useRef(0.0);
  const target_min_ref = useRef(0.0);
  const colorRef = useRef(theme.accent);
  const [, setRender] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    // const titleShieldRadius = 30;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // recalculateRect();
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    const ctx = canvas.getContext("2d");

    const maxSpeed = 1;
    let animationFrameId;

    class Clock {
      constructor(x, y, min_hand, hr_hand, radius) {
        this.x = x;
        this.y = y;
        this.size = radius;
        this.min_hand_angle = min_hand;
        this.hr_hand_angle = hr_hand;

        this.hr_hand_speed = Math.max(Math.random() * 0.01, 0.02);
        this.min_hand_speed = Math.max(Math.random() * 0.01, 0.02);

        this.target_min_hand_angle = 0.0;
        this.target_hr_hand_angle = 0.0;

        this.strokeColor = theme.text;
      }

      update() {

        const error_hr_hand = (this.target_hr_hand_angle - this.hr_hand_angle);
        this.hr_hand_angle += error_hr_hand / 200.0;


        const error_min_hand = (this.target_min_hand_angle - this.min_hand_angle);
        this.min_hand_angle += error_min_hand / 200.0;


        this.min_hand_angle %= 2 * Math.PI;
        this.hr_hand_angle %= 2 * Math.PI;

        // console.log(this.target_hr_hand_angle, this.hr_hand_angle);
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.closePath();

        ctx.strokeStyle = this.strokeColor;

        // draw min hand
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineWidth = 2;
        const min_hand_end_x = this.size * Math.cos(this.min_hand_angle) + this.x;
        const min_hand_end_y = this.size * Math.sin(this.min_hand_angle) + this.y;
        ctx.lineTo(min_hand_end_x, min_hand_end_y);
        ctx.stroke();
        ctx.closePath();

        // draw hr hand
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineWidth = 2;
        const hr_hand_end_x = this.size * Math.cos(this.hr_hand_angle) + this.x;
        const hr_hand_end_y = this.size * Math.sin(this.hr_hand_angle) + this.y;
        ctx.lineTo(hr_hand_end_x, hr_hand_end_y);
        ctx.stroke();
        ctx.closePath();
      }
    }

    class Digit {
      constructor(x, y, width) {
        this.clocks = [];
        const clock_radius = width / 4;
        for (let y_gap = 0; y_gap < 6; y_gap++) {
          for (let x_gap = 0; x_gap < 4; x_gap++) {
            const clock_x = x + clock_radius / 2 + x_gap * clock_radius * 2;
            const clock_y = y + clock_radius / 2 + y_gap * clock_radius * 2;
            this.clocks.push(new Clock(clock_x, clock_y, Math.random() * 2 * Math.PI, Math.random() * 2 * Math.PI, clock_radius))
          }
        }
      }

      update() {
        this.clocks.forEach((clock) => {
          clock.update();
        })
      }

      draw() {
        this.clocks.forEach((clock) => {
          clock.draw();
        })
      }

      set_clock_angles(clock_index, angle_1, angle_2) {
        this.clocks[clock_index].target_hr_hand_angle = angle_1;
        this.clocks[clock_index].target_min_hand_angle = angle_2;
      }

      set_digit(pos_array) {
        this.clocks.forEach((clock, index) => {
          this.set_clock_angles(index, pos_array[index][0], pos_array[index][1]);
        })
      }

      update_clock_themes(fill, stroke) {
        this.clocks.forEach((clock) => {
          clock.color = fill;
          clock.strokeColor = stroke;
        })
      }
    }

    // let digit;

    function initParticles() {
      digitRef.current = new Digit(200, 300, 100);

    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);


      digitRef.current.update();
      // particle.target_hr_hand_angle = target_hr_ref.current / 100.0;
      // particle.target_min_hand_angle = Math.random() * 2 * Math.PI;
      digitRef.current.draw();

      digitRef.current.set_digit(clock_angle_dict[1]);

      animationFrameId = requestAnimationFrame(animate);
    }

    initParticles();
    animate();

    // Attach particles array to canvas for theme effect access
    // canvas._particles = particles;

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resizeCanvas);
      // particles = [];
    };
  }, []);

  // Update colorRef and all particles' colors on theme change
  useEffect(() => {
    colorRef.current = theme.accent;
    // Update all existing particles' colors
    const canvas = canvasRef.current;
    if (!canvas) return;
    digitRef.current.update_clock_themes(theme.accent, theme.primary);
  }, [theme]);

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
                title: 'Target Hour Hand',
                valueRef: target_hr_ref,
                minValue: "0.0",
                maxValue: "628",
                type: 'slider',
              }
            ]}
            rerenderSetter={setRender}
          />
        </div>
      )}
    </>
  );
}
