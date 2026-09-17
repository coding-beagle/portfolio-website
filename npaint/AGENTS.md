# NPaint — guide for agents and contributors

NPaint is a layer-based image editor in the manner of Photoshop and Photopea.
It is a **static page**: the whole editor runs in the browser, there is no
server side, and nothing the user draws or opens ever leaves their machine.
The engine is Rust compiled to WebAssembly; the page is plain HTML, CSS and a
few ES modules with no bundler.

Deployed at `npaint.nteague.com`, and reachable as the NPaint shortcut on the
portfolio's desktop scene (`app/src/subdomains.js`).

Features in the works are located in TODO.md

# General coding principles

KISS — keep it simple

Keep code simple and focused on solving the immediate problem. Avoid unnecessary abstraction, premature optimization, or over-engineering.
Descriptive variable names

Use descriptive variable names that clearly indicate purpose. Avoid single-letter names except for common loop counters (i, j, k).
Comments explain why, not what

Code comments should explain why something is done, not what is being done. The code itself should be self-documenting through clear naming and structure. Comments should provide context, rationale, or explain non-obvious decisions.
Write for the reader, not the chat

Commit messages, changelog entries, PR bodies, docstrings, and comments are read by people who were never in the conversation that produced the code. Document the code, not the making of it.

Cut:

    Chat back-references — "here's the change we discussed", "as requested", "per your last message", "the refactor from earlier". There is no shared "we" and no "earlier" for the reader.
    Stream-of-consciousness — "First I tried X, but that failed, so now this does Y". State what the code does and why; drop the diary.
    Self-congratulation and filler — "successfully implemented", "comprehensive update to", "significantly improved". Name the actual change instead.
    Diff restatements — a changelog or commit body that narrates the diff line by line. Say what changed and why a reader should care, in as few lines as that takes.

BAD:  Successfully implemented the comprehensive caching improvements we discussed.
GOOD: Cache build artifacts between runs. Cuts CI from ~9 min to ~90 s.

# BAD:  Originally this used a loop but per the earlier discussion we switched to a dict.
# GOOD: """Return the user for `user_id`, or None if unknown."""

Maximum line length: 100 characters

Keep lines to a maximum of 100 characters. Break long lines appropriately to maintain readability.
No magic values

Replace hardcoded numbers and strings with named constants that explain their meaning and purpose. Magic values make code difficult to understand and maintain.

MAX_RETRY_ATTEMPTS = 3          # not: if retries > 3
DEFAULT_TIMEOUT_MS = 5000       # not: sleep(5000)
GRAVITY_M_S2 = 9.81             # not: force = mass * 9.81

Delete dead code immediately

Remove commented-out code, unused functions, and obsolete branches immediately rather than leaving them "just in case." Dead code creates confusion, maintenance burden, and false positives in searches. If you need it later, it's in version control history.
Minimize dependencies

Each external dependency introduces maintenance burden, security risks, and potential breaking changes. Before adding a new dependency:

    Can this be solved with the standard library?
    Is the dependency actively maintained?
    Is the functionality worth the added complexity?
    What's the transitive dependency cost?

Prefer standard-library solutions for common tasks. When dependencies are necessary, use well-maintained, focused libraries over large frameworks.
Prefer immutability

Use immutable data structures by default; only make data mutable when necessary for performance. Immutability prevents unexpected side effects, makes code easier to reason about, and simplifies concurrent programming.

    Use tuple instead of list when data won't change.
    Avoid modifying function arguments.
    Return new objects instead of modifying existing ones.


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
    brush.rs       the brush tips: round, square, calligraphy, chalk,
                   spatter — each a rule from a pixel's position to the
                   coverage one dab lays down
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
    filter.rs      the filters that read more than one pixel — the blur and
                   what is built on it (unsharp mask, grain), the median,
                   the motion blur, pixelate, emboss and find edges. They
                   are `adjust::Kind`s that delegate here rather than
                   lookup tables; see "Filters"
    geometry.rs    Point, Rect
    heal.rs        the healing brush's blend: the smooth correction that
                   makes a cloned patch sit in its surroundings without a
                   seam, found on a ladder of halved grids — see
                   "The healing brush"
    gradient.rs    a colour worked out from where the pixel is: two
                   colours, two points and a shape (linear, radial,
                   reflected, angle)
    raster.rs      the pixel buffer and every drawing primitive
    layer.rs       Layer, LayerId, and what kind of layer it is: pixels, an
                   adjustment layer, a smart object, or a group; the layer
                   mask and which of the two rasters the tools edit; the two
                   locks; which group the layer is in (`parent`)
    palette.rs     a set of colours, and a picture conformed to it: the
                   nearest colour, with the error hidden by a dither, and
                   the distinct colours a picture is made of (a median cut)
    mask.rs        per-pixel selection coverage: combine, grow/contract,
                   feather, smooth, antialias, contours (the marching ants),
                   and `from_polygon`, which is what the lasso draws with
    psd.rs         reading Photoshop's `.psd` — see "Photoshop files"
    document.rs    the layer stack; add/remove/move/merge/composite, and
                   the grouping the flat list carries — see "Layer groups"
    selection.rs   what painting may touch: nothing, a rect, or a Mask
    text.rs        what a text layer remembers: the text, its style (font,
                   size, bold, italic, alignment), colour, and where the
                   block starts in the picture the page drew of it
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
      lasso.rs     the lasso: a selection drawn freehand, closed when the
                   pointer comes up
      gradient.rs  the gradient tool: a drag's two ends, and the clip
                   filled between them
      wand.rs      magic wand, quick select and the refine brush (none of
                   them touch pixels — only the selection)
      movetool.rs  move (translate the selection or the layer)
      stroke.rs    brush, pencil, eraser, clone stamp, healing brush (one
                   gesture, five stamps, a tip from brush.rs, and a hardness
                   the pencil ignores). The clone stamp is the one that reads pixels
                   to write them: Alt-click anchors the source, and the
                   stroke copies from a fixed offset. `clone_offset_for` is
                   that offset, and `Editor::clone_source_offset` and
                   `clone_source_patch` are the same answer for the preview
                   the page draws inside the brush ring, so what is shown
                   and what is stamped cannot drift apart. The healing
                   brush is the same stroke with `heal.rs` run over what it
                   covered once the pointer is up
      bucket.rs    paint bucket: the wand's patch, filled
      eyedropper.rs the eyedropper, and the Alt-click under every brush
      shape.rs     line, rectangle, ellipse (rubber-band)
      text.rs      the text tool: a kind with no gesture of its own — a
                   click opens a text session in editor.rs (see "Text")
      view.rs      zoom (click / alt-click / marquee or scrubby drag) and hand
    transform.rs   Affine and Projective (a homography — what Ctrl on a
                   handle makes of a placement), bilinear resampling, the
                   free-transform session
    editor.rs      the facade: one document + selection + viewport + history + tool
                   + the adjustment/transform "session" (preview, commit, cancel)
    wasm.rs        the wasm_bindgen class `NPaint`; a translation layer, no logic
  www/
    index.html     the page
    app.js         DOM, canvas, events, render loop, menu definitions
    menu.js        the menu-bar drop-downs and context menus (one component)
    commands.js    the command palette: the menu tree flattened into one
                   fuzzy-searchable list, shortcuts and all (Ctrl+K)
    colorpicker.js hue ring + saturation/value square, hex/RGB/HSV fields
    gradient.js    the gradient editor: the run of colour stops the gradient
                   tool lays down, its presets, and the bar they are drawn on
    palette.js     the palette panel: the colours to draw in, their own
                   undo, and `.gpl` in and out
    recovery.js    the crash-recovery store: one copy of the document in
                   IndexedDB. Nothing in it may throw — see "Autosave"
    toolhelp.js    the card shown beside a tool button on hover: the tool's
                   name, its hint, and its demo clip if there is one
    record.js      record mode (`?record=1`): records a tool's demo clip off
                   the viewport canvas. Development only, not fetched
                   otherwise — see "Tool demo clips"
    demos/         one WebM per tool, named after the tool. Optional; a tool
                   without one gets a card with only its text
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

