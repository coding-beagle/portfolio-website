/**
 * The GPU path for the plain-circle particles.
 *
 * `Particle.draw` is one `ctx.arc` + `ctx.fill` per particle, and the scenes
 * that lean on it — windtunnel, snow, rain, boids — push the count into the
 * thousands, at which point the 2d context spends the whole frame rasterising
 * discs one at a time.
 *
 * So the discs get handed to WebGL instead: every particle becomes one instance
 * of a unit quad, the fragment shader cuts the circle out of it, and the whole
 * pool goes down in a single draw call. The result is composited back onto the
 * scene's 2d canvas with `drawImage`, which keeps the draw *order* intact — a
 * scene can still paint a background, call `system.draw(ctx)`, and paint its UI
 * on top, exactly as before.
 *
 * Everything here is best-effort. No WebGL2, a colour that will not parse, a
 * particle with a `draw` of its own, or a pool too small to be worth the blit,
 * and `drawParticlesOnGpu` returns false so the caller falls back to the 2d
 * path. Nothing that renders on the GPU is allowed to look different from what
 * the CPU would have drawn.
 */

/**
 * Below this many particles the per-frame composite costs more than the arcs it
 * saves, so the 2d path stays quicker.
 */
const MIN_PARTICLES_FOR_GPU = 192;

/** Bytes per instance: centre (2) + radius (1) + colour (4), all floats. */
const FLOATS_PER_INSTANCE = 7;

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec3 a_centreRadius;
layout(location = 2) in vec4 a_colour;

uniform vec2 u_resolution;

out vec2 v_corner;
out vec4 v_colour;

void main() {
  v_corner = a_corner;
  v_colour = a_colour;

  vec2 pixel = a_centreRadius.xy + a_corner * a_centreRadius.z;
  vec2 clip = (pixel / u_resolution) * 2.0 - 1.0;

  // Canvas y runs down the screen, clip space runs up it.
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

in vec2 v_corner;
in vec4 v_colour;

out vec4 outColour;

void main() {
  // The quad spans -1..1, so the distance from its centre is the radius in
  // units of the particle's own size, and the circle is everything under 1.
  float distance = length(v_corner);

  // One pixel's worth of that distance, which is how wide the antialiased rim
  // has to be to match what the 2d context would have drawn.
  float rim = clamp(fwidth(distance), 0.001, 1.0);
  float coverage = 1.0 - smoothstep(1.0 - rim, 1.0, distance);
  if (coverage <= 0.0) discard;

  // Premultiplied, to composite the same way the 2d canvas does.
  float alpha = v_colour.a * coverage;
  outColour = vec4(v_colour.rgb * alpha, alpha);
}`;

const compile = (gl, type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

const link = (gl) => {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex || !fragment) return null;

  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);

  // The program holds its own copy once linked.
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
};

class CircleBatchRenderer {
  /**
   * @returns {CircleBatchRenderer|null} null when the machine has no WebGL2.
   */
  static create() {
    if (typeof document === "undefined") return null;

    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!gl) return null;

    const program = link(gl);
    if (!program) return null;

    return new CircleBatchRenderer(canvas, gl, program);
  }

  constructor(canvas, gl, program) {
    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    this.lost = false;
    this.instances = new Float32Array(1024 * FLOATS_PER_INSTANCE);

    canvas.addEventListener("webglcontextlost", (event) => {
      // Refusing the default keeps the browser from restoring a context we no
      // longer have any state on; the next frame builds a fresh renderer.
      event.preventDefault();
      this.lost = true;
    });

    this.resolutionLocation = gl.getUniformLocation(program, "u_resolution");

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    // The unit quad, shared by every instance.
    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // One interleaved record per particle, rewritten every frame.
    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instances.byteLength, gl.DYNAMIC_DRAW);

    const stride = FLOATS_PER_INSTANCE * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 12);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
  }

  /** Grow the staging array to hold `count` particles. */
  reserve(count) {
    const needed = count * FLOATS_PER_INSTANCE;
    if (this.instances.length >= needed) return;

    this.instances = new Float32Array(needed);
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instances.byteLength, gl.DYNAMIC_DRAW);
  }

  /**
   * Draw `count` instances already staged in `this.instances` at the given
   * size, then hand the canvas back for compositing.
   *
   * `additive` accumulates overlapping particles instead of painting the
   * nearest one over the rest — how a crowd of embers builds a white-hot core.
   * Addition is associative, so a layer built this way and then composited
   * with `lighter` gives the same picture as adding each particle to the
   * scene one at a time.
   */
  render(width, height, count, additive) {
    const { gl, canvas } = this;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Both source factors are ONE because the shader already premultiplied;
    // the destination factor is the whole difference between the two modes.
    gl.blendFunc(gl.ONE, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.resolutionLocation, width, height);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.instances,
      0,
      count * FLOATS_PER_INSTANCE
    );

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);

    return canvas;
  }
}

// `undefined` until the first attempt, `null` once the machine has told us it
// cannot do this. Either way we only ever ask the browser for a context once.
let renderer;

const getRenderer = () => {
  if (renderer === undefined || (renderer && renderer.lost)) {
    renderer = CircleBatchRenderer.create();
  }
  return renderer;
};

/** True when this machine can render particles on the GPU. */
export const isGpuRenderingAvailable = () => getRenderer() !== null;

/**
 * CSS colour strings, resolved to premultiplication-ready floats.
 *
 * Particle colours are overwhelmingly repeated — a whole pool usually shares
 * the theme accent — so the cache turns per-particle parsing into a handful of
 * lookups per frame.
 */
const colourCache = new Map();
const MAX_CACHED_COLOURS = 2048;

let colourProbe;

const cacheColour = (css, parsed) => {
  // A scene that mutates colours every frame would otherwise grow this without
  // bound; dropping the whole cache is fine, it refills in one frame.
  if (colourCache.size >= MAX_CACHED_COLOURS) colourCache.clear();
  colourCache.set(css, parsed);
  return parsed;
};

const parseColour = (css) => {
  const cached = colourCache.get(css);
  if (cached !== undefined) return cached;

  if (!colourProbe) {
    if (typeof document === "undefined") return null;
    colourProbe = document.createElement("canvas").getContext("2d");
  }

  // Assigning to `fillStyle` normalises anything the browser understands to
  // `#rrggbb` or `rgba(r, g, b, a)`, and silently leaves the previous value in
  // place for anything it does not. Asking twice from two different starting
  // points tells those apart: a real colour lands on the same answer both
  // times, a rejected one just gives back whichever sentinel preceded it.
  colourProbe.fillStyle = "#000000";
  colourProbe.fillStyle = css;
  const normalised = colourProbe.fillStyle;

  colourProbe.fillStyle = "#ffffff";
  colourProbe.fillStyle = css;
  if (colourProbe.fillStyle !== normalised) return cacheColour(css, null);

  let parsed = null;
  if (normalised.startsWith("#")) {
    const value = parseInt(normalised.slice(1), 16);
    parsed = [
      ((value >> 16) & 255) / 255,
      ((value >> 8) & 255) / 255,
      (value & 255) / 255,
      1,
    ];
  } else {
    const parts = normalised.match(/[\d.]+/g);
    if (parts && parts.length >= 3) {
      parsed = [
        Number(parts[0]) / 255,
        Number(parts[1]) / 255,
        Number(parts[2]) / 255,
        parts.length > 3 ? Number(parts[3]) : 1,
      ];
    }
  }

  return cacheColour(css, parsed);
};

