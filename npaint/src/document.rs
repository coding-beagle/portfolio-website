//! The layer stack.
//!
//! Layers are stored bottom-first, the way they are composited: index 0 is the
//! bottom of the stack. The page reverses the order for display so the top
//! layer is at the top of the panel, as in every layer-based editor.
//!
//! # Groups
//!
//! The stack stays **one flat list** even with groups in it. A group is a
//! layer like any other ([`LayerKind::Group`]); its children are the
//! contiguous run of layers *below* it whose [`Layer::parent`] is the
//! group's id, and the group's own row sits at the top of that run:
//!
//! ```text
//!   index 4   Sky            parent None
//!   index 3   Group "Tree"   parent None      <- the group's own row
//!   index 2     Leaves       parent Tree
//!   index 1     Trunk        parent Tree
//!   index 0   Background     parent None
//! ```
//!
//! This is exactly how a `.psd` stores groups, which is why one imports
//! without rearranging anything, and it means every index-based operation
//! in the engine keeps working: an index still names one layer, and the
//! order of the list is still the order things composite in. What changes
//! is that an operation on a group means the whole *subtree*
//! ([`Document::subtree`]) — deleting, duplicating or dragging a group
//! takes its contents with it.
//!
//! A group composites its children into a buffer of their own and then
//! blends that in, through the group's opacity, blend mode and mask.
//! [`BlendMode::PassThrough`], which is what a new group and an imported
//! one are, skips the buffer: the children draw straight onto what is
//! below the group, so an adjustment layer inside a group reaches the rest
//! of the picture exactly as it would outside one.
//!
//! # Clipping masks
//!
//! A layer with [`Layer::clipped`] set draws only where the layer under it
//! already has something. The run of clipped layers above a sibling and
//! that sibling — the **base** — make one clipping group: the clipped
//! layers are composited onto the base's own picture, the result is held to
//! the base's alpha, and the base's opacity and blend mode then carry the
//! whole thing onto the backdrop. That last part is why it is the base's
//! row that the panel shows the opacity of a clipped layer next to: a
//! clipped layer cannot reach the backdrop on its own terms at all.
//!
//! An adjustment layer has no alpha of its own, so nothing clips to one,
//! and the bottom sibling in a stack has nothing below it to clip to; in
//! both cases the flag simply does nothing. [`Document::clip_base`] is the
//! same question for the page, which greys the command out rather than
//! offering a flag that would not show.

use crate::adjust::Adjustment;
use crate::color::Rgba;
use crate::geometry::{Point, Rect};
use crate::layer::{mask_cover, mask_raster, BlendMode, Layer, LayerId, LayerKind, SmartObject, Target};
use std::ops::Range;
use crate::mask::Mask;
use crate::raster::Raster;
use crate::text::TextObject;
use crate::transform::{Affine, Projective};

#[derive(Clone, Debug, PartialEq)]
pub struct Document {
    width: u32,
    height: u32,
    layers: Vec<Layer>,
    active: usize,
    next_id: u32,
}

/// Why a layer operation was refused. Every variant is a caller error the page
/// can surface, never a corrupted document.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocumentError {
    NoSuchLayer,
    /// A document keeps at least one layer; delete is refused on the last.
    LastLayer,
    /// The raster handed in is not the document's size.
    SizeMismatch,
    NothingBelow,
    /// The layer below is an adjustment layer or a smart object, which
    /// pixels cannot be merged into.
    CannotMergeInto,
    /// The layer has no mask to work on.
    NoMask,
    /// The operation wants a pixel layer (converting to a smart object) or a
    /// smart object (replacing its contents), and this is not one.
    WrongKind,
    /// A group cannot be dropped inside itself or inside one of its own
    /// children.
    CannotNest,
    /// There is nothing under the layer for it to be clipped to.
    CannotClip,
}

impl std::fmt::Display for DocumentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            DocumentError::NoSuchLayer => "no such layer",
            DocumentError::LastLayer => "a document needs at least one layer",
            DocumentError::SizeMismatch => "the image is not the document's size",
            DocumentError::NothingBelow => "there is no layer below to merge into",
            DocumentError::CannotMergeInto => "rasterize the layer below first: pixels cannot be merged into it",
            DocumentError::NoMask => "this layer has no mask",
            DocumentError::WrongKind => "this kind of layer cannot do that",
            DocumentError::CannotNest => "a group cannot go inside itself",
            DocumentError::CannotClip => "there is nothing below this layer to clip it to",
        })
    }
}

impl std::error::Error for DocumentError {}

/// Where a point of a `width` x `height` canvas lands when the canvas is
/// turned `turns` quarter turns clockwise — what anything placed on the
/// canvas rather than painted into it follows: a smart object's placement,
/// the symmetry axes.
pub fn canvas_turn(width: u32, height: u32, turns: i32) -> Affine {
    let (w, h) = (f64::from(width), f64::from(height));
    match turns.rem_euclid(4) {
        0 => Affine::IDENTITY,
        1 => Affine { a: 0.0, b: 1.0, c: -1.0, d: 0.0, e: h, f: 0.0 },
        2 => Affine { a: -1.0, b: 0.0, c: 0.0, d: -1.0, e: w, f: h },
        _ => Affine { a: 0.0, b: -1.0, c: 1.0, d: 0.0, e: 0.0, f: w },
    }
}

impl Document {
    /// A document with one layer, `Background`, filled with `background`.
    /// Pass [`Rgba::TRANSPARENT`] for an empty canvas.
    pub fn new(width: u32, height: u32, background: Rgba) -> Document {
        let mut doc = Document {
            width,
            height,
            layers: Vec::new(),
            active: 0,
            next_id: 1,
        };
        let id = doc.take_id();
        doc.layers.push(Layer::new(
            id,
            "Background",
            Raster::filled(width, height, background),
        ));
        doc
    }

    /// A document the size of `raster`, whose only layer is that image — an
    /// opened file.
    pub fn from_raster(name: &str, raster: Raster) -> Document {
        let mut doc = Document {
            width: raster.width(),
            height: raster.height(),
            layers: Vec::new(),
            active: 0,
            next_id: 1,
        };
        let id = doc.take_id();
        doc.layers.push(Layer::new(id, name, raster));
        doc
    }

    /// A document the size of `raster`, whose only layer is that image kept
    /// as a smart object — what Open does, so the picture's own pixels
    /// survive every transform it is put through.
    pub fn from_smart_object(name: &str, raster: Raster) -> Document {
        let mut doc = Document {
            width: raster.width(),
            height: raster.height(),
            layers: Vec::new(),
            active: 0,
            next_id: 1,
        };
        let id = doc.take_id();
        let object = SmartObject::new(raster, Projective::IDENTITY);
        let (w, h) = (doc.width, doc.height);
        doc.layers.push(Layer::new_smart(id, name, object, w, h));
        doc
    }

    /// A document assembled from saved parts. `None` if the layers' ids
    /// collide or the active index is out of range — a damaged file.
    pub fn from_parts(width: u32, height: u32, layers: Vec<Layer>, active: usize) -> Option<Document> {
        if layers.is_empty() || active >= layers.len() {
            return None;
        }
        let mut ids: Vec<u32> = layers.iter().map(|l| l.id().0).collect();
        ids.sort_unstable();
        if ids.windows(2).any(|w| w[0] == w[1]) {
            return None;
        }
        if !nesting_is_sound(&layers) {
            return None;
        }
        let next_id = ids.last().map_or(1, |id| id + 1);
        Some(Document { width, height, layers, active, next_id })
    }

