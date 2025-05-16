import React, { createContext, useContext, useState } from "react";
import { themes, getFlippedTheme } from "./themes";

const ThemeContext = createContext({
  theme: themes.dark,
  themeName: "dark",
  toggleTheme: () => {},
});

export const ThemeProvider = ({ children }) => {
  const [themeName, setThemeName] = useState("dark");
  const theme = themes[themeName];

  const toggleTheme = () => {
    setThemeName((prev) => (prev === "dark" ? "light" : "dark"));
  };

  return (
    <ThemeContext.Provider value={{ theme, themeName, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