**Every feature has to survive a `.psd`.** A `.psd` is how artwork arrives
from everywhere else, and a feature that the importer cannot fill in is a
feature most users will never see on their own files. So whenever you add
something a layer can *be* or *carry* — a kind of layer, a property, a
relationship between layers — the same change has three more parts:

1. **`src/psd.rs` reads it**, where Photoshop's file says it. If Photoshop
   has no equivalent, say so in the module's "what is knowingly left out"
   list and move on; if it has one and you skip it, that is a gap, not a
   decision.
2. **It says so when it cannot.** An approximation gets a sentence on
   `Import::note`, which the page puts in the status bar. Never guess
   silently.
3. **`src/file.rs` carries it both ways**, with a bumped `VERSION` and a
   line in the version history, so that a document opened from a `.psd` and
   saved as NPaint's own file keeps what it arrived with.

The regression cover that travels is `psd.rs`'s own tests, which build the
files they read — `a_folder_comes_in_as_a_group_with_its_layers_inside_it`
assembles a folder byte by byte the way Photoshop writes one. A real sample
dropped in `test_psds/` gets read by `files_photoshop_actually_wrote` as
well, which checks it opens, nests soundly and survives NPaint's own format;
that folder is gitignored, so those stay on your machine and a clean
checkout is green without them.

Layer groups are the worked example: [`LayerKind::Group`] and
[`Layer::parent`], `psd.rs` building them from the section dividers, and
format 5 writing them.

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

`examples/adjbench.rs` and `examples/healbench.rs` are the same idea for the
adjustment previews and the healing brush's blend.

One test reads from outside the crate: `files_photoshop_actually_wrote` in
`src/psd.rs` opens every `.psd` in `npaint/test_psds/` (or `NPAINT_PSD_DIR`)
and checks that what comes out is a document the rest of the engine accepts —
rasters the size the document says, a composite that holds up, and a round
trip through `file::save`/`file::load` that comes back unchanged. That folder
is gitignored, because real Photoshop files are tens of megabytes, so the
test finds nothing on a clean checkout and says so rather than failing. Put a
file in it and it is covered from then on; there is no expected output to
keep up to date. It is also the one slow test in the crate, and
`cargo test --release` makes it quick.

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
mode, locks and the group it is in — and reads it back into a `Document`. It is deliberately
not JSON or a zip: the engine has no parser for either, and the pixels are
the bulk of it. The page gzips the stream on the way to disk
(`CompressionStream`) and inflates it on the way back; a stream that arrives
uncompressed still opens, and `loadFile` recognises the file by its name or
its first bytes, so a `.npaint` dropped on the page or picked with Open goes
the right way. `History` keeps the id of the state that was last saved, so
`is_modified` is true only when the document differs from it — undoing back
to it is clean — and the page asks before the tab closes or the document is
replaced.

**Photoshop files.** `src/psd.rs` reads `.psd`: an 8-bit RGB or greyscale
document, its layers with their names (the Unicode one, where there is one),
positions, opacity, blend mode, visibility, layer masks and **groups**, raw
or run-length encoded. Photoshop's bounds are half-open where
`Rect::from_corners` takes both corners as pixels that are in, which is the
one easy thing to get wrong in there.

Groups come in as groups. Photoshop writes a folder as three things in a
row, bottom-first: a `lsct` marker of kind 3 under the contents, the
contents, and then the folder's own record (kind 1 open, 2 shut) carrying
its name, opacity, blend mode and mask. That is exactly how the document
stores a group — see "Layer groups" — so the reader keeps a stack of open
folders, fills in each layer's `parent`, and hands the whole list to
`Document::from_parts`, which checks the nesting came out sound. Nothing is
rearranged. A file whose folders are not written whole says so on the note
and leaves those layers loose rather than guessing what they belonged to.

