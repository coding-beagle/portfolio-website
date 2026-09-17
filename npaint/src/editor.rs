//! The editor: one document, one selection, one viewport, one history and
//! the current tool, with every operation the page can ask for.
//!
//! This is the whole application minus the browser. Pointer positions come in
//! as *screen* coordinates and are mapped through the viewport here, so the
//! page hands events straight through. Every mutating method records undo
//! history itself; the page never sees a snapshot.

use crate::adjust::{auto_levels, Adjustment, AdjustmentError};
use crate::autoselect::{mask_from_matte, select_subject, ColorSet};
use crate::blend::BlendMode;
use crate::checker;
use crate::color::Rgba;
use crate::document::{canvas_turn, Document, DocumentError, Drop};
use crate::file::{self, FileError};
use crate::geometry::{Point, Rect};
use crate::history::{Aside, History, Snapshot};
use crate::layer::{keep_alpha, EditRefusal, Layer, LayerId, Offscreen, SmartObject, Target};
use crate::mask::{Mask, SelectMode};
use crate::raster::Raster;
use crate::selection::Selection;
use crate::snap::Snap;
use crate::text::TextObject;
use crate::tools::movetool::{drag_offset, split_for_move, Split};
use crate::tools::{
    sample_color, Gesture, PointerEvent, SymmetryFrame, SymmetryHit, Tool, ToolContext, ToolKind,
    ToolSettings,
};
use crate::transform::{Affine, Hit, Projective, TransformInfo, TransformSession};
use crate::viewport::Viewport;

/// How close to a transform handle counts as grabbing it, in screen pixels.
pub const HANDLE_GRAB_PX: f64 = 8.0;

/// How far out from the crossing point the arm that turns the symmetry axes
/// sits, in screen pixels: far enough that the turn is not all wrist, near
/// enough to stay on screen at any zoom.
pub const ROTATE_ARM_PX: f64 = 64.0;

/// The angles the symmetry axes settle on while snapping is on, in degrees.
pub const SYMMETRY_ANGLE_STEP: f64 = 15.0;

/// An angle held to [`SYMMETRY_ANGLE_STEP`].
fn snap_angle(radians: f64) -> f64 {
    let step = SYMMETRY_ANGLE_STEP.to_radians();
    (radians / step).round() * step
}

/// The most a preview may be shrunk, however far out the canvas is zoomed.
const MAX_PREVIEW_STEP: u32 = 16;

/// How coarsely the visible rectangle is rounded, in document pixels. A
/// full-size preview is worked out for whole tiles of this size, so that
/// panning asks for a fresh pass when it crosses a tile edge rather than on
/// every frame. See [`Editor::visible_rect`].
const PREVIEW_TILE: i32 = 64;

/// The composite of everything below the layer a session is changing, kept
/// for as long as the session lasts. See [`Editor::preview_base`].
struct PreviewBase {
    /// Where the composite stops. Layers from here up are still composited
    /// on every preview.
    ///
    /// This is a [`Document::split_point`], not the edited layer: the stack
    /// can only be cut between top-level items, so a layer inside a group
    /// holds from the bottom of the outermost group it is in. The two are
    /// the same index whenever the edited layer is not in a group.
    index: usize,
    /// The layer being edited, which is at or above `index`.
    edited: usize,
    below: Raster,
    /// The same thing at a fraction of the size, when the canvas is zoomed
    /// far enough out that the screen cannot tell.
    small: Option<SmallPreview>,
}

impl PreviewBase {
    /// Whether this still describes the document. A session is cancelled by
    /// anything that could make it stale, so this is a belt-and-braces
    /// check rather than the thing keeping it honest.
    fn fits(&self, document: &Document) -> bool {
        self.index <= document.layers().len()
            && self.below.width() == document.width()
            && self.below.height() == document.height()
    }
}

/// The document reduced `step`-to-one, so that a dialog's slider composites
/// the pixels the screen is actually showing rather than sixteen times as
/// many.
///
/// It is built once when the session opens (and again if the zoom changes
/// under it), and holds everything below the edited layer flattened into
/// one, then the edited layer and whatever is above it, all reduced. The
/// edited layer is therefore always at index 1.
///
/// What you see is the adjustment applied to a reduced picture, which is not
/// quite a reduction of the adjusted picture — for a curve or a levels pull
/// the difference is invisible, for a threshold it is not. The full-size
/// pass on commit is what the document keeps.
struct SmallPreview {
    step: u32,
    document: Document,
    /// The selection at the same scale, for the adjustments that are held
    /// to one.
    selection: Selection,
    /// The edited surface before the adjustment, at the same scale.
    base: Raster,
    /// Which layer of the reduced document is the edited one. [`SMALL_EDITED`]
    /// when nothing was kept above the cut but the layer itself, higher when
    /// the layer is inside a group and the group came along with it.
    edited: usize,
}

/// Where the first kept layer sits in a [`SmallPreview`]: above the one
/// layer everything below it was flattened into.
const SMALL_EDITED: usize = 1;

/// A move-tool drag shown on the reduced copy while the canvas is zoomed
/// out. The pixels are split once, at that scale, and every pointer event
/// lays them down again where the drag has got to; the document itself is
/// moved once, by the tool, when the pointer comes up.
///
/// This is for the drag that has no rectangle to be clipped to — a layer
/// the size of the canvas, where every pixel changes. With a selection the
/// moving pixels are only the selected ones, whose rectangle is already
/// small, so that drag is shown on the document as usual.
struct ReducedMove {
    /// Where the drag began, in document pixels — the same space the tool
    /// measures its own gesture in, so that the offset previewed here and
    /// the one the tool settles on are worked out from the same numbers
    /// even if the view is panned or zoomed mid-drag.
    start: Point,
    step: u32,
    /// Where the drag has got to, so an event that lands on the same whole
    /// pixel redraws nothing.
    offset: (i32, i32),
    /// The moving pixels and the rest of the surface, at the reduced scale.
    moving: Raster,
    stationary: Raster,
    /// The moving pixels' extent in the document, at full size: snapping
    /// pulls the same edges onto the same guides as the tool itself will.
    bounds: Option<Rect>,
}

/// A drag shown on the reduced copy for a tool that repaints its whole clip
/// on every pointer event. The document itself is not touched until the
/// pointer comes up, when the same gesture is handed to the tool once at
/// full size. See [`ToolKind::previews_on_the_reduced_copy`].
struct ReducedGesture {
    /// Where the drag began, in full-size document pixels, so that the
    /// replay on release starts exactly where the preview did.
    start: Point,
    step: u32,
    /// The edited layer's reduced pixels as the drag began: what a ragged
    /// selection and an alpha lock hold the preview against, the way
    /// [`Editor::gesture_base`] does at full size.
    base: Raster,
}

/// A drag of the symmetry gizmo: what it has hold of, and enough to put the
/// axes back where they were, both for the pointer's grip on them and for
/// the one undo step the whole drag becomes.
#[derive(Clone, Copy, Debug)]
struct SymmetryDrag {
    hit: SymmetryHit,
    /// The axes as the drag began.
    before: SymmetryFrame,
    /// Where the crossing point is from the pointer, in frame coordinates,
    /// so a grab near the edge of a handle does not snap it to the pointer.
    offset: Point,
    /// The angle from the crossing point to the pointer when a turn began,
    /// taken off every angle since.
    arm: f64,
}

/// A live edit that the page previews and then commits or cancels: an
/// adjustment dialog, an adjustment layer's dialog, a free transform of the
/// active layer, or a free transform of the selection outline. Only one can
/// be open, and it takes over the pointer while it is.
enum Session {
    /// An adjustment baked into the active surface — the pixels, or the
    /// mask. `last` is what was previewed most recently: while the preview
    /// is running at a reduced size the full-size surface is not touched at
    /// all, so commit works it out from here.
    Adjust { base: Raster, clip: Rect, last: Option<Adjustment> },
    /// The adjustment *of an adjustment layer* being changed in place.
    AdjustmentLayer { before: Adjustment },
    Transform(TransformSession),
    /// The selection outline being moved, scaled or turned, with the pixels
    /// left alone; `before` is what cancelling puts back.
    TransformSelection { session: TransformSession, before: Selection },
    /// A text layer being typed into — the active layer, set again by the
    /// page on every keystroke — with what cancelling puts back.
    Text { before: TextBefore },
}

/// What was there before a text session began.
// One of these exists at a time and is moved twice; the size of the
// larger variant is not worth a box.
#[allow(clippy::large_enum_variant)]
enum TextBefore {
    /// The layer is new: the whole stack without it.
    New(Document),
    /// An existing text layer: the layer as it was.
    Edit(Layer),
}

/// What an adjustment or transform session reported when it started.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionError {
    /// Another session is open; commit or cancel it first.
    Busy,
    /// There are no pixels to transform.
    Empty,
    /// The active layer is hidden.
    Hidden,
    /// The active surface cannot be edited: a smart object's pixels, an
    /// adjustment layer's, or a locked layer.
    Uneditable(EditRefusal),
    /// Editing an adjustment layer's settings needs an adjustment layer.
    NotAdjustmentLayer,
    /// Transforming the selection needs a selection.
    NoSelection,
    /// Editing text needs a text layer.
    NotTextLayer,
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SessionError::Busy => f.write_str("finish the current adjustment or transform first"),
            SessionError::Empty => f.write_str("there is nothing on this layer to transform"),
            SessionError::Hidden => f.write_str("the active layer is hidden"),
            SessionError::Uneditable(why) => why.fmt(f),
            SessionError::NotAdjustmentLayer => f.write_str("this is not an adjustment layer"),
            SessionError::NoSelection => f.write_str("select something first"),
            SessionError::NotTextLayer => f.write_str("this is not a text layer"),
        }
    }
}

impl std::error::Error for SessionError {}

pub const HISTORY_LIMIT: usize = 40;

/// The largest canvas the editor will make. A layer is four bytes a pixel and
/// every layer is document-sized, so a careless drag of the canvas edge could
/// otherwise ask for tens of gigabytes and take the whole tab down with it.
pub const MAX_SIDE: u32 = 16_384;
pub const MAX_PIXELS: u64 = 40_000_000;

/// Whether a canvas of this size is one the editor will make.
pub fn canvas_fits(width: u32, height: u32) -> bool {
    width > 0
        && height > 0
        && width <= MAX_SIDE
        && height <= MAX_SIDE
        && u64::from(width) * u64::from(height) <= MAX_PIXELS
}

/// What Copy took: a picture, and where on the canvas it came from, so a
/// paste can put it back in the same place.
#[derive(Clone, Debug, PartialEq)]
pub struct Clip {
    pub raster: Raster,
    pub x: i32,
    pub y: i32,
    /// The whole layer, when Copy took all of one that renders from a
    /// source — a smart object, or the text layer that is one. Paste puts
    /// that layer back rather than its rendering, so copying a smart object
    /// and pasting it gives a smart object again.
    pub layer: Option<Layer>,
}

pub struct Editor {
    document: Document,
    selection: Selection,
    /// The layers the panel has selected, beyond the active one — what a
    /// Shift- or Ctrl-click builds up, and what Group, Delete and a drag
    /// then act on together.
    ///
    /// They are ids rather than indices, and they live here rather than in
    /// the document: which rows are picked out in the panel is no more part
    /// of the picture than the marching ants are, and an undo has no
    /// business putting a selection of rows back. Ids that are no longer in
    /// the document are dropped when the set is read, so nothing has to
    /// prune it as layers come and go.
    ///
    /// An *empty* set still means the active layer, which is the ordinary
    /// state: one row picked out. `nothing_selected` is the other thing
    /// empty could mean — the user clicked past the rows and picked out
    /// nothing at all.
    selected: Vec<LayerId>,
    /// Set when the panel has no row picked out. The document still has an
    /// active layer, because the tools have to have something to paint on;
    /// what this says is that no *panel* operation has a subject, so Group,
    /// Delete and Duplicate are refused until a row is clicked.
    nothing_selected: bool,
    viewport: Viewport,
    history: History,
    settings: ToolSettings,
    tool: Box<dyn Tool>,
    /// Set while a pointer gesture is in progress.
    gesture: Option<Gesture>,
    session: Option<Session>,
    /// What the layers below the one a session is changing composite to.
    ///
    /// Dragging a slider changes one layer over and over while nothing
    /// under it can move — any layer operation, undo or new document
    /// cancels the session first — so those layers are composited once and
    /// every tick starts from the answer. On a 3840x2160 document with two
    /// layers under a levels adjustment layer that is 54 ms a tick down to
    /// 25 ms, and it is the whole canvas every tick: an adjustment has no
    /// dirty rectangle to save it.
    preview_base: Option<PreviewBase>,
    /// The document rectangle the full-size preview has been worked out for
    /// — everywhere else the picture is still the one the session started
    /// from, and the frame on screen agrees.
    ///
    /// A filter costs its area, and at 1:1 most of a large document is off
    /// screen: there is no reason to blur twenty-four million pixels so that
    /// two million can be looked at. `None` while no full-size preview is in
    /// force, either because there is no session or because a reduced one is
    /// running, in which case coming back to full size has to composite
    /// everything again.
    previewed: Option<Rect>,
    /// The active layer before a transform began, restored on cancel and
    /// used as the undo snapshot on commit. The whole layer, because a
    /// smart object's transform changes its placement as well as its pixels.
    transform_base: Option<Layer>,
    /// Whether the open transform is the move tool dragging a smart object
    /// by its placement: it commits itself when the pointer comes up, as a
    /// step called Move.
    moving_smart: bool,
    /// Where the open transform's pixels were drawn last time, so that the
    /// next preview redraws only there and where they have gone. Without it
    /// every drag of a text layer recomposites the whole document.
    transform_shown: Option<Rect>,
    /// The open transform at the reduced scale, while the canvas is zoomed
    /// out far enough that the screen cannot tell: what the drag draws,
    /// leaving the document itself untouched until the session commits.
    /// `None` when the drag is being shown at full size.
    transform_small: Option<TransformSession>,
    /// The move tool's drag, while it is being shown on the reduced copy.
    reduced_move: Option<ReducedMove>,
    /// A whole-clip tool's drag, while it is being shown on the reduced copy.
    reduced_gesture: Option<ReducedGesture>,
    /// The pen pressure the next pointer event carries. See
    /// [`Editor::set_pressure`].
    pressure: f64,
    /// The selection and guides as they were when a gesture that does not
    /// edit pixels began, so that a selection tool's drag is one undo step.
    gesture_aside: Option<Aside>,
    /// The active layer as it was when the current gesture began, kept when
    /// the selection is a mask or the layer's transparency is locked:
    /// painting clips to a rectangle, so what holds a ragged selection — or
    /// keeps the holes — is putting these pixels back afterwards.
    gesture_base: Option<Raster>,
    /// What the last Copy or Cut took. Outlives the document, so a picture
    /// can be carried into a new one.
    clipboard: Option<Clip>,
    /// The symmetry gizmo's drag, while one is under way.
    symmetry_drag: Option<SymmetryDrag>,
    /// Whether the composite the page last rendered is stale.
/// The part of the composite that has changed since the page last drew,
    /// or `None` when nothing has. A rectangle rather than a flag because a
    /// brush dab on a 4K canvas changes a few hundred pixels and there is no
    /// reason to recomposite and re-upload eight million: see
    /// [`Document::composite_into`].
    dirty: Option<Rect>,
}

impl Editor {
    pub fn new(width: u32, height: u32, background: Rgba) -> Editor {
        Editor {
            document: Document::new(width, height, background),
            selection: Selection::None,
            selected: Vec::new(),
            nothing_selected: false,
            viewport: Viewport::default(),
            history: History::new(HISTORY_LIMIT),
            settings: ToolSettings::default(),
            tool: ToolKind::Brush.instantiate(),
            gesture: None,
            session: None,
            preview_base: None,
            previewed: None,
            transform_base: None,
            moving_smart: false,
            transform_shown: None,
            transform_small: None,
            reduced_move: None,
            reduced_gesture: None,
            pressure: 1.0,
            gesture_base: None,
            gesture_aside: None,
            clipboard: None,
            symmetry_drag: None,
            dirty: Some(Rect::new(0, 0, width as i32, height as i32)),
        }
    }

    /// Replaces the document with a fresh one. History and selection go with
    /// the old document; the tool and its settings stay.
    pub fn new_document(&mut self, width: u32, height: u32, background: Rgba) {
        self.replace_document(Document::new(width, height, background));
    }

    /// Replaces the document with an opened image, as [`Editor::new_document`]
    /// does with a blank one. The picture arrives as a smart object, so
    /// scaling and rotating it never grinds away its own pixels; Layer >
    /// Rasterize Layer turns it into plain pixels to paint on.
    pub fn open_image(&mut self, name: &str, raster: Raster) {
        self.replace_document(Document::from_smart_object(name, raster));
    }

    fn replace_document(&mut self, document: Document) {
        self.cancel_session();
        self.abort_gesture();
        self.document = document;
        self.selection = Selection::None;
        self.history.clear();
        self.touch_all();
    }

    // ---- Files ------------------------------------------------------------------

    /// The whole document — every layer, mask, smart object and setting —
    /// as NPaint's own file, and from now on the document counts as saved.
    pub fn save_document(&mut self) -> Vec<u8> {
        self.cancel_session();
        self.abort_gesture();
        self.history.mark_saved();
        file::save(&self.document, &self.settings.guides, self.settings.symmetry.frame)
    }

    /// A number that changes whenever the document does, and comes back to
    /// what it was on an undo — [`crate::history::History::state_id`]. The
    /// page's autosave asks for it to tell whether there is anything new
    /// worth keeping.
    pub fn document_state(&self) -> u64 {
        self.history.state_id()
    }

    /// Says the document has never been saved, whatever its history holds:
    /// what the page calls after restoring a recovered document, so that
    /// the close prompt still fires for work that is only in the browser's
    /// store.
    pub fn mark_unsaved(&mut self) {
        self.history.mark_unsaved();
    }

    /// The same bytes, but the document goes on counting as unsaved.
    ///
    /// This is what the page's autosave writes to the browser's own store:
    /// a recovery copy is not a save, and taking it must not clear the
    /// "you have unsaved work" that the close prompt and the modified mark
    /// depend on. It still settles any open session first, so what is
    /// written is a document rather than a preview.
    pub fn snapshot_document(&mut self) -> Vec<u8> {
        self.cancel_session();
        self.abort_gesture();
        file::save(&self.document, &self.settings.guides, self.settings.symmetry.frame)
    }

    /// The document as a Photoshop file, for taking the work somewhere
    /// else.
    ///
    /// This is an export and not a save: a `.psd` cannot carry a smart
    /// object's source, an adjustment layer or the pixels a layer keeps off
    /// the canvas, so the document goes on counting as modified and
    /// `.npaint` stays the format that keeps everything.
    /// [`Editor::psd_export_note`] is what the user should be told first.
    pub fn export_psd(&mut self) -> Vec<u8> {
        self.cancel_session();
        self.abort_gesture();
        crate::psd::save(&self.document).bytes
    }

    /// What a `.psd` of this document would not hold, if anything.
    pub fn psd_export_note(&self) -> Option<String> {
        crate::psd::export_note(&self.document)
    }

    /// Opens a Photoshop file, replacing the document.
    ///
    /// Returns what the user should be told about how it got here, if
    /// anything: [`crate::psd`] takes the common shape of the format and is
    /// deliberate about saying what it approximated. A `.psd` carries no
    /// guides this reader keeps, so the old ones go.
    pub fn open_psd(&mut self, bytes: &[u8]) -> Result<Option<String>, crate::psd::PsdError> {
        let import = crate::psd::load(bytes)?;
        self.replace_document(import.document);
        self.settings.guides.h.clear();
        self.settings.guides.v.clear();
        Ok(import.note)
    }

    /// Opens an NPaint file, replacing the document and the guides.
    pub fn open_document(&mut self, bytes: &[u8]) -> Result<(), FileError> {
        let (document, guides, symmetry) = file::load(bytes)?;
        self.replace_document(document);
        self.settings.guides.h = guides.h;
        self.settings.guides.v = guides.v;
        self.settings.symmetry.frame = symmetry;
        Ok(())
    }

    /// Whether the document differs from what was last saved or opened.
    pub fn is_modified(&self) -> bool {
        self.history.is_modified()
    }

    // ---- Read access -------------------------------------------------------

    pub fn document(&self) -> &Document {
        &self.document
    }

    pub fn selection(&self) -> &Selection {
        &self.selection
    }

    pub fn viewport(&self) -> &Viewport {
        &self.viewport
    }

    pub fn settings(&self) -> &ToolSettings {
        &self.settings
    }

    pub fn settings_mut(&mut self) -> &mut ToolSettings {
        &mut self.settings
    }

    pub fn tool(&self) -> ToolKind {
        self.tool.kind()
    }

    /// The rubber band the current gesture wants drawn over the canvas, as
    /// `[x, y, w, h]` in screen pixels. Only the zoom marquee has one.
    pub fn tool_overlay(&self) -> Option<[f64; 4]> {
        self.tool.overlay()
    }

    pub fn can_undo(&self) -> bool {
        self.history.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.history.can_redo()
    }

    pub fn is_gesturing(&self) -> bool {
        self.gesture.is_some()
    }

    /// Whether the document has changed since the last [`Editor::take_dirty`].
    pub fn is_dirty(&self) -> bool {
        self.dirty.is_some()
    }

    /// Notes that `rect` of the composite has changed. Reporting more than
    /// actually changed only costs time; reporting less leaves stale pixels
    /// on screen, so anything unsure says [`Editor::touch_all`].
    fn touch(&mut self, rect: Rect) {
        let rect = rect.intersect(&self.document.bounds());
        if rect.is_empty() {
            return;
        }
        self.dirty = Some(match self.dirty {
            Some(had) => had.union(&rect),
            None => rect,
        });
    }

    /// The whole composite has changed — a layer came or went, the stack was
    /// reordered, an undo landed.
    fn touch_all(&mut self) {
        self.dirty = Some(self.document.bounds());
    }

    /// Composites everything below `index` and keeps it for the session, so
    /// that the previews to come start from there. Only worth it when there
    /// is something below to save.
    fn hold_preview_base(&mut self, edited: usize) {
        let index = self.document.split_point(edited);
        let mut below = Raster::new(self.document.width(), self.document.height());
        let all = self.document.bounds();
        self.document.composite_below(index, &mut below, &all);
        self.preview_base = Some(PreviewBase { index, edited, below, small: None });
        // A freshly built reduced copy has never been composited, and the
        // page's preview frame still holds whatever the *last* session drew
        // there. Saying the document has changed is what makes the first
        // frame of this session its own picture rather than that one.
        if self.refresh_small_preview() {
            self.touch_all();
        }
    }

    /// Whether a drag is being shown on the reduced copy rather than on the
    /// document itself.
    fn drag_on_the_copy(&self) -> bool {
        self.transform_small.is_some() || self.reduced_move.is_some() || self.reduced_gesture.is_some()
    }

    /// Holds a reduced copy of the document for a transform to draw its drag
    /// on, when the canvas is zoomed out far enough that the screen cannot
    /// tell. At a step of one there is nothing to save, and the drag is
    /// shown on the document itself as usual.
    fn hold_reduced_drag(&mut self, session: &TransformSession) {
        if self.preview_step() == 1 {
            return;
        }
        self.hold_preview_base(self.document.active_index());
        match self.preview_base.as_ref().and_then(|b| b.small.as_ref()) {
            Some(small) => self.transform_small = Some(session.reduced(small.step)),
            // No reduced copy could be built, so there is nothing to draw on
            // and no reason to keep the base either.
            None => self.preview_base = None,
        }
    }

    /// Splits the reduced copy's pixels for a move-tool drag to shift, or
    /// `None` when no reduced copy could be held.
    fn hold_reduced_move(&mut self, start: Point) -> Option<ReducedMove> {
        // The reduced copy is the canvas and no more, so a layer with
        // pixels kept outside it has nowhere to preview them coming back
        // in. Such a drag runs on the document itself instead.
        if self.document.active_layer().offscreen.is_some() {
            return None;
        }
        let bounds = self.document.active_surface().content_bounds();
        self.hold_preview_base(self.document.active_index());
        let Some(small) = self.preview_base.as_ref().and_then(|b| b.small.as_ref()) else {
            self.preview_base = None;
            return None;
        };
        let (moving, stationary) = small.selection.split(small.document.active_surface());
        Some(ReducedMove { start, step: small.step, offset: (0, 0), moving, stationary, bounds })
    }

    /// Lays the moving pixels down on the reduced copy where the drag has
    /// got to. The offset is worked out at full size, from the same function
    /// the tool itself uses, so that what is previewed is where the pixels
    /// will land.
    fn move_on_the_copy(&mut self, now: Point) -> bool {
        let Some(&ReducedMove { start, step, offset, bounds, .. }) = self.reduced_move.as_ref() else {
            return false;
        };
        let snap = Snap::new(&self.settings.guides, self.document.bounds(), self.viewport.zoom());
        let (dx, dy) = drag_offset(start, now, bounds, snap.as_ref());
        if (dx, dy) == offset {
            return false;
        }
        {
            let Some(small) = self.preview_base.as_mut().and_then(|b| b.small.as_mut()) else { return false };
            let Some(drag) = self.reduced_move.as_mut() else { return false };
            drag.offset = (dx, dy);
            let step = step as i32;
            let clip = small.document.bounds();
            let surface = small.document.active_surface_mut();
            surface.copy_from(&drag.stationary, &clip);
            surface.merge_translated_in(&drag.moving, dx / step, dy / step, &clip);
        }
        self.touch_all();
        true
    }

    /// Starts a whole-clip tool's drag on the reduced copy. False when no
    /// reduced copy could be held, and the drag runs on the document as usual.
    fn hold_reduced_gesture(&mut self, ev: PointerEvent) -> bool {
        self.hold_preview_base(self.document.active_index());
        let Some(small) = self.preview_base.as_ref().and_then(|b| b.small.as_ref()) else {
            self.preview_base = None;
            return false;
        };
        let base = small.document.active_surface().clone();
        self.reduced_gesture = Some(ReducedGesture { start: ev.pos, step: small.step, base });
        self.draw_on_the_copy(ev, true);
        true
    }

    /// Hands the tool the reduced copy and the event in its coordinates, so
    /// that a gradient at a quarter zoom fills a sixteenth of the pixels.
    /// `begin` opens the gesture there; otherwise it is carried on.
    fn draw_on_the_copy(&mut self, ev: PointerEvent, begin: bool) -> bool {
        let Some(drag) = self.reduced_gesture.as_ref() else { return false };
        let scale = f64::from(drag.step);
        let base = &drag.base;
        let confined = self.tool.kind().confined_to_selection();
        let Some(small) = self.preview_base.as_mut().and_then(|b| b.small.as_mut()) else { return false };
        let SmallPreview { document, selection, .. } = small;
        let scaled = PointerEvent { pos: Point::new(ev.pos.x / scale, ev.pos.y / scale), ..ev };
        let mut ctx = ToolContext {
            document,
            selection,
            viewport: &mut self.viewport,
            settings: &mut self.settings,
        };
        let changed = if begin {
            self.tool.begin(&mut ctx, scaled) == Gesture::EditsActiveLayer
        } else {
            self.tool.update(&mut ctx, scaled)
        };
        if !changed {
            return false;
        }
        // The same limits the document itself would keep: outside a mask
        // selection, and the transparency of an alpha-locked layer, are the
        // pixels the drag began with. See [`Editor::enforce_limits`].
        let keeps_alpha = document.active_layer().keeps_alpha();
        if confined && (selection.needs_base() || keeps_alpha) {
            let all = document.bounds();
            let raster = document.active_surface_mut();
            selection.apply(raster, base, &all);
            if keeps_alpha {
                keep_alpha(raster, base, &all);
            }
        }
        self.touch_all();
        true
    }

    /// How much a preview may be shrunk at the current zoom without the
    /// screen being able to tell: the largest power of two that still puts
    /// at least one preview pixel behind every screen pixel. This is the
    /// same ladder the page's half-size copies of the frame go down, so a
    /// preview lands exactly on one of their sizes.
    pub fn preview_step(&self) -> u32 {
        let zoom = self.viewport.zoom();
        let mut step = 1;
        while step < MAX_PREVIEW_STEP && zoom <= 0.5 / f64::from(step) {
            step *= 2;
        }
        step
    }

    /// Builds (or rebuilds) the reduced document the previews composite,
    /// when the zoom asks for one. Returns whether it built one just now —
    /// a rebuild starts from the document's own pixels, so a session that
    /// has been previewing into the reduced copy has to put its work back.
    /// Cheap to call: it does nothing if the step has not changed.
    fn refresh_small_preview(&mut self) -> bool {
        let step = self.preview_step();
        let Some(base) = self.preview_base.as_ref() else { return false };
        if base.small.as_ref().is_some_and(|s| s.step == step) {
            return false;
        }
        // A drag already showing on the copy keeps the scale it started at:
        // rebuilding would take the document's own pixels, which are still
        // where the drag began, and what draws on it is at the old scale.
        // Zooming mid-drag is rare and settles on the next one.
        if self.drag_on_the_copy() {
            return false;
        }
        if step == 1 {
            if let Some(base) = self.preview_base.as_mut() {
                base.small = None;
            }
            return false;
        }
        let index = base.index;
        // The synthetic "below" layer takes slot 0, so everything kept
        // slides up by one.
        let edited = SMALL_EDITED + (base.edited - index);
        let (w, h) = (self.document.width().div_ceil(step), self.document.height().div_ceil(step));
        // Everything below the edited layer, already flattened, as one
        // layer; then the edited layer and anything above it.
        // Ids are handed out from 1, so 0 is free for the synthetic layer
        // everything below has been flattened into.
        let mut layers = vec![Layer::new(LayerId(0), "below", base.below.downscaled(step))];
        layers.extend(self.document.layers()[index..].iter().map(|l| {
            let mut small = l.clone();
            small.raster = l.raster.downscaled(step);
            small.mask = l.mask.as_ref().map(|m| m.downscaled(step));
            small
        }));
        let Some(mut document) = Document::from_parts(w, h, layers, edited) else { return false };
        document.set_active(edited).expect("the edited layer is there");
        let selection = self.selection.downscaled(step);
        let base_surface = document.active_surface().clone();
        if let Some(base) = self.preview_base.as_mut() {
            base.small = Some(SmallPreview { step, document, selection, base: base_surface, edited });
        }
        true
    }

    /// The document rectangle the canvas is showing, rounded out to whole
    /// [`PREVIEW_TILE`]s so that a pan of a pixel does not ask for a fresh
    /// preview pass. The whole document when the page has not said how big
    /// its window is, which is the tests and the first frame.
    fn visible_rect(&self) -> Rect {
        let bounds = self.document.bounds();
        let view = self.viewport.view();
        if view.is_empty() {
            return bounds;
        }
        let top_left = self.viewport.screen_to_doc(Point::new(0.0, 0.0));
        let bottom_right = self.viewport.screen_to_doc(Point::new(view.w, view.h));
        // Brought inside the document before the rounding, so that a canvas
        // panned a long way off the screen cannot overflow the arithmetic.
        let inside = |v: f64, limit: i32| v.clamp(0.0, f64::from(limit)) as i32;
        let tile_below = |v: i32| v.div_euclid(PREVIEW_TILE) * PREVIEW_TILE;
        let x = tile_below(inside(top_left.x, bounds.w));
        let y = tile_below(inside(top_left.y, bounds.h));
        let right = tile_below(inside(bottom_right.x, bounds.w)) + PREVIEW_TILE;
        let bottom = tile_below(inside(bottom_right.y, bounds.h)) + PREVIEW_TILE;
        Rect::new(x, y, right - x, bottom - y).intersect(&bounds)
    }

