import React, { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMoon, faSun } from "@fortawesome/free-solid-svg-icons";
import { ThemeProvider, useTheme } from "./themes/ThemeProvider";
import { MobileContext, isMobile } from "./contexts/MobileContext";
import UploadThat from "./components/pages/uploadthat/UploadThat";

/**
 * The uploadthat page frame: the site's theme and mobile context, a theme
 * toggle in the corner, and a scrolling body — the global stylesheet locks
 * `body` to `overflow: hidden` for the portfolio's fullscreen canvases.
 */
export function UploadThatPage() {
  const { theme, themeName, toggleTheme } = useTheme();

  return (
    <div
      style={{
        backgroundColor: theme.primary,
        color: theme.accent,
        fontFamily: theme.font,
        height: "var(--app-height)",
        overflowY: "auto",
        margin: 0,
        position: "relative",
      }}
    >
      <UploadThat />
      <button
        onClick={toggleTheme}
        style={{
          position: "fixed",
          left: "1em",
          bottom: "1em",
          zIndex: 9999,
          background: theme.accent,
          color: theme.primary,
          border: "none",
          borderRadius: "50%",
          width: "3em",
          height: "3em",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          cursor: "pointer",
          fontSize: "1.5em",
          transition: "background 0.3s, color 0.3s",
        }}
        aria-label={themeName === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
        title={themeName === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
      >
        <FontAwesomeIcon icon={themeName === "dark" ? faSun : faMoon} />
      </button>
    </div>
  );
}

export default function UploadThatApp() {
  const [mobile, setMobile] = useState(isMobile());

  useEffect(() => {
    document.title = "uploadthat";
    const handleResize = () => setMobile(isMobile());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <MobileContext.Provider value={mobile}>
      <ThemeProvider>
        <UploadThatPage />
      </ThemeProvider>
    </MobileContext.Provider>
  );
}
