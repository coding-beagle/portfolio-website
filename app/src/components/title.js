import { useState } from "react";
import defaultColours from "../themes/themes";
import Tracks from "./circuit_track";

export default function Title() {
  const [isHover, setIsHover] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        flexDirection: "column",
        position: "relative",
      }}
    >
      <svg
        width="100%"
        height="100%"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: 1,
        }}
      >
        <Tracks hovering={isHover} line_path="M 200,50 350,50, 350,100" />
        <Tracks hovering={isHover} line_path="M 1200,50 1350,50, 1350,100" />
      </svg>
      <header
        onMouseEnter={() => setIsHover(true)}
        onMouseLeave={() => setIsHover(false)}
        style={{
          fontSize: "12em",
          textAlign: "center",
          color: isHover ? defaultColours.secondary : defaultColours.accent,
          fontWeight: "bold",
          zIndex: 10,
          transition: "color 0.3s ease, transform 0.3s ease",
          position: "relative",
          transform: isHover ? "rotate(2deg)" : "rotate(0deg)",
        }}
      >
        Nicholas Teague
      </header>
    </div>
  );
}
