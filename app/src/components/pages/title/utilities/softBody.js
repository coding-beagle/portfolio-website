/**
 * The pressure soft body behind the squishball scene.
 *
 * A body is a ring of Verlet points held together by distance constraints and
 * inflated by a pressure force pushing out along each point's normal. All of
 * it used to live inside the scene's effect, closed over the component's refs
 * and the canvas context — which made it untestable, and made more than one
 * ball impossible: the drag target was a single variable in that closure and
 * nothing knew about any body but its own. The shared state belongs to a
 * `SoftBodyWorld` here, so a scene can hold as many bodies as it likes.
 *
 * Every tunable is read through `read`, so a scene passes the `useRef` its
 * slider writes to and a test passes a plain number.
 */

import { safeNegativeModulo } from "./usefulFunctions";

/** A ref, a getter or a plain value — all read the same way. */
export const read = (value) => {
  if (typeof value === "function") return value();
  if (value && typeof value === "object" && "current" in value) {
    return value.current;
  }
  return value;
};

export const vectorBetween = (from, to) => ({ x: from.x - to.x, y: from.y - to.y });

export const vectorLength = (vector) => Math.sqrt(vector.x ** 2 + vector.y ** 2);

/** Unit vector, or the zero vector when there is no direction to give. */
export const getUnitVector = (vector) => {
  const length = vectorLength(vector);
  if (!length) return { x: 0, y: 0 };
  return { x: vector.x / length, y: vector.y / length };
};

/**
 * Shoelace area of a closed polygon, sign discarded so winding does not
 * matter.
 */
export const polygonArea = (points) => {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += (current.x - next.x) * (current.y + next.y) / 2;
  }
  return Math.abs(area);
};

/**
 * The most a ring of `sides` points spaced `sideLength` apart can enclose —
 * the regular polygon. Pressure is a percentage of this, so the slider means
 * the same thing whatever the ball's size.
 */
export const regularPolygonArea = (sides, sideLength) =>
  (sides * sideLength ** 2) / (4 * Math.tan(Math.PI / sides));

/** Distance from the centre of a regular polygon out to one of its points. */
export const regularPolygonRadius = (sides, sideLength) =>
  sideLength / (2 * Math.sin(Math.PI / sides));

/**
 * Acceleration a point is given per whole ball of area error, before the
 * scene's squish factor. Tuned so a ball resting on the floor holds about
 * nine tenths of the area it wants — squishy under a landing or a drag, but
 * round when it is left alone — and stays stable at the top of the simulation
 * speed slider, where every force is applied twice as hard.
 */
export const PRESSURE_GAIN = 15;

/**
 * The least inflated a ball is ever asked to be, as a share of the area its
 * ring of points could enclose.
 */
export const MIN_PRESSURE_FRACTION = 0.45;

/**
 * The furthest, as a share of the ball's size, that the pressure force is
 * allowed to move a point in one frame.
 *
 * The force is deliberately the same whatever the ball's size, so that a
 * small ball and a large one squash alike under the same gravity — but on a
 * small ball, unchecked, that acceleration is wider than the ball itself, and
 * it turns inside out within a few frames. The cap divides by the simulation
 * step, since that is what the force gets multiplied by on the way in.
 */
export const MAX_PRESSURE_STEP = 0.1;

/**
 * How hard a fully squashed body is allowed to push back. The relative error
 * runs away as the area approaches zero, which a soft body flattened against
 * the floor gets close to.
 */
export const MAX_PRESSURE_ERROR = 3;

/**
 * A hitbox counts its own boundary as inside, so a point put exactly on an
 * edge is still colliding. Resolved points are set down just clear of it.
 */
export const EDGE_CLEARANCE = 0.01;

/**
 * Shortest way out of a rectangle.
 *
 * Returns the pushed-out position and the outward normal, or null when the
 * point is already outside. Whichever of the four sides is nearest wins, which
 * is what lets a point resting on the title slide along it instead of being
 * shoved out through the side it happens to have come in by.
 */