    fn take_id(&mut self) -> LayerId {
        let id = LayerId(self.next_id);
        self.next_id += 1;
        id
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn bounds(&self) -> Rect {
        Rect::new(0, 0, self.width as i32, self.height as i32)
    }

    /// Everything the layers reach, the canvas included: what Reveal All
    /// grows to. Only two things can answer anything but the canvas — a
    /// smart object placed past the edge, and the pixels a move pushed off
    /// it — and both say where they are without looking at a pixel, which
    /// is what keeps this cheap enough to ask often.
    pub fn content_bounds(&self) -> Rect {
        self.layers
            .iter()
            .flat_map(|l| [l.smart_object().map(SmartObject::extent), l.offscreen.as_ref().map(|o| o.rect)])
            .flatten()
            .fold(self.bounds(), |all, r| all.union(&r))
    }

    pub fn layers(&self) -> &[Layer] {
        &self.layers
    }

    pub fn layer(&self, index: usize) -> Option<&Layer> {
        self.layers.get(index)
    }

    pub fn layer_mut(&mut self, index: usize) -> Option<&mut Layer> {
        self.layers.get_mut(index)
    }

    // ---- The tree ------------------------------------------------------------
    //
    // A group's children are the contiguous run of layers immediately below
    // it that point at it; see the module docs. Everything here derives the
    // nesting from that arrangement rather than keeping a second copy of it.

    /// The group a layer is in, as an index, or `None` at the top level.
    pub fn parent_index(&self, index: usize) -> Option<usize> {
        self.layers.get(index)?.parent.and_then(|id| self.index_of(id))
    }

    /// How deep in the groups a layer sits: 0 at the top level.
    pub fn depth(&self, index: usize) -> usize {
        let mut depth = 0;
        let mut at = index;
        while let Some(parent) = self.parent_index(at) {
            depth += 1;
            at = parent;
            // A sound document cannot loop, but a depth cap keeps a damaged
            // one from hanging the tab rather than merely looking wrong.
            if depth > self.layers.len() {
                break;
            }
        }
        depth
    }

    /// Everything a layer takes with it: its own row and, for a group, the
    /// run of descendants below it. `start..=index`, as a half-open range
    /// ending one past the layer itself.
    pub fn subtree(&self, index: usize) -> Range<usize> {
        let Some(layer) = self.layers.get(index) else { return index..index };
        let mut start = index;
        if layer.is_group() {
            // Walk down while the layers still belong to this group or to
            // a group nested inside it.
            let mut open = vec![layer.id()];
            while start > 0 {
                let below = &self.layers[start - 1];
                match below.parent {
                    Some(p) if open.contains(&p) => {}
                    _ => break,
                }
                start -= 1;
                if below.is_group() {
                    open.push(below.id());
                }
            }
        }
        start..index + 1
    }

    /// A group's children, outermost run included — empty for anything else.
    pub fn children_of(&self, index: usize) -> Range<usize> {
        let span = self.subtree(index);
        span.start..index
    }

    /// Whether `index` is inside the group at `group` (at any depth).
    pub fn is_inside(&self, index: usize, group: usize) -> bool {
        self.layers.get(group).is_some_and(Layer::is_group) && self.subtree(group).contains(&index)
    }

    /// Where the top-level item containing `index` begins. The composite can
    /// only be split at one of these: everything below is a whole number of
    /// top-level subtrees, which is what [`Document::composite_below`] needs.
    ///
    /// A clipping group is indivisible too — the clipped layers are drawn
    /// with their base, so a cut between them would leave neither side a
    /// picture — and the point walks down past the base to keep it whole.
    pub fn split_point(&self, index: usize) -> usize {
        let mut at = index;
        while let Some(parent) = self.parent_index(at) {
            at = parent;
            if at >= self.layers.len() {
                break;
            }
        }
        let mut start = self.subtree(at).start;
        // One past the top of the stack is a cut like any other — there is
        // simply no layer above it to keep whole.
        while start > 0 && self.layers.get(at).is_some_and(Layer::clips_below) {
            at = start - 1;
            start = self.subtree(at).start;
        }
        start
    }

    /// The layer `index` would clip to: the first sibling below it that is
    /// not itself clipped, and that has pixels to be clipped to. `None`
    /// when the layer is the bottom of its group or sits over an adjustment
    /// layer, which has no alpha of its own. Says nothing about whether
    /// `index` is clipped — see [`Document::clip_base`].
    fn base_below(&self, index: usize) -> Option<usize> {
        let parent = self.layers.get(index)?.parent;
        let mut start = self.subtree(index).start;
        // An adjustment layer ends the run without being a base itself, and
        // then the lowest clipped layer above it is what the rest clip to —
        // which is what the compositor makes of the same stack.
        let mut lowest_clipped = None;
        while start > 0 {
            // The row just under the item, which for a group is the group's
            // own row rather than its bottom child.
            let item = start - 1;
            let below = &self.layers[item];
            if below.parent != parent || below.is_adjustment() {
                break;
            }
            if !below.clipped {
                return Some(item);
            }
            lowest_clipped = Some(item);
            start = self.subtree(item).start;
        }
        lowest_clipped
    }

    /// The layer `index` is clipped to, or `None` if it is not clipped or
    /// the flag has nothing to act on.
    pub fn clip_base(&self, index: usize) -> Option<usize> {
        self.layers.get(index)?.clips_below().then(|| self.base_below(index)).flatten()
    }

    /// Whether clipping `index` to what is below it would do anything —
    /// what the page greys the command out on.
    pub fn can_clip(&self, index: usize) -> bool {
        self.layers.get(index).is_some_and(|l| !l.is_adjustment()) && self.base_below(index).is_some()
    }

    /// The indices of the layers directly inside `parent`, bottom-first.
    /// `None` gives the top level.
    pub fn roots(&self, parent: Option<LayerId>) -> Vec<usize> {
        let range = match parent.and_then(|id| self.index_of(id)) {
            Some(index) => self.children_of(index),
            None => 0..self.layers.len(),
        };
        range.filter(|&i| self.layers[i].parent == parent).collect()
    }

    /// Whether a layer is hidden by a group above it being switched off —
    /// which is why it is not on screen even though its own eye is open.
    pub fn hidden_by_group(&self, index: usize) -> bool {
        let mut at = index;
        while let Some(parent) = self.parent_index(at) {
            if !self.layers[parent].visible {
                return true;
            }
            at = parent;
        }
        false
    }

    pub fn index_of(&self, id: LayerId) -> Option<usize> {
        self.layers.iter().position(|l| l.id() == id)
    }

    pub fn active_index(&self) -> usize {
        self.active
    }

    pub fn active_layer(&self) -> &Layer {
        &self.layers[self.active]
    }

    pub fn active_layer_mut(&mut self) -> &mut Layer {
        &mut self.layers[self.active]
    }

    /// The raster the tools are editing on the active layer: its mask while
    /// that is the target, otherwise its pixels.
    pub fn active_surface(&self) -> &Raster {
        self.active_layer().surface()
    }

    pub fn active_surface_mut(&mut self) -> &mut Raster {
        self.active_layer_mut().surface_mut()
    }

    pub fn set_active(&mut self, index: usize) -> Result<(), DocumentError> {
        if index < self.layers.len() {
            self.active = index;
            Ok(())
        } else {
            Err(DocumentError::NoSuchLayer)
        }
    }

    /// Adds a transparent layer above the active one and makes it active.
    /// Returns its index.
    pub fn add_layer(&mut self) -> usize {
        let raster = Raster::new(self.width, self.height);
        self.insert_layer_above_active(raster, None)
    }

    /// Adds a layer holding a picture of any size, at its own resolution,
    /// with its top-left corner at `(x, y)` — what a paste or an image
    /// opened as a layer does. What falls outside the canvas is lost.
    pub fn add_layer_placed(&mut self, name: &str, raster: &Raster, x: i32, y: i32) -> usize {
        let placed = raster.resized(self.width, self.height, x, y);
        self.insert_layer_above_active(placed, Some(name))
    }

    /// Adds a copy of `layer`, under a new id, above the active one — how a
    /// layer that was copied whole is pasted back. A smart object re-renders
    /// at this document's size rather than carrying its old rendering, so it
    /// survives a paste into a document of another size; a mask, which is
    /// document-sized, is fitted from its top-left corner.
    pub fn add_layer_copy(&mut self, layer: &Layer) -> usize {
        let id = self.take_id();
        let mut copy = layer.with_id(id);
        let (w, h) = (self.width, self.height);
        if let Some(mask) = &copy.mask {
            if (mask.width(), mask.height()) != (w, h) {
                copy.mask = Some(mask.resized(w, h, 0, 0));
            }
        }
        copy.raster = match &copy.kind {
            LayerKind::Smart(object) => object.render(w, h),
            // An adjustment layer and a group have no pixels of their own
            // and keep their empty raster.
            LayerKind::Adjustment(_) | LayerKind::Group => copy.raster,
            LayerKind::Pixels => copy.raster.resized(w, h, 0, 0),
        };
        self.insert_above_active(copy)
    }

    /// Scales the whole document, every layer, to a new size — Image Size.
    /// A smart object's placement is scaled rather than its rendering, so
    /// it keeps re-rendering from its source.
    pub fn resample(&mut self, width: u32, height: u32) {
        let (width, height) = (width.max(1), height.max(1));
        let sx = f64::from(width) / f64::from(self.width.max(1));
        let sy = f64::from(height) / f64::from(self.height.max(1));
        let scale = Projective::from(Affine::scaling(sx, sy));
        for layer in &mut self.layers {
            layer.map_rasters(|r| r.resampled(width, height), |m| scale.then(m), width, height);
        }
        self.width = width;
        self.height = height;
    }

    /// Adds a layer holding `raster` above the active one and makes it
    /// active. This is how an opened image lands in the document.
    pub fn add_layer_from(&mut self, name: &str, raster: Raster) -> Result<usize, DocumentError> {
        if (raster.width(), raster.height()) != (self.width, self.height) {
            return Err(DocumentError::SizeMismatch);
        }
        Ok(self.insert_layer_above_active(raster, Some(name)))
    }

    fn insert_layer_above_active(&mut self, raster: Raster, name: Option<&str>) -> usize {
        let id = self.take_id();
        let name = name.map_or_else(|| format!("Layer {}", id.0), str::to_owned);
        self.insert_above_active(Layer::new(id, name, raster))
    }

    /// Puts a layer built elsewhere — by [`crate::psd`], reading someone
    /// else's file — above the active one, under an id of this document's.
    /// The layer is expected to be document-sized already; anything else is
    /// fitted from its top-left corner, as a pasted layer is.
    pub fn push_imported(&mut self, layer: Layer) -> usize {
        let id = self.take_id();
        let mut layer = layer.with_id(id);
        let (w, h) = (self.width, self.height);
        if (layer.raster.width(), layer.raster.height()) != (w, h) {
            layer.raster = layer.raster.resized(w, h, 0, 0);
        }
        if let Some(mask) = &layer.mask {
            if (mask.width(), mask.height()) != (w, h) {
                layer.mask = Some(mask.resized(w, h, 0, 0));
            }
        }
        self.insert_above_active(layer)
    }

    /// Where a new layer goes: *inside* the active layer when that is a
    /// group, at the top of its contents — which is what every editor does
    /// with a group selected — and otherwise just above the active layer,
    /// among its siblings and so inside whatever group it is in.
    fn insertion_point(&self) -> (usize, Option<LayerId>) {
        let active = &self.layers[self.active];
        if active.is_group() {
            (self.active, Some(active.id()))
        } else {
            (self.active + 1, active.parent)
        }
    }

    fn insert_above_active(&mut self, mut layer: Layer) -> usize {
        let (index, parent) = self.insertion_point();
        layer.parent = parent;
        self.layers.insert(index, layer);
        self.active = index;
        index
    }

    /// Adds an adjustment layer above the active one. Its mask is `mask`
    /// (from the selection, say) or all white — everything below shows
    /// through it adjusted.
    pub fn add_adjustment_layer(&mut self, adjustment: Adjustment, mask: Option<Mask>) -> usize {
        let id = self.take_id();
        let name = format!("{} {}", adjustment.label(), id.0);
        let mask = match mask {
            Some(m) => mask_raster(&m),
            None => Raster::filled(self.width, self.height, Rgba::WHITE),
        };
        self.insert_above_active(Layer::new_adjustment(id, name, adjustment, mask))
    }

    /// Places a picture as a smart object above the active layer, fitted
    /// to the document and centred.
    pub fn place_smart_object(&mut self, name: &str, source: Raster) -> usize {
        let id = self.take_id();
        let object = SmartObject::placed(source, self.width, self.height);
        self.insert_above_active(Layer::new_smart(id, name, object, self.width, self.height))
    }

    /// Turns a pixel layer into a smart object whose source is what it has
    /// painted on it, cropped to that. Nothing changes on screen; from now
    /// on it transforms without loss.
    pub fn convert_to_smart_object(&mut self, index: usize) -> Result<(), DocumentError> {
        let layer = self.layers.get_mut(index).ok_or(DocumentError::NoSuchLayer)?;
        match layer.kind {
            LayerKind::Smart(_) => return Ok(()),
            LayerKind::Adjustment(_) | LayerKind::Group => return Err(DocumentError::WrongKind),
            LayerKind::Pixels => {}
        }
        let bounds = layer.raster.content_bounds().unwrap_or(Rect::new(0, 0, 1, 1));
        let source = layer.raster.resized(bounds.w as u32, bounds.h as u32, -bounds.x, -bounds.y);
        let transform = Affine::translation(f64::from(bounds.x), f64::from(bounds.y));
        layer.kind = LayerKind::Smart(SmartObject::new(source, transform.into()));
        Ok(())
    }

    /// A new text layer above the active one, holding `text` as the page
    /// has drawn it (`source`), placed so that the block's top-left corner —
    /// [`TextObject::origin`] in the source — lands on `at`. Returns its
    /// index.
    pub fn add_text_layer(&mut self, text: TextObject, source: Raster, at: Point) -> usize {
        let id = self.take_id();
        let name = text.layer_name();
        let transform = Affine::translation(at.x - text.origin.x, at.y - text.origin.y);
        let mut object = SmartObject::new(source, transform.into());
        object.text = Some(text);
        self.insert_above_active(Layer::new_smart(id, name, object, self.width, self.height))
    }

    /// Sets a text layer's text again — see [`Layer::set_text`].
    pub fn set_text(&mut self, index: usize, text: TextObject, source: Raster) -> Result<(), DocumentError> {
        let (width, height) = (self.width, self.height);
        let layer = self.layers.get_mut(index).ok_or(DocumentError::NoSuchLayer)?;
        if !layer.is_text() {
            return Err(DocumentError::WrongKind);
        }
        layer.set_text(text, source, width, height);
        Ok(())
    }

    /// The topmost visible text layer whose box holds the document point
    /// `at` — what a click with the text tool edits, if anything. The box
    /// rather than the glyphs, so a click between two letters counts.
    pub fn text_layer_at(&self, at: Point) -> Option<usize> {
        let (x, y) = (at.x.floor() as i32, at.y.floor() as i32);
        self.layers
            .iter()
            .enumerate()
            .rev()
            .filter(|(_, l)| l.visible && l.is_text())
            .find(|(_, l)| l.smart_object().is_some_and(|o| o.extent().contains(x, y)))
            .map(|(i, _)| i)
    }

    /// Makes a smart object ordinary pixels again: what it renders to now.
    pub fn rasterize_layer(&mut self, index: usize) -> Result<(), DocumentError> {
        let layer = self.layers.get_mut(index).ok_or(DocumentError::NoSuchLayer)?;
        if !layer.is_smart() {
            return Err(DocumentError::WrongKind);
        }
        layer.rasterize();
        Ok(())
    }

    /// Swaps a smart object's picture for another, keeping the box it
    /// occupies: the new source is scaled to fill the old one's footprint.
    /// A text layer stops being one: the picture is no longer its text.
    pub fn replace_smart_contents(&mut self, index: usize, source: Raster) -> Result<(), DocumentError> {
        let (width, height) = (self.width, self.height);
        let layer = self.layers.get_mut(index).ok_or(DocumentError::NoSuchLayer)?;
        let LayerKind::Smart(object) = &mut layer.kind else {
            return Err(DocumentError::WrongKind);
        };
        let sx = f64::from(object.source.width().max(1)) / f64::from(source.width().max(1));
        let sy = f64::from(object.source.height().max(1)) / f64::from(source.height().max(1));
        object.transform = object.transform.then(&Affine::scaling(sx, sy).into());
        object.source = source;
        object.text = None;
        layer.raster = object.render(width, height);
        Ok(())
    }

    /// Moves a smart object and re-renders it. Not an error on other kinds;
    /// it simply does nothing.
    pub fn set_smart_transform(&mut self, index: usize, transform: Projective) -> Result<(), DocumentError> {
        let (width, height) = (self.width, self.height);
        let layer = self.layers.get_mut(index).ok_or(DocumentError::NoSuchLayer)?;
        layer.set_smart_transform(transform, width, height);
        Ok(())
    }

    /// Replaces an adjustment layer's adjustment.
    pub fn set_adjustment(&mut self, index: usize, adjustment: Adjustment) -> Result<(), DocumentError> {
        let layer = self.layers.get_mut(index).ok_or(DocumentError::NoSuchLayer)?;
        match &mut layer.kind {
            LayerKind::Adjustment(a) => {
                *a = adjustment;
                Ok(())
            }
            _ => Err(DocumentError::WrongKind),
        }
    }

    // ---- Masks -----------------------------------------------------------------

    /// Gives a layer a mask: white where `shape` covers (or everywhere
    /// without one), inverted when `hide` is set. Replaces any mask it had.
    pub fn add_mask(&mut self, index: usize, shape: Option<Mask>, hide: bool) -> Result<(), DocumentError> {
        let layer = self.layers.get_mut(index).ok_or(DocumentError::NoSuchLayer)?;
        let mut mask = shape.unwrap_or_else(|| Mask::filled(self.width, self.height));
        if hide {
            mask.invert();
        }
        layer.add_mask(mask_raster(&mask));
        Ok(())
    }

    pub fn remove_mask(&mut self, index: usize) -> Result<(), DocumentError> {
        let layer = self.layers.get_mut(index).ok_or(DocumentError::NoSuchLayer)?;
        layer.remove_mask().map(|_| ()).ok_or(DocumentError::NoMask)
    }

    /// Bakes the mask into the layer's alpha and removes it.
    pub fn apply_mask(&mut self, index: usize) -> Result<(), DocumentError> {
        let layer = self.layers.get_mut(index).ok_or(DocumentError::NoSuchLayer)?;
        if layer.mask.is_none() {
            return Err(DocumentError::NoMask);
        }
        if layer.is_adjustment() {
            return Err(DocumentError::WrongKind);
        }
        layer.apply_mask();
        Ok(())
    }

    pub fn set_mask_enabled(&mut self, index: usize, enabled: bool) -> Result<(), DocumentError> {
        let layer = self.layers.get_mut(index).ok_or(DocumentError::NoSuchLayer)?;
        if layer.mask.is_none() {
            return Err(DocumentError::NoMask);
        }
        layer.mask_enabled = enabled;
        Ok(())
    }

    pub fn set_target(&mut self, index: usize, target: Target) -> Result<(), DocumentError> {
        let layer = self.layers.get_mut(index).ok_or(DocumentError::NoSuchLayer)?;
        if target == Target::Mask && layer.mask.is_none() {
            return Err(DocumentError::NoMask);
        }
        layer.set_target(target);
        Ok(())
    }

    /// Copies a layer, placing the copy directly above it and making it active.
    /// Duplicates a layer just above itself. A group is duplicated whole,
    /// contents and all, under fresh ids throughout.
    pub fn duplicate_layer(&mut self, index: usize) -> Result<usize, DocumentError> {
        if index >= self.layers.len() {
            return Err(DocumentError::NoSuchLayer);
        }
        let span = self.subtree(index);
        // Fresh ids for everything copied, and the parent links rewritten
        // to point at the copies rather than at the originals.
        let mut remap: Vec<(LayerId, LayerId)> = Vec::with_capacity(span.len());
        let mut copies: Vec<Layer> = Vec::with_capacity(span.len());
        for i in span.clone() {
            let id = self.take_id();
            remap.push((self.layers[i].id(), id));
            copies.push(self.layers[i].with_id(id));
        }
        for copy in &mut copies {
            if let Some(parent) = copy.parent {
                if let Some((_, to)) = remap.iter().find(|(from, _)| *from == parent) {
                    copy.parent = Some(*to);
                }
            }
        }
        let root = copies.len() - 1;
        copies[root].name = format!("{} copy", copies[root].name);
        copies[root].parent = self.layers[index].parent;
        let at = span.end;
        self.layers.splice(at..at, copies);
        self.active = at + root;
        Ok(self.active)
    }

    /// Deletes a layer, and a group's contents along with it. Refused when
    /// it would empty the document.
    pub fn remove_layer(&mut self, index: usize) -> Result<(), DocumentError> {
        if index >= self.layers.len() {
            return Err(DocumentError::NoSuchLayer);
        }
        let span = self.subtree(index);
        if span.len() == self.layers.len() {
            return Err(DocumentError::LastLayer);
        }
        self.layers.drain(span.clone());
        // Keep the active layer where it was, or the layer that has slid into
        // the slot if the active one went.
        if self.active >= span.end {
            self.active -= span.len();
        } else if self.active >= span.start {
            self.active = span.start.min(self.layers.len() - 1);
        }
        Ok(())
    }

    /// Where a drop on `to` puts what is being dropped: the slot in the
    /// stack, and the group it lands in.
    fn drop_slot(&self, to: usize, drop: Drop) -> Result<(usize, Option<LayerId>), DocumentError> {
        let target = self.layers.get(to).ok_or(DocumentError::NoSuchLayer)?;
        Ok(match drop {
            Drop::Inside => {
                if !target.is_group() {
                    return Err(DocumentError::WrongKind);
                }
                // The top of that group's contents, which is the row just
                // under its own.
                (to, Some(target.id()))
            }
            // Above `to` means above its whole subtree, which for anything
            // but a group is the layer itself.
            Drop::Above => (to + 1, target.parent),
            Drop::Below => (self.subtree(to).start, target.parent),
        })
    }

    /// Whether a drop would actually move anything. Dropping a layer just
    /// above the one already under it, or just below the one already over
    /// it, puts it back where it was — and that is not an edit, so it
    /// should leave no undo step. Anything else moves it.
    pub fn move_would_change(&self, from: usize, to: usize, drop: Drop) -> bool {
        self.move_layers_would_change(&[from], to, drop)
    }

    /// [`Document::move_would_change`] for a whole panel selection dragged
    /// at once. False for anything the move would refuse — dropping a group
    /// into itself, or `Inside` something that is not a group — so that the
    /// panel can ask this one question and draw a line only when there is
    /// something to promise.
    pub fn move_layers_would_change(&self, indices: &[usize], to: usize, drop: Drop) -> bool {
        let roots = self.roots_among(indices);
        if roots.is_empty() || to >= self.layers.len() {
            return false;
        }
        // The move itself would refuse these.
        if roots.iter().any(|&r| self.subtree(r).contains(&to)) {
            return false;
        }
        let Ok((at, parent)) = self.drop_slot(to, drop) else { return false };
        // Nothing moves only when the layers are already side by side, in
        // the group they are being dropped into, and land against one end
        // of where they already sit — everything else rearranges something.
        if roots.iter().any(|&r| self.layers[r].parent != parent) {
            return true;
        }
        let side_by_side = roots.windows(2).all(|w| self.subtree(w[0]).end == self.subtree(w[1]).start);
        if !side_by_side {
            return true;
        }
        let block = self.subtree(roots[0]).start..self.subtree(roots[roots.len() - 1]).end;
        at != block.start && at != block.end
    }

    /// Moves a layer — a group with everything in it — somewhere else in the
    /// stack, relative to another layer. This is what a drag in the layers
    /// panel does, and the three places are the three the panel can show a
    /// drop at. Returns where the moved layer ended up. The active layer
    /// stays the same *layer*, wherever it ends up.
    pub fn move_layer_to(&mut self, from: usize, to: usize, drop: Drop) -> Result<usize, DocumentError> {
        if from >= self.layers.len() || to >= self.layers.len() {
            return Err(DocumentError::NoSuchLayer);
        }
        let span = self.subtree(from);
        // Dropping a group into itself would cut the subtree loose.
        if span.contains(&to) {
            return Err(DocumentError::CannotNest);
        }
        let (at, parent) = self.drop_slot(to, drop)?;
        let active_id = self.active_layer().id();
        let mut moved: Vec<Layer> = self.layers.drain(span.clone()).collect();
        let root = moved.len() - 1;
        moved[root].parent = parent;
        let at = if at > span.start { at - span.len() } else { at };
        self.layers.splice(at..at, moved);
        self.active = self.index_of(active_id).expect("the active layer is still in the stack");
        Ok(at + root)
    }

    /// Where a layer goes when it is moved one place up (`up`) or down the
    /// panel: over its neighbouring *sibling* — a whole group at a time,
    /// not into it — and, when there is no sibling that way, out of the
    /// group it is in. `None` at the very top or bottom of the document.
    pub fn reorder_target(&self, index: usize, up: bool) -> Option<(usize, Drop)> {
        let layer = self.layers.get(index)?;
        let parent = layer.parent;
        let span = self.subtree(index);
        // A sibling is somewhere in the run this layer shares with them,
        // which is the whole stack at the top level.
        let among = match self.parent_index(index) {
            Some(group) => self.children_of(group),
            None => 0..self.layers.len(),
        };
        let sibling = if up {
            (span.end..among.end).find(|&i| self.layers[i].parent == parent)
        } else {
            (among.start..span.start).rev().find(|&i| self.layers[i].parent == parent)
        };
        let drop = if up { Drop::Above } else { Drop::Below };
        match sibling {
            Some(n) => Some((n, drop)),
            // No sibling left that way: the next move is out of the group.
            None => self.parent_index(index).map(|group| (group, drop)),
        }
    }

    /// Moves a layer one place up or down the panel; see
    /// [`Document::reorder_target`]. Returns where it ended up, or `None`
    /// when there was nowhere to go.
    pub fn reorder_layer(&mut self, index: usize, up: bool) -> Result<Option<usize>, DocumentError> {
        if index >= self.layers.len() {
            return Err(DocumentError::NoSuchLayer);
        }
        match self.reorder_target(index, up) {
            Some((to, drop)) => self.move_layer_to(index, to, drop).map(Some),
            None => Ok(None),
        }
    }

    /// The layers of `indices` that are not already inside another of them:
    /// selecting a group and something in it means the group, once.
    /// Sorted, bottom-first.
    pub fn roots_among(&self, indices: &[usize]) -> Vec<usize> {
        let mut roots: Vec<usize> = indices.iter().copied().filter(|&i| i < self.layers.len()).collect();
        roots.sort_unstable();
        roots.dedup();
        let inside: Vec<usize> = roots.iter().copied().filter(|&i| roots.iter().any(|&g| g != i && self.is_inside(i, g))).collect();
        roots.retain(|i| !inside.contains(i));
        roots
    }

    /// Lifts whole subtrees out of the stack, keeping their order, and says
    /// where the slot at `at` has slid to now that they are gone. `roots`
    /// must be sorted and reduced with [`Document::roots_among`].
    fn take_subtrees(&mut self, roots: &[usize], at: usize) -> (Vec<Vec<Layer>>, usize) {
        let mut taken: Vec<Vec<Layer>> = Vec::with_capacity(roots.len());
        let mut at = at;
        // Highest first, so the indices still to come are undisturbed.
        for &root in roots.iter().rev() {
            let span = self.subtree(root);
            taken.push(self.layers.drain(span.clone()).collect());
            if span.start < at {
                at -= span.len();
            }
        }
        taken.reverse();
        (taken, at)
    }

    /// Moves several layers at once — a whole panel selection dragged
    /// together. They keep their order among themselves and end up side by
    /// side where they were dropped.
    pub fn move_layers_to(&mut self, indices: &[usize], to: usize, drop: Drop) -> Result<usize, DocumentError> {
        let roots = self.roots_among(indices);
        if roots.is_empty() || to >= self.layers.len() {
            return Err(DocumentError::NoSuchLayer);
        }
        if roots.iter().any(|&r| self.subtree(r).contains(&to)) {
            return Err(DocumentError::CannotNest);
        }
        let (at, parent) = self.drop_slot(to, drop)?;
        let active_id = self.active_layer().id();
        let (taken, at) = self.take_subtrees(&roots, at);
        let mut block: Vec<Layer> = Vec::new();
        for mut layers in taken {
            let root = layers.len() - 1;
            layers[root].parent = parent;
            block.extend(layers);
        }
        let landed = at + block.len() - 1;
        self.layers.splice(at..at, block);
        self.active = self.index_of(active_id).unwrap_or(landed);
        Ok(landed)
    }

    /// Puts several layers into one new group, in the place of the topmost
    /// of them. They keep their order; a layer already inside one of the
    /// others comes along with it rather than twice.
    pub fn group_layers(&mut self, indices: &[usize], name: Option<&str>) -> Result<usize, DocumentError> {
        let roots = self.roots_among(indices);
        let Some(&anchor) = roots.last() else { return Err(DocumentError::NoSuchLayer) };
        let parent = self.layers[anchor].parent;
        let at = self.subtree(anchor).end;
        let id = self.take_id();
        let name = name.map_or_else(|| format!("Group {}", id.0), str::to_owned);

        let (taken, at) = self.take_subtrees(&roots, at);
        let mut block: Vec<Layer> = Vec::new();
        for mut layers in taken {
            let root = layers.len() - 1;
            layers[root].parent = Some(id);
            block.extend(layers);
        }
        let mut group = Layer::new_group(id, name);
        group.parent = parent;
        block.push(group);
        let landed = at + block.len() - 1;
        self.layers.splice(at..at, block);
        self.active = landed;
        Ok(landed)
    }

    // ---- Groups ----------------------------------------------------------------

    /// An empty group where a new layer would go, and active.
    pub fn add_group(&mut self, name: Option<&str>) -> usize {
        let id = self.take_id();
        let name = name.map_or_else(|| format!("Group {}", id.0), str::to_owned);
        self.insert_above_active(Layer::new_group(id, name))
    }

    /// Puts a layer — a group and its contents, if that is what it is —
    /// into a new group in its place, and makes the group active. Nothing
    /// changes on screen: the group is pass-through.
    pub fn group_layer(&mut self, index: usize, name: Option<&str>) -> Result<usize, DocumentError> {
        self.group_layers(&[index], name)
    }

    /// Dissolves a group, leaving its contents where they were at the level
    /// the group was on. The group's own opacity, blend mode and mask go
    /// with it, so a group that was not pass-through can change the picture
    /// — which is what Photoshop's Ungroup does too.
    pub fn ungroup(&mut self, index: usize) -> Result<(), DocumentError> {
        let layer = self.layers.get(index).ok_or(DocumentError::NoSuchLayer)?;
        if !layer.is_group() {
            return Err(DocumentError::WrongKind);
        }
        let id = layer.id();
        let parent = layer.parent;
        let children = self.children_of(index);
        if children.is_empty() && self.layers.len() == 1 {
            return Err(DocumentError::LastLayer);
        }
        for i in children.clone() {
            if self.layers[i].parent == Some(id) {
                self.layers[i].parent = parent;
            }
        }
        self.layers.remove(index);
        if self.active >= index {
            self.active = self.active.saturating_sub(1).min(self.layers.len() - 1);
        }
        Ok(())
    }

    /// Replaces a group with one pixel layer holding what it composited to —
    /// Merge Group. The layer keeps the group's name, opacity, blend mode
    /// and mask, so the picture does not change.
    pub fn flatten_group(&mut self, index: usize) -> Result<(), DocumentError> {
        let layer = self.layers.get(index).ok_or(DocumentError::NoSuchLayer)?;
        if !layer.is_group() {
            return Err(DocumentError::WrongKind);
        }
        let id = layer.id();
        let children = self.children_of(index);
        let mut flat = Raster::new(self.width, self.height);
        let all = self.bounds();
        self.composite_range(children.clone(), Some(id), &mut flat, &all);
        let span = children;
        self.layers.drain(span.clone());
        let index = index - span.len();
        let group = &mut self.layers[index];
        group.kind = LayerKind::Pixels;
        group.raster = flat;
        // Pass-through is a group's mode and means nothing on pixels; what
        // the children did against the backdrop is baked in already.
        if group.blend == BlendMode::PassThrough {
            group.blend = BlendMode::Normal;
        }
        group.set_target(Target::Pixels);
        if self.active >= span.start {
            self.active = self.active.saturating_sub(span.len()).min(self.layers.len() - 1);
        }
        Ok(())
    }

    pub fn set_collapsed(&mut self, index: usize, collapsed: bool) -> Result<(), DocumentError> {
        let layer = self.layers.get_mut(index).ok_or(DocumentError::NoSuchLayer)?;
        if !layer.is_group() {
            return Err(DocumentError::WrongKind);
        }
        layer.collapsed = collapsed;
        Ok(())
    }

    /// The layer directly below this one *at the same level*: the next row
    /// down when neither is in a group, and `None` when this layer is at
    /// the bottom of the group it is in.
    pub fn sibling_below(&self, index: usize) -> Option<usize> {
        let below = self.subtree(index).start.checked_sub(1)?;
        (self.layers[below].parent == self.layers[index].parent).then_some(below)
    }

    /// Composites the layer at `index` onto the one below it and removes it.
    /// The result keeps the lower layer's identity and name, and both masks
    /// are baked in on the way. An adjustment layer merges by applying its
    /// adjustment to the layer below for good; nothing can merge *into* an
    /// adjustment layer or a smart object.
    pub fn merge_down(&mut self, index: usize) -> Result<(), DocumentError> {
        if index >= self.layers.len() {
            return Err(DocumentError::NoSuchLayer);
        }
        // Merging a *group* means merging it into itself: one layer holding
        // what it drew, which is what Ctrl+E on a group does everywhere.
        if self.layers[index].is_group() {
            return self.flatten_group(index);
        }
        let below = self.sibling_below(index).ok_or(DocumentError::NothingBelow)?;
        if !matches!(self.layers[below].kind, LayerKind::Pixels) {
            return Err(DocumentError::CannotMergeInto);
        }
        debug_assert_eq!(below, index - 1, "a plain layer's sibling below is the row below it");
        let top = self.layers.remove(index);
        let below = &mut self.layers[index - 1];
        below.apply_mask();
        if top.visible {
            let all = below.raster.bounds();
            Self::blend_layer(&mut below.raster, &top, &all);
        }
        if self.active >= index {
            self.active = self.active.saturating_sub(1);
        }
        Ok(())
    }

    /// Replaces every layer with one, `Background`, holding the composite —
    /// groups and all.
    pub fn flatten(&mut self) {
        let flat = self.composite();
        let id = self.take_id();
        self.layers = vec![Layer::new(id, "Background", flat)];
        self.active = 0;
    }

    /// A new layer above the active one holding a copy of the active
    /// layer's pixels inside `clip` — "layer via copy".
    /// An adjustment layer has no pixels to copy, so the copy is empty.
    pub fn layer_via_copy(&mut self, clip: Rect) -> usize {
        let (inside, _) = self.active_layer().raster.split(&clip);
        let inside = if self.active_layer().is_adjustment() { Raster::new(self.width, self.height) } else { inside };
        let name = format!("{} copy", self.active_layer().name);
        self.insert_layer_above_active(inside, Some(&name))
    }

    /// Rotates the whole canvas, every layer, by quarter turns clockwise.
    /// Odd turns swap the document's width and height.
    pub fn rotate_canvas(&mut self, turns: i32) {
        let turn = Projective::from(canvas_turn(self.width, self.height, turns));
        if turns.rem_euclid(2) == 1 {
            std::mem::swap(&mut self.width, &mut self.height);
        }
        let (width, height) = (self.width, self.height);
        for layer in &mut self.layers {
            layer.map_rasters(|r| r.rotated_quarter(turns), |m| turn.then(m), width, height);
        }
    }

    /// Resizes the canvas, keeping the existing pixels at `(dx, dy)` in the
    /// new one. Every layer is document-sized, so they all move together.
    pub fn resize_canvas(&mut self, width: u32, height: u32, dx: i32, dy: i32) {
        let (width, height) = (width.max(1), height.max(1));
        let shift = Projective::from(Affine::translation(f64::from(dx), f64::from(dy)));
        for layer in &mut self.layers {
            layer.map_rasters(|r| r.resized(width, height, dx, dy), |m| shift.then(m), width, height);
        }
        self.width = width;
        self.height = height;
    }

    pub fn flip_canvas_horizontal(&mut self) {
        let (width, height) = (self.width, self.height);
        let flip = Projective::from(Affine { a: -1.0, e: f64::from(width), ..Affine::IDENTITY });
        for layer in &mut self.layers {
            layer.map_rasters(Raster::flipped_horizontal, |m| flip.then(m), width, height);
        }
    }

    pub fn flip_canvas_vertical(&mut self) {
        let (width, height) = (self.width, self.height);
        let flip = Projective::from(Affine { d: -1.0, f: f64::from(height), ..Affine::IDENTITY });
        for layer in &mut self.layers {
            layer.map_rasters(Raster::flipped_vertical, |m| flip.then(m), width, height);
        }
    }

    /// An adjustment layer's result, mixed back over what was there: by the
    /// blend mode first, then by how much of it shows (`t`, the opacity
    /// through the mask).
    fn finish_adjustment(was: Rgba, mut now: Rgba, t: f32, blend: BlendMode) -> Rgba {
        if blend != BlendMode::Normal && was.a > 0 {
            now = now.blend_over(was, blend);
        }
        if t >= 1.0 { now } else { was.lerp(now, t) }
    }

    /// [`Document::finish_adjustment`] for the usual case, where the adjustment is a
    /// function of the colour and nothing has to be computed for a pixel
    /// that the mask hides anyway.
    fn mix_adjustment(was: Rgba, f: &crate::adjust::PixelMap<'_>, t: f32, blend: BlendMode) -> Rgba {
        if t <= 0.0 {
            return was;
        }
        Self::finish_adjustment(was, f.map(was), t, blend)
    }

    /// Composites one layer onto `dst` inside `clip`, through its mask,
    /// opacity and blend mode. An adjustment layer has nothing of its own to draw: it adjusts
    /// what is already there, and its opacity and mask say how much of that
    /// shows; its blend mode blends the adjusted result back over the
    /// original, as in Photoshop.
    fn blend_layer(dst: &mut Raster, layer: &Layer, clip: &Rect) {
        match &layer.kind {
            LayerKind::Adjustment(adjustment) => {
                if layer.opacity <= 0.0 {
                    return;
                }
                let (opacity, blend) = (layer.opacity, layer.blend);
                let mask = layer.render_mask();
                let cover = move |x: i32, y: i32| match mask {
                    Some(m) => opacity * f32::from(crate::layer::mask_cover(m.get(x, y))) / 255.0,
                    None => opacity,
                };
                match adjustment.pixel_map() {
                    // Almost every adjustment is a function of the colour
                    // alone, so the result is worked out and mixed back in
                    // one pass, in place. The copy below is 33 MB at 4K.
                    // The mask, when there is one, is read alongside a row
                    // at a time: this pass runs over the whole canvas on
                    // every tick of the dialog's sliders.
                    Some(f) => match mask {
                        Some(m) => dst.map_with(m, clip, |was, mp| {
                            let t = opacity * f32::from(crate::layer::mask_cover(mp)) / 255.0;
                            Self::mix_adjustment(was, &f, t, blend)
                        }),
                        None => dst.map_in(clip, |was| Self::mix_adjustment(was, &f, opacity, blend)),
                    },
                    None => {
                        // A dither needs its neighbours, so this one does
                        // need a copy — but only of the part being redrawn.
                        let area = clip.intersect(&dst.bounds());
                        let mut adjusted = dst.crop(&area);
                        let inner = adjusted.bounds();
                        adjustment.apply(&mut adjusted, &inner);
                        dst.map_at(&area, |was, x, y| {
                            let t = cover(x, y);
                            if t <= 0.0 {
                                return was;
                            }
                            Self::finish_adjustment(was, adjusted.get(x - area.x, y - area.y), t, blend)
                        })
                    }
                }
            }
            // A group draws its children, not itself, and never reaches
            // here: `composite_range` takes it before this does.
            LayerKind::Group => {}
            _ => Self::blend_raster(dst, &layer.raster, layer.opacity, layer.blend, layer.render_mask(), clip),
        }
    }

    /// One finished picture composited onto another, through an opacity, a
    /// blend mode and an optional mask — the tail of [`Document::blend_layer`],
    /// shared with the buffer a group composites into.
    fn blend_raster(dst: &mut Raster, src: &Raster, opacity: f32, blend: BlendMode, mask: Option<&Raster>, clip: &Rect) {
        match mask {
            Some(mask) => dst.composite_blend_masked(src, mask, opacity, blend, mask_cover, clip),
            None => dst.composite_blend(src, opacity, blend, clip),
        }
    }

    /// Flattens every visible layer, bottom to top, onto a transparent
    /// buffer. Hidden layers and layers at zero opacity contribute nothing.
    pub fn composite(&self) -> Raster {
        let mut out = Raster::new(self.width, self.height);
        let all = self.bounds();
        self.composite_into(&mut out, &all);
        out
    }

    /// [`Document::composite`] into an existing buffer, redrawing `clip`
    /// only and leaving the rest of the buffer as it was.
    ///
    /// Reusing the buffer matters — at 6000x4500 a fresh one is 108 MB —
    /// and so does the clip: this runs for every stroke update, and a brush
    /// dab has no business recompositing eight million pixels. Every layer
    /// is composited a pixel at a time, so redrawing a rectangle of the
    /// frame gives exactly what redrawing all of it would have.
    pub fn composite_into(&self, out: &mut Raster, clip: &Rect) {
        let mut clip = *clip;
        if out.width() != self.width || out.height() != self.height {
            *out = Raster::new(self.width, self.height);
            clip = self.bounds();
        }
        self.composite_below(0, out, &clip);
        self.composite_from(0, out, &clip);
    }

    /// Composites the layers *below* `index` into `out`, which is cleared
    /// first. What an editing session keeps while one layer is being
    /// changed over and over: nothing under it can move until the session
    /// ends, so it is worth compositing once.
    /// `index` must be a [`Document::split_point`] — the bottom of a
    /// top-level item. Splitting in the middle of a group would leave half
    /// of it on each side of the cut, and neither half is a picture.
    pub fn composite_below(&self, index: usize, out: &mut Raster, clip: &Rect) {
        debug_assert_eq!(index, self.split_point(index), "the composite may only be split between top-level layers");
        out.clear_in(clip);
        self.composite_range(0..index, None, out, clip);
    }

    /// Composites layer `index` and everything above it onto `out`, which
    /// must already hold what is below them — [`Document::composite_below`]
    /// with the same index, or a copy of what it left.
    pub fn composite_from(&self, index: usize, out: &mut Raster, clip: &Rect) {
        debug_assert_eq!(index, self.split_point(index), "the composite may only be split between top-level layers");
        self.composite_range(index..self.layers.len(), None, out, clip);
    }

    /// The siblings directly inside `parent` that lie in `range`,
    /// bottom-first, each with the run of layers its contents occupy — for
    /// a group, its children; for anything else, empty.
    fn siblings_in(&self, range: Range<usize>, parent: Option<LayerId>) -> Vec<(usize, Range<usize>)> {
        // An item's contents start just past whatever the last sibling took.
        let mut cursor = range.start;
        let mut siblings = Vec::new();
        for i in range {
            if self.layers[i].parent != parent {
                continue;
            }
            siblings.push((i, cursor..i));
            cursor = i + 1;
        }
        siblings
    }

    /// Composites the layers inside `parent` that lie in `range`, bottom to
    /// top. A group among them is drawn by its contents, which are the run
    /// of layers between the previous sibling and the group's own row, and
    /// a sibling with clipped layers above it is drawn together with them.
    fn composite_range(&self, range: Range<usize>, parent: Option<LayerId>, out: &mut Raster, clip: &Rect) {
        let siblings = self.siblings_in(range, parent);
        let mut at = 0;
        while at < siblings.len() {
            let end = at + 1 + self.clipped_above(&siblings, at);
            if end > at + 1 {
                self.composite_clipped(&siblings[at..end], out, clip);
            } else {
                self.draw_item(&siblings[at], out, clip);
            }
            at = end;
        }
    }

    /// How many of the siblings above `at` are clipped to it. An adjustment
    /// layer has no pixels for anything to be clipped to, so it never takes
    /// any.
    fn clipped_above(&self, siblings: &[(usize, Range<usize>)], at: usize) -> usize {
        if self.layers[siblings[at].0].is_adjustment() {
            return 0;
        }
        siblings[at + 1..].iter().take_while(|&&(i, _)| self.layers[i].clips_below()).count()
    }

    /// One sibling on its own terms: a group by its contents, anything else
    /// by its pixels.
    fn draw_item(&self, (index, contents): &(usize, Range<usize>), out: &mut Raster, clip: &Rect) {
        let layer = &self.layers[*index];
        if !layer.visible {
            return;
        }
        if layer.is_group() {
            self.composite_group(layer, contents.clone(), out, clip);
        } else {
            Self::blend_layer(out, layer, clip);
        }
    }

    /// A clipping group: `siblings[0]` is the base and the rest are clipped
    /// to it.
    ///
    /// The clipped layers draw onto the base's own picture, so a Multiply
    /// among them multiplies with the base and not with the backdrop, and
    /// the result is then held to the base's alpha — nothing of theirs
    /// shows where the base is transparent. The base's opacity and blend
    /// mode carry the finished group onto the backdrop, which is why they
    /// are applied here rather than while it is drawn.
    ///
    /// A hidden base takes the whole group with it: the clipped layers have
    /// nothing left to clip to.
    fn composite_clipped(&self, siblings: &[(usize, Range<usize>)], out: &mut Raster, clip: &Rect) {
        let base = &self.layers[siblings[0].0];
        let area = clip.intersect(&self.bounds());
        if !base.visible || base.opacity <= 0.0 || area.is_empty() {
            return;
        }
        let mut inner = Raster::new(self.width, self.height);
        self.draw_clip_base(&siblings[0], &mut inner, &area);
        let covered: Vec<u8> = Self::alpha_in(&inner, &area);
        for item in &siblings[1..] {
            self.draw_item(item, &mut inner, &area);
        }
        let width = area.w as usize;
        inner.map_at(&area, |p, x, y| {
            let limit = covered[(y - area.y) as usize * width + (x - area.x) as usize];
            if p.a <= limit {
                p
            } else {
                Rgba { a: limit, ..p }
            }
        });
        Self::blend_raster(out, &inner, base.opacity, base.blend, None, &area);
    }

    /// The alpha channel of `raster` inside `area`, row-major.
    fn alpha_in(raster: &Raster, area: &Rect) -> Vec<u8> {
        let mut out = Vec::with_capacity(area.area() as usize);
        for y in area.y..area.y + area.h {
            for x in area.x..area.x + area.w {
                out.push(raster.get(x, y).a);
            }
        }
        out
    }

    /// The base of a clipping group on a transparent buffer of its own:
    /// through its mask, which is part of what the group is clipped to, but
    /// not through its opacity or blend mode, which belong to the finished
    /// group.
    fn draw_clip_base(&self, (index, contents): &(usize, Range<usize>), inner: &mut Raster, clip: &Rect) {
        let base = &self.layers[*index];
        if !base.is_group() {
            Self::blend_raster(inner, &base.raster, 1.0, BlendMode::Normal, base.render_mask(), clip);
            return;
        }
        self.composite_range(contents.clone(), Some(base.id()), inner, clip);
        if let Some(mask) = base.render_mask() {
            inner.map_at(clip, |p, x, y| p.scaled_alpha(f32::from(mask_cover(mask.get(x, y))) / 255.0));
        }
    }

    /// One group: its children composited together and blended in.
    ///
    /// A **pass-through** group at full strength is not a separate picture
    /// at all — its children draw straight onto the backdrop, so an
    /// adjustment layer or a Multiply inside one reaches the rest of the
    /// document exactly as it would outside. Held back by opacity or a
    /// mask, it is that same drawing mixed back into the backdrop by how
    /// much of the group shows, which is the only reading of a partly
    /// present pass-through group that keeps both ends right.
    ///
    /// Any other blend mode **isolates**: the children go onto a buffer of
    /// their own and that is composited in, so the group's blend mode has
    /// something of its own to blend. The buffer is the cost of a group,
    /// and only these two cases pay it.
    fn composite_group(&self, group: &Layer, children: Range<usize>, out: &mut Raster, clip: &Rect) {
        let id = Some(group.id());
        if group.blend == BlendMode::PassThrough {
            let mask = group.render_mask();
            let opacity = group.opacity;
            if opacity >= 1.0 && mask.is_none() {
                self.composite_range(children, id, out, clip);
                return;
            }
            if opacity <= 0.0 {
                return;
            }
            let mut over = out.clone();
            self.composite_range(children, id, &mut over, clip);
            match mask {
                Some(m) => out.map_at(clip, |was, x, y| {
                    let t = opacity * f32::from(mask_cover(m.get(x, y))) / 255.0;
                    if t <= 0.0 {
                        was
                    } else {
                        was.lerp(over.get(x, y), t)
                    }
                }),
                None => out.map_with(&over, clip, |was, now| was.lerp(now, opacity)),
            }
            return;
        }
        if group.opacity <= 0.0 {
            return;
        }
        let mut inner = Raster::new(self.width, self.height);
        self.composite_range(children, id, &mut inner, clip);
        Self::blend_raster(out, &inner, group.opacity, group.blend, group.render_mask(), clip);
    }
}

/// Whether a stack's groups are arranged the way the module describes:
/// every layer's parent is the innermost group still open above it, so a
/// group's children are one contiguous run under its own row. Reading a
/// file is the only place this can fail, and a file that fails it is
/// damaged rather than merely old.
fn nesting_is_sound(layers: &[Layer]) -> bool {
    // Walking the stack downwards, the groups passed are the ones whose
    // contents we are inside; the innermost is the parent every layer here
    // must name until its run ends.
    let mut open: Vec<LayerId> = Vec::new();
    for layer in layers.iter().rev() {
        while open.last() != layer.parent.as_ref() {
            if open.pop().is_none() {
                return false;
            }
        }
        if layer.is_group() {
            open.push(layer.id());
        }
    }
    true
}

/// Where a dragged layer lands, relative to the layer it was dropped on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Drop {
    /// Just above it, as a sibling.
    Above,
    /// Just below it, as a sibling.
    Below,
    /// At the top of its contents — it has to be a group.
    Inside,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adjust::Kind;

