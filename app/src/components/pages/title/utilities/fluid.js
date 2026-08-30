/**
 * The incompressible fluid behind the wind tunnel scene.
 *
 * The old wind tunnel had no fluid in it: every mote was pushed right at a
 * fixed speed and shoved aside by whatever rectangle it happened to be inside,
 * with a "density map" bolted on to stop them all piling into one line. It
 * could not do the thing a wind tunnel exists to show — flow separating off an
 * obstacle, and the wake behind it.
 *
 * So this is an actual solver: a staggered marker-and-cell grid, made
 * divergence-free by Gauss-Seidel with over-relaxation, then advected
 * semi-Lagrangian. Velocities live on cell faces (`u` on the left face, `v` on
 * the top face) because that is what makes the divergence of a cell a plain
 * sum of the four faces around it, and pressure a plain correction to those
 * same four numbers.
 *
 * Everything is in canvas units: distances in pixels, velocities in pixels per
 * second, `dt` in seconds. A scene can therefore hand the sampler a cursor
 * position and get back something it can move a particle by.
 */

/** Which staggered field a sample is being taken from. */
export const FIELD = Object.freeze({
  U: "u",
  V: "v",
  SMOKE: "smoke",
});

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** Ray casting: count the edges a ray to the right crosses. */
const pointInPolygon = (points, x, y) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (
      (a.y > y) !== (b.y > y) &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
};

export class FluidGrid {
  /**
   * @param {object} options
   * @param {number} options.width   canvas width in pixels
   * @param {number} options.height  canvas height in pixels
   * @param {number} [options.cellSize]  target cell size in pixels; the grid
   *   rounds up to cover the canvas
   * @param {number} [options.density]  only scales the pressure readout, which
   *   is a display value — the velocity correction is density-independent
   * @param {number} [options.overRelaxation]  1 is plain Gauss-Seidel; 1.9
   *   converges in far fewer sweeps, which is the whole reason this runs at 60
   *   frames a second
   * @param {number} [options.maxCells]  a ceiling on the grid, since the cost
   *   of a frame is the cell count and a 4K display would otherwise ask for
   *   four times the work a laptop does at the same cell size
   */
  constructor({
    width,
    height,
    cellSize = 12,
    density = 1000,
    overRelaxation = 1.9,
    maxCells = Infinity,
  }) {
    this.h = Math.max(2, cellSize);
    while (
      Math.ceil(width / this.h) * Math.ceil(height / this.h) > maxCells &&
      this.h < Math.max(width, height)
    ) {
      this.h += 1;
    }

    this.numX = Math.max(3, Math.ceil(width / this.h));
    this.numY = Math.max(3, Math.ceil(height / this.h));
    this.numCells = this.numX * this.numY;
    this.density = density;
    this.overRelaxation = overRelaxation;

    this.u = new Float32Array(this.numCells);
    this.v = new Float32Array(this.numCells);
    this.newU = new Float32Array(this.numCells);
    this.newV = new Float32Array(this.numCells);
    this.p = new Float32Array(this.numCells);
    /** 1 for fluid, 0 for solid. */
    this.s = new Float32Array(this.numCells);
    /** Dye, so the flow can be seen where no particle happens to be. */
    this.m = new Float32Array(this.numCells);
    this.newM = new Float32Array(this.numCells);

    this.resetSolids();
  }

  index(i, j) {
    return i * this.numY + j;
  }

  /** The cell a canvas position falls in. */
  cellAt(x, y) {
    return {
      i: clamp(Math.floor(x / this.h), 0, this.numX - 1),
      j: clamp(Math.floor(y / this.h), 0, this.numY - 1),
    };
  }

  /**
   * Open every cell, then close the tunnel walls: the left column is the
   * inflow face, the top and bottom are the tunnel roof and floor, and the
   * right is left open so the flow has somewhere to go.
   */
  resetSolids() {
    this.s.fill(1);
    for (let j = 0; j < this.numY; j++) this.s[this.index(0, j)] = 0;
    for (let i = 0; i < this.numX; i++) {
      this.s[this.index(i, 0)] = 0;
      this.s[this.index(i, this.numY - 1)] = 0;
    }
  }

  /** Close one cell, and drag the four faces around it along at (vx, vy). */
  setSolid(i, j, vx = 0, vy = 0) {
    if (i < 0 || j < 0 || i >= this.numX || j >= this.numY) return;

    const index = this.index(i, j);
    this.s[index] = 0;
    this.m[index] = 0;
    this.u[index] = vx;
    this.v[index] = vy;
    if (i + 1 < this.numX) this.u[this.index(i + 1, j)] = vx;
    if (j + 1 < this.numY) this.v[this.index(i, j + 1)] = vy;
  }

