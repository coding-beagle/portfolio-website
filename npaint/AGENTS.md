# NPaint — guide for agents and contributors

NPaint is a layer-based image editor in the manner of Photoshop and Photopea.
It is a **static page**: the whole editor runs in the browser, there is no
server side, and nothing the user draws or opens ever leaves their machine.
The engine is Rust compiled to WebAssembly; the page is plain HTML, CSS and a
few ES modules with no bundler.

Deployed at `npaint.nteague.com`, and reachable as the NPaint shortcut on the
portfolio's desktop scene (`app/src/subdomains.js`).

## Layout

```
npaint/
  Cargo.toml
  src/
    lib.rs         crate root and module map
    adjust.rs      image adjustments (brightness/contrast, hue/sat, levels, ...)
    autoselect/    the automatic selections: pure functions of the pixels
      mod.rs       colour distance, the Sobel edge map, the Select Similar set
      wand.rs      magic wand: flood or global colour match
      quick.rs     quick select: brush-driven region growing
      subject.rs   Select Subject: saliency, Otsu, colour models, ICM
    color.rs       Rgba, hex parsing, source-over compositing
    geometry.rs    Point, Rect
    raster.rs      the pixel buffer and every drawing primitive
    layer.rs       Layer, LayerId, BlendMode
    mask.rs        per-pixel selection coverage: combine, grow/contract,
                   feather, smooth, antialias, contours (the marching ants)
    document.rs    the layer stack; add/remove/move/merge/composite
    selection.rs   what painting may touch: nothing, a rect, or a Mask
    viewport.rs    zoom and pan, screen <-> document mapping
    history.rs     undo/redo as before-snapshots
    tools/
      mod.rs       Tool trait, ToolKind, ToolSettings, PointerEvent
      select.rs    marquee
      wand.rs      magic wand, quick select and the refine brush (none of
                   them touch pixels — only the selection)
      movetool.rs  move (translate the selection or the layer)
      stroke.rs    brush, pencil, eraser (one gesture, three stamps)
      shape.rs     line, rectangle, ellipse (rubber-band)
      view.rs      zoom (click / alt-click / marquee or scrubby drag) and hand
    transform.rs   Affine, bilinear resampling, the free-transform session
    editor.rs      the facade: one document + selection + viewport + history + tool
                   + the adjustment/transform "session" (preview, commit, cancel)
    wasm.rs        the wasm_bindgen class `NPaint`; a translation layer, no logic
  www/
    index.html     the page
    app.js         DOM, canvas, events, render loop, menu definitions
    menu.js        the menu-bar drop-downs and context menus (one component)
    colorpicker.js hue ring + saturation/value square, hex/RGB/HSV fields
    subject-worker.js the worker Select Subject's model runs in
    subject-model.js  the model behind Select Subject: loads ONNX Runtime and
                   U-2-Net on demand with progress, caches them in the
                   browser, returns a matte. Not loaded until the command is
                   used.
    adjust.js      the adjustment dialog, built from a data table
    style.css
    favicon.svg
    .htaccess      served alongside; sets the wasm MIME type
  build/           COMMITTED except vendor/ort/ and models/, which are
                   gitignored: ~230 MB of runtime and model weights that
                   `make fetch_npaint_model` pulls (skipping what is already
                   there) and `make deploy_npaint` fetches before copying.
                   Everything else here is www/ plus pkg/ (the compiled wasm
                   + glue). This is what cPanel deploys. Regenerate, never
                   hand-edit.
  THIRD-PARTY.md   what the two downloaded things are, and their licences
```

## The rule that keeps it clean

**Decisions live in Rust; the page only reflects them.** If a behaviour could
be stated as "given this state and this input, the document becomes that",
it belongs in `src/` with a unit test. `app.js` translates browser events into
`NPaint` calls and draws what `NPaint` reports. It keeps no state the engine
also has: after any change the layers panel, undo buttons and status bar are
re-read from the engine.

`wasm.rs` is the boundary and is deliberately dumb — every method is a
one-line delegation with type conversion. If you find yourself writing an
`if` in `wasm.rs`, move it into `editor.rs` and test it there.

Coordinates: the engine's pointer entry points take **screen** coordinates
(CSS pixels relative to the canvas) and map them through the viewport itself.
The page never needs to know the zoom. It does report the *size* of the
viewport (`set_view_size`, on resize), because a zoom that has to fill the
window — the zoom tool's marquee — is worked out in `viewport.rs`.

A gesture that shows itself on screen without touching the document draws
through `Tool::overlay`: the tool returns a screen-space `[x, y, w, h]` and
the page strokes it. The zoom marquee is the only one so far.

## Building and testing

