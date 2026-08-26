import { createPalette } from "../src/components/pages/title/utilities/palette";

const COLOURS = {
  maxIterationColour: "#000000",
  maxInterpColour: "#ffffff",
  minInterpColour: "#000080",
};

const build = (span) => createPalette({ ...COLOURS, span });

describe("gradient", () => {
  test("runs from the low colour to the high colour across the span", () => {
    const palette = build(1000);
    expect(palette.colourFor(0, 5000)).toBe("#000080");
    expect(palette.colourFor(1000, 5000)).toBe("#ffffff");
  });

  test("is monotonic between the ends", () => {
    const palette = build(1000);
    let previous = -1;
    for (let count = 0; count <= 1000; count += 25) {
      const red = parseInt(palette.colourFor(count, 5000).slice(1, 3), 16);
      expect(red).toBeGreaterThanOrEqual(previous);
      previous = red;
    }
  });

  test("clamps rather than overflowing past the span", () => {
    const palette = build(1000);
    expect(palette.colourFor(50000, 100000)).toBe("#ffffff");
  });
});

describe("independence from the iteration budget", () => {
  test("the same count is the same colour whatever the budget", () => {
    // The bug this guards: the gradient used to be spread over the iteration
    // budget, so turning the budget up washed the whole frame towards the low
    // colour without anything about the view having changed.
    const palette = build(2048);
    for (const count of [1, 40, 500, 2000]) {
      const atDefault = palette.colourFor(count, 2048);
      const atTenTimes = palette.colourFor(count, 20480);
      expect(atTenTimes).toBe(atDefault);
    }
  });

  test("a wider span spreads the same counts over more of the gradient", () => {
    const red = (palette) => parseInt(palette.colourFor(500, 1e6).slice(1, 3), 16);
    expect(red(build(1000))).toBeGreaterThan(red(build(10000)));
  });
});

describe("points inside the set", () => {
  test("get their own colour, at whatever budget they were found", () => {
    const palette = build(2048);
    expect(palette.colourFor(2048, 2048)).toBe("#000000");
    expect(palette.colourFor(20480, 20480)).toBe("#000000");
  });

  test("are distinguished from a point that escaped on the last iteration", () => {
    const palette = build(2048);
    expect(palette.colourFor(2047, 2048)).not.toBe("#000000");
  });
});