    const RED: Rgba = Rgba::opaque(255, 0, 0);
    const BLUE: Rgba = Rgba::opaque(0, 0, 255);

    fn names(doc: &Document) -> Vec<&str> {
        doc.layers().iter().map(|l| l.name.as_str()).collect()
    }

    // ---- Groups ------------------------------------------------------------

    /// A document with `Background`, then a group "Folder" holding `Inner`,
    /// then `Top` above it — the arrangement the module docs draw.
    fn grouped() -> Document {
        let mut doc = Document::new(2, 2, Rgba::WHITE);
        let inner = doc.add_layer();
        doc.layer_mut(inner).unwrap().name = "Inner".to_owned();
        let group = doc.group_layer(inner, Some("Folder")).unwrap();
        assert_eq!(group, 2);
        // Active on a group puts the next layer inside it, so this one is
        // added below and then moved above the group.
        doc.set_active(0).unwrap();
        let added = doc.add_layer();
        let top = doc.move_layer_to(added, 3, Drop::Above).unwrap();
        doc.layer_mut(top).unwrap().name = "Top".to_owned();
        doc
    }

    fn shape(doc: &Document) -> Vec<(String, usize)> {
        (0..doc.layers().len()).map(|i| (doc.layers()[i].name.clone(), doc.depth(i))).collect()
    }