export const pushOutOfRect = (x, y, rect) => {
  if (!rect) return null;
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
    return null;
  }

  const toLeft = x - rect.left;
  const toRight = rect.right - x;
  const toTop = y - rect.top;
  const toBottom = rect.bottom - y;
  const shortest = Math.min(toLeft, toRight, toTop, toBottom);

  if (shortest === toLeft) return { x: rect.left, y, nx: -1, ny: 0 };
  if (shortest === toRight) return { x: rect.right, y, nx: 1, ny: 0 };
  if (shortest === toTop) return { x, y: rect.top, nx: 0, ny: -1 };
  return { x, y: rect.bottom, nx: 0, ny: 1 };
};

/**
 * Move a point out of the hitboxes it is inside.
 *
 * Every side of every hitbox containing the point is a candidate exit; the
 * nearest one that is clear of *all* the hitboxes wins, so a point wedged
 * where two of them overlap leaves by a side that actually gets it out rather
 * than being shuffled from one box straight into the next.
 *
 * Takes `ElementCollisionHitbox` instances; ones whose element is not on the
 * page yet have no rectangle and are skipped.
 */
export const resolveHitboxCollision = (x, y, hitboxes = []) => {
  const rects = hitboxes
    .map((hitbox) => hitbox && hitbox.rect_padded)
    .filter(Boolean);

  const candidates = [];
  rects.forEach((rect) => {
    const exit = pushOutOfRect(x, y, rect);
    if (!exit) return;
    candidates.push(
      { x: rect.left - EDGE_CLEARANCE, y, nx: -1, ny: 0 },
      { x: rect.right + EDGE_CLEARANCE, y, nx: 1, ny: 0 },
      { x, y: rect.top - EDGE_CLEARANCE, nx: 0, ny: -1 },
      { x, y: rect.bottom + EDGE_CLEARANCE, nx: 0, ny: 1 }
    );
  });

  if (!candidates.length) return null;

  const cost = (candidate) => Math.abs(candidate.x - x) + Math.abs(candidate.y - y);
  const clear = candidates.filter((candidate) =>
    rects.every((rect) => !pushOutOfRect(candidate.x, candidate.y, rect))
  );

  // Nothing is clear only when the hitboxes enclose the point on every side;
  // the shortest hop still makes progress, so take it.
  const reachable = clear.length ? clear : candidates;
  return reachable.reduce((best, candidate) =>
    cost(candidate) < cost(best) ? candidate : best
  );
};

/** Ray cast, counting crossings to the right of the point. */
export const pointInPolygon = (point, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const straddles = (a.y > point.y) !== (b.y > point.y);
    if (!straddles) continue;
    const crossingX = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < crossingX) inside = !inside;
  }
  return inside;
};

/**
 * Nearest point on the polygon's outline, with the indices of the edge it sits
 * on so the edge can be pushed back.
 *
 * `awayFrom` — in practice the polygon's own centre — keeps only the exits
 * that take the point further from it. Without that, a point that has sunk
 * past the middle of a body is nearest to the *far* side and gets pushed out
 * through it, which drags the two bodies together instead of apart.
 */
export const closestPointOnPolygon = (point, polygon, { awayFrom = null } = {}) => {
  const depth = awayFrom
    ? Math.sqrt((point.x - awayFrom.x) ** 2 + (point.y - awayFrom.y) ** 2)
    : 0;

  let best = null;
  let bestOutward = null;

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const lengthSquared = ex * ex + ey * ey;
    const t = lengthSquared
      ? Math.max(0, Math.min(1, ((point.x - a.x) * ex + (point.y - a.y) * ey) / lengthSquared))
      : 0;

    const x = a.x + ex * t;
    const y = a.y + ey * t;
    const distance = Math.sqrt((point.x - x) ** 2 + (point.y - y) ** 2);
    const candidate = { x, y, distance, t, startIndex: i, endIndex: (i + 1) % polygon.length };

    if (!best || distance < best.distance) best = candidate;

    if (awayFrom) {
      const reach = Math.sqrt((x - awayFrom.x) ** 2 + (y - awayFrom.y) ** 2);
      if (reach >= depth && (!bestOutward || distance < bestOutward.distance)) {
        bestOutward = candidate;
      }
    }
  }

  return bestOutward ?? best;
};