    /// Brings the full-size preview up to date after the view has moved
    /// under it.
    ///
    /// A preview is only worked out where the canvas can show it, so a pan
    /// or a zoom uncovers pixels the current settings have never been
    /// applied to. Cheap to call: it does nothing while the visible
    /// rectangle is still the one the last pass covered.
    fn refresh_full_preview(&mut self) {
        // The sessions that preview through an adjustment. The others draw
        // at full size whatever the zoom and keep their own dirty rectangles.
        if !matches!(self.session, Some(Session::Adjust { .. } | Session::AdjustmentLayer { .. })) {
            return;
        }
        if self.preview_base.as_ref().is_some_and(|b| b.small.is_some()) {
            // A reduced preview is running: the page is not drawing the
            // full-size frame at all, and it is left behind entirely.
            self.previewed = None;
            return;
        }
        let shown = self.visible_rect();
        if self.previewed == Some(shown) {
            return;
        }
        // Coming back from a reduced preview the frame is whatever the last
        // full render left, so all of it has to be composited again.
        let stale = shown.union(&self.previewed.unwrap_or_else(|| self.document.bounds()));
        self.previewed = Some(shown);
        // An adjustment layer applies at composite time, so for that one the
        // rectangle above is the whole of the catching up.
        if let Some(Session::Adjust { base, clip, last: Some(adjustment) }) = &self.session {
            let (base, adjustment) = (base.clone(), adjustment.clone());
            let clip = clip.intersect(&shown);
            let mut out = base.clone();
            adjustment.apply(&mut out, &clip);
            self.selection.apply(&mut out, &base, &clip);
            *self.document.active_surface_mut() = out;
        }
        self.touch(stale);
    }

    /// The size of the reduced preview, as `[width, height, step]`, when one
    /// is in force. The page draws it stretched over the canvas.
    pub fn preview_size(&self) -> Option<[u32; 3]> {
        let small = self.preview_base.as_ref()?.small.as_ref()?;
        Some([small.document.width(), small.document.height(), small.step])
    }

    /// Composites the reduced preview into `out` if there is one and
    /// anything has changed, and says whether a reduced preview is in force
    /// at all — which is what the page needs to know to keep drawing it.
    pub fn preview_into(&mut self, out: &mut Raster) -> Option<bool> {
        if self.refresh_small_preview() {
            // The rebuild took the document's own pixels, so an adjustment
            // that has only ever been previewed into the reduced copy is
            // not in it. Put it back.
            if let Some(Session::Adjust { last: Some(adjustment), .. }) = &self.session {
                let adjustment = adjustment.clone();
                self.preview_small(&adjustment, false);
            }
            self.touch_all();
        }
        self.refresh_full_preview();
        let dirty = self.is_dirty();
        let small = self.preview_base.as_ref()?.small.as_ref()?;
        if !dirty && out.width() == small.document.width() && out.height() == small.document.height() {
            return Some(false);
        }
        let all = small.document.bounds();
        if out.width() != small.document.width() || out.height() != small.document.height() {
            *out = Raster::new(small.document.width(), small.document.height());
        }
        small.document.composite_into(out, &all);
        Some(true)
    }

    /// Reports and clears the dirty rectangle: the page calls this once per frame
    /// and recomposites only when it says so.
    pub fn take_dirty(&mut self) -> Option<Rect> {
        self.dirty.take()
    }

    pub fn composite_into(&self, out: &mut Raster, clip: &Rect) {
        match &self.preview_base {
            Some(base) if base.fits(&self.document) => {
                out.copy_from(&base.below, clip);
                self.document.composite_from(base.index, out, clip);
            }
            _ => self.document.composite_into(out, clip),
        }
    }

    // ---- Tools and gestures -----------------------------------------------

    /// Switches tool. A gesture in progress is cancelled first, so switching
    /// mid-drag never leaves a half-drawn shape behind.
    pub fn set_tool(&mut self, kind: ToolKind) {
        if self.tool.kind() == kind {
            return;
        }
        self.abort_gesture();
        self.settings.subject_box = None;
        self.tool = kind.instantiate();
    }

    fn event(&self, screen: Point, shift: bool, alt: bool) -> PointerEvent {
        PointerEvent { pos: self.viewport.screen_to_doc(screen), screen, shift, alt, pressure: self.pressure }
    }

    /// How hard the pen is pressing for the pointer events to come,
    /// `0.0..=1.0`; the page sets it before each one, and a mouse is 1.
    pub fn set_pressure(&mut self, pressure: f64) {
        self.pressure = if pressure.is_finite() { pressure.clamp(0.0, 1.0) } else { 1.0 };
    }

    /// Why the current tool cannot paint on the active layer, if it cannot:
    /// a smart object's pixels, an adjustment layer's, a locked layer, or —
    /// for the tools that move pixels — locked transparency. The page shows
    /// this when [`Editor::pointer_down`] declines.
    pub fn edit_refusal(&self) -> Option<EditRefusal> {
        if !self.tool.kind().edits_pixels() {
            return None;
        }
        if self.tool.kind() == ToolKind::Move && self.moves_by_placement() {
            return None;
        }
        let layer = self.document.active_layer();
        if let Some(why) = layer.edit_refusal() {
            return Some(why);
        }
        (self.tool.kind() == ToolKind::Move && layer.keeps_alpha()).then_some(EditRefusal::AlphaLocked)
    }

    /// Why editing the active layer's pixels would be refused, whatever the
    /// tool happens to be — what a menu command runs into, as against a
    /// brush. [`Editor::edit_refusal`] answers for the tool in hand and so
    /// says nothing while a marquee is active; a command that is about to
    /// change pixels needs the layer's own answer.
    pub fn layer_refusal(&self) -> Option<EditRefusal> {
        self.document.active_layer().edit_refusal()
    }

    /// Whether the active surface must keep its transparency through an
    /// edit, and so needs the before-picture kept.
    fn keeps_alpha(&self) -> bool {
        self.document.active_layer().keeps_alpha()
    }

    /// Makes the colour under a document point the foreground colour, or the
    /// background when `background` is set. False when there is nothing
    /// there. What Alt-clicking with a painting tool does.
    fn pick_color_at(&mut self, at: Point, background: bool) -> bool {
        let Some(color) = sample_color(&self.document.composite(), at) else { return false };
        if background {
            self.settings.background = color;
        } else {
            self.settings.color = color;
        }
        true
    }

    /// The pointer went down at a screen position. Returns whether a gesture
    /// started; painting on a hidden layer is refused, since the result would
    /// be invisible and baffling, and so is painting on pixels that are not
    /// there to paint (see [`Editor::edit_refusal`]). Alt with a painting
    /// tool samples a colour instead, and starts nothing.
    pub fn pointer_down(&mut self, screen: Point, shift: bool, alt: bool) -> bool {
        if self.gesture.is_some() {
            self.abort_gesture();
        }
        let ev = self.event(screen, shift, alt);
        match &mut self.session {
            Some(Session::Transform(t)) | Some(Session::TransformSelection { session: t, .. }) => {
                let tolerance = HANDLE_GRAB_PX / self.viewport.zoom();
                t.pointer_down(ev.pos, tolerance);
                return true;
            }
            Some(Session::Adjust { .. } | Session::AdjustmentLayer { .. } | Session::Text { .. }) => return false,
            None => {}
        }
        if alt && self.tool.kind().alt_picks_color() {
            self.pick_color_at(ev.pos, false);
            return true;
        }
        // The move tool moves a smart object — a text layer among them — by
        // its placement rather than its pixels: a free transform's drag,
        // begun wherever the click landed and committed on release, so
        // nothing is resampled and the text stays text.
        if self.tool.kind() == ToolKind::Move && self.moves_by_placement() {
            if self.begin_transform().is_err() {
                return false;
            }
            if let Some(Session::Transform(t)) = &mut self.session {
                t.begin_move(ev.pos);
            }
            self.moving_smart = true;
            return true;
        }
        if self.tool.kind().edits_pixels() && (!self.document.active_layer().visible || self.edit_refusal().is_some()) {
            return false;
        }
        let snapshot = Snapshot::of_active_layer(&self.document);
        // A tool that does not paint may still change the selection; keep
        // what it was, and the drag becomes a step if it did.
        let before = (!self.tool.kind().edits_pixels()).then(|| self.aside());
        let confined = self.tool.kind().confined_to_selection();
        self.gesture_base = (confined && (self.selection.needs_base() || self.keeps_alpha()))
            .then(|| self.document.active_surface().clone());
        if self.tool.kind() == ToolKind::Move && self.selection.is_none() && self.preview_step() > 1 {
            if let Some(reduced) = self.hold_reduced_move(ev.pos) {
                self.reduced_move = Some(reduced);
                self.record(snapshot, self.tool.kind().label());
                self.gesture = Some(Gesture::EditsActiveLayer);
                self.touch_all();
                return true;
            }
        }
        if self.tool.kind().previews_on_the_reduced_copy() && self.preview_step() > 1 && self.hold_reduced_gesture(ev) {
            self.record(snapshot, self.tool.kind().label());
            self.gesture = Some(Gesture::EditsActiveLayer);
            return true;
        }
        let mut ctx = ToolContext {
            document: &mut self.document,
            selection: &mut self.selection,
            viewport: &mut self.viewport,
            settings: &mut self.settings,
        };
        let gesture = self.tool.begin(&mut ctx, ev);
        let touched = self.tool_dirtied();
        if gesture == Gesture::EditsActiveLayer {
            self.record(snapshot, self.tool.kind().label());
            self.enforce_limits(touched);
        } else {
            self.gesture_aside = before;
        }
        self.gesture = Some(gesture);
        // Only a gesture that paints changes the composite. A selection or
        // view gesture is drawn by the page from what it already has, and on
        // a big document a needless recomposite here is the difference
        // between a pan that glides and one that stutters.
        if gesture == Gesture::EditsActiveLayer {
            self.touch(touched);
        }
        true
    }

    /// The pointer moved. `ctrl` is read here rather than at the start of
    /// the gesture because it is a modifier on the drag in progress: it
    /// takes a free transform's handle out of the box's own rectangle and
    /// into the plane, and it may be pressed and let go mid-drag.
    pub fn pointer_move(&mut self, screen: Point, shift: bool, alt: bool, ctrl: bool) -> bool {
        let ev = self.event(screen, shift, alt);
        if let Some(Session::Transform(t)) | Some(Session::TransformSelection { session: t, .. }) = &mut self.session {
            let snap = Snap::new(&self.settings.guides, self.document.bounds(), self.viewport.zoom());
            let changed = t.pointer_move_snapped(ev.pos, shift, alt, ctrl, snap.as_ref());
            if changed {
                self.refresh_transform();
            }
            return changed;
        }
        if self.reduced_move.is_some() {
            return self.move_on_the_copy(ev.pos);
        }
        if self.reduced_gesture.is_some() {
            return self.draw_on_the_copy(ev, false);
        }
        if self.gesture.is_none() {
            return false;
        }
        let mut ctx = ToolContext {
            document: &mut self.document,
            selection: &mut self.selection,
            viewport: &mut self.viewport,
            settings: &mut self.settings,
        };
        let changed = self.tool.update(&mut ctx, ev);
        if changed {
            let touched = self.tool_dirtied();
            self.enforce_limits(touched);
            if self.gesture == Some(Gesture::EditsActiveLayer) {
                self.touch(touched);
            }
        }
        changed
    }

    pub fn pointer_up(&mut self, screen: Point, shift: bool, alt: bool) -> bool {
        if let Some(Session::Transform(t)) | Some(Session::TransformSelection { session: t, .. }) = &mut self.session {
            t.pointer_up();
            if self.moving_smart {
                // A click that went nowhere is not a step.
                let unmoved = self.transform_base.as_ref().and_then(Layer::smart_object).map(|o| o.transform) == self.transform_session().map(TransformSession::matrix);
                if unmoved {
                    self.cancel_session();
                } else {
                    self.commit_session();
                }
                return true;
            }
            return false;
        }
        if let Some(reduced) = self.reduced_move.take() {
            // Back to the frame, and the document moves once: the same
            // gesture, handed to the tool, from where it began to here.
            self.preview_base = None;
            let to = self.event(screen, shift, alt);
            let from = PointerEvent { pos: reduced.start, screen: self.viewport.doc_to_screen(reduced.start), ..to };
            let mut ctx = ToolContext {
                document: &mut self.document,
                selection: &mut self.selection,
                viewport: &mut self.viewport,
                settings: &mut self.settings,
            };
            self.tool.begin(&mut ctx, from);
            let changed = self.tool.finish(&mut ctx, to);
            self.gesture = None;
            self.touch_all();
            return changed;
        }
        if let Some(reduced) = self.reduced_gesture.take() {
            // Back to the document, which the drag never touched: the same
            // gesture, handed to the tool once, from where it began to here.
            self.preview_base = None;
            let to = self.event(screen, shift, alt);
            let from = PointerEvent { pos: reduced.start, screen: self.viewport.doc_to_screen(reduced.start), ..to };
            let mut ctx = ToolContext {
                document: &mut self.document,
                selection: &mut self.selection,
                viewport: &mut self.viewport,
                settings: &mut self.settings,
            };
            self.tool.begin(&mut ctx, from);
            let changed = self.tool.finish(&mut ctx, to);
            let touched = self.tool_dirtied();
            if changed {
                self.enforce_limits(touched);
            }
            self.gesture_base = None;
            self.gesture = None;
            self.touch_all();
            return changed;
        }
        if self.gesture.is_none() {
            return false;
        }
        let ev = self.event(screen, shift, alt);
        let mut ctx = ToolContext {
            document: &mut self.document,
            selection: &mut self.selection,
            viewport: &mut self.viewport,
            settings: &mut self.settings,
        };
        let changed = self.tool.finish(&mut ctx, ev);
        let touched = self.tool_dirtied();
        if changed {
            self.enforce_limits(touched);
        }
        if let Some(before) = self.gesture_aside.take() {
            if before.selection != self.selection {
                self.history.push(Snapshot::Nothing, before, self.tool.kind().label());
            }
        }
        self.gesture_base = None;
        let edits = self.gesture.take() == Some(Gesture::EditsActiveLayer);
        if changed && edits {
            self.touch(touched);
        }
        changed
    }

    /// Puts back the pixels the gesture was not allowed to touch inside
    /// `within`: outside a mask selection, and the transparency of an
    /// alpha-locked layer. Does nothing unless a base was kept.
    fn enforce_limits(&mut self, within: Rect) {
        if let Some(base) = self.gesture_base.as_ref() {
            let keeps_alpha = self.document.active_layer().keeps_alpha();
            let raster = self.document.active_surface_mut();
            self.selection.apply(raster, base, &within);
            if keeps_alpha {
                keep_alpha(raster, base, &within);
            }
        }
    }

    /// What the tool says its last call changed, or the whole document when
    /// it does not say. Correctness never depends on a tool answering.
    fn tool_dirtied(&self) -> Rect {
        self.tool.dirtied().unwrap_or_else(|| self.document.bounds())
    }

    /// Abandons the gesture in progress and the undo step it opened — or
    /// the move tool's drag of a smart object, which is a session.
    pub fn cancel_gesture(&mut self) -> bool {
        if self.moving_smart {
            return self.cancel_session();
        }
        self.abort_gesture()
    }

    /// Whether the move tool would move the active layer by its placement:
    /// a smart object or text layer, its pixels rather than its mask, that
    /// can be moved at all. What cannot — a hidden or locked layer — is
    /// refused the ordinary way.
    fn moves_by_placement(&self) -> bool {
        let layer = self.document.active_layer();
        layer.is_smart() && !layer.editing_mask() && layer.visible && !layer.locked
    }

    fn abort_gesture(&mut self) -> bool {
        // A drag shown on the reduced copy never touched the document, so
        // dropping the copy is the whole of putting it back.
        if self.reduced_move.take().is_some() {
            self.preview_base = None;
            self.gesture = None;
            self.history.discard_last();
            self.touch_all();
            return true;
        }
        if self.reduced_gesture.take().is_some() {
            // The tool's own state lives on the copy that is about to go, so
            // it is told to let go before the copy does.
            if let Some(small) = self.preview_base.as_mut().and_then(|b| b.small.as_mut()) {
                let mut ctx = ToolContext {
                    document: &mut small.document,
                    selection: &mut small.selection,
                    viewport: &mut self.viewport,
                    settings: &mut self.settings,
                };
                self.tool.cancel(&mut ctx);
            }
            self.preview_base = None;
            self.gesture = None;
            self.gesture_base = None;
            self.history.discard_last();
            self.touch_all();
            return true;
        }
        let Some(gesture) = self.gesture.take() else { return false };
        let mut ctx = ToolContext {
            document: &mut self.document,
            selection: &mut self.selection,
            viewport: &mut self.viewport,
            settings: &mut self.settings,
        };
        self.tool.cancel(&mut ctx);
        self.gesture_base = None;
        self.gesture_aside = None;
        if gesture == Gesture::EditsActiveLayer {
            // The tool has put the pixels back, so the step recorded for this
            // gesture would be an undo that does nothing. Drop it.
            self.history.discard_last();
            self.touch_all();
        }
        true
    }

    // ---- History -----------------------------------------------------------

    /// The selection, guides and symmetry axes as they stand, for a step to
    /// carry.
    fn aside(&self) -> Aside {
        Aside {
            selection: self.selection.clone(),
            guides_h: self.settings.guides.h.clone(),
            guides_v: self.settings.guides.v.clone(),
            symmetry: self.settings.symmetry.frame,
        }
    }

    /// Records a step: the document snapshot, with the selection and guides
    /// as they are now — so call it before changing them.
    fn record(&mut self, snapshot: Snapshot, label: impl Into<String>) {
        let aside = self.aside();
        self.history.push(snapshot, aside, label);
    }

    fn record_coalescing(&mut self, snapshot: Snapshot, label: impl Into<String>, key: impl Into<String>) {
        let aside = self.aside();
        self.history.push_coalescing(snapshot, aside, label, key);
    }

    /// Runs an edit of the selection alone as one undo step, recorded only
    /// if `op` says something changed.
    fn selection_edit(&mut self, label: &str, op: impl FnOnce(&mut Editor) -> bool) -> bool {
        let before = self.aside();
        let changed = op(self);
        if changed {
            self.history.push(Snapshot::Nothing, before, label);
            self.touch_all();
        }
        changed
    }

    /// Runs a history move with the selection and guides in play.
    fn travel(&mut self, go: impl FnOnce(&mut History, &mut Document, &mut Aside) -> bool) -> bool {
        self.cancel_session();
        self.abort_gesture();
        let mut aside = self.aside();
        let done = go(&mut self.history, &mut self.document, &mut aside);
        if done {
            self.selection = aside.selection;
            self.settings.guides.h = aside.guides_h;
            self.settings.guides.v = aside.guides_v;
            self.settings.symmetry.frame = aside.symmetry;
            self.touch_all();
        }
        done
    }

    pub fn undo(&mut self) -> bool {
        self.travel(|h, d, a| h.undo(d, a))
    }

    pub fn redo(&mut self) -> bool {
        self.travel(|h, d, a| h.redo(d, a))
    }

    // ---- Guides ------------------------------------------------------------------

    /// Replaces the guides as one undo step, under the page's label for
    /// what happened: "Add Guide", "Move Guide" and so on.
    pub fn edit_guides(&mut self, h: Vec<f64>, v: Vec<f64>, label: &str) -> bool {
        let guides = &self.settings.guides;
        if guides.h == h && guides.v == v {
            return false;
        }
        self.record(Snapshot::Nothing, label);
        self.settings.guides.h = h;
        self.settings.guides.v = v;
        true
    }

    // ---- Symmetry ----------------------------------------------------------------

    /// The canvas centre, which is where the symmetry axes cross until they
    /// are put somewhere else.
    fn canvas_centre(&self) -> Point {
        let b = self.document.bounds();
        Point::new(f64::from(b.w) / 2.0, f64::from(b.h) / 2.0)
    }

    /// Where the symmetry axes cross and how far they are turned, with the
    /// canvas centre filled in for axes that have never been placed.
    pub fn symmetry_frame(&self) -> (Point, f64) {
        let s = self.settings.symmetry;
        (s.origin(self.canvas_centre()), s.frame.angle)
    }

    /// Whether the axes are still at the canvas centre, square to it — what
    /// the page's "Centre Axes" command undoes back to.
    pub fn symmetry_is_centred(&self) -> bool {
        self.settings.symmetry.frame == SymmetryFrame::default()
    }

    /// Puts the axes somewhere, as one undo step. The origin is held to a
    /// half pixel ([`crate::tools::ORIGIN_STEP`]) and the angle folded into
    /// a half turn, so that setting the same place twice records nothing.
    pub fn set_symmetry_frame(&mut self, frame: SymmetryFrame) -> bool {
        let frame = frame.tidied();
        if self.settings.symmetry.frame == frame {
            return false;
        }
        let label = if frame == SymmetryFrame::default() { "Centre Axes" } else { "Symmetry Axes" };
        self.record(Snapshot::Nothing, label);
        self.settings.symmetry.frame = frame;
        true
    }

    /// Puts the axes back at the centre of the canvas, square to it.
    pub fn centre_symmetry(&mut self) -> bool {
        self.set_symmetry_frame(SymmetryFrame::default())
    }

    /// The gizmo's two drawn handles in screen space: where the axes cross,
    /// and the arm that turns them. Empty when there is no symmetry on.
    pub fn symmetry_handles(&self) -> Option<(Point, Point)> {
        let s = self.settings.symmetry;
        if s.is_off() {
            return None;
        }
        let centre = self.canvas_centre();
        let arm = s.rotate_handle(centre, ROTATE_ARM_PX / self.viewport.zoom());
        Some((self.viewport.doc_to_screen(s.origin(centre)), self.viewport.doc_to_screen(arm)))
    }

    /// What the pointer would grab on the gizmo at a screen position.
    pub fn symmetry_hit(&self, screen: Point) -> Option<SymmetryHit> {
        let zoom = self.viewport.zoom();
        self.settings.symmetry.hit(
            self.viewport.screen_to_doc(screen),
            self.canvas_centre(),
            ROTATE_ARM_PX / zoom,
            HANDLE_GRAB_PX / zoom,
        )
    }

    /// Takes hold of whatever the gizmo offers at a screen position. The
    /// grab remembers where within the handle the pointer landed, so the
    /// axes do not jump to the pointer as the drag starts.
    ///
    /// `place` is the page in its placing mode, where a press on the picture
    /// itself takes the crossing point straight to the pointer rather than
    /// asking anyone to find a dot first.
    pub fn symmetry_grab(&mut self, screen: Point, place: bool) -> bool {
        let s = self.settings.symmetry;
        let held = self.symmetry_hit(screen);
        let hit = match held {
            Some(hit) => hit,
            None if place && !s.is_off() => SymmetryHit::Origin,
            None => return false,
        };
        let f = s.to_frame(self.viewport.screen_to_doc(screen), self.canvas_centre());
        // A grab of a handle keeps the pointer where it landed on it; a
        // fresh placement has nothing to keep and comes to the pointer.
        let offset = if held.is_some() { Point::new(-f.x, -f.y) } else { Point::default() };
        self.symmetry_drag = Some(SymmetryDrag { hit, before: s.frame, offset, arm: f.y.atan2(f.x) });
        true
    }

    /// Drags the gizmo. `free` is the modifier that turns the snapping off:
    /// without it the crossing point is pulled onto guides, the canvas edges
    /// and its centre, and the angle onto multiples of
    /// [`SYMMETRY_ANGLE_STEP`]. The half-pixel rule is not a preference and
    /// applies either way.
    pub fn symmetry_drag(&mut self, screen: Point, free: bool) -> bool {
        let Some(drag) = self.symmetry_drag else { return false };
        let centre = self.canvas_centre();
        let p = self.viewport.screen_to_doc(screen);
        let s = self.settings.symmetry;
        let frame = match drag.hit {
            SymmetryHit::Rotate => {
                let turned = (p.y - s.origin(centre).y).atan2(p.x - s.origin(centre).x) - drag.arm;
                let angle = if free { turned } else { snap_angle(turned) };
                SymmetryFrame { angle, ..s.frame }
            }
            hit => {
                // The pointer carries the handle it grabbed, so the origin
                // is wherever that handle's own position would put it.
                let mut origin = s.from_frame(drag.offset, centre);
                origin = Point::new(origin.x + p.x - s.origin(centre).x, origin.y + p.y - s.origin(centre).y);
                if !free {
                    if let Some(snap) = Snap::new(&self.settings.guides, self.document.bounds(), self.viewport.zoom()) {
                        origin = snap.point(origin);
                    }
                }
                // A mirror line only moves across itself: sliding it along
                // its own length would move nothing but would drag the other
                // axis off the place it was put.
                let along = match hit {
                    SymmetryHit::AxisX => Some(Point::new(1.0, 0.0)),
                    SymmetryHit::AxisY => Some(Point::new(0.0, 1.0)),
                    _ => None,
                };
                if let Some(axis) = along {
                    let was = s.origin(centre);
                    let (sa, ca) = s.frame.angle.sin_cos();
                    let dir = Point::new(axis.x * ca - axis.y * sa, axis.x * sa + axis.y * ca);
                    let travel = (origin.x - was.x) * dir.x + (origin.y - was.y) * dir.y;
                    origin = Point::new(was.x + dir.x * travel, was.y + dir.y * travel);
                }
                SymmetryFrame { origin: Some(origin), ..s.frame }
            }
        };
        let frame = frame.tidied();
        if self.settings.symmetry.frame == frame {
            return false;
        }
        self.settings.symmetry.frame = frame;
        true
    }

    /// Ends the drag, recording the whole of it as one undo step. False when
    /// the axes came back to where they started.
    pub fn symmetry_release(&mut self) -> bool {
        let Some(drag) = self.symmetry_drag.take() else { return false };
        let now = self.settings.symmetry.frame;
        if now == drag.before {
            return false;
        }
        // The drag has already moved them; the step has to hold where they
        // were, so put them back to record it.
        self.settings.symmetry.frame = drag.before;
        self.set_symmetry_frame(now)
    }

    pub fn is_dragging_symmetry(&self) -> bool {
        self.symmetry_drag.is_some()
    }

    /// Every place a screen position would be painted under the symmetry in
    /// hand, in screen pixels — the brush ring, drawn once per image.
    pub fn symmetry_images(&self, screen: Point) -> Vec<Point> {
        let p = self.viewport.screen_to_doc(screen);
        self.settings
            .symmetry
            .images(p, self.canvas_centre())
            .into_iter()
            .map(|q| self.viewport.doc_to_screen(q))
            .collect()
    }

    /// Carries placed axes through a change to the canvas, so they stay on
    /// the same part of the picture. Axes left at the centre need nothing:
    /// the centre is worked out afresh every time they are used.
    fn remap_symmetry(&mut self, place: impl FnOnce(Point) -> Point, turn: impl FnOnce(f64) -> f64) {
        let frame = self.settings.symmetry.frame;
        self.settings.symmetry.frame =
            SymmetryFrame { origin: frame.origin.map(place), angle: turn(frame.angle) }.tidied();
    }

    /// Every step the history holds, oldest first, done and undone alike;
    /// [`Editor::history_position`] says how many are applied.
    pub fn history_labels(&self) -> Vec<String> {
        self.history.labels()
    }

    pub fn history_position(&self) -> usize {
        self.history.position()
    }

    /// Jumps to having exactly `steps` of the history applied — clicking a
    /// row of the history panel.
    pub fn history_go_to(&mut self, steps: usize) -> bool {
        self.travel(|h, d, a| h.go_to(d, a, steps))
    }

    pub fn history_limit(&self) -> usize {
        self.history.limit()
    }

    pub fn set_history_limit(&mut self, limit: usize) {
        self.history.set_limit(limit);
    }

    // ---- Layers -------------------------------------------------------------
    //
    // Each of these is an undoable step that snapshots the whole stack.

    fn structural<T>(&mut self, label: &str, op: impl FnOnce(&mut Document) -> Result<T, DocumentError>) -> Result<T, DocumentError> {
        self.cancel_session();
        self.abort_gesture();
        let snapshot = Snapshot::of_structure(&self.document);
        let result = op(&mut self.document)?;
        self.record(snapshot, label);
        self.touch_all();
        Ok(result)
    }

    pub fn add_layer(&mut self) -> usize {
        self.structural("New Layer", |d| Ok(d.add_layer())).expect("adding a layer cannot fail")
    }

    pub fn add_layer_from(&mut self, name: &str, raster: Raster) -> Result<usize, DocumentError> {
        self.structural("New Layer", |d| d.add_layer_from(name, raster))
    }

    /// Adds a picture of any size as a layer at its own resolution, centred
    /// on the canvas — what opening a file as a layer, or pasting a picture
    /// from outside, does.
    pub fn add_layer_centred(&mut self, name: &str, raster: &Raster) -> usize {
        let x = (self.document.width() as i32 - raster.width() as i32) / 2;
        let y = (self.document.height() as i32 - raster.height() as i32) / 2;
        self.structural("Place Layer", |d| Ok(d.add_layer_placed(name, raster, x, y))).expect("placing cannot fail")
    }

    pub fn duplicate_layer(&mut self, index: usize) -> Result<usize, DocumentError> {
        self.structural("Duplicate Layer", |d| d.duplicate_layer(index))
    }

    pub fn remove_layer(&mut self, index: usize) -> Result<(), DocumentError> {
        self.structural("Delete Layer", |d| d.remove_layer(index))
    }

    /// Drops a layer somewhere else in the stack — what a drag in the
    /// layers panel does. Dropping a layer back where it already was is not
    /// an edit and leaves no undo step.
    pub fn move_layer_to(&mut self, from: usize, to: usize, drop: Drop) -> Result<usize, DocumentError> {
        if from == to {
            return Ok(from);
        }
        // Dragging a row that is part of the panel's selection takes the
        // whole selection with it; dragging any other row is that row alone.
        let indices = self.dragged_layers(from);
        // Dropping layers back where they already are is not an edit.
        if !self.document.move_layers_would_change(&indices, to, drop) {
            return Ok(from);
        }
        if indices.len() > 1 {
            return self.structural("Move Layers", |d| d.move_layers_to(&indices, to, drop));
        }
        self.structural("Move Layer", |d| d.move_layer_to(from, to, drop))
    }

    /// Moves a layer one row up or down the panel, stepping over a group
    /// rather than into it and out of a group when there is nowhere left.
    pub fn reorder_layer(&mut self, index: usize, up: bool) -> Result<Option<usize>, DocumentError> {
        if index >= self.document.layers().len() {
            return Err(DocumentError::NoSuchLayer);
        }
        // Nothing to record when there is nowhere that way to go.
        if self.document.reorder_target(index, up).is_none() {
            return Ok(None);
        }
        self.structural("Move Layer", |d| d.reorder_layer(index, up))
    }

    // ---- The panel's selection ----------------------------------------------------

    /// Which layers the panel has picked out, bottom-first. The active
    /// layer is always one of them, and layers that have since gone are
    /// not: the set is pruned as it is read, so nothing else has to.
    pub fn selected_layers(&self) -> Vec<usize> {
        if self.nothing_selected {
            return Vec::new();
        }
        let mut indices: Vec<usize> = self.selected.iter().filter_map(|&id| self.document.index_of(id)).collect();
        let active = self.document.active_index();
        if !indices.contains(&active) {
            indices.push(active);
        }
        indices.sort_unstable();
        indices.dedup();
        indices
    }

    /// What a drag started on `from` carries: the whole panel selection
    /// when that row is part of it, and otherwise just that row. Both the
    /// line the panel draws and the move it then makes go through this, so
    /// they cannot disagree.
    pub fn dragged_layers(&self, from: usize) -> Vec<usize> {
        let selected = self.selected_layers();
        if selected.len() > 1 && selected.contains(&from) {
            selected
        } else {
            vec![from]
        }
    }

    pub fn layer_is_selected(&self, index: usize) -> bool {
        if self.nothing_selected {
            return false;
        }
        index == self.document.active_index() || self.document.layer(index).is_some_and(|l| self.selected.contains(&l.id()))
    }

