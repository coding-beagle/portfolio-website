//! Undo and redo.
//!
//! Every undoable edit is recorded as a [`Snapshot`] of the state it is about
//! to change, taken *before* the change. Pixel edits snapshot only the layer
//! they touch; anything that changes the shape of the stack snapshots the
//! whole document. Undoing a snapshot captures the matching "after" state on
//! the redo stack, so the two stacks are symmetric and a redo is an undo of
//! an undo.

use crate::document::Document;
use crate::layer::{Layer, LayerId, Target};
use crate::raster::Raster;

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
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct History {
    undo: Vec<Snapshot>,
    redo: Vec<Snapshot>,
    limit: usize,
    /// The coalescing key of the most recent push, if it had one.
    last_key: Option<String>,
}

impl History {
    /// `limit` is the number of steps kept; the oldest is dropped past it.
    pub fn new(limit: usize) -> History {
        History { undo: Vec::new(), redo: Vec::new(), limit: limit.max(1), last_key: None }
    }

    /// Records the state *before* an edit. Any redo history is discarded, as
    /// it no longer leads anywhere reachable.
    pub fn push(&mut self, snapshot: Snapshot) {
        self.push_keyed(snapshot, None);
    }

    /// Like [`History::push`], but a run of consecutive pushes with the same
    /// `key` is one undo step: the first snapshot is kept and the rest are
    /// dropped. This is what makes dragging an opacity slider a single undo
    /// rather than one per pixel of travel. Any other push breaks the run.
    pub fn push_coalescing(&mut self, snapshot: Snapshot, key: impl Into<String>) {
        self.push_keyed(snapshot, Some(key.into()));
    }

    fn push_keyed(&mut self, snapshot: Snapshot, key: Option<String>) {
        let continues_run = key.is_some() && key == self.last_key && self.redo.is_empty();
        self.last_key = key;
        if continues_run {
            return;
        }
        self.redo.clear();
        self.undo.push(snapshot);
        if self.undo.len() > self.limit {
            self.undo.remove(0);
        }
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    pub fn undo(&mut self, doc: &mut Document) -> bool {
        self.last_key = None;
        match self.undo.pop() {
            Some(snapshot) => {
                self.redo.push(snapshot.restore(doc));
                true
            }
            None => false,
        }
    }

    pub fn redo(&mut self, doc: &mut Document) -> bool {
        self.last_key = None;
        match self.redo.pop() {
            Some(snapshot) => {
                self.undo.push(snapshot.restore(doc));
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
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::Rgba;

    const RED: Rgba = Rgba::opaque(255, 0, 0);

    #[test]
    fn undo_and_redo_a_pixel_edit() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        assert!(!history.can_undo());

        history.push(Snapshot::of_active_layer(&doc));
        doc.active_layer_mut().raster.set(0, 0, RED);

        assert!(history.undo(&mut doc));
        assert_eq!(doc.composite().get(0, 0), Rgba::WHITE);
        assert!(history.can_redo());

        assert!(history.redo(&mut doc));
        assert_eq!(doc.composite().get(0, 0), RED);
        assert!(!history.can_redo());
    }

    #[test]
    fn undo_on_empty_history_is_a_no_op() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        assert!(!history.undo(&mut doc));
        assert!(!history.redo(&mut doc));
    }

    #[test]
    fn a_new_edit_discards_the_redo_stack() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        history.push(Snapshot::of_active_layer(&doc));
        doc.active_layer_mut().raster.set(0, 0, RED);
        history.undo(&mut doc);
        history.push(Snapshot::of_active_layer(&doc));
        assert!(!history.can_redo());
    }

    #[test]
    fn structure_snapshots_restore_the_layer_stack() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        history.push(Snapshot::of_structure(&doc));
        doc.add_layer();
        assert_eq!(doc.layers().len(), 2);
        history.undo(&mut doc);
        assert_eq!(doc.layers().len(), 1);
        history.redo(&mut doc);
        assert_eq!(doc.layers().len(), 2);
    }

