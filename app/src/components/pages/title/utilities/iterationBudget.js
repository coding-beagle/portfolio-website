/**
 * How many iterations a Mandelbrot pixel is allowed at a given zoom.
 *
 * Detail near the boundary takes longer to resolve the deeper you go, so the
 * budget both grows with depth and grows *faster* with depth: a linear term
 * per decade of zoom, times a multiplier that itself climbs with depth. What
 * used to be a hand-cranked slider is now this multiplier.
 */
export const BASE_MAX_ITER = 2000;
export const MAX_ITER_LIMIT = 250000;

// The budget climbs a ladder rather than tracking the zoom continuously. Every
// wheel tick nudges the raw figure, and each change forces a fresh
// arbitrary-precision reference orbit, so the rungs are spaced far enough
// apart — a fixed fraction of an octave, since the raw figure grows
// proportionally — to reuse one orbit across a whole gesture. The cost is up
// to one rung of surplus iterations.
const ITER_STEPS_PER_OCTAVE = 8;

// Beyond this the automatic multiplier stops climbing; the cap on the budget
// itself takes over.
const MAX_AUTO_MULTIPLIER = 6;

const zoomDecades = (zoom) =>
  Number.isFinite(zoom) && zoom > 1 ? Math.log10(zoom) : 0;

/** The zoom-driven multiplier, ×1 at the top and climbing with depth. */
export function autoIterationMultiplier(zoom) {
  return Math.min(MAX_AUTO_MULTIPLIER, 1 + zoomDecades(zoom) / 25);
}

/**
 * The iteration range the colour gradient is spread over. Deliberately the
 * automatic budget, with no bias applied: asking for extra iterations should
 * resolve more detail, not restyle the whole frame.
 */
export function colourSpanForZoom(zoom) {
  return maxIterationsForZoom(zoom);
}

/**
 * `bias` is the manual thumb on the scale for the occasional location that
 * wants more than the automatic budget; 1 leaves it fully automatic.
 */
export function maxIterationsForZoom(zoom, bias = 1) {
  const linear = BASE_MAX_ITER + 600 * zoomDecades(zoom);
  const raw = linear * autoIterationMultiplier(zoom) * Math.max(bias, 1);
  const rung = Math.ceil(Math.log2(raw) * ITER_STEPS_PER_OCTAVE);
  return Math.min(
    MAX_ITER_LIMIT,
    Math.round(2 ** (rung / ITER_STEPS_PER_OCTAVE))
  );
}
