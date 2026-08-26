/**
 * Mandelbrot worker.
 *
 * Two jobs, picked by `message.type`:
 *
 *  - "reference": iterate a single orbit at the view centre using arbitrary
 *    precision (the BigFloat helpers are injected as globals by WorkerFactory),
 *    and hand back the orbit as plain doubles.
 *
 *  - "orbit" / "tile": cache a reference orbit, then render rows of pixels by
 *    perturbation — each pixel iterates the *difference* from the reference in
 *    ordinary double precision, which is what lets the zoom go arbitrarily deep
 *    without arbitrary-precision cost per pixel.
 */
// eslint-disable-next-line import/no-anonymous-default-export
export default () => {
  // Injected onto the worker's global scope by WorkerFactory; pulled off `self`
  // explicitly rather than relied on as bare globals.
  // eslint-disable-next-line no-restricted-globals
  const { bfZero, bfToNumber, bfAdd, bfSub, bfMul } = self;

  const BAILOUT = 4;

  let refZx = new Float64Array(0);
  let refZy = new Float64Array(0);
  let refLen = 0;

  // eslint-disable-next-line no-restricted-globals
  self.addEventListener("message", (event) => {
    const data = event.data;

    if (data.type === "reference") {
      const orbit = calculateReferenceOrbit(data.cx, data.cy, data.maxIter);
      // eslint-disable-next-line no-restricted-globals
      self.postMessage(
        {
          type: "reference",
          Zx: orbit.Zx,
          Zy: orbit.Zy,
          refLen: orbit.refLen,
          refGeneration: data.refGeneration,
        },
        [orbit.Zx.buffer, orbit.Zy.buffer]
      );
      return;
    }

    if (data.type === "orbit") {
      refZx = data.Zx;
      refZy = data.Zy;
      refLen = data.refLen;
      return;
    }

    // "tile"
    if (refLen === 0) {
      // No reference orbit yet — still answer so the caller's queue drains.
      reply(new Uint32Array(0), data);
      return;
    }

    // A run of evenly spaced pixels, described rather than listed, and the
    // counts handed back in a typed array so the reply is transferred rather
    // than copied: a frame's worth as a plain Array costs ~60ms to clone.
    const results = new Uint32Array(data.count);
    const dcy = data.dcy0 + data.rowY * data.pixelSpacing;
    for (let i = 0; i < data.count; i++) {
      results[i] = perturbedIterate(
        data.dcx0 + (data.startX + i * data.step) * data.pixelSpacing,
        dcy,
        data.maxIter
      );
    }

    reply(results, data);
  });

  function reply(results, request) {
    // eslint-disable-next-line no-restricted-globals
    self.postMessage(
      {
        results,
        drawGeneration: request.drawGeneration,
        // Echoed so the caller can match a reply to the request that asked for
        // it: several draws can have work outstanding on the same worker.
        requestId: request.requestId,
      },
      [results.buffer]
    );
  }

  /**
   * The high precision part: Z_{n+1} = Z_n^2 + C at the reference point, kept
   * only as doubles since the perturbed iteration never needs more than that.
   */
  function calculateReferenceOrbit(cx, cy, maxIter) {
    const Zx = new Float64Array(maxIter + 1);
    const Zy = new Float64Array(maxIter + 1);

    let zx = bfZero(cx.p);
    let zy = bfZero(cy.p);
    let n = 0;

    while (n <= maxIter) {
      const dzx = bfToNumber(zx);
      const dzy = bfToNumber(zy);
      Zx[n] = dzx;
      Zy[n] = dzy;
      n += 1;
      if (dzx * dzx + dzy * dzy > BAILOUT) break; // orbit left the set

      const zx2 = bfMul(zx, zx);
      const zy2 = bfMul(zy, zy);
      const nextZy = bfAdd(bfAdd(bfMul(zx, zy), bfMul(zx, zy)), cy);
      zx = bfAdd(bfSub(zx2, zy2), cx);
      zy = nextZy;
    }

    return { Zx: Zx.slice(0, n), Zy: Zy.slice(0, n), refLen: n };
  }

  /**
   * Perturbation with rebasing (Zhuoran's method): iterate the delta against
   * the reference orbit, and whenever the delta grows larger than the orbit
   * point itself — the case where the classic perturbation loses all its
   * significant digits and glitches — restart the reference index from zero
   * with the full value as the new delta. Exact, and no glitch detection pass.
   */
  function perturbedIterate(dcx, dcy, maxIter) {
    let dzx = 0;
    let dzy = 0;
    let n = 0;
    let m = 0; // index into the reference orbit

    while (n < maxIter) {
      const zx = refZx[m] + dzx;
      const zy = refZy[m] + dzy;
      const zz = zx * zx + zy * zy;

      if (zz > BAILOUT) return n;

      if (zz < dzx * dzx + dzy * dzy || m + 1 >= refLen) {
        dzx = zx;
        dzy = zy;
        m = 0;
      }

      const Zx = refZx[m];
      const Zy = refZy[m];
      const nextDzx =
        2 * (Zx * dzx - Zy * dzy) + (dzx * dzx - dzy * dzy) + dcx;
      const nextDzy = 2 * (Zx * dzy + Zy * dzx) + 2 * dzx * dzy + dcy;

      dzx = nextDzx;
      dzy = nextDzy;
      m += 1;
      n += 1;
    }

    return maxIter;
  }
};
