import React, { useState } from "react";
import { HashRouter, Routes, Route, useLocation } from "react-router-dom";
import Title from "./components/pages/title/title";
import { ThemeProvider, useTheme } from "./themes/ThemeProvider";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMoon, faSun } from "@fortawesome/free-solid-svg-icons";

// Wrapper component to handle location and pass path
function AppWrapper() {
  const location = useLocation();
  const { theme, themeName, toggleTheme } = useTheme();

  // Remove the leading '/' from the pathname
  const path = location.pathname.substring(1);

  const search = location.search;
  const queryString = search.includes("?") ? search.split("?")[1] : "";
  const searchParams = new URLSearchParams(queryString);
  const scene = searchParams.get("scene");

  // Animation state for theme icon
  const [iconAnim, setIconAnim] = useState(false);
  const [pendingTheme, setPendingTheme] = useState(themeName);

  // Handler for animated theme toggle
  const handleThemeToggle = () => {
    setIconAnim(true);
    setTimeout(() => {
      toggleTheme();
      setPendingTheme(themeName === "dark" ? "light" : "dark");
      setIconAnim(false);
    }, 250); // Animation duration before switching
  };

  return (
    <div
      className="App"
      style={{
        backgroundColor: theme.primary,
        color: theme.accent,
        fontFamily: theme.font,
        height: "100vh",
        margin: 0,
        position: "relative",
      }}
    >
      <Title text={path} initialScene={scene?.toUpperCase()} />
      <button
        onClick={handleThemeToggle}
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
          overflow: "hidden",
        }}
        aria-label={
          themeName === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"
        }
        title={
          themeName === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"
        }
      >
        {pendingTheme === "dark" ? (
          <span
            style={{
              display: "inline-block",
              transition:
                "transform 0.5s cubic-bezier(.68,-0.55,.27,1.55), opacity 0.5s",
              transform: iconAnim
                ? "translateY(40px) scale(0.7) rotate(-20deg)"
                : "translateY(0) scale(1) rotate(0deg)",
              opacity: iconAnim ? 0 : 1,
              position: "absolute",
            }}
          >
            <FontAwesomeIcon icon={faSun} />
          </span>
        ) : (
          <span
            style={{
              display: "inline-block",
              transition:
                "transform 0.5s cubic-bezier(.68,-0.55,.27,1.55), opacity 0.5s",
              transform: iconAnim
                ? "translateY(40px) scale(0.7) rotate(20deg)"
                : "translateY(0) scale(1) rotate(0deg)",
              opacity: iconAnim ? 0 : 1,
              position: "absolute",
            }}
          >
            <FontAwesomeIcon icon={faMoon} />
          </span>
        )}
      </button>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <HashRouter>
        <Routes>
          <Route path="*" element={<AppWrapper />} />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  );
}

export default App;
