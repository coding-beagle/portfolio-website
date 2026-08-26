/**
 * Maps an escape-iteration count to a colour.
 *
 * The gradient runs across a fixed `span` of iterations rather than across the
 * iteration budget. Tying it to the budget meant that raising the budget —
 * which is what the Extra Iterations control does — squeezed the same picture
 * into a smaller slice of the gradient and washed the whole frame towards the
 * low colour. The span is a property of the view, the budget is a property of
 * how hard we are willing to work, and only the first should decide colour.
 */
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const toComponents = (hex) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});

const toHex = (r, g, b) =>
  `#${[r, g, b]
    .map((c) => Math.floor(clamp(c, 0, 255)).toString(16).padStart(2, "0"))
    .join("")}`;

export function createPalette({
  maxIterationColour,
  maxInterpColour,
  minInterpColour,
  span,
}) {
  const high = toComponents(maxInterpColour);
  const low = toComponents(minInterpColour);
  const range = Math.max(span, 1);

  const step = {
    r: (high.r - low.r) / range,
    g: (high.g - low.g) / range,
    b: (high.b - low.b) / range,
  };

  return {
    span: range,
    /**
     * `maxIterations` is the budget, not the gradient span: a point that never
     * escaped is inside the set and gets its own colour, whatever the budget
     * happened to be. Counts past the span sit at the top of the gradient.
     */
    colourFor(iterations, maxIterations) {
      if (iterations >= maxIterations) return maxIterationColour;
      return toHex(
        low.r + iterations * step.r,
        low.g + iterations * step.g,
        low.b + iterations * step.b
      );
    },
  };
}
