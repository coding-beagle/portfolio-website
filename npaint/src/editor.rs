//! The editor: one document, one selection, one viewport, one history and
//! the current tool, with every operation the page can ask for.
//!
//! This is the whole application minus the browser. Pointer positions come in
//! as *screen* coordinates and are mapped through the viewport here, so the
//! page hands events straight through. Every mutating method records undo
//! history itself; the page never sees a snapshot.

use crate::adjust::{Adjustment, AdjustmentError};
use crate::autoselect::{mask_from_matte, select_subject, ColorSet};
use crate::color::Rgba;
use crate::document::{Document, DocumentError};
use crate::geometry::{Point, Rect};
use crate::history::{History, Snapshot};
use crate::mask::{Mask, SelectMode};
use crate::raster::Raster;
use crate::selection::Selection;
use crate::tools::{Gesture, PointerEvent, Tool, ToolContext, ToolKind, ToolSettings};
use crate::transform::{Hit, TransformInfo, TransformSession};
use crate::viewport::Viewport;

/// How close to a transform handle counts as grabbing it, in screen pixels.
pub const HANDLE_GRAB_PX: f64 = 8.0;

/// A live edit of the active layer that the page previews and then commits
/// or cancels: an adjustment dialog or a free transform. Only one can be
/// open, and it takes over the pointer while it is.
enum Session {
    Adjust { base: Raster, clip: Rect },
    Transform(TransformSession),
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
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            SessionError::Busy => "finish the current adjustment or transform first",
            SessionError::Empty => "there is nothing on this layer to transform",
            SessionError::Hidden => "the active layer is hidden",
        })
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

pub struct Editor {
    document: Document,
    selection: Selection,
    viewport: Viewport,
    history: History,
    settings: ToolSettings,
    tool: Box<dyn Tool>,
    /// Set while a pointer gesture is in progress.
    gesture: Option<Gesture>,
    session: Option<Session>,
    /// The active layer before a transform began, restored on cancel and
    /// used as the undo snapshot on commit.
    transform_base: Option<Raster>,
    /// The active layer as it was when the current gesture began, kept only
    /// when the selection is a mask: painting clips to a rectangle, so what
    /// holds a ragged selection is putting these pixels back afterwards.
    gesture_base: Option<Raster>,
    /// Whether the composite the page last rendered is stale.
    dirty: bool,
}

impl Editor {
    pub fn new(width: u32, height: u32, background: Rgba) -> Editor {
        Editor {
            document: Document::new(width, height, background),
            selection: Selection::None,
            viewport: Viewport::default(),
            history: History::new(HISTORY_LIMIT),
            settings: ToolSettings::default(),
            tool: ToolKind::Brush.instantiate(),
            gesture: None,
            session: None,
            transform_base: None,
            gesture_base: None,
            dirty: true,
        }
    }

    /// Replaces the document with a fresh one. History and selection go with
    /// the old document; the tool and its settings stay.
    pub fn new_document(&mut self, width: u32, height: u32, background: Rgba) {
        self.cancel_session();
        self.abort_gesture();
        self.document = Document::new(width, height, background);
        self.selection = Selection::None;
        self.history.clear();
        self.dirty = true;
    }

    /// Replaces the document with an opened image, as [`Editor::new_document`]
    /// does with a blank one.
    pub fn open_image(&mut self, name: &str, raster: Raster) {
        self.cancel_session();
        self.abort_gesture();
        self.document = Document::from_raster(name, raster);
        self.selection = Selection::None;
        self.history.clear();
        self.dirty = true;
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
        self.dirty
    }

    /// Reports and clears the dirty flag: the page calls this once per frame
    /// and recomposites only when it says so.
    pub fn take_dirty(&mut self) -> bool {
        std::mem::replace(&mut self.dirty, false)
    }

    pub fn composite_into(&self, out: &mut Raster) {
        self.document.composite_into(out);
    }

    // ---- Tools and gestures -----------------------------------------------

    /// Switches tool. A gesture in progress is cancelled first, so switching
    /// mid-drag never leaves a half-drawn shape behind.
    pub fn set_tool(&mut self, kind: ToolKind) {
        if self.tool.kind() == kind {
            return;
        }
        self.abort_gesture();
        self.tool = kind.instantiate();
    }

    fn event(&self, screen: Point, shift: bool, alt: bool) -> PointerEvent {
        PointerEvent { pos: self.viewport.screen_to_doc(screen), screen, shift, alt }
    }

