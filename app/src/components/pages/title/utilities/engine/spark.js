/**
 * A short-lived glowing mote thrown off by something else.
 *
 * This started life as `FireworkChaff` inside firework.js and was already being
 * imported across into runes.js, so it belongs here rather than in either
 * scene.
 */

import { Particle } from "./particles";
import { getCloseColour } from "../usefulFunctions";

export class Spark extends Particle {
  /**
   * @param {number} x
   * @param {number} y
   * @param {object} options
   * @param {number} options.vx
   * @param {number} options.vy
   * @param {string} options.color
   * @param {number} options.size
   * @param {number} [options.sizeDecayRate]
   * @param {number} [options.gravity]
   * @param {number} [options.shimmerRate] colour-drift chance per frame at 100%
   *   simulation speed; 0 disables the shimmer
   */
  constructor(
    x,
    y,
    { vx, vy, color, size, sizeDecayRate = 0, gravity = 0, shimmerRate = 0.75 }
  ) {
    super(x, y, { vx, vy, size, color });
    this.sizeDecayRate = sizeDecayRate;
    this.gravity = gravity;
    this.shimmerRate = shimmerRate;
  }

  /**
   * @param {number} speedScale simulation speed as a multiplier
   */
  update(speedScale) {
    this.x += this.vx * speedScale;
    // Gravity is an acceleration per unit of simulation time, so it has to be
    // scaled too — otherwise slow motion pulls sparks down just as hard per
    // frame while their sideways motion crawls, squashing the burst.
    this.vy += this.gravity * speedScale;
    this.y += this.vy * speedScale;

    // NOTE: the original decremented an `initialSize` field that was never
    // assigned, so sparks have never actually shrunk. Preserved as-is —
    // applying the decay changes how every firework looks.

    // Shimmer is a rate per unit of simulation time. Reading the speed slider
    // directly used to invert this — the slower the sim, the faster the colour
    // churned — so it is scaled like everything else instead.
    if (Math.random() < this.shimmerRate * speedScale) {
      this.color = getCloseColour(this.color, 0.1, 0.1, 0.1);
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} [bloomRadius] 0 disables the glow
   */
  draw(ctx, bloomRadius = 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);

    if (bloomRadius > 0) {
      ctx.shadowColor = this.color;
      ctx.shadowBlur = Math.min(24, this.size * bloomRadius);
    }

    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.closePath();
    ctx.restore();
  }
}
