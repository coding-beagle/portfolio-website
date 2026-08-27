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
   */
  constructor(x, y, { vx, vy, color, size, sizeDecayRate = 0, gravity = 0 }) {
    super(x, y, { vx, vy, size, color });
    this.sizeDecayRate = sizeDecayRate;
    this.gravity = gravity;
  }

  /**
   * @param {number} speedScale simulation speed as a multiplier
   * @param {number} [shimmer] higher values shimmer less; pass the raw
   *   simulation-speed slider to keep slow motion sparkling.
   */
  update(speedScale, shimmer = Infinity) {
    this.x += this.vx * speedScale;
    this.vy += this.gravity;
    this.y += this.vy * speedScale;

    // NOTE: the original decremented an `initialSize` field that was never
    // assigned, so sparks have never actually shrunk. Preserved as-is —
    // applying the decay changes how every firework looks.

    if (shimmer < Math.random() * 400) {
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
