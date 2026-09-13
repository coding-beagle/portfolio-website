# Third-party files in `build/`

Everything else in NPaint is written here and has no dependency beyond
`wasm-bindgen`. These are the exception: they are what Select Subject
downloads the first time it is used, they are **not** committed — `.gitignore` keeps
them out of the history, `make fetch_npaint_model` pulls whatever is missing,
and `make deploy_npaint` runs that before it copies.

Nothing fetches them until Select Subject is used, and the editor works in
full without them — the command falls back to the hand-written pipeline in
`src/autoselect/subject.rs`.

## ONNX Runtime Web 1.20.1 — `build/vendor/ort/`

- `ort.wasm.min.mjs`, `ort-wasm-simd-threaded.mjs`, `ort-wasm-simd-threaded.wasm`
- From <https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/>
- MIT, © Microsoft Corporation. <https://github.com/microsoft/onnxruntime>
- Run single-threaded on purpose: threads want cross-origin isolation, and
  this is a static page with no reason to set those headers.

## The Select Subject models — `build/models/`

They are **not** interchangeable in shape: each carries its own input size and
normalisation in the `MODELS` table in `www/subject-model.js`. The tensor
names are read from the session, and the first output is the saliency map in
all of them.

| Quality | File | Size | Input | Normalisation | Roughly |
| --- | --- | --- | --- | --- | --- |
| Fast | `u2netp.onnx` | 4.6 MB | 320² | ImageNet | 1.5 s |
| Better | `silueta.onnx` | 44 MB | 320² | ImageNet | 2 s |
| Best | `isnet-general-use.onnx` | 179 MB | 1024² | mean 0.5, std 1 | 9 s |

None of these are committed: `make fetch_npaint_model` installs all three and
`MODELS=core` leaves out the biggest. If one is missing anyway, asking for it
says so and falls back to the built-in search. Best is four times the
resolution of the others, which is where both the edge detail and the seconds
come from — and those seconds block the page, so the progress panel warns
about it.

- Fast and Better are U²-Net and the Silueta distillation of it; Best is
  IS-Net from the DIS project. Weights as converted and published by rembg:
  <https://github.com/danielgatis/rembg/releases/tag/v0.0.0>
- Apache-2.0, per <https://github.com/xuebinqin/U-2-Net> and
  <https://github.com/xuebinqin/DIS>. **Check this against those projects
  before treating the deploy as a redistribution you have cleared** — it is
  stated here from the upstream repositories, not from licence files shipped
  with the weights.
