/**
 * The particle vocabulary shared across the scenes.
 *
 * Almost every scene declared its own `class Particle` inside its effect, and
 * almost every one of them opened with the same six fields and closed with the
 * same `draw` — an arc filled with `this.color`. What actually differed was
 * `update`, which is the scene's whole point. So `Particle` owns the shared
 * state, the drawing, the integration step and the edge/repulsion helpers the
 * copies all reimplemented, and each scene subclasses it to write only its own
 * `update`.
 */

import { clamp, distanceBetweenTwoPoints } from "../usefulFunctions";

/** What a particle does when it leaves the canvas. */
export const EDGE = {
  /** Leave it alone — the scene handles it. */
  NONE: "none",
  /** Reappear on the opposite side. */
  WRAP: "wrap",
  /** Reflect the velocity component that carried it out. */
  BOUNCE: "bounce",
};

export class Particle {
  /**
   * @param {number} x
   * @param {number} y
   * @param {object} [options]
   * @param {number} [options.vx]
   * @param {number} [options.vy]
   * @param {number} [options.size]
   * @param {string} [options.color]
   */
  constructor(x, y, options = {}) {
    const {
      vx = Math.random() * 2 - 1,
      vy = Math.random() * 2 - 1,
      size = Math.random() * 2 + 1,
      color = "#ffffff",
    } = options;

    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.size = size;
    this.color = color;
  }

  /**
   * Advance the position by the velocity. `speedScale` is the scene's
   * simulation-speed slider expressed as a multiplier (so `speed / 100`).
   */
  integrate(speedScale = 1) {
    this.x += this.vx * speedScale;
    this.y += this.vy * speedScale;
  }

  /** The default: a filled circle. Scenes with a shape of their own override it. */
  draw(ctx) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.closePath();
  }

  distanceTo(point) {
    const dx = this.x - point.x;
    const dy = this.y - point.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Point the velocity directly away from `point` at a fixed `speed` — the
   * "umbrella" behaviour scenes use for the cursor and for the title hitboxes.
   */
  repelFrom(point, speed = 5) {
    const angle = Math.atan2(this.y - point.y, this.x - point.x);
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
  }

  /** True when the particle has fully left the canvas on any side. */
  isOffCanvas(canvas) {
    return (
      this.x + this.size < 0 ||
      this.x - this.size > canvas.width ||
      this.y + this.size < 0 ||
      this.y - this.size > canvas.height
    );
  }

  /** Reappear on the opposite edge. */
  wrap(canvas) {
    if (this.x < 0) this.x += canvas.width;
    else if (this.x > canvas.width) this.x -= canvas.width;

    if (this.y < 0) this.y += canvas.height;
    else if (this.y > canvas.height) this.y -= canvas.height;
  }

  /** Reflect off the canvas edges, losing `1 - restitution` of the speed. */
  bounce(canvas, restitution = 1.0) {
    if (this.x - this.size < 0) {
      this.x = this.size;
      this.vx = Math.abs(this.vx) * restitution;
    } else if (this.x + this.size > canvas.width) {
      this.x = canvas.width - this.size;
      this.vx = -Math.abs(this.vx) * restitution;
    }

    if (this.y - this.size < 0) {
      this.y = this.size;
      this.vy = Math.abs(this.vy) * restitution;
    } else if (this.y + this.size > canvas.height) {
      this.y = canvas.height - this.size;
      this.vy = -Math.abs(this.vy) * restitution;
    }
  }

  /** Keep the speed under `maxSpeed`, bleeding it off rather than clipping it. */
  dampenTo(maxSpeed, damping = 0.97) {
    if (Math.abs(this.vx) > maxSpeed) this.vx *= damping;
    if (Math.abs(this.vy) > maxSpeed) this.vy *= damping;
  }

  applyEdgeBehaviour(canvas, behaviour, restitution = 1.0) {
    if (behaviour === EDGE.WRAP) this.wrap(canvas);
    else if (behaviour === EDGE.BOUNCE) this.bounce(canvas, restitution);
  }
}

/**
 * A pool of particles kept in step with a slider.
 *
 * The "grow to the target count, splice off the excess" block at the top of
 * every animate() is `sync()`. Anything extra a scene does per frame stays in
 * the scene; this only owns the bookkeeping.
 */
