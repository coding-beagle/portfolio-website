//! Undo and redo.
//!
//! Every undoable edit is recorded as a [`Snapshot`] of the state it is about
//! to change, taken *before* the change, under a label the history panel
//! shows. Pixel edits snapshot only the layer they touch; anything that
//! changes the shape of the stack snapshots the whole document. Undoing a
//! snapshot captures the matching "after" state on the redo stack, so the
//! two stacks are symmetric and a redo is an undo of an undo.
//!
//! Every step also carries an [`Aside`]: the selection and the guides as
//! they stood before the step. They are not part of the document, but
//! undoing a move should bring the marquee back with the pixels, and
//! changing the selection or a guide is a step in its own right — one whose
//! snapshot is [`Snapshot::Nothing`].

use crate::document::Document;
use crate::layer::{Layer, LayerId, Target};
use crate::raster::Raster;
use crate::selection::Selection;

// A snapshot is built once and moved into the history; what the variants
// weigh in memory is their rasters, not the enum.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq)]
pub enum Snapshot {
    /// One surface of one layer — its pixels or its mask — found by id so a
    /// later reorder does not point the restore at the wrong layer.
    LayerPixels { id: LayerId, target: Target, raster: Raster },
    /// A whole layer: pixels, mask, kind and properties. For the edits that
    /// touch more than one of those at once, such as flipping a layer or
    /// transforming a smart object.
    Layer(Layer),
    /// Everything: the layer list, its order, the active layer.
    Structure(Document),
    /// No part of the document: the step changed only its [`Aside`].
    Nothing,
}

/// What travels with a step besides the document: the selection and the
/// guide positions. Snapping on or off is a preference, not state, and is
/// not here.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Aside {
    pub selection: Selection,
    pub guides_h: Vec<f64>,
    pub guides_v: Vec<f64>,
}

impl Snapshot {
    /// The surface the layer is currently editing.
    pub fn of_layer(doc: &Document, index: usize) -> Option<Snapshot> {
        let layer = doc.layer(index)?;
        let target = if layer.editing_mask() { Target::Mask } else { Target::Pixels };
        Some(Snapshot::LayerPixels { id: layer.id(), target, raster: layer.surface().clone() })
    }

    pub fn of_active_layer(doc: &Document) -> Snapshot {
        Snapshot::of_layer(doc, doc.active_index()).expect("the active layer exists")
    }

    pub fn of_whole_layer(doc: &Document, index: usize) -> Option<Snapshot> {
        Some(Snapshot::Layer(doc.layer(index)?.clone()))
    }

    pub fn of_structure(doc: &Document) -> Snapshot {
        Snapshot::Structure(doc.clone())
    }

    /// Applies the snapshot to `doc`, returning the snapshot that undoes the
    /// application. A layer snapshot whose layer no longer exists is a no-op
    /// that returns itself; the history stays consistent either way.
    fn restore(self, doc: &mut Document) -> Snapshot {
        match self {
            Snapshot::LayerPixels { id, target, raster } => match doc.index_of(id) {
                Some(index) => {
                    let layer = doc.layer_mut(index).expect("index came from index_of");
                    let slot = match (target, &mut layer.mask) {
                        (Target::Mask, Some(mask)) => mask,
                        // The mask this snapshot holds has been deleted since;
                        // there is nowhere to put it back, so leave things be.
                        (Target::Mask, None) => return Snapshot::LayerPixels { id, target, raster },
                        (Target::Pixels, _) => &mut layer.raster,
                    };
                    let previous = std::mem::replace(slot, raster);
                    Snapshot::LayerPixels { id, target, raster: previous }
                }
                None => Snapshot::LayerPixels { id, target, raster },
            },
            Snapshot::Layer(layer) => match doc.index_of(layer.id()) {
                Some(index) => {
                    let slot = doc.layer_mut(index).expect("index came from index_of");
                    Snapshot::Layer(std::mem::replace(slot, layer))
                }
                None => Snapshot::Layer(layer),
            },
            Snapshot::Structure(saved) => Snapshot::Structure(std::mem::replace(doc, saved)),
            Snapshot::Nothing => Snapshot::Nothing,
        }
    }
}