const shuffled = (array, random = Math.random) => {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const temp = copy[i];
    copy[i] = copy[j];
    copy[j] = temp;
  }
  return copy;
};

/** One Verlet point of a body's outline. */
export class SoftBodyPoint {
  constructor(x, y, { size = 10 } = {}) {
    this.x = x;
    this.y = y;
    this.oldX = x;
    this.oldY = y;
    this.a_x = 0;
    this.a_y = 0;
    this.size = size;
  }

  applyForce(fx, fy) {
    this.a_x += fx;
    this.a_y += fy;
  }

  /** Verlet velocity: the step the point last took. */
  get velocity() {
    return { x: this.x - this.oldX, y: this.y - this.oldY };
  }

  /** Move the shadow position so the *next* step is `vx, vy`. */
  setVelocity(vx, vy) {
    this.oldX = this.x - vx;
    this.oldY = this.y - vy;
  }

  /** Shift the point without changing the velocity it carries. */
  translate(dx, dy) {
    this.x += dx;
    this.y += dy;
    this.oldX += dx;
    this.oldY += dy;
  }

  integrate(world) {
    const { x: vx, y: vy } = this.velocity;
    const damped = { x: vx * world.friction, y: vy * world.friction };
    const step = world.simulationSpeed / 100;

    this.oldX = this.x;
    this.oldY = this.y;

    this.a_y += world.gravity;

    this.x += damped.x + this.a_x * step;
    this.y += damped.y + this.a_y * step;

    this.a_x = 0;
    this.a_y = 0;
  }

  /** Keep the point on the canvas, reflecting what carried it off. */
  constrainToCanvas(canvas, bounce = 1) {
    const { x: vx, y: vy } = this.velocity;

    if (this.x > canvas.width - this.size) {
      this.x = canvas.width - this.size;
      this.oldX = this.x + vx * bounce;
    } else if (this.x < this.size) {
      this.x = this.size;
      this.oldX = this.x + vx * bounce;
    }

    if (this.y > canvas.height - this.size) {
      this.y = canvas.height - this.size;
      this.oldY = this.y + vy * bounce;
    } else if (this.y < this.size) {
      this.y = this.size;
      this.oldY = this.y + vy * bounce;
    }
  }

  /**
   * Push the point back out of any hitbox it has ended up inside and drop the
   * velocity it carried in, keeping the rest.
   *
   * The old scene vetoed the whole step instead — a point whose next position
   * was inside the title simply did not move, on either axis, so a ball
   * touching the title froze against it rather than sliding, and a point the
   * constraint solver had already buried inside could never move again,
   * because every position it might move to was inside too.
   */
  collideWithHitboxes(world) {
    if (!world.collisionsEnabled) return false;

    const pushed = resolveHitboxCollision(this.x, this.y, world.hitboxes);
    if (!pushed) return false;

    this.x = pushed.x;
    this.y = pushed.y;

    let { x: vx, y: vy } = this.velocity;
    const into = vx * pushed.nx + vy * pushed.ny;
    if (into < 0) {
      vx -= into * pushed.nx;
      vy -= into * pushed.ny;
      vx *= world.surfaceFriction;
      vy *= world.surfaceFriction;
    }
    this.setVelocity(vx, vy);

    return true;
  }

  update(world) {
    world.dragTowardPointer(this);
    this.integrate(world);
    this.constrainToCanvas(world.canvas, world.bounce);
    this.collideWithHitboxes(world);
  }
}

/** A ring of points held at a fixed spacing and inflated from the inside. */
export class SoftBody {
  constructor(x, y, { pointCount = 8, radius = 10, pointSize = 10 } = {}) {
    this.points = [];
    for (let i = 0; i < pointCount; i++) {
      const angle = (i / pointCount) * Math.PI * 2;
      this.points.push(
        new SoftBodyPoint(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, {
          size: pointSize,
        })
      );
    }
    this.constraints = [];
    this.constraintDistance = null;
    this.area = 0;
  }

