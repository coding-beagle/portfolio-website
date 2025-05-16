const darkTheme = {
  primary: "#031926",
  secondary: "#00ccff",
  accent: "#f4e9cd",
  secondaryAccent: "#5c946e",
  tertiaryAccent: "#e36588",
  font: "Roboto, sans-serif",
};

const lightTheme = {
  primary: "#f4e9cd", // flipped with accent
  secondary: "#00ccff",
  accent: "#031926", // flipped with primary
  secondaryAccent: "#5c946e",
  tertiaryAccent: "#e36588",
  font: "Roboto, sans-serif",
};

export const themes = {
  dark: darkTheme,
  light: lightTheme,
};

export const getFlippedTheme = (themeName) =>
  themeName === "dark" ? themes.light : themes.dark;

export default darkTheme; // for backward compatibility