The important part is what it does when it cannot: **it falls back to the
flattened copy**. Almost every `.psd` carries a composite of itself in its
last section, so a zip-compressed channel or an arrangement the reader does
not know ends in the picture opening as one layer with a note saying why,
rather than an error. `Import::note` is that sentence and the page puts it in
the status bar. What is refused outright — 16-bit, CMYK, Lab, `.psb` — is
refused by name, because there is nothing honest to convert it into. There is
no `.psd` *writer*, and adding one is a bigger job than the reader: a reader
may ignore what it does not understand and a writer may not.

**Autosave.** `www/recovery.js` keeps one copy of the document — the same
gzipped stream `File > Save` writes — in IndexedDB, and the page offers it
back on the next load. Three things decide when it runs, and all three matter:
the document has to be modified *and* changed since the last copy, which
`NPaint::document_state` answers exactly — most edits never pass through a
function in `app.js` at all, so nothing the page counted for itself would be
right; no session
or gesture may be open, since `snapshot_document` settles both before it
writes and doing that mid-stroke would be the autosave destroying the work it
is saving; and each round measures itself and asks for the next one twenty
times further off, so a copy stays near a twentieth of the clock whatever
size of document is open.

Two engine methods exist only for this. `Editor::snapshot_document` is
`save_document` without the `mark_saved`, because a recovery copy is not a
save and taking one must not clear the close prompt. `Editor::mark_unsaved`
is the other way about: a recovered document has a fresh history but has
never reached the user's disk, so it has to go on counting as modified. The
copy in the store stays until the user saves for real or refuses it at the
prompt — never merely because it was recovered once.

**The clipboard.** Copy lives in the engine (`Editor::copy_selection`): the
selected pixels of the active surface, or of the composite for Copy Merged,
with where they came from, so Paste puts them back in place (or centred, if
they no longer fit). When Copy takes *all* of a smart object or text layer —
nothing selected, or a rectangle around the lot — the clip carries the whole
`Layer` as well, and Paste inserts a copy of it (re-rendered for whatever
document it lands in) rather than its rendering: a copied smart object stays
smart. Part of one, or Copy Merged, is pixels. The page also hands a PNG to the system clipboard so
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
history depth are remembered in `localStorage`, and so is the colour
picker's strip of recent colours (`npaint.recentColors`, the last twelve a
picker was closed on after a change). The page hands the engine a
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
reach. Everything structural — a layer added, reordered, hidden, an undo,
committing a session — calls `Editor::touch_all` and redraws the lot.

Anything dragged is redrawn the same way — put the pixels back where they
were, lay them down where they are now, and report that union — rather than
rebuilding the surface and saying the whole document changed. `MoveTool`
does it with `Raster::merge_translated_in`, and a free transform's *preview*,
which is the one gesture that is not a tool, with
`TransformSession::render_into` over the rectangle
`Editor::transform_shown` remembers from last time. Which of the two runs is
not the tool in hand: the move tool drags a smart object or a text layer by
its placement, so that is a transform session, and everything else is a
`MoveTool` gesture.

At 4K a pointer event went from 34 ms to 1 ms for a line of type and from
53 ms to 8 ms for a 1200x800 item — the difference between the pixels
following the pointer and stuttering behind it.

A layer that covers the whole canvas has no rectangle to be clipped to:
every pixel of it really does change. That drag takes the other saving
instead, the one the adjustment dialogs take — it is shown on the
**reduced copy** (see "What 'dirty' means" above and `Editor::preview_step`)
while the canvas is zoomed out far enough that the screen cannot tell, and
the document itself is moved once, when the pointer comes up. At a quarter
zoom a full-canvas 4K drag costs 4 ms a pointer event instead of 65.

Both kinds of drag do it, and both are held by `Editor::hold_preview_base`,
so the page needs to know nothing about it: `NPaint::render_preview` already
draws the reduced composite stretched over the canvas and clears the frame's
dirty rectangle, exactly as it does for a slider. A transform previews
through a reduced twin of its session (`TransformSession::reduced` and
`follow`); the move tool splits the copy's pixels once and shifts them, with
`tools::movetool::drag_offset` deciding how far for both the preview and the
tool, so that what is shown and where it lands cannot drift apart. The scale
is frozen for as long as a drag is showing on the copy, since rebuilding it
would take the document's own pixels, which are still where the drag began.

A placement that is only a shift by whole pixels resamples to exactly the
pixels it started with, so `TransformSession::render_into` copies them
instead — which is what dragging a placed picture is, and what took a 4K
smart object from 227 ms a pointer event to 64.

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

On a smart object or a text layer (its pixels, not its mask) the move tool
does not touch pixels at all: `pointer_down` opens a free-transform session
with a move drag already begun (`TransformSession::begin_move`, grabbed
wherever the click landed), `pointer_up` commits it as a step called Move —
or cancels it, if the pointer went nowhere — and Escape cancels it
(`Editor::moving_smart`). The arrow keys change the placement the same way.
The selection is not carried along, since the placement is the whole layer.

Coverage is 8-bit, so `feather` and `antialias` are not special cases; the
two cheap shapes (nothing selected, a plain rectangle) stay as themselves and
a mask that turns out to be a solid rectangle collapses back into one.

## Gradients and palettes

Both are **the page's, not the document's**. A gradient is a tool setting and
a palette is a set of colours to draw in; neither is in the picture, so
neither is in the file, and both are remembered in `localStorage` the way the
view furniture and the strip of recent colours are.

**The gradient.** `gradient::GradientStops` is a sorted run of stops — a
colour, an alpha and how far along it sits — and `sample` mixes the two on
either side of a fraction, premultiplied, so a run out to transparent fades
rather than dragging a grey halo behind it. Two stops in the same place are a
hard edge, since the run a fraction falls in starts at the *last* stop at or
before it. `ToolSettings::gradient_stops` is `None` while the tool is running
from the foreground and background swatches, which is what it did before
there was an editor and is still where a fresh document starts;
`www/gradient.js` is the editor for the rest, and hands the engine
`[position, r, g, b, a]` per stop. The options bar's button draws the run as
it will be laid down, Reverse and all, a column at a time by the same rule
the engine samples with — not as a canvas gradient, which mixes straight
and would show a fade to transparent differently from the picture.