/// One entry of either stack: the state to restore, what the step that
/// made it was called, and the id of the document state the step leads
/// to, so the history can tell whether the document is back at the state
/// it was saved in.
#[derive(Clone, Debug)]
struct Step {
    snapshot: Snapshot,
    aside: Aside,
    label: String,
    after: u64,
}

impl Step {
    /// Applies the step and returns the step that reverses it.
    fn restore(self, doc: &mut Document, aside: &mut Aside) -> Step {
        let snapshot = self.snapshot.restore(doc);
        let aside = std::mem::replace(aside, self.aside);
        Step { snapshot, aside, label: self.label, after: self.after }
    }
}

#[derive(Clone, Debug, Default)]
pub struct History {
    undo: Vec<Step>,
    redo: Vec<Step>,
    limit: usize,
    /// The coalescing key of the most recent push, if it had one.
    last_key: Option<String>,
    /// Hands out state ids: every new step leads to a new state.
    serial: u64,
    /// The id of the state with nothing applied.
    base: u64,
    /// The id of the state that was last saved.
    saved: u64,
}

impl History {
    /// `limit` is the number of steps kept; the oldest is dropped past it.
    pub fn new(limit: usize) -> History {
        History { undo: Vec::new(), redo: Vec::new(), limit: limit.max(1), last_key: None, serial: 0, base: 0, saved: 0 }
    }

    /// The id of the document state as it stands.
    fn current(&self) -> u64 {
        self.undo.last().map_or(self.base, |s| s.after)
    }

    pub fn limit(&self) -> usize {
        self.limit
    }

    /// Changes how many steps are kept, dropping the oldest at once if
    /// there are now too many.
    pub fn set_limit(&mut self, limit: usize) {
        self.limit = limit.max(1);
        self.trim();
    }

    fn trim(&mut self) {
        if self.undo.len() > self.limit {
            let extra = self.undo.len() - self.limit;
            // The oldest reachable state is now the one the last dropped
            // step led to.
            self.base = self.undo[extra - 1].after;
            self.undo.drain(..extra);
        }
    }

    /// Records the state *before* an edit. Any redo history is discarded, as
    /// it no longer leads anywhere reachable.
    pub fn push(&mut self, snapshot: Snapshot, aside: Aside, label: impl Into<String>) {
        self.push_keyed(snapshot, aside, label.into(), None);
    }

    /// Like [`History::push`], but a run of consecutive pushes with the same
    /// `key` is one undo step: the first snapshot is kept and the rest are
    /// dropped. This is what makes dragging an opacity slider a single undo
    /// rather than one per pixel of travel. Any other push breaks the run.
    pub fn push_coalescing(&mut self, snapshot: Snapshot, aside: Aside, label: impl Into<String>, key: impl Into<String>) {
        self.push_keyed(snapshot, aside, label.into(), Some(key.into()));
    }

