import { FIELD, FluidGrid } from "../src/components/pages/title/utilities/fluid";

/**
 * The wind tunnel's solver, exercised without a canvas or React.
 *
 * The things worth pinning down are the ones a wind tunnel is judged on:
 * that the air is incompressible, that none of it goes through an obstacle,
 * that what enters the tunnel leaves it, and that a bluff body actually sheds
 * a wake rather than leaving a dead patch behind it.
 */

const DT = 1 / 60;

const makeGrid = (overrides = {}) =>
  new FluidGrid({ width: 480, height: 240, cellSize: 8, ...overrides });

/** Run the tunnel for `steps` frames at a steady inflow. */
const run = (grid, steps, { speed = 200, iterations = 30, each = null } = {}) => {
  for (let step = 0; step < steps; step++) {
    grid.setInflow(speed);
    if (each) each(step);
    grid.step(DT, { iterations, smoke: false });
  }
};

/** What the four faces of a cell add up to; zero when the cell is conserving. */
const divergenceOf = (grid, i, j) => {
  const n = grid.numY;
  return (
    grid.u[(i + 1) * n + j] -
    grid.u[i * n + j] +
    grid.v[i * n + j + 1] -
    grid.v[i * n + j]
  );
};

const interiorCells = (grid, visit) => {
  for (let i = 1; i < grid.numX - 1; i++) {
    for (let j = 1; j < grid.numY - 1; j++) visit(i, j);
  }
};

const obstacle = (grid) => ({
  left: grid.numX * grid.h * 0.3,
  right: grid.numX * grid.h * 0.3 + 40,
  top: grid.numY * grid.h * 0.5 - 30,
  bottom: grid.numY * grid.h * 0.5 + 30,
});

test("the tunnel is walled top and bottom, open at the outflow", () => {
  const grid = makeGrid();

  expect(grid.s[grid.index(5, 0)]).toBe(0);
  expect(grid.s[grid.index(5, grid.numY - 1)]).toBe(0);
  expect(grid.s[grid.index(0, 5)]).toBe(0);
  expect(grid.s[grid.index(grid.numX - 1, 5)]).toBe(1);
  expect(grid.s[grid.index(5, 5)]).toBe(1);
});

const maxDivergence = (grid) => {
  let max = 0;
  interiorCells(grid, (i, j) => {
    if (grid.s[grid.index(i, j)] === 0) return;
    max = Math.max(max, Math.abs(divergenceOf(grid, i, j)));
  });
  return max;
};

test("a settled tunnel holds its air incompressible", () => {
  const grid = makeGrid();
  run(grid, 120);

  // Nothing is disturbing this flow, so a frame's worth of advection leaves
  // barely any divergence and the solve clears what there is.
  grid.setInflow(200);
  grid.solveIncompressibility(20, DT);
  expect(maxDivergence(grid)).toBeLessThan(0.01);
});

test("solving drives the divergence out from around an obstacle", () => {
  const grid = makeGrid();
  const block = obstacle(grid);

  run(grid, 200, {
    each: () => grid.addSolidRect(block),
  });

  // Re-stamping the obstacle each frame pushes air into cells that have just
  // been closed, which is where the divergence comes from.
  grid.setInflow(200);
  grid.addSolidRect(block);
  const before = maxDivergence(grid);
  expect(before).toBeGreaterThan(10);

  grid.solveIncompressibility(20, DT);
  expect(maxDivergence(grid)).toBeLessThan(before / 10);
});

test("what goes in comes out", () => {
  const grid = makeGrid();
  run(grid, 60);

  const n = grid.numY;
  const fluxAt = (i) => {
    let flux = 0;
    for (let j = 1; j < grid.numY - 1; j++) flux += grid.u[i * n + j];
    return flux;
  };

  const inflow = fluxAt(1);
  const outflow = fluxAt(grid.numX - 1);
  expect(inflow).toBeGreaterThan(0);
  expect(Math.abs(outflow - inflow) / inflow).toBeLessThan(0.05);
});