  /**
   * Close every cell overlapping a canvas-space rect. Obstacles are re-marked
   * from scratch each frame, because the page furniture they stand for moves.
   */
  addSolidRect({ left, right, top, bottom }, vx = 0, vy = 0) {
    const from = this.cellAt(left, top);
    const to = this.cellAt(right, bottom);
    for (let i = from.i; i <= to.i; i++) {
      for (let j = from.j; j <= to.j; j++) this.setSolid(i, j, vx, vy);
    }
  }

  /** Close every cell whose centre is inside a canvas-space circle. */
  addSolidCircle(cx, cy, radius, vx = 0, vy = 0) {
    const from = this.cellAt(cx - radius, cy - radius);
    const to = this.cellAt(cx + radius, cy + radius);
    const squared = radius * radius;

    for (let i = from.i; i <= to.i; i++) {
      for (let j = from.j; j <= to.j; j++) {
        const dx = (i + 0.5) * this.h - cx;
        const dy = (j + 0.5) * this.h - cy;
        if (dx * dx + dy * dy <= squared) this.setSolid(i, j, vx, vy);
      }
    }
  }

  /**
   * Close every cell whose centre falls inside a canvas-space polygon — the
   * aerofoil, which is neither a box nor a circle.
   */
  addSolidPolygon(points, vx = 0, vy = 0) {
    if (points.length < 3) return;

    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (let index = 0; index < points.length; index++) {
      const { x, y } = points[index];
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }

    const from = this.cellAt(left, top);
    const to = this.cellAt(right, bottom);

    for (let i = from.i; i <= to.i; i++) {
      const x = (i + 0.5) * this.h;
      for (let j = from.j; j <= to.j; j++) {
        const y = (j + 0.5) * this.h;
        if (pointInPolygon(points, x, y)) this.setSolid(i, j, vx, vy);
      }
    }
  }

  /**
   * Drive the inflow face at `speed`, and dye the incoming air wherever
   * `smokeAt` says so — that is what draws the streaklines a real tunnel gets
   * from a rake of smoke nozzles.
   *
   * @param {number} speed  pixels per second, rightwards
   * @param {(j: number) => number} [smokeAt]  dye for inflow row `j`, 0 to 1
   */
  setInflow(speed, smokeAt = null) {
    for (let j = 1; j < this.numY - 1; j++) {
      this.u[this.index(1, j)] = speed;
      this.u[this.index(0, j)] = speed;
      if (smokeAt) this.m[this.index(0, j)] = smokeAt(j);
    }
  }

  /**
   * Push the divergence out of every fluid cell.
   *
   * A cell's four faces should sum to zero — what flows in flows out. Where
   * they do not, the excess is shared back over whichever of the four
   * neighbours is fluid, which is the pressure correction written out. Sweeping
   * repeatedly propagates each correction outwards; over-relaxation
   * deliberately overshoots each one, and converges much faster for it.
   */
  solveIncompressibility(iterations, dt) {
    // This is the frame's hot loop — a couple of hundred thousand passes at
    // full screen — so the fields are pulled into locals and each column's
    // offset is computed once rather than per cell.
    const { numX, numY, u, v, s, p, overRelaxation } = this;
    const cp = (this.density * this.h) / dt;
    p.fill(0);

    for (let iteration = 0; iteration < iterations; iteration++) {
      for (let i = 1; i < numX - 1; i++) {
        const column = i * numY;
        const before = column - numY;
        const after = column + numY;

        for (let j = 1; j < numY - 1; j++) {
          const cell = column + j;
          if (s[cell] === 0) continue;

          const sx0 = s[before + j];
          const sx1 = s[after + j];
          const sy0 = s[cell - 1];
          const sy1 = s[cell + 1];
          const open = sx0 + sx1 + sy0 + sy1;
          if (open === 0) continue;

          const divergence = u[after + j] - u[cell] + v[cell + 1] - v[cell];
          const correction = (-divergence / open) * overRelaxation;
          p[cell] += cp * correction;

          u[cell] -= sx0 * correction;
          u[after + j] += sx1 * correction;
          v[cell] -= sy0 * correction;
          v[cell + 1] += sy1 * correction;
        }
      }
    }
  }

  /** Copy the edge velocities outwards, so samples at the border have data. */
  extrapolate() {
    const n = this.numY;
    for (let i = 0; i < this.numX; i++) {
      this.u[i * n] = this.u[i * n + 1];
      this.u[i * n + this.numY - 1] = this.u[i * n + this.numY - 2];
    }
    for (let j = 0; j < this.numY; j++) {
      this.v[j] = this.v[n + j];
      this.v[(this.numX - 1) * n + j] = this.v[(this.numX - 2) * n + j];
    }
  }

