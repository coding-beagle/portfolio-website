/* global BigInt */
/**
 * Minimal fixed-point arbitrary precision arithmetic, built on BigInt.
 *
 * A value is a plain object `{ m, p }` meaning `m / 2^p`, where `m` is a
 * BigInt and `p` is the number of fractional bits. Plain objects (rather than
 * a class) because these get posted to web workers, and structured clone
 * understands BigInt but not class identity.
 *
 * The whole library is defined inside `createBigFloatLib` so that it can be
 * stringified and injected into a blob worker (see ./workerFactory), while
 * still being importable normally on the main thread.
 */
export const createBigFloatLib = () => {
  // Multiply by a power of two without overflowing the exponent range in a
  // single step (2^k is Infinity for k > 1023).
  const ldexp = (x, k) => {
    while (k > 1000) {
      x *= 2 ** 1000;
      k -= 1000;
    }
    while (k < -1000) {
      x *= 2 ** -1000;
      k += 1000;
    }
    return x * 2 ** k;
  };

  const bfSetPrec = (a, p) => {
    if (a.p === p) return a;
    const d = p - a.p;
    return { m: d > 0 ? a.m << BigInt(d) : a.m >> BigInt(-d), p };
  };

  const bfZero = (p) => ({ m: 0n, p });

  const bfFromNumber = (x, p) => {
    if (!Number.isFinite(x) || x === 0) return bfZero(p);
    const neg = x < 0;
    const ax = Math.abs(x);
    // Pull out the exponent so tiny values (1e-300 and below) survive.
    const e = Math.floor(Math.log2(ax));
    const k = 52 - e;
    const mi = BigInt(Math.round(ldexp(ax, k))); // exact: doubles have 53 bits
    const shift = p - k;
    const m = shift >= 0 ? mi << BigInt(shift) : mi >> BigInt(-shift);
    return { m: neg ? -m : m, p };
  };

  const bfToNumber = (a) => {
    if (a.m === 0n) return 0;
    const neg = a.m < 0n;
    const am = neg ? -a.m : a.m;
    const bits = am.toString(2).length;
    const shift = Math.max(0, bits - 53);
    const v = ldexp(Number(am >> BigInt(shift)), shift - a.p);
    return neg ? -v : v;
  };

  const bfAdd = (a, b) => {
    const p = Math.max(a.p, b.p);
    return { m: bfSetPrec(a, p).m + bfSetPrec(b, p).m, p };
  };

  const bfSub = (a, b) => {
    const p = Math.max(a.p, b.p);
    return { m: bfSetPrec(a, p).m - bfSetPrec(b, p).m, p };
  };

  const bfMul = (a, b) => {
    const p = Math.max(a.p, b.p);
    const A = bfSetPrec(a, p);
    const B = bfSetPrec(b, p);
    return { m: (A.m * B.m) >> BigInt(p), p };
  };

  /** Decimal rendering, `digits` places after the point. */
  const bfToFixed = (a, digits) => {
    const neg = a.m < 0n;
    const am = neg ? -a.m : a.m;
    // Built from a string rather than `10n ** n`: a transpiler that rewrites
    // the exponent operator to Math.pow would quietly break on BigInt.
    const scaled = (am * BigInt(`1${"0".repeat(digits)}`)) >> BigInt(a.p);
    const s = scaled.toString().padStart(digits + 1, "0");
    const whole = s.slice(0, s.length - digits);
    const frac = s.slice(s.length - digits);
    return `${neg ? "-" : ""}${whole}.${frac}`;
  };

  /**
   * Fractional bits needed to resolve a view at `zoomLevel`, plus guard bits so
   * that repeated pans and the reference orbit don't erode the low end.
   */
  const bfPrecisionForZoom = (zoomLevel) =>
    Math.max(64, Math.ceil(Math.log2(Math.max(zoomLevel, 1))) + 64);

  return {
    bfSetPrec,
    bfZero,
    bfFromNumber,
    bfToNumber,
    bfAdd,
    bfSub,
    bfMul,
    bfToFixed,
    bfPrecisionForZoom,
  };
};

export const {
  bfSetPrec,
  bfZero,
  bfFromNumber,
  bfToNumber,
  bfAdd,
  bfSub,
  bfMul,
  bfToFixed,
  bfPrecisionForZoom,
} = createBigFloatLib();