    fn remember_selection(&mut self, indices: &[usize]) {
        self.selected = indices.iter().filter_map(|&i| self.document.layer(i).map(Layer::id)).collect();
        self.nothing_selected = false;
    }

    /// Adds a layer to the panel's selection, or takes it out again —
    /// Ctrl-clicking a row. The active layer cannot be taken out; clicking
    /// it makes it the only one selected instead.
    pub fn toggle_layer_selected(&mut self, index: usize) -> Result<(), DocumentError> {
        let id = self.document.layer(index).ok_or(DocumentError::NoSuchLayer)?.id();
        // Ctrl-clicking with nothing picked out picks out that row, rather
        // than adding it to a set that is not there.
        if self.nothing_selected {
            self.nothing_selected = false;
            self.selected.clear();
            return self.set_active_layer(index);
        }
        if index == self.document.active_index() {
            self.selected.clear();
            return Ok(());
        }
        match self.selected.iter().position(|&s| s == id) {
            Some(at) => {
                self.selected.remove(at);
            }
            None => {
                // The active layer is only implicitly in the set, so it has
                // to be written down before another row joins it.
                let active = self.document.active_layer().id();
                if !self.selected.contains(&active) {
                    self.selected.push(active);
                }
                self.selected.push(id);
            }
        }
        Ok(())
    }

    /// Drops back to one selected layer, the active one — clicking the
    /// empty part of the panel. There is always an active layer, since the
    /// tools have to have something to paint on; what this clears is
    /// everything Shift and Ctrl added to it.
    pub fn clear_layer_selection(&mut self) {
        self.selected.clear();
        self.nothing_selected = true;
    }

    /// Selects everything between the active layer and `index` — Shift-
    /// clicking a row. The active layer does not move, so shift-clicking
    /// again from the same anchor grows or shrinks the run.
    pub fn select_layer_range(&mut self, index: usize) -> Result<(), DocumentError> {
        if index >= self.document.layers().len() {
            return Err(DocumentError::NoSuchLayer);
        }
        // With nothing picked out there is no anchor to reach from, so a
        // Shift-click is just a click.
        if self.nothing_selected {
            return self.set_active_layer(index);
        }
        let active = self.document.active_index();
        let (from, to) = if index < active { (index, active) } else { (active, index) };
        let run: Vec<usize> = (from..=to).collect();
        self.remember_selection(&run);
        Ok(())
    }

    // ---- Groups ------------------------------------------------------------------

    pub fn add_group(&mut self) -> usize {
        self.structural("New Group", |d| Ok(d.add_group(None))).expect("adding a group cannot fail")
    }

    /// Puts a layer into a new group in its place.
    pub fn group_layer(&mut self, index: usize) -> Result<usize, DocumentError> {
        self.structural("Group Layer", |d| d.group_layer(index, None))
    }

    /// Puts everything the panel has selected into one new group, in the
    /// place of the topmost of them. The group is then the only thing
    /// selected, as it is the only row left to click.
    pub fn group_selected_layers(&mut self) -> Result<usize, DocumentError> {
        let indices = self.selected_layers();
        if indices.is_empty() {
            return Err(DocumentError::NoSuchLayer);
        }
        let label = if indices.len() > 1 { "Group Layers" } else { "Group Layer" };
        let at = self.structural(label, |d| d.group_layers(&indices, None))?;
        self.selected.clear();
        let _ = self.set_active_layer(at);
        Ok(at)
    }

    /// Deletes everything the panel has selected. Refused, and nothing
    /// deleted, if that would empty the document.
    pub fn remove_selected_layers(&mut self) -> Result<(), DocumentError> {
        let indices = self.selected_layers();
        if indices.is_empty() {
            return Err(DocumentError::NoSuchLayer);
        }
        if indices.len() <= 1 {
            return self.remove_layer(self.document.active_index());
        }
        let label = "Delete Layers";
        self.structural(label, |d| {
            let roots = d.roots_among(&indices);
            let doomed: usize = roots.iter().map(|&r| d.subtree(r).len()).sum();
            if doomed >= d.layers().len() {
                return Err(DocumentError::LastLayer);
            }
            // Highest first, so the ones still to go keep their indices.
            for &root in roots.iter().rev() {
                d.remove_layer(root)?;
            }
            Ok(())
        })?;
        self.selected.clear();
        Ok(())
    }

    /// Duplicates everything the panel has selected, and leaves the copies
    /// selected the way the originals were.
    pub fn duplicate_selected_layers(&mut self) -> Result<usize, DocumentError> {
        let indices = self.selected_layers();
        if indices.is_empty() {
            return Err(DocumentError::NoSuchLayer);
        }
        if indices.len() <= 1 {
            return self.duplicate_layer(self.document.active_index());
        }
        let copies = self.structural("Duplicate Layers", |d| {
            let roots = d.roots_among(&indices);
            let mut copies = Vec::with_capacity(roots.len());
            // Bottom-first, carrying how far the copies already made have
            // pushed the layers above them up the stack.
            let mut shift = 0;
            for &root in &roots {
                let at = d.duplicate_layer(root + shift)?;
                shift += d.subtree(at).len();
                copies.push(at);
            }
            Ok(copies)
        })?;
        self.remember_selection(&copies);
        let last = *copies.last().expect("there was something to copy");
        let _ = self.document.set_active(last);
        Ok(last)
    }

    pub fn ungroup(&mut self, index: usize) -> Result<(), DocumentError> {
        self.structural("Ungroup", |d| d.ungroup(index))
    }

    pub fn flatten_group(&mut self, index: usize) -> Result<(), DocumentError> {
        self.structural("Merge Group", |d| d.flatten_group(index))
    }

    /// Folding a group open or shut is a view setting, not an edit, so it
    /// leaves no undo step — but it does live in the document, so that a
    /// saved file opens folded the way it was left.
    pub fn set_layer_collapsed(&mut self, index: usize, collapsed: bool) -> Result<(), DocumentError> {
        self.document.set_collapsed(index, collapsed)
    }

    pub fn merge_down(&mut self, index: usize) -> Result<(), DocumentError> {
        self.structural("Merge Down", |d| d.merge_down(index))
    }

    /// Changing the active layer is not an edit, so it is not in the history.
    /// A session previewing on the old layer cannot follow, so it is cancelled.
    pub fn set_active_layer(&mut self, index: usize) -> Result<(), DocumentError> {
        if index != self.document.active_index() {
            self.cancel_session();
        }
        self.abort_gesture();
        self.document.set_active(index)?;
        // A plain click is a selection of one; Shift and Ctrl go through
        // `select_layer_range` and `toggle_layer_selected` instead.
        self.selected.clear();
        self.nothing_selected = false;
        Ok(())
    }

    /// Switches the tools between a layer's pixels and its mask. Not an
    /// edit either.
    pub fn set_layer_target(&mut self, index: usize, target: Target) -> Result<(), DocumentError> {
        self.cancel_session();
        self.abort_gesture();
        self.document.set_target(index, target)
    }

    // ---- Layer kinds ------------------------------------------------------------

    /// A new adjustment layer above the active one, masked to the selection
    /// if there is one. `params` are the adjustment's, as its dialog gives
    /// them; missing ones are neutral.
    pub fn add_adjustment_layer(&mut self, name: &str, params: &[f32]) -> Result<usize, AdjustmentError> {
        let adjustment = Adjustment::from_params(name, params)?;
        let shape = (!self.selection.is_none()).then(|| self.selection.to_mask(self.document.bounds()));
        Ok(self.structural("New Adjustment Layer", |d| Ok(d.add_adjustment_layer(adjustment, shape))).expect("adding a layer cannot fail"))
    }

    /// Places a picture as a smart object above the active layer.
    pub fn place_smart_object(&mut self, name: &str, source: Raster) -> usize {
        self.structural("Place Smart Object", |d| Ok(d.place_smart_object(name, source))).expect("placing cannot fail")
    }

    pub fn convert_to_smart_object(&mut self, index: usize) -> Result<(), DocumentError> {
        self.structural("Convert to Smart Object", |d| d.convert_to_smart_object(index))
    }

    pub fn rasterize_layer(&mut self, index: usize) -> Result<(), DocumentError> {
        self.structural("Rasterize Layer", |d| d.rasterize_layer(index))
    }

    pub fn replace_smart_contents(&mut self, index: usize, source: Raster) -> Result<(), DocumentError> {
        self.structural("Replace Contents", |d| d.replace_smart_contents(index, source))
    }

    // ---- Layer masks -------------------------------------------------------------

    /// Gives a layer a mask shaped like the selection (or revealing all of
    /// it when nothing is selected); `hide` inverts that, so the selection
    /// is what disappears.
    pub fn add_layer_mask(&mut self, index: usize, hide: bool) -> Result<(), DocumentError> {
        let shape = (!self.selection.is_none()).then(|| self.selection.to_mask(self.document.bounds()));
        self.structural("Add Layer Mask", |d| d.add_mask(index, shape, hide))
    }

    pub fn remove_layer_mask(&mut self, index: usize) -> Result<(), DocumentError> {
        self.structural("Delete Layer Mask", |d| d.remove_mask(index))
    }

    pub fn apply_layer_mask(&mut self, index: usize) -> Result<(), DocumentError> {
        self.structural("Apply Layer Mask", |d| d.apply_mask(index))
    }

    pub fn set_layer_mask_enabled(&mut self, index: usize, enabled: bool) -> Result<(), DocumentError> {
        self.structural(if enabled { "Enable Layer Mask" } else { "Disable Layer Mask" }, |d| d.set_mask_enabled(index, enabled))
    }

    /// Loads a layer's mask as the selection, the way Ctrl-clicking its
    /// mask thumbnail does.
    pub fn select_layer_mask(&mut self, index: usize, mode: SelectMode) -> Result<bool, DocumentError> {
        let layer = self.document.layer(index).ok_or(DocumentError::NoSuchLayer)?;
        let mask = layer.mask_as_selection().ok_or(DocumentError::NoMask)?;
        if mask.is_empty() {
            return Ok(false);
        }
        self.selection_edit("Load Mask as Selection", |e| {
            let bounds = e.document.bounds();
            e.selection.combine(&mask, mode, bounds);
            true
        });
        Ok(true)
    }

    pub fn set_layer_visible(&mut self, index: usize, visible: bool) -> Result<(), DocumentError> {
        self.structural(if visible { "Show Layer" } else { "Hide Layer" }, |d| {
            d.layer_mut(index).ok_or(DocumentError::NoSuchLayer)?.visible = visible;
            Ok(())
        })
    }

    /// Consecutive opacity changes to the same layer are one undo step, so a
    /// slider drag does not leave a hundred of them.
    pub fn set_layer_opacity(&mut self, index: usize, opacity: f32) -> Result<(), DocumentError> {
        self.abort_gesture();
        let snapshot = Snapshot::of_structure(&self.document);
        self.document.layer_mut(index).ok_or(DocumentError::NoSuchLayer)?.set_opacity(opacity);
        self.record_coalescing(snapshot, "Layer Opacity", format!("opacity:{index}"));
        self.touch_all();
        Ok(())
    }

    pub fn set_layer_blend(&mut self, index: usize, mode: BlendMode) -> Result<(), DocumentError> {
        self.structural("Blend Mode", |d| {
            d.layer_mut(index).ok_or(DocumentError::NoSuchLayer)?.blend = mode;
            Ok(())
        })
    }

    /// Locks or unlocks everything about a layer.
    pub fn set_layer_locked(&mut self, index: usize, locked: bool) -> Result<(), DocumentError> {
        self.structural(if locked { "Lock Layer" } else { "Unlock Layer" }, |d| {
            d.layer_mut(index).ok_or(DocumentError::NoSuchLayer)?.locked = locked;
            Ok(())
        })
    }

    /// Locks or unlocks a layer's transparency: painting then lands only
    /// where there is already something.
    pub fn set_layer_lock_alpha(&mut self, index: usize, locked: bool) -> Result<(), DocumentError> {
        self.structural(if locked { "Lock Transparency" } else { "Unlock Transparency" }, |d| {
            d.layer_mut(index).ok_or(DocumentError::NoSuchLayer)?.lock_alpha = locked;
            Ok(())
        })
    }

    /// Clips a layer to the one below, or releases it. Refused when there
    /// is nothing under it to clip to — [`Document::can_clip`].
    pub fn set_layer_clipped(&mut self, index: usize, clipped: bool) -> Result<(), DocumentError> {
        if clipped && !self.document.can_clip(index) {
            return Err(DocumentError::CannotClip);
        }
        self.structural(if clipped { "Create Clipping Mask" } else { "Release Clipping Mask" }, |d| {
            d.layer_mut(index).ok_or(DocumentError::NoSuchLayer)?.clipped = clipped;
            Ok(())
        })
    }

    pub fn rename_layer(&mut self, index: usize, name: &str) -> Result<(), DocumentError> {
        let name = name.trim();
        if name.is_empty() {
            return Ok(());
        }
        self.structural("Rename Layer", |d| {
            d.layer_mut(index).ok_or(DocumentError::NoSuchLayer)?.name = name.to_owned();
            Ok(())
        })
    }

    /// An undoable edit of the active surface's pixels inside the selection.
    /// Returns false when the clip is empty or the surface cannot be edited.
    fn pixel_edit(&mut self, label: &str, op: impl FnOnce(&mut Raster, Rect)) -> bool {
        self.cancel_session();
        self.abort_gesture();
        if self.document.active_layer().edit_refusal().is_some() {
            return false;
        }
        let clip = self.selection.clip(self.document.bounds());
        if clip.is_empty() {
            return false;
        }
        self.record(Snapshot::of_active_layer(&self.document), label);
        let keeps_alpha = self.keeps_alpha();
        let base = (self.selection.needs_base() || keeps_alpha).then(|| self.document.active_surface().clone());
        op(self.document.active_surface_mut(), clip);
        if let Some(base) = base {
            let raster = self.document.active_surface_mut();
            self.selection.apply(raster, &base, &clip);
            if keeps_alpha {
                keep_alpha(raster, &base, &clip);
            }
        }
        // A fill or an adjustment reaches no further than the selection.
        self.touch(clip);
        true
    }

    /// Clears the selected region of the active layer to transparent, or the
    /// whole layer when nothing is selected — the Delete key.
    pub fn clear_selection(&mut self) -> bool {
        self.pixel_edit("Clear", |raster, clip| raster.map_in(&clip, |_| Rgba::TRANSPARENT))
    }

    /// Fills the selected region of the active layer with the foreground.
    pub fn fill_selection(&mut self) -> bool {
        let color = self.settings.color;
        self.fill_selection_with(color)
    }

    /// Fills the selected region with the background colour.
    pub fn fill_selection_background(&mut self) -> bool {
        let color = self.settings.background;
        self.fill_selection_with(color)
    }

    pub fn fill_selection_with(&mut self, color: Rgba) -> bool {
        self.pixel_edit("Fill", |raster, clip| raster.fill_rect(clip, color, &clip))
    }

    /// Paints a line `width` pixels wide along the edge of the selection,
    /// centred on it, in the foreground colour — Edit > Stroke. The paint
    /// lands on both sides of the edge, so it is deliberately not held to
    /// the selection.
    pub fn stroke_selection(&mut self, width: u32) -> bool {
        self.cancel_session();
        self.abort_gesture();
        if self.selection.is_none() || width == 0 || self.document.active_layer().edit_refusal().is_some() {
            return false;
        }
        let bounds = self.document.bounds();
        let mask = self.selection.to_mask(bounds);
        let mut outer = mask.clone();
        outer.grow(width / 2);
        let mut inner = mask;
        inner.contract(width - width / 2);
        let mut band = outer;
        band.combine(&inner, SelectMode::Subtract);
        if band.is_empty() {
            return false;
        }
        self.record(Snapshot::of_active_layer(&self.document), "Stroke");
        let color = self.settings.color;
        let keeps_alpha = self.keeps_alpha();
        let surface = self.document.active_surface_mut();
        let base = surface.clone();
        let area = band.bounds();
        surface.fill_rect(area, color, &area);
        band.apply(surface, &base, &area);
        if keeps_alpha {
            keep_alpha(surface, &base, &area);
        }
        self.touch(area);
        true
    }

    pub fn swap_colors(&mut self) {
        std::mem::swap(&mut self.settings.color, &mut self.settings.background);
    }

    pub fn reset_colors(&mut self) {
        self.settings.color = Rgba::BLACK;
        self.settings.background = Rgba::WHITE;
    }

    /// Applies an adjustment to the active layer's selected pixels in one
    /// step, for the adjustments without parameters.
    pub fn apply_adjustment(&mut self, adjustment: Adjustment) -> bool {
        let label = adjustment.label();
        self.pixel_edit(&label, |raster, clip| adjustment.apply(raster, &clip))
    }

    /// Stretches the selected pixels' tones to the full range: Auto Levels
    /// (`per_channel`, which also removes a colour cast) or Auto Contrast.
    pub fn auto_levels(&mut self, per_channel: bool) -> bool {
        let label = if per_channel { "Auto Levels" } else { "Auto Contrast" };
        self.pixel_edit(label, |raster, clip| auto_levels(raster, &clip, per_channel))
    }

    /// Turns a checkerboard painted into the active layer into real
    /// transparency. False when the layer's edges show no board, or nothing
    /// could be edited.
    pub fn remove_checkerboard(&mut self) -> bool {
        let Some(board) = checker::detect(self.document.active_surface()) else { return false };
        self.pixel_edit("Remove Checkerboard", |raster, clip| {
            checker::remove(raster, &board, &clip);
        })
    }

    // ---- Clipboard -------------------------------------------------------------------

    /// Copies the selected pixels — of the active surface, or of the whole
    /// picture when `merged` — to the clipboard. False when there is nothing
    /// to copy.
    pub fn copy_selection(&mut self, merged: bool) -> bool {
        self.abort_gesture();
        let source = if merged { self.document.composite() } else { self.document.active_surface().clone() };
        let rect = self.selection.clip(source.bounds());
        if rect.is_empty() {
            return false;
        }
        let (taken, _) = self.selection.split(&source);
        let raster = taken.resized(rect.w as u32, rect.h as u32, -rect.x, -rect.y);
        let whole = !merged && self.selection_covers(source.bounds()) && self.document.active_layer().is_smart();
        let layer = whole.then(|| self.document.active_layer().clone());
        self.clipboard = Some(Clip { raster, x: rect.x, y: rect.y, layer });
        true
    }

    /// Whether the selection takes all of `bounds` — nothing selected, or a
    /// rectangle around the lot. A mask never counts: it may have holes in
    /// it wherever its bounds reach.
    fn selection_covers(&self, bounds: Rect) -> bool {
        match &self.selection {
            Selection::None => true,
            Selection::Rect(r) => r.intersect(&bounds) == bounds,
            Selection::Mask(_) => false,
        }
    }

    /// Copies the selected pixels and clears them.
    pub fn cut_selection(&mut self) -> bool {
        if self.document.active_layer().edit_refusal().is_some() || !self.copy_selection(false) {
            return false;
        }
        self.pixel_edit("Cut", |raster, clip| raster.map_in(&clip, |_| Rgba::TRANSPARENT))
    }

    pub fn clipboard(&self) -> Option<&Clip> {
        self.clipboard.as_ref()
    }

    /// Pastes the clipboard as a new layer: where it was copied from, if that
    /// still fits on the canvas, otherwise centred. Returns the layer's
    /// index, or `None` when the clipboard is empty.
    pub fn paste(&mut self) -> Option<usize> {
        let clip = self.clipboard.clone()?;
        if let Some(layer) = clip.layer {
            let index = self.structural("Paste", |d| Ok(d.add_layer_copy(&layer))).expect("pasting cannot fail");
            self.selection = Selection::None;
            return Some(index);
        }
        let fits = clip.x >= 0
            && clip.y >= 0
            && clip.x + clip.raster.width() as i32 <= self.document.width() as i32
            && clip.y + clip.raster.height() as i32 <= self.document.height() as i32;
        let (x, y) = if fits {
            (clip.x, clip.y)
        } else {
            (
                (self.document.width() as i32 - clip.raster.width() as i32) / 2,
                (self.document.height() as i32 - clip.raster.height() as i32) / 2,
            )
        };
        let index = self.structural("Paste", |d| Ok(d.add_layer_placed("Pasted", &clip.raster, x, y))).expect("pasting cannot fail");
        self.selection = Selection::None;
        Some(index)
    }

    /// Pastes a picture that came from outside — the system clipboard, a
    /// dropped file — as a new layer, centred.
    pub fn paste_external(&mut self, name: &str, raster: &Raster) -> usize {
        let index = self.add_layer_centred(name, raster);
        self.selection = Selection::None;
        index
    }

    // ---- Layer transforms (whole layer, undoable) ------------------------------
    //
    // These act on the whole layer — pixels and mask together, and a smart
    // object's placement rather than its rendering — so one undo step holds
    // the whole layer.

    fn layer_geometry(&mut self, label: &str, pixels: impl Fn(&Raster) -> Raster, place: impl Fn(&Projective) -> Projective) -> bool {
        self.cancel_session();
        self.abort_gesture();
        if self.document.active_layer().locked {
            return false;
        }
        let index = self.document.active_index();
        self.record(Snapshot::of_whole_layer(&self.document, index).expect("the active layer exists"), label);
        let (w, h) = (self.document.width(), self.document.height());
        self.document.active_layer_mut().map_rasters(pixels, place, w, h);
        self.touch_all();
        true
    }

    pub fn flip_layer_horizontal(&mut self) -> bool {
        let w = f64::from(self.document.width());
        let flip = Projective::from(Affine { a: -1.0, e: w, ..Affine::IDENTITY });
        self.layer_geometry("Flip Layer", Raster::flipped_horizontal, |m| flip.then(m))
    }

    pub fn flip_layer_vertical(&mut self) -> bool {
        let h = f64::from(self.document.height());
        let flip = Projective::from(Affine { d: -1.0, f: h, ..Affine::IDENTITY });
        self.layer_geometry("Flip Layer", Raster::flipped_vertical, |m| flip.then(m))
    }

    /// Rotates the active layer by quarter turns about the canvas centre,
    /// exactly; what leaves the canvas is lost.
    pub fn rotate_layer(&mut self, turns: i32) -> bool {
        let (w, h) = (self.document.width(), self.document.height());
        let centre = Point::new(f64::from(w) / 2.0, f64::from(h) / 2.0);
        let turn = Affine::rotation(f64::from(turns) * std::f64::consts::FRAC_PI_2);
        let about = Projective::IDENTITY.pre_about(&turn, centre);
        self.layer_geometry("Rotate Layer", |r| r.rotated_quarter(turns).recentred(w, h), |m| about.then(m))
    }

    /// Moves the selected pixels of the active layer (or the whole layer) by
    /// whole pixels, taking the selection along — the arrow keys with the
    /// move tool. A run of nudges is one undo step.
    pub fn nudge_layer(&mut self, dx: i32, dy: i32) -> bool {
        self.cancel_session();
        self.abort_gesture();
        let layer = self.document.active_layer();
        let by_placement = self.moves_by_placement();
        if (dx == 0 && dy == 0) || !layer.visible || (!by_placement && layer.edit_refusal().is_some()) || layer.keeps_alpha() {
            return false;
        }
        let index = self.document.active_index();
        if self.moves_by_placement() {
            // A smart object or text layer moves by its placement, whole.
            let Some(object) = layer.smart_object() else { return false };
            let moved = object.transform.after(&Affine::translation(f64::from(dx), f64::from(dy)));
            let was = object.extent();
            let snapshot = Snapshot::of_whole_layer(&self.document, index).expect("the active layer exists");
            self.record_coalescing(snapshot, "Move", format!("nudge:{index}"));
            let (w, h) = (self.document.width(), self.document.height());
            self.document.active_layer_mut().set_smart_transform(moved, w, h);
            let now = self.document.active_layer().smart_object().map_or(was, SmartObject::extent);
            self.touch(was.union(&now));
            return true;
        }
        let snapshot = Snapshot::of_active_layer(&self.document);
        self.record_coalescing(snapshot, "Move", format!("nudge:{index}"));
        // A nudge is a move, and keeps what it pushes off the canvas the
        // same way a drag does; see [`crate::tools::movetool`].
        let canvas = self.document.bounds();
        let Split { moving, mut stationary, left, keeps_offscreen } = split_for_move(&mut self.document, &self.selection);
        // Where the moved pixels were and where they have gone: a nudge held
        // down repeats at the keyboard's rate, and on a large document
        // recompositing all of it for each one cannot keep up.
        let dirty = moving
            .content_bounds()
            .map_or_else(Rect::default, |b| b.union(&Rect::new(b.x + dx, b.y + dy, b.w, b.h)))
            .intersect(&canvas);
        let moved = moving.translated(dx, dy);
        stationary.merge_translated_in(&moved.raster, moved.rect.x, moved.rect.y, &canvas);
        *self.document.active_surface_mut() = stationary;
        let outside = keeps_offscreen.then(|| Offscreen::outside(moved.rect, &moved.raster, canvas)).flatten();
        self.document.active_layer_mut().offscreen = Offscreen::merged(outside, left);
        self.selection = self.selection.translated(dx, dy);
        self.touch(dirty);
        true
    }

    /// Moves the selection outline by whole pixels, leaving the pixels where
    /// they are — the arrow keys with a marquee tool.
    pub fn nudge_selection(&mut self, dx: i32, dy: i32) -> bool {
        if self.selection.is_none() {
            return false;
        }
        self.record_coalescing(Snapshot::Nothing, "Move Selection", "nudge-selection");
        self.selection = self.selection.translated(dx, dy);
        self.touch_all();
        true
    }

    // ---- Canvas (every layer, undoable) -----------------------------------------

    pub fn rotate_canvas(&mut self, turns: i32) {
        let turn = canvas_turn(self.document.width(), self.document.height(), turns);
        self.structural("Rotate Canvas", |d| {
            d.rotate_canvas(turns);
            Ok(())
        })
        .expect("rotating cannot fail");
        let quarter = std::f64::consts::FRAC_PI_2 * f64::from(turns);
        self.remap_symmetry(|p| turn.apply(p), |a| a + quarter);
        // The canvas changed shape, so a selection in the old coordinates is
        // meaningless.
        self.selection = Selection::None;
    }

    /// Resizes the canvas as one undoable step, keeping the pixels at
    /// `(dx, dy)` in the new canvas — what dragging an edge does. The
    /// selection is dropped: it was in the old coordinates.
    pub fn resize_canvas(&mut self, width: u32, height: u32, dx: i32, dy: i32) -> bool {
        self.resize_canvas_as("Canvas Size", width, height, dx, dy)
    }

    fn resize_canvas_as(&mut self, label: &str, width: u32, height: u32, dx: i32, dy: i32) -> bool {
        if !canvas_fits(width, height) {
            return false;
        }
        if width == self.document.width() && height == self.document.height() && dx == 0 && dy == 0 {
            return false;
        }
        self.structural(label, |d| {
            d.resize_canvas(width, height, dx, dy);
            Ok(())
        })
        .expect("resizing cannot fail");
        let (dx, dy) = (f64::from(dx), f64::from(dy));
        self.remap_symmetry(|p| Point::new(p.x + dx, p.y + dy), |a| a);
        self.selection = Selection::None;
        true
    }

    /// Grows the canvas until everything the layers hold is inside it —
    /// chiefly a smart object placed or transformed past the edge, whose
    /// source still has the pixels. False when nothing is hiding out there,
    /// or when the canvas it would need is too big.
    pub fn reveal_all(&mut self) -> bool {
        let all = self.document.content_bounds();
        let bounds = self.document.bounds();
        if all == bounds {
            return false;
        }
        self.resize_canvas_as("Reveal All", all.w as u32, all.h as u32, -all.x, -all.y)
    }

    /// Crops the canvas to the selection's bounding box. False when nothing
    /// is selected.
    pub fn crop_to_selection(&mut self) -> bool {
        let Some(rect) = self.selection.rect() else { return false };
        let rect = rect.intersect(&self.document.bounds());
        if rect.is_empty() {
            return false;
        }
        self.resize_canvas_as("Crop", rect.w as u32, rect.h as u32, -rect.x, -rect.y)
    }

    /// Scales the whole picture to a new size — Image Size. The selection is
    /// dropped: it was in the old pixels.
    pub fn resize_image(&mut self, width: u32, height: u32) -> bool {
        if !canvas_fits(width, height) {
            return false;
        }
        if width == self.document.width() && height == self.document.height() {
            return false;
        }
        let (sx, sy) = (
            f64::from(width) / f64::from(self.document.width()),
            f64::from(height) / f64::from(self.document.height()),
        );
        self.structural("Image Size", |d| {
            d.resample(width, height);
            Ok(())
        })
        .expect("resampling cannot fail");
        self.remap_symmetry(|p| Point::new(p.x * sx, p.y * sy), |a| a);
        self.selection = Selection::None;
        true
    }

    pub fn flip_canvas_horizontal(&mut self) {
        let w = f64::from(self.document.width());
        self.structural("Flip Canvas", |d| {
            d.flip_canvas_horizontal();
            Ok(())
        })
        .expect("flipping cannot fail");
        // The picture is reflected, so the axes are too: the crossing point
        // lands across the canvas and the frame leans the other way.
        self.remap_symmetry(|p| Point::new(w - p.x, p.y), |a| -a);
    }

    pub fn flip_canvas_vertical(&mut self) {
        let h = f64::from(self.document.height());
        self.structural("Flip Canvas", |d| {
            d.flip_canvas_vertical();
            Ok(())
        })
        .expect("flipping cannot fail");
        self.remap_symmetry(|p| Point::new(p.x, h - p.y), |a| -a);
    }

    pub fn flatten(&mut self) {
        self.structural("Flatten Image", |d| {
            d.flatten();
            Ok(())
        })
        .expect("flattening cannot fail");
    }

    /// Copies the selected pixels of the active layer to a new layer above it.
    pub fn layer_via_copy(&mut self) -> usize {
        let clip = self.selection.clip(self.document.bounds());
        let index = self.structural("Layer via Copy", |d| Ok(d.layer_via_copy(clip))).expect("copying cannot fail");
        // The copy took the whole bounding box; a mask keeps only its own
        // pixels of it.
        if self.selection.needs_base() {
            let blank = Raster::new(self.document.width(), self.document.height());
            if let Some(layer) = self.document.layer_mut(index) {
                self.selection.apply(&mut layer.raster, &blank, &clip);
            }
        }
        index
    }

    // ---- Adjustment session (dialog with live preview) ---------------------------

    pub fn has_session(&self) -> bool {
        self.session.is_some()
    }

    pub fn is_adjusting(&self) -> bool {
        matches!(self.session, Some(Session::Adjust { .. } | Session::AdjustmentLayer { .. }))
    }

    pub fn is_transforming(&self) -> bool {
        matches!(self.session, Some(Session::Transform(_) | Session::TransformSelection { .. }))
    }

    /// Whether the open transform is of the selection outline rather than
    /// of pixels.
    pub fn is_transforming_selection(&self) -> bool {
        matches!(self.session, Some(Session::TransformSelection { .. }))
    }

    fn open_session(&mut self) -> Result<(), SessionError> {
        if self.session.is_some() {
            return Err(SessionError::Busy);
        }
        if !self.document.active_layer().visible {
            return Err(SessionError::Hidden);
        }
        self.abort_gesture();
        Ok(())
    }

    /// Starts previewing adjustments on the active surface's selected pixels
    /// — the layer's pixels, or its mask while that is the target.
    pub fn begin_adjustment(&mut self) -> Result<(), SessionError> {
        self.open_session()?;
        if let Some(why) = self.document.active_layer().edit_refusal() {
            return Err(SessionError::Uneditable(why));
        }
        let clip = self.selection.clip(self.document.bounds());
        self.session = Some(Session::Adjust { base: self.document.active_surface().clone(), clip, last: None });
        self.previewed = Some(Rect::default());
        self.hold_preview_base(self.document.active_index());
        Ok(())
    }

