import { useEffect, useState, createElement } from "react";
import defaultColours from "../../../themes/themes";
import Snow from "./scenes/snow";
import Rain from "./scenes/rain";
import Stars from "./scenes/stars";
import Boids from "./scenes/boids";
import {
  faGithub,
  faLinkedin,
  faYoutube,
} from "@fortawesome/free-brands-svg-icons";
import IconHover from "./iconHover";
import Conway from "./scenes/conway";
// import WindTunnel from "./scenes/windtunnel";
import Hexapod from "./scenes/hexapod";
import Mandelbrot from "./scenes/mandelbrot";
import Plants from "./scenes/plants";
import Fire from "./scenes/fire";
import Fireworks from "./scenes/firework";

const Scenes = {
  0: Snow,
  1: Rain,
  2: Plants,
  3: Stars,
  4: Boids,
  5: Conway,
  6: Hexapod,
  7: Mandelbrot,
  8: Fire,
  9: Fireworks,
};

export default function Title({ text = "Nicholas Teague", initialScene = "" }) {
  const [isHover, setIsHover] = useState(false);
  const [currentScene, setCurrentScene] = useState(
    Math.floor(Math.random() * Object.keys(Scenes).length)
  );

  const [clicked, setClicked] = useState(false);

  useEffect(() => {
    if (initialScene === "") {
      setCurrentScene(Math.floor(Math.random() * Object.keys(Scenes).length));
    } else {
      if (Scenes[initialScene] !== undefined) {
        setCurrentScene(Scenes[initialScene]);
      }
    }
  }, [initialScene]);

  useEffect(() => {
    // Trigger shake effect on initial load
    setClicked(true);
    setIsHover(true);
    setTimeout(() => {
      setClicked(false);
    }, 200);
    setTimeout(() => {
      setClicked(true);
    }, 250);
    setTimeout(() => {
      setClicked(true);
    }, 500);
    setTimeout(() => {
      setClicked(false);
      setIsHover(false);
    }, 1000);
  }, []);

  useEffect(() => {
    if (clicked) {
      setTimeout(() => {
        setClicked(false);
      }, 300);
    }
  }, [clicked]);

  const renderScene = () => {
    return Scenes[currentScene];
  };

  const getRandomShake = () => {
    const rotation = (Math.random() - 0.5) * 20;
    return `rotate(${rotation}deg)`;
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
        {createElement(renderScene())}
        <header
          onMouseEnter={() => setIsHover(true)}
          onMouseLeave={() => setIsHover(false)}
          onMouseDown={(event) => {
            if (event.button === 0) {
              setClicked(true);
              setCurrentScene((currentScene + 1) % Object.keys(Scenes).length);
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setClicked(true);
            setCurrentScene(
              currentScene - 1 < 0
                ? Object.keys(Scenes).length - 1
                : currentScene - 1
            );
          }}
          style={{
            fontSize: "5em",
            textAlign: "center",
            color: isHover ? defaultColours.secondary : defaultColours.accent,
            fontWeight: "bold",
            zIndex: 10,
            transition: "color 0.8s ease, transform 1.5s ease",
            position: "relative",
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
            KhtmlUserSelect: "none",
            MozUserSelect: "none",
            userSelect: "none",
            msUserSelect: "none",
            transform: clicked ? `scale(1.1) ${getRandomShake()}` : "scale(1)",
            whiteSpace: "pre-wrap", // Allows handling of newlines
          }}
          id="title"
        >
          {text === "" || text === undefined
            ? "NTeague"
            : decodeURIComponent(text).replace(/%0A/g, "\n")}
        </header>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            fontWeight: "bold",
            fontSize: "1.5em",
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
            KhtmlUserSelect: "none",
            MozUserSelect: "none",
            userSelect: "none",
            msUserSelect: "none",
            zIndex: 100,
            paddingBottom: "0.5em", // Added bottom padding
          }}
        >
          Current scene:{" "}
          {Object.entries(Scenes).find(
            ([, Component]) => Component === Scenes[currentScene]
          )?.[1]?.name || "Unknown"}
        </div>
        <div
          id="linkIcons"
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "1em",
            fontSize: "3em",
            zIndex: 100,
            paddingBottom: "1em", // Added bottom padding
          }}
        >
          <IconHover
            icon={faGithub}
            link="https://www.github.com/coding-beagle"
          />
          <IconHover
            icon={faLinkedin}
            link="https://www.linkedin.com/in/nicholasp-teague/"
          />
          <IconHover icon={faYoutube} link="https://www.youtube.com/@ntprod" />
          {/* <IconHover icon={faNewspaper} link="/blog" openNewTab={false} /> */}
        </div>
      </div>
    </>
  );
}
