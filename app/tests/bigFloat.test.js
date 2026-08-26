import {
  bfAdd,
  bfSub,
  bfMul,
  bfZero,
  bfSetPrec,
  bfToFixed,
  bfToNumber,
  bfFromNumber,
  bfPrecisionForZoom,
} from "../src/components/pages/title/utilities/bigFloat";

const P = 200;

describe("conversion", () => {
  test.each([0, 1, -1, 0.5, -2.25, 1e-5, 123.456, -0.7436438870371587])(
    "round trips %p",
    (value) => {
      expect(bfToNumber(bfFromNumber(value, P))).toBeCloseTo(value, 12);
    }
  );

  test("round trips values far below double's precision, not just its range", () => {
    for (const value of [1e-100, -1.5e-200, 1e-300]) {
      const p = bfPrecisionForZoom(1 / Math.abs(value));
      expect(bfToNumber(bfFromNumber(value, p))).toBeCloseTo(value, 320);
    }
  });

  test("non-finite and zero collapse to zero", () => {
    expect(bfToNumber(bfFromNumber(NaN, P))).toBe(0);
    expect(bfToNumber(bfFromNumber(Infinity, P))).toBe(0);
    expect(bfToNumber(bfZero(P))).toBe(0);
  });
});

describe("arithmetic", () => {
  test("matches double arithmetic where doubles are exact", () => {
    const a = bfFromNumber(1.5, P);
    const b = bfFromNumber(-0.25, P);
    expect(bfToNumber(bfAdd(a, b))).toBe(1.25);
    expect(bfToNumber(bfSub(a, b))).toBe(1.75);
    expect(bfToNumber(bfMul(a, b))).toBe(-0.375);
  });

  test("keeps digits a double would lose entirely", () => {
    // 0.1 + 1e-40 - 0.1 is exactly 0 in double precision.
    const p = bfPrecisionForZoom(1e45);
    const tiny = bfFromNumber(1e-40, p);
    const base = bfFromNumber(0.1, p);
    const recovered = bfSub(bfAdd(base, tiny), base);
    expect(bfToNumber(recovered)).toBeCloseTo(1e-40, 60);
    expect(0.1 + 1e-40 - 0.1).toBe(0); // the comparison this is worth making
  });

  test("multiplication stays accurate deep into a squaring chain", () => {
    // z <- z^2 + c, the reference orbit's inner loop, against a double run at
    // a depth where the two must still agree.
    let z = bfZero(P);
    const c = bfFromNumber(-0.5, P);
    let zd = 0;
    for (let i = 0; i < 40; i++) {
      z = bfAdd(bfMul(z, z), c);
      zd = zd * zd - 0.5;
    }
    expect(bfToNumber(z)).toBeCloseTo(zd, 12);
  });
});

describe("precision handling", () => {
  test("re-scaling preserves the value in both directions", () => {
    const a = bfFromNumber(-1.2345, 300);
    expect(bfToNumber(bfSetPrec(a, 400))).toBeCloseTo(-1.2345, 12);
    expect(bfToNumber(bfSetPrec(bfSetPrec(a, 400), 300))).toBeCloseTo(-1.2345, 12);
  });

  test("mixed precision operands align to the wider one", () => {
    const wide = bfFromNumber(1e-30, 300);
    const narrow = bfFromNumber(1, 64);
    const sum = bfAdd(narrow, wide);
    expect(sum.p).toBe(300);
    expect(bfToNumber(bfSub(sum, narrow))).toBeCloseTo(1e-30, 40);
  });

  test("precision tracks the zoom with room to spare", () => {
    for (const zoom of [1, 1e10, 1e100, 1e290]) {
      const bits = bfPrecisionForZoom(zoom);
      // Enough bits to separate two points one pixel apart, plus guard digits.
      expect(bits).toBeGreaterThan(Math.log2(zoom) + 32);
    }
    expect(bfPrecisionForZoom(1e100)).toBeGreaterThan(bfPrecisionForZoom(1e10));
  });
});

describe("decimal rendering", () => {
  test("formats to the requested number of places", () => {
    expect(bfToFixed(bfFromNumber(-2.25, P), 5)).toBe("-2.25000");
    expect(bfToFixed(bfZero(P), 3)).toBe("0.000");
    expect(bfToFixed(bfFromNumber(0.5, P), 1)).toBe("0.5");
  });

  test("prints digits past what a double could hold", () => {
    const p = bfPrecisionForZoom(1e60);
    const value = bfAdd(bfFromNumber(0.25, p), bfFromNumber(1e-50, p));
    const text = bfToFixed(value, 55);
    expect(text.startsWith("0.25000000000000000000000000000000000000000000000001")).toBe(
      true
    );
  });
});