    /// The pointer went down at a screen position. Returns whether a gesture
    /// started; painting on a hidden layer is refused, since the result would
    /// be invisible and baffling.
    pub fn pointer_down(&mut self, screen: Point, shift: bool, alt: bool) -> bool {
        if self.gesture.is_some() {
            self.abort_gesture();
        }
        let ev = self.event(screen, shift, alt);
        match &mut self.session {
            Some(Session::Transform(t)) => {
                let tolerance = HANDLE_GRAB_PX / self.viewport.zoom();
                return t.pointer_down(ev.pos, tolerance);
            }
            Some(Session::Adjust { .. }) => return false,
            None => {}
        }
        if self.tool.kind().edits_pixels() && !self.document.active_layer().visible {
            return false;
        }
        let snapshot = Snapshot::of_active_layer(&self.document);
        self.gesture_base = (self.selection.needs_base() && self.tool.kind().confined_to_selection())
            .then(|| self.document.active_layer().raster.clone());
        let mut ctx = ToolContext {
            document: &mut self.document,
            selection: &mut self.selection,
            viewport: &mut self.viewport,
            settings: &self.settings,
        };
        let gesture = self.tool.begin(&mut ctx, ev);
        if gesture == Gesture::EditsActiveLayer {
            self.history.push(snapshot);
        }
        self.gesture = Some(gesture);
        self.dirty = true;
        true
    }

    pub fn pointer_move(&mut self, screen: Point, shift: bool, alt: bool) -> bool {
        let ev = self.event(screen, shift, alt);
        if let Some(Session::Transform(t)) = &mut self.session {
            let changed = t.pointer_move(ev.pos, shift, alt);
            if changed {
                self.document.active_layer_mut().raster = t.render();
                self.dirty = true;
            }
            return changed;
        }
        if self.gesture.is_none() {
            return false;
        }
        let mut ctx = ToolContext {
            document: &mut self.document,
            selection: &mut self.selection,
            viewport: &mut self.viewport,
            settings: &self.settings,
        };
        let changed = self.tool.update(&mut ctx, ev);
        if changed {
            self.enforce_selection();
        }
        self.dirty |= changed;
        changed
    }

    pub fn pointer_up(&mut self, screen: Point, shift: bool, alt: bool) -> bool {
        if let Some(Session::Transform(t)) = &mut self.session {
            t.pointer_up();
            return false;
        }
        if self.gesture.is_none() {
            return false;
        }
        let ev = self.event(screen, shift, alt);
        let mut ctx = ToolContext {
            document: &mut self.document,
            selection: &mut self.selection,
            viewport: &mut self.viewport,
            settings: &self.settings,
        };
        let changed = self.tool.finish(&mut ctx, ev);
        if changed {
            self.enforce_selection();
        }
        self.gesture_base = None;
        self.gesture = None;
        self.dirty |= changed;
        changed
    }

    /// Puts back the pixels the gesture was not allowed to touch. Does
    /// nothing unless the selection is a mask and a base was kept.
    fn enforce_selection(&mut self) {
        if let Some(base) = self.gesture_base.as_ref() {
            let raster = &mut self.document.active_layer_mut().raster;
            self.selection.apply(raster, base);
        }
    }

    /// Abandons the gesture in progress and the undo step it opened.
    pub fn cancel_gesture(&mut self) -> bool {
        self.abort_gesture()
    }

    fn abort_gesture(&mut self) -> bool {
        let Some(gesture) = self.gesture.take() else { return false };
        let mut ctx = ToolContext {
            document: &mut self.document,
            selection: &mut self.selection,
            viewport: &mut self.viewport,
            settings: &self.settings,
        };
        self.tool.cancel(&mut ctx);
        self.gesture_base = None;
        if gesture == Gesture::EditsActiveLayer {
            // The tool has put the pixels back, so the step recorded for this
            // gesture would be an undo that does nothing. Drop it.
            self.history.discard_last();
        }
        self.dirty = true;
        true
    }

    // ---- History -----------------------------------------------------------

    pub fn undo(&mut self) -> bool {
        self.cancel_session();
        self.abort_gesture();
        let done = self.history.undo(&mut self.document);
        self.dirty |= done;
        done
    }

    pub fn redo(&mut self) -> bool {
        self.cancel_session();
        self.abort_gesture();
        let done = self.history.redo(&mut self.document);
        self.dirty |= done;
        done
    }