  get center() {
    const sum = this.points.reduce(
      (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
      { x: 0, y: 0 }
    );
    return { x: sum.x / this.points.length, y: sum.y / this.points.length };
  }

  changeDistanceConstraints(distance) {
    if (distance === this.constraintDistance) return;
    this.constraintDistance = distance;
    this.constraints = this.points.map((point, index) => ({
      p1: point,
      p2: this.points[(index + 1) % this.points.length],
      distance,
    }));
  }

  calculateAreaOfSelf() {
    return polygonArea(this.points);
  }

  /** Outward normal at a point, from the line through its two neighbours. */
  getNormalOfPoint(index) {
    const previous = this.points[safeNegativeModulo(index - 1, this.points.length)];
    const next = this.points[(index + 1) % this.points.length];
    const along = vectorBetween(previous, next);
    return getUnitVector({ x: -along.y, y: along.x });
  }

  /**
   * One relaxation pass over the distance constraints. The order is shuffled
   * so no single point is consistently solved last and left slack.
   */
  solveConstraints(random = Math.random) {
    shuffled(this.constraints, random).forEach(({ p1, p2, distance }) => {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const currentDist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
      const delta = (currentDist - distance) / currentDist;

      const offsetX = dx * 0.5 * delta;
      const offsetY = dy * 0.5 * delta;

      p1.x += offsetX;
      p1.y += offsetY;
      p2.x -= offsetX;
      p2.y -= offsetY;
    });
  }

  /**
   * Push every point outwards in proportion to how far the body is from the
   * area it wants — the gas inside it.
   *
   * The force comes from the *relative* area error, not the area error
   * itself. Area grows with the square of the ball's size while the gravity
   * pulling each point down does not, so a force taken straight from the area
   * scaled with the size twice over: the same pressure setting gave a pancake
   * at one end of the size slider and a rock at the other, and sent a large
   * ball into a collapse-and-rebound wobble it took hundreds of frames to
   * shake off. A relative error puts every ball on the same footing, so the
   * slider means the same thing at any size.
   */
  applyPressure(world) {
    this.area = this.calculateAreaOfSelf();

    const desired = world.desiredAreaFor(this);
    // Bounded either way: a squashed body cannot push back infinitely hard,
    // and an over-inflated one can only ever pull its own pressure back.
    const error = Math.max(
      -1,
      Math.min(MAX_PRESSURE_ERROR, desired / Math.max(this.area, 1) - 1)
    );
    const wanted = error * world.squishFactor * PRESSURE_GAIN;
    const limit =
      (MAX_PRESSURE_STEP * world.ballSize) / Math.max(world.simulationSpeed / 100, 0.01);
    const pressure = Math.max(-limit, Math.min(limit, wanted));

    this.points.forEach((point, index) => {
      const normal = this.getNormalOfPoint(index);
      point.applyForce(normal.x * pressure, normal.y * pressure);
    });

    return pressure;
  }

  update(world) {
    this.changeDistanceConstraints(world.ballSize);
    this.applyPressure(world);

    for (let iteration = 0; iteration < world.constraintIterations; iteration++) {
      this.solveConstraints(world.random);
    }

    this.points.forEach((point) => point.update(world));
  }

  /** True when `point` lies inside this body's outline. */
  contains(point) {
    return pointInPolygon(point, this.points);
  }

  /**
   * Move `point` out to this body's nearest edge, pushing the edge back half
   * as far — enough to keep two balls out of each other without a full
   * body-to-body collision response.
   */
  pushPointOut(point) {
    if (this.points.includes(point)) return false;
    if (!this.contains(point)) return false;

    const closest = closestPointOnPolygon(point, this.points, { awayFrom: this.center });
    if (!closest) return false;

    // Set it down just past the edge; landing exactly on the outline leaves it
    // ambiguous which side it is on, and it can be counted as inside again.
    const outward = getUnitVector({ x: closest.x - point.x, y: closest.y - point.y });
    const dx = closest.x - point.x + outward.x * EDGE_CLEARANCE;
    const dy = closest.y - point.y + outward.y * EDGE_CLEARANCE;

    point.translate(dx, dy);

    const start = this.points[closest.startIndex];
    const end = this.points[closest.endIndex];
    start.translate((-dx * (1 - closest.t)) / 2, (-dy * (1 - closest.t)) / 2);
    end.translate((-dx * closest.t) / 2, (-dy * closest.t) / 2);

    return true;
  }

  draw(ctx, { fill, accent = null, showControlPoints = false } = {}) {
    if (this.points.length < 3) return;

    if (showControlPoints) {
      this.points.forEach((point) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = accent ?? fill;
        ctx.fill();
        ctx.closePath();
      });
    }

    ctx.beginPath();
    ctx.fillStyle = fill;

    // Start at the midpoint between the last and first point: every point is
    // then a control point of a curve, and the outline closes smoothly.
    const lastPoint = this.points[this.points.length - 1];
    const firstPoint = this.points[0];
    ctx.moveTo((lastPoint.x + firstPoint.x) / 2, (lastPoint.y + firstPoint.y) / 2);

    for (let i = 0; i < this.points.length; i++) {
      const current = this.points[i];
      const next = this.points[(i + 1) % this.points.length];
      ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
    }

    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Everything the bodies share: the canvas they live on, the hitboxes they are
 * kept out of, the pointer, the sliders, and the one point being dragged.
 */
export class SoftBodyWorld {
  constructor({
    canvas,
    hitboxes = [],
    pointer = {},
    gravity = 0.5,
    friction = 0.93,
    bounce = 1,
    surfaceFriction = 0.8,
    dragStrength = 0.6,
    grabRadius = 100,
    ballSize = 100,
    ballPressure = 50,
    squishFactor = 1,
    simulationSpeed = 100,
    pointsPerBody = 8,
    spawnRadius = null,
    constraintIterations = 20,
    collisionsEnabled = true,
    random = Math.random,
  } = {}) {
    this.canvas = canvas ?? { width: 0, height: 0 };
    this.hitboxes = hitboxes;
    this.pointer = pointer;
    this.config = {
      gravity,
      friction,
      bounce,
      surfaceFriction,
      dragStrength,
      grabRadius,
      ballSize,
      ballPressure,
      squishFactor,
      simulationSpeed,
      pointsPerBody,
      spawnRadius,
      constraintIterations,
      collisionsEnabled,
    };
    this.random = random;
    this.bodies = [];
    this.draggingPoint = null;
  }

  get gravity() { return read(this.config.gravity); }
  get friction() { return read(this.config.friction); }
  get bounce() { return read(this.config.bounce); }
  get surfaceFriction() { return read(this.config.surfaceFriction); }
  get dragStrength() { return read(this.config.dragStrength); }
  get grabRadius() { return read(this.config.grabRadius); }
  get ballSize() { return read(this.config.ballSize); }
  get ballPressure() { return read(this.config.ballPressure); }
  get squishFactor() { return read(this.config.squishFactor); }
  get simulationSpeed() { return read(this.config.simulationSpeed); }
  get pointsPerBody() { return Math.max(3, Math.round(read(this.config.pointsPerBody))); }
  get constraintIterations() { return read(this.config.constraintIterations); }
  get collisionsEnabled() { return Boolean(read(this.config.collisionsEnabled)); }

  /** Mean area of the bodies, for anything reporting on the simulation. */
  get area() {
    if (!this.bodies.length) return 0;
    return this.bodies.reduce((total, body) => total + body.area, 0) / this.bodies.length;
  }

  /**
   * The area a body is inflating towards: the pressure slider as a percentage
   * of the most its ring of points could enclose.
   */
  desiredAreaFor(body) {
    return regularPolygonArea(body.points.length, this.ballSize) * this.pressureFraction;
  }

  /**
   * The pressure slider as a share of the area the ring could enclose.
   *
   * The bottom of the slider is a saggy ball, not an absent one: a target of a
   * few percent is one the ring physically cannot reach — its points are held
   * a fixed distance apart — so the ball just crumples, and every setting down
   * there looks the same. The scale starts where the deflation is still
   * visibly a deflated ball.
   */
  get pressureFraction() {
    const slider = Math.max(0, Math.min(1, this.ballPressure / 100));
    return MIN_PRESSURE_FRACTION + (1 - MIN_PRESSURE_FRACTION) * slider;
  }

  get pointerPosition() {
    return read(this.pointer.posRef) ?? { x: 0, y: 0 };
  }

  get pointerActive() {
    return Boolean(read(this.pointer.downRef) || read(this.pointer.touchActiveRef));
  }

  /**
   * Drag `point` if it is the one being held. One point at a time across every
   * body — grabbing a ball must not drag a point out of each of the others.
   */
  dragTowardPointer(point) {
    if (!this.pointerActive) {
      if (this.draggingPoint === point) this.draggingPoint = null;
      return false;
    }

    const pointer = this.pointerPosition;
    if (!this.draggingPoint) {
      const distance = Math.sqrt((point.x - pointer.x) ** 2 + (point.y - pointer.y) ** 2);
      if (distance < this.grabRadius) this.draggingPoint = point;
    }

    if (this.draggingPoint !== point) return false;

    point.x += (pointer.x - point.x) * this.dragStrength;
    point.y += (pointer.y - point.y) * this.dragStrength;
    return true;
  }

  /**
   * The radius a body is laid out at: its resting shape, unless a scene has
   * asked for something else. Starting a ring smaller than its constraints
   * allow lets the outline cross itself while it inflates, and a tangled ring
   * never comes back — it settles as a knot instead of a ball.
   */
  get spawnRadius() {
    const configured = read(this.config.spawnRadius);
    if (configured != null) return configured;
    // At less than full pressure the ball settles smaller than its ring could
    // stretch to; laying it out there saves it deflating on screen.
    return (
      regularPolygonRadius(this.pointsPerBody, this.ballSize) *
      Math.sqrt(this.pressureFraction)
    );
  }

  addBody(x, y) {
    const body = new SoftBody(x, y, {
      pointCount: this.pointsPerBody,
      radius: this.spawnRadius,
      pointSize: 10,
    });
    this.bodies.push(body);
    return body;
  }

  removeBody(body) {
    const index = this.bodies.indexOf(body);
    if (index === -1) return;
    this.bodies.splice(index, 1);
    if (body.points.includes(this.draggingPoint)) this.draggingPoint = null;
  }

  /**
   * Somewhere on the canvas, clear of the edges a ball would fight against and,
   * as far as a bounded number of tries can manage, of the balls already there.
   * Two bodies laid down exactly on top of one another have nothing to push
   * each other apart with — every point sits on the other's outline — so it is
   * worth not creating that situation in the first place.
   */
  spawnPoint() {
    const radius = this.spawnRadius;
    const margin = Math.min(radius, this.canvas.width / 4, this.canvas.height / 4);
    const sample = () => ({
      x: margin + this.random() * Math.max(0, this.canvas.width - margin * 2),
      y: margin + this.random() * Math.max(0, this.canvas.height - margin * 2),
    });

    const clearOfTheOthers = (candidate) =>
      this.bodies.every((body) => {
        const centre = body.center;
        return Math.sqrt((candidate.x - centre.x) ** 2 + (candidate.y - centre.y) ** 2) > radius;
      });

    let candidate = sample();
    for (let attempt = 0; attempt < 30 && !clearOfTheOthers(candidate); attempt++) {
      candidate = sample();
    }

    return candidate;
  }

  /** Grow or shrink the pool to `count` bodies. */
  syncBodyCount(count) {
    const target = Math.max(0, Math.round(read(count)));

    while (this.bodies.length < target) {
      const { x, y } = this.spawnPoint();
      this.addBody(x, y);
    }
    while (this.bodies.length > target) {
      this.removeBody(this.bodies[this.bodies.length - 1]);
    }
  }

  /** Separate any bodies that have ended up inside one another. */
  resolveBodyOverlaps() {
    this.bodies.forEach((body) => {
      this.bodies.forEach((other) => {
        if (other === body) return;
        body.points.forEach((point) => other.pushPointOut(point));
      });
    });
  }

  step() {
    // A pointer that came up while nothing was being updated still has to let
    // go — otherwise a body removed by the count slider keeps the drag latched.
    if (!this.pointerActive) this.draggingPoint = null;

    this.bodies.forEach((body) => body.update(this));
    this.resolveBodyOverlaps();
  }

  draw(ctx, style = {}) {
    this.bodies.forEach((body) => body.draw(ctx, style));
  }

  clear() {
    this.bodies = [];
    this.draggingPoint = null;
  }
}
