// The model behind Select Subject: a real salient-object network, fetched once
// and kept in the browser's cache store, run on the device.
//
// Nothing here loads until Select Subject is used. The editor still selects
// subjects with none of this ever downloaded — `src/autoselect/subject.rs` is
// the fallback, and it is what runs if the download is declined or anything
// goes wrong.
//
// The runtime is ONNX Runtime Web (wasm, single threaded, so no cross-origin
// isolation is needed). The models are the U²-Net family, which all take the
// same input and give the same seven outputs, so the choice between them is a
// row in a table rather than a code path.

// Absolute URLs, worked out from where this module itself lives. A relative
// path would be a bare specifier to `import()` — which the browser refuses —
// and the runtime imports its own loader out of `ORT_WASM_DIR` in the same
// way, so that has to be absolute too.
const HERE = new URL(".", import.meta.url);
const ORT_MODULE = new URL("vendor/ort/ort.wasm.min.mjs", HERE).href;
const ORT_WASM_DIR = new URL("vendor/ort/", HERE).href;
const ORT_WASM = new URL("vendor/ort/ort-wasm-simd-threaded.wasm", HERE).href;

/**
 * What the user can pick between, cheapest first.
 *
 * They are not all the same shape, so each carries its own: `size` is the
 * square it wants its input at, and `mean`/`std` the normalisation it was
 * trained with. The tensor names are read from the session rather than
 * written here. All three are installed by
 * `make fetch_npaint_model`, which the deploy runs; if one is missing anyway,
 * asking for it says so and falls back.
 */
export const MODELS = [
  {
    id: "fast",
    label: "Fast",
    file: "u2netp.onnx",
    mb: 5,
    size: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
  },
  {
    id: "better",
    label: "Better",
    file: "silueta.onnx",
    mb: 44,
    size: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
  },
  {
    // IS-Net: four times the resolution and its own normalisation, which is
    // where the extra detail around edges comes from — and the seconds.
    id: "best",
    label: "Best",
    file: "isnet-general-use.onnx",
    mb: 179,
    size: 1024,
    mean: [0.5, 0.5, 0.5],
    std: [1, 1, 1],
    slow: true,
  },
];
export const DEFAULT_MODEL = "fast";

/** Whether this one is worth warning about before it takes the thread. */
export const isSlow = (id) => Boolean(byId(id).slow);

const modelUrl = (model) => new URL(`models/${model.file}`, HERE).href;
const byId = (id) => MODELS.find((m) => m.id === id) ?? MODELS[0];

/** Bumped when the files or the way they are fed change, to retire old copies. */
const CACHE = "npaint-model-v1";
/** The runtime's own weight, which every first download includes. */
const ORT_BYTES = 11_246_032;

/** What picking `id` costs the first time, in whole megabytes. */
export function downloadMb(id) {
  return Math.round((ORT_BYTES + byId(id).mb * 1e6) / 1e6);
}

/** One session per model, so switching back and forth costs nothing. */
const sessions = new Map();
const loadings = new Map();

async function cacheStore() {
  try {
    // No cache storage in a private window or on an insecure origin. It still
    // works, the browser just has to fetch the files again next time.
    return await caches.open(CACHE);
  } catch {
    return null;
  }
}

/** Whether everything `id` needs is already here, without fetching it. */
export async function isCached(id) {
  if (sessions.has(id)) return true;
  const cache = await cacheStore();
  if (!cache) return false;
  const hits = await Promise.all([cache.match(ORT_WASM), cache.match(modelUrl(byId(id)))]);
  return hits.every(Boolean);
}

/**
 * Fetches `url`, from the cache store if it is there and from the site if it
 * is not, reporting bytes as they arrive. Anything fetched is cached, so the
 * second time costs nothing and works offline.
 */