    fn push_keyed(&mut self, snapshot: Snapshot, aside: Aside, label: String, key: Option<String>) {
        let continues_run = key.is_some() && key == self.last_key && self.redo.is_empty();
        self.last_key = key;
        if continues_run {
            return;
        }
        self.redo.clear();
        self.serial += 1;
        self.undo.push(Step { snapshot, aside, label, after: self.serial });
        self.trim();
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    pub fn undo(&mut self, doc: &mut Document, aside: &mut Aside) -> bool {
        self.last_key = None;
        match self.undo.pop() {
            Some(step) => {
                self.redo.push(step.restore(doc, aside));
                true
            }
            None => false,
        }
    }

    pub fn redo(&mut self, doc: &mut Document, aside: &mut Aside) -> bool {
        self.last_key = None;
        match self.redo.pop() {
            Some(step) => {
                self.undo.push(step.restore(doc, aside));
                true
            }
            None => false,
        }
    }

    /// Forgets the most recent undo step without applying it, for an edit
    /// that was recorded and then abandoned. Returns whether there was one.
    pub fn discard_last(&mut self) -> bool {
        self.last_key = None;
        self.undo.pop().is_some()
    }

    pub fn clear(&mut self) {
        self.undo.clear();
        self.redo.clear();
        self.last_key = None;
        self.serial += 1;
        self.base = self.serial;
        self.saved = self.serial;
    }

    // ---- The history panel ------------------------------------------------------

    /// The labels of every step, oldest first: the ones that have been done,
    /// then the ones undone and waiting to be redone. [`History::position`]
    /// says where the split is.
    pub fn labels(&self) -> Vec<String> {
        self.undo.iter().map(|s| s.label.clone()).chain(self.redo.iter().rev().map(|s| s.label.clone())).collect()
    }

    /// How many of the steps in [`History::labels`] are currently applied.
    pub fn position(&self) -> usize {
        self.undo.len()
    }

    /// Undoes or redoes as many steps as it takes to have exactly `steps`
    /// applied — clicking a row of the history panel. Returns whether
    /// anything changed.
    pub fn go_to(&mut self, doc: &mut Document, aside: &mut Aside, steps: usize) -> bool {
        let mut moved = false;
        while self.undo.len() > steps && self.undo(doc, aside) {
            moved = true;
        }
        while self.undo.len() < steps && self.redo(doc, aside) {
            moved = true;
        }
        moved
    }

    // ---- Saved state ---------------------------------------------------------------

    /// Notes that the document as it stands now is what is on disk.
    pub fn mark_saved(&mut self) {
        self.saved = self.current();
    }

    /// Whether the document differs from the last saved (or opened) state.
    pub fn is_modified(&self) -> bool {
        self.saved != self.current()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::Rgba;

    const RED: Rgba = Rgba::opaque(255, 0, 0);

    #[test]
    fn a_step_brings_its_selection_and_guides_back() {
        let mut doc = Document::new(4, 4, Rgba::WHITE);
        let mut aside = Aside { selection: Selection::Rect(crate::geometry::Rect::new(0, 0, 2, 2)), guides_h: vec![1.0], guides_v: vec![] };
        let mut history = History::new(10);
        history.push(Snapshot::Nothing, aside.clone(), "Deselect");
        let before = aside.clone();
        aside.selection = Selection::None;
        aside.guides_h.clear();
        assert!(history.undo(&mut doc, &mut aside));
        assert_eq!(aside, before, "undo restores what was aside");
        assert!(history.redo(&mut doc, &mut aside));
        assert_eq!(aside.selection, Selection::None);
        assert!(aside.guides_h.is_empty(), "redo restores what the undo replaced");
    }

    #[test]
    fn undo_and_redo_a_pixel_edit() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        assert!(!history.can_undo());

        history.push(Snapshot::of_active_layer(&doc), Aside::default(), "paint");
        doc.active_layer_mut().raster.set(0, 0, RED);

        assert!(history.undo(&mut doc, &mut Aside::default()));
        assert_eq!(doc.composite().get(0, 0), Rgba::WHITE);
        assert!(history.can_redo());

        assert!(history.redo(&mut doc, &mut Aside::default()));
        assert_eq!(doc.composite().get(0, 0), RED);
        assert!(!history.can_redo());
    }

    #[test]
    fn undo_on_empty_history_is_a_no_op() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        assert!(!history.undo(&mut doc, &mut Aside::default()));
        assert!(!history.redo(&mut doc, &mut Aside::default()));
    }