    /// Starts changing an adjustment layer's settings, with the canvas
    /// showing each change. The layer becomes active.
    pub fn begin_adjustment_layer(&mut self, index: usize) -> Result<(), SessionError> {
        let layer = self.document.layer(index).ok_or(SessionError::NotAdjustmentLayer)?;
        if layer.locked {
            return Err(SessionError::Uneditable(EditRefusal::Locked));
        }
        let before = layer.adjustment().ok_or(SessionError::NotAdjustmentLayer)?;
        self.set_active_layer(index).map_err(|_| SessionError::NotAdjustmentLayer)?;
        self.open_session()?;
        self.session = Some(Session::AdjustmentLayer { before });
        self.previewed = Some(Rect::default());
        self.hold_preview_base(index);
        Ok(())
    }

    /// The adjustment a layer applies, if it is an adjustment layer.
    pub fn layer_adjustment(&self, index: usize) -> Option<Adjustment> {
        self.document.layer(index)?.adjustment()
    }

    /// Shows `adjustment` applied to the original pixels (previews do not
    /// stack), or as the adjustment layer's new settings. The session must
    /// be open.
    pub fn preview_adjustment(&mut self, name: &str, params: &[f32]) -> Result<(), AdjustmentError> {
        let adjustment = Adjustment::from_params(name, params)?;
        self.refresh_small_preview();
        let is_layer = matches!(self.session, Some(Session::AdjustmentLayer { .. }));
        // With a reduced preview running, the page is not looking at the
        // full-size surface, so there is no reason to compute it — that is
        // where the saving is. Commit works it out once, from `last`.
        let reduced = self.preview_small(&adjustment, is_layer);
        // A full-size pass covers what the canvas is showing and no more: at
        // 1:1 most of a large document is off screen, and a filter costs its
        // area. `refresh_full_preview` catches up the rest when the view
        // moves. See [`Editor::previewed`].
        let shown = (!reduced).then(|| self.visible_rect());
        let stale = match shown {
            // Everything the pass before covered is composited again too:
            // outside the new rectangle the surface goes back to the pixels
            // the session started from.
            Some(rect) => rect.union(&self.previewed.unwrap_or_else(|| self.document.bounds())),
            // The reduced preview recomposites whole, so the rectangle only
            // has to say that something changed.
            None => self.document.bounds(),
        };
        match &mut self.session {
            Some(Session::Adjust { base, clip, last }) => {
                *last = Some(adjustment.clone());
                if let Some(shown) = shown {
                    let (base, clip) = (base.clone(), clip.intersect(&shown));
                    let mut out = base.clone();
                    adjustment.apply(&mut out, &clip);
                    self.selection.apply(&mut out, &base, &clip);
                    *self.document.active_surface_mut() = out;
                }
            }
            Some(Session::AdjustmentLayer { .. }) => {
                let index = self.document.active_index();
                self.document.set_adjustment(index, adjustment).map_err(|e| AdjustmentError(e.to_string()))?;
            }
            _ => return Err(AdjustmentError("no adjustment in progress".to_owned())),
        }
        self.previewed = shown;
        self.touch(stale);
        Ok(())
    }

    /// Puts `adjustment` into the reduced preview. Returns whether there was
    /// one, which is also whether the full-size pass can be skipped.
    fn preview_small(&mut self, adjustment: &Adjustment, is_layer: bool) -> bool {
        let Some(small) = self.preview_base.as_mut().and_then(|b| b.small.as_mut()) else {
            return false;
        };
        if is_layer {
            let _ = small.document.set_adjustment(small.edited, adjustment.clone());
        } else {
            let clip = small.selection.clip(small.document.bounds());
            let mut out = small.base.clone();
            adjustment.apply(&mut out, &clip);
            small.selection.apply(&mut out, &small.base, &clip);
            *small.document.active_surface_mut() = out;
        }
        true
    }

    /// Keeps whatever is currently previewed as one undo step.
    pub fn commit_session(&mut self) -> bool {
        self.preview_base = None;
        self.previewed = None;
        self.transform_shown = None;
        self.transform_small = None;
        let Some(session) = self.session.take() else { return false };
        match session {
            Session::Adjust { base, clip, last } => {
                // The full-size pass, once, whether or not the previews ran
                // at a reduced size. What the document keeps is always this.
                if let Some(adjustment) = last {
                    let mut out = base.clone();
                    adjustment.apply(&mut out, &clip);
                    self.selection.apply(&mut out, &base, &clip);
                    *self.document.active_surface_mut() = out;
                }
                let now = std::mem::replace(self.document.active_surface_mut(), base);
                self.record(Snapshot::of_active_layer(&self.document), "Adjustment");
                *self.document.active_surface_mut() = now;
            }
            Session::AdjustmentLayer { before } => {
                let index = self.document.active_index();
                let now = self.document.active_layer().adjustment().unwrap_or_else(|| before.clone());
                self.document.set_adjustment(index, before).expect("still the adjustment layer");
                self.record(Snapshot::of_structure(&self.document), "Edit Adjustment Layer");
                self.document.set_adjustment(index, now).expect("still the adjustment layer");
            }
            Session::Transform(t) => {
                let before = self.transform_base.take().expect("a transform keeps its base");
                let index = self.document.active_index();
                let (w, h) = (self.document.width(), self.document.height());
                let smart = before.is_smart() && !before.editing_mask();
                let label = if std::mem::take(&mut self.moving_smart) { "Move" } else { "Free Transform" };
                let rendered = t.render();
                *self.document.active_layer_mut() = before.clone();
                if smart {
                    self.record(Snapshot::Layer(before), label);
                    self.document.active_layer_mut().set_smart_transform(t.matrix(), w, h);
                } else {
                    self.record(Snapshot::of_layer(&self.document, index).expect("the active layer exists"), "Free Transform");
                    *self.document.active_surface_mut() = rendered;
                    // Pixels kept off the canvas belong to the layer, so a
                    // transform of the whole of it takes them along; one
                    // inside a selection cannot reach them. Unlike the move
                    // tool, what this pushes *over* the edge is still lost:
                    // the session works on the canvas surface alone.
                    if t.moved_selection().is_none() && !before.editing_mask() {
                        let matrix = t.matrix();
                        let layer = self.document.active_layer_mut();
                        layer.offscreen = layer.offscreen.as_ref().and_then(|kept| kept.placed(&matrix));
                        layer.settle_offscreen(w, h);
                    }
                }
                if let Some(rect) = t.moved_selection() {
                    self.selection.set_rect(rect);
                }
            }
            // The outline is already where the preview left it; the step
            // records where it was.
            Session::TransformSelection { before, .. } => {
                let aside = Aside { selection: before, ..self.aside() };
                self.history.push(Snapshot::Nothing, aside, "Transform Selection");
            }
            Session::Text { before } => {
                // Nothing typed, or nothing but spaces: as good as cancelled.
                // A layer of nothing would be invisible and baffling.
                let blank = self.document.active_layer().text().is_none_or(TextObject::is_blank);
                match before {
                    TextBefore::New(doc) if blank => self.document = doc,
                    TextBefore::New(doc) => self.record(Snapshot::Structure(doc), "Add Text"),
                    TextBefore::Edit(layer) if blank || *self.document.active_layer() == layer => {
                        *self.document.active_layer_mut() = layer;
                    }
                    TextBefore::Edit(layer) => self.record(Snapshot::Layer(layer), "Edit Text"),
                }
            }
        }
        self.touch_all();
        true
    }

    /// Puts the layer back the way it was before the session.
    pub fn cancel_session(&mut self) -> bool {
        self.preview_base = None;
        self.previewed = None;
        self.transform_shown = None;
        self.transform_small = None;
        let Some(session) = self.session.take() else { return false };
        match session {
            Session::Adjust { base, .. } => *self.document.active_surface_mut() = base,
            Session::AdjustmentLayer { before } => {
                let index = self.document.active_index();
                let _ = self.document.set_adjustment(index, before);
            }
            Session::Transform(_) => {
                self.moving_smart = false;
                if let Some(base) = self.transform_base.take() {
                    *self.document.active_layer_mut() = base;
                }
            }
            Session::TransformSelection { before, .. } => self.selection = before,
            Session::Text { before } => match before {
                TextBefore::New(doc) => self.document = doc,
                TextBefore::Edit(layer) => *self.document.active_layer_mut() = layer,
            },
        }
        self.touch_all();
        true
    }

    // ---- Transform session (Ctrl+T) ------------------------------------------------

    /// Starts a free transform of the selected pixels, or of the whole layer
    /// when nothing is selected. A smart object is transformed whole, from
    /// its source, so nothing is lost however many times it is done; its
    /// mask, while that is the target, transforms like any other pixels.
    pub fn begin_transform(&mut self) -> Result<(), SessionError> {
        self.open_session()?;
        let layer = self.document.active_layer();
        if let Some(why) = layer.edit_refusal() {
            if !matches!(why, EditRefusal::SmartObject | EditRefusal::TextLayer) {
                return Err(SessionError::Uneditable(why));
            }
        }
        if layer.keeps_alpha() {
            return Err(SessionError::Uneditable(EditRefusal::AlphaLocked));
        }
        let (w, h) = (self.document.width(), self.document.height());
        let session = match (layer.smart_object(), layer.editing_mask()) {
            (Some(object), false) => TransformSession::placed(object.source.clone(), Raster::new(w, h), object.transform),
            _ => {
                let surface = layer.surface();
                match self.selection.rect() {
                    // A selection hands over its own pixels: only it knows
                    // which ones it holds, and a mask holds less than its
                    // bounding box.
                    Some(rect) => {
                        let (moving, stationary) = self.selection.split(surface);
                        TransformSession::from_parts(moving, stationary, rect.intersect(&surface.bounds()), Some(rect))
                    }
                    None => TransformSession::new(surface, None),
                }
            }
        }
        .ok_or(SessionError::Empty)?;
        self.transform_base = Some(layer.clone());
        self.transform_shown = Some(session.rendered_bounds());
        self.hold_reduced_drag(&session);
        self.session = Some(Session::Transform(session));
        Ok(())
    }

    // ---- Text session (the text tool) ------------------------------------------------
    //
    // The engine has no fonts, so the page draws the text and hands the
    // picture over; what the engine keeps is the text and its style, and
    // the picture as a smart object's source (see `text.rs`, `layer.rs`).
    // Typing is a session: `begin_text_layer` or `begin_text_edit` opens
    // it, `preview_text` sets the layer again on every keystroke, and
    // `commit_session` records one undo step — or none, if nothing was
    // typed, in which case a new layer is taken away again.

    /// Starts a new text layer above the active one, its text's top-left
    /// corner at the screen point, in the options bar's style and the
    /// foreground colour. The layer is there from now on, empty, and goes
    /// again if the session ends with nothing typed. Returns its index.
    pub fn begin_text_layer(&mut self, screen: Point) -> Result<usize, SessionError> {
        if self.session.is_some() {
            return Err(SessionError::Busy);
        }
        self.abort_gesture();
        let at = self.viewport.screen_to_doc(screen);
        let before = self.document.clone();
        let text = TextObject::empty(self.settings.text.clone(), self.settings.color);
        // An empty picture, so the first rendering is anchored to the click
        // itself: its left edge, middle or right edge, by the alignment.
        let index = self.document.add_text_layer(text, Raster::new(0, 0), at);
        self.session = Some(Session::Text { before: TextBefore::New(before) });
        self.touch_all();
        Ok(index)
    }

    /// Starts editing the text of layer `index`, which becomes active. Its
    /// style and colour become the options bar's, so what the page shows
    /// and what it draws with agree.
    pub fn begin_text_edit(&mut self, index: usize) -> Result<(), SessionError> {
        let layer = self.document.layer(index).ok_or(SessionError::NotTextLayer)?;
        if layer.locked {
            return Err(SessionError::Uneditable(EditRefusal::Locked));
        }
        let text = layer.text().ok_or(SessionError::NotTextLayer)?.clone();
        self.set_active_layer(index).map_err(|_| SessionError::NotTextLayer)?;
        self.open_session()?;
        self.settings.text = text.style;
        self.settings.color = text.color;
        let before = self.document.active_layer().clone();
        self.session = Some(Session::Text { before: TextBefore::Edit(before) });
        Ok(())
    }

    /// Sets the text of the layer being edited: `text` as typed, `source`
    /// as the page has drawn it in the current style and foreground colour,
    /// with the block's top-left corner at `origin` within it. False when
    /// no text session is open.
    pub fn preview_text(&mut self, text: &str, origin: Point, source: Raster) -> bool {
        if !self.is_editing_text() {
            return false;
        }
        let object = TextObject { text: text.to_owned(), style: self.settings.text.clone(), color: self.settings.color, origin };
        let index = self.document.active_index();
        if self.document.set_text(index, object, source).is_err() {
            return false;
        }
        self.touch_all();
        true
    }

    pub fn is_editing_text(&self) -> bool {
        matches!(self.session, Some(Session::Text { .. }))
    }

    /// The text layer under a screen point, if there is one: what a click
    /// with the text tool edits rather than starting afresh.
    pub fn text_layer_at(&self, screen: Point) -> Option<usize> {
        self.document.text_layer_at(self.viewport.screen_to_doc(screen))
    }

    /// The text behind layer `index`, if it is a text layer.
    pub fn layer_text(&self, index: usize) -> Option<&TextObject> {
        self.document.layer(index)?.text()
    }

    /// Where a smart object's (or text layer's) source lands in the
    /// document: source pixels → document pixels. The page puts its text
    /// box through this so the caret sits on the letters.
    pub fn layer_placement(&self, index: usize) -> Option<Projective> {
        Some(self.document.layer(index)?.smart_object()?.transform)
    }

    /// Starts a free transform of the selection outline alone: the same
    /// handles, moving the marching ants rather than the pixels under them.
    pub fn begin_transform_selection(&mut self) -> Result<(), SessionError> {
        if self.session.is_some() {
            return Err(SessionError::Busy);
        }
        if self.selection.is_none() {
            return Err(SessionError::NoSelection);
        }
        self.abort_gesture();
        let bounds = self.document.bounds();
        let outline = selection_raster(&self.selection, bounds);
        let session = TransformSession::new(&outline, None).ok_or(SessionError::NoSelection)?;
        self.session = Some(Session::TransformSelection { session, before: self.selection.clone() });
        Ok(())
    }

    fn transform_session(&self) -> Option<&TransformSession> {
        match &self.session {
            Some(Session::Transform(t)) | Some(Session::TransformSelection { session: t, .. }) => Some(t),
            _ => None,
        }
    }

    /// Shows the transform where it now stands: the pixels re-rendered onto
    /// the layer, or the outline re-read into the selection.
    ///
    /// Only where the box was and where it is now can have changed, and that
    /// is all the composite is asked for: a line of type dragged across a 4K
    /// document costs its own rectangle, not eight million pixels a frame.
    fn refresh_transform(&mut self) {
        match &self.session {
            Some(Session::Transform(t)) => {
                let shown = t.rendered_bounds();
                let was = self.transform_shown.replace(shown);
                let small = self.preview_base.as_mut().and_then(|b| b.small.as_mut());
                if let (Some(twin), Some(small)) = (self.transform_small.as_mut(), small) {
                    // Zoomed out: the drag is drawn on the reduced copy, all
                    // of which is a fraction of the rectangle the full-size
                    // one would cost, and the document is left alone until
                    // the session commits.
                    twin.follow(&t.matrix(), small.step);
                    *small.document.active_surface_mut() = twin.render();
                } else {
                    match was {
                        // The surface still holds the last rendering, so only
                        // where the box was and where it is now is redrawn.
                        Some(was) => {
                            let dirty = was.union(&shown);
                            t.render_into(self.document.active_surface_mut(), &dirty);
                            self.touch(dirty);
                            return;
                        }
                        None => *self.document.active_surface_mut() = t.render(),
                    }
                }
            }
            Some(Session::TransformSelection { session, .. }) => {
                let rendered = session.render();
                self.selection.set_mask(mask_from_alpha(&rendered));
            }
            _ => return,
        }
        self.touch_all();
    }

    fn with_transform(&mut self, op: impl FnOnce(&mut TransformSession)) -> bool {
        let (Some(Session::Transform(t)) | Some(Session::TransformSelection { session: t, .. })) = &mut self.session else {
            return false;
        };
        op(t);
        self.refresh_transform();
        true
    }

    /// The transform box's eight handles in screen space, in
    /// [`crate::transform::Handle::ALL`] order.
    pub fn transform_handles(&self) -> Option<[Point; 8]> {
        let t = self.transform_session()?;
        Some(t.handles().map(|p| self.viewport.doc_to_screen(p)))
    }

    /// The rotation wheel in screen space: the one handle that is not on
    /// the box itself.
    pub fn transform_wheel(&self) -> Option<Point> {
        let t = self.transform_session()?;
        let tolerance = HANDLE_GRAB_PX / self.viewport.zoom();
        Some(self.viewport.doc_to_screen(t.wheel(tolerance)))
    }

    pub fn transform_info(&self) -> Option<TransformInfo> {
        self.transform_session().map(TransformSession::info)
    }

    /// What the pointer would grab at a screen position, for the cursor.
    pub fn transform_hit(&self, screen: Point) -> Option<Hit> {
        let t = self.transform_session()?;
        let tolerance = HANDLE_GRAB_PX / self.viewport.zoom();
        Some(t.hit(self.viewport.screen_to_doc(screen), tolerance))
    }

    pub fn transform_nudge(&mut self, dx: f64, dy: f64) -> bool {
        self.with_transform(|t| t.translate(dx, dy))
    }

    pub fn transform_rotate(&mut self, degrees: f64) -> bool {
        self.with_transform(|t| t.rotate(degrees.to_radians()))
    }

    pub fn transform_flip_horizontal(&mut self) -> bool {
        self.with_transform(TransformSession::flip_horizontal)
    }

    pub fn transform_flip_vertical(&mut self) -> bool {
        self.with_transform(TransformSession::flip_vertical)
    }

    /// Puts the box's top-left corner at a document position — the X and Y
    /// fields of the transform bar.
    pub fn transform_set_position(&mut self, x: f64, y: f64) -> bool {
        self.with_transform(|t| t.set_position(x, y))
    }

    /// Scales the box to a size in document pixels, about its top-left
    /// corner — the W and H fields.
    pub fn transform_set_size(&mut self, width: f64, height: f64) -> bool {
        if !(width > 0.0 && height > 0.0) {
            return false;
        }
        self.with_transform(|t| t.set_size(width, height))
    }

    /// Turns the box to an absolute angle, about its centre.
    pub fn transform_set_angle(&mut self, degrees: f64) -> bool {
        self.with_transform(|t| t.set_angle(degrees.to_radians()))
    }

    // ---- Selection -----------------------------------------------------------

    pub fn select_all(&mut self) {
        let all = Selection::Rect(self.document.bounds());
        self.selection_edit("Select All", |e| {
            let changed = e.selection != all;
            e.selection = all;
            changed
        });
    }

    pub fn deselect(&mut self) {
        self.selection_edit("Deselect", |e| {
            let changed = !e.selection.is_none();
            e.selection = Selection::None;
            changed
        });
    }

    pub fn selection_rect(&self) -> Option<Rect> {
        self.selection.rect()
    }

    /// The marching ants: closed loops in document coordinates, one per
    /// island and one per hole.
    pub fn selection_contours(&self) -> Vec<Vec<Point>> {
        self.selection.contours()
    }

    /// How many pixels are selected, for the status bar.
    pub fn selection_area(&self) -> usize {
        match self.selection() {
            Selection::None => 0,
            Selection::Rect(r) => r.area().max(0) as usize,
            Selection::Mask(m) => m.count(),
        }
    }

    /// The pixels the automatic selections read: the active surface, or the
    /// flattened image when the options bar asks for it.
    fn sample(&self) -> Raster {
        if self.settings.sample_all_layers {
            self.document.composite()
        } else {
            self.document.active_surface().clone()
        }
    }

    /// Swaps what is selected for what is not.
    pub fn invert_selection(&mut self) -> bool {
        self.selection_edit("Inverse", |e| {
            let bounds = e.document.bounds();
            e.selection.invert(bounds);
            true
        })
    }

    /// Moves the edge of the selection out or in by `pixels`.
    pub fn expand_selection(&mut self, pixels: u32) -> bool {
        self.selection_edit("Expand", |e| {
            let bounds = e.document.bounds();
            e.selection.modify(bounds, |m| m.grow(pixels))
        })
    }

    pub fn contract_selection(&mut self, pixels: u32) -> bool {
        self.selection_edit("Contract", |e| {
            let bounds = e.document.bounds();
            e.selection.modify(bounds, |m| m.contract(pixels))
        })
    }

    /// Fades the edge over `pixels`, so what is done inside fades out rather
    /// than stopping dead.
    pub fn feather_selection(&mut self, pixels: u32) -> bool {
        self.selection_edit("Feather", |e| {
            let bounds = e.document.bounds();
            e.selection.modify(bounds, |m| m.feather(pixels))
        })
    }

    /// Rounds off the edge, taking out spurs and nicks.
    pub fn smooth_selection(&mut self, pixels: u32) -> bool {
        self.selection_edit("Smooth", |e| {
            let bounds = e.document.bounds();
            e.selection.modify(bounds, |m| m.smooth(pixels))
        })
    }

    /// Selects everything a particular layer draws, whatever is active —
    /// what Ctrl-clicking its thumbnail asks for.
    pub fn select_layer_opaque(&mut self, index: usize, mode: SelectMode) -> Result<bool, DocumentError> {
        let raster = self.document.layer(index).ok_or(DocumentError::NoSuchLayer)?.rendered().into_owned();
        Ok(self.select_opaque_of(&raster, mode))
    }

    /// Selects everything the active layer actually draws — its opaque
    /// pixels — which is the exact selection for anything already cut out.
    pub fn select_opaque(&mut self, mode: SelectMode) -> bool {
        let source = self.sample();
        self.select_opaque_of(&source, mode)
    }

    fn select_opaque_of(&mut self, source: &Raster, mode: SelectMode) -> bool {
        let mask = mask_from_alpha(source);
        if mask.is_empty() {
            return false;
        }
        self.selection_edit("Select Layer Pixels", |e| {
            let bounds = e.document.bounds();
            e.selection.combine(&mask, mode, bounds);
            true
        })
    }

    /// Extends the selection to every pixel in the image that looks like one
    /// already in it, wherever it is — Photoshop's Select Similar.
    pub fn select_similar(&mut self) -> bool {
        if self.selection.is_none() {
            return false;
        }
        let source = self.sample();
        // A marquee may reach past the canvas; only the pixels there can be
        // read for what the selection is made of.
        let area = self.selection.clip(source.bounds());
        if area.is_empty() {
            return false;
        }
        let tolerance = self.settings.tolerance;
        let mut wanted = ColorSet::new();
        for y in area.y..area.bottom() {
            for x in area.x..area.right() {
                if self.selection.contains(x, y) {
                    wanted.add(source.get(x, y));
                }
            }
        }
        let mask = Mask::from_fn(source.width(), source.height(), |x, y| {
            u8::from(wanted.holds(source.get(x, y), tolerance)) * 255
        });
        self.selection_edit("Select Similar", |e| {
            let bounds = e.document.bounds();
            e.selection.combine(&mask, SelectMode::Add, bounds);
            true
        })
    }

    /// Selects the subject from a matte worked out elsewhere — the model the
    /// page can download and run. The matte is single-channel coverage at
    /// whatever resolution the model works in; everything after that (where
    /// the subject stops, dropping stray blobs, the soft edge) is the same
    /// for every matte, and lives in `autoselect::matte`.
    pub fn select_subject_from_matte(&mut self, matte: &[u8], matte_w: u32, matte_h: u32, mode: SelectMode) -> bool {
        let (w, h) = (self.document.width(), self.document.height());
        let mask = mask_from_matte(w, h, matte, matte_w, matte_h);
        if mask.is_empty() || mask.is_everything() {
            return false;
        }
        self.selection_edit("Select Subject", |e| {
            let bounds = e.document.bounds();
            e.selection.combine(&mask, mode, bounds);
            true
        })
    }

    // ---- The subject box -------------------------------------------------------------

    /// The box the subject tool has drawn out, waiting for the model.
    pub fn subject_box(&self) -> Option<Rect> {
        self.settings.subject_box
    }

    pub fn clear_subject_box(&mut self) {
        if self.settings.subject_box.take().is_some() {
            self.touch_all();
        }
    }

    /// The flattened picture inside `rect`, for the page to hand the model.
    /// How far the clone stamp's source is from a pointer at `at`, in whole
    /// pixels, or None when nothing has been anchored. The preview asks this
    /// so that what it shows and what the next dab copies cannot disagree.
    pub fn clone_source_offset(&self, at: Point) -> Option<(i32, i32)> {
        // Mid-stroke the offset is settled, aligned or not: the dab about to
        // land uses whatever the stroke fixed when it began.
        if self.gesture.is_some() {
            if let Some(kept) = self.settings.clone_offset {
                return Some(kept);
            }
        }
        crate::tools::clone_offset_for(&self.settings, at)
    }

    /// The source pixels under `rect`, as the clone stamp reads them — the
    /// flattened picture or the active layer alone, as the options bar says.
    /// Always `rect`'s size, so a patch hanging over an edge still lines up.
    pub fn clone_source_patch(&self, rect: Rect) -> Raster {
        if self.settings.sample_all_layers {
            self.document.composite().crop_padded(&rect)
        } else {
            self.document.active_surface().crop_padded(&rect)
        }
    }

    pub fn composite_crop(&self, rect: Rect) -> Raster {
        self.document.composite().crop(&rect)
    }

    /// A mask of the picture's size holding `small` at `rect`'s position.
    fn placed(&self, small: &Mask, rect: Rect) -> Mask {
        let (w, h) = (self.document.width(), self.document.height());
        Mask::from_fn(w, h, |x, y| {
            if rect.contains(x, y) {
                small.cover(x - rect.x, y - rect.y)
            } else {
                0
            }
        })
    }

    /// Selects the subject of the part of the picture in `rect`, from a
    /// matte the model made of that part alone. Clears the box either way.
    pub fn select_subject_in_box(&mut self, rect: Rect, matte: &[u8], matte_w: u32, matte_h: u32, mode: SelectMode) -> bool {
        self.settings.subject_box = None;
        self.touch_all();
        let rect = rect.intersect(&self.document.bounds());
        if rect.is_empty() {
            return false;
        }
        let small = mask_from_matte(rect.w as u32, rect.h as u32, matte, matte_w, matte_h);
        if small.is_empty() {
            return false;
        }
        let mask = self.placed(&small, rect);
        self.selection_edit("Select Subject", |e| {
            let bounds = e.document.bounds();
            e.selection.combine(&mask, mode, bounds);
            true
        })
    }

    /// The engine's own subject finder, run over `rect` alone: the fallback
    /// when the model is not available. Clears the box either way.
    pub fn select_subject_builtin_in_box(&mut self, rect: Rect, mode: SelectMode) -> bool {
        self.settings.subject_box = None;
        self.touch_all();
        let rect = rect.intersect(&self.document.bounds());
        if rect.is_empty() {
            return false;
        }
        let source = self.sample().crop(&rect);
        let small = select_subject(&source);
        if small.is_empty() || small.is_everything() {
            return false;
        }
        let mask = self.placed(&small, rect);
        self.selection_edit("Select Subject", |e| {
            let bounds = e.document.bounds();
            e.selection.combine(&mask, mode, bounds);
            true
        })
    }

    /// Finds the subject of the picture and selects it. False when there is
    /// nothing that stands out to select.
    pub fn select_subject(&mut self, mode: SelectMode) -> bool {
        let source = self.sample();
        let mask = select_subject(&source);
        if mask.is_empty() || mask.is_everything() {
            return false;
        }
        self.selection_edit("Select Subject", |e| {
            let bounds = e.document.bounds();
            e.selection.combine(&mask, mode, bounds);
            true
        })
    }

    // ---- Viewport ------------------------------------------------------------

    pub fn zoom(&self) -> f64 {
        self.viewport.zoom()
    }

    pub fn pan(&self) -> Point {
        self.viewport.pan()
    }

    pub fn pan_by(&mut self, dx: f64, dy: f64) {
        self.viewport.pan_by(dx, dy);
    }

    pub fn set_zoom_about(&mut self, zoom: f64, anchor: Point) {
        self.viewport.set_zoom_about(zoom, anchor);
    }

    pub fn zoom_by_about(&mut self, factor: f64, anchor: Point) {
        self.viewport.zoom_by_about(factor, anchor);
    }

    pub fn zoom_in_about(&mut self, anchor: Point) {
        let next = self.viewport.next_step_in();
        self.viewport.set_zoom_about(next, anchor);
    }

    pub fn zoom_out_about(&mut self, anchor: Point) {
        let next = self.viewport.next_step_out();
        self.viewport.set_zoom_about(next, anchor);
    }

    /// Tells the engine how big the window the document is drawn into is, in
    /// CSS pixels. The page reports it on resize; a zoom that has to fill the
    /// window — the zoom tool's marquee — needs it.
    pub fn set_view_size(&mut self, view_w: f64, view_h: f64) {
        self.viewport.set_view(view_w, view_h);
    }

    pub fn fit_to_view(&mut self, view_w: f64, view_h: f64) {
        self.viewport.fit(self.document.width(), self.document.height(), view_w, view_h);
    }

    pub fn zoom_to_actual_size(&mut self, view_w: f64, view_h: f64) {
        self.viewport.set_zoom_about(1.0, Point::default());
        self.viewport.center(self.document.width(), self.document.height(), view_w, view_h);
    }

    pub fn screen_to_doc(&self, screen: Point) -> Point {
        self.viewport.screen_to_doc(screen)
    }
}

/// A mask from a raster's alpha: partly transparent pixels are partly
/// selected, so the edge of a cut-out is already antialiased and stays so.
fn mask_from_alpha(source: &Raster) -> Mask {
    Mask::from_fn(source.width(), source.height(), |x, y| source.get(x, y).a)
}

