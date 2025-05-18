import { useEffect, useState, createElement, useRef, useContext } from "react";
import { useTheme } from "../../../themes/ThemeProvider";
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
import { MobileContext } from "../../../contexts/MobileContext";

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
  const { theme } = useTheme();
  const mobile = useContext(MobileContext);
  const [isHover, setIsHover] = useState(false);
  const [currentScene, setCurrentScene] = useState(
    Math.floor(Math.random() * Object.keys(Scenes).length)
  );

  const [clicked, setClicked] = useState(false);
  const headerRef = useRef(null);
  const animationNameRef = useRef("");
  const [showMenu, setShowMenu] = useState(false);

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
      }, 500);
    }, 1500);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setIsHover(false);
    };
  }, []);

  useEffect(() => {
    if (clicked) {
      setTimeout(() => {
        setClicked(false);
      }, 500);
    }
  }, [clicked]);

  const renderScene = () => {
    return Scenes[currentScene].component;
  };

  const getRandomShake = () => {
    const animationName = `cartoony-shake-${Math.random()
      .toString(36)
      .substr(2, 5)}`; // Unique animation name

    const keyframes = `
      @keyframes ${animationName} {
        0% { transform: translate(0, 0) rotate(0deg); }
        25% { transform: translate(-10px, -5px) rotate(-5deg); }
        50% { transform: translate(12px, 6px) rotate(4deg); }
        75% { transform: translate(-8px, 4px) rotate(-3deg); }
        100% { transform: translate(0, 0) rotate(0deg); }
      }
    `;

    // Inject the keyframes into a style tag
    const styleSheet = document.styleSheets[0];
    styleSheet.insertRule(keyframes, styleSheet.cssRules.length);

    return animationName; // Return the animation name
  };

  const triggerShake = () => {
    const name = getRandomShake();
    animationNameRef.current = name;
    setClicked(true);
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
          backgroundColor: theme.primary,
          color: theme.accent,
          fontFamily: theme.font,
        }}
      >
        {createElement(renderScene())}
        <header
          ref={headerRef}
          onMouseEnter={() => setIsHover(true)}
          onMouseLeave={() => setIsHover(false)}
          onMouseDown={(event) => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (event.button === 0) {
              triggerShake();
              setCurrentScene((currentScene + 1) % Object.keys(Scenes).length);
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            triggerShake();
            setCurrentScene(
              currentScene - 1 < 0
                ? Object.keys(Scenes).length - 1
                : currentScene - 1
            );
          }}
          style={{
            fontSize: mobile ? "2.2em" : "5em", // Smaller on mobile
            textAlign: "center",
            color: isHover ? theme.secondary : theme.accent,
            fontWeight: "bold",
            zIndex: 10,
            transition: "color 0.8s ease, transform 1.5s ease",
            position: "relative",
            cursor: "pointer",
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
            KhtmlUserSelect: "none",
            MozUserSelect: "none",
            userSelect: "none",
            msUserSelect: "none",
            animation:
              clicked && animationNameRef.current
                ? `${animationNameRef.current} 0.5s ease`
                : "none",
            whiteSpace: "pre-wrap",
          }}
          id="title"
        >
          {text === "" || text === undefined
            ? "NTeague"
            : decodeURIComponent(text).replace(/%0A/g, "\n")}
        </header>
        {/* Mobile: show menu button, else show scene and links inline */}
        {mobile ? (
          <>
            <button
              style={{
                margin: "0.7em 0",
                fontSize: "1em",
                padding: "0.35em 1em",
                borderRadius: "7px",
                border: "none",
                background: theme.accent, // Use accent color for button background
                color: theme.primary, // Use primary color for text
                fontWeight: "bold",
                cursor: "pointer",
                zIndex: 200,
                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              }}
              onClick={() => setShowMenu(true)}
            >
              Show More
            </button>
            {showMenu && (
              <div
                style={{
                  position: "fixed",
                  top: 0,
                  left: 0,
                  width: "100vw",
                  height: "100vh",
                  background: "rgba(0,0,0,0.7)",
                  zIndex: 9999,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onClick={() => setShowMenu(false)}
              >
                <div
                  style={{
                    background: theme.primary,
                    color: theme.accent,
                    borderRadius: "16px",
                    padding: "2em 1.5em 1.5em 1.5em",
                    minWidth: "70vw",
                    maxWidth: "90vw",
                    boxShadow: "0 4px 24px rgba(0,0,0,0.2)",
                    position: "relative",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    style={{
                      position: "absolute",
                      top: 10,
                      right: 16,
                      fontSize: "1.5em",
                      background: "none",
                      border: "none",
                      color: theme.accent,
                      cursor: "pointer",
                    }}
                    onClick={() => setShowMenu(false)}
                  >
                    ×
                  </button>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      fontWeight: "bold",
                      fontSize: "1.2em",
                      marginBottom: "1em",
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
                      fontSize: "2.2em",
                      marginBottom: "0.5em",
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
                    <IconHover
                      icon={faYoutube}
                      link="https://www.youtube.com/@ntprod"
                    />
                  </div>
                  {/* Hide value changers on mobile, show them in the popup */}
                  <div id="valueChangersContainer" style={{ marginTop: "1em" }}>
                    {/* If you use a ValueChangers component, render it here. Example: */}
                    {/* <ValueChangers ...props /> */}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
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
                paddingBottom: "0.5em",
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
                paddingBottom: "1em",
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
              <IconHover
                icon={faYoutube}
                link="https://www.youtube.com/@ntprod"
              />
            </div>
          </>
        )}
      </div>
    </>
  );
}