    #[test]
    fn a_new_edit_discards_the_redo_stack() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        history.push(Snapshot::of_active_layer(&doc), Aside::default(), "a");
        doc.active_layer_mut().raster.set(0, 0, RED);
        history.undo(&mut doc, &mut Aside::default());
        history.push(Snapshot::of_active_layer(&doc), Aside::default(), "b");
        assert!(!history.can_redo());
    }

    #[test]
    fn structure_snapshots_restore_the_layer_stack() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        history.push(Snapshot::of_structure(&doc), Aside::default(), "layer");
        doc.add_layer();
        assert_eq!(doc.layers().len(), 2);
        history.undo(&mut doc, &mut Aside::default());
        assert_eq!(doc.layers().len(), 1);
        history.redo(&mut doc, &mut Aside::default());
        assert_eq!(doc.layers().len(), 2);
    }

    #[test]
    fn pixel_snapshots_follow_the_layer_when_it_moves() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        doc.add_layer(); // index 1
        history.push(Snapshot::of_active_layer(&doc), Aside::default(), "paint");
        doc.active_layer_mut().raster.set(0, 0, RED);
        doc.move_layer(1, 0).unwrap(); // the painted layer is now index 0
        history.undo(&mut doc, &mut Aside::default());
        assert_eq!(doc.layer(0).unwrap().raster.get(0, 0), Rgba::TRANSPARENT, "the painted layer was restored");
        assert_eq!(doc.layer(1).unwrap().raster.get(0, 0), Rgba::WHITE, "the background was left alone");
    }

    #[test]
    fn a_pixel_snapshot_of_a_mask_restores_the_mask_not_the_pixels() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        doc.active_layer_mut().add_mask(Raster::filled(1, 1, Rgba::WHITE));
        history.push(Snapshot::of_active_layer(&doc), Aside::default(), "paint");
        doc.active_surface_mut().set(0, 0, Rgba::BLACK);
        assert_eq!(doc.composite().get(0, 0).a, 0, "masked out");
        history.undo(&mut doc, &mut Aside::default());
        assert_eq!(doc.composite().get(0, 0), Rgba::WHITE, "the mask came back white");
        assert_eq!(doc.active_layer().raster.get(0, 0), Rgba::WHITE, "the pixels were never involved");
        history.redo(&mut doc, &mut Aside::default());
        assert_eq!(doc.composite().get(0, 0).a, 0);

        // A mask deleted after the edit: nothing to restore into, no crash.
        doc.active_layer_mut().remove_mask();
        history.undo(&mut doc, &mut Aside::default());
        assert!(doc.active_layer().mask.is_none());
    }

    #[test]
    fn a_whole_layer_snapshot_restores_everything_about_it() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        history.push(Snapshot::of_whole_layer(&doc, 0).unwrap(), Aside::default(), "flip");
        doc.active_layer_mut().raster.set(0, 0, RED);
        doc.active_layer_mut().add_mask(Raster::filled(1, 1, Rgba::BLACK));
        doc.active_layer_mut().name = "changed".to_owned();
        history.undo(&mut doc, &mut Aside::default());
        assert_eq!(doc.active_layer().raster.get(0, 0), Rgba::WHITE);
        assert!(doc.active_layer().mask.is_none());
        assert_eq!(doc.active_layer().name, "Background");
        history.redo(&mut doc, &mut Aside::default());
        assert_eq!(doc.active_layer().name, "changed");
        assert!(doc.active_layer().mask.is_some());
    }

    #[test]
    fn discard_last_forgets_a_step_without_applying_it() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        history.push(Snapshot::of_active_layer(&doc), Aside::default(), "paint");
        doc.active_layer_mut().raster.set(0, 0, RED);
        assert!(history.discard_last());
        assert_eq!(doc.composite().get(0, 0), RED, "the pixels were left alone");
        assert!(!history.can_undo());
        assert!(!history.discard_last());
    }

    #[test]
    fn coalesced_pushes_are_one_step() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        for i in 1..=3 {
            history.push_coalescing(Snapshot::of_active_layer(&doc), Aside::default(), "Opacity", "opacity");
            doc.active_layer_mut().raster.set(0, 0, Rgba::opaque(i * 50, 0, 0));
        }
        assert!(history.undo(&mut doc, &mut Aside::default()));
        assert_eq!(doc.composite().get(0, 0), Rgba::WHITE, "back to before the whole run");
        assert!(!history.can_undo());
        assert!(history.redo(&mut doc, &mut Aside::default()));
        assert_eq!(doc.composite().get(0, 0), Rgba::opaque(150, 0, 0));
    }

    #[test]
    fn a_different_key_or_a_plain_push_breaks_the_run() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        history.push_coalescing(Snapshot::of_active_layer(&doc), Aside::default(), "a", "a");
        history.push_coalescing(Snapshot::of_active_layer(&doc), Aside::default(), "b", "b");
        history.push(Snapshot::of_active_layer(&doc), Aside::default(), "c");
        history.push_coalescing(Snapshot::of_active_layer(&doc), Aside::default(), "b", "b");
        let mut steps = 0;
        while history.undo(&mut doc, &mut Aside::default()) {
            steps += 1;
        }
        assert_eq!(steps, 4);
    }

    #[test]
    fn an_undo_ends_the_run() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        history.push_coalescing(Snapshot::of_active_layer(&doc), Aside::default(), "a", "a");
        history.undo(&mut doc, &mut Aside::default());
        history.push_coalescing(Snapshot::of_active_layer(&doc), Aside::default(), "a", "a");
        assert!(history.can_undo(), "the second run starts a new step");
        assert!(!history.can_redo());
    }

    #[test]
    fn the_limit_drops_the_oldest_step() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(2);
        for _ in 0..3 {
            history.push(Snapshot::of_active_layer(&doc), Aside::default(), "paint");
        }
        assert!(history.undo(&mut doc, &mut Aside::default()));
        assert!(history.undo(&mut doc, &mut Aside::default()));
        assert!(!history.undo(&mut doc, &mut Aside::default()));

        history.set_limit(10);
        for _ in 0..5 {
            history.push(Snapshot::of_active_layer(&doc), Aside::default(), "paint");
        }
        assert_eq!(history.position(), 5);
        history.set_limit(3);
        assert_eq!(history.limit(), 3);
        assert_eq!(history.position(), 3, "trimmed at once");
        history.set_limit(0);
        assert_eq!(history.limit(), 1, "at least one step is always kept");
    }

    #[test]
    fn the_panel_sees_labels_and_can_jump_between_them() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        for (i, label) in ["one", "two", "three"].iter().enumerate() {
            history.push(Snapshot::of_active_layer(&doc), Aside::default(), *label);
            doc.active_layer_mut().raster.set(0, 0, Rgba::opaque(i as u8 + 1, 0, 0));
        }
        assert_eq!(history.labels(), vec!["one", "two", "three"]);
        assert_eq!(history.position(), 3);
        assert!(history.go_to(&mut doc, &mut Aside::default(), 1));
        assert_eq!(doc.composite().get(0, 0).r, 1, "after step one only");
        assert_eq!(history.position(), 1);
        assert_eq!(history.labels(), vec!["one", "two", "three"], "undone steps still show");
        assert!(history.go_to(&mut doc, &mut Aside::default(), 3));
        assert_eq!(doc.composite().get(0, 0).r, 3);
        assert!(!history.go_to(&mut doc, &mut Aside::default(), 3), "already there");
        assert!(history.go_to(&mut doc, &mut Aside::default(), 0));
        assert_eq!(doc.composite().get(0, 0), Rgba::WHITE);
    }

    #[test]
    fn modified_means_not_at_the_saved_state() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        assert!(!history.is_modified(), "a fresh document is clean");
        history.push(Snapshot::of_active_layer(&doc), Aside::default(), "paint");
        assert!(history.is_modified());
        history.undo(&mut doc, &mut Aside::default());
        assert!(!history.is_modified(), "undone back to the start");
        history.redo(&mut doc, &mut Aside::default());
        history.mark_saved();
        assert!(!history.is_modified());
        history.undo(&mut doc, &mut Aside::default());
        assert!(history.is_modified(), "undone past the save");
        history.redo(&mut doc, &mut Aside::default());
        assert!(!history.is_modified(), "and redone back to it");
        history.undo(&mut doc, &mut Aside::default());
        history.push(Snapshot::of_active_layer(&doc), Aside::default(), "other");
        assert!(history.is_modified(), "a different branch at the same depth is not the saved state");
        history.clear();
        assert!(!history.is_modified(), "a new or opened document starts clean");

        // Dropping old steps past the limit does not lose track of it.
        let mut history = History::new(2);
        history.push(Snapshot::of_active_layer(&doc), Aside::default(), "a");
        history.mark_saved();
        history.push(Snapshot::of_active_layer(&doc), Aside::default(), "b");
        history.push(Snapshot::of_active_layer(&doc), Aside::default(), "c");
        assert!(history.is_modified());
        history.undo(&mut doc, &mut Aside::default());
        history.undo(&mut doc, &mut Aside::default());
        assert!(!history.is_modified(), "back at the saved state, which is now the oldest kept");
    }
}
