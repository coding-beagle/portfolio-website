/**
 * The full-viewport canvas every scene renders into.
 *
 * This was the same nine lines of JSX in twenty-six files.
 */

import React, { forwardRef } from "react";

const SceneCanvas = forwardRef(({ style, ...props }, ref) => (
  <canvas
    ref={ref}
    style={{ position: "absolute", top: 0, left: 0, ...style }}
    {...props}
  />
));

SceneCanvas.displayName = "SceneCanvas";

export default SceneCanvas;
