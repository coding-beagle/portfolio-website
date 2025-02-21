import { useState } from "react";
import defaultColours from "../themes/themes";

export default function Title() {
  const [isHover, setIsHover] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
      }}
    >
      <svg width="400" height="100">
        <track hovering={isHover} line_path={"M 200,50 350,50"} />
      </svg>
      <header
        onMouseEnter={() => setIsHover(true)}
        onMouseLeave={() => setIsHover(false)}
        style={{
          fontSize: "12em",
          textAlign: "center",
          padding: "1em",
          color: isHover ? defaultColours.secondary : defaultColours.accent,
          fontWeight: "bold",
          zIndex: 10,
          transition: "color 0.3s ease",
        }}
      >
        Nicholas Teague
      </header>
    </div>
  );
}
