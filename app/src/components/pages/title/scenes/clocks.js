import React, { useContext, useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";
import { MobileContext } from "../../../../contexts/MobileContext";
import MouseTooltip from "../utilities/popovers";

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
  1: [CPOS.TOP_LEFT, CPOS.HORIZONTAL, CPOS.TOP_RIGHT, CPOS.UNUSED,
  CPOS.BOTTOM_LEFT, CPOS.TOP_RIGHT, CPOS.VERTICAL, CPOS.UNUSED,
  CPOS.UNUSED, CPOS.VERTICAL, CPOS.VERTICAL, CPOS.UNUSED,
  CPOS.UNUSED, CPOS.VERTICAL, CPOS.VERTICAL, CPOS.UNUSED,
  CPOS.TOP_LEFT, CPOS.BOTTOM_RIGHT, CPOS.BOTTOM_LEFT, CPOS.TOP_RIGHT,
  CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.BOTTOM_RIGHT
  ],
  2: [CPOS.TOP_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.TOP_RIGHT,
  CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.TOP_RIGHT, CPOS.VERTICAL,
  CPOS.TOP_LEFT, CPOS.HORIZONTAL, CPOS.BOTTOM_RIGHT, CPOS.VERTICAL,
  CPOS.VERTICAL, CPOS.TOP_LEFT, CPOS.HORIZONTAL, CPOS.BOTTOM_RIGHT,
  CPOS.VERTICAL, CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.TOP_RIGHT,
  CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.BOTTOM_RIGHT
  ],
  3: [CPOS.TOP_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.TOP_RIGHT,
  CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.TOP_RIGHT, CPOS.VERTICAL,
  CPOS.TOP_LEFT, CPOS.HORIZONTAL, CPOS.BOTTOM_RIGHT, CPOS.VERTICAL,
  CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.TOP_RIGHT, CPOS.VERTICAL,
  CPOS.TOP_LEFT, CPOS.HORIZONTAL, CPOS.BOTTOM_RIGHT, CPOS.VERTICAL,
  CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.BOTTOM_RIGHT
  ],
  4: [CPOS.TOP_LEFT, CPOS.TOP_RIGHT, CPOS.TOP_LEFT, CPOS.TOP_RIGHT,
  CPOS.VERTICAL, CPOS.VERTICAL, CPOS.VERTICAL, CPOS.VERTICAL,
  CPOS.VERTICAL, CPOS.BOTTOM_LEFT, CPOS.BOTTOM_RIGHT, CPOS.VERTICAL,
  CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.TOP_RIGHT, CPOS.VERTICAL,
  CPOS.UNUSED, CPOS.UNUSED, CPOS.VERTICAL, CPOS.VERTICAL,
  CPOS.UNUSED, CPOS.UNUSED, CPOS.BOTTOM_LEFT, CPOS.BOTTOM_RIGHT
  ],
  5: [CPOS.TOP_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.TOP_RIGHT,
  CPOS.VERTICAL, CPOS.TOP_LEFT, CPOS.HORIZONTAL, CPOS.BOTTOM_RIGHT,
  CPOS.VERTICAL, CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.TOP_RIGHT,
  CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.TOP_RIGHT, CPOS.VERTICAL,
  CPOS.TOP_LEFT, CPOS.HORIZONTAL, CPOS.BOTTOM_RIGHT, CPOS.VERTICAL,
  CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.BOTTOM_RIGHT
  ],
  6: [CPOS.TOP_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.TOP_RIGHT,
  CPOS.VERTICAL, CPOS.TOP_LEFT, CPOS.HORIZONTAL, CPOS.BOTTOM_RIGHT,
  CPOS.VERTICAL, CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.TOP_RIGHT,
  CPOS.VERTICAL, CPOS.TOP_LEFT, CPOS.TOP_RIGHT, CPOS.VERTICAL,
  CPOS.VERTICAL, CPOS.BOTTOM_LEFT, CPOS.BOTTOM_RIGHT, CPOS.VERTICAL,
  CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.BOTTOM_RIGHT
  ],
  7: [CPOS.TOP_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.TOP_RIGHT,
  CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.TOP_RIGHT, CPOS.VERTICAL,
  CPOS.UNUSED, CPOS.UNUSED, CPOS.VERTICAL, CPOS.VERTICAL,
  CPOS.UNUSED, CPOS.UNUSED, CPOS.VERTICAL, CPOS.VERTICAL,
  CPOS.UNUSED, CPOS.UNUSED, CPOS.VERTICAL, CPOS.VERTICAL,
  CPOS.UNUSED, CPOS.UNUSED, CPOS.BOTTOM_LEFT, CPOS.BOTTOM_RIGHT
  ],
  8: [CPOS.TOP_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.TOP_RIGHT,
  CPOS.VERTICAL, CPOS.TOP_LEFT, CPOS.TOP_RIGHT, CPOS.VERTICAL,
  CPOS.VERTICAL, CPOS.BOTTOM_LEFT, CPOS.BOTTOM_RIGHT, CPOS.VERTICAL,
  CPOS.VERTICAL, CPOS.TOP_LEFT, CPOS.TOP_RIGHT, CPOS.VERTICAL,
  CPOS.VERTICAL, CPOS.BOTTOM_LEFT, CPOS.BOTTOM_RIGHT, CPOS.VERTICAL,
  CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.BOTTOM_RIGHT
  ],
  9: [CPOS.TOP_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.TOP_RIGHT,
  CPOS.VERTICAL, CPOS.TOP_LEFT, CPOS.TOP_RIGHT, CPOS.VERTICAL,
  CPOS.VERTICAL, CPOS.BOTTOM_LEFT, CPOS.BOTTOM_RIGHT, CPOS.VERTICAL,
  CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.TOP_RIGHT, CPOS.VERTICAL,
  CPOS.TOP_LEFT, CPOS.HORIZONTAL, CPOS.BOTTOM_RIGHT, CPOS.VERTICAL,
  CPOS.BOTTOM_LEFT, CPOS.HORIZONTAL, CPOS.HORIZONTAL, CPOS.BOTTOM_RIGHT
  ]
}