    // ---- Layers -------------------------------------------------------------
    //
    // Each of these is an undoable step that snapshots the whole stack.

    fn structural<T>(&mut self, op: impl FnOnce(&mut Document) -> Result<T, DocumentError>) -> Result<T, DocumentError> {
        self.cancel_session();
        self.abort_gesture();
        let snapshot = Snapshot::of_structure(&self.document);
        let result = op(&mut self.document)?;
        self.history.push(snapshot);
        self.dirty = true;
        Ok(result)
    }

    pub fn add_layer(&mut self) -> usize {
        self.structural(|d| Ok(d.add_layer())).expect("adding a layer cannot fail")
    }

    pub fn add_layer_from(&mut self, name: &str, raster: Raster) -> Result<usize, DocumentError> {
        self.structural(|d| d.add_layer_from(name, raster))
    }

    pub fn duplicate_layer(&mut self, index: usize) -> Result<usize, DocumentError> {
        self.structural(|d| d.duplicate_layer(index))
    }

    pub fn remove_layer(&mut self, index: usize) -> Result<(), DocumentError> {
        self.structural(|d| d.remove_layer(index))
    }

    pub fn move_layer(&mut self, from: usize, to: usize) -> Result<(), DocumentError> {
        if from == to {
            return Ok(());
        }
        self.structural(|d| d.move_layer(from, to))
    }

    pub fn merge_down(&mut self, index: usize) -> Result<(), DocumentError> {
        self.structural(|d| d.merge_down(index))
    }

    /// Changing the active layer is not an edit, so it is not in the history.
    pub fn set_active_layer(&mut self, index: usize) -> Result<(), DocumentError> {
        self.abort_gesture();
        self.document.set_active(index)
    }