  /**
   * Bilinear sample of a staggered field at a canvas position. Each field
   * lives at a different place inside the cell, which is what the half-cell
   * offsets are for.
   */
  sampleField(x, y, field) {
    const { numX, numY, h } = this;
    const half = 0.5 * h;

    let dx = 0;
    let dy = 0;
    let values;
    if (field === FIELD.U) {
      values = this.u;
      dy = half;
    } else if (field === FIELD.V) {
      values = this.v;
      dx = half;
    } else {
      values = this.m;
      dx = half;
      dy = half;
    }

    const gx = (clamp(x, h, numX * h) - dx) / h;
    const gy = (clamp(y, h, numY * h) - dy) / h;
    let x0 = gx | 0;
    let y0 = gy | 0;
    if (x0 > numX - 1) x0 = numX - 1;
    if (y0 > numY - 1) y0 = numY - 1;
    const x1 = x0 + 1 < numX ? x0 + 1 : x0;
    const y1 = y0 + 1 < numY ? y0 + 1 : y0;
    const tx = gx - x0;
    const ty = gy - y0;
    const sx = 1 - tx;
    const sy = 1 - ty;
    const column0 = x0 * numY;
    const column1 = x1 * numY;

    return (
      sx * sy * values[column0 + y0] +
      tx * sy * values[column1 + y0] +
      tx * ty * values[column1 + y1] +
      sx * ty * values[column0 + y1]
    );
  }

  /** The vertical velocity at a `u` face — the average of its four neighbours. */
  avgV(i, j) {
    const n = this.numY;
    return (
      (this.v[(i - 1) * n + j] +
        this.v[i * n + j] +
        this.v[(i - 1) * n + j + 1] +
        this.v[i * n + j + 1]) *
      0.25
    );
  }

  /** The horizontal velocity at a `v` face. */
  avgU(i, j) {
    const n = this.numY;
    return (
      (this.u[i * n + j - 1] +
        this.u[i * n + j] +
        this.u[(i + 1) * n + j - 1] +
        this.u[(i + 1) * n + j]) *
      0.25
    );
  }

  /**
   * Move the velocity field along itself: for each face, walk backwards down
   * the flow for one step and take whatever velocity was there.
   */
  advectVelocity(dt) {
    const { numX, numY, u, v, s, newU, newV, h } = this;
    const half = 0.5 * h;
    newU.set(u);
    newV.set(v);

    for (let i = 1; i < numX; i++) {
      const column = i * numY;
      const before = column - numY;

      for (let j = 1; j < numY; j++) {
        const cell = column + j;
        if (s[cell] === 0) continue;

        if (s[before + j] !== 0 && j < numY - 1) {
          const x = i * h - dt * u[cell];
          const y = j * h + half - dt * this.avgV(i, j);
          newU[cell] = this.sampleField(x, y, FIELD.U);
        }

        if (s[cell - 1] !== 0 && i < numX - 1) {
          const x = i * h + half - dt * this.avgU(i, j);
          const y = j * h - dt * v[cell];
          newV[cell] = this.sampleField(x, y, FIELD.V);
        }
      }
    }

    u.set(newU);
    v.set(newV);
  }

  /** The same backwards walk, for the dye. */
  advectSmoke(dt) {
    const { numX, numY, u, v, s, m, newM, h } = this;
    const half = 0.5 * h;
    newM.set(m);

    for (let i = 1; i < numX - 1; i++) {
      const column = i * numY;
      const after = column + numY;

      for (let j = 1; j < numY - 1; j++) {
        const cell = column + j;
        if (s[cell] === 0) continue;

        const flowX = (u[cell] + u[after + j]) * 0.5;
        const flowY = (v[cell] + v[cell + 1]) * 0.5;
        const x = i * h + half - dt * flowX;
        const y = j * h + half - dt * flowY;
        newM[cell] = this.sampleField(x, y, FIELD.SMOKE);
      }
    }

    m.set(newM);
  }

  /**
   * One frame: make it divergence-free, then carry everything downstream.
   *
   * `smoke` is worth turning off when nothing is drawing the dye, since it is
   * a second full pass over the grid.
   */
  step(dt, { iterations = 20, smoke = true } = {}) {
    if (!(dt > 0)) return;
    this.solveIncompressibility(iterations, dt);
    this.extrapolate();
    this.advectVelocity(dt);
    if (smoke) this.advectSmoke(dt);
  }

  /** Flow velocity at a canvas position, in pixels per second. */
  sampleVelocity(x, y) {
    return {
      x: this.sampleField(x, y, FIELD.U),
      y: this.sampleField(x, y, FIELD.V),
    };
  }

  /** Dye at a canvas position, 0 to 1. */
  sampleSmoke(x, y) {
    return this.sampleField(x, y, FIELD.SMOKE);
  }

  isSolidAt(x, y) {
    const { i, j } = this.cellAt(x, y);
    return this.s[this.index(i, j)] === 0;
  }

  /** Cell-centred speed, for the field views. */
  speedAt(i, j) {
    const n = this.numY;
    const u = (this.u[i * n + j] + this.u[(i + 1 < this.numX ? i + 1 : i) * n + j]) * 0.5;
    const v = (this.v[i * n + j] + this.v[i * n + (j + 1 < this.numY ? j + 1 : j)]) * 0.5;
    return Math.sqrt(u * u + v * v);
  }
}
