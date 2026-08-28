import {
  EDGE_CLEARANCE,
  MAX_PRESSURE_ERROR,
  MAX_PRESSURE_STEP,
  MIN_PRESSURE_FRACTION,
  PRESSURE_GAIN,
  SoftBody,
  SoftBodyPoint,
  SoftBodyWorld,
  closestPointOnPolygon,
  getUnitVector,
  pointInPolygon,
  polygonArea,
  pushOutOfRect,
  read,
  regularPolygonArea,
  regularPolygonRadius,
  resolveHitboxCollision,
  vectorBetween,
  vectorLength,
} from "../src/components/pages/title/utilities/softBody";

/**
 * The squishball physics, exercised without a canvas or React.
 *
 * The three things worth pinning down are the ones that were wrong or absent
 * in the scene: the area the pressure force is computed from, what happens to
 * a point that meets the title hitbox, and the state shared between bodies now
 * that there can be more than one.
 */

const CANVAS = { width: 800, height: 600 };

/** A stand-in for ElementCollisionHitbox — the physics only reads the rect. */
const hitbox = ({ left, right, top, bottom }) => ({
  rect_padded: { left, right, top, bottom },
});

const makeWorld = (overrides = {}) =>
  new SoftBodyWorld({
    canvas: CANVAS,
    // A predictable shuffle keeps the constraint solver deterministic.
    random: () => 0.5,
    ...overrides,
  });

/** A regular polygon, the shape a body settles into when fully inflated. */
const regularPolygon = (sides, radius, cx = 0, cy = 0) =>
  Array.from({ length: sides }, (_, i) => {
    const angle = (i / sides) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });

const distance = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

/** Longest gap between any two points — a settled ball's rough width. */
const spread = (body) => {
  let widest = 0;
  body.points.forEach((a) =>
    body.points.forEach((b) => {
      widest = Math.max(widest, distance(a, b));
    })
  );
  return widest;
};

const settle = (world, frames = 400) => {
  for (let i = 0; i < frames; i++) world.step();
};

describe("reading tunables", () => {
  test("takes refs, getters and plain values alike", () => {
    expect(read(7)).toBe(7);
    expect(read({ current: 7 })).toBe(7);
    expect(read(() => 7)).toBe(7);
    expect(read(false)).toBe(false);
  });

  test("a world follows the ref its slider writes to", () => {
    const ballSize = { current: 40 };
    const world = makeWorld({ ballSize });
    expect(world.ballSize).toBe(40);

    ballSize.current = 120;
    expect(world.ballSize).toBe(120);
  });
});

