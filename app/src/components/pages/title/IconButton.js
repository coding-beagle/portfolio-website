import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useTheme } from "../../../themes/ThemeProvider";
import { useState } from "react";

export default function IconButton({ icon, onClick, openNewTab = true, link = null, title = null }) {
  const [isHover, setIsHover] = useState(false);
  const { theme } = useTheme();

  const handleClick = (e) => {
    e.preventDefault();
    if (onClick) {
      onClick();
    } else if (link) {
      if (openNewTab) {
        window.open(link, "_blank", "noopener,noreferrer");
      } else {
        window.location.href = link;
      }
    }
  };

  return (
    <button
      onClick={handleClick}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        color: isHover ? theme.secondary : theme.accent,
        cursor: "pointer",
        fontSize: "inherit",
      }}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      title={openNewTab ? null: title}
    >
      <FontAwesomeIcon
        icon={icon}
        style={{
          transition: "color 0.3s ease, transform 0.5s ease",
          transform: isHover ? `scale(1.1)` : "scale(1)",
        }}
      />
    </button>
  );
}
