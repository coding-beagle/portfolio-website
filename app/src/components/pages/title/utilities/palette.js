/**
 * Maps an escape-iteration count to a colour.
 *
 * The gradient runs across a fixed `span` of iterations rather than across the
 * iteration budget. Tying it to the budget meant that raising the budget —
 * which is what the Extra Iterations control does — squeezed the same picture
 * into a smaller slice of the gradient and washed the whole frame towards the
 * low colour. The span is a property of the view, the budget is a property of
 * how hard we are willing to work, and only the first should decide colour.
 *
 * Two ways out: `colourFor` gives a CSS string, and `lut`/`packedFor` give the
 * same colour already packed for an ImageData buffer. The painter uses the
 * packed form — building a `#rrggbb` string per pixel costs more than the
 * fractal maths does.
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

// ImageData is bytes in RGBA order; a Uint32 view of it puts those bytes in
// whichever order the machine writes words, so the packing has to match.
const LITTLE_ENDIAN =
  new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;

const pack = (r, g, b) => {
  const red = Math.floor(clamp(r, 0, 255));
  const green = Math.floor(clamp(g, 0, 255));
  const blue = Math.floor(clamp(b, 0, 255));
  return LITTLE_ENDIAN
    ? ((255 << 24) | (blue << 16) | (green << 8) | red) >>> 0
    : ((red << 24) | (green << 16) | (blue << 8) | 255) >>> 0;
};

export function createPalette({
  maxIterationColour,
  maxInterpColour,
  minInterpColour,
  span,
}) {
  const high = toComponents(maxInterpColour);
  const low = toComponents(minInterpColour);
  const range = Math.max(Math.floor(span), 1);

  const step = {
    r: (high.r - low.r) / range,
    g: (high.g - low.g) / range,
    b: (high.b - low.b) / range,
  };

  const componentsAt = (iterations) => {
    const t = Math.min(iterations, range);
    return [low.r + t * step.r, low.g + t * step.g, low.b + t * step.b];
  };

  // One entry per iteration up to the span, so painting is an array lookup.
  // Filled numerically: going via the hex strings would take ~100x longer.
  const lut = new Uint32Array(range + 1);
  for (let n = 0; n <= range; n++) lut[n] = pack(...componentsAt(n));
  const interior = pack(...Object.values(toComponents(maxIterationColour)));

  return {
    span: range,
    lut,
    interior,
    /**
     * `maxIterations` is the budget, not the gradient span: a point that never
     * escaped is inside the set and gets its own colour, whatever the budget
     * happened to be. Counts past the span sit at the top of the gradient.
     */
    colourFor(iterations, maxIterations) {
      if (iterations >= maxIterations) return maxIterationColour;
      return toHex(...componentsAt(iterations));
    },
    /** The same decision, as a value an ImageData buffer can take directly. */
    packedFor(iterations, maxIterations) {
      if (iterations >= maxIterations) return interior;
      return lut[iterations < range ? iterations : range];
    },
  };
}