test("no air goes through an obstacle", () => {
  const grid = makeGrid();
  const block = obstacle(grid);

  run(grid, 120, {
    each: () => grid.addSolidRect(block),
  });

  const centre = {
    x: (block.left + block.right) / 2,
    y: (block.top + block.bottom) / 2,
  };
  expect(grid.isSolidAt(centre.x, centre.y)).toBe(true);

  const inside = grid.sampleVelocity(centre.x, centre.y);
  expect(Math.hypot(inside.x, inside.y)).toBeLessThan(1);

  // ...and it has to go somewhere, so it speeds up over the shoulder.
  const over = grid.sampleVelocity(centre.x, block.top - grid.h * 1.5);
  expect(over.x).toBeGreaterThan(200);
});

test("a bluff body sheds a wake that keeps swinging", () => {
  const grid = makeGrid();
  const block = obstacle(grid);
  const probe = {
    x: block.right + 60,
    y: (block.top + block.bottom) / 2,
  };

  const trace = [];
  run(grid, 900, {
    speed: 260,
    each: (step) => {
      grid.addSolidRect(block);
      // Let the wake establish itself before recording it.
      if (step > 300) trace.push(grid.sampleVelocity(probe.x, probe.y).y);
    },
  });

  // A dead wake reads as a flat line; a shedding one crosses zero over and
  // over as vortices peel off alternate sides.
  const crossings = trace.filter(
    (value, index) => index > 0 && Math.sign(value) !== Math.sign(trace[index - 1])
  ).length;
  const swing = Math.max(...trace.map(Math.abs));

  expect(swing).toBeGreaterThan(20);
  expect(crossings).toBeGreaterThan(3);
});

test("dye is carried downstream and stays out of solids", () => {
  const grid = makeGrid();
  const block = obstacle(grid);
  const band = (j) => (j % 6 < 3 ? 1 : 0);

  for (let step = 0; step < 200; step++) {
    grid.setInflow(220, band);
    grid.addSolidRect(block);
    grid.step(DT, { iterations: 30 });
  }

  const downstream = grid.sampleSmoke(block.right + 80, grid.numY * grid.h * 0.25);
  expect(downstream).toBeGreaterThan(0.05);

  const inside = grid.sampleSmoke(
    (block.left + block.right) / 2,
    (block.top + block.bottom) / 2
  );
  expect(inside).toBeLessThan(0.05);
});

test("sampling reads the field back in canvas coordinates", () => {
  const grid = makeGrid();
  run(grid, 60, { speed: 300 });

  const upstream = grid.sampleVelocity(grid.h * 2, grid.numY * grid.h * 0.5);
  expect(upstream.x).toBeGreaterThan(250);
  expect(Math.abs(upstream.y)).toBeLessThan(30);

  // The staggered fields sit at different places in the cell, so a sample of
  // each has to come from its own offset.
  expect(grid.sampleField(grid.h * 2, grid.h * 2, FIELD.U)).not.toBeNaN();
  expect(grid.sampleField(grid.h * 2, grid.h * 2, FIELD.V)).not.toBeNaN();
  expect(grid.sampleField(grid.h * 2, grid.h * 2, FIELD.SMOKE)).not.toBeNaN();
});

test("a moving obstacle drags the air with it", () => {
  const grid = makeGrid();
  const centre = { x: grid.numX * grid.h * 0.5, y: grid.numY * grid.h * 0.5 };

  // No inflow at all: whatever the air does is the obstacle's doing.
  for (let step = 0; step < 40; step++) {
    grid.addSolidCircle(centre.x, centre.y, 24, 0, -300);
    grid.step(DT, { iterations: 30, smoke: false });
    grid.resetSolids();
  }

  const ahead = grid.sampleVelocity(centre.x, centre.y - 40);
  expect(ahead.y).toBeLessThan(-5);
});

test("the grid covers the canvas whatever the cell size", () => {
  [4, 9, 17, 40].forEach((cellSize) => {
    const grid = new FluidGrid({ width: 801, height: 399, cellSize });
    expect(grid.numX * grid.h).toBeGreaterThanOrEqual(801);
    expect(grid.numY * grid.h).toBeGreaterThanOrEqual(399);
    expect(grid.isSolidAt(400, 200)).toBe(false);
  });
});
