import { useEffect, useState } from "react";
import defaultColours from "../../../themes/themes";
import Snow from "./scenes/snow";
import Rain from "./scenes/rain";
import Sun from "./scenes/plants";
import Stars from "./scenes/stars";
import Boids from "./scenes/boids";
import {
  faGithub,
  faLinkedin,
  faYoutube,
} from "@fortawesome/free-brands-svg-icons";
import { faNewspaper } from "@fortawesome/free-solid-svg-icons";
import IconHover from "./iconHover";

const Scenes = {
  SNOW: 0,
  RAIN: 1,
  SUN: 2,
  STARS: 3,
  BOIDS: 4,
};

export default function Title() {
  const [isHover, setIsHover] = useState(false);
  const [currentScene, setCurrentScene] = useState(
    Math.floor(Math.random() * Object.keys(Scenes).length)
  );
  const [clicked, setClicked] = useState(false);

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
    switch (currentScene) {
      case Scenes.SNOW:
        return <Snow />;
      case Scenes.RAIN:
        return <Rain />;
      case Scenes.SUN: // need to let this cook a bit
        return <Sun />;
      case Scenes.STARS:
        return <Stars />;
      case Scenes.BOIDS:
        return <Boids />;
      default:
        return;
    }
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
        {renderScene()}
        <header
          onMouseEnter={() => setIsHover(true)}
          onMouseLeave={() => setIsHover(false)}
          onMouseDown={() => {
            setClicked(true);
            setCurrentScene((currentScene + 1) % Object.keys(Scenes).length);
          }}
          style={{
            fontSize: "5vw",
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
          }}
          id="title"
        >
          Nicholas Teague
        </header>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "1em",
            fontSize: "3em",
            zIndex: 100,
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
