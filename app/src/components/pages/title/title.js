import { useEffect, useState, createElement, useRef } from "react";
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
  0: { component: Snow },
  1: { component: Rain },
  2: { component: Plants },
  3: { component: Stars },
  4: { component: Boids },
  5: { component: Conway },
  6: { component: Hexapod },
  7: { component: Mandelbrot },
  8: { component: Fire },
  9: { component: Fireworks },
};

const sceneNameToIndex = {
  snow: 0,
  rain: 1,
  plants: 2,
  stars: 3,
  boids: 4,
  conway: 5,
  hexapod: 6,
  mandelbrot: 7,
  fire: 8,
  fireworks: 9,
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
      const normalizedScene = decodeURIComponent(
        initialScene.trim().toLowerCase()
      );
      const sceneIndex = sceneNameToIndex[normalizedScene];
      if (sceneIndex !== undefined) {
        setCurrentScene(sceneIndex);
      } else {
        console.warn(
          `Invalid initialScene: "${initialScene}". Falling back to a random scene.`
        );
        setCurrentScene(Math.floor(Math.random() * Object.keys(Scenes).length));
      }
    }
  }, [initialScene]);

  const intervalRef = useRef(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setClicked(true);
      setTimeout(() => {
        setClicked(false);
      }, 200);
    }, Math.random() * 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setIsHover(false);
    };
  }, []);

  useEffect(() => {
    if (clicked) {
      setTimeout(() => {
        setClicked(false);
      }, 300);
    }
  }, [clicked]);

  const renderScene = () => {
    return Scenes[currentScene].component;
  };

  const getRandomShake = () => {
    const rotation = (Math.random() - 0.5) * 30; // Increased rotation for a more exaggerated effect
    const xOffset = (Math.random() - 0.5) * 30; // Add horizontal shake
    const yOffset = (Math.random() - 0.5) * 30; // Add vertical shake
    return `rotate(${rotation}deg) translate(${xOffset}px, ${yOffset}px)`;
  };

  const getSceneName = (index) => {
    return (
      Object.entries(sceneNameToIndex).find(([, i]) => i === index)?.[0] ||
      "Unknown"
    );
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
            if (intervalRef.current) clearInterval(intervalRef.current);
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
          Current scene: {getSceneName(currentScene)}
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