    pub fn set_layer_visible(&mut self, index: usize, visible: bool) -> Result<(), DocumentError> {
        self.structural(|d| {
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
        self.history.push_coalescing(snapshot, format!("opacity:{index}"));
        self.dirty = true;
        Ok(())
    }

    pub fn rename_layer(&mut self, index: usize, name: &str) -> Result<(), DocumentError> {
        let name = name.trim();
        if name.is_empty() {
            return Ok(());
        }
        self.structural(|d| {
            d.layer_mut(index).ok_or(DocumentError::NoSuchLayer)?.name = name.to_owned();
            Ok(())
        })
    }

    /// An undoable edit of the active layer's pixels inside the selection.
    /// Returns false when the clip is empty or the layer hidden.
    fn pixel_edit(&mut self, op: impl FnOnce(&mut Raster, Rect)) -> bool {
        self.cancel_session();
        self.abort_gesture();
        let clip = self.selection.clip(self.document.bounds());
        if clip.is_empty() {
            return false;
        }
        self.history.push(Snapshot::of_active_layer(&self.document));
        let base = self.selection.needs_base().then(|| self.document.active_layer().raster.clone());
        op(&mut self.document.active_layer_mut().raster, clip);
        if let Some(base) = base {
            let raster = &mut self.document.active_layer_mut().raster;
            self.selection.apply(raster, &base);
        }
        self.dirty = true;
        true
    }

    /// Clears the selected region of the active layer to transparent, or the
    /// whole layer when nothing is selected — the Delete key.
    pub fn clear_selection(&mut self) -> bool {
        self.pixel_edit(|raster, clip| raster.map_in(&clip, |_| Rgba::TRANSPARENT))
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
        self.pixel_edit(|raster, clip| raster.fill_rect(clip, color, &clip))
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
        self.pixel_edit(|raster, clip| adjustment.apply(raster, &clip))
    }

    // ---- Layer transforms (whole layer, undoable) ------------------------------

    fn layer_pixels(&mut self, op: impl FnOnce(&Raster) -> Raster) -> bool {
        self.cancel_session();
        self.abort_gesture();
        self.history.push(Snapshot::of_active_layer(&self.document));
        let layer = &mut self.document.active_layer_mut().raster;
        *layer = op(layer);
        self.dirty = true;
        true
    }

    pub fn flip_layer_horizontal(&mut self) -> bool {
        self.layer_pixels(Raster::flipped_horizontal)
    }

    pub fn flip_layer_vertical(&mut self) -> bool {
        self.layer_pixels(Raster::flipped_vertical)
    }

    /// Rotates the active layer's pixels by quarter turns about the canvas
    /// centre, exactly; what leaves the canvas is lost.
    pub fn rotate_layer(&mut self, turns: i32) -> bool {
        let (w, h) = (self.document.width(), self.document.height());
        self.layer_pixels(|r| r.rotated_quarter(turns).recentred(w, h))
    }

    // ---- Canvas (every layer, undoable) -----------------------------------------

    pub fn rotate_canvas(&mut self, turns: i32) {
        self.structural(|d| {
            d.rotate_canvas(turns);
            Ok(())
        })
        .expect("rotating cannot fail");
        // The canvas changed shape, so a selection in the old coordinates is
        // meaningless.
        self.selection = Selection::None;
    }

    /// Resizes the canvas as one undoable step, keeping the pixels at
    /// `(dx, dy)` in the new canvas — what dragging an edge does. The
    /// selection is dropped: it was in the old coordinates.
    pub fn resize_canvas(&mut self, width: u32, height: u32, dx: i32, dy: i32) -> bool {
        if !canvas_fits(width, height) {
            return false;
        }
        if width == self.document.width() && height == self.document.height() {
            return false;
        }
        self.structural(|d| {
            d.resize_canvas(width, height, dx, dy);
            Ok(())
        })
        .expect("resizing cannot fail");
        self.selection = Selection::None;
        true
    }

    pub fn flip_canvas_horizontal(&mut self) {
        self.structural(|d| {
            d.flip_canvas_horizontal();
            Ok(())
        })
        .expect("flipping cannot fail");
    }

    pub fn flip_canvas_vertical(&mut self) {
        self.structural(|d| {
            d.flip_canvas_vertical();
            Ok(())
        })
        .expect("flipping cannot fail");
    }

    pub fn flatten(&mut self) {
        self.structural(|d| {
            d.flatten();
            Ok(())
        })
        .expect("flattening cannot fail");
    }

    /// Copies the selected pixels of the active layer to a new layer above it.
    pub fn layer_via_copy(&mut self) -> usize {
        let clip = self.selection.clip(self.document.bounds());
        let index = self.structural(|d| Ok(d.layer_via_copy(clip))).expect("copying cannot fail");
        // The copy took the whole bounding box; a mask keeps only its own
        // pixels of it.
        if self.selection.needs_base() {
            let blank = Raster::new(self.document.width(), self.document.height());
            if let Some(layer) = self.document.layer_mut(index) {
                self.selection.apply(&mut layer.raster, &blank);
            }
        }
        index
    }

    // ---- Adjustment session (dialog with live preview) ---------------------------

    pub fn has_session(&self) -> bool {
        self.session.is_some()
    }

    pub fn is_adjusting(&self) -> bool {
        matches!(self.session, Some(Session::Adjust { .. }))
    }

    pub fn is_transforming(&self) -> bool {
        matches!(self.session, Some(Session::Transform(_)))
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

    /// Starts previewing adjustments on the active layer's selected pixels.
    pub fn begin_adjustment(&mut self) -> Result<(), SessionError> {
        self.open_session()?;
        let clip = self.selection.clip(self.document.bounds());
        self.session = Some(Session::Adjust { base: self.document.active_layer().raster.clone(), clip });
        Ok(())
    }

    /// Shows `adjustment` applied to the original pixels (previews do not
    /// stack). The session must be open.
    pub fn preview_adjustment(&mut self, name: &str, params: &[f32]) -> Result<(), AdjustmentError> {
        let adjustment = Adjustment::from_params(name, params)?;
        let Some(Session::Adjust { base, clip }) = &self.session else {
            return Err(AdjustmentError("no adjustment in progress".to_owned()));
        };
        let mut out = base.clone();
        adjustment.apply(&mut out, clip);
        self.selection.apply(&mut out, base);
        self.document.active_layer_mut().raster = out;
        self.dirty = true;
        Ok(())
    }

    /// Keeps whatever is currently previewed as one undo step.
    pub fn commit_session(&mut self) -> bool {
        let Some(session) = self.session.take() else { return false };
        match session {
            Session::Adjust { base, .. } => {
                let now = std::mem::replace(&mut self.document.active_layer_mut().raster, base);
                self.history.push(Snapshot::of_active_layer(&self.document));
                self.document.active_layer_mut().raster = now;
            }
            Session::Transform(t) => {
                let rendered = t.render();
                let before = self.transform_base.take().expect("a transform keeps its base");
                self.document.active_layer_mut().raster = before;
                self.history.push(Snapshot::of_active_layer(&self.document));
                self.document.active_layer_mut().raster = rendered;
                if let Some(rect) = t.moved_selection() {
                    let bounds = self.document.bounds();
                    self.selection.set_rect(rect, bounds);
                }
            }
        }
        self.dirty = true;
        true
    }

    /// Puts the layer back the way it was before the session.
    pub fn cancel_session(&mut self) -> bool {
        let Some(session) = self.session.take() else { return false };
        match session {
            Session::Adjust { base, .. } => self.document.active_layer_mut().raster = base,
            Session::Transform(_) => {
                if let Some(base) = self.transform_base.take() {
                    self.document.active_layer_mut().raster = base;
                }
            }
        }
        self.dirty = true;
        true
    }

    // ---- Transform session (Ctrl+T) ------------------------------------------------

    /// Starts a free transform of the selected pixels, or of the whole layer
    /// when nothing is selected.
    pub fn begin_transform(&mut self) -> Result<(), SessionError> {
        self.open_session()?;
        let layer = &self.document.active_layer().raster;
        let session = match self.selection.rect() {
            // A selection hands over its own pixels: only it knows which ones
            // it holds, and a mask holds less than its bounding box.
            Some(rect) => {
                let (moving, stationary) = self.selection.split(layer);
                TransformSession::from_parts(moving, stationary, rect.intersect(&layer.bounds()), Some(rect))
            }
            None => TransformSession::new(layer, None),
        }
        .ok_or(SessionError::Empty)?;
        self.transform_base = Some(layer.clone());
        self.session = Some(Session::Transform(session));
        Ok(())
    }

    fn transform_session(&self) -> Option<&TransformSession> {
        match &self.session {
            Some(Session::Transform(t)) => Some(t),
            _ => None,
        }
    }

    fn with_transform(&mut self, op: impl FnOnce(&mut TransformSession)) -> bool {
        let Some(Session::Transform(t)) = &mut self.session else { return false };
        op(t);
        self.document.active_layer_mut().raster = t.render();
        self.dirty = true;
        true
    }

    /// The transform box's eight handles in screen space, in
    /// [`crate::transform::Handle::ALL`] order.
    pub fn transform_handles(&self) -> Option<[Point; 8]> {
        let t = self.transform_session()?;
        Some(t.handles().map(|p| self.viewport.doc_to_screen(p)))
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

    // ---- Selection -----------------------------------------------------------

    pub fn select_all(&mut self) {
        self.selection = Selection::Rect(self.document.bounds());
        self.dirty = true;
    }

    pub fn deselect(&mut self) {
        self.selection = Selection::None;
        self.dirty = true;
    }

    pub fn selection_rect(&self) -> Option<Rect> {
        self.selection.rect()
    }

    /// The marching ants: closed loops in document coordinates, one per
    /// island and one per hole.
    pub fn selection_contours(&self) -> Vec<Vec<Point>> {
        self.selection.contours(self.document.bounds())
    }

    /// How many pixels are selected, for the status bar.
    pub fn selection_area(&self) -> usize {
        match self.selection() {
            Selection::None => 0,
            Selection::Rect(r) => r.area().max(0) as usize,
            Selection::Mask(m) => m.count(),
        }
    }

    /// The pixels the automatic selections read: the active layer, or the
    /// flattened image when the options bar asks for it.
    fn sample(&self) -> Raster {
        if self.settings.sample_all_layers {
            self.document.composite()
        } else {
            self.document.active_layer().raster.clone()
        }
    }

    /// Swaps what is selected for what is not.
    pub fn invert_selection(&mut self) -> bool {
        let bounds = self.document.bounds();
        self.selection.invert(bounds);
        self.dirty = true;
        true
    }

    /// Moves the edge of the selection out or in by `pixels`.
    pub fn expand_selection(&mut self, pixels: u32) -> bool {
        let bounds = self.document.bounds();
        self.dirty = true;
        self.selection.modify(bounds, |m| m.grow(pixels))
    }

    pub fn contract_selection(&mut self, pixels: u32) -> bool {
        let bounds = self.document.bounds();
        self.dirty = true;
        self.selection.modify(bounds, |m| m.contract(pixels))
    }

    /// Fades the edge over `pixels`, so what is done inside fades out rather
    /// than stopping dead.
    pub fn feather_selection(&mut self, pixels: u32) -> bool {
        let bounds = self.document.bounds();
        self.dirty = true;
        self.selection.modify(bounds, |m| m.feather(pixels))
    }

    /// Rounds off the edge, taking out spurs and nicks.
    pub fn smooth_selection(&mut self, pixels: u32) -> bool {
        let bounds = self.document.bounds();
        self.dirty = true;
        self.selection.modify(bounds, |m| m.smooth(pixels))
    }

    /// Selects everything a particular layer draws, whatever is active —
    /// what Ctrl-clicking its thumbnail asks for.
    pub fn select_layer_opaque(&mut self, index: usize, mode: SelectMode) -> Result<bool, DocumentError> {
        let raster = self.document.layer(index).ok_or(DocumentError::NoSuchLayer)?.raster.clone();
        Ok(self.select_opaque_of(&raster, mode))
    }

    /// Selects everything the active layer actually draws — its opaque
    /// pixels — which is the exact selection for anything already cut out.
    pub fn select_opaque(&mut self, mode: SelectMode) -> bool {
        let source = self.sample();
        self.select_opaque_of(&source, mode)
    }

    fn select_opaque_of(&mut self, source: &Raster, mode: SelectMode) -> bool {
        let mask = Mask::from_fn(source.width(), source.height(), |x, y| {
            // Partly transparent pixels are partly selected: the edge of a
            // cut-out is already antialiased, and this keeps it that way.
            source.get(x, y).a
        });
        if mask.is_empty() {
            return false;
        }
        let bounds = self.document.bounds();
        self.selection.combine(&mask, mode, bounds);
        self.dirty = true;
        true
    }

    /// Extends the selection to every pixel in the image that looks like one
    /// already in it, wherever it is — Photoshop's Select Similar.
    pub fn select_similar(&mut self) -> bool {
        let Some(area) = self.selection.rect() else { return false };
        let source = self.sample();
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
        let bounds = self.document.bounds();
        self.selection.combine(&mask, SelectMode::Add, bounds);
        self.dirty = true;
        true
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
        let bounds = self.document.bounds();
        self.selection.combine(&mask, mode, bounds);
        self.dirty = true;
        true
    }

    /// Finds the subject of the picture and selects it. False when there is
    /// nothing that stands out to select.
    pub fn select_subject(&mut self, mode: SelectMode) -> bool {
        let source = self.sample();
        let mask = select_subject(&source);
        if mask.is_empty() || mask.is_everything() {
            return false;
        }
        let bounds = self.document.bounds();
        self.selection.combine(&mask, mode, bounds);
        self.dirty = true;
        true
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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn a_stroke_paints_and_undoes() {
        let mut e = editor();
        assert!(e.take_dirty(), "a new editor needs a first render");
        assert!(!e.take_dirty());

        click(&mut e, 3.0, 3.0);
        assert_eq!(px(&e, 3, 3), RED);
        assert!(e.take_dirty());
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
        assert!(!e.pointer_move(Point::new(1.0, 1.0), false, false));
        assert!(!e.pointer_up(Point::new(1.0, 1.0), false, false));
        assert!(!e.can_undo());
    }

    #[test]
    fn cancelling_a_gesture_leaves_no_undo_step() {
        let mut e = editor();
        e.pointer_down(Point::new(1.0, 1.0), false, false);
        e.pointer_move(Point::new(9.0, 9.0), false, false);
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
        e.pointer_move(Point::new(10.0, 10.0), false, false);
        assert_eq!(px(&e, 5, 5), RED);
        e.set_tool(ToolKind::Brush);
        assert_eq!(px(&e, 5, 5), Rgba::WHITE);
        assert!(!e.is_gesturing());
    }

    #[test]
    fn marquee_does_not_touch_history_but_constrains_paint() {
        let mut e = editor();
        e.set_tool(ToolKind::Select);
        e.pointer_down(Point::new(0.0, 0.0), false, false);
        e.pointer_up(Point::new(5.0, 5.0), false, false);
        assert_eq!(e.selection_rect(), Some(Rect::new(0, 0, 5, 5)));
        assert!(!e.can_undo());

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
        assert!(e.move_layer(1, 1).is_ok());
        assert_eq!(e.document().layers().len(), 2);
        // Only the add is in the history.
        assert!(e.undo());
        assert!(!e.can_undo());
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
        assert!(e.apply_adjustment(Adjustment::Invert));
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
        e.pointer_move(Point::new(72.0, 32.0), false, false);
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
}