async function bytesOf(url, onBytes) {
  const cache = await cacheStore();
  const hit = cache && (await cache.match(url));
  if (hit) {
    const bytes = new Uint8Array(await hit.arrayBuffer());
    onBytes(bytes.length, bytes.length);
    return bytes;
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not fetch ${url} (${response.status})`);
  if (cache) await cache.put(url, response.clone()).catch(() => {});

  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onBytes(bytes.length, bytes.length);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    read += value.length;
    onBytes(read, Math.max(total, read));
  }
  const bytes = new Uint8Array(read);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

/**
 * Loads the runtime and the weights, once however many times it is called.
 *
 * The runtime's wasm is fetched here rather than left to the runtime itself:
 * it is 11 of the ~16 MB, and downloading it by hand is the difference
 * between a progress bar and a page that looks stuck.
 */
export function load(id, onProgress) {
  if (loadings.has(id)) return loadings.get(id);
  const model = byId(id);
  const loading = (async () => {
    const ort = await import(ORT_MODULE);
    const done = {};
    const totals = { [ORT_WASM]: ORT_BYTES, [modelUrl(model)]: model.mb * 1e6 };
    const report = () => {
      const got = Object.values(done).reduce((a, b) => a + b, 0);
      const all = Object.values(totals).reduce((a, b) => a + b, 0);
      onProgress?.(Math.min(1, all ? got / all : 0));
    };
    const track = (url) => (read, total) => {
      done[url] = read;
      if (total) totals[url] = total;
      report();
    };

    const wasm = await bytesOf(ORT_WASM, track(ORT_WASM));
    let weights;
    try {
      weights = await bytesOf(modelUrl(model), track(modelUrl(model)));
    } catch (e) {
      // A model that was never installed on the site 404s: say so plainly
      // rather than reporting a status code at somebody.
      throw new Error(
        String(e.message ?? e).includes("(404)")
          ? `the "${model.label}" model is not installed on this site`
          : String(e.message ?? e)
      );
    }

    ort.env.wasm.wasmPaths = ORT_WASM_DIR; // for the loader beside the binary
    ort.env.wasm.wasmBinary = wasm.buffer;
    // One thread: threads want cross-origin isolation, which would mean
    // headers this static page has no reason to set.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(weights, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    sessions.set(id, session);
    return session;
  })();
  loadings.set(id, loading);
  loading.catch(() => {
    // A failed load must not poison the next attempt.
    loadings.delete(id);
  });
  return loading;
}

/**
 * Runs the model over `rgba` (`width` x `height`, four bytes a pixel) and
 * gives back `{ matte, width, height }`: one byte of coverage per pixel at
 * the model's own resolution. The engine scales it up and turns it into a
 * selection — it knows how, and it has the full-resolution pixels to do it
 * against.
 */
export async function matte(rgba, width, height, id, onProgress) {
  const spec = byId(id);
  const session = sessions.get(id) ?? (await load(id, onProgress));
  const { size } = spec;

  // Down to the model's square, area-averaged so that shrinking a big
  // photograph does not alias the subject away.
  const small = resize(rgba, width, height, size, size);
  const plane = size * size;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    // The models were trained on images scaled by their own maximum, which
    // for any ordinary photograph is 255.
    for (let c = 0; c < 3; c++) {
      input[c * plane + i] = (small[i * 4 + c] / 255 - spec.mean[c]) / spec.std[c];
    }
  }

  const ort = await import(ORT_MODULE);
  const tensor = new ort.Tensor("float32", input, [1, 3, size, size]);
  // The names come from the model rather than from here, and so does the
  // output size: these nets have several outputs and the first is the one
  // that was supervised hardest.
  const outputs = await session.run({ [session.inputNames[0]]: tensor });
  const out = outputs[session.outputNames[0]];
  const prediction = out.data;
  const outWidth = out.dims[3] ?? size;
  const outHeight = out.dims[2] ?? size;

  // The output is a saliency map on no particular scale, so it is stretched to
  // fill the byte range — the same normalisation the reference code does.
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of prediction) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  const matteBytes = new Uint8Array(outWidth * outHeight);
  for (let i = 0; i < matteBytes.length; i++) {
    matteBytes[i] = Math.max(0, Math.min(255, Math.round(((prediction[i] - lo) / span) * 255)));
  }
  return { matte: matteBytes, width: outWidth, height: outHeight };
}

/** Area-averaged resize of an RGBA buffer. */
function resize(rgba, width, height, toWidth, toHeight) {
  const out = new Uint8ClampedArray(toWidth * toHeight * 4);
  for (let y = 0; y < toHeight; y++) {
    const y0 = Math.floor((y * height) / toHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / toHeight));
    for (let x = 0; x < toWidth; x++) {
      const x0 = Math.floor((x * width) / toWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / toWidth));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < Math.min(y1, height); sy++) {
        for (let sx = x0; sx < Math.min(x1, width); sx++) {
          const i = (sy * width + sx) * 4;
          // Over white: the model has never seen a transparent pixel, and a
          // cut-out on black would read as a dark subject.
          const alpha = rgba[i + 3] / 255;
          r += rgba[i] * alpha + 255 * (1 - alpha);
          g += rgba[i + 1] * alpha + 255 * (1 - alpha);
          b += rgba[i + 2] * alpha + 255 * (1 - alpha);
          a += rgba[i + 3];
          n++;
        }
      }
      const o = (y * toWidth + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return out;
}