```sh
make test_npaint      # cargo test + clippy with warnings denied; no browser needed
make build_npaint     # wasm-pack → build/pkg, then copies www/ into build/
make run_npaint       # serves build/ on :8790
```

The wasm target and wasm-pack are needed once:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
```

Every module carries its own `#[cfg(test)]` block; `editor.rs` tests are the
integration tests, driving whole gestures through the facade. The `wasm.rs`
tests run natively too — errors cross the boundary as `String`, not
`JsError`, precisely so that they can. All of it runs with plain `cargo test`.

**Commit `build/` after `make build_npaint`.** The deploy is a copy of that
folder; there is no build step on the server.

## How a selection holds

Painting clips to a **rectangle**: every primitive in `raster.rs` takes one,
and none of them know about masks. What makes a ragged selection hold is
`Selection::apply` — before a gesture that may edit pixels the editor keeps a
copy of the layer, and afterwards it blends the result back through the
coverage. Paint that landed outside the selection is simply put back, and a
feathered edge comes out as a partial edit rather than a hard stop. The same
funnel covers fills, clears and adjustment previews.

The move tool is the exception (`ToolKind::confined_to_selection`): moving
pixels *out* of the selection is the whole point of it, and it carries the
selection along with them.

Coverage is 8-bit, so `feather` and `antialias` are not special cases; the
two cheap shapes (nothing selected, a plain rectangle) stay as themselves and
a mask that turns out to be a solid rectangle collapses back into one.

## Select Subject

One command, two ways of answering it:

* **The models.** `www/subject-model.js` loads ONNX Runtime and one of the
  U²-Net family on demand, keeps both in the Cache API, and hands the engine a
  matte. It runs in a worker (`www/subject-worker.js`, which is only a
  postbox around the same module) because wasm cannot yield partway through
  an inference: on the main thread those seconds are a frozen page, throbber
  and all. The pixels are copied into the worker rather than transferred, so
  that a browser without module workers can fall back to running it here. The options bar picks the quality — Fast (5 MB), Better
  (44 MB) or Best (179 MB, installed only by
  `make fetch_npaint_model MODELS=all`) — and the choice is remembered in
  `localStorage`. They are not the same shape — Fast and Better want 320²
  with ImageNet normalisation, Best wants 1024² with its own — so each row of
  `MODELS` carries its `size`, `mean` and `std`, and adding one means filling
  those in and checking it against a picture. It fetches the runtime's wasm itself rather
  than leaving that to the runtime, because it is 11 MB of the first download
  and that is the difference between a progress bar and a page that looks
  stuck.
* **The fallback.** `src/autoselect/subject.rs`: classical, instant, no
  download, always there. It runs when the download is declined (asked once a
  session), when a model is not installed, or when anything at all goes wrong.
  Either way the user ends up with a selection and a message saying which they
  got.

The part after the matte is shared and lives in `src/autoselect/matte.rs`:
threshold, largest piece, fill holes, scale up, keep the soft edge. A
different model is a different matte and nothing else.

Slow work says so: `working(label, fraction)` in `app.js` puts a panel over
the canvas, and `painted()` gives the browser a frame to draw it in before
something takes the thread.

## The mark, and the throbber

A 3:2 Lissajous figure — `sin(3t + phase)` against `sin(2t)` — drawn faintly
with one arc picked out. `www/favicon.svg` is the artwork at a quarter-turn
phase (the same file is `app/public/lissajous.svg`, the portfolio's favicon
and the mark its `SiteLogo` shows).

As a throbber two things move: the bright arc runs along the curve, and the
*phase* creeps round, so the figure itself reshapes — pretzel to ribbon and
back — over about eleven seconds. Both are drawn in `drawThrobbers()` frame
by frame rather than in CSS, because every phase gives a path of a slightly
different length and the arc is a fraction of that length; a CSS animation
cannot follow a target that moves. Anything with a `throb-slot` class gets
one, `buildThrobbers()` fills them before the wasm loads, and the loop stops
itself whenever no throbber is on screen. `prefers-reduced-motion` gets the
mark, held still.

## Fixing a selection by hand

Ctrl-clicking a layer's thumbnail selects everything that layer draws
(`select_layer_opaque`), without making it the active layer.

The refine brush (`RefineTool` in `src/tools/wand.rs`) paints the selection
mask directly — drag to add, Alt-drag to rub out — which is how an automatic
selection gets tidied up without starting again. It is the only tool that
starts from an *empty* mask when nothing is selected, because a brush there is
building a selection rather than cutting one out of the whole canvas.

## Sessions: adjustments and free transform

