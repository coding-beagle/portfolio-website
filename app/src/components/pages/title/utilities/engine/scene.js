/**
 * The scene shell: canvas ref, sizing, the animation loop, and teardown.
 *
 * Each scene used to hand-roll this: grab the canvas, size it, get a context,
 * define animate(), kick off requestAnimationFrame, then remember every
 * listener it had added so the cleanup could take them all off again. The
 * cleanups were where the copies drifted most — several scenes leaked a
 * listener or two. `useCanvasScene` owns the lifecycle so a scene only has to
 * describe its own frame.
 */

import { useEffect, useRef } from "react";
import { fitCanvasToWindow } from "./canvas";

/**
 * Run a canvas scene for the lifetime of the component.
 *
 * `setup` is called once per dependency change with `{ canvas, ctx, onCleanup }`
 * and returns either a frame function, or an object:
 *
 *   frame     () => void  — called once per animation frame. Omit it when the
 *                           scene drives its own loop (a worker, a video).
 *   onResize  () => void  — after the canvas is resized, and on `popstate`,
 *                           for scenes that cache element rectangles.
 *   cleanup   () => void  — teardown, on top of anything passed to `onCleanup`.
 *
 * The canvas is already sized to the viewport by the time `setup` runs, so
 * `canvas.width` / `canvas.height` are safe to read when seeding particles.
 *
 * @returns {import("react").RefObject<HTMLCanvasElement>} ref for the <canvas>
 */
export const useCanvasScene = (setup, deps = []) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext("2d");
    const teardown = [];

    // Registered by `setup` below, but the canvas has to be sized before
    // `setup` runs — so the listener goes in first and looks the handler up
    // each time it fires.
    let handleResize = null;
    const fitted = fitCanvasToWindow(canvas, () => {
      if (handleResize) handleResize();
    });

    const relayout = () => {
      if (handleResize) handleResize();
    };
    window.addEventListener("popstate", relayout);

    const scene =
      setup({ canvas, ctx, onCleanup: (fn) => teardown.push(fn) }) ?? {};
    const { frame, onResize, cleanup } =
      typeof scene === "function" ? { frame: scene } : scene;

    handleResize = onResize ?? null;

    let frameId = null;
    if (frame) {
      const loop = () => {
        frame();
        frameId = requestAnimationFrame(loop);
      };
      loop();
    }

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      window.removeEventListener("popstate", relayout);
      fitted.dispose();
      teardown.forEach((fn) => fn());
      if (cleanup) cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return canvasRef;
};
