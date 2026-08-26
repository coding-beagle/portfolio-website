import workerBody from "../src/components/pages/title/utilities/workers/mandelbrot.worker";
import { createInProcessWorker } from "./helpers/workerHarness";
import {
  createBigFloatLib,
  bfAdd,
  bfMul,
  bfSub,
  bfZero,
  bfSetPrec,
  bfFromNumber,
  bfToNumber,
  bfPrecisionForZoom,
} from "../src/components/pages/title/utilities/bigFloat";

/** Drives the real worker source synchronously. */
function startWorker() {
  const worker = createInProcessWorker(workerBody, [createBigFloatLib], {
    sync: true,
  });
  let last = null;
  worker.onmessage = (event) => {
    last = event.data;
  };

  return {
    reference(cx, cy, maxIter) {
      worker.postMessage({
        type: "reference",
        cx,
        cy,
        maxIter,
        refGeneration: 1,
      });
      const orbit = last;
      worker.postMessage({
        type: "orbit",
        Zx: orbit.Zx,
        Zy: orbit.Zy,
        refLen: orbit.refLen,
      });
      return orbit;
    },
    /** One row of pixels, expressed as offsets from the reference point. */
    row(dcx0, dcy0, pixelSpacing, rowY, pixels, maxIter) {
      worker.postMessage({
        type: "tile",
        rowPixels: pixels,
        rowY,
        dcx0,
        dcy0,
        pixelSpacing,
        maxIter,
        drawGeneration: 3,
      });
      expect(last.drawGeneration).toBe(3);
      return last.results;
    },
    /** Iteration count for a single point, as an offset from the reference. */
    at(dcx, dcy, maxIter) {
      return this.row(dcx, dcy, 0, 0, [0], maxIter)[0];
    },
  };
}

/** Ground truth #1: the plain double iteration, valid at shallow zooms. */
function plainIterate(cx, cy, maxIter) {
  let zx = 0;
  let zy = 0;
  let n = 0;
  while (n < maxIter && zx * zx + zy * zy <= 4) {
    const next = zx * zx - zy * zy + cx;
    zy = 2 * zx * zy + cy;
    zx = next;
    n += 1;
  }
  return n;
}

/** Ground truth #2: the same iteration in arbitrary precision, valid anywhere. */
function preciseIterate(cx, cy, maxIter) {
  let zx = bfZero(cx.p);
  let zy = bfZero(cy.p);
  let n = 0;
  while (n < maxIter) {
    const x = bfToNumber(zx);
    const y = bfToNumber(zy);
    if (x * x + y * y > 4) return n;
    const zx2 = bfMul(zx, zx);
    const zy2 = bfMul(zy, zy);
    const nextZy = bfAdd(bfAdd(bfMul(zx, zy), bfMul(zx, zy)), cy);
    zx = bfAdd(bfSub(zx2, zy2), cx);
    zy = nextZy;
    n += 1;
  }
  return maxIter;
}

describe("reference orbit", () => {
  test("an orbit inside the set runs to the iteration limit", () => {
    const p = bfPrecisionForZoom(1);
    const orbit = startWorker().reference(bfZero(p), bfZero(p), 500);
    expect(orbit.refLen).toBe(501);
    expect(orbit.Zx.every((v) => v === 0)).toBe(true);
  });

  test("an orbit outside the set stops where it escapes", () => {
    const p = bfPrecisionForZoom(1);
    const orbit = startWorker().reference(
      bfFromNumber(2, p),
      bfFromNumber(2, p),
      500
    );
    expect(orbit.refLen).toBeLessThan(5);
    expect(orbit.Zx.length).toBe(orbit.refLen); // trimmed, not a padded buffer
  });

  test("tiles arriving before an orbit answer rather than hanging the pool", () => {
    const worker = createInProcessWorker(workerBody, [createBigFloatLib], {
      sync: true,
    });
    let reply = null;
    worker.onmessage = (event) => {
      reply = event.data;
    };
    worker.postMessage({
      type: "tile",
      rowPixels: [0, 1, 2],
      rowY: 0,
      dcx0: 0,
      dcy0: 0,
      pixelSpacing: 0.1,
      maxIter: 100,
      drawGeneration: 9,
    });
    expect(reply).toEqual({ results: [], drawGeneration: 9 });
  });
});