    #[test]
    fn a_group_holds_the_run_of_layers_below_its_own_row() {
        let doc = grouped();
        assert_eq!(names(&doc), vec!["Background", "Inner", "Folder", "Top"]);
        assert_eq!(doc.depth(1), 1, "Inner is in the group");
        assert_eq!(doc.depth(2), 0, "the group's own row is at the top level");
        assert_eq!(doc.subtree(2), 1..3, "the group takes its contents with it");
        assert_eq!(doc.children_of(2), 1..2);
        assert_eq!(doc.subtree(3), 3..4, "a plain layer is only itself");
        assert_eq!(doc.parent_index(1), Some(2));
        assert_eq!(doc.parent_index(3), None);
        assert_eq!(doc.roots(None), vec![0, 2, 3]);
        assert!(doc.is_inside(1, 2) && !doc.is_inside(3, 2));
    }

    #[test]
    fn a_new_layer_goes_inside_the_group_when_the_group_is_the_active_one() {
        let mut doc = grouped();
        doc.set_active(2).unwrap();
        let added = doc.add_layer();
        assert_eq!(added, 2, "at the top of the group's contents");
        assert_eq!(doc.depth(2), 1);
        assert_eq!(doc.children_of(3), 1..3);
    }

    #[test]
    fn a_pass_through_group_draws_exactly_as_the_same_layers_would_loose() {
        let mut flat = Document::new(2, 2, Rgba::TRANSPARENT);
        let i = flat.add_layer();
        flat.layer_mut(i).unwrap().raster = Raster::filled(2, 2, Rgba::new(200, 100, 50, 128));
        flat.layer_mut(i).unwrap().blend = BlendMode::Multiply;
        let loose = flat.composite();

        let mut doc = flat.clone();
        doc.group_layer(i, Some("Folder")).unwrap();
        assert_eq!(doc.layers()[2].blend, BlendMode::PassThrough, "a new group is pass-through");
        assert_eq!(doc.composite(), loose, "wrapping layers in a group changes nothing");

        // An adjustment layer inside a pass-through group still reaches the
        // layer below the group, which is the whole point of pass-through.
        let mut with_adjust = Document::new(2, 2, Rgba::WHITE);
        let a = with_adjust.add_adjustment_layer(Adjustment::from_params("invert", &[]).unwrap(), None);
        let inverted = with_adjust.composite().get(0, 0);
        with_adjust.group_layer(a, Some("Folder")).unwrap();
        assert_eq!(with_adjust.composite().get(0, 0), inverted, "it still sees what is under the group");
    }