    #[test]
    fn pixel_snapshots_follow_the_layer_when_it_moves() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        doc.add_layer(); // index 1
        history.push(Snapshot::of_active_layer(&doc));
        doc.active_layer_mut().raster.set(0, 0, RED);
        doc.move_layer(1, 0).unwrap(); // the painted layer is now index 0
        history.undo(&mut doc);
        assert_eq!(doc.layer(0).unwrap().raster.get(0, 0), Rgba::TRANSPARENT, "the painted layer was restored");
        assert_eq!(doc.layer(1).unwrap().raster.get(0, 0), Rgba::WHITE, "the background was left alone");
    }

    #[test]
    fn a_pixel_snapshot_of_a_mask_restores_the_mask_not_the_pixels() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        doc.active_layer_mut().add_mask(Raster::filled(1, 1, Rgba::WHITE));
        history.push(Snapshot::of_active_layer(&doc));
        doc.active_surface_mut().set(0, 0, Rgba::BLACK);
        assert_eq!(doc.composite().get(0, 0).a, 0, "masked out");
        history.undo(&mut doc);
        assert_eq!(doc.composite().get(0, 0), Rgba::WHITE, "the mask came back white");
        assert_eq!(doc.active_layer().raster.get(0, 0), Rgba::WHITE, "the pixels were never involved");
        history.redo(&mut doc);
        assert_eq!(doc.composite().get(0, 0).a, 0);

        // A mask deleted after the edit: nothing to restore into, no crash.
        doc.active_layer_mut().remove_mask();
        history.undo(&mut doc);
        assert!(doc.active_layer().mask.is_none());
    }

    #[test]
    fn a_whole_layer_snapshot_restores_everything_about_it() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        history.push(Snapshot::of_whole_layer(&doc, 0).unwrap());
        doc.active_layer_mut().raster.set(0, 0, RED);
        doc.active_layer_mut().add_mask(Raster::filled(1, 1, Rgba::BLACK));
        doc.active_layer_mut().name = "changed".to_owned();
        history.undo(&mut doc);
        assert_eq!(doc.active_layer().raster.get(0, 0), Rgba::WHITE);
        assert!(doc.active_layer().mask.is_none());
        assert_eq!(doc.active_layer().name, "Background");
        history.redo(&mut doc);
        assert_eq!(doc.active_layer().name, "changed");
        assert!(doc.active_layer().mask.is_some());
    }

    #[test]
    fn discard_last_forgets_a_step_without_applying_it() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        history.push(Snapshot::of_active_layer(&doc));
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
            history.push_coalescing(Snapshot::of_active_layer(&doc), "opacity");
            doc.active_layer_mut().raster.set(0, 0, Rgba::opaque(i * 50, 0, 0));
        }
        assert!(history.undo(&mut doc));
        assert_eq!(doc.composite().get(0, 0), Rgba::WHITE, "back to before the whole run");
        assert!(!history.can_undo());
        assert!(history.redo(&mut doc));
        assert_eq!(doc.composite().get(0, 0), Rgba::opaque(150, 0, 0));
    }

    #[test]
    fn a_different_key_or_a_plain_push_breaks_the_run() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        history.push_coalescing(Snapshot::of_active_layer(&doc), "a");
        history.push_coalescing(Snapshot::of_active_layer(&doc), "b");
        history.push(Snapshot::of_active_layer(&doc));
        history.push_coalescing(Snapshot::of_active_layer(&doc), "b");
        let mut steps = 0;
        while history.undo(&mut doc) {
            steps += 1;
        }
        assert_eq!(steps, 4);
    }

    #[test]
    fn an_undo_ends_the_run() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(10);
        history.push_coalescing(Snapshot::of_active_layer(&doc), "a");
        history.undo(&mut doc);
        history.push_coalescing(Snapshot::of_active_layer(&doc), "a");
        assert!(history.can_undo(), "the second run starts a new step");
        assert!(!history.can_redo());
    }

    #[test]
    fn the_limit_drops_the_oldest_step() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let mut history = History::new(2);
        for _ in 0..3 {
            history.push(Snapshot::of_active_layer(&doc));
        }
        assert!(history.undo(&mut doc));
        assert!(history.undo(&mut doc));
        assert!(!history.undo(&mut doc));
    }
}
