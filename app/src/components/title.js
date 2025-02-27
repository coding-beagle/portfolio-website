import { useEffect, useState } from "react";
import defaultColours from "../themes/themes";
import Snow from "./scenes/snow";
import Rain from "./scenes/rain";
import Sun from "./scenes/sun";
import { Drawer, Button } from "antd";

const Scenes = {
  SNOW: 0,
  RAIN: 1,
  SUN: 2,
};

export default function Title() {
  const [isHover, setIsHover] = useState(false);
  const [isHoverLinks, setIsHoverLinks] = useState(false);
  const [currentScene, setCurrentScene] = useState(
    Math.floor(Math.random() * Object.keys(Scenes).length)
  );
  const [clicked, setClicked] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);

  const showDrawer = () => {
    setDrawerVisible(true);
  };
  const onClose = () => {
    setDrawerVisible(false);
  };

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
      // case Scenes.SUN: // need to let this cook a bit
      //   return <Sun />;
      default:
        return;
    }
  };

  const getRandomShake = () => {
    return `rotate(${Math.random() * 10 - 5}deg)`;
  };

  return (
    <>
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
        <header
          onMouseEnter={() => setIsHoverLinks(true)}
          onMouseLeave={() => setIsHoverLinks(false)}
          onMouseDown={() => setDrawerVisible(true)}
          style={{
            fontSize: "3em",
            textAlign: "center",
            color: isHoverLinks
              ? defaultColours.secondary
              : defaultColours.accent,
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
          More
        </header>
      </div>
      <div style={{ position: "absolute", top: "1em", left: "1em" }}>
        <Drawer
          title="Basic Drawer"
          placement="right"
          closable={false}
          onClose={onClose}
          visible={drawerVisible}
        >
          <p>About Me</p>
          <p>Projects</p>
        </Drawer>
      </div>
    </>
  );
}