**The palette.** `www/palette.js` holds the colours and the panel. Editing
one is undoable, but through the panel's own two buttons rather than the
document's history: an undo that sometimes meant the picture and sometimes
the swatches would be worse than none. `.gpl` is the exchange format, since
GIMP, Aseprite, Krita and Inkscape all read it. "From image" is the one thing
the engine answers, and `Palette::from_image` is a **median cut** rather than
a count of the commonest colours. The difference is the whole point of it:
counting gives a picture's palette as six shades of sky, because that is what
most of the pixels are. The cut starts from coarse buckets of the composite
(see `BUCKET_LEVELS`), treats them as one box in colour space, and splits the
*widest* box across its widest channel **at the middle of that channel's
range** — halving the box by colour, not by pixel count, which is what stops
a crowded cluster from being divided over and over while the rest of the
picture waits. Each box then reports its own pixel-weighted average. A bucket
holding a negligible share of the picture (`NEGLIGIBLE_SHARE`) is dropped
first, so a stray pixel or a compression artefact does not claim one of the
answers — unless dropping it would leave too few to fill the palette.
`a_picture_of_one_colour_s_shades_does_not_spend_the_palette_on_them` is the
test that pins this.

The cut alone is not always enough — a photograph really is mostly one or two
colours, and a cut fine enough to reach the rest of it comes back with
several shades of those. So `from_image` also takes a **separation**,
`0.0..=1.0` of `MAX_SEPARATION`, which the dialog's Distinct slider sets: the
cut is asked for `OVERSAMPLE` times as many colours as are wanted and they
are taken in order of coverage, each skipped if it is nearer than that to one
already taken. At zero the cut's own answer stands; wound up, near-shades
give way to colours from elsewhere in the picture, and a picture with nothing
else to offer comes back with fewer colours than were asked for — which the
dialog says. Every search recomposites the picture, so the page looks again
when the slider is let go rather than on every tick of the drag.

The colours come back by how much of the picture each covers. Everything
after that is the page's: the dialog says how many to look for, offers the
order they are shown and added in (by area, by hue, by lightness, or hue
banded then light — greys lead the hue orders, having no hue to sort by), and
is where the choosing happens. Each colour can be left out, the ones the
palette already has are marked, and what is left either joins the palette or
becomes it. Nothing changes until one of those two buttons is pressed.

**Filter > Map to Palette** is where a palette reaches the picture:
`adjust::Kind::Palette` is an adjustment like any other — the same dialog,
preview, undo step and life as an adjustment layer — that replaces every
colour with the nearest in its palette. Its colours ride at the *end* of its
parameters, where the curve's points do, because they are the variable-length
part; `file.rs` writes an adjustment's parameters length-prefixed, so a
palette adjustment layer round-trips without the format changing. With no
dither it is a function of one colour and takes the cheap path;
with one it reads where the pixel is, so `is_spatial` says so for that case
alone. The ordered patterns perturb by `Palette::spread` — how far apart the
palette's colours typically are — since a palette has no evenly spaced ladder
for a threshold to be a step of, and the diffusion passes carry the error of
the whole colour rather than of one channel.

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

## Brush tips

A stroke (`tools/stroke.rs`) is a run of dabs whose coverage combines by
maximum into one mask for the whole gesture; the *tip*
(`ToolSettings::tip`, a `brush::BrushTip`) is what one dab covers. Round
is `Raster::stamp_soft_disc`; the others go through `Raster::max_cover_in`,
which raises the coverage under a rectangle to whatever a closure says and
never lowers it. Square and calligraphy (a nib a quarter as thick as it is
long, at 45°) take the hardness as the round tip does; chalk is the disc
with a grain keyed to the canvas coordinates by `dither::hash`, so passing
twice over a point finds the same grain rather than filling it in; spatter
throws a handful of dots per dab, seeded by the dab's position, so dots
build up where the pointer lingers. Every tip stays inside the
`size`-square about the dab, which is what the stroke's dirty rectangle
assumes, and every tip is one pixel at size 1. The pencil treats any
coverage as full, so it stays hard under chalk too. The page shows the
hardness slider only when `brush_tip_has_hardness` says it means anything,
and draws the brush ring as a square for the square tip.

Three settings shape the path before the tip is stamped, all in
`ToolSettings` and all in `tools/stroke.rs`:

* **Symmetry** (`tools::Symmetry`): mirrors in the canvas's vertical and
  horizontal axes and an n-fold turn about the canvas centre, which
  combine — a mirror with a six-fold turn is twelve dabs, a mandala. Every
  segment of a stroke is stamped at every image into the one coverage
  mask, so the copies never compound where they meet, and the dirty
  rectangle is the union of the segments. `Symmetry::images` snaps its
  answers to a millionth of a pixel because positions are floored into
  pixels and a quarter turn otherwise lands at 14.999999999999998. The page
  draws the axes over the canvas while a brush tool is in hand.
* **Smoothing**: the brush goes only part of the way towards each pointer
  event (`follow`), which rounds off a hand's jitter and cuts corners; the
  stroke always ends at the pointer.
* **Pressure**: the page passes a pen's pressure with every pointer event
  (`NPaint::pointer_down(x, y, shift, alt, pressure)`, a mouse being 1),
  the editor keeps it for the `PointerEvent`, and the stroke scales the
  dab by it while `pressure_size` is on. The page reports 1 for anything
  that is not a pen, since a mouse claims a pressure of 0.5 while its
  button is down.

## The healing brush

The clone stamp copies pixels; the healing brush copies them and then makes
them belong. A patch taken from elsewhere is right in its *texture* and wrong
in its *tone*, so the seam shows wherever the two places differ in brightness
or colour. The cure is Poisson's: keep the patch's derivatives, solve for its
intensities, with the surroundings as the boundary condition.

`src/heal.rs` writes that as a **correction** rather than as a solve of the
pixels themselves. If the answer keeps the patch's Laplacian exactly then the
difference between answer and patch is harmonic, so all that is wanted is the
function that is harmonic inside the stroke and equals (surroundings - patch)
at its edge. `harmonic_fill` is that function, and because it is smooth it
carries every bit of the patch's detail through untouched.