/**
 * Draw `particles` as circles on the GPU and composite them onto `ctx`.
 *
 * @param {CanvasRenderingContext2D} ctx  the scene's own 2d context
 * @param {Array} particles
 * @param {(particle: any) => boolean} isPlainCircle  true when the particle
 *   still uses the inherited `draw`, and so is a circle we can reproduce
 * @param {string} [blend]  a canvas `globalCompositeOperation`; only
 *   `"lighter"` is understood as anything other than ordinary painting
 * @returns {boolean} false when the caller must fall back to drawing on the CPU
 */
export const drawParticlesOnGpu = (
  ctx,
  particles,
  isPlainCircle,
  blend = "source-over"
) => {
  const count = particles.length;
  if (count < MIN_PARTICLES_FOR_GPU) return false;

  const batch = getRenderer();
  if (!batch) return false;

  const { width, height } = ctx.canvas;
  if (width === 0 || height === 0) return false;

  batch.reserve(count);
  const data = batch.instances;

  let written = 0;
  for (let i = 0; i < count; i++) {
    const particle = particles[i];
    if (!isPlainCircle(particle)) return false;

    const colour = parseColour(particle.color);
    if (!colour) return false;

    // Off-screen particles cost a vertex each; skipping them is free here and
    // the pools that wrap or fall tend to have plenty.
    const { x, y, size } = particle;
    if (
      !(size > 0) ||
      x + size < 0 ||
      x - size > width ||
      y + size < 0 ||
      y - size > height
    ) {
      continue;
    }

    const offset = written * FLOATS_PER_INSTANCE;
    data[offset] = x;
    data[offset + 1] = y;
    data[offset + 2] = size;
    data[offset + 3] = colour[0];
    data[offset + 4] = colour[1];
    data[offset + 5] = colour[2];
    data[offset + 6] = colour[3];
    written++;
  }

  if (written === 0) return true;

  const additive = blend === "lighter";
  const source = batch.render(width, height, written, additive);
  if (batch.lost) return false;

  const previousBlend = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = blend;
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = previousBlend;
  return true;
};
