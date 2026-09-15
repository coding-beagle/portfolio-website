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
    adjust.rs      image adjustments (brightness/contrast, hue/sat, levels,
                   curves, colour balance, dither, ...) and the automatic
                   levels. An `Adjustment` is a `Kind` — what to do — and a
                   `Channel` — which of R, G, B to do it to, or all three
    checker.rs     finds a transparency checkerboard painted into a picture
                   (two colours, cell, phase, from the edges) and unmixes it
                   to real alpha — Image > Remove Checkerboard Background
    blend.rs       the blend modes: the W3C formulas, one function per mode
    autoselect/    the automatic selections: pure functions of the pixels
      mod.rs       colour distance, the Sobel edge map, the Select Similar set
      wand.rs      magic wand: flood or global colour match
      quick.rs     quick select: brush-driven region growing
      subject.rs   Select Subject: saliency, Otsu, colour models, ICM
    color.rs       Rgba, hex parsing, source-over compositing
    dither.rs      the dither patterns behind the Dither adjustment: the
                   Bayer matrices and a coordinate hash (decided per pixel,
                   so a `scale` gives chunky cells) and the error-diffusion
                   kernels (Floyd-Steinberg, Jarvis, Stucki, Atkinson,
                   Sierra), with levels/strength/greyscale in front of both
    file.rs        NPaint's own file: the whole document as a binary stream
    geometry.rs    Point, Rect
    raster.rs      the pixel buffer and every drawing primitive
    layer.rs       Layer, LayerId, and what kind of layer it is: pixels, an
                   adjustment layer, or a smart object; the layer mask and
                   which of the two rasters the tools edit; the two locks
    mask.rs        per-pixel selection coverage: combine, grow/contract,
                   feather, smooth, antialias, contours (the marching ants)
    document.rs    the layer stack; add/remove/move/merge/composite
    selection.rs   what painting may touch: nothing, a rect, or a Mask
    viewport.rs    zoom and pan, screen <-> document mapping
    history.rs     undo/redo as labelled before-snapshots: one surface of a
                   layer (pixels or mask), a whole layer, the whole stack, or
                   nothing; every step also carries an `Aside` (the selection
                   and guides before it), so selection and guide edits are
                   steps too; the list the history panel shows, and the
                   saved-state id
    tools/
      mod.rs       Tool trait, ToolKind, ToolSettings, PointerEvent
      select.rs    the marquees (rectangle, ellipse) and the crop tool, with
                   the add/subtract/intersect modifiers
      wand.rs      magic wand, quick select and the refine brush (none of
                   them touch pixels — only the selection)
      movetool.rs  move (translate the selection or the layer)
      stroke.rs    brush, pencil, eraser (one gesture, three stamps, and a
                   hardness the pencil ignores)
      bucket.rs    paint bucket: the wand's patch, filled
      eyedropper.rs the eyedropper, and the Alt-click under every brush
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
    adjust.js      the adjustment dialog, built from a data table; the
                   curves graph is the one control that is not a slider
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

