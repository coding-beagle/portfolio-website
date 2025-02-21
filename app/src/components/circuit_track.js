import { useEffect, useState } from "react";
import defaultColors from "../themes/themes";

export default function Tracks({ hovering, line_path }) {
  const [isHover, setIsHover] = useState(false);

  useEffect(() => {
    setIsHover(hovering);
  }, [hovering]);

  return (
    <svg width="100%" height="100%">
      <path
        d={line_path}
        stroke={isHover ? defaultColors.secondary : defaultColors.accent}
        strokeWidth="20"
        fill="transparent"
        style={{
          transition: "stroke 0.3s ease",
        }}
      />
    </svg>
  );
}
