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
    color.rs       Rgba, hex parsing, source-over compositing
    geometry.rs    Point, Rect
    raster.rs      the pixel buffer and every drawing primitive
    layer.rs       Layer, LayerId, BlendMode
    document.rs    the layer stack; add/remove/move/merge/composite
    selection.rs   what painting may touch (rect marquee for now)
    viewport.rs    zoom and pan, screen <-> document mapping
    history.rs     undo/redo as before-snapshots
    tools/
      mod.rs       Tool trait, ToolKind, ToolSettings, PointerEvent
      select.rs    marquee
      movetool.rs  move (translate the selection or the layer)
      stroke.rs    brush, pencil, eraser (one gesture, three stamps)
      shape.rs     line, rectangle, ellipse (rubber-band)
      view.rs      zoom (click / alt-click / scrubby drag) and hand
    transform.rs   Affine, bilinear resampling, the free-transform session
    editor.rs      the facade: one document + selection + viewport + history + tool
                   + the adjustment/transform "session" (preview, commit, cancel)
    wasm.rs        the wasm_bindgen class `NPaint`; a translation layer, no logic
  www/
    index.html     the page
    app.js         DOM, canvas, events, render loop, menu definitions
    menu.js        the menu-bar drop-downs and context menus (one component)
    colorpicker.js hue ring + saturation/value square, hex/RGB/HSV fields
    adjust.js      the adjustment dialog, built from a data table
    style.css
    favicon.svg
    .htaccess      served alongside; sets the wasm MIME type
  build/           COMMITTED. www/ plus pkg/ (the compiled wasm + glue).
                   This is what cPanel deploys. Regenerate, never hand-edit.
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
The page never needs to know the zoom.

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

**A selection shape.** A new `Selection` variant with its own `clip()` and
`contains()`. Tools clip to the bounding rect and rely on nothing else, so a
lasso is contained to `selection.rs` plus a tool to draw it.

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
- The frame is handed to JS as a pointer into wasm memory (`frame_ptr`),
  re-read every draw. Never cache the `Uint8ClampedArray`: memory growth
  detaches it.

## Known gaps (MVP)

Rectangular selection only; no layer masks, text, gradients or blur-type
filters; no non-destructive adjustment layers (adjustments bake into the
layer); no file format of its own (export is a flattened PNG); layers are
always document-sized (a transform resamples into the canvas, and what
leaves it is lost).