    #[test]
    fn an_isolated_group_keeps_its_contents_to_itself() {
        let mut doc = Document::new(2, 2, Rgba::WHITE);
        let a = doc.add_adjustment_layer(Adjustment::from_params("invert", &[]).unwrap(), None);
        let group = doc.group_layer(a, Some("Folder")).unwrap();
        doc.layer_mut(group).unwrap().blend = BlendMode::Normal;
        assert_eq!(doc.composite().get(0, 0), Rgba::WHITE, "nothing under the group is adjusted any more");
    }

    #[test]
    fn a_groups_opacity_and_visibility_reach_everything_inside_it() {
        let mut doc = Document::new(2, 2, Rgba::TRANSPARENT);
        let i = doc.add_layer();
        doc.layer_mut(i).unwrap().raster = Raster::filled(2, 2, RED);
        let group = doc.group_layer(i, Some("Folder")).unwrap();
        doc.layer_mut(group).unwrap().set_opacity(0.5);
        assert_eq!(doc.composite().get(0, 0).a, 128, "half of the group shows");
        doc.layer_mut(group).unwrap().visible = false;
        assert_eq!(doc.composite().get(0, 0), Rgba::TRANSPARENT, "a group switched off takes its contents with it");
        assert!(doc.hidden_by_group(i), "and the layer inside knows why it is not on screen");
    }

    #[test]
    fn deleting_or_duplicating_a_group_takes_its_contents_along() {
        let mut doc = grouped();
        doc.set_active(3).unwrap();
        doc.duplicate_layer(2).unwrap();
        assert_eq!(names(&doc), vec!["Background", "Inner", "Folder", "Inner", "Folder copy", "Top"]);
        assert_eq!(doc.depth(3), 1, "the copy's contents are in the copy");
        assert_eq!(doc.parent_index(3), Some(4), "and not in the original");
        assert_eq!(doc.active_index(), 4);

        doc.remove_layer(4).unwrap();
        assert_eq!(names(&doc), vec!["Background", "Inner", "Folder", "Top"]);
        doc.remove_layer(2).unwrap();
        assert_eq!(names(&doc), vec!["Background", "Top"]);
    }

    #[test]
    fn ungrouping_leaves_the_contents_where_they_were() {
        let mut doc = grouped();
        doc.ungroup(2).unwrap();
        assert_eq!(names(&doc), vec!["Background", "Inner", "Top"]);
        assert!(doc.layers().iter().all(|l| l.parent.is_none()));
        assert_eq!(doc.ungroup(0), Err(DocumentError::WrongKind));
    }

    #[test]
    fn merging_a_group_leaves_one_layer_that_draws_the_same() {
        let mut doc = Document::new(2, 2, Rgba::TRANSPARENT);
        let i = doc.add_layer();
        doc.layer_mut(i).unwrap().raster = Raster::filled(2, 2, Rgba::new(255, 0, 0, 128));
        let group = doc.group_layer(i, Some("Folder")).unwrap();
        let before = doc.composite();
        doc.merge_down(group).unwrap();
        assert_eq!(names(&doc), vec!["Background", "Folder"]);
        assert!(doc.layers()[1].kind == LayerKind::Pixels);
        assert_eq!(doc.composite(), before);
    }

    #[test]
    fn several_layers_group_together_in_the_place_of_the_topmost() {
        let mut doc = Document::new(2, 2, Rgba::WHITE);
        for n in 1..=3 {
            let i = doc.add_layer();
            doc.layer_mut(i).unwrap().name = format!("L{n}");
        }
        // L1 and L3 are grouped; L2, which is between them, is not.
        let group = doc.group_layers(&[1, 3], Some("Two")).unwrap();
        assert_eq!(names(&doc), vec!["Background", "L2", "L1", "L3", "Two"]);
        assert_eq!(group, 4);
        assert_eq!(doc.children_of(4), 2..4, "they are side by side inside it");
        assert_eq!(doc.depth(2), 1);
        assert_eq!(doc.depth(3), 1);
        assert_eq!(doc.depth(1), 0, "and L2 stayed where it was");
        assert_eq!(doc.active_index(), 4);
    }

    #[test]
    fn grouping_a_group_and_something_inside_it_takes_the_group_once() {
        let mut doc = grouped();
        // "Folder" (2) and "Inner" (1), which is already in it.
        assert_eq!(doc.roots_among(&[1, 2]), vec![2]);
        let group = doc.group_layers(&[1, 2], Some("Outer")).unwrap();
        assert_eq!(names(&doc), vec!["Background", "Inner", "Folder", "Outer", "Top"]);
        assert_eq!(doc.depth(1), 2);
        assert_eq!(doc.depth(2), 1);
        assert_eq!(doc.depth(3), 0);
        assert_eq!(group, 3);
    }

    #[test]
    fn several_layers_drag_together_and_keep_their_order() {
        let mut doc = grouped();
        // Background and Top, from the two ends, dropped into the group.
        doc.move_layers_to(&[0, 3], 2, Drop::Inside).unwrap();
        assert_eq!(
            shape(&doc),
            vec![("Inner".into(), 1), ("Background".into(), 1), ("Top".into(), 1), ("Folder".into(), 0)]
        );
        assert_eq!(doc.move_layers_to(&[2], 2, Drop::Inside), Err(DocumentError::CannotNest));
    }