/// The selection as a white raster whose alpha is the coverage — the pixels
/// a transform of the outline moves about.
fn selection_raster(selection: &Selection, bounds: Rect) -> Raster {
    let mut out = Raster::new(bounds.w.max(0) as u32, bounds.h.max(0) as u32);
    let area = selection.clip(bounds);
    for y in area.y..area.bottom() {
        for x in area.x..area.right() {
            let cover = selection.cover(x, y);
            if cover > 0 {
                out.set(x, y, Rgba::new(255, 255, 255, cover));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adjust::Kind;
    use crate::tools::Symmetry;

    const RED: Rgba = Rgba::opaque(255, 0, 0);

    fn editor() -> Editor {
        let mut e = Editor::new(20, 20, Rgba::WHITE);
        e.settings_mut().color = RED;
        e.settings_mut().size = 1;
        e.set_tool(ToolKind::Pencil);
        e
    }

    /// Paints the starting picture for a test straight onto the layer.
    fn paint(e: &mut Editor, mut f: impl FnMut(&mut Raster)) {
        f(&mut e.document.active_layer_mut().raster);
    }

    fn px(e: &Editor, x: i32, y: i32) -> Rgba {
        e.document().composite().get(x, y)
    }

    fn click(e: &mut Editor, x: f64, y: f64) {
        e.pointer_down(Point::new(x, y), false, false);
        e.pointer_up(Point::new(x, y), false, false);
    }

    #[test]
    fn alt_clicking_with_the_clone_stamp_anchors_the_source_without_a_step() {
        let mut e = editor();
        click(&mut e, 4.0, 4.0);
        e.set_tool(ToolKind::Clone);
        let steps = e.history_labels().len();

        // Alt marks where to copy from. It paints nothing and is not a step:
        // there is no state of the document for it to undo back to.
        e.pointer_down(Point::new(4.0, 4.0), false, true);
        e.pointer_up(Point::new(4.0, 4.0), false, true);
        assert_eq!(e.settings().clone_anchor, Some(Point::new(4.0, 4.0)));
        assert_eq!(e.history_labels().len(), steps);
        assert_eq!(px(&e, 4, 4), RED, "the pixel it anchored on is untouched");

        // And then a plain stroke copies from there.
        click(&mut e, 12.0, 12.0);
        assert_eq!(px(&e, 12, 12), RED);
        assert_eq!(e.history_labels().last().map(String::as_str), Some("Clone Stamp"));
    }

    #[test]
    fn the_clone_preview_reads_the_offset_the_next_dab_would_use() {
        let mut e = editor();
        click(&mut e, 4.0, 4.0);
        e.set_tool(ToolKind::Clone);
        assert_eq!(e.clone_source_offset(Point::new(12.0, 12.0)), None, "nothing anchored yet");

        e.pointer_down(Point::new(4.0, 4.0), false, true);
        e.pointer_up(Point::new(4.0, 4.0), false, true);
        assert_eq!(e.clone_source_offset(Point::new(12.0, 12.0)), Some((-8, -8)));

        // Once a stroke has fixed the offset, an aligned preview keeps it
        // wherever the pointer goes next; an unaligned one takes it afresh.
        click(&mut e, 12.0, 12.0);
        assert_eq!(e.clone_source_offset(Point::new(15.0, 15.0)), Some((-8, -8)));
        e.settings_mut().clone_aligned = false;
        assert_eq!(e.clone_source_offset(Point::new(15.0, 15.0)), Some((-11, -11)));

        // And the patch it shows is the source, padded where it hangs over
        // the edge so that what is drawn still lines up with the ring.
        let patch = e.clone_source_patch(Rect::new(3, 3, 3, 3));
        assert_eq!((patch.width(), patch.height()), (3, 3));
        assert_eq!(patch.get(1, 1), RED, "the anchored pixel, in the middle");
        let over_the_edge = e.clone_source_patch(Rect::new(-1, -1, 3, 3));
        assert_eq!((over_the_edge.width(), over_the_edge.height()), (3, 3));
    }

    #[test]
    fn the_clone_stamp_does_nothing_until_it_has_a_source() {
        let mut e = editor();
        e.set_tool(ToolKind::Clone);
        let steps = e.history_labels().len();
        click(&mut e, 12.0, 12.0);
        assert_eq!(px(&e, 12, 12), Rgba::WHITE);
        assert_eq!(e.history_labels().len(), steps, "and it is not an undo step either");
    }

    #[test]
    fn a_stroke_paints_and_undoes() {
        let mut e = editor();
        assert!(e.take_dirty().is_some(), "a new editor needs a first render");
        assert!(e.take_dirty().is_none());

        click(&mut e, 3.0, 3.0);
        assert_eq!(px(&e, 3, 3), RED);
        assert!(e.take_dirty().is_some());
        assert!(e.can_undo());

        assert!(e.undo());
        assert_eq!(px(&e, 3, 3), Rgba::WHITE);
        assert!(e.redo());
        assert_eq!(px(&e, 3, 3), RED);
    }

    #[test]
    fn pointer_positions_go_through_the_viewport() {
        let mut e = editor();
        e.set_zoom_about(4.0, Point::default());
        e.pan_by(8.0, 8.0);
        // Screen (20, 20) → doc ((20 - 8) / 4) = 3.
        click(&mut e, 20.0, 20.0);
        assert_eq!(px(&e, 3, 3), RED);
        assert_eq!(px(&e, 20, 20), Rgba::TRANSPARENT, "off the document");
    }

    #[test]
    fn move_and_up_without_down_do_nothing() {
        let mut e = editor();
        assert!(!e.pointer_move(Point::new(1.0, 1.0), false, false, false));
        assert!(!e.pointer_up(Point::new(1.0, 1.0), false, false));
        assert!(!e.can_undo());
    }

    #[test]
    fn cancelling_a_gesture_leaves_no_undo_step() {
        let mut e = editor();
        e.pointer_down(Point::new(1.0, 1.0), false, false);
        e.pointer_move(Point::new(9.0, 9.0), false, false, false);
        assert!(e.cancel_gesture());
        assert_eq!(px(&e, 5, 5), Rgba::WHITE);
        assert!(!e.can_undo(), "nothing happened, so nothing to undo");
        assert!(!e.is_gesturing());
    }

    #[test]
    fn switching_tools_mid_drag_cancels_it() {
        let mut e = editor();
        e.set_tool(ToolKind::Rectangle);
        e.pointer_down(Point::new(0.0, 0.0), false, false);
        e.pointer_move(Point::new(10.0, 10.0), false, false, false);
        assert_eq!(px(&e, 5, 5), RED);
        e.set_tool(ToolKind::Brush);
        assert_eq!(px(&e, 5, 5), Rgba::WHITE);
        assert!(!e.is_gesturing());
    }

    #[test]
    fn marquee_is_an_undo_step_and_constrains_paint() {
        let mut e = editor();
        e.set_tool(ToolKind::Select);
        e.pointer_down(Point::new(0.0, 0.0), false, false);
        e.pointer_up(Point::new(5.0, 5.0), false, false);
        assert_eq!(e.selection_rect(), Some(Rect::new(0, 0, 5, 5)));
        assert_eq!(e.history_labels(), vec!["Select"]);
        assert!(e.undo());
        assert_eq!(e.selection_rect(), None, "undo takes the marquee away");
        assert!(e.redo());
        assert_eq!(e.selection_rect(), Some(Rect::new(0, 0, 5, 5)));
        // A gesture that changes nothing is not a step.
        e.set_tool(ToolKind::Hand);
        click(&mut e, 1.0, 1.0);
        assert_eq!(e.history_labels().len(), 1);

        e.set_tool(ToolKind::Pencil);
        click(&mut e, 2.0, 2.0);
        click(&mut e, 10.0, 10.0);
        assert_eq!(px(&e, 2, 2), RED);
        assert_eq!(px(&e, 10, 10), Rgba::WHITE);

        e.deselect();
        click(&mut e, 10.0, 10.0);
        assert_eq!(px(&e, 10, 10), RED);
    }

    /// A cross of opaque pixels on a transparent layer, which `select_opaque`
    /// turns into a mask that is not a rectangle.
    fn crossed() -> Editor {
        let mut e = Editor::new(20, 20, Rgba::TRANSPARENT);
        paint(&mut e, |raster| {
            for i in 0..20 {
                raster.set(i, 10, Rgba::BLACK);
                raster.set(10, i, Rgba::BLACK);
            }
        });
        e
    }

    #[test]
    fn a_mask_selection_holds_the_brush_to_its_shape() {
        let mut e = crossed();
        assert!(e.select_opaque(SelectMode::Replace));
        assert!(e.selection().mask().is_some(), "a cross is not a rectangle");

        e.settings_mut().color = RED;
        e.set_tool(ToolKind::Pencil);
        e.settings_mut().size = 9;
        click(&mut e, 10.0, 5.0);
        assert_eq!(px(&e, 10, 5), RED, "on the arm of the cross: painted");
        assert_eq!(px(&e, 7, 5), Rgba::TRANSPARENT, "beside it: untouched");
    }

    #[test]
    fn a_mask_selection_holds_a_fill_to_its_shape() {
        let mut e = crossed();
        e.select_opaque(SelectMode::Replace);
        e.settings_mut().color = RED;
        assert!(e.fill_selection());
        assert_eq!(px(&e, 3, 10), RED);
        assert_eq!(px(&e, 3, 11), Rgba::TRANSPARENT);
        assert!(e.undo());
        assert_eq!(px(&e, 3, 10), Rgba::BLACK, "one undo step, all of it");
    }

    #[test]
    fn a_feathered_selection_fades_what_is_done_inside_it() {
        let mut e = Editor::new(40, 40, Rgba::WHITE);
        e.select_all();
        e.contract_selection(12);
        assert!(e.feather_selection(6));
        e.settings_mut().color = RED;
        assert!(e.fill_selection());
        assert_eq!(px(&e, 20, 20), RED, "the middle is filled outright");
        let edge = px(&e, 20, 13);
        assert!(edge != RED && edge != Rgba::WHITE, "and the edge is part way: {edge:?}");
    }

    #[test]
    fn the_selection_can_be_inverted_expanded_and_contracted() {
        let mut e = editor();
        e.set_tool(ToolKind::Select);
        e.pointer_down(Point::new(4.0, 4.0), false, false);
        e.pointer_up(Point::new(8.0, 8.0), false, false);
        assert!(e.expand_selection(2));
        assert_eq!(e.selection_rect(), Some(Rect::new(2, 2, 8, 8)));
        assert!(e.contract_selection(2));
        assert_eq!(e.selection_rect(), Some(Rect::new(4, 4, 4, 4)));
        assert!(e.invert_selection());
        assert!(!e.selection().contains(5, 5));
        assert!(e.selection().contains(0, 0));
    }

    #[test]
    fn a_mask_selection_moves_only_the_pixels_it_holds() {
        let mut e = crossed();
        e.select_opaque(SelectMode::Replace);
        e.set_tool(ToolKind::Move);
        e.pointer_down(Point::new(10.0, 10.0), false, false);
        e.pointer_up(Point::new(10.0, 13.0), false, false);
        assert_eq!(px(&e, 3, 13), Rgba::BLACK, "the arm came down with it");
        assert_eq!(px(&e, 3, 10), Rgba::TRANSPARENT, "and left nothing behind");
    }

    #[test]
    fn transforming_a_mask_selection_takes_only_its_pixels() {
        let mut e = crossed();
        e.select_opaque(SelectMode::Replace);
        e.begin_transform().unwrap();
        e.transform_nudge(0.0, 4.0);
        assert!(e.commit_session());
        assert_eq!(px(&e, 3, 14), Rgba::BLACK);
        assert_eq!(px(&e, 3, 10), Rgba::TRANSPARENT);
        assert!(e.selection_rect().is_some(), "and the marquee went with it");
    }

    #[test]
    fn select_similar_reaches_the_matching_pixels_elsewhere() {
        let mut e = Editor::new(20, 20, Rgba::WHITE);
        paint(&mut e, |raster| {
            for (x, y) in [(2, 2), (3, 2), (2, 3), (3, 3), (15, 15), (16, 15)] {
                raster.set(x, y, RED);
            }
        });
        e.set_tool(ToolKind::Select);
        e.pointer_down(Point::new(2.0, 2.0), false, false);
        e.pointer_up(Point::new(4.0, 4.0), false, false);
        assert!(e.select_similar());
        assert!(e.selection().contains(15, 15), "the far red pixels joined in");
        assert!(!e.selection().contains(10, 10), "the white ones did not");
    }

    #[test]
    fn selecting_the_subject_finds_it_and_says_when_it_cannot() {
        let mut e = Editor::new(100, 100, Rgba::opaque(240, 240, 238));
        paint(&mut e, |raster| {
            for y in 30..70 {
                for x in 30..70 {
                    raster.set(x, y, Rgba::opaque(40, 90, 180));
                }
            }
        });
        assert!(e.select_subject(SelectMode::Replace));
        assert!(e.selection().contains(50, 50));
        assert!(!e.selection().contains(5, 5));

        let mut flat = Editor::new(60, 60, Rgba::WHITE);
        assert!(!flat.select_subject(SelectMode::Replace), "nothing to find in a blank sheet");
        assert!(flat.selection().is_none());
    }

    #[test]
    fn a_matte_from_outside_becomes_a_selection() {
        let mut e = Editor::new(64, 64, Rgba::WHITE);
        let mut matte = vec![0u8; 16 * 16];
        for y in 4..12 {
            for x in 4..12 {
                matte[y * 16 + x] = 255;
            }
        }
        assert!(e.select_subject_from_matte(&matte, 16, 16, SelectMode::Replace));
        assert!(e.selection().contains(32, 32));
        assert!(!e.selection().contains(2, 2));
        assert!(!e.select_subject_from_matte(&[0u8; 256], 16, 16, SelectMode::Replace), "an empty matte selects nothing");
    }

    #[test]
    fn a_canvas_too_big_to_hold_is_refused_rather_than_attempted() {
        let mut e = editor();
        assert!(!e.resize_canvas(200_000, 200_000, 0, 0), "40 gigabytes of pixels");
        assert!(!e.resize_canvas(MAX_SIDE + 1, 10, 0, 0), "too wide");
        assert!(!e.resize_canvas(20_000, 20_000, 0, 0), "each side fits, the area does not");
        assert!(!e.resize_canvas(0, 10, 0, 0));
        assert_eq!((e.document().width(), e.document().height()), (20, 20), "and nothing happened");
        assert!(e.resize_canvas(6000, 4000, 0, 0), "a 24 megapixel photo is fine");
    }

    #[test]
    fn the_canvas_can_be_resized_from_any_edge_and_undone() {
        let mut e = editor();
        paint(&mut e, |r| r.set(1, 1, RED));
        e.select_all();
        assert!(e.resize_canvas(30, 20, 10, 0), "dragging the left edge out");
        assert_eq!((e.document().width(), e.document().height()), (30, 20));
        assert_eq!(px(&e, 11, 1), RED, "the picture moved with the edge");
        assert!(e.selection_rect().is_none(), "the old selection is meaningless now");
        assert!(e.undo());
        assert_eq!((e.document().width(), e.document().height()), (20, 20));
        assert_eq!(px(&e, 1, 1), RED);
        assert!(!e.resize_canvas(20, 20, 0, 0), "the same size is not a change");
    }

    #[test]
    fn a_layer_can_be_selected_without_making_it_active() {
        let mut e = Editor::new(20, 20, Rgba::TRANSPARENT);
        paint(&mut e, |r| r.set(2, 2, RED));
        let top = e.add_layer();
        paint(&mut e, |r| r.set(15, 15, Rgba::BLACK));
        assert_eq!(e.document().active_index(), top);

        assert!(e.select_layer_opaque(0, SelectMode::Replace).unwrap(), "the layer below");
        assert!(e.selection().contains(2, 2));
        assert!(!e.selection().contains(15, 15));
        assert_eq!(e.document().active_index(), top, "and it stayed active");
        assert!(e.select_layer_opaque(9, SelectMode::Replace).is_err());
    }

    #[test]
    fn the_ants_follow_the_shape_of_the_selection() {
        let mut e = crossed();
        assert!(e.selection_contours().is_empty(), "nothing selected, nothing to draw");
        e.select_opaque(SelectMode::Replace);
        assert!(!e.selection_contours().is_empty());
        assert!(e.selection_area() > 0);
    }

    #[test]
    fn painting_on_a_hidden_layer_is_refused() {
        let mut e = editor();
        e.set_layer_visible(0, false).unwrap();
        assert!(!e.pointer_down(Point::new(1.0, 1.0), false, false));
        assert!(!e.is_gesturing());
    }

    #[test]
    fn layer_operations_are_undoable() {
        let mut e = editor();
        e.add_layer();
        assert_eq!(e.document().layers().len(), 2);
        assert_eq!(e.document().active_index(), 1);
        click(&mut e, 4.0, 4.0);
        e.set_layer_opacity(1, 0.5).unwrap();
        assert!(px(&e, 4, 4).r == 255 && px(&e, 4, 4).g > 100, "half red over white");

        assert!(e.undo()); // opacity
        assert_eq!(px(&e, 4, 4), RED);
        assert!(e.undo()); // the stroke
        assert_eq!(px(&e, 4, 4), Rgba::WHITE);
        assert!(e.undo()); // the layer
        assert_eq!(e.document().layers().len(), 1);
        assert!(!e.can_undo());

        assert!(e.redo());
        assert!(e.redo());
        assert_eq!(px(&e, 4, 4), RED);
    }

    #[test]
    fn an_opacity_drag_is_one_undo_step() {
        let mut e = editor();
        for pct in [90, 70, 50, 30] {
            e.set_layer_opacity(0, pct as f32 / 100.0).unwrap();
        }
        assert!(e.undo());
        assert_eq!(e.document().layer(0).unwrap().opacity, 1.0);
        assert!(!e.can_undo());
    }

    #[test]
    fn opening_an_image_replaces_the_document() {
        let mut e = editor();
        click(&mut e, 1.0, 1.0);
        e.open_image("cat.png", Raster::filled(7, 5, RED));
        assert_eq!((e.document().width(), e.document().height()), (7, 5));
        assert_eq!(e.document().layer(0).unwrap().name, "cat.png");
        assert!(e.document().layer(0).unwrap().is_smart(), "an opened picture keeps its own pixels");
        assert!(!e.can_undo());
    }

    #[test]
    fn layer_errors_do_not_leave_history_entries() {
        let mut e = editor();
        assert_eq!(e.remove_layer(0), Err(DocumentError::LastLayer));
        assert_eq!(e.merge_down(0), Err(DocumentError::NothingBelow));
        assert_eq!(e.set_layer_opacity(9, 0.5), Err(DocumentError::NoSuchLayer));
        assert!(!e.can_undo());
    }

    #[test]
    fn moving_a_layer_to_itself_is_free() {
        let mut e = editor();
        e.add_layer();
        assert!(e.move_layer_to(1, 1, Drop::Above).is_ok());
        assert_eq!(e.document().layers().len(), 2);
        // Only the add is in the history.
        assert!(e.undo());
        assert!(!e.can_undo());
    }

    #[test]
    fn grouping_is_one_undo_step_and_puts_the_picture_back() {
        let mut e = editor();
        let painted = e.add_layer();
        paint(&mut e, |r| { let all = r.bounds(); r.fill_rect(Rect::new(5, 5, 4, 1), RED, &all) });
        let before = e.document().composite();

        let group = e.group_layer(painted).unwrap();
        assert_eq!(e.document().layer(group).unwrap().kind.name(), "group");
        assert_eq!(e.document().composite(), before, "a new group is pass-through and changes nothing");

        // Painting inside the group still reaches the canvas.
        e.set_active_layer(painted).unwrap();
        click(&mut e, 6.0, 9.0);
        assert_eq!(e.document().composite().get(6, 9), RED);

        // Hiding the group takes the layer off screen without touching it.
        e.set_layer_visible(group, false).unwrap();
        assert_eq!(e.document().composite().get(6, 9), Rgba::WHITE);
        assert!(e.document().hidden_by_group(painted));
        assert!(e.undo(), "one step put the group back on");
        assert_eq!(e.document().composite().get(6, 9), RED);
    }

    #[test]
    fn a_layer_inside_a_group_previews_through_the_group() {
        let mut e = editor();
        let lower = e.add_layer();
        let group = e.group_layer(lower).unwrap();
        // A second layer inside the group, above the first, so the layer
        // being edited is not itself the bottom of the group.
        e.set_active_layer(lower).unwrap();
        let painted = e.add_layer();
        paint(&mut e, |r| {
            let all = r.bounds();
            r.fill_rect(Rect::new(5, 5, 5, 1), RED, &all)
        });
        let group = group + 1;
        assert_eq!(e.document().depth(painted), 1);
        e.set_layer_opacity(group, 0.5).unwrap();
        e.set_active_layer(painted).unwrap();

        // The session's cache may only cut the stack between top-level
        // items, so a layer inside a group holds from below the group
        // rather than from just below itself.
        e.begin_adjustment().unwrap();
        assert_eq!(e.preview_base.as_ref().map(|b| (b.index, b.edited)), Some((lower, painted)));

        // What the preview draws has to be what the same adjustment applied
        // for good would draw — the group's opacity included.
        let mut direct = e.document().clone();
        let all = direct.bounds();
        let invert = Adjustment::from_params("invert", &[]).unwrap();
        invert.apply(&mut direct.layer_mut(painted).unwrap().raster, &all);
        let expected = direct.composite();

        e.preview_adjustment("invert", &[]).unwrap();
        let mut frame = Raster::new(20, 20);
        e.composite_into(&mut frame, &all);
        assert_eq!(frame.get(6, 5), expected.get(6, 5), "the group's opacity is still in the preview");
        assert_eq!(frame.get(0, 0), expected.get(0, 0));
        e.cancel_session();
    }

    #[test]
    fn the_panel_selection_is_what_group_and_delete_act_on() {
        let mut e = editor();
        let a = e.add_layer();
        let b = e.add_layer();
        assert_eq!(e.selected_layers(), vec![b], "the active layer alone, to start with");

        // Ctrl-clicking another row adds it; the active layer stays put.
        e.toggle_layer_selected(a).unwrap();
        assert_eq!(e.selected_layers(), vec![a, b]);
        assert_eq!(e.document().active_index(), b);
        assert!(e.layer_is_selected(a) && e.layer_is_selected(b) && !e.layer_is_selected(0));

        // Grouping takes both, and leaves the group as the selection.
        let group = e.group_selected_layers().unwrap();
        assert_eq!(e.document().layers().len(), 4);
        assert_eq!(e.document().children_of(group), 1..3);
        assert_eq!(e.selected_layers(), vec![group]);
        assert!(e.undo(), "grouping two layers is one step");
        assert_eq!(e.document().layers().len(), 3);
    }

    #[test]
    fn clicking_past_the_rows_picks_out_nothing_at_all() {
        let mut e = editor();
        let top = e.add_layer();
        assert!(e.layer_is_selected(top));

        e.clear_layer_selection();
        assert!(!e.layer_is_selected(0) && !e.layer_is_selected(top), "no row is picked out");
        assert!(e.selected_layers().is_empty());
        // The tools still have somewhere to paint — the document always has
        // an active layer — but nothing the panel does has a subject.
        assert_eq!(e.document().active_index(), top);
        assert_eq!(e.group_selected_layers(), Err(DocumentError::NoSuchLayer));
        assert_eq!(e.remove_selected_layers(), Err(DocumentError::NoSuchLayer));
        assert_eq!(e.document().layers().len(), 2, "and nothing happened");

        // Clicking a row picks it out again, and so does Ctrl- or
        // Shift-clicking, which have no anchor to work from.
        e.toggle_layer_selected(0).unwrap();
        assert_eq!(e.selected_layers(), vec![0]);
        e.clear_layer_selection();
        e.select_layer_range(top).unwrap();
        assert_eq!(e.selected_layers(), vec![top]);
    }

    #[test]
    fn shift_clicking_takes_the_run_between_the_active_layer_and_the_row() {
        let mut e = editor();
        e.add_layer();
        e.add_layer();
        let top = e.add_layer();
        assert_eq!(top, 3);
        e.set_active_layer(1).unwrap();
        e.select_layer_range(3).unwrap();
        assert_eq!(e.selected_layers(), vec![1, 2, 3]);
        assert_eq!(e.document().active_index(), 1, "the anchor does not move");
        // Shrinking it again from the same anchor.
        e.select_layer_range(2).unwrap();
        assert_eq!(e.selected_layers(), vec![1, 2]);
        // And a plain click is a selection of one.
        e.set_active_layer(0).unwrap();
        assert_eq!(e.selected_layers(), vec![0]);
    }

    #[test]
    fn deleting_a_whole_selection_is_refused_rather_than_emptying_the_document() {
        let mut e = editor();
        e.add_layer();
        e.select_layer_range(0).unwrap();
        assert_eq!(e.selected_layers(), vec![0, 1]);
        let steps = e.history_labels().len();
        assert_eq!(e.remove_selected_layers(), Err(DocumentError::LastLayer));
        assert_eq!(e.document().layers().len(), 2, "and nothing was deleted on the way");
        assert_eq!(e.history_labels().len(), steps, "a refusal leaves no step behind");
    }

    #[test]
    fn duplicating_a_selection_copies_every_layer_and_selects_the_copies() {
        let mut e = editor();
        let middle = e.add_layer();
        e.add_layer();
        // The background and the middle layer, with the top one left out.
        e.set_active_layer(0).unwrap();
        e.toggle_layer_selected(middle).unwrap();
        e.duplicate_selected_layers().unwrap();

        let names: Vec<&str> = e.document().layers().iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["Background", "Background copy", "Layer 2", "Layer 2 copy", "Layer 3"]);
        // The copies are what is selected now, not whatever slid into their
        // old indices.
        let selected: Vec<&str> = e.selected_layers().iter().map(|&i| e.document().layers()[i].name.as_str()).collect();
        assert_eq!(selected, vec!["Background copy", "Layer 2 copy"]);
        assert_eq!(e.document().active_layer().name, "Layer 2 copy");
        assert!(e.undo(), "duplicating a selection is one step");
        assert_eq!(e.document().layers().len(), 3);
    }

    #[test]
    fn dropping_a_layer_back_where_it_was_is_free_but_a_real_move_is_not() {
        let mut e = editor();
        e.add_layer();
        // Two layers: Background at 0, Layer 2 at 1.
        let steps = e.history_labels().len();
        // Above the row already under it, and below the row already over
        // it, are both where it already is.
        assert_eq!(e.move_layer_to(1, 0, Drop::Above), Ok(1));
        assert_eq!(e.move_layer_to(0, 1, Drop::Below), Ok(0));
        assert_eq!(e.history_labels().len(), steps, "neither left a step behind");

        // But the bottom layer dropped *above* the top one really moves.
        assert_eq!(e.move_layer_to(0, 1, Drop::Above), Ok(1));
        let names: Vec<&str> = e.document().layers().iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["Layer 2", "Background"]);
        assert_eq!(e.history_labels().len(), steps + 1);

        // And the row now on top dropped below the other one, with
        // nothing selected but the active layer, which has not moved.
        assert_eq!(e.document().active_layer().name, "Layer 2");
        assert_eq!(e.selected_layers(), vec![0], "the active layer alone");
        assert_eq!(e.move_layer_to(1, 0, Drop::Below), Ok(0));
        let names: Vec<&str> = e.document().layers().iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["Background", "Layer 2"]);
    }

    #[test]
    fn a_selection_of_layers_drags_together() {
        let mut e = editor();
        let a = e.add_layer();
        let b = e.add_layer();
        e.set_active_layer(a).unwrap();
        e.toggle_layer_selected(b).unwrap();
        // Dragging one of them below the background takes both.
        e.move_layer_to(a, 0, Drop::Below).unwrap();
        let names: Vec<&str> = e.document().layers().iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["Layer 2", "Layer 3", "Background"]);
    }

    #[test]
    fn deleting_a_group_takes_its_contents_and_one_undo_brings_them_back() {
        let mut e = editor();
        let painted = e.add_layer();
        let group = e.group_layer(painted).unwrap();
        assert_eq!(e.document().layers().len(), 3);
        e.remove_layer(group).unwrap();
        assert_eq!(e.document().layers().len(), 1);
        assert!(e.undo());
        assert_eq!(e.document().layers().len(), 3);
    }

    #[test]
    fn rename_ignores_blank_names() {
        let mut e = editor();
        e.rename_layer(0, "   ").unwrap();
        assert_eq!(e.document().layer(0).unwrap().name, "Background");
        e.rename_layer(0, " Sky ").unwrap();
        assert_eq!(e.document().layer(0).unwrap().name, "Sky");
    }

    #[test]
    fn clear_and_fill_respect_the_selection() {
        let mut e = editor();
        e.set_tool(ToolKind::Select);
        e.pointer_down(Point::new(0.0, 0.0), false, false);
        e.pointer_up(Point::new(2.0, 2.0), false, false);

        assert!(e.clear_selection());
        assert_eq!(px(&e, 1, 1), Rgba::TRANSPARENT);
        assert_eq!(px(&e, 5, 5), Rgba::WHITE);

        assert!(e.fill_selection());
        assert_eq!(px(&e, 1, 1), RED);
        assert_eq!(px(&e, 5, 5), Rgba::WHITE);

        e.undo();
        e.undo();
        assert_eq!(px(&e, 1, 1), Rgba::WHITE);
    }

    #[test]
    fn select_all_and_clear_wipes_the_layer() {
        let mut e = editor();
        e.select_all();
        assert_eq!(e.selection_rect(), Some(Rect::new(0, 0, 20, 20)));
        e.deselect();
        assert!(e.clear_selection(), "no selection means the whole layer");
        assert!(e.document().composite().pixels().iter().all(|p| p.a == 0));
    }

    #[test]
    fn a_new_document_forgets_history_and_selection() {
        let mut e = editor();
        click(&mut e, 1.0, 1.0);
        e.select_all();
        e.new_document(5, 5, Rgba::TRANSPARENT);
        assert_eq!(e.document().width(), 5);
        assert!(!e.can_undo());
        assert_eq!(e.selection_rect(), None);
        assert_eq!(e.tool(), ToolKind::Pencil, "the tool survives");
    }

    #[test]
    fn opening_an_image_adds_a_named_layer() {
        let mut e = editor();
        let photo = Raster::filled(20, 20, RED);
        let index = e.add_layer_from("photo.png", photo).unwrap();
        assert_eq!(e.document().layer(index).unwrap().name, "photo.png");
        assert_eq!(px(&e, 0, 0), RED);
        assert_eq!(e.add_layer_from("x", Raster::new(1, 1)), Err(DocumentError::SizeMismatch));
    }

    #[test]
    fn adjustment_session_previews_then_commits_one_step() {
        let mut e = editor();
        e.begin_adjustment().unwrap();
        assert_eq!(e.begin_adjustment(), Err(SessionError::Busy));
        e.preview_adjustment("invert", &[]).unwrap();
        assert_eq!(px(&e, 0, 0), Rgba::BLACK);
        e.preview_adjustment("brightness-contrast", &[-50.0, 0.0]).unwrap();
        assert_eq!(px(&e, 0, 0).r, 128, "previews replace, they do not stack");
        assert!(e.preview_adjustment("sepia", &[]).is_err());
        assert!(e.commit_session());
        assert!(!e.has_session());
        let committed = px(&e, 0, 0);
        assert!(e.undo());
        assert_eq!(px(&e, 0, 0), Rgba::WHITE);
        assert!(e.redo());
        assert_eq!(px(&e, 0, 0), committed);
    }

    #[test]
    fn adjustment_session_cancels_cleanly() {
        let mut e = editor();
        e.begin_adjustment().unwrap();
        e.preview_adjustment("invert", &[]).unwrap();
        assert!(e.cancel_session());
        assert_eq!(px(&e, 0, 0), Rgba::WHITE);
        assert!(!e.can_undo());
        assert!(!e.cancel_session());
    }

    #[test]
    fn adjustment_respects_the_selection_and_blocks_painting() {
        let mut e = editor();
        e.set_tool(ToolKind::Select);
        e.pointer_down(Point::new(0.0, 0.0), false, false);
        e.pointer_up(Point::new(5.0, 5.0), false, false);
        e.set_tool(ToolKind::Pencil);
        e.begin_adjustment().unwrap();
        e.preview_adjustment("invert", &[]).unwrap();
        assert_eq!(px(&e, 2, 2), Rgba::BLACK);
        assert_eq!(px(&e, 10, 10), Rgba::WHITE);
        assert!(!e.pointer_down(Point::new(10.0, 10.0), false, false), "painting waits for the dialog");
        e.commit_session();
        assert!(e.apply_adjustment(Adjustment::from(Kind::Invert)));
        assert_eq!(px(&e, 2, 2), Rgba::WHITE);
    }

    #[test]
    fn transform_session_moves_pixels_with_the_pointer() {
        let mut e = editor();
        e.new_document(20, 20, Rgba::TRANSPARENT);
        e.settings_mut().color = RED;
        e.set_tool(ToolKind::Rectangle);
        e.pointer_down(Point::new(2.0, 2.0), false, false);
        e.pointer_up(Point::new(6.0, 6.0), false, false);
        assert_eq!(px(&e, 3, 3), RED);

        // Zoom in so the 8px grab radius is one document pixel and the box
        // centre is clear of the handles.
        e.set_zoom_about(8.0, Point::default());
        e.begin_transform().unwrap();
        assert!(e.is_transforming());
        let handles = e.transform_handles().unwrap();
        assert_eq!(handles[0], Point::new(16.0, 16.0));
        assert_eq!(e.transform_hit(Point::new(32.0, 32.0)), Some(Hit::Inside));
        assert!(e.pointer_down(Point::new(32.0, 32.0), false, false));
        e.pointer_move(Point::new(72.0, 32.0), false, false, false);
        e.pointer_up(Point::new(72.0, 32.0), false, false);
        assert_eq!(px(&e, 8, 3), RED, "previewed");
        assert!(e.is_transforming(), "still open until committed");
        assert!(e.commit_session());
        assert_eq!(px(&e, 8, 3), RED);
        assert_eq!(px(&e, 3, 3), Rgba::TRANSPARENT);
        assert!(e.undo());
        assert_eq!(px(&e, 3, 3), RED, "the whole transform is one undo step");
    }

    #[test]
    fn ctrl_dragging_a_corner_puts_the_layer_in_perspective() {
        let mut e = editor();
        e.new_document(20, 20, Rgba::TRANSPARENT);
        e.settings_mut().color = RED;
        e.set_tool(ToolKind::Select);
        e.pointer_down(Point::new(2.0, 2.0), false, false);
        e.pointer_up(Point::new(10.0, 10.0), false, false);
        assert!(e.fill_selection());
        e.deselect();
        e.set_zoom_about(8.0, Point::default());
        e.begin_transform().unwrap();
        // The top-left handle, dragged in towards the middle with Ctrl
        // down: that corner alone moves, which no affine placement can do.
        let handles = e.transform_handles().unwrap();
        assert!(e.pointer_down(handles[0], false, false));
        assert!(e.pointer_move(Point::new(handles[0].x + 32.0, handles[0].y), false, false, true));
        e.pointer_up(Point::new(handles[0].x + 32.0, handles[0].y), false, false);
        let moved = e.transform_handles().unwrap();
        assert_eq!(moved[0], Point::new(handles[0].x + 32.0, handles[0].y));
        assert_eq!(moved[4], handles[4], "the far corner stayed");
        assert!(e.commit_session());
        assert_eq!(px(&e, 3, 3), Rgba::TRANSPARENT, "the near corner has come away");
        assert_eq!(px(&e, 8, 8), RED, "and the rest of it is still there");
        assert!(e.undo());
        assert_eq!(px(&e, 3, 3), RED, "one undo step, as any transform is");
    }

    #[test]
    fn transform_handles_are_in_screen_space() {
        let mut e = editor();
        e.new_document(20, 20, Rgba::TRANSPARENT);
        e.settings_mut().color = RED;
        e.set_tool(ToolKind::Pencil);
        click(&mut e, 5.0, 5.0);
        e.set_zoom_about(4.0, Point::default());
        e.pan_by(10.0, 0.0);
        e.begin_transform().unwrap();
        let h = e.transform_handles().unwrap();
        assert_eq!(h[0], Point::new(5.0 * 4.0 + 10.0, 20.0));
        assert!(e.transform_nudge(1.0, 0.0));
        assert_eq!(e.transform_info().unwrap().x, 6.0);
        e.cancel_session();
        assert_eq!(px(&e, 5, 5), RED);
        assert!(e.undo(), "the click");
        assert!(!e.can_undo(), "a cancelled transform leaves no history");
    }

    #[test]
    fn transform_refuses_empty_or_hidden_layers() {
        let mut e = editor();
        e.new_document(5, 5, Rgba::TRANSPARENT);
        assert_eq!(e.begin_transform(), Err(SessionError::Empty));
        e.set_layer_visible(0, false).unwrap();
        assert_eq!(e.begin_transform(), Err(SessionError::Hidden));
        assert_eq!(e.begin_adjustment(), Err(SessionError::Hidden));
    }

    #[test]
    fn a_layer_operation_cancels_an_open_session() {
        let mut e = editor();
        e.begin_adjustment().unwrap();
        e.preview_adjustment("invert", &[]).unwrap();
        e.add_layer();
        assert!(!e.has_session());
        assert_eq!(px(&e, 0, 0), Rgba::WHITE);
    }

    #[test]
    fn layer_flips_rotations_and_canvas_ops_are_undoable() {
        let mut e = editor();
        e.new_document(4, 2, Rgba::TRANSPARENT);
        e.settings_mut().color = RED;
        e.set_tool(ToolKind::Pencil);
        click(&mut e, 0.0, 0.0);
        e.flip_layer_horizontal();
        assert_eq!(px(&e, 3, 0), RED);
        e.flip_layer_vertical();
        assert_eq!(px(&e, 3, 1), RED);
        e.rotate_layer(2);
        assert_eq!(px(&e, 0, 0), RED);
        e.rotate_canvas(1);
        assert_eq!((e.document().width(), e.document().height()), (2, 4));
        assert_eq!(px(&e, 1, 0), RED);
        e.flip_canvas_horizontal();
        assert_eq!(px(&e, 0, 0), RED);
        e.flip_canvas_vertical();
        assert_eq!(px(&e, 0, 3), RED);
        for _ in 0..6 {
            assert!(e.undo());
        }
        assert_eq!((e.document().width(), e.document().height()), (4, 2));
        assert_eq!(px(&e, 0, 0), RED);
        assert!(e.undo(), "the pencil click is the only step left");
        assert!(!e.can_undo());
    }

    #[test]
    fn flatten_layer_via_copy_and_background_fill() {
        let mut e = editor();
        e.add_layer();
        click(&mut e, 1.0, 1.0);
        e.select_all();
        let i = e.layer_via_copy();
        assert_eq!(e.document().layers().len(), 3);
        assert_eq!(e.document().layer(i).unwrap().raster.get(1, 1), RED);
        e.flatten();
        assert_eq!(e.document().layers().len(), 1);
        assert_eq!(px(&e, 1, 1), RED);
        e.settings_mut().background = Rgba::BLACK;
        e.deselect();
        assert!(e.fill_selection_background());
        assert_eq!(px(&e, 1, 1), Rgba::BLACK);
        e.swap_colors();
        assert_eq!(e.settings().color, Rgba::BLACK);
        assert_eq!(e.settings().background, RED);
        e.reset_colors();
        assert_eq!(e.settings().color, Rgba::BLACK);
        assert_eq!(e.settings().background, Rgba::WHITE);
    }

    #[test]
    fn zoom_and_hand_tools_work_through_the_editor() {
        let mut e = editor();
        e.set_tool(ToolKind::Zoom);
        assert!(e.pointer_down(Point::new(10.0, 10.0), false, false));
        e.pointer_up(Point::new(10.0, 10.0), false, false);
        assert_eq!(e.zoom(), 2.0);
        assert!(!e.can_undo(), "zooming is not an edit");
        e.set_layer_visible(0, false).unwrap();
        assert!(e.pointer_down(Point::new(10.0, 10.0), false, true), "view tools work on hidden layers");
        e.pointer_up(Point::new(10.0, 10.0), false, true);
        assert_eq!(e.zoom(), 1.0);
        e.set_tool(ToolKind::Hand);
        e.pointer_down(Point::new(0.0, 0.0), false, false);
        e.pointer_up(Point::new(5.0, 7.0), false, false);
        assert_eq!(e.pan(), Point::new(5.0, 7.0));
    }

    // ---- Layer masks --------------------------------------------------------------

    #[test]
    fn painting_on_a_mask_hides_the_layer_and_undoes_as_the_mask() {
        let mut e = Editor::new(4, 4, Rgba::WHITE);
        e.add_layer();
        paint(&mut e, |r| *r = Raster::filled(4, 4, RED));
        assert!(e.add_layer_mask(1, false).is_ok());
        assert!(e.document().active_layer().editing_mask(), "a new mask is what the tools edit");
        assert_eq!(px(&e, 1, 1), RED, "reveal-all shows everything");

        e.settings_mut().color = Rgba::BLACK;
        e.settings_mut().size = 1;
        e.set_tool(ToolKind::Pencil);
        click(&mut e, 1.0, 1.0);
        assert_eq!(px(&e, 1, 1), Rgba::WHITE, "black on the mask hides the red");
        assert_eq!(e.document().active_layer().raster.get(1, 1), RED, "the pixels are untouched");

        assert!(e.undo());
        assert_eq!(px(&e, 1, 1), RED);
        assert!(e.redo());
        assert_eq!(px(&e, 1, 1), Rgba::WHITE);

        // Grey is half; the eraser reveals.
        e.settings_mut().color = Rgba::opaque(128, 128, 128);
        click(&mut e, 2.0, 2.0);
        let half = px(&e, 2, 2);
        assert!(half != RED && half != Rgba::WHITE, "{half}");
        e.set_tool(ToolKind::Eraser);
        click(&mut e, 1.0, 1.0);
        assert_eq!(px(&e, 1, 1), RED, "erased mask reveals");

        e.set_layer_mask_enabled(1, false).unwrap();
        assert_eq!(px(&e, 2, 2), RED, "a disabled mask does nothing");
        assert!(e.undo());
        assert_eq!(px(&e, 2, 2), half);

        assert!(e.set_layer_target(1, Target::Pixels).is_ok());
        e.set_tool(ToolKind::Pencil);
        e.settings_mut().color = Rgba::BLACK;
        click(&mut e, 3.0, 3.0);
        assert_eq!(e.document().active_layer().raster.get(3, 3), Rgba::BLACK, "back on the pixels");

        e.apply_layer_mask(1).unwrap();
        assert!(e.document().active_layer().mask.is_none());
        assert_ne!(px(&e, 2, 2), RED, "baked in");
        assert!(e.undo());
        assert!(e.document().active_layer().mask.is_some());
        e.remove_layer_mask(1).unwrap();
        assert_eq!(px(&e, 2, 2), RED);
        assert_eq!(e.remove_layer_mask(1), Err(DocumentError::NoMask));
        assert_eq!(e.set_layer_target(1, Target::Mask), Err(DocumentError::NoMask));
    }

    #[test]
    fn a_mask_from_the_selection_and_back_again() {
        let mut e = Editor::new(6, 6, Rgba::WHITE);
        e.add_layer();
        paint(&mut e, |r| *r = Raster::filled(6, 6, RED));
        e.set_tool(ToolKind::Select);
        e.pointer_down(Point::new(0.0, 0.0), false, false);
        e.pointer_up(Point::new(3.0, 3.0), false, false);
        e.add_layer_mask(1, false).unwrap();
        assert_eq!(px(&e, 1, 1), RED, "inside the selection: shown");
        assert_eq!(px(&e, 4, 4), Rgba::WHITE, "outside: hidden");
        e.add_layer_mask(1, true).unwrap();
        assert_eq!(px(&e, 1, 1), Rgba::WHITE, "hide selection is the inverse");
        assert_eq!(px(&e, 4, 4), RED);

        e.deselect();
        assert!(e.select_layer_mask(1, SelectMode::Replace).unwrap());
        assert!(e.selection().contains(4, 4));
        assert!(!e.selection().contains(1, 1));
        assert!(e.select_layer_mask(0, SelectMode::Replace).is_err(), "no mask there");

        assert!(e.select_layer_opaque(1, SelectMode::Replace).unwrap());
        assert!(!e.selection().contains(1, 1), "what the layer draws is what its mask lets through");
    }

    #[test]
    fn a_mask_can_be_adjusted_transformed_and_filled() {
        let mut e = Editor::new(4, 4, Rgba::WHITE);
        e.add_layer();
        paint(&mut e, |r| *r = Raster::filled(4, 4, RED));
        e.add_layer_mask(1, false).unwrap();
        e.begin_adjustment().unwrap();
        e.preview_adjustment("invert", &[]).unwrap();
        assert_eq!(px(&e, 0, 0), Rgba::WHITE, "inverting the mask hides all");
        e.commit_session();
        assert!(e.undo());
        assert_eq!(px(&e, 0, 0), RED);

        e.settings_mut().color = Rgba::BLACK;
        assert!(e.fill_selection(), "fill works on the mask too");
        assert_eq!(px(&e, 0, 0), Rgba::WHITE);
        assert!(e.clear_selection(), "a cleared mask reveals");
        assert_eq!(px(&e, 0, 0), RED);

        e.flip_layer_horizontal();
        assert!(e.undo());
        assert_eq!(e.begin_transform(), Err(SessionError::Empty), "a cleared mask has nothing to move");
        assert!(e.fill_selection());
        e.begin_transform().unwrap();
        assert!(e.transform_nudge(1.0, 0.0));
        assert!(e.commit_session());
        assert_eq!(px(&e, 0, 0), RED, "the black slid off this column, which now reveals");
        assert_eq!(px(&e, 1, 0), Rgba::WHITE);
        assert!(e.undo(), "the transform of the mask is one step");
        assert_eq!(px(&e, 0, 0), Rgba::WHITE);
    }

    // ---- Adjustment layers ------------------------------------------------------

    #[test]
    fn an_adjustment_layer_is_edited_through_a_session_and_undoes_in_one_step() {
        let mut e = Editor::new(2, 2, Rgba::WHITE);
        let i = e.add_adjustment_layer("brightness-contrast", &[]).unwrap();
        assert_eq!(i, 1);
        assert_eq!(px(&e, 0, 0), Rgba::WHITE, "neutral to begin with");
        assert!(e.layer_adjustment(1).is_some());
        assert!(e.layer_adjustment(0).is_none());
        assert!(e.add_adjustment_layer("sepia", &[]).is_err());

        e.begin_adjustment_layer(1).unwrap();
        assert!(e.is_adjusting());
        e.preview_adjustment("brightness-contrast", &[-50.0, 0.0]).unwrap();
        assert_eq!(px(&e, 0, 0).r, 128);
        e.preview_adjustment("brightness-contrast", &[-100.0, 0.0]).unwrap();
        assert_eq!(px(&e, 0, 0).r, 0, "previews replace");
        assert!(e.commit_session());
        assert_eq!(e.layer_adjustment(1).unwrap().params(), vec![-100.0, 0.0, 0.0], "brightness, contrast, and the channel");
        assert!(e.undo());
        assert_eq!(px(&e, 0, 0), Rgba::WHITE, "the whole dialog is one step");
        assert!(e.undo(), "then the layer itself");
        assert_eq!(e.document().layers().len(), 1);

        e.redo();
        e.begin_adjustment_layer(1).unwrap();
        e.preview_adjustment("brightness-contrast", &[-100.0, 0.0]).unwrap();
        assert!(e.cancel_session());
        assert_eq!(px(&e, 0, 0), Rgba::WHITE, "cancelled: as it was");
        assert_eq!(e.begin_adjustment_layer(0), Err(SessionError::NotAdjustmentLayer));
    }

    #[test]
    fn an_adjustment_layer_can_only_be_painted_on_its_mask() {
        let mut e = Editor::new(2, 2, Rgba::WHITE);
        e.add_adjustment_layer("invert", &[]).unwrap();
        assert_eq!(px(&e, 0, 0), Rgba::BLACK);
        e.settings_mut().color = Rgba::BLACK;
        e.settings_mut().size = 1;
        e.set_tool(ToolKind::Pencil);
        assert_eq!(e.edit_refusal(), None, "the mask is the target");
        click(&mut e, 0.0, 0.0);
        assert_eq!(px(&e, 0, 0), Rgba::WHITE, "black on the mask stops the inversion there");
        assert_eq!(px(&e, 1, 1), Rgba::BLACK);

        e.set_layer_target(1, Target::Pixels).unwrap();
        assert_eq!(e.edit_refusal(), Some(EditRefusal::AdjustmentLayer));
        assert!(!e.pointer_down(Point::new(1.0, 1.0), false, false));
        assert!(!e.fill_selection());
        assert_eq!(e.begin_adjustment(), Err(SessionError::Uneditable(EditRefusal::AdjustmentLayer)));
        assert_eq!(e.begin_transform(), Err(SessionError::Uneditable(EditRefusal::AdjustmentLayer)));
        e.set_tool(ToolKind::Zoom);
        assert_eq!(e.edit_refusal(), None, "view tools are always fine");

        // With a selection, the new layer's mask is the selection.
        e.set_tool(ToolKind::Select);
        e.pointer_down(Point::new(0.0, 0.0), false, false);
        e.pointer_up(Point::new(1.0, 1.0), false, false);
        e.set_active_layer(0).unwrap();
        e.add_adjustment_layer("invert", &[]).unwrap();
        e.set_layer_visible(2, false).unwrap();
        assert_eq!(px(&e, 0, 0), Rgba::BLACK, "inverted inside the selection");
        assert_eq!(px(&e, 1, 1), Rgba::WHITE, "not outside");
    }

    // ---- Smart objects ------------------------------------------------------------

    #[test]
    fn a_smart_object_transforms_from_its_source_without_loss() {
        let mut e = Editor::new(8, 8, Rgba::TRANSPARENT);
        let index = e.place_smart_object("photo", Raster::filled(4, 4, RED));
        assert_eq!(index, 1);
        assert!(e.document().active_layer().is_smart());
        assert_eq!(px(&e, 2, 2), RED, "placed in the middle");
        assert_eq!(px(&e, 0, 0).a, 0);

        // Shrink it to a quarter, then move it away and back: still crisp.
        e.begin_transform().unwrap();
        assert!(e.is_transforming());
        let h = e.transform_handles().unwrap();
        assert_eq!(h[0], Point::new(2.0, 2.0), "the box is the object's own");
        e.transform_nudge(-2.0, -2.0);
        assert!(e.commit_session());
        assert_eq!(px(&e, 0, 0), RED);
        assert_eq!(px(&e, 4, 4).a, 0);
        assert!(e.document().active_layer().is_smart(), "still a smart object");
        assert!(e.undo());
        assert_eq!(px(&e, 2, 2), RED, "one step, the placement");
        assert!(e.document().active_layer().is_smart());

        e.begin_transform().unwrap();
        e.transform_nudge(1.0, 0.0);
        assert!(e.cancel_session());
        assert_eq!(px(&e, 2, 2), RED);
        assert_eq!(px(&e, 6, 2).a, 0, "cancelled: back where it was");
    }

    #[test]
    fn dragging_a_smart_object_dirties_its_own_rectangle_and_not_the_document() {
        // Moving a text layer runs a transform session, one preview per
        // pointer event. Marking the whole composite there made every drag
        // cost a full recomposite, which on a large document is slow enough
        // to see as a stutter behind the box the page draws.
        let mut e = Editor::new(200, 200, Rgba::TRANSPARENT);
        e.place_smart_object("photo", Raster::filled(10, 10, RED));
        e.set_tool(ToolKind::Move);
        e.take_dirty();

        assert!(e.pointer_down(Point::new(95.0, 95.0), false, false));
        assert!(e.pointer_move(Point::new(105.0, 95.0), false, false, false));
        let dirty = e.take_dirty().expect("the drag changed something");
        assert!(dirty.w < 200 && dirty.h < 200, "only the object's own rectangle: {dirty:?}");
        assert!(dirty.x <= 95 && dirty.right() >= 105, "covers where it was and where it has gone: {dirty:?}");

        e.pointer_up(Point::new(105.0, 95.0), false, false);
        assert_eq!(px(&e, 105, 100), RED);
        assert_eq!(px(&e, 95, 100).a, 0);
    }

    #[test]
    fn zoomed_out_a_drag_is_previewed_on_the_reduced_copy() {
        // Dragging a layer the size of the canvas changes every pixel of it,
        // so there is no rectangle to clip the work to. Zoomed out there is
        // a cheaper answer the screen cannot tell from the real one: run the
        // drag on the copy the adjustment dialogs preview into, and leave
        // the document itself until the pointer comes up.
        let mut e = Editor::new(64, 64, Rgba::TRANSPARENT);
        e.place_smart_object("photo", Raster::filled(64, 64, RED));
        e.set_zoom_about(0.25, Point::new(0.0, 0.0));
        assert_eq!(e.preview_step(), 4, "a quarter zoom shows one pixel in four");
        let before = e.document().active_surface().clone();

        e.set_tool(ToolKind::Move);
        assert!(e.pointer_down(Point::new(8.0, 8.0), false, false));
        assert!(e.pointer_move(Point::new(12.0, 8.0), false, false, false));
        assert_eq!(e.preview_size(), Some([16, 16, 4]), "the copy is a quarter on a side");
        assert_eq!(e.document().active_surface(), &before, "the document itself is untouched");

        // What the page draws is the drag, at the reduced size.
        let mut shown = Raster::new(16, 16);
        assert_eq!(e.preview_into(&mut shown), Some(true));
        assert_eq!(shown.get(8, 2), RED, "the object is there");
        assert_eq!(shown.get(1, 2).a, 0, "and has left where it was");

        // The pointer coming up does the one full-size pass.
        e.pointer_up(Point::new(12.0, 8.0), false, false);
        assert_eq!(e.preview_size(), None, "back to the frame");
        assert_eq!(px(&e, 40, 20), RED);
        assert_eq!(px(&e, 4, 20).a, 0, "moved by the 16 document pixels the drag came to");
        assert!(e.document().active_layer().is_smart(), "still a smart object");
        assert!(e.undo());
        assert_eq!(px(&e, 4, 20), RED, "and one undo step puts it back");
    }

    #[test]
    fn zoomed_out_a_gradient_drag_is_laid_down_on_the_reduced_copy() {
        // A gradient repaints its whole clip on every pointer event, so
        // zoomed out the drag runs on the copy and the document is filled
        // once, by the tool, when the pointer comes up.
        let mut e = Editor::new(64, 64, Rgba::WHITE);
        e.settings_mut().color = RED;
        e.settings_mut().background = Rgba::opaque(0, 0, 255);
        e.set_zoom_about(0.25, Point::new(0.0, 0.0));
        let before = e.document().active_surface().clone();

        e.set_tool(ToolKind::Gradient);
        assert!(e.pointer_down(Point::new(0.0, 0.0), false, false));
        assert!(e.pointer_move(Point::new(15.75, 0.0), false, false, false));
        assert_eq!(e.preview_size(), Some([16, 16, 4]), "the copy is a quarter on a side");
        assert_eq!(e.document().active_surface(), &before, "the document itself is untouched");

        let mut shown = Raster::new(16, 16);
        assert_eq!(e.preview_into(&mut shown), Some(true));
        assert!(shown.get(0, 0).r > 240, "the first colour at the start of the run");
        assert!(shown.get(15, 0).b > 240, "the second at the end");

        e.pointer_up(Point::new(15.75, 0.0), false, false);
        assert_eq!(e.preview_size(), None, "back to the frame");
        assert!(px(&e, 0, 0).r > 240, "and the document holds the same run at full size");
        assert!(px(&e, 63, 0).b > 240);

        // Abandoning a drag leaves nothing behind: the document was never
        // drawn on, so dropping the copy is the whole of putting it back.
        let steps = e.history_labels().len();
        let filled = e.document().active_surface().clone();
        e.pointer_down(Point::new(0.0, 15.75), false, false);
        e.pointer_move(Point::new(15.75, 15.75), false, false, false);
        assert!(e.cancel_gesture());
        assert_eq!(e.preview_size(), None);
        assert_eq!(e.document().active_surface(), &filled, "the drag before it is untouched");
        assert_eq!(e.history_labels().len(), steps, "and no step was kept");

        assert!(e.undo());
        assert_eq!(e.document().active_surface(), &before, "the gradient was one undo step");
    }

    #[test]
    fn zoomed_out_the_move_tool_drags_a_whole_layer_on_the_reduced_copy() {
        // A layer the size of the canvas changes every pixel of it when it
        // moves, so there is no rectangle to clip the work to. Zoomed out the
        // drag is shown on the copy, and the document is moved once — by the
        // tool, with the same gesture — when the pointer comes up.
        let mut e = Editor::new(64, 64, Rgba::WHITE);
        e.add_layer();
        let all = Rect::new(0, 0, 64, 64);
        paint(&mut e, |r| r.fill_rect(all, RED, &all));
        e.set_zoom_about(0.25, Point::new(0.0, 0.0));
        let before = e.document().active_surface().clone();

        e.set_tool(ToolKind::Move);
        assert!(e.pointer_down(Point::new(8.0, 8.0), false, false));
        assert!(e.pointer_move(Point::new(12.0, 8.0), false, false, false));
        // A fifth of a screen pixel is under a document pixel at this zoom.
        assert!(!e.pointer_move(Point::new(12.01, 8.0), false, false, false), "the same whole pixel is not a change");
        assert_eq!(e.preview_size(), Some([16, 16, 4]), "the copy is a quarter on a side");
        assert_eq!(e.document().active_surface(), &before, "the document itself is untouched");

        // A quarter zoom makes the four screen pixels dragged sixteen
        // document pixels, which is four on the copy.
        let mut shown = Raster::new(16, 16);
        assert_eq!(e.preview_into(&mut shown), Some(true));
        assert_eq!(shown.get(8, 8), RED, "the layer is drawn where the drag has got to");
        assert_eq!(shown.get(1, 8), Rgba::WHITE, "and has left where it was");

        e.pointer_up(Point::new(12.0, 8.0), false, false);
        assert_eq!(e.preview_size(), None, "back to the frame");
        assert_eq!(px(&e, 20, 20), RED, "landed where the preview showed it");
        assert_eq!(px(&e, 4, 20), Rgba::WHITE);

        // Abandoning a drag leaves nothing behind: the document was never
        // drawn on, so dropping the copy is the whole of putting it back.
        let steps = e.history_labels().len();
        e.pointer_down(Point::new(8.0, 8.0), false, false);
        e.pointer_move(Point::new(30.0, 30.0), false, false, false);
        assert!(e.cancel_gesture());
        assert_eq!(e.preview_size(), None);
        assert_eq!(px(&e, 20, 20), RED, "still where the drag before it left off");
        assert_eq!(px(&e, 4, 20), Rgba::WHITE);
        assert_eq!(e.history_labels().len(), steps, "and no step was kept");

        assert!(e.undo());
        assert_eq!(px(&e, 4, 20), RED, "the move was one undo step");
    }

    #[test]
    fn a_smart_object_refuses_the_brush_until_rasterized() {
        let mut e = Editor::new(4, 4, Rgba::TRANSPARENT);
        paint(&mut e, |r| r.set(1, 1, RED));
        e.convert_to_smart_object(0).unwrap();
        e.settings_mut().color = Rgba::BLACK;
        e.settings_mut().size = 1;
        e.set_tool(ToolKind::Pencil);
        assert_eq!(e.edit_refusal(), Some(EditRefusal::SmartObject));
        assert!(!e.pointer_down(Point::new(0.0, 0.0), false, false));
        assert!(!e.clear_selection());
        assert_eq!(e.begin_adjustment(), Err(SessionError::Uneditable(EditRefusal::SmartObject)));
        assert!(e.begin_transform().is_ok(), "but it can be transformed");
        e.cancel_session();

        e.add_layer_mask(0, false).unwrap();
        assert_eq!(e.edit_refusal(), None, "its mask can be painted");
        click(&mut e, 1.0, 1.0);
        assert_eq!(px(&e, 1, 1).a, 0, "and hides it");

        e.rasterize_layer(0).unwrap();
        e.set_layer_target(0, Target::Pixels).unwrap();
        assert_eq!(e.edit_refusal(), None);
        click(&mut e, 0.0, 0.0);
        assert_eq!(px(&e, 0, 0), Rgba::BLACK);
        assert!(e.undo());
        assert!(e.undo(), "rasterizing is undoable");
        assert!(e.document().active_layer().is_smart());
    }

    #[test]
    fn layer_flips_and_turns_keep_a_smart_object_smart() {
        let mut e = Editor::new(4, 2, Rgba::TRANSPARENT);
        paint(&mut e, |r| r.set(0, 0, RED));
        e.convert_to_smart_object(0).unwrap();
        e.flip_layer_horizontal();
        assert_eq!(px(&e, 3, 0), RED);
        assert!(e.document().active_layer().is_smart());
        e.rotate_layer(2);
        assert_eq!(px(&e, 0, 1), RED);
        e.replace_smart_contents(0, Raster::filled(2, 2, Rgba::BLACK)).unwrap();
        assert_eq!(px(&e, 0, 1), Rgba::BLACK, "the new picture fills the old box");
        for _ in 0..3 {
            assert!(e.undo());
        }
        assert_eq!(px(&e, 0, 0), RED);
        assert!(e.document().active_layer().is_smart());
    }

    #[test]
    fn switching_layers_or_targets_cancels_a_session() {
        let mut e = Editor::new(2, 2, Rgba::WHITE);
        e.add_layer();
        e.begin_adjustment().unwrap();
        e.set_active_layer(0).unwrap();
        assert!(!e.has_session());
        e.add_layer_mask(0, false).unwrap();
        e.begin_adjustment().unwrap();
        e.set_layer_target(0, Target::Pixels).unwrap();
        assert!(!e.has_session());
        assert!(!e.can_undo() || e.undo(), "and left nothing odd behind");
    }

    #[test]
    fn zoom_steps_and_fit() {
        let mut e = editor();
        e.zoom_in_about(Point::default());
        assert_eq!(e.zoom(), 2.0);
        e.zoom_out_about(Point::default());
        e.zoom_out_about(Point::default());
        assert!((e.zoom() - 2.0 / 3.0).abs() < 1e-9);
        e.fit_to_view(400.0, 400.0);
        assert_eq!(e.zoom(), 1.0, "a 20px image is not enlarged");
        assert_eq!(e.pan(), Point::new(190.0, 190.0));
        e.zoom_to_actual_size(100.0, 100.0);
        assert_eq!(e.pan(), Point::new(40.0, 40.0));
    }

    // ---- Nudging, cropping, resizing ------------------------------------------------

    #[test]
    fn arrow_keys_nudge_the_layer_or_the_outline() {
        let mut e = Editor::new(10, 10, Rgba::TRANSPARENT);
        paint(&mut e, |r| r.set(2, 2, RED));
        e.set_tool(ToolKind::Select);
        e.pointer_down(Point::new(0.0, 0.0), false, false);
        e.pointer_up(Point::new(5.0, 5.0), false, false);
        assert!(e.nudge_selection(2, 1));
        assert_eq!(e.selection_rect(), Some(Rect::new(2, 1, 5, 5)));
        assert_eq!(px(&e, 2, 2), RED, "the pixels did not move");
        assert!(e.nudge_selection(0, 1));
        assert_eq!(e.history_labels(), vec!["Select", "Move Selection"], "a run of outline nudges is one step");

        assert!(e.nudge_layer(1, 0));
        e.take_dirty();
        assert!(e.nudge_layer(1, 0));
        let dirty = e.take_dirty().expect("the nudge moved pixels");
        assert!(dirty.w < 10 && dirty.h < 10, "only where the pixels were and are: {dirty:?}");
        assert_eq!(px(&e, 4, 2), RED);
        assert_eq!(px(&e, 2, 2), Rgba::TRANSPARENT);
        assert_eq!(e.selection_rect(), Some(Rect::new(4, 2, 5, 5)), "the outline came along");
        assert!(e.undo());
        assert_eq!(px(&e, 2, 2), RED, "a run of nudges is one step");
        assert_eq!(e.selection_rect(), Some(Rect::new(2, 2, 5, 5)), "and the outline came back with it");
        assert!(e.undo());
        assert_eq!(e.selection_rect(), Some(Rect::new(0, 0, 5, 5)), "undoing the outline nudges");
        e.deselect();
        assert!(!e.nudge_selection(1, 1), "nothing to nudge");
        assert!(!e.nudge_layer(0, 0));
    }

    #[test]
    fn cropping_keeps_the_selection_and_image_size_scales_everything() {
        let mut e = Editor::new(10, 10, Rgba::WHITE);
        paint(&mut e, |r| r.fill_rect(Rect::new(2, 2, 2, 2), RED, &Rect::new(0, 0, 10, 10)));
        assert!(!e.crop_to_selection(), "nothing selected");
        e.set_tool(ToolKind::Crop);
        e.pointer_down(Point::new(2.0, 2.0), false, false);
        e.pointer_up(Point::new(6.0, 5.0), false, false);
        assert!(e.crop_to_selection());
        assert_eq!((e.document().width(), e.document().height()), (4, 3));
        assert_eq!(px(&e, 1, 1), RED);
        assert!(e.selection_rect().is_none());
        assert!(e.undo());
        assert_eq!((e.document().width(), e.document().height()), (10, 10));

        assert!(e.resize_image(20, 20));
        assert_eq!((e.document().width(), e.document().height()), (20, 20));
        assert_eq!(px(&e, 6, 6), RED, "the block doubled");
        assert_eq!(px(&e, 2, 2), Rgba::WHITE);
        assert!(!e.resize_image(20, 20), "the same size is nothing");
        assert!(!e.resize_image(0, 5));
        assert!(e.undo());
        assert_eq!(px(&e, 3, 3), RED);
    }

    // ---- Stroke, auto levels ---------------------------------------------------------

    #[test]
    fn stroking_paints_the_edge_of_the_selection_on_both_sides() {
        let mut e = Editor::new(20, 20, Rgba::WHITE);
        e.settings_mut().color = RED;
        assert!(!e.stroke_selection(2), "nothing selected");
        e.set_tool(ToolKind::Select);
        e.pointer_down(Point::new(5.0, 5.0), false, false);
        e.pointer_up(Point::new(15.0, 15.0), false, false);
        assert!(e.stroke_selection(2));
        assert_eq!(px(&e, 5, 10), RED, "just inside the edge");
        assert_eq!(px(&e, 4, 10), RED, "just outside it");
        assert_eq!(px(&e, 3, 10), Rgba::WHITE);
        assert_eq!(px(&e, 10, 10), Rgba::WHITE, "the middle is untouched");
        assert!(e.undo());
        assert_eq!(px(&e, 5, 10), Rgba::WHITE);
        assert!(!e.stroke_selection(0));
    }

    #[test]
    fn auto_levels_and_auto_contrast_are_one_step_each() {
        let mut e = Editor::new(4, 1, Rgba::TRANSPARENT);
        paint(&mut e, |r| {
            for x in 0..4 {
                r.set(x, 0, Rgba::opaque(100 + x as u8 * 10, 90 + x as u8 * 10, 90 + x as u8 * 10));
            }
        });
        assert!(e.auto_levels(true));
        assert_eq!(px(&e, 0, 0), Rgba::BLACK);
        assert_eq!(px(&e, 3, 0), Rgba::WHITE);
        assert!(e.undo());
        assert!(e.auto_levels(false));
        assert_eq!(px(&e, 3, 0).r, 255);
        assert!(px(&e, 3, 0).g < 255, "the cast stays");
        assert_eq!(e.history_labels(), vec!["Auto Contrast"]);
    }

    // ---- Clipboard ---------------------------------------------------------------------

    #[test]
    fn copying_a_whole_smart_object_pastes_a_smart_object() {
        let mut e = Editor::new(10, 10, Rgba::TRANSPARENT);
        let i = e.place_smart_object("photo", Raster::filled(4, 4, RED));
        assert!(e.document().layer(i).unwrap().is_smart());

        // Nothing selected: Copy takes the layer, and Paste puts one back.
        assert!(e.copy_selection(false));
        let index = e.paste().unwrap();
        let pasted = e.document().layer(index).unwrap();
        assert!(pasted.is_smart(), "the paste is still a smart object");
        assert_eq!(pasted.smart_object().unwrap().source.width(), 4, "at its own size");
        assert_ne!(pasted.id(), e.document().layer(i).unwrap().id(), "a new layer, not the same one");
        assert!(e.undo());

        // Select All is the same thing said out loud.
        e.select_all();
        assert!(e.copy_selection(false));
        let index = e.paste().unwrap();
        assert!(e.document().layer(index).unwrap().is_smart());
        assert!(e.undo());

        // Part of it, or the composite, is pixels — there is no smart object
        // that means "this corner of that picture".
        e.set_tool(ToolKind::Select);
        e.pointer_down(Point::new(1.0, 1.0), false, false);
        e.pointer_up(Point::new(3.0, 3.0), false, false);
        assert!(e.copy_selection(false));
        let index = e.paste().unwrap();
        assert!(!e.document().layer(index).unwrap().is_smart());
        e.select_all();
        assert!(e.copy_selection(true));
        let index = e.paste().unwrap();
        assert!(!e.document().layer(index).unwrap().is_smart());
    }

    #[test]
    fn a_copied_smart_object_pastes_into_a_document_of_another_size() {
        let mut e = Editor::new(10, 10, Rgba::TRANSPARENT);
        e.place_smart_object("photo", Raster::filled(4, 4, RED));
        assert!(e.copy_selection(false));
        e.new_document(4, 4, Rgba::WHITE);
        let index = e.paste().unwrap();
        let pasted = e.document().layer(index).unwrap();
        assert!(pasted.is_smart());
        assert_eq!((pasted.raster.width(), pasted.raster.height()), (4, 4), "re-rendered for this canvas");
    }

    #[test]
    fn copy_cut_and_paste_go_through_the_clipboard() {
        let mut e = Editor::new(10, 10, Rgba::TRANSPARENT);
        paint(&mut e, |r| r.set(3, 3, RED));
        assert!(e.clipboard().is_none());
        assert!(e.paste().is_none(), "nothing to paste");
        e.set_tool(ToolKind::Select);
        e.pointer_down(Point::new(2.0, 2.0), false, false);
        e.pointer_up(Point::new(5.0, 5.0), false, false);
        assert!(e.copy_selection(false));
        let clip = e.clipboard().unwrap().clone();
        assert_eq!((clip.raster.width(), clip.raster.height()), (3, 3));
        assert_eq!((clip.x, clip.y), (2, 2));
        assert_eq!(clip.raster.get(1, 1), RED);

        let index = e.paste().unwrap();
        assert_eq!(e.document().layers().len(), 2);
        assert_eq!(e.document().layer(index).unwrap().name, "Pasted");
        assert_eq!(e.document().layer(index).unwrap().raster.get(3, 3), RED, "pasted in place");
        assert!(e.selection_rect().is_none());
        assert!(e.undo());
        assert_eq!(e.document().layers().len(), 1);

        e.set_tool(ToolKind::Select);
        e.pointer_down(Point::new(2.0, 2.0), false, false);
        e.pointer_up(Point::new(5.0, 5.0), false, false);
        assert!(e.cut_selection());
        assert_eq!(px(&e, 3, 3), Rgba::TRANSPARENT);
        assert!(e.undo());
        assert_eq!(px(&e, 3, 3), RED);

        // A new, smaller document: the clip no longer fits where it was, so
        // it lands in the middle — and the clipboard survived the change.
        e.new_document(3, 3, Rgba::WHITE);
        let index = e.paste().unwrap();
        assert_eq!(e.document().layer(index).unwrap().raster.get(1, 1), RED);

        // Copy merged reads the whole picture, whatever layer is active.
        e.select_all();
        e.set_active_layer(0).unwrap();
        assert!(e.copy_selection(true));
        assert_eq!(e.clipboard().unwrap().raster.get(1, 1), RED);
        assert!(e.copy_selection(false), "the white background");
        assert_eq!(e.clipboard().unwrap().raster.get(1, 1), Rgba::WHITE);

        // A picture from outside lands centred, at its own size.
        let index = e.paste_external("photo", &Raster::filled(1, 1, Rgba::BLACK));
        assert_eq!(e.document().layer(index).unwrap().name, "photo");
        let photo = &e.document().layer(index).unwrap().raster;
        assert_eq!(photo.get(1, 1), Rgba::BLACK);
        assert_eq!(photo.get(0, 0), Rgba::TRANSPARENT);
    }

    // ---- Transforming the selection ---------------------------------------------------

    #[test]
    fn the_selection_outline_transforms_without_the_pixels() {
        let mut e = Editor::new(20, 20, Rgba::WHITE);
        paint(&mut e, |r| r.set(5, 5, RED));
        assert_eq!(e.begin_transform_selection(), Err(SessionError::NoSelection));
        e.set_tool(ToolKind::Select);
        e.pointer_down(Point::new(4.0, 4.0), false, false);
        e.pointer_up(Point::new(8.0, 8.0), false, false);
        e.begin_transform_selection().unwrap();
        assert!(e.is_transforming());
        assert!(e.is_transforming_selection());
        assert_eq!(e.begin_transform(), Err(SessionError::Busy));
        assert!(e.transform_handles().is_some());
        assert!(e.transform_nudge(6.0, 0.0));
        assert_eq!(e.selection_rect(), Some(Rect::new(10, 4, 4, 4)));
        assert_eq!(px(&e, 5, 5), RED, "the pixels stayed");
        assert!(e.transform_set_size(8.0, 4.0));
        // Scaling resamples the outline, so its edge goes soft, as a
        // transformed selection's does in Photoshop; what counts is inside.
        let stretched = |e: &Editor| {
            let s = e.selection();
            s.contains(10, 4) && s.contains(17, 7) && !s.contains(9, 5) && !s.contains(18, 5) && !s.contains(13, 8)
        };
        assert!(stretched(&e), "{:?}", e.selection_rect());
        assert!(e.commit_session());
        assert!(!e.is_transforming());
        assert!(stretched(&e));
        assert_eq!(e.history_labels().last().map(String::as_str), Some("Transform Selection"));
        assert!(e.undo());
        assert_eq!(e.selection_rect(), Some(Rect::new(4, 4, 4, 4)), "undo puts the outline back");
        assert!(e.redo());
        assert!(stretched(&e));

        e.begin_transform_selection().unwrap();
        e.transform_nudge(0.0, 5.0);
        assert!(!stretched(&e));
        assert!(e.cancel_session());
        assert!(stretched(&e), "cancelled: as it was");
    }

    #[test]
    fn the_transform_bar_fields_drive_the_box() {
        let mut e = editor();
        e.new_document(20, 20, Rgba::TRANSPARENT);
        e.settings_mut().color = RED;
        e.set_tool(ToolKind::Rectangle);
        e.pointer_down(Point::new(2.0, 2.0), false, false);
        e.pointer_up(Point::new(6.0, 6.0), false, false);
        e.begin_transform().unwrap();
        assert!(e.transform_set_position(10.0, 10.0));
        assert!(e.transform_set_size(8.0, 4.0));
        assert!(!e.transform_set_size(0.0, 4.0));
        assert!(e.transform_set_angle(90.0));
        let info = e.transform_info().unwrap();
        assert!((info.width - 8.0).abs() < 1e-9 && (info.height - 4.0).abs() < 1e-9);
        assert!((info.angle_degrees - 90.0).abs() < 1e-6);
        e.cancel_session();
        assert!(!e.transform_set_position(0.0, 0.0), "no transform open");
    }

    #[test]
    fn pixels_moved_off_the_canvas_are_kept_and_reveal_all_brings_them_back() {
        let mut e = Editor::new(8, 8, Rgba::TRANSPARENT);
        paint(&mut e, |r| r.set(1, 1, RED));
        assert!(e.nudge_layer(12, 0), "well past the right edge");
        assert_eq!(px(&e, 1, 1).a, 0, "gone from the canvas");
        assert_eq!(e.document().content_bounds(), Rect::new(0, 0, 14, 8));

        assert!(e.nudge_layer(-12, 0));
        assert_eq!(px(&e, 1, 1), RED, "and brought back by moving back");

        // Or brought back by growing the canvas out to it instead.
        assert!(e.nudge_layer(12, 0));
        assert!(e.reveal_all());
        assert_eq!((e.document().width(), e.document().height()), (14, 8));
        assert_eq!(px(&e, 13, 1), RED);
        assert_eq!(e.document().active_layer().offscreen, None, "nothing left outside");
    }

    #[test]
    fn undoing_a_move_puts_back_what_it_pushed_off_the_canvas() {
        let mut e = Editor::new(8, 8, Rgba::TRANSPARENT);
        paint(&mut e, |r| r.set(1, 1, RED));
        assert!(e.nudge_layer(12, 0));
        assert!(e.undo());
        assert_eq!(px(&e, 1, 1), RED);
        assert_eq!(e.document().active_layer().offscreen, None);
        assert!(e.redo());
        assert_eq!(px(&e, 1, 1).a, 0);
        assert!(e.document().active_layer().offscreen.is_some());
    }

    #[test]
    fn a_free_transform_of_the_whole_layer_takes_what_is_outside_it_along() {
        let mut e = Editor::new(8, 8, Rgba::TRANSPARENT);
        paint(&mut e, |r| r.set(1, 1, RED));
        let kept = Offscreen::new(Rect::new(-2, 1, 1, 1), Raster::filled(1, 1, Rgba::BLACK));
        e.document.active_layer_mut().offscreen = Some(kept);
        e.begin_transform().unwrap();
        assert!(e.transform_nudge(0.0, 2.0));
        assert!(e.commit_session());
        let kept = e.document().active_layer().offscreen.as_ref().expect("still outside");
        assert_eq!(kept.rect, Rect::new(-2, 3, 1, 1), "two down, with the rest of the layer");
    }

    // ---- Locks and blend modes ----------------------------------------------------------

    #[test]
    fn a_locked_layer_refuses_every_edit_and_says_so() {
        let mut e = editor();
        e.set_layer_locked(0, true).unwrap();
        assert!(e.document().layer(0).unwrap().locked);
        assert_eq!(e.edit_refusal(), Some(EditRefusal::Locked));
        assert!(!e.pointer_down(Point::new(1.0, 1.0), false, false));
        assert!(!e.fill_selection());
        assert!(!e.clear_selection());
        assert!(!e.flip_layer_horizontal());
        assert!(!e.nudge_layer(1, 0));
        assert_eq!(e.begin_transform(), Err(SessionError::Uneditable(EditRefusal::Locked)));
        assert_eq!(e.begin_adjustment(), Err(SessionError::Uneditable(EditRefusal::Locked)));
        e.set_tool(ToolKind::Select);
        assert_eq!(e.edit_refusal(), None, "selecting is fine");
        assert!(e.undo(), "locking is undoable");
        assert!(!e.document().layer(0).unwrap().locked);
        e.set_tool(ToolKind::Pencil);
        click(&mut e, 1.0, 1.0);
        assert_eq!(px(&e, 1, 1), RED);
    }

    #[test]
    fn locked_transparency_keeps_the_holes() {
        let mut e = Editor::new(6, 6, Rgba::TRANSPARENT);
        paint(&mut e, |r| r.set(2, 2, Rgba::new(0, 0, 255, 128)));
        e.set_layer_lock_alpha(0, true).unwrap();
        e.settings_mut().color = RED;
        e.settings_mut().size = 5;
        e.set_tool(ToolKind::Pencil);
        assert_eq!(e.edit_refusal(), None, "painting is allowed");
        click(&mut e, 2.0, 2.0);
        assert_eq!(px(&e, 2, 2), Rgba::new(255, 0, 0, 128), "painted, at the alpha it had");
        assert_eq!(px(&e, 3, 3), Rgba::TRANSPARENT, "an empty pixel stays empty");
        assert!(e.fill_selection());
        assert_eq!(px(&e, 4, 4), Rgba::TRANSPARENT);
        e.set_tool(ToolKind::Move);
        assert_eq!(e.edit_refusal(), Some(EditRefusal::AlphaLocked));
        assert!(!e.pointer_down(Point::new(2.0, 2.0), false, false));
        assert!(!e.nudge_layer(1, 0));
        assert_eq!(e.begin_transform(), Err(SessionError::Uneditable(EditRefusal::AlphaLocked)));
        // The mask of an alpha-locked layer paints freely.
        e.add_layer_mask(0, false).unwrap();
        e.set_tool(ToolKind::Pencil);
        e.settings_mut().color = Rgba::BLACK;
        click(&mut e, 2.0, 2.0);
        assert_eq!(px(&e, 2, 2).a, 0, "hidden by the mask");
    }

    #[test]
    fn a_blend_mode_is_an_undoable_layer_setting() {
        let mut e = Editor::new(1, 1, Rgba::opaque(128, 128, 128));
        e.add_layer();
        paint(&mut e, |r| r.set(0, 0, Rgba::opaque(128, 128, 128)));
        e.set_layer_blend(1, BlendMode::Multiply).unwrap();
        assert!((px(&e, 0, 0).r as i32 - 64).abs() <= 1);
        assert!(e.undo());
        assert_eq!(px(&e, 0, 0).r, 128);
        assert_eq!(e.set_layer_blend(9, BlendMode::Screen), Err(DocumentError::NoSuchLayer));
    }

    // ---- The history panel and the file ----------------------------------------------------

    #[test]
    fn the_history_panel_lists_labelled_steps_and_jumps_between_them() {
        let mut e = editor();
        assert!(e.history_labels().is_empty());
        click(&mut e, 1.0, 1.0);
        e.add_layer();
        e.set_layer_opacity(1, 0.5).unwrap();
        e.set_layer_opacity(1, 0.3).unwrap();
        assert_eq!(e.history_labels(), vec!["Pencil", "New Layer", "Layer Opacity"]);
        assert_eq!(e.history_position(), 3);
        assert!(e.history_go_to(1));
        assert_eq!(e.document().layers().len(), 1);
        assert_eq!(px(&e, 1, 1), RED);
        assert_eq!(e.history_labels().len(), 3, "the undone steps are still listed");
        assert!(e.history_go_to(3));
        assert_eq!(e.document().layer(1).unwrap().opacity, 0.3);
        assert_eq!(e.history_limit(), HISTORY_LIMIT);
        e.set_history_limit(2);
        assert_eq!(e.history_labels(), vec!["New Layer", "Layer Opacity"]);
    }

    #[test]
    fn selection_and_view_gestures_do_not_dirty_the_composite() {
        let mut e = editor();
        assert!(e.take_dirty().is_some());
        e.set_tool(ToolKind::Select);
        e.pointer_down(Point::new(0.0, 0.0), false, false);
        e.pointer_move(Point::new(3.0, 3.0), false, false, false);
        e.pointer_up(Point::new(5.0, 5.0), false, false);
        assert!(e.take_dirty().is_none(), "a marquee changes no pixels");
        e.set_tool(ToolKind::Hand);
        e.pointer_down(Point::new(0.0, 0.0), false, false);
        e.pointer_move(Point::new(30.0, 30.0), false, false, false);
        e.pointer_up(Point::new(30.0, 30.0), false, false);
        assert!(e.take_dirty().is_none(), "nor does a pan");
        e.set_tool(ToolKind::Pencil);
        // The pan moved the view, so the click has to aim at a screen point
        // that is still over the document: a stroke that lands nowhere
        // changes no pixels and rightly dirties nothing.
        click(&mut e, 31.0, 31.0);
        assert!(e.take_dirty().is_some(), "painting does");
    }

    /// The invariant the session's cached base rests on: starting from the
    /// composite of the layers below gives the same picture as compositing
    /// the lot, and the cache never outlives the session that built it.
    #[test]
    fn a_session_composites_from_its_cached_base_and_gets_the_same_picture() {
        let mut e = Editor::new(30, 20, Rgba::opaque(40, 90, 160));
        e.settings_mut().color = RED;
        e.settings_mut().size = 6;
        e.add_layer();
        e.set_tool(ToolKind::Brush);
        click(&mut e, 10.0, 10.0);
        e.set_layer_opacity(1, 0.7).unwrap();
        e.set_layer_blend(1, crate::blend::BlendMode::Screen).unwrap();
        let index = e.add_adjustment_layer("levels", &[0.0, 200.0, 1.0]).unwrap();
        // A layer above the adjustment, so the cache is not simply the end.
        e.add_layer();
        click(&mut e, 22.0, 6.0);

        let all = e.document().bounds();
        let mut frame = Raster::new(30, 20);
        e.begin_adjustment_layer(index).unwrap();
        assert!(e.preview_base.is_some(), "there is something below to keep");
        for white in [120.0, 200.0, 255.0] {
            e.preview_adjustment("levels", &[0.0, white, 1.0]).unwrap();
            e.composite_into(&mut frame, &all);
            assert_eq!(frame, e.document().composite(), "white point {white} came out wrong");
        }
        e.commit_session();
        assert!(e.preview_base.is_none(), "the cache goes with the session");
        e.composite_into(&mut frame, &all);
        assert_eq!(frame, e.document().composite());

        // Undo cancels the session, so the cache cannot outlive what it was
        // built from.
        e.begin_adjustment_layer(index).unwrap();
        assert!(e.preview_base.is_some());
        assert!(e.undo());
        assert!(e.preview_base.is_none(), "undo dropped it");
        e.composite_into(&mut frame, &all);
        assert_eq!(frame, e.document().composite());

        // The bottom layer has nothing below it, so the kept composite is
        // empty — and the answer is still right.
        e.set_active_layer(0).unwrap();
        e.begin_adjustment().unwrap();
        e.preview_adjustment("invert", &[]).unwrap();
        e.composite_into(&mut frame, &all);
        assert_eq!(frame, e.document().composite());
        e.cancel_session();
        assert!(e.preview_base.is_none());
    }

    /// The reduced preview: the same picture at a fraction of the size while
    /// the canvas is zoomed out, and the full-size answer on commit however
    /// the previews ran.
    #[test]
    fn a_session_draws_its_own_reduced_preview_and_not_the_last_one() {
        // The page keeps one preview frame and reuses it for every session,
        // so a session that composites nothing leaves whatever the session
        // before it drew on the screen. Transform, undo, transform again is
        // where that shows: the second box would open on the first one's
        // picture.
        let mut e = Editor::new(64, 32, Rgba::TRANSPARENT);
        e.settings_mut().color = RED;
        e.settings_mut().size = 8;
        e.set_tool(ToolKind::Brush);
        click(&mut e, 20.0, 16.0);
        e.set_zoom_about(0.25, Point::new(0.0, 0.0));
        assert_eq!(e.preview_step(), 4);

        let mut frame = Raster::new(1, 1);
        e.begin_transform().unwrap();
        assert_eq!(e.preview_into(&mut frame), Some(true));
        e.transform_nudge(20.0, 0.0);
        assert_eq!(e.preview_into(&mut frame), Some(true));
        assert!(e.commit_session());
        assert!(e.undo());

        let moved = frame.clone();
        // The page draws a frame between the two, which takes the dirty
        // rectangle with it — so the second session starts with nothing
        // marked as changed, exactly as it does in the browser.
        e.take_dirty();
        e.begin_transform().unwrap();
        assert_eq!(e.preview_into(&mut frame), Some(true), "the new session composites its own picture");
        assert_ne!(frame, moved, "or the canvas keeps showing the move that was undone");
        assert_eq!(frame, e.document().composite().downscaled(4));
    }

    #[test]
    fn a_zoomed_out_preview_composites_at_the_size_the_screen_shows() {
        let mut e = Editor::new(64, 32, Rgba::opaque(200, 120, 60));
        e.settings_mut().color = RED;
        e.settings_mut().size = 8;
        e.add_layer();
        e.set_tool(ToolKind::Brush);
        click(&mut e, 20.0, 16.0);
        let index = e.add_adjustment_layer("levels", &[0.0, 180.0, 1.0]).unwrap();

        // At a zoom that fills the screen there is nothing to save.
        e.set_zoom_about(1.0, Point::new(0.0, 0.0));
        e.begin_adjustment_layer(index).unwrap();
        assert_eq!(e.preview_step(), 1);
        assert_eq!(e.preview_size(), None, "no reduction at 1:1");
        e.cancel_session();

        // Zoomed out to a quarter, the preview is a quarter the size.
        e.set_zoom_about(0.25, Point::new(0.0, 0.0));
        assert_eq!(e.preview_step(), 4);
        e.begin_adjustment_layer(index).unwrap();
        assert_eq!(e.preview_size(), Some([16, 8, 4]));
        let mut small = Raster::new(1, 1);
        assert_eq!(e.preview_into(&mut small), Some(true));
        assert_eq!((small.width(), small.height()), (16, 8));

        // A neutral adjustment previews as the picture below it, reduced:
        // that is the whole stack, correctly placed and masked.
        e.preview_adjustment("levels", &[0.0, 255.0, 1.0]).unwrap();
        assert_eq!(e.preview_into(&mut small), Some(true));
        assert_eq!(small, e.document().composite().downscaled(4), "the plumbing is off");

        // A real one is close to the reduction of the full answer, but not
        // identical: the adjustment runs on reduced pixels. That is the
        // trade, and it is why commit does the full-size pass.
        e.preview_adjustment("levels", &[40.0, 160.0, 1.0]).unwrap();
        assert_eq!(e.preview_into(&mut small), Some(true));
        let want = e.document().composite().downscaled(4);
        let offsets: Vec<i32> = small
            .pixels()
            .iter()
            .zip(want.pixels())
            .flat_map(|(a, b)| [(a.r, b.r), (a.g, b.g), (a.b, b.b)].map(|(l, r)| (i32::from(l) - i32::from(r)).abs()))
            .collect();
        let mean = offsets.iter().sum::<i32>() / offsets.len() as i32;
        // Over the picture the two agree closely; the pixels that do not are
        // the edges, where a steep curve amplifies whatever the reduction
        // averaged away. That is the trade, and it is why commit is a
        // full-size pass.
        assert!(mean <= 8, "the preview is not close to the answer: {mean} on average");
        e.commit_session();
        assert_eq!(e.preview_size(), None, "the preview goes with the session");

        // The pixel-adjustment dialog skips the full-size pass while it
        // previews reduced, so commit has to work it out — exactly.
        e.set_active_layer(1).unwrap();
        let before = e.document().active_surface().clone();
        e.begin_adjustment().unwrap();
        assert!(e.preview_size().is_some(), "reduced here too");
        e.preview_adjustment("invert", &[]).unwrap();
        assert_eq!(e.document().active_surface(), &before, "the full-size pixels are left alone");
        e.commit_session();
        let mut want = before.clone();
        let all = want.bounds();
        Adjustment::from(Kind::Invert).apply(&mut want, &all);
        assert_eq!(e.document().active_surface(), &want, "commit is the full-size answer");
    }

    /// At a zoom too close for a reduced preview, a full-size pass covers the
    /// window and no more, and the view moving under it brings the rest up to
    /// date.
    #[test]
    fn a_full_size_preview_covers_the_window_and_follows_it() {
        const GREY: Rgba = Rgba::opaque(90, 90, 90);
        const INVERTED: Rgba = Rgba::opaque(165, 165, 165);
        let mut e = Editor::new(512, 64, GREY);
        e.set_view_size(64.0, 64.0);
        e.set_zoom_about(1.0, Point::new(0.0, 0.0));
        assert_eq!(e.preview_step(), 1, "nothing to reduce at 1:1");

        e.begin_adjustment().unwrap();
        // The page draws a frame before the first slider move, which takes
        // the dirty rectangle with it.
        e.take_dirty();
        e.preview_adjustment("invert", &[]).unwrap();
        let surface = e.document().active_surface();
        assert_eq!(surface.get(0, 0), INVERTED, "the window is previewed");
        assert_eq!(surface.get(127, 0), INVERTED, "out to the end of its tile");
        assert_eq!(surface.get(128, 0), GREY, "and the rest of the document is left alone");
        assert_eq!(e.take_dirty(), Some(Rect::new(0, 0, 128, 64)), "nor is it recomposited");

        // The canvas pans to the far end: what has come into view is worked
        // out now, and what has left it goes back to the pixels the session
        // started from.
        e.pan_by(-448.0, 0.0);
        assert_eq!(e.preview_into(&mut Raster::new(1, 1)), None, "no reduced preview at 1:1");
        let surface = e.document().active_surface();
        assert_eq!(surface.get(511, 0), INVERTED, "the new window is previewed");
        assert_eq!(surface.get(0, 0), GREY, "and the old one is back as it was");
        assert_eq!(e.take_dirty(), Some(Rect::new(0, 0, 512, 64)), "both ends are recomposited");

        // Whatever the previews covered, what the document keeps is all of it.
        e.commit_session();
        assert!(e.document().active_surface().pixels().iter().all(|p| *p == INVERTED));
    }

    /// An adjustment layer applies at composite time, so previewing one costs
    /// a recomposite rather than a pass over the pixels — of the window, and
    /// of whatever the view uncovers afterwards.
    #[test]
    fn an_adjustment_layer_previews_the_window_and_catches_up_on_a_pan() {
        let mut e = Editor::new(512, 64, Rgba::opaque(90, 90, 90));
        e.set_view_size(64.0, 64.0);
        e.set_zoom_about(1.0, Point::new(0.0, 0.0));
        let index = e.add_adjustment_layer("levels", &[0.0, 255.0, 1.0]).unwrap();
        e.begin_adjustment_layer(index).unwrap();
        e.take_dirty();
        e.preview_adjustment("levels", &[0.0, 128.0, 1.0]).unwrap();
        assert_eq!(e.take_dirty(), Some(Rect::new(0, 0, 128, 64)), "the window, not the document");

        e.pan_by(-448.0, 0.0);
        assert_eq!(e.preview_into(&mut Raster::new(1, 1)), None, "no reduced preview at 1:1");
        assert_eq!(e.take_dirty(), Some(Rect::new(0, 0, 512, 64)), "what the pan uncovered as well");

        // The frame is composited only where it has been marked, so what the
        // marks cover has to be the whole of the difference.
        let all = e.document().bounds();
        let mut frame = Raster::new(512, 64);
        e.composite_into(&mut frame, &all);
        assert_eq!(frame, e.document().composite());
    }

    /// The invariant the dirty rectangle rests on: redrawing only what the
    /// engine said changed leaves exactly the frame that redrawing all of it
    /// would have — through a mask, an adjustment layer and a blend mode.
    #[test]
    fn compositing_only_the_dirty_rectangle_gives_the_whole_picture() {
        let mut e = Editor::new(60, 40, Rgba::WHITE);
        e.settings_mut().color = RED;
        e.settings_mut().size = 5;
        e.add_layer();
        e.set_tool(ToolKind::Brush);
        click(&mut e, 12.0, 12.0);
        e.add_layer_mask(1, false).unwrap();
        e.set_layer_opacity(1, 0.6).unwrap();
        e.set_layer_blend(1, crate::blend::BlendMode::Multiply).unwrap();
        e.add_adjustment_layer("levels", &[0.0, 180.0, 1.0]).unwrap();
        e.set_active_layer(1).unwrap();

        // Start the buffer in sync, the way the page's first render does.
        let mut frame = Raster::new(60, 40);
        let all = e.document().bounds();
        e.take_dirty();
        e.composite_into(&mut frame, &all);
        assert_eq!(frame, e.document().composite(), "a full pass is the reference");

        // Now paint, and redraw only what the engine says changed.
        e.pointer_down(Point::new(20.0, 10.0), false, false);
        e.pointer_move(Point::new(40.0, 30.0), false, false, false);
        let rect = e.take_dirty().expect("the drag changed something");
        assert!(rect.w < 60 || rect.h < 40, "not the whole canvas: {rect:?}");
        e.composite_into(&mut frame, &rect);
        assert_eq!(frame, e.document().composite(), "the rectangle was not enough");

        e.pointer_up(Point::new(40.0, 30.0), false, false);
        if let Some(rect) = e.take_dirty() {
            e.composite_into(&mut frame, &rect);
        }
        assert_eq!(frame, e.document().composite());
    }

    /// The point of the dirty rectangle: a dab costs a dab, not a canvas.
    #[test]
    fn painting_dirties_only_the_part_it_painted() {
        let mut e = Editor::new(400, 400, Rgba::WHITE);
        e.settings_mut().color = RED;
        e.settings_mut().size = 4;
        e.set_tool(ToolKind::Pencil);
        e.take_dirty();
        click(&mut e, 100.0, 100.0);
        let rect = e.take_dirty().expect("a dab changes something");
        assert!(rect.contains(100, 100), "{rect:?} misses the dab");
        assert!(rect.w <= 16 && rect.h <= 16, "a 4 px dab dirtied {rect:?}");
        // A drag dirties the segment it just drew, not the whole stroke.
        e.pointer_down(Point::new(10.0, 10.0), false, false);
        e.take_dirty();
        e.pointer_move(Point::new(300.0, 10.0), false, false, false);
        let long = e.take_dirty().expect("the drag changes something");
        assert!(long.w >= 290, "the whole segment: {long:?}");
        assert!(long.h <= 16, "but only the segment: {long:?}");
        e.pointer_move(Point::new(300.0, 12.0), false, false, false);
        let short = e.take_dirty().expect("and so does the next move");
        assert!(short.w <= 16, "the second segment is short: {short:?}");
        e.pointer_up(Point::new(300.0, 12.0), false, false);
        // Anything structural gives up and redraws everything.
        e.take_dirty();
        assert!(e.undo());
        assert_eq!(e.take_dirty(), Some(Rect::new(0, 0, 400, 400)));
    }

    #[test]
    fn guide_edits_and_selection_edits_are_undo_steps() {
        let mut e = editor();
        assert!(e.edit_guides(vec![3.0], vec![], "Add Guide"));
        assert!(!e.edit_guides(vec![3.0], vec![], "Add Guide"), "no change, no step");
        assert!(e.edit_guides(vec![5.0], vec![], "Move Guide"));
        e.select_all();
        assert!(e.invert_selection());
        assert!(!e.expand_selection(1), "nothing selected after inverting everything");
        e.deselect();
        assert_eq!(e.history_labels(), vec!["Add Guide", "Move Guide", "Select All", "Inverse"]);
        assert!(e.undo());
        assert_eq!(e.selection_rect(), Some(e.document().bounds()));
        assert!(e.undo());
        assert_eq!(e.selection_rect(), None);
        assert!(e.undo());
        assert_eq!(e.settings().guides.h, vec![3.0]);
        assert!(e.undo());
        assert!(e.settings().guides.h.is_empty());
        assert!(!e.can_undo());
        assert!(e.history_go_to(2));
        assert_eq!(e.settings().guides.h, vec![5.0]);
        assert_eq!(e.selection_rect(), None);
    }

    #[test]
    fn the_subject_box_feeds_a_matte_of_its_own_size_and_combines_with_shift() {
        let mut e = Editor::new(20, 20, Rgba::WHITE);
        e.set_tool(ToolKind::Select);
        e.pointer_down(Point::new(0.0, 0.0), false, false);
        e.pointer_up(Point::new(3.0, 3.0), false, false);
        e.set_tool(ToolKind::SubjectBox);
        assert!(e.selection_rect().is_some(), "changing tool keeps the selection");
        e.pointer_down(Point::new(10.0, 10.0), true, false);
        e.pointer_move(Point::new(18.0, 18.0), true, false, false);
        assert_eq!(e.subject_box(), Some(Rect::new(10, 10, 8, 8)));
        e.pointer_up(Point::new(18.0, 18.0), true, false);
        assert_eq!(e.subject_box(), Some(Rect::new(10, 10, 8, 8)), "the box waits for the model");
        assert_eq!(e.history_labels(), vec!["Select"], "drawing the box is not a step");
        assert_eq!(e.composite_crop(Rect::new(10, 10, 8, 8)).width(), 8);
        // A 4x4 matte with the subject in its lower-right quarter, over the box.
        let mut matte = vec![0u8; 16];
        for y in 2..4 {
            for x in 2..4 {
                matte[y * 4 + x] = 255;
            }
        }
        assert!(e.select_subject_in_box(Rect::new(10, 10, 8, 8), &matte, 4, 4, SelectMode::Add));
        assert_eq!(e.subject_box(), None);
        let s = e.selection();
        assert!(s.contains(1, 1), "the marquee from before is still there");
        assert!(s.contains(16, 16), "and the subject joined it");
        assert!(!s.contains(11, 11), "inside the box but outside the matte");
        assert!(!s.contains(5, 16), "outside the box");
        assert_eq!(e.history_labels(), vec!["Select", "Select Subject"]);
        assert!(e.undo());
        assert!(!e.selection().contains(16, 16));
    }

    #[test]
    fn the_builtin_finder_works_inside_the_box_too() {
        let mut e = Editor::new(30, 30, Rgba::WHITE);
        paint(&mut e, |r| r.fill_rect(Rect::new(18, 18, 6, 6), RED, &Rect::new(0, 0, 30, 30)));
        assert!(e.select_subject_builtin_in_box(Rect::new(15, 15, 12, 12), SelectMode::Replace));
        assert!(e.selection().contains(20, 20));
        assert!(!e.selection().contains(16, 16));
        assert!(!e.select_subject_builtin_in_box(Rect::new(0, 0, 10, 10), SelectMode::Replace), "plain white: nothing");
    }

    #[test]
    fn dragging_the_symmetry_gizmo_moves_the_axes_and_is_one_undo_step() {
        let mut e = Editor::new(100, 100, Rgba::WHITE);
        e.settings_mut().symmetry = Symmetry { mirror_x: true, ..Symmetry::default() };
        assert!(e.symmetry_is_centred());
        assert_eq!(e.symmetry_frame().0, Point::new(50.0, 50.0), "until placed, the canvas centre");

        // Nothing to grab out in the picture; the crossing point is there.
        assert_eq!(e.symmetry_hit(Point::new(80.0, 80.0)), None);
        assert!(e.symmetry_grab(Point::new(50.0, 50.0), false));
        assert!(e.symmetry_drag(Point::new(70.0, 30.0), true));
        assert_eq!(e.symmetry_frame().0, Point::new(70.0, 30.0));
        let steps = e.history_labels().len();
        assert!(e.symmetry_release());
        assert_eq!(e.history_labels().len(), steps + 1, "the whole drag is one step");
        assert_eq!(e.history_labels().last().unwrap(), "Symmetry Axes");

        assert!(e.undo());
        assert!(e.symmetry_is_centred(), "undo puts the axes back");
        assert!(e.redo());
        assert_eq!(e.symmetry_frame().0, Point::new(70.0, 30.0));

        // The mirror line itself only travels across itself: dragging it
        // sideways leaves the other coordinate where it was put.
        assert_eq!(e.symmetry_hit(Point::new(70.0, 90.0)), Some(SymmetryHit::AxisX));
        assert!(e.symmetry_grab(Point::new(70.0, 90.0), false));
        assert!(e.symmetry_drag(Point::new(20.0, 10.0), true));
        assert_eq!(e.symmetry_frame().0, Point::new(20.0, 30.0));
        e.symmetry_release();

        // While the page is placing them, a press out in the picture brings
        // the axes there rather than doing nothing.
        assert!(!e.symmetry_grab(Point::new(80.0, 80.0), false));
        assert!(e.symmetry_grab(Point::new(80.0, 80.0), true));
        assert!(e.symmetry_drag(Point::new(80.0, 80.0), true));
        assert_eq!(e.symmetry_frame().0, Point::new(80.0, 80.0));
        e.symmetry_release();
    }

    #[test]
    fn a_placed_origin_is_held_to_half_pixels() {
        let mut e = Editor::new(100, 100, Rgba::WHITE);
        e.settings_mut().symmetry = Symmetry { mirror_x: true, ..Symmetry::default() };
        e.symmetry_grab(Point::new(50.0, 50.0), false);
        e.symmetry_drag(Point::new(30.4, 20.9), true);
        // Anywhere else and a mirrored stroke would land half a pixel out.
        assert_eq!(e.symmetry_frame().0, Point::new(30.5, 21.0));
    }

    #[test]
    fn turning_the_gizmo_settles_on_the_step_unless_it_is_let_free() {
        let mut e = Editor::new(100, 100, Rgba::WHITE);
        e.settings_mut().symmetry = Symmetry { mirror_x: true, ..Symmetry::default() };
        let arm = Point::new(50.0 + ROTATE_ARM_PX, 50.0);
        assert_eq!(e.symmetry_hit(arm), Some(SymmetryHit::Rotate));
        assert!(e.symmetry_grab(arm, false));
        // Twenty degrees round, which snapping rounds to fifteen.
        let twenty = 20.0_f64.to_radians();
        let at = Point::new(50.0 + 60.0 * twenty.cos(), 50.0 + 60.0 * twenty.sin());
        assert!(e.symmetry_drag(at, false));
        assert!((e.symmetry_frame().1.to_degrees() - SYMMETRY_ANGLE_STEP).abs() < 1e-9);
        assert!(e.symmetry_drag(at, true));
        assert!((e.symmetry_frame().1.to_degrees() - 20.0).abs() < 1e-9, "free of the step");
    }

    #[test]
    fn placed_axes_follow_the_canvas_through_a_crop_a_flip_and_a_turn() {
        let mut e = Editor::new(100, 60, Rgba::WHITE);
        e.settings_mut().symmetry = Symmetry { mirror_x: true, ..Symmetry::default() };
        e.set_symmetry_frame(SymmetryFrame { origin: Some(Point::new(20.0, 10.0)), angle: 0.0 });

        e.set_tool(ToolKind::Crop);
        e.pointer_down(Point::new(10.0, 5.0), false, false);
        e.pointer_up(Point::new(60.0, 45.0), false, false);
        assert!(e.crop_to_selection());
        assert_eq!(e.symmetry_frame().0, Point::new(10.0, 5.0), "the axes stay on the same pixels");

        e.flip_canvas_horizontal();
        assert_eq!(e.symmetry_frame().0, Point::new(40.0, 5.0));

        e.rotate_canvas(1);
        // A quarter turn clockwise on a 50x40 canvas takes (40, 5) to
        // (40 - 5, 40), and the axes turn with it.
        assert_eq!(e.symmetry_frame().0, Point::new(35.0, 40.0));
        assert!((e.symmetry_frame().1.to_degrees() - 90.0).abs() < 1e-9);

        // Axes left at the centre are not carried anywhere: the centre is
        // worked out afresh from whatever the canvas has become.
        e.centre_symmetry();
        assert!(e.resize_canvas(80, 80, 10, 10));
        assert_eq!(e.symmetry_frame().0, Point::new(40.0, 40.0));
        assert!(e.symmetry_is_centred());
    }

    #[test]
    fn guides_travel_with_the_file() {
        let mut e = Editor::new(10, 10, Rgba::WHITE);
        e.settings_mut().guides.h = vec![4.0];
        e.settings_mut().guides.v = vec![2.0, 8.0];
        let bytes = e.save_document();
        let mut other = Editor::new(10, 10, Rgba::WHITE);
        other.settings_mut().guides.enabled = true;
        other.open_document(&bytes).unwrap();
        assert_eq!(other.settings().guides.h, vec![4.0]);
        assert_eq!(other.settings().guides.v, vec![2.0, 8.0]);
        assert!(other.settings().guides.enabled, "the file does not decide the snapping preference");
    }

    /// Opening a file, saving it straight back out and opening that must
    /// land in the same place: loading is not allowed to normalise anything
    /// a re-save would then bake in.
    #[test]
    fn opening_saving_and_reopening_is_a_fixed_point() {
        let mut e = editor();
        click(&mut e, 1.0, 1.0);
        e.add_layer();
        e.set_layer_blend(1, BlendMode::Screen).unwrap();
        e.set_layer_opacity(1, 0.5).unwrap();
        e.settings_mut().guides.h = vec![1.0];
        e.settings_mut().guides.v = vec![2.0, 2.5];
        let first = e.save_document();

        let mut a = Editor::new(3, 3, Rgba::BLACK);
        a.open_document(&first).unwrap();
        let second = a.save_document();
        assert_eq!(second, first, "re-saving an opened file writes the same bytes");

        let mut b = Editor::new(3, 3, Rgba::BLACK);
        b.open_document(&second).unwrap();
        assert_eq!(b.document(), a.document());
        assert_eq!(b.settings().guides.h, a.settings().guides.h);
        assert_eq!(b.settings().guides.v, a.settings().guides.v);
        assert_eq!(b.document(), e.document(), "and both match where the file came from");
    }

    #[test]
    fn the_document_saves_and_opens_again_and_knows_when_it_is_modified() {
        let mut e = editor();
        assert!(!e.is_modified());
        click(&mut e, 1.0, 1.0);
        e.add_layer();
        e.set_layer_blend(1, BlendMode::Screen).unwrap();
        assert!(e.is_modified());
        let bytes = e.save_document();
        assert!(!e.is_modified(), "saving cleans it");
        click(&mut e, 2.0, 2.0);
        assert!(e.is_modified());
        assert!(e.undo());
        assert!(!e.is_modified(), "undone back to the saved state");

        let mut other = Editor::new(3, 3, Rgba::BLACK);
        other.open_document(&bytes).unwrap();
        assert_eq!(other.document(), e.document());
        assert!(!other.is_modified());
        assert!(!other.can_undo());
        assert!(other.open_document(b"not a file").is_err());
        assert_eq!(other.document(), e.document(), "a bad file changes nothing");
    }

    // ---- The eyedropper and the bucket --------------------------------------------------------

    #[test]
    fn alt_click_with_a_brush_picks_the_colour_under_the_pointer() {
        let mut e = Editor::new(4, 4, Rgba::WHITE);
        paint(&mut e, |r| r.set(1, 1, RED));
        e.set_tool(ToolKind::Brush);
        assert!(e.pointer_down(Point::new(1.0, 1.0), false, true));
        assert!(!e.is_gesturing(), "no stroke was started");
        assert_eq!(e.settings().color, RED);
        assert_eq!(px(&e, 1, 1), RED, "and nothing was painted");
        assert!(!e.can_undo());

        e.set_tool(ToolKind::Eyedropper);
        e.pointer_down(Point::new(0.0, 0.0), false, true);
        e.pointer_up(Point::new(0.0, 0.0), false, true);
        assert_eq!(e.settings().background, Rgba::WHITE);
        e.pointer_down(Point::new(1.0, 1.0), false, true);
        e.pointer_up(Point::new(1.0, 1.0), false, true);
        assert_eq!(e.settings().background, RED, "alt with the eyedropper sets the background");
        assert_eq!(e.edit_refusal(), None, "the eyedropper reads anything");
    }

    #[test]
    fn the_bucket_fills_a_patch_and_undoes_in_one_step() {
        let mut e = Editor::new(6, 6, Rgba::WHITE);
        paint(&mut e, |r| r.fill_rect(Rect::new(0, 0, 3, 6), Rgba::BLACK, &Rect::new(0, 0, 6, 6)));
        e.settings_mut().color = RED;
        e.settings_mut().antialias = false;
        e.set_tool(ToolKind::Bucket);
        click(&mut e, 4.0, 4.0);
        assert_eq!(px(&e, 4, 0), RED);
        assert_eq!(px(&e, 1, 1), Rgba::BLACK);
        assert_eq!(e.history_labels(), vec!["Paint Bucket"]);
        assert!(e.undo());
        assert_eq!(px(&e, 4, 0), Rgba::WHITE);
    }
}

