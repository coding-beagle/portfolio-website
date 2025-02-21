import { useEffect, useState } from "react";
import defaultColors from "../themes/themes";

export default function Track({ hovering, line_path }) {
  const [isHover, setIsHover] = useState(false);

  useEffect(() => {
    setIsHover(hovering);
  }, [hovering]);

  return (
    <path
      d={line_path}
      stroke={isHover ? defaultColors.secondary : defaultColors.accent}
      fill="transparent"
      style={{
        transition: "stroke-dasharray 0.3s ease, stroke 0.3s ease",
        strokeDasharray: isHover ? "150, 0" : "0, 150",
      }}
    />
  );
}