export default function Clocks({ visibleUI }) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const clockRef = useRef(null);
  const moveSpeedModRef = useRef(100);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const thicknessRef = useRef(15);
  const mouseClickRef = useRef(false);
  const touchActiveRef = useRef(false);
  const mouseShieldRadiusRef = useRef(100);
  const [, setRender] = useState(0);

  const mobile = useContext(MobileContext);

  useEffect(() => {
    const canvas = canvasRef.current;
    // const titleShieldRadius = 30;

    class ClockUnit {
      constructor(x, y, min_hand, hr_hand, radius, speed_factor = 1.0) {
        this.x = x;
        this.y = y;
        this.size = radius;
        this.min_hand_angle = min_hand;
        this.hr_hand_angle = hr_hand;

        this.speed_factor = speed_factor

        // this.hr_hand_speed = Math.max(Math.random() * 0.01, 0.02);
        // this.min_hand_speed = Math.max(Math.random() * 0.01, 0.02);

        this.target_min_hand_angle = 0.0;
        this.target_hr_hand_angle = 0.0;

        this.strokeColor = theme.text;
      }

      update() {

        const error_hr_hand = (this.target_hr_hand_angle - this.hr_hand_angle);
        const error_min_hand = (this.target_min_hand_angle - this.min_hand_angle);


        const dx = mousePosRef.current.x - this.x;
        const dy = mousePosRef.current.y - this.y;

        const deltaMouse = Math.sqrt(dx ** 2 + dy ** 2);

        if ((touchActiveRef.current || mouseClickRef.current) && deltaMouse < mouseShieldRadiusRef.current) {
          this.hr_hand_angle -= Math.random() * 0.05 * moveSpeedModRef.current / 50;
          this.min_hand_angle -= Math.random() * 0.03 * moveSpeedModRef.current / 50;
        } else {
          this.hr_hand_angle += this.speed_factor * (moveSpeedModRef.current / 50.0) * error_hr_hand / 100;
          this.min_hand_angle += this.speed_factor * (moveSpeedModRef.current / 50.0) * error_min_hand / 100;
        }


        this.min_hand_angle %= 2 * Math.PI;
        this.hr_hand_angle %= 2 * Math.PI;
      }

      draw() {
        ctx.shadowColor = theme.secondaryAccent;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();


        ctx.closePath();


        ctx.strokeStyle = this.strokeColor;
        ctx.fillStyle = this.strokeColor;
        ctx.shadowColor = theme.secondary;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(this.x, this.y, thicknessRef.current / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.closePath();

        // draw min hand
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineWidth = thicknessRef.current;
        const min_hand_end_x = this.size * Math.cos(this.min_hand_angle) + this.x;
        const min_hand_end_y = this.size * Math.sin(this.min_hand_angle) + this.y;
        ctx.lineTo(min_hand_end_x, min_hand_end_y);
        ctx.stroke();
        ctx.closePath();

        // draw hr hand
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        const hr_hand_end_x = this.size * Math.cos(this.hr_hand_angle) + this.x;
        const hr_hand_end_y = this.size * Math.sin(this.hr_hand_angle) + this.y;
        ctx.lineTo(hr_hand_end_x, hr_hand_end_y);
        ctx.stroke();
        ctx.closePath();
      }
    }

    class Digit {
      constructor(x, y, width, speed_factor) {
        this.clocks = [];
        this.speed_factor = speed_factor
        this.init_clocks(x, y, width, speed_factor)
      }

      init_clocks(x, y, width, speed_factor = this.speed_factor) {
        const clock_radius = width / 8;
        for (let y_gap = 0; y_gap < 6; y_gap++) {
          for (let x_gap = 0; x_gap < 4; x_gap++) {
            const clock_x = x + clock_radius / 2 + x_gap * clock_radius * 2;
            const clock_y = y + clock_radius / 2 + y_gap * clock_radius * 2;
            this.clocks.push(new ClockUnit(clock_x, clock_y, Math.random() * 2 * Math.PI, Math.random() * 2 * Math.PI, clock_radius, speed_factor))
          }
        }
      }

      update_position(x, y, width, line_thickness) {
        const clock_radius = width / 8;
        let index = 0;
        for (let y_gap = 0; y_gap < 6; y_gap++) {
          for (let x_gap = 0; x_gap < 4; x_gap++) {
            const clock_x = x + clock_radius / 2 + x_gap * clock_radius * 2;
            const clock_y = y + clock_radius / 2 + y_gap * clock_radius * 2;
            this.clocks[index].x = clock_x;
            this.clocks[index].y = clock_y;
            this.clocks[index].size = clock_radius;
            this.clocks[index].thickness = line_thickness;
            index++;
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

    class DigitalAnalogClock {
      constructor(x, y, width) {
        this.seconds = 0;
        this.minutes = 0;
        this.hours = 0;

        this.x = x;
        this.y = y;

        this.faces = []

        if (!mobile) {
          const one_clock_width = width / 6;
          const hours_msd = new Digit(this.x, this.y, one_clock_width);
          const hours_lsd = new Digit(this.x + one_clock_width, this.y, one_clock_width);

          const mins_msd = new Digit(this.x + 2 * one_clock_width, this.y, one_clock_width);
          const mins_lsd = new Digit(this.x + 3 * one_clock_width, this.y, one_clock_width);

          const secs_msd = new Digit(this.x + 4 * one_clock_width, this.y, one_clock_width, 6);
          const secs_lsd = new Digit(this.x + 5 * one_clock_width, this.y, one_clock_width, 6);

          this.faces.push(hours_msd, hours_lsd, mins_msd, mins_lsd, secs_msd, secs_lsd)
        } else {
          const one_clock_width = width / 6;
          const one_clock_height = width / 4;
          const hours_msd = new Digit(this.x, this.y, one_clock_width);
          const hours_lsd = new Digit(this.x + one_clock_width, this.y, one_clock_width);

          const mins_msd = new Digit(this.x, this.y + one_clock_height, one_clock_width);
          const mins_lsd = new Digit(this.x + one_clock_width, this.y + one_clock_height, one_clock_width);
          this.faces.push(hours_msd, hours_lsd, mins_msd, mins_lsd)
        }
      }

      update_position_and_size(x, y, width) {

        if (!mobile) {
          const one_clock_width = width / 6;

          this.faces.forEach((face, index) => {
            face.update_position(x + one_clock_width * index, y, one_clock_width)
          })

        } else {
          const one_clock_width = width / 6;
          const one_clock_height = width / 4;
          this.faces[0].update_position(this.x, this.y, one_clock_width);
          this.faces[1].update_position(this.x + one_clock_width, this.y, one_clock_width);

          this.faces[2].update_position(this.x, this.y + one_clock_height, one_clock_width);
          this.faces[3].update_position(this.x + one_clock_width, this.y + one_clock_height, one_clock_width);
        }
      }

      left_pad_and_split_number(input_number) {
        const num_zero_padded = String(input_number).padStart(2, '0')
        return [Number(num_zero_padded[0]), Number(num_zero_padded[1])]
      }

      update() {

        const hour_split = this.left_pad_and_split_number(this.hours);
        const min_split = this.left_pad_and_split_number(this.minutes);
        const sec_split = this.left_pad_and_split_number(this.seconds);

        const num_array = [hour_split[0], hour_split[1],
        min_split[0], min_split[1],
        sec_split[0], sec_split[1],
        ]

        this.faces.forEach((digit, index) => {
          digit.update()
          digit.set_digit(clock_angle_dict[num_array[index]])
        })
      }

      update_num() {
        const date = new Date()
        this.hours = date.getHours()
        this.minutes = date.getMinutes()
        this.seconds = date.getSeconds()
      }

      draw() {
        this.faces.forEach((digit) => {
          digit.draw();
        })
      }

      update_and_draw() {
        this.update()
        this.draw()
      }

      update_clock_themes(fill, stroke) {
        this.faces.forEach((face) => {
          face.update_clock_themes(fill, stroke);
        })
      }
    }

    function calculate_clock_position() {
      let clock_width, clock_start_x, clock_start_y, clock_height;
      if (!mobile) {
        clock_width = 0.9 * canvas.width;
        clock_start_x = 0.05 * canvas.width;
        clock_height = (clock_width / 4)
        clock_start_y = (canvas.height - clock_height) / 2;
      } else {
        clock_width = 2.5 * canvas.width;
        clock_start_x = 0.1 * canvas.width;
        clock_height = (clock_width / 4)
        clock_start_y = (canvas.height - clock_height) / 4;
      }


      return { start_x: clock_start_x, start_y: clock_start_y, width: clock_width }
    }

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      if (clockRef.current) {
        const size = calculate_clock_position()
        clockRef.current.update_position_and_size(size.start_x, size.start_y, size.width);
      }
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    const ctx = canvas.getContext("2d");

    let animationFrameId;

    function initParticles() {
      const size = calculate_clock_position()
      clockRef.current = new DigitalAnalogClock(size.start_x, size.start_y, size.width);
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      clockRef.current.update_num();

      clockRef.current.update();
      clockRef.current.draw();

      animationFrameId = requestAnimationFrame(animate);
    }

    initParticles();
    animate();

    // Attach particles array to canvas for theme effect access
    // canvas._particles = particles;

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

    window.addEventListener("pointermove", handleMouseMove);
    window.addEventListener("pointerdown", handleMouseDown);
    window.addEventListener("pointerup", handleMouseUp);
    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchstart", handleTouchStart);
    window.addEventListener("touchend", handleTouchEnd);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resizeCanvas);
      clockRef.current = null;

      window.removeEventListener("pointermove", handleMouseMove);
      window.removeEventListener("pointerdown", handleMouseDown);
      window.removeEventListener("pointerup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [mobile]);

  // Update colorRef and all particles' colors on theme change
  useEffect(() => {
    // Update all existing particles' colors
    const canvas = canvasRef.current;
    if (!canvas) return;
    clockRef.current.update_clock_themes(theme.secondaryAccent, theme.secondary);
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
                title: "Simulation Speed:",
                valueRef: moveSpeedModRef,
                minValue: "1",
                maxValue: "200.0",
                type: "slider",
              },
              {
                title: "Click Effect Radius:",
                valueRef: mouseShieldRadiusRef,
                minValue: "10.0",
                maxValue: "300.0",
                type: "slider",
              },
              {
                title: "Hand Thickness:",
                valueRef: thicknessRef,
                minValue: "1",
                maxValue: "30",
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
