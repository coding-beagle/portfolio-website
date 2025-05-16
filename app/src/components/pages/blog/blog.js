import { useTheme } from "../../themes/ThemeProvider";
import React from "react";
import Snow from "../title/scenes/snow";
import IconHover from "../title/iconHover";
import { faBackward } from "@fortawesome/free-solid-svg-icons";

export default function Blog() {
  const { theme } = useTheme();
  return (
    <div
      style={{
        backgroundColor: theme.primary,
        color: theme.accent,
        fontFamily: theme.font,
        height: "100vh",
        margin: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-start",
        alignItems: "center",
        position: "relative",
      }}
    >
      <div
        style={{
          fontSize: "8vh",
          zIndex: 10,
          position: "absolute",
          right: "0.2em",
          top: "0.2em",
          display: "flex",
        }}
      >
        <IconHover link="./" icon={faBackward} openNewTab={false} />
      </div>
      <h1
        style={{
          fontSize: "8vh",
          textAlign: "center",
          fontWeight: "bold",
          zIndex: 10,
          paddingTop: "1em",
          display: "flex",
          justifyContent: "center",
          position: "relative",
          WebkitUserSelect: "none",
          WebkitTouchCallout: "none",
          KhtmlUserSelect: "none",
          MozUserSelect: "none",
          userSelect: "none",
          msUserSelect: "none",
        }}
      >
        Welcome to the blog!
      </h1>
      <Snow />
    </div>
  );
}