#[cfg(test)]
mod text_session_tests {
    use super::*;
    use crate::text::TextAlign;

    const RED: Rgba = Rgba::opaque(255, 0, 0);

    fn px(e: &Editor, x: i32, y: i32) -> Rgba {
        e.document().composite().get(x, y)
    }

    /// The page's rendering, stood in for: a solid block `w` x `h` with one
    /// pixel of padding around it.
    fn drawn(w: u32, h: u32) -> (Point, Raster) {
        let mut r = Raster::new(w + 2, h + 2);
        r.fill_rect(Rect::new(1, 1, w as i32, h as i32), RED, &Rect::new(0, 0, (w + 2) as i32, (h + 2) as i32));
        (Point::new(1.0, 1.0), r)
    }

    fn type_text(e: &mut Editor, text: &str, w: u32, h: u32) {
        let (origin, source) = drawn(w, h);
        assert!(e.preview_text(text, origin, source));
    }

    #[test]
    fn typing_makes_a_text_layer_at_the_click_as_one_undo_step() {
        let mut e = Editor::new(20, 20, Rgba::WHITE);
        e.settings_mut().color = RED;
        let index = e.begin_text_layer(Point::new(10.0, 5.0)).unwrap();
        assert_eq!(index, 1);
        assert!(e.is_editing_text());
        assert_eq!(e.document().layers().len(), 2, "the layer is there at once");
        assert_eq!(e.document().active_layer().kind.name(), "text");
        assert_eq!(e.begin_text_layer(Point::new(0.0, 0.0)), Err(SessionError::Busy));

        type_text(&mut e, "Hi", 4, 2);
        assert_eq!(px(&e, 10, 5), RED, "the block's corner is on the click");
        assert_eq!(px(&e, 13, 6), RED);
        assert_eq!(px(&e, 14, 7), Rgba::WHITE);
        assert_eq!(e.document().active_layer().name, "Hi");
        assert!(e.is_dirty());

        type_text(&mut e, "Hiya", 8, 2);
        assert_eq!(px(&e, 17, 6), RED, "left-aligned: it grew to the right");
        assert!(e.commit_session());
        assert!(!e.is_editing_text());
        assert_eq!(e.history_labels(), vec!["Add Text".to_owned()]);
        let t = e.layer_text(1).unwrap();
        assert_eq!(t.text, "Hiya");
        assert_eq!(t.color, RED);
        assert!(e.undo());
        assert_eq!(e.document().layers().len(), 1, "one step takes the layer away");
        assert!(e.redo());
        assert_eq!(e.layer_text(1).unwrap().text, "Hiya");
        assert_eq!(e.text_layer_at(Point::new(12.0, 6.0)), Some(1));
        assert_eq!(e.text_layer_at(Point::new(2.0, 2.0)), None);
        assert_eq!(e.layer_placement(1).unwrap().apply(Point::new(1.0, 1.0)), Point::new(10.0, 5.0));
        assert_eq!(e.layer_placement(0), None);
    }

