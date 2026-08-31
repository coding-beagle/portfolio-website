import React, { useEffect, useState } from "react";
import { ThemeProvider, useTheme } from "./themes/ThemeProvider";
import { MobileContext, isMobile } from "./contexts/MobileContext";
import HexTool from "./components/pages/hextool/HexTool";

/**
 * The hex tool's own page frame: the site's theme and mobile context, a theme
 * a scrolling body.
 *
 * The global stylesheet locks `body` to `overflow: hidden` for the portfolio's
 * fullscreen canvases, so the scroll happens here rather than on the document.
 */
export function HexPage() {
  const { theme } = useTheme();

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
      <HexTool />
    </div>
  );
}

export default function HexApp() {
  const [mobile, setMobile] = useState(isMobile());

  useEffect(() => {
    document.title = "hex tool";
    const handleResize = () => setMobile(isMobile());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <MobileContext.Provider value={mobile}>
      <ThemeProvider>
        <HexPage />
      </ThemeProvider>
    </MobileContext.Provider>
  );
}
