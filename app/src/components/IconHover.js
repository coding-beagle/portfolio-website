import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import defaultColours from "../themes/themes";
import { useState } from "react";

export default function IconHover({ icon, link }) {
  const [isHover, setIsHover] = useState(false);

  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        color: isHover ? defaultColours.secondary : defaultColours.accent,
        cursor: "pointer",
      }}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
    >
      <FontAwesomeIcon
        icon={icon}
        style={{
          transition: "color 0.3s ease, transform 0.5s ease",
          transform: isHover ? `scale(1.1)` : "scale(1)",
        }}
      />
    </a>
  );
}