    #[test]
    fn nothing_typed_leaves_nothing_behind() {
        let mut e = Editor::new(20, 20, Rgba::WHITE);
        e.begin_text_layer(Point::new(3.0, 3.0)).unwrap();
        assert!(e.commit_session());
        assert_eq!(e.document().layers().len(), 1);
        assert!(!e.can_undo(), "and no step");

        e.begin_text_layer(Point::new(3.0, 3.0)).unwrap();
        type_text(&mut e, "  \n ", 2, 2);
        assert!(e.commit_session());
        assert_eq!(e.document().layers().len(), 1, "spaces are nothing");

        e.begin_text_layer(Point::new(3.0, 3.0)).unwrap();
        type_text(&mut e, "x", 2, 2);
        assert_eq!(px(&e, 3, 3), RED);
        assert!(e.cancel_session());
        assert_eq!(e.document().layers().len(), 1);
        assert_eq!(px(&e, 3, 3), Rgba::WHITE);
        assert!(!e.can_undo());
        assert!(!e.preview_text("x", Point::default(), Raster::new(1, 1)), "no session, no preview");
    }

    #[test]
    fn editing_a_text_layer_takes_its_style_and_records_one_step() {
        let mut e = Editor::new(20, 20, Rgba::WHITE);
        e.settings_mut().color = RED;
        e.settings_mut().text.size = 12.0;
        e.settings_mut().text.align = TextAlign::Right;
        e.begin_text_layer(Point::new(10.0, 5.0)).unwrap();
        type_text(&mut e, "ab", 4, 2);
        e.commit_session();
        // Someone changes the options bar and the colour in the meantime.
        e.settings_mut().color = Rgba::BLACK;
        e.settings_mut().text.size = 99.0;
        e.settings_mut().text.align = TextAlign::Left;
        e.add_layer();
        assert_eq!(e.document().active_index(), 2);

        assert_eq!(e.begin_text_edit(0), Err(SessionError::NotTextLayer));
        assert_eq!(e.begin_text_edit(9), Err(SessionError::NotTextLayer));
        e.begin_text_edit(1).unwrap();
        assert_eq!(e.document().active_index(), 1, "the text layer became active");
        assert_eq!(e.settings().text.size, 12.0, "its style is the options bar's now");
        assert_eq!(e.settings().text.align, TextAlign::Right);
        assert_eq!(e.settings().color, RED);

        // Nothing changed: no step.
        assert!(e.commit_session());
        assert_eq!(e.history_labels().len(), 2, "Add Text, New Layer");

        // Right-aligned text ends at the click: "ab" ran from x = 6 to 9.
        assert_eq!(px(&e, 9, 5), RED);
        assert_eq!(px(&e, 10, 5), Rgba::WHITE);
        assert_eq!(px(&e, 5, 5), Rgba::WHITE);
        e.begin_text_edit(1).unwrap();
        type_text(&mut e, "abcd", 8, 2);
        assert_eq!(px(&e, 9, 6), RED, "the right edge stayed");
        assert_eq!(px(&e, 10, 6), Rgba::WHITE);
        assert_eq!(px(&e, 2, 6), RED, "and it grew to the left");
        assert!(e.commit_session());
        assert_eq!(e.history_labels().last().map(String::as_str), Some("Edit Text"));
        assert_eq!(e.layer_text(1).unwrap().text, "abcd");
        assert!(e.undo());
        assert_eq!(e.layer_text(1).unwrap().text, "ab");
        assert_eq!(px(&e, 2, 6), Rgba::WHITE);

        // Emptying an existing layer puts it back rather than leaving a
        // blank layer behind.
        e.begin_text_edit(1).unwrap();
        type_text(&mut e, "", 0, 0);
        assert!(e.commit_session());
        assert_eq!(e.layer_text(1).unwrap().text, "ab");
    }

