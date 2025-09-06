import React, { useContext, useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";
import { MobileContext } from "../../../../contexts/MobileContext";

export default function Life({ visibleUI }) {
  const myBirthday = new Date("July 12, 2004");
  const mobile = useContext(MobileContext);
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const selectedDate = useRef(0);
  const lifeRef = useRef(0);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const [birthdate, setBirthdate] = useState({ $d: myBirthday });
  const [lifeExpectancy, setLifeExpectancy] = useState(80);
  const colorRef = useRef(theme.accent);
  const [, setRender] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      calculate();
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    function diff_weeks(dt2, dt1) {
      // Calculate the difference in milliseconds between dt2 and dt1
      var diff = (dt2.getTime() - dt1.getTime()) / 1000;
      // Convert the difference from milliseconds to weeks by dividing it by the number of milliseconds in a week
      diff /= 60 * 60 * 24 * 7;
      // Return the absolute value of the rounded difference as the result
      return Math.abs(Math.round(diff));
    }

    function calculate() {
      const birthdayDate = birthdate?.$d;
      let deathDate = null;

      if (birthdayDate) {
        deathDate = new Date(birthdayDate?.valueOf());
        deathDate.setFullYear(birthdayDate.getFullYear() + lifeExpectancy);
        const current_date = new Date();

        const total_weeks = diff_weeks(birthdayDate, deathDate);
        const current_weeks = diff_weeks(current_date, birthdayDate);
        // round up to three dp precision
        lifeRef.current = `${Math.round((current_weeks / total_weeks) * 100000) / 1000
          } %`;

        const boxPadding = 3;

        const numColumns = mobile ? 52 : 52 * 3;
        const numRows = total_weeks / numColumns;
        const boxSize = mobile
          ? canvasRef.current.width / 52 - boxPadding
          : canvasRef.current.width / (52 * 3) - boxPadding;
        const offsetX = boxSize + boxPadding;
        const offsetY = boxSize + boxPadding;

        for (let rows = 0; rows < numRows; rows++)
          for (let columns = 0; columns < numColumns; columns++) {
            ctx.fillStyle =
              columns + rows * numColumns < current_weeks
                ? theme.accent
                : theme.secondary;
            ctx.beginPath();

            const current_week = (rows * numColumns + columns)
            if (current_week > total_weeks) { return }

            if (mobile) {
              const dy = mousePosRef.current.y - rows * offsetX + boxSize / 2;
              const dx = mousePosRef.current.x - columns * offsetY + boxSize / 2;
              if (Math.sqrt(dx ** 2 + dy ** 2) < boxSize / 2) {
                ctx.fillStyle = theme.secondaryAccent;
                selectedDate.current = `${Math.round((current_week / total_weeks) * 100000) / 1000} %`
              }
              ctx.rect(columns * offsetY, rows * offsetX, boxSize, boxSize);
            } else {
              const dy = rows * offsetX + canvasRef.current.height / 3 + boxSize / 2 - mousePosRef.current.y;
              const dx = columns * offsetY + boxSize / 2 - mousePosRef.current.x;

              if (Math.sqrt(dx ** 2 + dy ** 2) < boxSize / 2) {
                ctx.fillStyle = theme.secondaryAccent;
                selectedDate.current = `${Math.round((current_week / total_weeks) * 100000) / 1000} %`
              }

              ctx.rect(
                columns * offsetY,
                rows * offsetX + canvasRef.current.height / 3,
                boxSize,
                boxSize
              );
            }

            ctx.fill();
          }
      }
    }

    calculate();

    const handleMouseMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      mousePosRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
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

    let animationFrameId

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      calculate();
      animationFrameId = requestAnimationFrame(animate);
    }

    animate();

    window.addEventListener("pointermove", handleMouseMove);
    window.addEventListener("touchmove", handleTouchMove);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("pointermove", handleMouseMove);
      window.removeEventListener("touchmove", handleTouchMove);
    };
  }, [birthdate, lifeExpectancy, theme]);

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
                title: "Life expectancy:",
                type: "slider",
                valueRef: lifeExpectancy,
                valueSetter: setLifeExpectancy,
                minValue: 1,
                maxValue: 100,
                isState: true,
              },
              {
                title: "Birthday:",
                type: "date",
                callback: setBirthdate,
                defaultVal: "2004-07-12",
              },
              {
                title: "Percent of life lived:",
                valueRef: lifeRef,
                type: "display",
              },
              {
                title: "Hovered Date",
                valueRef: selectedDate,
                type: "display",
              },
            ]}
            rerenderSetter={setRender}
          />
        </div>
      )}
    </>
  );
}
