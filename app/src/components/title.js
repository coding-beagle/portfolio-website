import { useEffect, useState } from "react";
import defaultColours from "../themes/themes";
import Snow from "./scenes/snow";
import Rain from "./scenes/rain";

const Scenes = {
  SNOW: 0,
  RAIN: 1,
  SUN: 2,
};

export default function Title() {
  const [isHover, setIsHover] = useState(false);
  const [currentScene, setCurrentScene] = useState(
    Math.floor(Math.random() * Object.keys(Scenes).length)
  );
  const [clicked, setClicked] = useState(false);

  useEffect(() => {
    if (clicked) {
      setTimeout(() => {
        setClicked(false);
      }, 150);
    }
  }, [clicked]);

  const renderScene = () => {
    switch (currentScene) {
      case Scenes.SNOW:
        return <Snow />;
      case Scenes.RAIN:
        return <Rain />;
      default:
        return;
    }
  };

  const getRandomShake = () => {
    const shakes = [
      "rotate(-5deg)",
      "rotate(5deg)",
      "translateX(-5px)",
      "translateX(5px)",
      "translateY(-5px)",
      "translateY(5px)",
    ];
    return shakes[Math.floor(Math.random() * shakes.length)];
  };

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
      {renderScene()}
      <header
        onMouseEnter={() => setIsHover(true)}
        onMouseLeave={() => setIsHover(false)}
        onMouseDown={() => {
          setClicked(true);
          setCurrentScene((currentScene + 1) % Object.keys(Scenes).length);
        }}
        style={{
          fontSize: "8em",
          textAlign: "center",
          color: isHover ? defaultColours.secondary : defaultColours.accent,
          fontWeight: "bold",
          zIndex: 10,
          transition: "color 0.5s ease, transform 0.5s ease",
          position: "relative",
          WebkitUserSelect: "none",
          WebkitTouchCallout: "none",
          KhtmlUserSelect: "none",
          MozUserSelect: "none",
          userSelect: "none",
          msUserSelect: "none",
          transform: clicked ? `scale(1.05) ${getRandomShake()}` : "scale(1)",
        }}
      >
        Nicholas Teague
      </header>
    </div>
  );
}