describe("vector helpers", () => {
  test("the vector between two points and its length", () => {
    expect(vectorBetween({ x: 4, y: 6 }, { x: 1, y: 2 })).toEqual({ x: 3, y: 4 });
    expect(vectorLength({ x: 3, y: 4 })).toBe(5);
  });

  test("unit vectors keep the direction and drop the magnitude", () => {
    const unit = getUnitVector({ x: 0, y: -8 });
    expect(unit).toEqual({ x: 0, y: -1 });
    expect(vectorLength(getUnitVector({ x: 3, y: 4 }))).toBeCloseTo(1);
  });

  test("a zero vector has no direction rather than NaN", () => {
    expect(getUnitVector({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe("polygon area", () => {
  // The scene's own shoelace summed `point.y + point.y`, so it reported twice
  // the real area and the pressure force was calibrated around the mistake.
  test("a square encloses its side squared", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(polygonArea(square)).toBeCloseTo(100);
  });

  test("winding direction does not change it", () => {
    const polygon = regularPolygon(6, 20);
    expect(polygonArea([...polygon].reverse())).toBeCloseTo(polygonArea(polygon));
  });

  test("a regular polygon matches the closed form for its side length", () => {
    const sides = 8;
    const polygon = regularPolygon(sides, 50);
    const sideLength = distance(polygon[0], polygon[1]);
    expect(polygonArea(polygon)).toBeCloseTo(regularPolygonArea(sides, sideLength), 6);
  });

  test("many-sided regular polygons approach a circle", () => {
    expect(regularPolygonArea(720, (2 * Math.PI * 100) / 720)).toBeCloseTo(
      Math.PI * 100 ** 2,
      0
    );
  });
});

describe("pushing out of a rectangle", () => {
  const rect = { left: 100, right: 300, top: 100, bottom: 200 };

  test("leaves a point outside alone", () => {
    expect(pushOutOfRect(50, 150, rect)).toBeNull();
    expect(pushOutOfRect(200, 400, rect)).toBeNull();
    expect(pushOutOfRect(200, 150, null)).toBeNull();
  });

  test("takes the shortest way out, and reports the way it went", () => {
    expect(pushOutOfRect(200, 110, rect)).toEqual({ x: 200, y: 100, nx: 0, ny: -1 });
    expect(pushOutOfRect(200, 190, rect)).toEqual({ x: 200, y: 200, nx: 0, ny: 1 });
    expect(pushOutOfRect(110, 150, rect)).toEqual({ x: 100, y: 150, nx: -1, ny: 0 });
    expect(pushOutOfRect(290, 150, rect)).toEqual({ x: 300, y: 150, nx: 1, ny: 0 });
  });

  test("sets a resolved point down just clear of the edge it left by", () => {
    // A hitbox counts its own boundary as inside, so a point left exactly on
    // the edge would be resolved again on the very next frame, forever.
    const resolved = resolveHitboxCollision(200, 110, [{ rect_padded: rect }]);
    expect(resolved.y).toBeCloseTo(100 - EDGE_CLEARANCE);
    expect(pushOutOfRect(resolved.x, resolved.y, rect)).toBeNull();
  });

  test("only the crossed axis moves", () => {
    const pushed = pushOutOfRect(137, 105, rect);
    expect(pushed.x).toBe(137);
    expect(pushed.y).toBe(100);
  });

  test("a point wedged between two hitboxes ends up out of both", () => {
    const boxes = [
      hitbox({ left: 0, right: 100, top: 0, bottom: 100 }),
      hitbox({ left: 90, right: 200, top: 0, bottom: 100 }),
    ];
    const resolved = resolveHitboxCollision(95, 20, boxes);
    expect(resolved).not.toBeNull();
    boxes.forEach((box) => {
      expect(pushOutOfRect(resolved.x, resolved.y, box.rect_padded)).toBeNull();
    });
  });

  test("hitboxes whose element is not on the page yet are skipped", () => {
    expect(resolveHitboxCollision(50, 50, [{}, { rect_padded: null }])).toBeNull();
  });
});

describe("a point meeting the title", () => {
  const title = hitbox({ left: 300, right: 500, top: 200, bottom: 260 });
  const world = () => makeWorld({ hitboxes: [title], gravity: 0 });

  test("is stopped at the surface rather than left inside it", () => {
    const point = new SoftBodyPoint(400, 180);
    point.setVelocity(0, 40); // falling onto the title

    point.update(world());

    expect(point.y).toBeLessThanOrEqual(200);
    expect(pushOutOfRect(point.x, point.y, title.rect_padded)).toBeNull();
  });

  test("keeps sliding along the surface it landed on", () => {
    // The old scene vetoed the whole step when the next position was inside
    // the hitbox, so a point touching the title lost its sideways motion too
    // and stuck fast.
    const point = new SoftBodyPoint(340, 195);
    point.setVelocity(20, 20);

    point.update(world());

    expect(point.x).toBeGreaterThan(340);
    expect(point.velocity.x).toBeGreaterThan(0);
  });

  test("drops the velocity that carried it in", () => {
    const point = new SoftBodyPoint(400, 195);
    point.setVelocity(0, 30);

    point.update(world());

    expect(point.velocity.y).toBeLessThanOrEqual(0);
  });

  test("a point buried inside gets out instead of freezing there", () => {
    // The constraint solver moves points without consulting the hitboxes, so
    // one can end up inside the title; under the old check every position it
    // could move to was also inside, and it never moved again.
    const point = new SoftBodyPoint(390, 230);
    const scene = world();

    point.update(scene);
    expect(pushOutOfRect(point.x, point.y, title.rect_padded)).toBeNull();

    const before = { x: point.x, y: point.y };
    point.applyForce(3, 0);
    point.update(scene);
    expect(point.x).not.toBeCloseTo(before.x);
  });

  test("stays out over a long fall onto the title", () => {
    const scene = makeWorld({ hitboxes: [title] });
    const point = new SoftBodyPoint(400, 20);

    for (let i = 0; i < 200; i++) {
      point.update(scene);
      expect(pushOutOfRect(point.x, point.y, title.rect_padded)).toBeNull();
    }
    expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
  });

  test("passes straight through while the title is hidden", () => {
    const scene = makeWorld({ hitboxes: [title], collisionsEnabled: false, gravity: 0 });
    const point = new SoftBodyPoint(400, 180);
    point.setVelocity(0, 40);

    point.update(scene);

    expect(point.y).toBeGreaterThan(200);
  });
});

describe("a point and the canvas edges", () => {
  test("bounces back off each edge", () => {
    const scene = makeWorld({ gravity: 0, friction: 1 });

    const falling = new SoftBodyPoint(400, CANVAS.height - 12);
    falling.setVelocity(0, 20);
    falling.update(scene);
    expect(falling.y).toBe(CANVAS.height - falling.size);
    expect(falling.velocity.y).toBeLessThan(0);

    const rising = new SoftBodyPoint(400, 12);
    rising.setVelocity(0, -20);
    rising.update(scene);
    expect(rising.y).toBe(rising.size);
    expect(rising.velocity.y).toBeGreaterThan(0);

    const rightward = new SoftBodyPoint(CANVAS.width - 12, 300);
    rightward.setVelocity(20, 0);
    rightward.update(scene);
    expect(rightward.x).toBe(CANVAS.width - rightward.size);
    expect(rightward.velocity.x).toBeLessThan(0);

    const leftward = new SoftBodyPoint(12, 300);
    leftward.setVelocity(-20, 0);
    leftward.update(scene);
    expect(leftward.x).toBe(leftward.size);
    expect(leftward.velocity.x).toBeGreaterThan(0);
  });

  test("gravity accumulates and friction bleeds speed away", () => {
    const scene = makeWorld({ gravity: 0.5 });
    const point = new SoftBodyPoint(400, 100);

    point.update(scene);
    expect(point.velocity.y).toBeCloseTo(0.5);
    point.update(scene);
    expect(point.velocity.y).toBeCloseTo(0.5 * 0.93 + 0.5);

    const coasting = new SoftBodyPoint(400, 100);
    coasting.setVelocity(10, 0);
    coasting.update(makeWorld({ gravity: 0 }));
    expect(coasting.velocity.x).toBeCloseTo(9.3);
  });

  test("the simulation speed scales the force applied, not the drift", () => {
    const slow = new SoftBodyPoint(0, 0);
    const fast = new SoftBodyPoint(0, 0);

    slow.update(makeWorld({ simulationSpeed: 50 }));
    fast.update(makeWorld({ simulationSpeed: 200 }));

    expect(fast.velocity.y).toBeCloseTo(slow.velocity.y * 4);
  });

  test("translating carries the velocity along untouched", () => {
    const point = new SoftBodyPoint(10, 10);
    point.setVelocity(3, -2);
    point.translate(5, 5);

    expect(point.x).toBe(15);
    expect(point.velocity).toEqual({ x: 3, y: -2 });
  });
});

describe("a body", () => {
  test("is a closed ring of points, each constrained to the next", () => {
    const body = new SoftBody(100, 100, { pointCount: 6 });
    body.changeDistanceConstraints(50);

    expect(body.points).toHaveLength(6);
    expect(body.constraints).toHaveLength(6);
    expect(body.constraints[5].p2).toBe(body.points[0]);
    body.constraints.forEach((constraint) => expect(constraint.distance).toBe(50));
  });

  test("rebuilds its constraints only when the size changes", () => {
    const body = new SoftBody(100, 100);
    body.changeDistanceConstraints(50);
    const constraints = body.constraints;

    body.changeDistanceConstraints(50);
    expect(body.constraints).toBe(constraints);

    body.changeDistanceConstraints(60);
    expect(body.constraints).not.toBe(constraints);
    expect(body.constraints[0].distance).toBe(60);
  });

  test("relaxation pulls the spacing towards the target distance", () => {
    const body = new SoftBody(400, 300, { pointCount: 8, radius: 10 });
    body.changeDistanceConstraints(40);

    const gap = () => distance(body.points[0], body.points[1]);
    const before = gap();
    for (let i = 0; i < 40; i++) body.solveConstraints(() => 0.5);

    expect(gap()).toBeGreaterThan(before);
    expect(gap()).toBeCloseTo(40, 0);
  });

  test("normals point outwards", () => {
    const body = new SoftBody(0, 0, { pointCount: 8, radius: 10 });

    body.points.forEach((point, index) => {
      const normal = body.getNormalOfPoint(index);
      const outward = getUnitVector(point); // the body is centred on the origin
      expect(normal.x * outward.x + normal.y * outward.y).toBeGreaterThan(0.9);
    });
  });

  test("pressure pushes out while it is under-inflated and stops when it is not", () => {
    const world = makeWorld({ ballSize: 40, ballPressure: 100 });
    const collapsed = new SoftBody(400, 300, { pointCount: 8, radius: 5 });
    expect(collapsed.applyPressure(world)).toBeGreaterThan(0);

    const inflated = new SoftBody(400, 300, { pointCount: 8, radius: 200 });
    expect(inflated.applyPressure(world)).toBeLessThan(0);
  });

  test("the pressure slider spans a saggy ball to a full one", () => {
    // The bottom of the slider used to ask for a couple of percent of the
    // area, which the ring cannot reach at all — every setting down there
    // looked the same crumpled mess — while the top asked for so little push
    // that a ball never looked properly blown up.
    const body = new SoftBody(400, 300, { pointCount: 8 });
    const at = (ballPressure) =>
      makeWorld({ ballSize: 60, ballPressure }).desiredAreaFor(body) /
      regularPolygonArea(8, 60);

    expect(at(100)).toBeCloseTo(1);
    expect(at(1)).toBeCloseTo(MIN_PRESSURE_FRACTION, 1);
    expect(at(0)).toBeCloseTo(MIN_PRESSURE_FRACTION);
    expect(at(50)).toBeGreaterThan(at(25));
    expect(at(25)).toBeGreaterThan(at(1));
  });

  test("a ball at full pressure is round, and one at the bottom sags", () => {
    const restingArea = (ballPressure) => {
      const world = makeWorld({ ballSize: 60, ballPressure });
      const body = world.addBody(400, 100);
      settle(world, 600);
      return body.calculateAreaOfSelf() / regularPolygonArea(8, 60);
    };

    const full = restingArea(100);
    const empty = restingArea(1);

    expect(full).toBeGreaterThan(0.8);
    expect(empty).toBeGreaterThan(0.3); // still a ball, not a crumpled dot
    expect(empty).toBeLessThan(full - 0.2); // and visibly softer than a full one
  });

  test("the pressure force ignores the size of the ball", () => {
    // Area grows with the square of the size and gravity does not, so a force
    // taken from the area error itself made the same slider setting a pancake
    // at one end of the size slider and a rock at the other.
    // A ball a twentieth short of the area it wants — the everyday deflection,
    // well inside the per-frame cap at every size.
    const forceWhenSlightlyShort = (ballSize) => {
      const world = makeWorld({ ballSize, ballPressure: 100 });
      const body = new SoftBody(400, 300, {
        pointCount: 8,
        radius: regularPolygonRadius(8, ballSize) * Math.sqrt(0.95),
      });
      return body.applyPressure(world);
    };

    expect(forceWhenSlightlyShort(150)).toBeCloseTo(forceWhenSlightlyShort(20), 5);
    expect(forceWhenSlightlyShort(80)).toBeGreaterThan(0);
  });

  test("the force it can pull or push with is bounded", () => {
    // Unbounded, the relative error runs away as the area approaches zero —
    // which a body flattened against the floor gets close to.
    const world = makeWorld({ ballSize: 6000, ballPressure: 50 }); // cap out of the way

    const collapsed = new SoftBody(400, 300, { pointCount: 8, radius: 0.001 });
    expect(collapsed.applyPressure(world)).toBeCloseTo(
      MAX_PRESSURE_ERROR * PRESSURE_GAIN
    );

    const overblown = new SoftBody(400, 300, { pointCount: 8, radius: 100000 });
    expect(overblown.applyPressure(world)).toBeCloseTo(-PRESSURE_GAIN, 0);
  });

  test("one frame of pressure never moves a point further than the ball is big", () => {
    // The force is the same at every ball size, so on a small ball it would
    // otherwise be wider than the ball itself and turn it inside out.
    const collapsed = () => new SoftBody(400, 300, { pointCount: 8, radius: 0.001 });

    [20, 80, 150].forEach((ballSize) => {
      [50, 100, 200].forEach((simulationSpeed) => {
        const world = makeWorld({ ballSize, simulationSpeed, ballPressure: 100 });
        const step = simulationSpeed / 100;
        expect(collapsed().applyPressure(world) * step).toBeLessThanOrEqual(
          MAX_PRESSURE_STEP * ballSize + 1e-9
        );
      });
    });
  });

  test("a small ball at double speed stays a ball", () => {
    // The combination that blew up before the cap: the smallest ball the
    // slider offers, with every force applied twice as hard.
    const world = makeWorld({ ballSize: 20, simulationSpeed: 200, ballPressure: 50 });
    const body = world.addBody(400, 100);

    settle(world, 600);

    const ratio = body.calculateAreaOfSelf() / world.desiredAreaFor(body);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(1.5);
  });

  test("the squish factor scales the force it pushes with", () => {
    const slightlyShort = () =>
      new SoftBody(400, 300, {
        pointCount: 8,
        radius: regularPolygonRadius(8, 60) * Math.sqrt(0.9),
      });

    const softForce = slightlyShort().applyPressure(
      makeWorld({ ballSize: 60, ballPressure: 100, squishFactor: 1 })
    );
    const stiffForce = slightlyShort().applyPressure(
      makeWorld({ ballSize: 60, ballPressure: 100, squishFactor: 3 })
    );

    expect(stiffForce).toBeCloseTo(softForce * 3);
  });

  test("balls of every size squash the same amount under gravity", () => {
    // The visible complaint when the force scaled with the area: a small ball
    // flattened on the floor while a large one barely dented.
    const squashOnTheFloor = (ballSize) => {
      const world = makeWorld({ ballSize });
      const body = world.addBody(400, 100);
      settle(world, 600);
      return body.calculateAreaOfSelf() / world.desiredAreaFor(body);
    };

    const small = squashOnTheFloor(25);
    const large = squashOnTheFloor(120);

    expect(small).toBeGreaterThan(0.5);
    expect(large).toBeGreaterThan(0.5);
    expect(Math.abs(small - large)).toBeLessThan(0.15);
  });

  test("is laid out at the size its pressure setting will hold", () => {
    // Spawning at full stretch and deflating on screen is a visible pop.
    const world = makeWorld({ ballSize: 60, ballPressure: 25, gravity: 0 });
    const body = world.addBody(400, 300);

    const atSpawn = body.calculateAreaOfSelf();
    settle(world, 200);

    expect(atSpawn).toBeCloseTo(world.desiredAreaFor(body), -1);
    expect(body.calculateAreaOfSelf()).toBeCloseTo(atSpawn, -1);
  });

  test("inflates to about the area it is asked for", () => {
    const world = makeWorld({ ballSize: 60, ballPressure: 90, gravity: 0 });
    const body = world.addBody(400, 300);

    settle(world);

    const wanted = world.desiredAreaFor(body);
    expect(body.calculateAreaOfSelf()).toBeGreaterThan(wanted * 0.7);
    expect(body.calculateAreaOfSelf()).toBeLessThan(wanted * 1.3);
  });

  test("a bigger ball setting makes a bigger ball", () => {
    const small = makeWorld({ ballSize: 30, gravity: 0 });
    const large = makeWorld({ ballSize: 90, gravity: 0 });
    const smallBall = small.addBody(400, 300);
    const largeBall = large.addBody(400, 300);

    settle(small);
    settle(large);

    expect(spread(largeBall)).toBeGreaterThan(spread(smallBall) * 1.5);
  });

  test("settles on the floor without leaving the canvas or going NaN", () => {
    const world = makeWorld({ ballSize: 50 });
    const body = world.addBody(400, 100);

    settle(world);

    body.points.forEach((point) => {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(CANVAS.width);
      expect(point.y).toBeLessThanOrEqual(CANVAS.height);
    });
    expect(body.center.y).toBeGreaterThan(300); // it fell
  });

  test("comes to rest on top of the title instead of sinking through it", () => {
    const title = hitbox({ left: 300, right: 500, top: 400, bottom: 460 });
    const world = makeWorld({ ballSize: 40, hitboxes: [title] });
    const body = world.addBody(400, 100);

    settle(world, 600);

    // Resting on the bar, not fallen past it or buried inside it.
    expect(body.center.y).toBeLessThan(400);
    body.points.forEach((point) => {
      expect(pushOutOfRect(point.x, point.y, title.rect_padded)).toBeNull();
    });
  });
});

describe("points inside another body", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  test("point-in-polygon knows inside from outside", () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 50 }, square)).toBe(false);
    expect(pointInPolygon({ x: 50, y: -1 }, square)).toBe(false);
    expect(pointInPolygon({ x: 50, y: 50 }, regularPolygon(8, 30, 50, 50))).toBe(true);
  });

  test("the closest point on the outline is on the nearest edge", () => {
    const closest = closestPointOnPolygon({ x: 10, y: 50 }, square);
    expect(closest.x).toBeCloseTo(0);
    expect(closest.y).toBeCloseTo(50);
    expect(closest.distance).toBeCloseTo(10);
    expect(new Set([closest.startIndex, closest.endIndex])).toEqual(new Set([3, 0]));
  });

  test("a body pushes a foreign point out to its edge and gives ground itself", () => {
    const body = new SoftBody(0, 0, { pointCount: 4, radius: 100 });
    const intruder = new SoftBodyPoint(body.points[0].x - 5, body.points[0].y);
    const edgeBefore = { ...body.points[0] };

    expect(body.pushPointOut(intruder)).toBe(true);
    expect(body.contains(intruder)).toBe(false);
    expect(distance(body.points[0], edgeBefore)).toBeGreaterThan(0);
  });

  test("leaves its own points and points outside it alone", () => {
    const body = new SoftBody(0, 0, { pointCount: 8, radius: 100 });
    expect(body.pushPointOut(body.points[0])).toBe(false);
    expect(body.pushPointOut(new SoftBodyPoint(1000, 1000))).toBe(false);
  });
});

describe("a world of several balls", () => {
  test("fills and empties to the count it is given", () => {
    const world = makeWorld();

    world.syncBodyCount(4);
    expect(world.bodies).toHaveLength(4);

    world.syncBodyCount(2);
    expect(world.bodies).toHaveLength(2);

    world.syncBodyCount({ current: 5 });
    expect(world.bodies).toHaveLength(5);

    world.syncBodyCount(0);
    expect(world.bodies).toHaveLength(0);
  });

  test("every ball is its own body of its own points", () => {
    const world = makeWorld();
    world.syncBodyCount(3);

    const points = world.bodies.flatMap((body) => body.points);
    expect(new Set(points).size).toBe(points.length);
    world.bodies.forEach((body) => expect(body.points).toHaveLength(world.pointsPerBody));
  });

  test("balls are spawned on the canvas, clear of the edges", () => {
    const world = makeWorld({ ballSize: 60, random: Math.random });
    world.syncBodyCount(8);

    world.bodies.forEach((body) => {
      expect(body.center.x).toBeGreaterThan(0);
      expect(body.center.x).toBeLessThan(CANVAS.width);
      expect(body.center.y).toBeGreaterThan(0);
      expect(body.center.y).toBeLessThan(CANVAS.height);
    });
  });

  test("overlapping balls push each other apart", () => {
    const world = makeWorld({ ballSize: 40, gravity: 0 });
    // Spawned on top of one another, which is what a resize or an unlucky
    // scatter does.
    const first = world.addBody(400, 300);
    const second = world.addBody(440, 300);

    settle(world, 300);

    const separation = distance(first.center, second.center);
    expect(separation).toBeGreaterThan(40);
    first.points.forEach((point) => expect(second.contains(point)).toBe(false));
    second.points.forEach((point) => expect(first.contains(point)).toBe(false));
  });

  test("a crowd of balls stays finite and on the canvas", () => {
    const world = makeWorld({ ballSize: 50, random: Math.random });
    world.syncBodyCount(6);

    settle(world, 400);

    world.bodies.forEach((body) =>
      body.points.forEach((point) => {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(CANVAS.width);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(CANVAS.height);
      })
    );
  });

  test("reports the mean area of the balls it holds", () => {
    const world = makeWorld({ gravity: 0 });
    expect(world.area).toBe(0);

    world.syncBodyCount(3);
    settle(world, 50);

    expect(world.area).toBeGreaterThan(0);
    expect(world.area).toBeCloseTo(
      world.bodies.reduce((total, body) => total + body.area, 0) / 3
    );
  });
});

describe("dragging", () => {
  const pointerAt = (x, y, down = true) => ({
    posRef: { current: { x, y } },
    downRef: { current: down },
    touchActiveRef: { current: false },
  });

  test("grabs the point under the cursor and pulls it along", () => {
    const pointer = pointerAt(400, 300);
    const world = makeWorld({ pointer, gravity: 0 });
    const point = new SoftBodyPoint(420, 300);

    world.dragTowardPointer(point);

    expect(world.draggingPoint).toBe(point);
    expect(point.x).toBeLessThan(420);
    expect(point.x).toBeGreaterThan(400);
  });

  test("ignores points beyond the grab radius", () => {
    const world = makeWorld({ pointer: pointerAt(0, 0), grabRadius: 50 });
    const point = new SoftBodyPoint(400, 300);

    expect(world.dragTowardPointer(point)).toBe(false);
    expect(world.draggingPoint).toBeNull();
  });

  test("does not grab anything until the pointer is down", () => {
    const pointer = pointerAt(400, 300, false);
    const world = makeWorld({ pointer });
    const point = new SoftBodyPoint(400, 300);

    expect(world.dragTowardPointer(point)).toBe(false);

    pointer.downRef.current = true;
    expect(world.dragTowardPointer(point)).toBe(true);
  });

  test("a touch drags as a click does", () => {
    const pointer = pointerAt(400, 300, false);
    pointer.touchActiveRef.current = true;
    const world = makeWorld({ pointer });

    expect(world.dragTowardPointer(new SoftBodyPoint(400, 300))).toBe(true);
  });

  test("holds one point at a time across every ball", () => {
    // Each ball used to carry its own idea of what was being dragged; with
    // several on screen a single grab would tear a point out of all of them.
    const pointer = pointerAt(0, 0);
    const world = makeWorld({ pointer, ballSize: 40, gravity: 0 });
    const first = world.addBody(400, 300);
    world.addBody(410, 300); // overlapping, so both have points under the cursor
    pointer.posRef.current = { x: first.points[0].x, y: first.points[0].y };

    world.step();

    const held = world.bodies.flatMap((body) => body.points).filter((point) => point === world.draggingPoint);
    expect(held).toHaveLength(1);
  });

  test("lets go when the pointer comes up", () => {
    const pointer = pointerAt(400, 300);
    const world = makeWorld({ pointer, gravity: 0 });
    const point = new SoftBodyPoint(400, 300);

    world.dragTowardPointer(point);
    expect(world.draggingPoint).toBe(point);

    pointer.downRef.current = false;
    world.dragTowardPointer(point);
    expect(world.draggingPoint).toBeNull();
  });

  test("lets go of a ball the count slider has taken away", () => {
    // The dragged point belonged to a body that no longer exists; latched, it
    // would have blocked every later grab.
    const pointer = pointerAt(0, 0);
    const world = makeWorld({ pointer, ballSize: 40, gravity: 0 });
    const body = world.addBody(400, 300);
    pointer.posRef.current = { x: body.points[0].x, y: body.points[0].y };
    world.step();
    expect(world.draggingPoint).not.toBeNull();

    world.syncBodyCount(0);
    expect(world.draggingPoint).toBeNull();
  });

  test("clearing the world drops the bodies and the drag with them", () => {
    const world = makeWorld({ pointer: pointerAt(400, 300) });
    world.syncBodyCount(2);
    world.draggingPoint = world.bodies[0].points[0];

    world.clear();

    expect(world.bodies).toHaveLength(0);
    expect(world.draggingPoint).toBeNull();
  });
});

describe("drawing", () => {
  const recordingContext = () => {
    const calls = [];
    const record = (name) => (...args) => calls.push({ name, args });
    return {
      calls,
      names: () => calls.map((call) => call.name),
      beginPath: record("beginPath"),
      closePath: record("closePath"),
      moveTo: record("moveTo"),
      quadraticCurveTo: record("quadraticCurveTo"),
      arc: record("arc"),
      fill: record("fill"),
      save: record("save"),
      restore: record("restore"),
      set fillStyle(value) {
        calls.push({ name: "fillStyle", args: [value] });
      },
    };
  };

  test("draws the outline as one closed curve through every point", () => {
    const ctx = recordingContext();
    new SoftBody(400, 300, { pointCount: 8, radius: 40 }).draw(ctx, { fill: "#abcdef" });

    expect(ctx.names().filter((name) => name === "quadraticCurveTo")).toHaveLength(8);
    expect(ctx.names()).toContain("moveTo");
    expect(ctx.names()).toContain("closePath");
    expect(ctx.calls).toContainEqual({ name: "fillStyle", args: ["#abcdef"] });
  });

  test("draws the control points only when they are asked for", () => {
    const hidden = recordingContext();
    const shown = recordingContext();
    const body = new SoftBody(400, 300, { pointCount: 8, radius: 40 });

    body.draw(hidden, { fill: "#fff" });
    body.draw(shown, { fill: "#fff", accent: "#f00", showControlPoints: true });

    expect(hidden.names()).not.toContain("arc");
    expect(shown.names().filter((name) => name === "arc")).toHaveLength(8);
    expect(shown.calls).toContainEqual({ name: "fillStyle", args: ["#f00"] });
  });

  test("a degenerate body draws nothing rather than throwing", () => {
    const ctx = recordingContext();
    new SoftBody(0, 0, { pointCount: 2 }).draw(ctx, { fill: "#fff" });
    expect(ctx.calls).toHaveLength(0);
  });

  test("a world paints every ball it holds", () => {
    const ctx = recordingContext();
    const world = makeWorld();
    world.syncBodyCount(3);

    world.draw(ctx, { fill: "#fff" });

    expect(ctx.names().filter((name) => name === "quadraticCurveTo")).toHaveLength(
      3 * world.pointsPerBody
    );
  });
});