    #[test]
    fn a_layer_can_be_dropped_above_below_or_inside_another() {
        let mut doc = grouped();
        // Top, at the top level, dropped into the group.
        doc.move_layer_to(3, 2, Drop::Inside).unwrap();
        assert_eq!(shape(&doc), vec![("Background".into(), 0), ("Inner".into(), 1), ("Top".into(), 1), ("Folder".into(), 0)]);
        // And back out, under the group.
        doc.move_layer_to(2, 3, Drop::Below).unwrap();
        assert_eq!(shape(&doc), vec![("Background".into(), 0), ("Top".into(), 0), ("Inner".into(), 1), ("Folder".into(), 0)]);
        // The whole group above Top.
        doc.move_layer_to(3, 1, Drop::Above).unwrap();
        assert_eq!(shape(&doc), vec![("Background".into(), 0), ("Top".into(), 0), ("Inner".into(), 1), ("Folder".into(), 0)]);
        assert_eq!(doc.move_layer_to(3, 1, Drop::Inside), Err(DocumentError::WrongKind), "only a group has an inside");
    }

    /// A handful of stacks to sweep operations over: flat, one group, a
    /// group nested in a group, and a group at the very bottom.
    fn stacks() -> Vec<Document> {
        let flat = {
            let mut doc = Document::new(2, 2, Rgba::WHITE);
            for n in 1..=3 {
                let i = doc.add_layer();
                doc.layer_mut(i).unwrap().name = format!("L{n}");
            }
            doc
        };
        let nested = {
            let mut doc = grouped();
            // A group inside the group, holding Inner.
            doc.group_layer(1, Some("Deep")).unwrap();
            doc
        };
        let at_the_bottom = {
            let mut doc = Document::new(2, 2, Rgba::WHITE);
            // [Background (in Folder), Folder]; the group is active, so the
            // new layer lands inside it and is then lifted out on top.
            let folder = doc.group_layer(0, Some("Folder")).unwrap();
            let i = doc.add_layer();
            doc.layer_mut(i).unwrap().name = "Above".to_owned();
            doc.move_layer_to(i, folder + 1, Drop::Above).unwrap();
            doc
        };
        vec![flat, grouped(), nested, at_the_bottom]
    }

    #[test]
    fn move_would_change_agrees_with_what_moving_actually_does() {
        // Every (from, to, place) on every shape of stack: the prediction
        // the panel draws its line from has to be what the move then does,
        // or the line is lying to the user.
        let mut mismatches: Vec<String> = Vec::new();
        for base in stacks() {
            let n = base.layers().len();
            for from in 0..n {
                for to in 0..n {
                    for drop in [Drop::Above, Drop::Below, Drop::Inside] {
                        let said = base.move_would_change(from, to, drop);
                        let mut doc = base.clone();
                        let moved = doc.move_layer_to(from, to, drop).is_ok();
                        let changed = moved && shape(&doc) != shape(&base);
                        if said != changed {
                            mismatches.push(format!(
                                "{:?}: from {from} ({}) {drop:?} {to} ({}): said {said}, was {changed}",
                                names(&base),
                                base.layers()[from].name,
                                base.layers()[to].name,
                            ));
                        }
                    }
                }
            }
        }
        assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
    }

    #[test]
    fn every_move_leaves_a_stack_that_is_still_a_document() {
        // Whatever is dragged where, the groups still nest the way the
        // module says they do — `from_parts` is the same check a file gets.
        for base in stacks() {
            let n = base.layers().len();
            for from in 0..n {
                for to in 0..n {
                    for drop in [Drop::Above, Drop::Below, Drop::Inside] {
                        let mut doc = base.clone();
                        if doc.move_layer_to(from, to, drop).is_err() {
                            continue;
                        }
                        assert!(
                            Document::from_parts(2, 2, doc.layers().to_vec(), 0).is_some(),
                            "{:?} came out of {from} {drop:?} {to} unsound",
                            names(&doc)
                        );
                        assert_eq!(doc.layers().len(), base.layers().len(), "nothing was lost or gained");
                    }
                }
            }
        }
    }

    #[test]
    fn dragging_several_layers_at_once_agrees_with_itself_too() {
        for base in stacks() {
            let n = base.layers().len();
            for a in 0..n {
                for b in 0..n {
                    for to in 0..n {
                        for drop in [Drop::Above, Drop::Below, Drop::Inside] {
                            let picked = [a, b];
                            let said = base.move_layers_would_change(&picked, to, drop);
                            let mut doc = base.clone();
                            let moved = doc.move_layers_to(&picked, to, drop).is_ok();
                            let changed = moved && shape(&doc) != shape(&base);
                            assert_eq!(
                                said,
                                changed,
                                "{:?}: {picked:?} {drop:?} {to} ({}) said {said}, was {changed}",
                                names(&base),
                                base.layers()[to].name
                            );
                            if moved {
                                assert_eq!(doc.layers().len(), base.layers().len(), "nothing was lost or gained");
                                assert!(Document::from_parts(2, 2, doc.layers().to_vec(), 0).is_some(), "left the stack unsound");
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn a_group_cannot_be_dropped_into_itself() {
        let mut doc = grouped();
        assert_eq!(doc.move_layer_to(2, 1, Drop::Above), Err(DocumentError::CannotNest));
        assert_eq!(doc.move_layer_to(2, 2, Drop::Inside), Err(DocumentError::CannotNest));
    }

    #[test]
    fn moving_a_layer_up_steps_over_a_group_and_out_of_one() {
        let mut doc = grouped();
        // Background steps over the whole group rather than into it.
        doc.reorder_layer(0, true).unwrap();
        assert_eq!(names(&doc), vec!["Inner", "Folder", "Background", "Top"]);
        // Inner is alone in the group now, so up takes it out of it.
        doc.reorder_layer(0, true).unwrap();
        assert_eq!(shape(&doc), vec![("Folder".into(), 0), ("Inner".into(), 0), ("Background".into(), 0), ("Top".into(), 0)]);
        assert_eq!(doc.reorder_layer(3, true), Ok(None), "there is nothing above the top");
        assert_eq!(doc.reorder_layer(0, false), Ok(None), "or below the bottom");
    }

    #[test]
    fn a_stack_whose_groups_do_not_nest_is_not_a_document() {
        let doc = grouped();
        let mut layers = doc.layers().to_vec();
        // Inner claims a group that is not the one directly above it.
        layers[1].parent = Some(layers[3].id());
        assert!(Document::from_parts(2, 2, layers, 0).is_none());
        let mut layers = doc.layers().to_vec();
        // A parent that is not a group at all.
        layers[1].parent = Some(layers[0].id());
        assert!(Document::from_parts(2, 2, layers, 0).is_none());
        assert!(Document::from_parts(2, 2, doc.layers().to_vec(), 0).is_some());
    }

    #[test]
    fn a_new_document_has_one_background_layer() {
        let doc = Document::new(4, 3, Rgba::WHITE);
        assert_eq!(names(&doc), vec!["Background"]);
        assert_eq!(doc.active_index(), 0);
        assert_eq!(doc.composite().get(0, 0), Rgba::WHITE);
    }

    #[test]
    fn from_raster_is_the_image_as_the_only_layer() {
        let doc = Document::from_raster("cat.png", Raster::filled(3, 2, RED));
        assert_eq!((doc.width(), doc.height()), (3, 2));
        assert_eq!(names(&doc), vec!["cat.png"]);
        assert_eq!(doc.composite().get(2, 1), RED);
    }

    #[test]
    fn from_smart_object_keeps_the_picture_at_its_own_size() {
        let doc = Document::from_smart_object("cat.png", Raster::filled(3, 2, RED));
        assert_eq!((doc.width(), doc.height()), (3, 2));
        assert!(doc.layer(0).unwrap().is_smart());
        assert_eq!(doc.composite().get(2, 1), RED);
        assert_eq!(doc.content_bounds(), doc.bounds(), "it fills the canvas exactly");
    }

    #[test]
    fn content_bounds_counts_what_hangs_off_the_canvas() {
        let mut doc = Document::new(4, 4, Rgba::TRANSPARENT);
        assert_eq!(doc.content_bounds(), doc.bounds(), "the canvas is the floor");
        let i = doc.place_smart_object("photo", Raster::filled(2, 2, RED));
        doc.layer_mut(i).unwrap().set_smart_transform(Affine::translation(3.0, -2.0).into(), 4, 4);
        assert_eq!(doc.content_bounds(), Rect::new(0, -2, 5, 6));
    }

    #[test]
    fn new_layers_go_above_the_active_one_and_become_active() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        doc.add_layer();
        doc.add_layer();
        doc.set_active(0).unwrap();
        let index = doc.add_layer();
        assert_eq!(index, 1);
        assert_eq!(doc.active_index(), 1);
        assert_eq!(names(&doc), vec!["Background", "Layer 4", "Layer 2", "Layer 3"]);
    }

    #[test]
    fn ids_are_never_reused() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        let first = doc.add_layer();
        let first_id = doc.layer(first).unwrap().id();
        doc.remove_layer(first).unwrap();
        let second = doc.add_layer();
        assert_ne!(doc.layer(second).unwrap().id(), first_id);
    }

    #[test]
    fn cannot_remove_the_last_layer() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        assert_eq!(doc.remove_layer(0), Err(DocumentError::LastLayer));
        assert_eq!(doc.remove_layer(7), Err(DocumentError::NoSuchLayer));
    }

    #[test]
    fn removing_keeps_a_sensible_active_layer() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        doc.add_layer(); // 1
        doc.add_layer(); // 2, active
        doc.remove_layer(2).unwrap();
        assert_eq!(doc.active_index(), 1, "the top went, so the one below is active");

        doc.add_layer(); // index 2 again, active
        doc.remove_layer(0).unwrap();
        assert_eq!(doc.active_index(), 1, "a layer below slid out, the active one follows it down");
        assert_eq!(doc.active_layer().name, "Layer 4");
    }

    #[test]
    fn move_layer_keeps_the_active_layer() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        doc.add_layer(); // Layer 2, active at index 1
        doc.add_layer(); // Layer 3, active at index 2
        doc.set_active(1).unwrap();
        doc.move_layer_to(1, 0, Drop::Below).unwrap();
        assert_eq!(names(&doc), vec!["Layer 2", "Background", "Layer 3"]);
        assert_eq!(doc.active_layer().name, "Layer 2");
        assert_eq!(doc.active_index(), 0);
        assert_eq!(doc.move_layer_to(0, 9, Drop::Above), Err(DocumentError::NoSuchLayer));
    }

    #[test]
    fn resizing_the_canvas_moves_every_layer_together() {
        let mut d = Document::new(4, 4, Rgba::WHITE);
        d.add_layer();
        d.active_layer_mut().raster.set(0, 0, Rgba::BLACK);
        d.resize_canvas(6, 4, 2, 0);
        assert_eq!(d.width(), 6);
        assert_eq!(d.height(), 4);
        assert_eq!(d.layer(0).unwrap().raster.get(2, 0), Rgba::WHITE, "the background moved");
        assert_eq!(d.layer(1).unwrap().raster.get(2, 0), Rgba::BLACK, "and so did the layer above");
        assert_eq!(d.layer(0).unwrap().raster.get(0, 0), Rgba::TRANSPARENT, "new space is empty");
    }

    #[test]
    fn a_layer_blends_through_its_mode() {
        let mut doc = Document::new(1, 1, Rgba::opaque(128, 128, 128));
        doc.add_layer();
        doc.active_layer_mut().raster.set(0, 0, Rgba::opaque(128, 128, 128));
        doc.active_layer_mut().blend = BlendMode::Multiply;
        assert!((doc.composite().get(0, 0).r as i32 - 64).abs() <= 1);
        doc.active_layer_mut().blend = BlendMode::Screen;
        assert!((doc.composite().get(0, 0).r as i32 - 192).abs() <= 1);
        // An adjustment layer's mode blends its result back over the original.
        doc.add_adjustment_layer(Adjustment::from(Kind::Invert), None);
        doc.active_layer_mut().blend = BlendMode::Darken;
        let r = doc.composite().get(0, 0).r;
        assert!((r as i32 - 63).abs() <= 2, "inverted 192 is 63, which is the darker: {r}");
    }

    #[test]
    fn a_placed_layer_lands_where_it_is_told_at_its_own_size() {
        let mut doc = Document::new(4, 4, Rgba::TRANSPARENT);
        let i = doc.add_layer_placed("cat", &Raster::filled(2, 2, RED), 3, 3);
        assert_eq!(doc.layer(i).unwrap().name, "cat");
        assert_eq!(doc.composite().get(3, 3), RED);
        assert_eq!(doc.composite().get(2, 2).a, 0);
    }

    #[test]
    fn resampling_scales_every_layer_and_the_placement_of_a_smart_object() {
        let mut doc = Document::new(4, 4, Rgba::WHITE);
        doc.add_layer();
        doc.active_layer_mut().raster.set(0, 0, RED);
        doc.add_mask(1, Some(white_mask_with_black_at(4, 4, 3, 3)), false).unwrap();
        doc.place_smart_object("p", Raster::filled(2, 2, Rgba::BLACK));
        doc.resample(8, 8);
        assert_eq!((doc.width(), doc.height()), (8, 8));
        assert_eq!(doc.layer(0).unwrap().raster.get(7, 7), Rgba::WHITE);
        assert_eq!(doc.layer(1).unwrap().raster.get(0, 0), RED, "the red pixel grew");
        assert_eq!(doc.layer(1).unwrap().mask.as_ref().unwrap().get(7, 7), Rgba::BLACK, "and so did the mask's hole");
        let smart = doc.layer(2).unwrap();
        assert_eq!(smart.raster.get(4, 4), Rgba::BLACK, "the object scaled with the canvas");
        assert_eq!(smart.smart_object().unwrap().source.width(), 2, "from its untouched source");
        assert_eq!((smart.raster.width(), smart.raster.height()), (8, 8));
    }

    #[test]
    fn composite_stacks_bottom_to_top_and_skips_hidden() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        doc.add_layer();
        doc.active_layer_mut().raster.set(0, 0, RED);
        assert_eq!(doc.composite().get(0, 0), RED);

        doc.active_layer_mut().visible = false;
        assert_eq!(doc.composite().get(0, 0), Rgba::WHITE);

        doc.active_layer_mut().visible = true;
        doc.active_layer_mut().set_opacity(0.0);
        assert_eq!(doc.composite().get(0, 0), Rgba::WHITE);
    }

    #[test]
    fn transparent_background_composites_to_transparent() {
        let doc = Document::new(2, 2, Rgba::TRANSPARENT);
        assert!(doc.composite().pixels().iter().all(|p| p.a == 0));
    }

    #[test]
    fn add_layer_from_checks_the_size() {
        let mut doc = Document::new(2, 2, Rgba::WHITE);
        assert_eq!(
            doc.add_layer_from("photo", Raster::new(3, 3)),
            Err(DocumentError::SizeMismatch)
        );
        let index = doc.add_layer_from("photo", Raster::filled(2, 2, RED)).unwrap();
        assert_eq!(doc.layer(index).unwrap().name, "photo");
        assert_eq!(doc.composite().get(1, 1), RED);
    }

    #[test]
    fn duplicate_copies_pixels_and_properties() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        doc.add_layer();
        doc.active_layer_mut().raster.set(0, 0, RED);
        doc.active_layer_mut().set_opacity(0.5);
        let copy = doc.duplicate_layer(1).unwrap();
        assert_eq!(copy, 2);
        assert_eq!(doc.active_index(), 2);
        assert_eq!(doc.layer(2).unwrap().name, "Layer 2 copy");
        assert_eq!(doc.layer(2).unwrap().opacity, 0.5);
        assert_eq!(doc.layer(2).unwrap().raster.get(0, 0), RED);
        assert_ne!(doc.layer(2).unwrap().id(), doc.layer(1).unwrap().id());
    }