describe("perturbed iteration", () => {
  const maxIter = 3000;

  test("reproduces the plain iteration exactly across the whole set", () => {
    const p = bfPrecisionForZoom(1);
    const refCx = -0.5;
    const refCy = 0;
    const worker = startWorker();
    worker.reference(bfFromNumber(refCx, p), bfFromNumber(refCy, p), maxIter);

    const spacing = 3 / 59;
    for (let j = 0; j < 60; j++) {
      const cy = -1.2 + (2.4 * j) / 59;
      const results = worker.row(
        -2.2 - refCx,
        cy - refCy,
        spacing,
        0,
        [...Array(60).keys()],
        maxIter
      );
      results.forEach((got, i) => {
        expect(got).toBe(plainIterate(-2.2 + spacing * i, cy, maxIter));
      });
    }
  });

  test("rebases correctly off a reference that escapes immediately", () => {
    // The reference is well outside the set, so its orbit is a few entries
    // long and every pixel has to rebase — the branch that replaces glitch
    // detection, and the one a short orbit would otherwise read past.
    const p = bfPrecisionForZoom(1);
    const worker = startWorker();
    const orbit = worker.reference(
      bfFromNumber(1.5, p),
      bfFromNumber(1.5, p),
      maxIter
    );
    expect(orbit.refLen).toBeLessThan(10);

    for (const [cx, cy] of [
      [0, 0],
      [-1, 0],
      [-0.75, 0.1],
      [0.3, 0.5],
      [-1.7, 0.02],
    ]) {
      expect(worker.at(cx - 1.5, cy - 1.5, maxIter)).toBe(
        plainIterate(cx, cy, maxIter)
      );
    }
  });

  test("matches arbitrary precision iteration at 1e30 zoom", () => {
    const zoom = 1e30;
    const p = bfPrecisionForZoom(zoom);
    const cx = bfFromNumber(-0.7436438870371587, p);
    const cy = bfFromNumber(0.13182590420531197, p);
    const deepMax = 20000;
    const worker = startWorker();
    worker.reference(cx, cy, deepMax);

    const spacing = 2 / (zoom * 800);
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        const dcx = i * spacing * 40;
        const dcy = j * spacing * 40;
        expect(worker.at(dcx, dcy, deepMax)).toBe(
          preciseIterate(
            bfAdd(cx, bfFromNumber(dcx, p)),
            bfAdd(cy, bfFromNumber(dcy, p)),
            deepMax
          )
        );
      }
    }
  });
});

test("stays exact while diving to a zoom far past double precision", () => {
  // Repeatedly recentre on a boundary pixel and zoom, the way the scene does,
  // checking the rendered counts against arbitrary precision at every level.
  // Double precision alone runs out of digits around 1e15.
  const width = 24;
  let zoom = 1;
  let cx = bfFromNumber(-0.75, bfPrecisionForZoom(1));
  let cy = bfFromNumber(0.1, bfPrecisionForZoom(1));
  let detailedLevels = 0;

  for (let level = 0; level < 34; level++) {
    const p = bfPrecisionForZoom(zoom);
    cx = bfSetPrec(cx, p);
    cy = bfSetPrec(cy, p);
    const maxIter = Math.round(2000 + 600 * Math.max(0, Math.log10(zoom)));
    const view = 2 / zoom;
    const spacing = view / width;

    const worker = startWorker();
    worker.reference(cx, cy, maxIter);

    const grid = [];
    for (let j = 0; j < width; j++) {
      grid.push(
        worker.row(
          -view / 2,
          (j / width - 0.5) * view,
          spacing,
          0,
          [...Array(width).keys()],
          maxIter
        )
      );
    }

    for (const [i, j] of [[5, 5], [12, 12], [19, 7]]) {
      const dcx = (i / width - 0.5) * view;
      const dcy = (j / width - 0.5) * view;
      expect(grid[j][i]).toBe(
        preciseIterate(
          bfAdd(cx, bfFromNumber(dcx, p)),
          bfAdd(cy, bfFromNumber(dcy, p)),
          maxIter
        )
      );
    }
    if (new Set(grid.flat()).size > 20) detailedLevels += 1;

    // Recentre on the pixel with the most varied neighbourhood, then zoom in.
    let best = [1, 1];
    let bestScore = -1;
    for (let j = 1; j < width - 1; j++) {
      for (let i = 1; i < width - 1; i++) {
        const score = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(
          ([di, dj]) => grid[j + dj][i + di] !== grid[j][i]
        ).length;
        if (score > bestScore) {
          bestScore = score;
          best = [i, j];
        }
      }
    }
    cx = bfAdd(cx, bfFromNumber((best[0] / width - 0.5) * view, p));
    cy = bfAdd(cy, bfFromNumber((best[1] / width - 0.5) * view, p));
    zoom *= 4;
  }

  expect(zoom).toBeGreaterThan(1e20);
  expect(detailedLevels).toBeGreaterThan(25); // still resolving structure, not flat
});
