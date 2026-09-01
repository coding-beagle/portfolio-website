/**
 * The one green hill under Bliss, and the shape of its ridge.
 *
 * The path is drawn by the wallpaper and walked on by the celestial body once
 * it has been knocked out of the sky, so it lives here rather than inline in
 * either: a ball rolling along a curve that is not quite the one on screen is
 * worse than no ball at all.
 */

export const HILL_VIEW = { width: 1200, height: 400 };

/** The ridge, as the two cubics it is drawn with. */
const SEGMENTS = [
  { p0: [0, 206], p1: [180, 126], p2: [372, 72], p3: [606, 112] },
  { p0: [606, 112], p1: [818, 148], p2: [1012, 204], p3: [1200, 172] },
];

const RIDGE = SEGMENTS.map(
  (seg) =>
    `C${seg.p1[0]},${seg.p1[1]} ${seg.p2[0]},${seg.p2[1]} ${seg.p3[0]},${seg.p3[1]}`
).join(" ");

/** The ridge alone, for the sunlit rim that makes it read as grass. */
export const HILL_RIM = `M0,206 ${RIDGE}`;

/** The same ridge closed off down both sides and along the bottom. */
export const HILL_PATH = `M0,${HILL_VIEW.height} L0,206 ${RIDGE} L${HILL_VIEW.width},${HILL_VIEW.height} Z`;

const cubic = (a, b, c, d, t) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};

/**
 * The ridge sampled into a table of points.
 *
 * A cubic gives its point for a parameter, not for an x, and inverting that per
 * frame to ask "how high is the ground here" is work for no gain — the curve
 * never changes, so it is walked once and read off afterwards. x climbs the
 * whole way along both segments, which is what lets the lookup be a search.
 */
const SAMPLES = 160;
const TABLE = SEGMENTS.flatMap((seg, index) =>
  // The second segment starts where the first ended, so its first point would
  // be a duplicate.
  Array.from({ length: SAMPLES + (index === 0 ? 1 : 0) }, (unused, step) => {
    const t = (step + (index === 0 ? 0 : 1)) / SAMPLES;
    return [
      cubic(seg.p0[0], seg.p1[0], seg.p2[0], seg.p3[0], t),
      cubic(seg.p0[1], seg.p1[1], seg.p2[1], seg.p3[1], t),
    ];
  })
);

/** How high the ground is at a point across it, in the hill's own units. */
export function ridgeY(x) {
  if (x <= TABLE[0][0]) return TABLE[0][1];
  const last = TABLE[TABLE.length - 1];
  if (x >= last[0]) return last[1];

  let low = 0;
  let high = TABLE.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (TABLE[middle][0] <= x) low = middle;
    else high = middle;
  }
  const [x0, y0] = TABLE[low];
  const [x1, y1] = TABLE[high];
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
}

/** Which way the ground is leaning there, as a gradient. */
export function ridgeSlope(x) {
  const step = HILL_VIEW.width / 240;
  return (ridgeY(x + step) - ridgeY(x - step)) / (2 * step);
}