    #[test]
    fn merge_down_flattens_two_layers_into_one() {
        let mut doc = Document::new(2, 1, Rgba::WHITE);
        doc.add_layer();
        doc.active_layer_mut().raster.set(0, 0, RED);
        assert_eq!(doc.merge_down(0), Err(DocumentError::NothingBelow));
        doc.merge_down(1).unwrap();
        assert_eq!(names(&doc), vec!["Background"]);
        assert_eq!(doc.active_index(), 0);
        assert_eq!(doc.layer(0).unwrap().raster.get(0, 0), RED);
        assert_eq!(doc.layer(0).unwrap().raster.get(1, 0), Rgba::WHITE);
    }

    #[test]
    fn flatten_leaves_one_layer_with_the_composite() {
        let mut doc = Document::new(2, 1, Rgba::WHITE);
        doc.add_layer();
        doc.active_layer_mut().raster.set(0, 0, RED);
        doc.add_layer();
        doc.active_layer_mut().visible = false;
        doc.active_layer_mut().raster.set(1, 0, RED);
        doc.flatten();
        assert_eq!(names(&doc), vec!["Background"]);
        assert_eq!(doc.layer(0).unwrap().raster.get(0, 0), RED);
        assert_eq!(doc.layer(0).unwrap().raster.get(1, 0), Rgba::WHITE, "hidden layers are dropped");
    }

    #[test]
    fn layer_via_copy_takes_the_clip() {
        let mut doc = Document::new(3, 1, Rgba::WHITE);
        let i = doc.layer_via_copy(crate::geometry::Rect::new(1, 0, 1, 1));
        assert_eq!(i, 1);
        assert_eq!(doc.layer(1).unwrap().name, "Background copy");
        assert_eq!(doc.layer(1).unwrap().raster.get(1, 0), Rgba::WHITE);
        assert_eq!(doc.layer(1).unwrap().raster.get(0, 0), Rgba::TRANSPARENT);
        assert_eq!(doc.layer(0).unwrap().raster.get(1, 0), Rgba::WHITE, "the source is untouched");
    }

    #[test]
    fn layer_via_copy_of_an_adjustment_layer_is_an_empty_pixel_layer() {
        let mut doc = Document::new(3, 2, Rgba::WHITE);
        doc.add_adjustment_layer(Adjustment::from(Kind::Invert), None);
        let i = doc.layer_via_copy(doc.bounds());
        let layer = doc.layer(i).unwrap();
        assert_eq!(layer.kind, LayerKind::Pixels);
        assert_eq!((layer.raster.width(), layer.raster.height()), (3, 2), "document-sized, so it can be painted");
    }

    #[test]
    fn rotating_the_canvas_swaps_the_size() {
        let mut doc = Document::new(3, 2, Rgba::WHITE);
        doc.add_layer();
        doc.active_layer_mut().raster.set(0, 0, RED);
        doc.rotate_canvas(1);
        assert_eq!((doc.width(), doc.height()), (2, 3));
        assert_eq!(doc.composite().get(1, 0), RED);
        doc.rotate_canvas(-1);
        assert_eq!((doc.width(), doc.height()), (3, 2));
        assert_eq!(doc.composite().get(0, 0), RED);
    }

    #[test]
    fn flipping_the_canvas_flips_every_layer() {
        let mut doc = Document::new(3, 2, Rgba::WHITE);
        doc.add_layer();
        doc.active_layer_mut().raster.set(0, 0, RED);
        doc.flip_canvas_horizontal();
        assert_eq!(doc.composite().get(2, 0), RED);
        doc.flip_canvas_vertical();
        assert_eq!(doc.composite().get(2, 1), RED);
    }

    fn white_mask_with_black_at(w: u32, h: u32, x: i32, y: i32) -> Mask {
        Mask::from_fn(w, h, |px, py| if (px, py) == (x, y) { 0 } else { 255 })
    }

    #[test]
    fn a_mask_hides_part_of_a_layer_until_it_is_disabled_or_removed() {
        let mut doc = Document::new(2, 1, Rgba::WHITE);
        doc.add_layer();
        doc.active_layer_mut().raster = Raster::filled(2, 1, RED);
        doc.add_mask(1, Some(white_mask_with_black_at(2, 1, 1, 0)), false).unwrap();
        assert!(doc.active_layer().editing_mask(), "a new mask becomes the target");
        assert_eq!(doc.composite().get(0, 0), RED);
        assert_eq!(doc.composite().get(1, 0), Rgba::WHITE, "masked out, the background shows");

        doc.set_mask_enabled(1, false).unwrap();
        assert_eq!(doc.composite().get(1, 0), RED);
        doc.set_mask_enabled(1, true).unwrap();

        doc.add_mask(1, Some(white_mask_with_black_at(2, 1, 1, 0)), true).unwrap();
        assert_eq!(doc.composite().get(1, 0), RED, "hide-selection inverts the shape");
        assert_eq!(doc.composite().get(0, 0), Rgba::WHITE);

        doc.remove_mask(1).unwrap();
        assert_eq!(doc.composite().get(0, 0), RED);
        assert_eq!(doc.remove_mask(1), Err(DocumentError::NoMask));
        assert_eq!(doc.set_mask_enabled(1, false), Err(DocumentError::NoMask));
        assert_eq!(doc.set_target(1, Target::Mask), Err(DocumentError::NoMask));
    }

    /// The composite applies a layer's mask as it goes rather than building
    /// the masked copy first, which is the same picture — within the one
    /// rounding it saves, since coverage and opacity are now applied
    /// together instead of one after the other.
    #[test]
    fn compositing_through_a_mask_matches_masking_the_layer_first() {
        for (opacity, blend) in [(1.0, BlendMode::Normal), (0.5, BlendMode::Normal), (1.0, BlendMode::Multiply), (0.35, BlendMode::Screen)] {
            let mut doc = Document::new(4, 2, Rgba::opaque(30, 160, 200));
            doc.add_layer();
            for y in 0..2 {
                for x in 0..4 {
                    doc.active_layer_mut().raster.set(x, y, Rgba::new(220, 40, 90, 40 + (x as u8) * 60));
                }
            }
            // A mask with every interesting kind of pixel in it: white,
            // black, mid grey and a half-transparent one.
            let mut mask = Raster::filled(4, 2, Rgba::WHITE);
            mask.set(1, 0, Rgba::BLACK);
            mask.set(2, 0, Rgba::opaque(128, 128, 128));
            mask.set(3, 0, Rgba::new(0, 0, 0, 128));
            doc.layer_mut(1).unwrap().mask = Some(mask);
            doc.layer_mut(1).unwrap().set_opacity(opacity);
            doc.layer_mut(1).unwrap().blend = blend;

            let now = doc.composite();
            // The old way: mask the layer into a copy, then composite that.
            let mut then = Raster::new(4, 2);
            let all = then.bounds();
            then.composite_blend(&doc.layers()[0].raster, 1.0, BlendMode::Normal, &all);
            then.composite_blend(&doc.layers()[1].rendered(), opacity, blend, &all);
            for y in 0..2 {
                for x in 0..4 {
                    let (a, b) = (now.get(x, y), then.get(x, y));
                    let off = [(a.r, b.r), (a.g, b.g), (a.b, b.b), (a.a, b.a)].map(|(l, r)| i32::from(l) - i32::from(r));
                    assert!(off.iter().all(|d| d.abs() <= 1), "{opacity} {blend:?} at ({x},{y}): {a} vs {b}");
                }
            }
        }
    }

    #[test]
    fn applying_a_mask_bakes_it_and_merge_down_bakes_both() {
        let mut doc = Document::new(2, 1, Rgba::WHITE);
        doc.add_layer();
        doc.active_layer_mut().raster = Raster::filled(2, 1, RED);
        doc.add_mask(1, Some(white_mask_with_black_at(2, 1, 1, 0)), false).unwrap();
        doc.apply_mask(1).unwrap();
        assert!(doc.active_layer().mask.is_none());
        assert_eq!(doc.active_layer().raster.get(1, 0).a, 0);
        assert_eq!(doc.apply_mask(1), Err(DocumentError::NoMask));

        doc.add_mask(0, Some(white_mask_with_black_at(2, 1, 0, 0)), false).unwrap();
        doc.add_mask(1, Some(white_mask_with_black_at(2, 1, 0, 0)), false).unwrap();
        doc.merge_down(1).unwrap();
        assert_eq!(names(&doc), vec!["Background"]);
        assert!(doc.layer(0).unwrap().mask.is_none());
        assert_eq!(doc.layer(0).unwrap().raster.get(0, 0).a, 0, "both masks hid this pixel");
        assert_eq!(doc.layer(0).unwrap().raster.get(1, 0), Rgba::WHITE);
    }

    #[test]
    fn an_adjustment_layer_adjusts_everything_below_through_its_mask() {
        let mut doc = Document::new(2, 1, Rgba::WHITE);
        let i = doc.add_adjustment_layer(Adjustment::from(Kind::Invert), None);
        assert_eq!(i, 1);
        assert_eq!(doc.layer(1).unwrap().name, "Invert 2");
        assert!(doc.active_layer().editing_mask());
        assert_eq!(doc.composite().get(0, 0), Rgba::BLACK);

        // Paint black on the mask: the adjustment stops there.
        doc.active_surface_mut().set(1, 0, Rgba::BLACK);
        assert_eq!(doc.composite().get(1, 0), Rgba::WHITE);
        assert_eq!(doc.composite().get(0, 0), Rgba::BLACK);

        // Half opacity is half the adjustment.
        doc.active_layer_mut().set_opacity(0.5);
        assert_eq!(doc.composite().get(0, 0).r, 128);

        // Above it, a pixel layer is not adjusted; below it, a new one is.
        doc.active_layer_mut().set_opacity(1.0);
        doc.add_layer();
        doc.active_layer_mut().raster.set(0, 0, RED);
        assert_eq!(doc.composite().get(0, 0), RED);
        doc.set_active(0).unwrap();
        doc.add_layer();
        doc.active_layer_mut().raster.set(1, 0, RED);
        assert_eq!(doc.composite().get(1, 0), RED, "under the black part of the mask");
        doc.active_layer_mut().raster.set(0, 0, RED);
        doc.set_active(3).unwrap();
        doc.active_layer_mut().visible = false;
        assert_eq!(doc.composite().get(0, 0), Rgba::opaque(0, 255, 255), "inverted red");

        // A hidden adjustment layer does nothing.
        doc.set_active(2).unwrap();
        doc.active_layer_mut().visible = false;
        assert_eq!(doc.composite().get(0, 0), RED);
    }

    #[test]
    fn an_adjustment_layer_made_with_a_selection_takes_it_as_its_mask() {
        let mut doc = Document::new(2, 1, Rgba::WHITE);
        doc.add_adjustment_layer(Adjustment::from(Kind::Invert), Some(white_mask_with_black_at(2, 1, 1, 0)));
        assert_eq!(doc.composite().get(0, 0), Rgba::BLACK);
        assert_eq!(doc.composite().get(1, 0), Rgba::WHITE);
        let levels = Adjustment::from_params("levels", &[0.0, 255.0, 1.0]).unwrap();
        doc.set_adjustment(1, levels.clone()).unwrap();
        assert_eq!(doc.active_layer().adjustment(), Some(levels.clone()));
        assert_eq!(doc.set_adjustment(0, levels), Err(DocumentError::WrongKind));
    }

