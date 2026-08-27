/**
 * Canvas plumbing shared by every scene.
 *
 * Every scene used to open with the same twenty lines: grab the canvas out of a
 * ref, size it to the viewport, re-size it on `resize`, pull a 2d context, and
 * remember to tear the listener down again on unmount. That is all here now.
 */

/**
 * Size `canvas` to the viewport and keep it there.
 *
 * `onResize` runs after every resize *including* the initial one, which is what
 * the scenes that cache element rectangles rely on.
 *
 * @returns {{resize: () => void, dispose: () => void}}
 */
export const fitCanvasToWindow = (canvas, onResize = null) => {
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (onResize) onResize();
  };

  resize();
  window.addEventListener("resize", resize);

  return {
    resize,
    dispose: () => window.removeEventListener("resize", resize),
  };
};

/** Wipe the whole canvas. */
export const clearCanvas = (ctx, canvas) => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
};

/**
 * Paint the whole canvas with `colour`, optionally at partial alpha so the
 * previous frame bleeds through — the motion-trail effect several scenes use
 * instead of a hard clear.
 */
export const fadeCanvas = (ctx, canvas, colour, alpha = 1.0) => {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
};