    #[test]
    fn a_text_layer_refuses_the_brush_but_transforms_and_rasterizes() {
        let mut e = Editor::new(20, 20, Rgba::WHITE);
        e.settings_mut().color = RED;
        e.begin_text_layer(Point::new(4.0, 4.0)).unwrap();
        type_text(&mut e, "ab", 4, 2);
        e.commit_session();
        e.set_tool(ToolKind::Pencil);
        assert_eq!(e.edit_refusal(), Some(EditRefusal::TextLayer));
        assert!(!e.pointer_down(Point::new(4.0, 4.0), false, false));

        e.begin_transform().unwrap();
        e.transform_nudge(2.0, 0.0);
        assert!(e.commit_session());
        assert_eq!(px(&e, 6, 4), RED);
        assert_eq!(px(&e, 4, 4), Rgba::WHITE);
        assert_eq!(e.document().active_layer().kind.name(), "text", "still text after a transform");
        e.begin_text_edit(1).unwrap();
        type_text(&mut e, "abcd", 8, 2);
        assert_eq!(px(&e, 6, 4), RED, "set again where the transform put it");
        assert_eq!(px(&e, 13, 5), RED);
        e.commit_session();

        e.rasterize_layer(1).unwrap();
        assert_eq!(e.document().active_layer().kind.name(), "pixels");
        assert_eq!(e.layer_text(1), None);
        assert_eq!(e.edit_refusal(), None);
    }

    #[test]
    fn a_layer_operation_or_an_undo_ends_the_session() {
        let mut e = Editor::new(20, 20, Rgba::WHITE);
        e.begin_text_layer(Point::new(4.0, 4.0)).unwrap();
        type_text(&mut e, "ab", 4, 2);
        e.add_layer();
        assert!(!e.is_editing_text());
        assert_eq!(e.document().layers().len(), 2, "the unfinished text went, the new layer came");
        assert!(e.document().layers().iter().all(|l| !l.is_text()));

        e.begin_text_layer(Point::new(4.0, 4.0)).unwrap();
        type_text(&mut e, "ab", 4, 2);
        assert!(e.undo(), "the New Layer step");
        assert!(!e.is_editing_text());
        assert_eq!(e.document().layers().len(), 1);

        // A text session takes the pointer over: a click starts nothing.
        e.begin_text_layer(Point::new(4.0, 4.0)).unwrap();
        e.set_tool(ToolKind::Brush);
        assert!(!e.pointer_down(Point::new(1.0, 1.0), false, false));
        assert!(e.is_editing_text());
        e.cancel_session();
    }

    #[test]
    fn a_locked_or_hidden_text_layer_is_not_edited() {
        let mut e = Editor::new(20, 20, Rgba::WHITE);
        e.begin_text_layer(Point::new(4.0, 4.0)).unwrap();
        type_text(&mut e, "ab", 4, 2);
        e.commit_session();
        e.set_layer_locked(1, true).unwrap();
        assert_eq!(e.begin_text_edit(1), Err(SessionError::Uneditable(EditRefusal::Locked)));
        e.set_layer_locked(1, false).unwrap();
        e.set_layer_visible(1, false).unwrap();
        assert_eq!(e.begin_text_edit(1), Err(SessionError::Hidden));
        assert_eq!(e.text_layer_at(Point::new(5.0, 5.0)), None);
    }

    #[test]
    fn the_move_tool_and_the_arrow_keys_move_text_by_its_placement() {
        let mut e = Editor::new(20, 20, Rgba::WHITE);
        e.settings_mut().color = RED;
        e.begin_text_layer(Point::new(4.0, 4.0)).unwrap();
        type_text(&mut e, "ab", 4, 2);
        e.commit_session();
        e.set_tool(ToolKind::Move);
        assert_eq!(e.edit_refusal(), None, "the move tool is not refused a text layer");

        // A drag: the placement moves, the text stays text, one step called Move.
        assert!(e.pointer_down(Point::new(5.0, 5.0), false, false));
        assert!(e.is_transforming(), "a move of a smart object is a transform underneath");
        assert!(e.pointer_move(Point::new(8.0, 6.0), false, false, false));
        assert!(e.pointer_up(Point::new(8.0, 6.0), false, false));
        assert!(!e.is_transforming());
        assert_eq!(px(&e, 7, 5), RED);
        assert_eq!(px(&e, 4, 4), Rgba::WHITE);
        assert_eq!(e.document().active_layer().kind.name(), "text");
        assert_eq!(e.history_labels().last().map(String::as_str), Some("Move"));
        assert_eq!(e.layer_placement(1).unwrap().apply(Point::new(1.0, 1.0)), Point::new(7.0, 5.0));

        // A click that goes nowhere is not a step.
        let steps = e.history_labels().len();
        assert!(e.pointer_down(Point::new(8.0, 6.0), false, false));
        assert!(e.pointer_up(Point::new(8.0, 6.0), false, false));
        assert_eq!(e.history_labels().len(), steps);
        assert!(!e.is_transforming());

        // Escape mid-drag puts it back.
        assert!(e.pointer_down(Point::new(8.0, 6.0), false, false));
        e.pointer_move(Point::new(12.0, 6.0), false, false, false);
        assert_eq!(px(&e, 11, 5), RED);
        assert!(e.cancel_gesture());
        assert!(!e.is_transforming());
        assert_eq!(px(&e, 11, 5), Rgba::WHITE);
        assert_eq!(px(&e, 7, 5), RED);
        assert_eq!(e.history_labels().len(), steps);

        // The arrow keys, coalesced into one step.
        assert!(e.nudge_layer(1, 0));
        assert!(e.nudge_layer(1, 0));
        assert_eq!(px(&e, 9, 5), RED);
        assert_eq!(px(&e, 7, 5), Rgba::WHITE);
        assert_eq!(e.history_labels().len(), steps + 1);
        assert!(e.undo());
        assert_eq!(px(&e, 7, 5), RED, "both nudges undone together");
        assert!(e.document().active_layer().is_text());

        // Editing the text afterwards keeps it where it was moved to.
        e.begin_text_edit(1).unwrap();
        type_text(&mut e, "abcd", 8, 2);
        assert_eq!(px(&e, 7, 5), RED);
        assert_eq!(px(&e, 14, 5), RED);
        e.commit_session();

        // Locked, it is refused like anything else.
        e.set_layer_locked(1, true).unwrap();
        assert!(!e.pointer_down(Point::new(8.0, 6.0), false, false));
        assert_eq!(e.edit_refusal(), Some(EditRefusal::Locked));
        assert!(!e.nudge_layer(1, 0));
    }

    #[test]
    fn a_plain_smart_object_moves_the_same_way() {
        let mut e = Editor::new(8, 8, Rgba::TRANSPARENT);
        e.place_smart_object("photo", Raster::filled(2, 2, RED));
        e.set_tool(ToolKind::Move);
        assert!(e.pointer_down(Point::new(3.0, 3.0), false, false));
        e.pointer_move(Point::new(5.0, 3.0), false, false, false);
        e.pointer_up(Point::new(5.0, 3.0), false, false);
        assert_eq!(px(&e, 5, 3), RED);
        assert_eq!(px(&e, 3, 3).a, 0);
        assert!(e.document().active_layer().is_smart(), "still a smart object");
        assert_eq!(e.history_labels().last().map(String::as_str), Some("Move"));
        // On its mask, the move tool moves the mask's pixels as before.
        e.add_layer_mask(1, false).unwrap();
        assert!(e.pointer_down(Point::new(5.0, 3.0), false, false));
        assert!(!e.is_transforming());
        e.pointer_up(Point::new(5.0, 3.0), false, false);
    }

    #[test]
    fn text_survives_the_file() {
        let mut e = Editor::new(20, 20, Rgba::WHITE);
        e.settings_mut().color = RED;
        e.settings_mut().text.font = "serif".to_owned();
        e.settings_mut().text.bold = true;
        e.begin_text_layer(Point::new(4.0, 4.0)).unwrap();
        type_text(&mut e, "ab\ncd", 4, 2);
        e.commit_session();
        let bytes = e.save_document();
        let mut back = Editor::new(1, 1, Rgba::WHITE);
        back.open_document(&bytes).unwrap();
        let t = back.layer_text(1).unwrap();
        assert_eq!(t.text, "ab\ncd");
        assert_eq!(t.style.font, "serif");
        assert!(t.style.bold);
        assert_eq!(t.color, RED);
        assert_eq!(t.origin, Point::new(1.0, 1.0));
        assert_eq!(back.document(), e.document());
    }
}

#[cfg(test)]
mod scratch {
    use super::*;
    use crate::color::Rgba;
    use crate::geometry::Point;
    use crate::raster::Raster;

    #[test]
    fn dbg_undo_perspective_pixels() {
        let mut e = Editor::new(16, 16, Rgba::TRANSPARENT);
        e.set_tool(ToolKind::Select);
        e.pointer_down(Point::new(4.0, 4.0), false, false);
        e.pointer_up(Point::new(12.0, 12.0), false, false);
        e.settings_mut().color = Rgba::opaque(255, 0, 0);
        assert!(e.fill_selection());
        e.deselect();
        let before: Vec<_> = e.document().active_layer().raster.pixels().to_vec();
        e.begin_transform().unwrap();
        let h = e.transform_handles().unwrap();
        e.pointer_down(h[0], false, false);
        e.pointer_move(Point::new(h[0].x + 3.0, h[0].y + 1.0), false, false, true);
        e.pointer_up(Point::new(h[0].x + 3.0, h[0].y + 1.0), false, false);
        e.commit_session();
        let after: Vec<_> = e.document().active_layer().raster.pixels().to_vec();
        println!("changed {}", after != before);
        println!("undo {}", e.undo());
        let undone: Vec<_> = e.document().active_layer().raster.pixels().to_vec();
        println!("restored {}", undone == before);
        e.begin_transform().unwrap();
        println!("next session {:?}", e.transform_session().map(TransformSession::matrix));
        println!("next handles {:?}", e.transform_handles());
    }

    #[test]
    fn dbg_undo_perspective() {
        let mut e = Editor::new(16, 16, Rgba::TRANSPARENT);
        e.place_smart_object("photo", Raster::filled(8, 8, Rgba::opaque(255, 0, 0)));
        let first = e.layer_placement(e.document().active_index()).unwrap();
        e.begin_transform().unwrap();
        let h = e.transform_handles().unwrap();
        e.pointer_down(h[0], false, false);
        e.pointer_move(Point::new(h[0].x + 3.0, h[0].y + 1.0), false, false, true);
        e.pointer_up(Point::new(h[0].x + 3.0, h[0].y + 1.0), false, false);
        let distorted = e.transform_session().map(TransformSession::matrix).unwrap();
        assert!(distorted.as_affine().is_none());
        e.commit_session();
        println!("after commit {:?}", e.layer_placement(e.document().active_index()));
        println!("undo {}", e.undo());
        println!("after undo  {:?}", e.layer_placement(e.document().active_index()));
        println!("first       {:?}", first);
        e.begin_transform().unwrap();
        println!("next session {:?}", e.transform_session().map(TransformSession::matrix));
    }
}
