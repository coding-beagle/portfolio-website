import React, { useEffect, useState } from "react";
import { ThemeProvider, useTheme } from "./themes/ThemeProvider";
import { MobileContext, isMobile } from "./contexts/MobileContext";
import UploadThat from "./components/pages/uploadthat/UploadThat";

/**
 * The uploadthat page frame: the site's theme and mobile context, a theme
 * a scrolling body — the global stylesheet locks
 * `body` to `overflow: hidden` for the portfolio's fullscreen canvases.
 */
export function UploadThatPage() {
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
      <UploadThat />
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
