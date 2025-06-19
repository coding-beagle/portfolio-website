import React, { useContext, useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";
import { MobileContext } from "../../../../contexts/MobileContext";

export default function Life() {
  const myBirthday = new Date("July 12, 2004");
  const mobile = useContext(MobileContext);
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const lifeRef = useRef(0);
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
        const current_weeks = diff_weeks(birthdayDate, current_date);
        lifeRef.current = `${
          Math.round((current_weeks / total_weeks) * 100000) / 1000
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
            if (mobile) {
              ctx.rect(columns * offsetY, rows * offsetX, boxSize, boxSize);
            } else {
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

    return () => {
      window.removeEventListener("resize", resizeCanvas);
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
          ]}
          rerenderSetter={setRender}
        />
      </div>
    </>
  );
}