cargo run --release --example bench    # times the composite at 4K
```

`examples/bench.rs` is where the numbers quoted below come from. Time a pass
there rather than in the browser: a headless Chromium's canvas is GPU-backed
and its `requestAnimationFrame` ticks at a fixed 16.7 ms whatever the
callback costs, so `drawImage` and `putImageData` of even a 6000x4500 canvas
measure as nothing. Run it before and after anything that touches the
compositing path.

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

## Files, the clipboard, and what the page keeps

**The file.** Every file carries `file::VERSION`, and a file from a *newer*
NPaint is refused (`FileError::Version`) rather than misread; older ones are
read by this build. Anything that changes what the bytes mean bumps the
number and adds a line to the version history at the top of `src/file.rs`,
which is the one place that says what each version was. `src/file.rs` writes
the document as a little-endian stream —
magic, version, size, then every layer with its rasters, mask, kind, blend
mode and locks — and reads it back into a `Document`. It is deliberately
not JSON or a zip: the engine has no parser for either, and the pixels are
the bulk of it. The page gzips the stream on the way to disk
(`CompressionStream`) and inflates it on the way back; a stream that arrives
uncompressed still opens, and `loadFile` recognises the file by its name or
its first bytes, so a `.npaint` dropped on the page or picked with Open goes
the right way. `History` keeps the id of the state that was last saved, so
`is_modified` is true only when the document differs from it — undoing back
to it is clean — and the page asks before the tab closes or the document is
replaced.

**The clipboard.** Copy lives in the engine (`Editor::copy_selection`): the
selected pixels of the active surface, or of the composite for Copy Merged,
with where they came from, so Paste puts them back in place (or centred, if
they no longer fit). The page also hands a PNG to the system clipboard so
the pixels can go elsewhere. Paste comes in through the browser's `paste`
event — the one route that needs no permission — and takes the engine's
copy when the system holds the same picture, otherwise whatever image the
system has, as a new layer at its own size. Edit > Paste asks
`navigator.clipboard` instead, which may prompt. File > New wants the
clipboard's size for its default, and asks the same two ways: a paste into
the dialog sets it (the dialog says so, and it is the only route that can be
relied on), and `navigator.clipboard.read()` is tried quietly on opening in
case the browser allows it — most refuse, so that failure is silent and
nothing in the dialog offers it. The last size found is remembered for the
next New, and a size that has been typed over is never replaced by a late
answer.

**The view furniture.** Rulers, guides, the grid and the pixel grid are
drawn by the page over the composite and are not in the document; the
guides are dragged out of the rulers and can be moved, or dragged off the
canvas to remove them, with any tool. Rulers, grid, snapping and the
history depth are remembered in `localStorage`. The page hands the engine a
copy of the guides (`set_guides`) whenever they change, and `src/snap.rs`
pulls the move tool's pixels and the free-transform box (edges and centre
on a move, the handle on a scale) onto guides, canvas edges and the canvas centre
lines within `SNAP_PX` on screen; a guide being dragged snaps to the centre.
Guides are saved in the `.npaint` file, as a trailer after the layers.

**What "dirty" means.** `Editor::dirty` is the *rectangle* of the composite
that has changed, or `None` for nothing. `NPaint::render` recomposites and
re-uploads that rectangle and hands it back as `[x, y, w, h]`, and the page
`putImageData`s the same rectangle. Only gestures that edit pixels set it at
all: selection and view gestures do not, since the page redraws from the
frame it has and retraces the ants itself for the tools in `SELECTION_TOOLS`.

The rectangle is the difference between a brush dab costing a dab and a dab
costing a canvas. At 3840x2160 with a background, a masked layer and a levels
adjustment layer, a full composite is ~54 ms; the same stack over a 64x64
rectangle is 0.03 ms. Every layer composites a pixel at a time, so redrawing
a rectangle of the frame gives exactly what redrawing all of it would have —
there is a test that says so
(`compositing_only_the_dirty_rectangle_gives_the_whole_picture`).

Where the rectangle comes from: `Tool::dirtied` reports what the call that
just returned changed, and `Editor::touch` accumulates the answers until the
page draws. A tool that says nothing gets the whole document, so correctness
never depends on a tool answering — but a tool that reports *less* than it
touched leaves stale pixels on screen, which is the one way to get this
wrong. Grow the rectangle by whatever the brush rim or the antialiasing may
reach. Everything structural — a layer added, reordered, hidden, an undo, a
transform — calls `Editor::touch_all` and redraws the lot.

`Editor::enforce_limits`, `Selection::apply` and `layer::keep_alpha` take
the same rectangle, so the selection is enforced over the dab rather than
over the document.

The page also keeps half-size copies of the frame (`sourceFor`) for
zoomed-out drawing. They are *patched* with the same rectangle (`patchMips`)
rather than thrown away, since rebuilding four levels of a 4K frame on every
stroke update is most of the cost of a zoomed-out edit. It caches the
selection's status line and the ants' path between frames.

**The subject box.** The subject tool (`tools/subjectbox.rs`) only draws a
rectangle into `ToolSettings::subject_box`; the selection is untouched. When
the drag ends the page reads the box, takes `frame_crop` of it, runs the
model on those pixels alone (so a small subject gets the model's whole
resolution), and hands the matte to `select_subject_in_box`, which places it
at the box and combines it with the selection under the Shift/Alt mode from
when the drag began. Without the model, `select_subject_builtin_in_box` runs
the engine's finder over the crop. Both clear the box; so do Escape and a
tool change. View > Snap to Guides turns it off.

**Locks.** `Layer::locked` refuses every edit through `edit_refusal`, and
the page shows the reason. `Layer::lock_alpha` is enforced the same way a
mask selection is: the editor keeps the surface from before the gesture and
`layer::keep_alpha` gives every pixel back the alpha it had (`enforce_limits`
and `pixel_edit`). Moving or transforming an alpha-locked layer is refused
(`EditRefusal::AlphaLocked`), since neither can keep the holes where they
were.

**Blend modes.** `blend.rs` has the sixteen W3C modes as functions of two
colours; `Rgba::blend_over` does the alpha handling once for all of them and
`Raster::composite_blend` is `composite_over` with a mode. An adjustment
layer's mode blends its result back over the original.

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
selection along with them. So do the arrow keys: `nudge_layer` is the move
tool by another route (one undo step per run of presses), and
`nudge_selection` moves only the outline. Edit > Stroke deliberately paints
both sides of the edge, so it does not go through the funnel either.

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

**What a session keeps.** An adjustment has no dirty rectangle to save it:
moving a Levels slider changes every pixel, and the dialog asks for that on
every tick. What does not change is everything *below* the layer being
edited — a session is cancelled by any layer operation, undo or new document,
so nothing under it can move while it is open. `Editor::preview_base`
composites those layers once when the session opens and every preview starts
from a copy of the answer (`Document::composite_below` and
`composite_from`). At 3840x2160 with two layers under a levels adjustment
layer that is 54 ms a tick down to 23 ms.

The cache lives and dies with the session; `commit_session` and
`cancel_session` drop it, and `PreviewBase::fits` is a second line of defence
rather than the thing keeping it honest.
(`a_session_composites_from_its_cached_base_and_gets_the_same_picture`.)

**The reduced preview.** The other half: a 4K document fitted to a window is
drawn at about a quarter, so fifteen of every sixteen composited pixels are
thrown away by the downscale before anyone sees them. While a session runs,
`Editor::preview_step` reads the zoom and `SmallPreview` holds the document
reduced to match — everything below the edited layer flattened into one
layer, then the edited layer (always at `SMALL_EDITED`) and whatever is above
it, all shrunk by `Raster::downscaled`, with the selection shrunk by
`Selection::downscaled` beside them. `NPaint::render_preview` composites that
and the page draws it stretched over the canvas in place of the frame, which
is left exactly as the last full render made it. A slider tick on the stack
above: 54 ms before any of this, 25 ms at 1:1, **3.1 ms at a quarter zoom**.

The step is the same power-of-two ladder the page's half-size copies go down,
so a preview always lands on a size the screen is already showing. Changing
the zoom mid-dialog rebuilds it — and a rebuild takes the document's own
pixels, so a `Session::Adjust` that has only ever previewed into the reduced
copy puts its adjustment back (`preview_into`).

`Session::Adjust` does not touch the full-size surface at all while a reduced
preview runs; that is where its saving comes from. `commit_session` works the
full-size answer out from `Session::Adjust::last`, so what the document keeps
is always the full-resolution pass however the previews ran, and the layers
panel's thumbnails lag a dialog rather than showing something reduced.

**What you give up.** A reduced preview is the adjustment applied to a
reduced picture, which is not quite a reduction of the adjusted picture. For
a curve, a levels pull or a hue shift the difference is at most a level or
two — measured in a browser at 50%: at most 1/255, over 0.7% of the pixels.
For a threshold or a hard posterize it is visible, and the picture changes
when the dialog is accepted. That is the trade every editor of this kind
makes; `a_zoomed_out_preview_composites_at_the_size_the_screen_shows` pins
both halves of it.

Select > Transform Selection is the same `TransformSession` over a raster
whose alpha is the selection's coverage (`Session::TransformSelection`):
every change re-reads the rendered alpha into the selection, commit keeps
the outline where it is and records nothing, cancel puts the old selection
back. The transform bar's fields go through `transform_set_position`,
`transform_set_size` and `transform_set_angle`, which are absolute where the
drags are relative.

The transform's handle hit-testing is in Rust (`TransformSession::hit`),
with the grab radius given in document pixels as `8 / zoom` so it is a
constant size on screen. The page asks `transform_hit` only to choose a
cursor.

## Adding things

**A tool.** Add a file under `src/tools/`, implement `Tool` (`begin`,
`update`, `finish`, `cancel`, and `dirtied` if it can say what it touched —
see "What dirty means"), add a `ToolKind` variant with a name and a
history label, and an arm in `ToolKind::instantiate`. In `app.js`, add an
entry to `TOOLS` (name, label, shortcut key, icon path, hint); tools that
share a key cycle when it is pressed. Say in `begin` whether the gesture
`EditsActiveLayer` — that is all the undo system needs from you; a `Passive`
gesture that changes the selection becomes a step on its own. Clip every
pixel write with `ctx.clip()` and the selection will just work. A tool that
needs to *set* something — the eyedropper sets the colours — has
`ctx.settings` mutably.

**A drawing primitive.** `raster.rs`. Take a `clip: &Rect` and never write
outside it. Test against a small raster with exact pixel counts. A pass over
a whole buffer wants `for_each_row`/`row`, which hand out one row of the clip
at a time: one bounds check a row rather than one a pixel, and a straight run
of memory for the compiler to work with.

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
undo and menu entries come for free — including its life as an adjustment
layer, which is where it gets a mask.

If the adjustment is per-channel — a `lut`, so what it does to red it does
to green the same way — say so in `Kind::takes_channel` and it can be
pointed at one channel: `Adjustment::apply` computes the new colour as
always and `Channel::pick` keeps it only where it was aimed. Add
`channelParam()` to the front of its row in `ADJUSTMENTS` to match. The ones
that read the whole colour (hue, colour balance, threshold) or the picture
around it (dither) are not per-channel and do not offer it.

The channel rides at the *end* of the flat parameter list, one past the
kind's own — which is both where the curve's variable-length points have
stopped and where a file written before the choice existed has nothing, so
an older document comes back on RGB. It shows at the *top* of the dialog,
where a channel belongs; `channel: true` on the row is what tells
`www/adjust.js` to keep those two orders apart.

An adjustment that is *not* a function of the colour alone takes over
`apply` instead, as `Dither` does: the raster and the clip are all it needs,
and `Raster::map_at` hands it the document position of each pixel (index the
effect by that, never by the clip, or a preview through a selection will not
line up with the same settings applied to the whole layer). `map` still has
to answer something sensible for one colour on its own — the dither gives
the rounding it would have dithered around.

Besides sliders and the curve, a parameter row may be `kind: "choice"` (a
dropdown; its value is the option's index) or `kind: "toggle"` (a checkbox;
0 or 1), and may carry `enabled(values)` to grey itself out when the other
settings make it meaningless. Everything still crosses as a flat
`Float32Array`, so `from_params` and `params()` stay the only description of
what the numbers mean.

**A menu item.** `app.js` builds every menu from item lists; `layerItems`,
`editItems` and `selectItems` are shared between the menu bar and the
context menus, so add to those rather than to one menu.

**Layer properties, filters, adjustments.** Add the operation to `Document`
(pure, tested), wrap it in `Editor` through `structural(label, ..)` so it is
an undo step with a name in the history panel, expose it in `wasm.rs`, bind
a button in `app.js`. A new layer property also wants a line in `file.rs`,
on both sides, and a field in its round-trip test.

## Masks, adjustment layers and smart objects

Every layer is one struct with a `kind`, and the tools do not know which:

* **The surface.** A layer may carry a *mask* — a second, grey, document-
  sized `Raster` — and a `Target` saying whether the tools edit the mask or
  the pixels. `Document::active_surface()` is the raster the tools paint,
  and it is the *only* thing the tools, the fills, the adjustment dialog and
  the free transform touch. That is why a mask can be painted with the
  brush, levelled, feathered through a selection or transformed without a
  line of mask-specific code in any of them. The mask is a raster rather than
  a `Mask` for the same reason. Its coverage is the pixel's brightness, with
  transparent counting as white, so a fresh mask reveals and the eraser
  reveals (`layer::mask_cover`). Compositing goes through
  `Layer::rendered()`, which applies the mask to the alpha.
* **Refusals.** A smart object's pixels and an adjustment layer's (it has
  none) cannot be painted. `Layer::edit_refusal` says so; `pointer_down`,
  `pixel_edit`, `begin_adjustment` and `begin_transform` all consult it, and
  the page shows `edit_refusal()` when a click is declined. The mask of
  either can always be painted, which is how an adjustment layer is shaped.
* **Adjustment layers** hold an `Adjustment` and an empty (0x0) raster.
  `Document::blend_layer` applies the adjustment to the composite so far and
  mixes the result in by opacity and mask. Editing the settings is a
  `Session::AdjustmentLayer`: the same dialog and the same
  `preview_adjustment` call, with the engine writing to the layer rather than
  to pixels; commit is one structure snapshot. The layer starts with the
  selection as its mask, as in Photoshop. Merge Down bakes it into the layer
  below; nothing merges *into* an adjustment layer or a smart object
  (`DocumentError::CannotMergeInto`), and the page greys the item out.
* **Smart objects** keep the picture at its own size (`SmartObject::source`)
  and an `Affine` placing it; `raster` is only the rendering. Free transform
  on one is `TransformSession::placed`, starting from that matrix, and commit
  stores the new matrix and re-renders — so nothing degrades however many
  times it is scaled. Layer flips and turns, and every canvas operation, go
  through `Layer::map_rasters`, which changes the placement rather than
  resampling the rendering. Open makes the file's own layer one, at the size
  of the picture (`Document::from_smart_object`); Place puts a file in the
  open document as one, fitted; Convert crops a pixel layer to its content;
  Rasterize goes back; Replace Contents swaps the source and keeps the box.
  Because a smart object's placement may reach past the canvas,
  `Document::content_bounds` is the union of those placements with the
  canvas, and Image > Reveal All grows the canvas to it.
* **History.** A pixel edit snapshots the *surface* it touched
  (`Snapshot::LayerPixels` carries the `Target`); a layer flip or a smart
  transform snapshots the whole `Layer`; everything else the stack.

The layers panel shows the mask beside the pixels with the target outlined;
click either to switch, Shift-click the mask to disable it, Ctrl-click it to
load it as a selection. Adjustment layers open their dialog on double-click,
on the mark or on the name.

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
  `wasm.rs` before the page next renders; `render` re-checks and redraws
  everything if the frame was replaced, since a fresh frame is blank and the
  dirty rectangle would not fill it. The page builds an `ImageData` of
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

## Known gaps

No lasso or polygon drawn by hand, though the mask machinery is there for
one; no text, gradients or blur-type filters; the dither's error-diffusion
patterns are a serial pass over every pixel, so as a live adjustment *layer*
on a very large canvas they cost noticeably more per composite than the
ordered ones; no layer
groups; pixel layers are always document-sized (a transform resamples into
the canvas, and what leaves it is lost — a smart object keeps what leaves,
since it re-renders from its source); a mask is not linked to its layer
(moving or transforming the pixels leaves the mask where it was; the canvas
operations and the layer flips do carry it along); a smart object's
contents cannot be opened for editing, only replaced; adjustment layers have
no clipping to the layer below; an adjustment layer's preview is composited at
full resolution however far out the canvas is zoomed, where a 4K document
fitted to a window needs a sixteenth of those pixels (1.3 ms rather than
23 ms — `examples/adjbench.rs` has the measurements); an adjustment is aimed
at one channel at a time, where Photoshop's Levels and Curves keep a separate set of numbers
per channel behind one dialog — two adjustment layers is the answer here.