Three things about it are worth knowing before changing it:

* **It runs when the pointer comes up, not during the stroke.** While the
  pointer is down the healing brush *is* the clone stamp — the same
  `StrokeMode` arm, the same pixels — and `StrokeTool::blend_seam` blends
  the whole of what the stroke covered in one go at the end. Photoshop does
  the same, and for the same reason: the blend is over the whole stroke, and
  a dab at a time cannot give it. `InProgress::covered` is the area,
  accumulated as the stroke goes rather than searched for at the end.
* **Gauss-Seidel alone is useless here.** It settles fine detail in a few
  sweeps and long wavelengths at a rate that goes as the square of the
  region's width, so a stroke a thousand pixels long would want millions of
  them. So the answer is found on a halved grid first, and that one on a
  halved grid again, down to a few cells across where one sweep crosses the
  region; each level starts from the one below and needs a handful of sweeps
  of its own. Axes halve separately, so a long thin stroke is coarsened
  along its length rather than stopping at its width. A brush-sized region
  is under a millisecond; a scribble over 3 megapixels is 200 ms
  (`examples/healbench.rs`).
* **Exact where the grid halves evenly, and a hair off where it does not.**
  A grid whose sides do not halve all the way down leaves a half-width block
  at one end of each coarse row, and the five-point Laplacian over centres
  that are not evenly spaced no longer leaves a ramp alone; the answer comes
  back tilted by a fraction of a percent of the range of its edge. The fine
  grid's own boundary is met exactly either way, and that is what decides
  whether a seam shows. Both halves have a test.

What the difference is taken between matters: both sides come from the one
sampled raster the stroke took when it began — where the copy is read from
and where it is going — so that "all layers" compares like with like. A pixel
that is transparent on either side has no tone to match and contributes
nothing, which is why healing onto an empty layer is simply a copy.

## Text

The engine has no fonts. A text layer is a **smart object whose source the
page drew from text** and which remembers the text (`SmartObject::text`, a
`text::TextObject`): the font, size, bold, italic, alignment, colour, the
string, and `origin` — where the block of text starts inside the source,
the padding the page gave the rendering. `LayerKind::name` says `"text"`
for such a layer, `Layer::edit_refusal` gives `EditRefusal::TextLayer`
for its pixels, and everything that works on a smart object — free
transform, the move tool, layer flips, canvas operations, Rasterize,
`content_bounds`, the file — works on a text layer unchanged. Replace
Contents drops the text, since the picture is no longer it.

Typing is a session in `editor.rs` (`Session::Text`). A click with the text
tool asks `text_layer_at` (the topmost visible text layer whose box holds
the point) and then either `begin_text_edit(index)` — which makes the layer
active and copies its style and colour into `ToolSettings::text` and the
foreground colour, so the options bar shows what the layer is set in — or
`begin_text_layer(screen)`, which adds an empty text layer at once (its
source 0x0) so that the first rendering is anchored to the click: its
left edge, middle or right edge by the alignment. On every keystroke, and
on every change in the options bar or the foreground colour, the page draws
the text on a canvas (`rasterizeText` in `app.js`: lines at a pitch of 1.2
em, each baseline where a CSS line box of that pitch would put it, padding
of half an em) and calls `preview_text(text, ox, oy, w, h, bytes)`;
`Layer::set_text` keeps the block's anchored edge where it was
(`TextObject::anchor`, in source pixels, applied *before* the placement so
it holds through any transform the layer has had) and re-renders.
`commit_session` records one step — "Add Text" or "Edit Text" — unless the
text is blank or unchanged, in which case a new layer goes away again and
an edited one is put back. Any layer operation, undo or new document
cancels the session, as with every session, and the page notices through
`is_editing_text` and takes its box away.

**The Character panel.** `text::PARAMS` is the one list of its settings —
tracking (thousandths of an em), leading (a multiple of the size),
horizontal and vertical scale, caps, underline, strikethrough, outline width
and shadow — with their ranges; `TextStyle::set_param`/`param` read and
write them by name, `set_text_param`/`text_param` cross the boundary, and
the page builds the panel from `text_param_names`/`text_param_ranges`, so a
new setting is a row in `PARAMS`, two arms in `text.rs`, a line in the file
(format 4 appended them after the origin) and whatever the page's renderer
does with it. The outline colour is the one setting that is a colour
(`set_text_outline_color`); its swatch in the panel opens the same colour
picker as the foreground and background swatches (`openPicker("outline")`),
and closing the picker hands focus back to the text box so Ctrl+Enter
still keeps the text.
Rendering: tracking is the canvas's `letterSpacing` (drawn a glyph at a
time where a browser lacks it), leading the line pitch, the scales a
`ctx.scale` round the block (the padding stays unscaled, and the box's CSS
matrix carries the same scale), caps `toUpperCase`, underline and
strikethrough drawn as rules, outline a `strokeText` under the fill in the
outline colour, and the shadow the canvas's own, half-black, offset down
and right by the setting and blurred by as much. The padding grows to hold
the outline and the shadow.

**Fonts from a file.** The font list's last entry loads a `.ttf`, `.otf`,
`.woff` or `.woff2` through `FontFace` and adds it under the file's name.
The file keeps the name only: a document set in such a font asks for it
again on another machine (the name is added to the list so the panel shows
it) and renders in the fallback until it is loaded.

