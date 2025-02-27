import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import defaultColours from "../themes/themes";
import { useState } from "react";

export default function IconHover({ icon, link }) {
  const [isHover, setIsHover] = useState(false);

  return (
    <a
      href={link}
      style={{
        color: isHover ? defaultColours.secondary : defaultColours.accent,
        cursor: "pointer",
      }}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
    >
      <FontAwesomeIcon icon={icon} />
    </a>
  );
}