export class ParticleSystem {
  /**
   * @param {object} options
   * @param {() => Particle} options.spawn   makes one new particle
   * @param {{current: number}} [options.countRef]  target size, read each sync
   * @param {number} [options.count]  fixed target size when there is no slider
   */
  constructor({ spawn, countRef = null, count = 0 }) {
    this.spawn = spawn;
    this.countRef = countRef;
    this.fixedCount = count;
    this.particles = [];
  }

  get targetCount() {
    return this.countRef ? Math.round(this.countRef.current) : this.fixedCount;
  }

  get length() {
    return this.particles.length;
  }

  /** Fill the pool to its target count in one go. */
  fill() {
    while (this.particles.length < this.targetCount) {
      this.particles.push(this.spawn());
    }
    return this;
  }

  /** Grow or shrink the pool to match the target count. */
  sync() {
    const target = this.targetCount;
    const current = this.particles.length;

    if (current < target) {
      for (let i = current; i < target; i++) this.particles.push(this.spawn());
    } else if (current > target) {
      this.particles.splice(target);
    }
  }

  /** Call `update(...args)` on every particle. */
  update(...args) {
    this.particles.forEach((particle) => particle.update(...args));
  }

  draw(ctx) {
    this.particles.forEach((particle) => particle.draw(ctx));
  }

  /** `sync`, `update`, `draw` — the whole frame for a plain particle scene. */
  step(ctx, ...updateArgs) {
    this.sync();
    this.update(...updateArgs);
    this.draw(ctx);
  }

  add(particle) {
    this.particles.push(particle);
    return particle;
  }

  remove(particle) {
    const index = this.particles.indexOf(particle);
    if (index !== -1) this.particles.splice(index, 1);
  }

  /** Drop every particle for which `predicate` is true. */
  prune(predicate) {
    this.particles = this.particles.filter((p) => !predicate(p));
  }

  forEach(fn) {
    this.particles.forEach(fn);
  }

  clear() {
    this.particles = [];
  }
}

/**
 * Push `particle` away from `point` when it comes within `radius`, but only
 * while `active`. This is the cursor-repulsion check written out in a dozen
 * scenes.
 */
export const repelWithinRadius = (particle, point, radius, speed = 5) => {
  if (particle.distanceTo(point) < radius) {
    particle.repelFrom(point, speed);
    return true;
  }
  return false;
};

/**
 * Push `particle` out of every hitbox it is currently inside. Takes the
 * `ElementCollisionHitbox` instances a scene is shielding.
 */
export const repelFromHitboxes = (particle, hitboxes, speed = 5) => {
  hitboxes.forEach((hitbox) => {
    if (hitbox.inElement(particle.x, particle.y)) {
      particle.repelFrom(hitbox.center, speed);
    }
  });
};

/** Random point anywhere on the canvas. */
export const randomPointOnCanvas = (canvas) => ({
  x: Math.random() * canvas.width,
  y: Math.random() * canvas.height,
});

/** Clamp a particle's position to the canvas without touching its velocity. */
export const confineToCanvas = (particle, canvas) => {
  particle.x = clamp(particle.x, 0, canvas.width);
  particle.y = clamp(particle.y, 0, canvas.height);
};

/**
 * Scatter `count` points, rejecting any that land closer than `minDistance` to
 * one already placed. Gives up after a bounded number of attempts and returns
 * however many it managed, so a crowded region degrades to fewer points rather
 * than hanging.
 *
 * @param {object} options
 * @param {number} options.count
 * @param {number} options.minDistance
 * @param {() => {x: number, y: number}} options.sample  candidate generator
 */
export const scatterWithMinDistance = ({ count, minDistance, sample }) => {
  const points = [];
  const maxAttempts = count * 100;
  let attempts = 0;

  while (points.length < count && attempts < maxAttempts) {
    const candidate = sample();

    const tooClose = points.some(
      (existing) => distanceBetweenTwoPoints(candidate, existing) < minDistance
    );
    if (!tooClose) points.push(candidate);

    attempts++;
  }

  return points;
};