Anything that previews on the canvas before the user says OK is a *session*
in `editor.rs`: `begin_*` snapshots the layer, `preview_*` / pointer events
re-render from that snapshot, `commit_session` records one undo step and
`cancel_session` restores. Only one session is open at a time, it takes over
the pointer while it is, and any layer operation, undo or new document cancels
it first. The page shows a dialog or a handle box, nothing more.

The transform's handle hit-testing is in Rust (`TransformSession::hit`),
with the grab radius given in document pixels as `8 / zoom` so it is a
constant size on screen. The page asks `transform_hit` only to choose a
cursor.

## Adding things

**A tool.** Add a file under `src/tools/`, implement `Tool` (`begin`,
`update`, `finish`, `cancel`), add a `ToolKind` variant with a name, and an
arm in `ToolKind::instantiate`. In `app.js`, add an entry to `TOOLS` (name,
label, shortcut key, icon path, hint). Say in `begin` whether the gesture
`EditsActiveLayer` — that is all the undo system needs from you. Clip every
pixel write with `ctx.clip()` and the selection will just work.

**A drawing primitive.** `raster.rs`. Take a `clip: &Rect` and never write
outside it. Test against a small raster with exact pixel counts.

**A selection shape.** Build a [`Mask`] and hand it to
`Selection::combine` with the mode the modifiers asked for; everything else —
the marching ants, the enforcement, expand and feather — already works on
masks. A lasso is a tool that rasterises its polygon into a mask, and nothing
else changes.

**An automatic selection.** A function in `autoselect/` from `&Raster` to
`Mask`, with tests against a small hand-built image. Wire it to a tool (if it
is driven by the pointer) or to an `Editor` method and a Select-menu item (if
it is a command).

**A blend mode.** A `BlendMode` variant and an arm in
`Document::blend_layer`. Nothing else refers to the mode.

**An adjustment.** A variant in `adjust.rs` with an arm in `from_params`,
`name` and either `lut` (per-channel) or `map` (whole colour), plus a row in
`ADJUSTMENTS` in `www/adjust.js` describing its sliders. The dialog, preview,
undo and menu entries come for free.

**A menu item.** `app.js` builds every menu from item lists; `layerItems`,
`editItems` and `selectItems` are shared between the menu bar and the
context menus, so add to those rather than to one menu.

**Layer properties, filters, adjustments.** Add the operation to `Document`
(pure, tested), wrap it in `Editor` through `structural()` so it is an undo
step, expose it in `wasm.rs`, bind a button in `app.js`.

## Conventions

- Layers are stored **bottom-first** (index 0 is the bottom); the panel
  reverses them for display. Layer *ids* are stable across reorders — key UI
  rows and history snapshots on ids, not indices.
- Colours are straight (non-premultiplied) 8-bit RGBA throughout, matching
  `ImageData`.
- No anti-aliasing in the drawing primitives. Everything is hard-edged
  pixels, which is what makes the pixel-count tests exact. Add AA as a
  separate primitive rather than changing the existing ones. The one
  exception is `Raster::transformed`, which resamples bilinearly (on
  premultiplied colour) because a rotated hard edge looks broken.
- A pointer gesture that is cancelled leaves no undo step behind
  (`Editor::abort_gesture`). Keep it that way.
- The only Rust dependency is `wasm-bindgen`. Think twice before adding
  another; the page's whole payload is ~110 KB.
- Anything that changes the document's *size* must call `resize_frame` in
  `wasm.rs` before the page next renders. The page builds an `ImageData` of
  `width x height` out of exactly `frame_len` bytes, so a frame left at the
  old size throws in the render loop. There is a test that walks every such
  path (`the_frame_always_matches_the_document_size`) — add to it.
- A canvas has a ceiling (`editor::MAX_SIDE`, `editor::MAX_PIXELS`): every
  layer is document-sized at four bytes a pixel, so an unclamped size is a
  multi-gigabyte allocation and a dead tab. `canvas_fits` is the guard, the
  page reads the limits through `max_side`/`max_pixels` to clamp a drag
  before it asks, and anything else that sizes a document should use it too.
- The frame is handed to JS as a pointer into wasm memory (`frame_ptr`),
  re-read every draw. Never cache the `Uint8ClampedArray`: memory growth
  detaches it.

## Known gaps (MVP)

No lasso or polygon drawn by hand, though the mask machinery is there for
one; Select Subject is classical computer vision rather than a model, so it
wants a subject that stands out from its background and will not cut hair;
no layer masks, text, gradients or blur-type filters; no non-destructive
adjustment layers (adjustments bake into the layer); no file format of its own (export is a flattened PNG); layers are
always document-sized (a transform resamples into the canvas, and what
leaves it is lost).
