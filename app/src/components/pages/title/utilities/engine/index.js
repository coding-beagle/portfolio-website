/**
 * The shared scene engine.
 *
 * Everything the title-page scenes have in common — the canvas shell, the
 * animation loop, pointer and touch input, and the particle vocabulary — lives
 * behind this one import.
 */

export { useCanvasScene } from "./scene";
export { default as SceneCanvas } from "./SceneCanvas";
export { fitCanvasToWindow, clearCanvas, fadeCanvas } from "./canvas";
export {
  createPointerTracker,
  toCanvasPosition,
  attachListeners,
} from "./pointer";
export {
  Particle,
  ParticleSystem,
  EDGE,
  repelWithinRadius,
  repelFromHitboxes,
  randomPointOnCanvas,
  confineToCanvas,
  scatterWithMinDistance,
} from "./particles";
export { Spark } from "./spark";