    #[test]
    fn merging_an_adjustment_layer_down_bakes_it_and_nothing_merges_into_one() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        doc.add_adjustment_layer(Adjustment::from(Kind::Invert), None);
        doc.merge_down(1).unwrap();
        assert_eq!(names(&doc), vec!["Background"]);
        assert_eq!(doc.layer(0).unwrap().raster.get(0, 0), Rgba::BLACK);

        doc.add_adjustment_layer(Adjustment::from(Kind::Invert), None);
        doc.add_layer();
        assert_eq!(doc.merge_down(2), Err(DocumentError::CannotMergeInto));
        doc.set_active(0).unwrap();
        doc.place_smart_object("p", Raster::filled(1, 1, RED));
        doc.add_layer();
        assert_eq!(doc.merge_down(2), Err(DocumentError::CannotMergeInto));
        doc.rasterize_layer(1).unwrap();
        doc.merge_down(2).unwrap();
    }

    #[test]
    fn a_smart_object_converts_rasterizes_and_replaces() {
        let mut doc = Document::new(4, 4, Rgba::TRANSPARENT);
        assert_eq!(doc.convert_to_smart_object(0), Ok(()), "an empty layer converts to a 1x1 object");
        doc.rasterize_layer(0).unwrap();
        doc.active_layer_mut().raster.set(2, 1, RED);
        doc.convert_to_smart_object(0).unwrap();
        let object = doc.active_layer().smart_object().unwrap();
        assert_eq!((object.source.width(), object.source.height()), (1, 1), "cropped to what is painted");
        assert_eq!(doc.composite().get(2, 1), RED, "and it looks the same");
        doc.convert_to_smart_object(0).unwrap();
        assert!(doc.active_layer().is_smart(), "converting twice is harmless");

        doc.replace_smart_contents(0, Raster::filled(2, 2, Rgba::BLACK)).unwrap();
        assert_eq!(doc.composite().get(2, 1), Rgba::BLACK, "a bigger picture is scaled into the old box");
        assert_eq!(doc.composite().get(3, 1).a, 0);

        doc.rasterize_layer(0).unwrap();
        assert!(!doc.active_layer().is_smart());
        assert_eq!(doc.rasterize_layer(0), Err(DocumentError::WrongKind));
        assert_eq!(doc.replace_smart_contents(0, Raster::new(1, 1)), Err(DocumentError::WrongKind));
        doc.add_adjustment_layer(Adjustment::from(Kind::Invert), None);
        assert_eq!(doc.convert_to_smart_object(1), Err(DocumentError::WrongKind));
    }

    /// Whatever the canvas does, a smart object must end up exactly where
    /// the same pixels would have — its placement turns and shifts with the
    /// canvas instead of being resampled.
    #[test]
    fn canvas_operations_carry_smart_objects_and_masks_along() {
        let mut picture = Raster::new(3, 2);
        picture.set(0, 0, RED);
        picture.set(2, 1, Rgba::BLACK);
        let mut doc = Document::new(5, 4, Rgba::TRANSPARENT);
        doc.add_layer();
        doc.active_layer_mut().raster = picture.resized(5, 4, 1, 1);
        doc.add_mask(1, Some(white_mask_with_black_at(5, 4, 3, 2)), false).unwrap();
        doc.set_active(0).unwrap();
        doc.place_smart_object("p", picture.clone());
        doc.set_smart_transform(1, Affine::translation(1.0, 1.0).into()).unwrap();
        doc.add_mask(1, Some(white_mask_with_black_at(5, 4, 3, 2)), false).unwrap();
        let same = |doc: &Document| {
            let pixels = doc.layer(2).unwrap();
            let smart = doc.layer(1).unwrap();
            assert_eq!(smart.raster, pixels.raster, "smart raster differs");
            assert_eq!(smart.mask, pixels.mask, "masks differ");
        };
        same(&doc);
        for turns in [1, 1, 1, 1, -1, 2] {
            doc.rotate_canvas(turns);
            same(&doc);
        }
        doc.flip_canvas_horizontal();
        same(&doc);
        doc.flip_canvas_vertical();
        same(&doc);
        doc.resize_canvas(8, 7, 2, 1);
        same(&doc);
        doc.resize_canvas(4, 4, -1, -1);
        same(&doc);
        assert!(doc.composite().pixels().contains(&RED), "the picture survived the round trip");
    }

    #[test]
    fn duplicating_keeps_the_kind_and_the_mask() {
        let mut doc = Document::new(2, 2, Rgba::WHITE);
        doc.add_adjustment_layer(Adjustment::from(Kind::Invert), None);
        doc.active_layer_mut().set_opacity(0.5);
        let copy = doc.duplicate_layer(1).unwrap();
        let layer = doc.layer(copy).unwrap();
        assert!(layer.is_adjustment());
        assert!(layer.mask.is_some());
        assert_eq!(layer.opacity, 0.5);
        assert_eq!(layer.name, "Invert 2 copy");
        assert_ne!(layer.id(), doc.layer(1).unwrap().id());
    }

    #[test]
    fn merging_a_hidden_layer_just_drops_it() {
        let mut doc = Document::new(1, 1, Rgba::WHITE);
        doc.add_layer();
        doc.active_layer_mut().raster.set(0, 0, RED);
        doc.active_layer_mut().visible = false;
        doc.merge_down(1).unwrap();
        assert_eq!(doc.composite().get(0, 0), Rgba::WHITE);
    }

    // ---- Clipping masks ------------------------------------------------------

    /// `Base` with red down the left half of a transparent canvas, and
    /// `Over` covering the whole canvas in blue.
    fn clipping_pair() -> Document {
        let mut doc = Document::new(4, 2, Rgba::TRANSPARENT);
        doc.layers[0].name = "Base".to_owned();
        for y in 0..2 {
            for x in 0..2 {
                doc.layers[0].raster.set(x, y, RED);
            }
        }
        let over = doc.add_layer();
        doc.layers[over].name = "Over".to_owned();
        doc.layers[over].raster = Raster::filled(4, 2, BLUE);
        doc.layers[over].clipped = true;
        doc
    }

    #[test]
    fn a_clipped_layer_only_shows_where_its_base_does() {
        let doc = clipping_pair();
        let out = doc.composite();
        assert_eq!(out.get(0, 0), BLUE, "over the base, the clipped layer covers it");
        assert_eq!(out.get(3, 0), Rgba::TRANSPARENT, "past the base, nothing of it shows");
        assert_eq!(doc.clip_base(1), Some(0));
        assert!(!doc.can_clip(0), "the bottom layer has nothing under it");
    }

    /// The base carries the group: its opacity and blend mode apply to the
    /// clipped layers too, which is why they are not applied while it draws.
    #[test]
    fn the_base_opacity_carries_the_whole_clipping_group() {
        let mut doc = clipping_pair();
        doc.layers[0].set_opacity(0.5);
        let out = doc.composite();
        assert_eq!(out.get(0, 0).a, 128, "half of the group, not a fully covered base");
        assert_eq!(out.get(0, 0).b, 255, "and what shows is the clipped layer");
    }

    #[test]
    fn a_hidden_or_masked_base_takes_the_clipped_layer_with_it() {
        let mut doc = clipping_pair();
        doc.layers[0].visible = false;
        assert_eq!(doc.composite().get(0, 0), Rgba::TRANSPARENT, "nothing left to clip to");

        doc.layers[0].visible = true;
        // A mask that hides the left column: the group is clipped to what
        // the base shows, not to the pixels behind its mask.
        doc.add_mask(0, Some(Mask::from_rect(4, 2, Rect::new(1, 0, 3, 2))), false).unwrap();
        let out = doc.composite();
        assert_eq!(out.get(0, 0), Rgba::TRANSPARENT, "the base's mask clips the group too");
        assert_eq!(out.get(1, 0), BLUE);
    }

    /// The run of clipped layers all clip to the same base, and the cut the
    /// editing session makes in the stack never falls inside that run.
    #[test]
    fn a_run_of_clipped_layers_shares_one_base_and_is_never_split() {
        let mut doc = clipping_pair();
        let third = doc.add_layer();
        doc.layers[third].raster = Raster::filled(4, 2, Rgba::opaque(0, 255, 0));
        doc.layers[third].clipped = true;
        assert_eq!(doc.clip_base(2), Some(0), "past the layer between, to the base");
        let out = doc.composite();
        assert_eq!(out.get(0, 0), Rgba::opaque(0, 255, 0));
        assert_eq!(out.get(3, 0), Rgba::TRANSPARENT);
        for i in 0..3 {
            assert_eq!(doc.split_point(i), 0, "the group is drawn whole");
        }
    }

    #[test]
    fn nothing_clips_to_an_adjustment_layer() {
        let mut doc = Document::new(4, 2, Rgba::WHITE);
        doc.add_adjustment_layer(Adjustment::from_params("invert", &[]).unwrap(), None);
        let over = doc.add_layer();
        doc.layers[over].raster = Raster::filled(4, 2, BLUE);
        doc.layers[over].clipped = true;
        assert!(!doc.can_clip(over), "an adjustment layer has no alpha to clip to");
        assert_eq!(doc.clip_base(over), None);
        let out = doc.composite();
        assert_eq!(out.get(0, 0), BLUE, "the flag does nothing, rather than hiding the layer");
        assert!(!doc.can_clip(1), "and an adjustment layer is never clipped itself");
    }

    /// A group can be the base, and clipping is kept between siblings: a
    /// layer at the bottom of a group does not reach out of it.
    #[test]
    fn clipping_does_not_reach_out_of_a_group() {
        let doc = grouped();
        assert_eq!(names(&doc), ["Background", "Inner", "Folder", "Top"]);
        assert!(!doc.can_clip(1), "Inner is the bottom of Folder");
        assert!(doc.can_clip(3), "Top sits over the whole folder");
    }
}

#[cfg(test)]
mod text_tests {
    use super::*;
    use crate::text::{TextAlign, TextStyle};

    const RED: Rgba = Rgba::opaque(255, 0, 0);

    fn hello() -> TextObject {
        let mut t = TextObject::empty(TextStyle::default(), RED);
        t.text = "Hello".to_owned();
        t.origin = Point::new(1.0, 1.0);
        t
    }

    #[test]
    fn a_text_layer_is_added_above_the_active_one_at_the_click() {
        let mut doc = Document::new(20, 20, Rgba::WHITE);
        // A 6x4 rendering with 1 of padding: the block is 4x2 at (10, 5).
        let index = doc.add_text_layer(hello(), Raster::filled(6, 4, RED), Point::new(10.0, 5.0));
        assert_eq!(index, 1);
        assert_eq!(doc.active_index(), 1);
        let layer = doc.active_layer();
        assert_eq!(layer.kind.name(), "text");
        assert_eq!(layer.name, "Hello");
        assert_eq!(layer.raster.get(9, 4), RED, "the padding lands a pixel up and left of the click");
        assert_eq!(layer.raster.get(14, 7), RED);
        assert_eq!(layer.raster.get(15, 8).a, 0);

        assert_eq!(doc.text_layer_at(Point::new(12.0, 6.0)), Some(1));
        assert_eq!(doc.text_layer_at(Point::new(9.5, 4.5)), Some(1), "anywhere in its box, padding included");
        assert_eq!(doc.text_layer_at(Point::new(2.0, 2.0)), None);
        doc.layer_mut(1).unwrap().visible = false;
        assert_eq!(doc.text_layer_at(Point::new(12.0, 6.0)), None, "a hidden one is not clickable");
    }

    #[test]
    fn the_topmost_text_layer_under_the_point_wins() {
        let mut doc = Document::new(20, 20, Rgba::WHITE);
        doc.add_text_layer(hello(), Raster::filled(6, 4, RED), Point::new(5.0, 5.0));
        doc.add_text_layer(hello(), Raster::filled(6, 4, RED), Point::new(7.0, 5.0));
        assert_eq!(doc.text_layer_at(Point::new(8.0, 6.0)), Some(2));
        assert_eq!(doc.text_layer_at(Point::new(4.5, 6.0)), Some(1));
        doc.move_layer_to(2, 1, Drop::Below).unwrap();
        assert_eq!(doc.text_layer_at(Point::new(8.0, 6.0)), Some(2), "order in the stack, not age");
    }

    #[test]
    fn setting_the_text_renames_and_re_renders_and_only_works_on_text() {
        let mut doc = Document::new(20, 20, Rgba::WHITE);
        let index = doc.add_text_layer(hello(), Raster::filled(6, 4, RED), Point::new(10.0, 5.0));
        let mut t = hello();
        t.text = "Hi".to_owned();
        t.style.align = TextAlign::Right;
        doc.set_text(index, t, Raster::filled(4, 4, Rgba::BLACK)).unwrap();
        let layer = doc.layer(index).unwrap();
        assert_eq!(layer.name, "Hi");
        assert_eq!(layer.raster.get(10, 5), Rgba::BLACK, "narrower, left edge kept: the old text was left-aligned");
        assert_eq!(layer.raster.get(13, 7).a, 0);
        assert_eq!(doc.set_text(0, hello(), Raster::new(1, 1)), Err(DocumentError::WrongKind));
        assert_eq!(doc.set_text(9, hello(), Raster::new(1, 1)), Err(DocumentError::NoSuchLayer));

        doc.replace_smart_contents(index, Raster::filled(2, 2, RED)).unwrap();
        assert_eq!(doc.layer(index).unwrap().kind.name(), "smart", "replaced contents are no longer text");
        doc.rasterize_layer(index).unwrap();
        assert_eq!(doc.layer(index).unwrap().kind.name(), "pixels");
    }

}