The page's text box is a `textarea` over the canvas with invisible text
(the canvas shows the engine's rendering) put through the layer's
placement (`layer_placement`, the six numbers of a CSS `matrix()`) and the
zoom, laid out in source pixels, so its caret sits on the letters at any
zoom or rotation. Ctrl+Enter or a click elsewhere keeps the text; Escape
throws it away; changing tool keeps it. The text tool is on `Y`: `T` is
free transform, since Ctrl+T is the browser's new tab and Shift+T is not
safe from it either.

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

Holding a base marks the document changed when it builds a reduced copy, and
that is not housekeeping: the page keeps **one** preview frame and reuses it
for every session, and `preview_into` composites only when something is
dirty. Without the mark, a session opening on a picture nothing has touched
since the last frame was drawn leaves the *previous* session's preview on
the screen — transform, undo, transform again, and the box comes up over the
picture the undo was supposed to have taken away.
(`a_session_draws_its_own_reduced_preview_and_not_the_last_one`.)

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

Anywhere outside the box turns it, and the **rotation wheel**
(`TransformSession::wheel`, `Hit::Wheel`) is where that is written down: a
ring standing off the middle of the top edge along its outward normal, two
and a half grab radii out, so it keeps its distance on screen and goes round
with the box. It does what the space around the box already did; what it
adds is something to aim at, and a hit of its own, so the page can put the
turn cursor up and can keep the canvas-edge grab from taking the pixel.

**The 3D transform: Ctrl on a handle.** A placement is a `Projective` — a
homography — not an `Affine`. Every drag but one composes an affine onto it
and it stays affine, and `Projective::as_affine` says so, which is what
keeps the cheaper rendering path and the exact whole-pixel shift. Ctrl is
what leaves that family: a corner goes wherever the pointer is (Ctrl+Shift
brings the other end of its edge the other way, which foreshortens it), an
edge handle slides its edge along itself. Each states where the box's four
corners are to land and `Projective::from_quad` works out the matrix.

Three things follow from a placement that can be projective, and each is a
place it is easy to get wrong:

* **Ctrl is read on every pointer move, not at the start of the drag**, so
  one gesture can scale, distort and scale again. That only works because
  `Drag::Scale` remembers the matrix and the corners it began with and every
  move starts again from those — which is also `Editor::pointer_move`'s one
  extra argument over `pointer_down` and `pointer_up`.
* **The box no longer decomposes.** There is no angle or scale to read off a
  homography, so `info`, `set_size`, `flip` and the scaling drags all take
  the box's own axes from its *corners*. For an affine placement those are
  the same numbers as before.
* **Half the plane is behind the viewer.** A homography maps the whole
  plane, and the half beyond the vanishing line comes out mirrored. So
  `Projective::image_bounds` clips the source rectangle against that line
  before measuring where it lands — four mapped corners alone give a box
  that is inside out — and the renderer drops destination pixels on the
  wrong side of it. `SmartObject::extent` goes the same way.
  `from_quad` refuses a quadrilateral that has folded over, so a corner
  dragged through the shape simply stops following the pointer.

A smart object carries its placement, so a text layer or a placed picture
can be put in perspective and still re-render from its source. That is what
format 6 of the file writes (nine numbers rather than six), and what the
text box on the page is positioned with — a CSS `matrix3d`, the only
transform that carries the bottom row.

## Filters

Blur, Sharpen and Add Noise are `adjust::Kind`s like Levels or Curves, and
they go through the same funnel — the same dialog built from the same data
table, the same live preview, the same undo step, the same life as an
adjustment layer with a mask. What sets them apart is that they are not
functions of one colour, so `Kind::is_spatial` says so, `Adjustment::pixel_map`
has nothing to offer for them and `Kind::apply_spatial` hands the clip to
`src/filter.rs` instead. The dither was already the one adjustment shaped
this way; the filters joined it rather than growing a second mechanism. They
are listed under **Filter** in the menu bar rather than under Image >
Adjustments, and the only thing that decides that is `group: "filter"` on
their row in `www/adjust.js`.

Two rules a filter has to keep, and both have a test:

* **The answer may not depend on the clip.** A preview through a selection
  composites a rectangle at a time and an adjustment layer recomposites over
  whatever the dirty rectangle is, so a pixel must come out the same however
  it was asked for. The blur therefore reads a working copy of everything
  within three box-passes of the clip rather than the clip alone, and the
  noise is keyed to the pixel's document position through `dither::hash`
  rather than drawn from a running generator. Noise that was drawn afresh
  would also *boil*: an adjustment layer of it recomposites on every dab
  underneath it.
* **Alpha.** Every other adjustment leaves it exactly as it found it. The
  blur cannot — softening an edge against transparency is most of what it is
  for, and blurring the colours while pinning the alpha drags whatever is
  stored under the transparent pixels out as a halo — so it works on
  premultiplied colour, alpha and all. Sharpen and noise keep alpha.

The blur is three box passes standing in for a Gaussian, the same
approximation `Mask::feather` uses, each a running average so the cost is the
area rather than the area times the radius. Its prefix sums are `f64`: in
`f32` they drift far enough over a few thousand pixels that one clip and
another disagree by a level, which looks exactly like a real clip dependency.

The rest — median, motion blur, pixelate, emboss, find edges — all reach the
same way, through `Around`: a copy of everything within the filter's reach of
the clip, taken *before* anything is written, with the edge of the picture
repeated beyond it. Reading from the copy is what keeps a filter from seeing
what it has already done, and taking the copy from the clip's surroundings
rather than the clip is what keeps the answer the same whatever rectangle it
was asked for. `no_filter_depends_on_the_rectangle_it_was_asked_for` filters
the same picture whole and then a strip at a time and demands the two agree
pixel for pixel. Pixelate is the one where the rule bites hardest: its cells
are laid out from the *document's* origin, never the clip's, or a preview
through a selection would not line up with the same filter applied to the
whole layer. Motion blur and pixelate move alpha about, as the blur does, so
both work in premultiplied colour; median, emboss and find edges keep alpha
as they found it.

## Tool demo clips

Resting the pointer on a tool button brings up a card with the tool's name,
its hint from `TOOLS`, and a short silent loop of the tool at work. The clip
is `www/demos/<tool name>.webm`, where the name is the one `ToolKind::name`
gives — and that is the whole registration: `toolhelp.js` probes for the file
the first time a tool is hovered and remembers whether it was there. A tool
without a clip shows the same card without a video, so the set can be filled
in one tool at a time and never has to be complete.

Clips are recorded in the editor itself:

```
make build_npaint     # record mode serves build/, so it has to exist
make record_npaint    # http://localhost:8791/?record=1
```

The panel that appears follows the toolbox: select a tool, frame the shot,
press Record, use it, press Stop, trim it, press Save. What is captured is the viewport canvas via
`captureStream`, not the screen — no permission prompt, no toolbar and no
cursor in the frame. The clip is `PUT` back to the record server, which
re-encodes it through ffmpeg to 480px wide VP9 and writes it into
`www/demos/`, and the card picks it up on the next hover without a reload.

**The trim.** A take is reviewed before it is kept: it loops in the panel over
a trim bar whose two handles set the in and out points, and those ride along
with the `PUT` as `?in=&out=` for ffmpeg to cut on. The cut belongs on the
server because the browser would have to re-encode to make one and the server
is re-encoding regardless — and because `MediaRecorder` writes a *stream*, so
its WebM carries no duration and `video.duration` comes back `Infinity`. The
preview works around that by seeking to an impossible time to make the browser
find the real end (`realDuration`), falling back to the wall-clock length of
the take. The server answers with `trimmed`, which is false when there was no
ffmpeg to cut with, so the panel can warn instead of leaving a clip that
quietly keeps the false start.

**The region.** Most tools act on a corner of the picture, and a clip of the
whole canvas would show that corner about six pixels across, so the dashed box
over the viewport says what to record: edges move it, the corner handle
resizes it, `Full` resets it, and it is remembered in `localStorage` between
takes. `captureStream` cannot crop, so the region is blitted into a scratch
canvas every frame and *that* canvas is captured — which is also where the
recording gets its size, capped at `MAX_CAPTURE_EDGE` so a big region on a
retina display does not feed the encoder frames the card will never show. The
box's middle is `pointer-events: none`: the canvas under it has to stay
paintable, or the shot could not be framed before it is recorded.

The clips ship with the page, so size is worth a thought — but not much of
one. A three- to five-second take at 60fps is 60-80 KB, so a clip for all
twenty-odd tools costs under 2 MB. Length is what drives that; nothing else
comes close, and 60fps costs about half again what 30 does. Keep a take to the
length of one gesture.

Hover is the whole interaction, so a device that cannot hover — a phone —
gets the button's plain `title` tooltip instead, and `attachToolHelp` returns
false to say so. Record mode is asked for by hand and `record.js` is not
fetched without `?record=1`, so none of this costs the deployed page anything
beyond `toolhelp.js`.

## Adding things

**A tool.** Add a file under `src/tools/`, implement `Tool` (`begin`,
`update`, `finish`, `cancel`, and `dirtied` if it can say what it touched —
see "What dirty means"), add a `ToolKind` variant with a name and a
history label, and an arm in `ToolKind::instantiate`. In `app.js`, add an
entry to `TOOLS` (name, label, shortcut key, icon path, hint); tools that
share a key cycle when it is pressed. The hover card and its demo clip come
for free from that entry — see "Tool demo clips". Say in `begin` whether the gesture
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

**A gradient shape.** A `GradientShape` variant in `gradient.rs` with a name,
a label and an arm in `fraction` — the rule from a position to how far along
the run a point is. The options bar lists them from `gradient_shape_names`,
so nothing changes in the page.

**A built-in palette or gradient.** A row in `BUILT_IN` in `www/palette.js`
or in `PRESETS` in `www/gradient.js`. Neither crosses into the engine, so
neither is more than its colours.

**A filter.** A `Kind` variant in `adjust.rs` as for any adjustment, plus an
arm in `Kind::is_spatial` and one in `Kind::apply_spatial` pointing at a
function in `filter.rs`; `Kind::map`, which has only a colour, answers with
that colour untouched. Read its neighbours through `Around` and add it to
`no_filter_depends_on_the_rectangle_it_was_asked_for`. Give its row in `www/adjust.js` `group: "filter"` so
it lists under Filter. Read "Filters" first: the clip-independence rule is
the one that is easy to break and hard to see broken.

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
context menus, so add to those rather than to one menu. `menuDefinitions()`
is the whole bar, and the command palette flattens it, so an item is
searchable — under its menu's name, with its shortcut — the moment it
exists. Nothing is listed twice; a command the palette should find is a
menu item, not an entry of its own.

**A brush tip.** A `BrushTip` variant in `brush.rs` with a name, a label
and an arm in `stamp` that writes coverage through `Raster::max_cover_in`
and stays inside the dab's square; say in `has_hardness` whether the slider
applies. The options bar lists the tips from `brush_tip_names`, so nothing
changes in the page.

**Layer properties, filters, adjustments.** Add the operation to `Document`
(pure, tested), wrap it in `Editor` through `structural(label, ..)` so it is
an undo step with a name in the history panel, expose it in `wasm.rs`, bind
a button in `app.js`. A new layer property also wants a line in `file.rs`,
on both sides, and a field in its round-trip test — and a reading in
`psd.rs`, or a line in its "knowingly left out" list saying why not. See
"Every feature has to survive a `.psd`".

**A kind of layer.** A `LayerKind` variant, an arm in `LayerKind::name`, and
then the compiler will walk you round the rest: `Layer::edit_refusal`,
`apply_mask`, `map_rasters`, `Document::blend_layer` and `add_layer_copy`,
a kind byte in `file.rs` on both sides, and a row in `KIND_BADGE` in
`app.js`. Decide early whether it draws pixels of its own
(`Layer::has_pixels`); the ones that do not — an adjustment layer, a group —
are the ones the rest of the engine has to be told about.

## Layer groups

The stack stays **one flat `Vec<Layer>`**. A group is a layer whose kind is
[`LayerKind::Group`]; its children are the contiguous run of layers *below*
its own row that carry its id in [`Layer::parent`]:

```text
  index 4   Sky            parent None
  index 3   Group "Tree"   parent None      <- the group's own row
  index 2     Leaves       parent Tree
  index 1     Trunk        parent Tree
  index 0   Background     parent None
```

This is the arrangement a `.psd` stores, which is why one imports without
anything being rearranged, and it is why the whole engine kept working: an
index still names one layer, and the order of the list is still the order
things composite in. Nothing outside `document.rs` had to learn about trees.

What *did* change is that an operation on a group means the whole subtree.
The vocabulary, all on `Document`:

- `subtree(i)` — what the layer takes with it: `i..i+1` for an ordinary
  layer, the children and the group's row for a group. **Delete, duplicate
  and drag all work on this, never on one index.**
- `children_of(i)`, `depth(i)`, `parent_index(i)`, `roots(parent)`.
- `split_point(i)` — the bottom of the top-level item containing `i`. The
  composite can only be cut between top-level items (half a group is not a
  picture), so a session's preview cache holds from here rather than from
  just below the layer it is changing.
- `roots_among(&[..])` — a panel selection reduced to what it really means:
  a group and something inside it is the group, once.
- `move_layer_to(from, to, Drop)` / `move_layers_to` — a drag. `Drop` is
  `Above`, `Below` or `Inside`, which are the three places the panel can
  show a drop at, and the engine works the indices out.
  `move_layers_would_change` says whether a drop would do anything at all —
  false for a refusal as well as for a drop back in place — so the panel
  draws a line only where letting go really moves something, and no undo
  step is left behind when it would not. `Editor::dragged_layers` decides
  what a drag carries (the whole panel selection, or one row) and *both*
  the line and the move go through it, so they cannot disagree.

**Do not hand-reason about which drops are no-ops.** Three sweeps in
`document.rs` do it for you, over four shapes of stack — flat, one group,
a group in a group, a group at the bottom — and they are what caught the
line promising moves the engine then refused:
`move_would_change_agrees_with_what_moving_actually_does`,
`dragging_several_layers_at_once_agrees_with_itself_too` and
`every_move_leaves_a_stack_that_is_still_a_document`. Add a shape to
`stacks()` rather than a one-off test.
- `nesting_is_sound` — the invariant, checked in `from_parts`, which is the
  only way a stack can arrive from outside.

**Compositing.** `composite_range` walks the items at one level; when it
reaches a group it hands the run below it to `composite_group`.

A **pass-through** group — Photoshop's default, and what an imported one
usually is — at full opacity with no mask is not a separate picture at all:
its children draw straight onto the backdrop, so an adjustment layer or a
Multiply inside one reaches the rest of the document exactly as it would
outside. That case allocates nothing. Held back by opacity or a mask, it is
that same drawing mixed back into the backdrop by how much of the group
shows.

**Any other blend mode isolates**: the children go onto a document-sized
buffer of their own and that is composited in, so the group's mode has
something to blend. That buffer is what a group costs, and only these two
cases pay it — worth remembering before nesting groups ten deep on a 4K
canvas.

**The panel's selection.** Shift- and Ctrl-clicking build up a set of rows
that Group, Delete, Duplicate and a drag then act on together. It lives on
`Editor` as `selected: Vec<LayerId>`, *not* on the document: which rows are
picked out is no more part of the picture than the marching ants are, and
an undo has no business putting it back. Ids that are no longer in the
document are dropped when the set is read, so nothing has to prune it as
layers come and go. Clicking past the rows picks out *nothing*: `nothing_selected`, which is
the difference between "the set is empty, so it means the active layer" —
the ordinary state, one row picked out — and "the user picked out nothing
at all". While it holds, no row is highlighted and Group, Delete and
Duplicate are refused because they have no subject. The document still has
an active layer, because the tools have to have something to paint on, so
painting goes on working; that is the one place this differs from
Photoshop, where a brush with no layer selected refuses.

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
* **Text layers** are smart objects with a `text` — see "Text".
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
- The stack is **flat even with groups in it**: a group's children are the
  run of layers below its own row that name it as their `parent`. An
  operation that takes a layer somewhere — delete, duplicate, drag — takes
  its whole `Document::subtree`, and one that splits the stack may only do
  so at a `Document::split_point`. See "Layer groups".
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

No polygonal lasso — the freehand one is there, and a polygon wants clicks
that accumulate across gestures, which the `begin`/`update`/`finish` model
has no place for yet; no `.psd` *writer*, and the reader's own limits are in
"Photoshop files"; a group's knockout and "blend interior" settings are not
read, and a group is either pass-through or isolated with nothing in
between; a layer can be in only one group and there is no way to move a
group's contents without moving the group;
no clipping of an adjustment layer to the layer below;
text has one style per layer (no mixed runs), no wrapping to a box, no
kerning or baseline shift, and is set in whatever the browser has for the
font's name unless the file is loaded; a loaded font file is not kept in the
document; the brush tips have no angle or spacing controls, and no tip of the
user's own; the dither's error-diffusion patterns are a serial pass over
every pixel, so as a live adjustment *layer* on a very large canvas they cost
noticeably more per composite than the ordered ones; pixel layers are always
document-sized (a transform resamples into the canvas, and what leaves it is
lost — a smart object keeps what leaves, since it re-renders from its
source), which with four bytes a pixel is also what `MAX_PIXELS` is really
about; a mask is not linked to its layer (moving or transforming the pixels
leaves the mask where it was; the canvas operations and the layer flips do
carry it along); a smart object's contents cannot be opened for editing, only
replaced; an adjustment layer's preview is composited at full resolution
however far out the canvas is zoomed, where a 4K document fitted to a window
needs a sixteenth of those pixels (1.3 ms rather than 23 ms —
`examples/adjbench.rs` has the measurements); an adjustment is aimed at one
channel at a time, where Photoshop's Levels and Curves keep a separate set of
numbers per channel behind one dialog — two adjustment layers is the answer
here.

Neither the gradient in hand nor the palette is saved in the document — they
are the page's, so a `.npaint` opened on another machine comes back without
them, and a `.psd`'s own swatches and gradient presets are not read; the
palette is matched in plain RGB distance rather than a perceptual one, which
shows most on a palette of near-greys; a `.gpl`'s colour names are dropped on
the way in, so a round trip through the panel loses them; there is no
gradient *layer*, only the pixels a drag lays down.

Bigger than any of those, and worth saying plainly: everything is 8-bit
straight sRGB. There is no 16-bit, no colour management, no profile handling
and no CMYK, which is what puts photographic retouching and anything bound
for print out of reach. Lifting it would touch `Rgba`, `Raster`, `blend`,
the filters and the file format at once, so it is a decision rather than a
backlog item.
