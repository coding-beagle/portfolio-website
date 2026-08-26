import {
  BASE_MAX_ITER,
  MAX_ITER_LIMIT,
  autoIterationMultiplier,
  colourSpanForZoom,
  maxIterationsForZoom,
} from "../src/components/pages/title/utilities/iterationBudget";

describe("automatic multiplier", () => {
  test("is neutral at the top and climbs with depth", () => {
    expect(autoIterationMultiplier(1)).toBe(1);
    expect(autoIterationMultiplier(0.1)).toBe(1); // zoomed out, still neutral
    expect(autoIterationMultiplier(1e25)).toBeCloseTo(2, 5);
    expect(autoIterationMultiplier(1e50)).toBeCloseTo(3, 5);
  });

  test("stops climbing rather than running away", () => {
    expect(autoIterationMultiplier(1e290)).toBe(autoIterationMultiplier(1e200));
    expect(autoIterationMultiplier(1e290)).toBeLessThanOrEqual(6);
  });
});

describe("iteration budget", () => {
  test("starts near the shallow-zoom baseline", () => {
    const shallow = maxIterationsForZoom(1);
    expect(shallow).toBeGreaterThanOrEqual(BASE_MAX_ITER);
    expect(shallow).toBeLessThan(BASE_MAX_ITER * 1.5);
  });

  test("never decreases as the zoom deepens", () => {
    let previous = 0;
    for (let decade = 0; decade <= 290; decade += 5) {
      const budget = maxIterationsForZoom(10 ** decade);
      expect(budget).toBeGreaterThanOrEqual(previous);
      previous = budget;
    }
  });

  test("grows faster than linearly in the zoom decades", () => {
    // The whole point of the automatic multiplier: doubling the depth has to
    // buy more than double the iterations.
    const at20 = maxIterationsForZoom(1e20) - BASE_MAX_ITER;
    const at40 = maxIterationsForZoom(1e40) - BASE_MAX_ITER;
    expect(at40).toBeGreaterThan(at20 * 2);
  });

  test("is capped so the reference orbit stays a sane size", () => {
    expect(maxIterationsForZoom(1e290, 10)).toBe(MAX_ITER_LIMIT);
    expect(maxIterationsForZoom(1e100)).toBeLessThanOrEqual(MAX_ITER_LIMIT);
  });

  test("holds steady across a wheel tick so orbits can be reused", () => {
    // A tick is 1.1x. The budget must not move for every one of them, or every
    // tick would force a fresh arbitrary-precision reference orbit.
    let zoom = 1e10;
    const start = maxIterationsForZoom(zoom);
    let ticks = 0;
    while (maxIterationsForZoom(zoom) === start) {
      zoom *= 1.1;
      ticks += 1;
    }
    expect(ticks).toBeGreaterThan(5);
  });

  test("a whole dive only steps the budget a handful of times", () => {
    // Each distinct budget along the way costs one reference orbit.
    const budgets = new Set();
    for (let zoom = 1; zoom < 1e30; zoom *= 1.1) {
      budgets.add(maxIterationsForZoom(zoom));
    }
    expect(budgets.size).toBeLessThan(60); // ~720 wheel ticks to get there
  });

  test("bias scales the automatic budget without shrinking it", () => {
    const automatic = maxIterationsForZoom(1e10);
    expect(maxIterationsForZoom(1e10, 3)).toBeGreaterThan(automatic * 2.5);
    expect(maxIterationsForZoom(1e10, 0)).toBe(automatic); // bias below 1 is ignored
  });
});

describe("colour span", () => {
  test("ignores the bias, so extra iterations cannot restyle the frame", () => {
    for (const zoom of [1, 1e5, 1e30]) {
      expect(colourSpanForZoom(zoom)).toBe(maxIterationsForZoom(zoom));
      expect(colourSpanForZoom(zoom, 10)).toBe(maxIterationsForZoom(zoom));
    }
  });

  test("still widens with depth, where escape counts genuinely climb", () => {
    expect(colourSpanForZoom(1e30)).toBeGreaterThan(colourSpanForZoom(1));
  });
});
