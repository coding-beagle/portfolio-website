//! The layer stack.
//!
//! Layers are stored bottom-first, the way they are composited: index 0 is the
//! bottom of the stack. The page reverses the order for display so the top
//! layer is at the top of the panel, as in every layer-based editor.

use crate::adjust::Adjustment;
use crate::color::Rgba;
use crate::geometry::Rect;
use crate::layer::{mask_raster, BlendMode, Layer, LayerId, LayerKind, SmartObject, Target};
use crate::mask::Mask;
use crate::raster::Raster;
use crate::transform::Affine;

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
        })
    }
}

impl std::error::Error for DocumentError {}

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

    pub fn layers(&self) -> &[Layer] {
        &self.layers
    }

    pub fn layer(&self, index: usize) -> Option<&Layer> {
        self.layers.get(index)
    }

    pub fn layer_mut(&mut self, index: usize) -> Option<&mut Layer> {
        self.layers.get_mut(index)
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

    /// Scales the whole document, every layer, to a new size — Image Size.
    /// A smart object's placement is scaled rather than its rendering, so
    /// it keeps re-rendering from its source.
    pub fn resample(&mut self, width: u32, height: u32) {
        let (width, height) = (width.max(1), height.max(1));
        let sx = f64::from(width) / f64::from(self.width.max(1));
        let sy = f64::from(height) / f64::from(self.height.max(1));
        let scale = Affine::scaling(sx, sy);
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

    fn insert_above_active(&mut self, layer: Layer) -> usize {
        let index = self.active + 1;
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
            LayerKind::Adjustment(_) => return Err(DocumentError::WrongKind),
            LayerKind::Pixels => {}
        }
        let bounds = layer.raster.content_bounds().unwrap_or(Rect::new(0, 0, 1, 1));
        let source = layer.raster.resized(bounds.w as u32, bounds.h as u32, -bounds.x, -bounds.y);
        let transform = Affine::translation(f64::from(bounds.x), f64::from(bounds.y));
        layer.kind = LayerKind::Smart(SmartObject { source, transform });
        Ok(())
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
    pub fn replace_smart_contents(&mut self, index: usize, source: Raster) -> Result<(), DocumentError> {
        let (width, height) = (self.width, self.height);
        let layer = self.layers.get_mut(index).ok_or(DocumentError::NoSuchLayer)?;
        let LayerKind::Smart(object) = &mut layer.kind else {
            return Err(DocumentError::WrongKind);
        };
        let sx = f64::from(object.source.width().max(1)) / f64::from(source.width().max(1));
        let sy = f64::from(object.source.height().max(1)) / f64::from(source.height().max(1));
        object.transform = object.transform.then(&Affine::scaling(sx, sy));
        object.source = source;
        layer.raster = object.render(width, height);
        Ok(())
    }

    /// Moves a smart object and re-renders it. Not an error on other kinds;
    /// it simply does nothing.
    pub fn set_smart_transform(&mut self, index: usize, transform: Affine) -> Result<(), DocumentError> {
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
    pub fn duplicate_layer(&mut self, index: usize) -> Result<usize, DocumentError> {
        if index >= self.layers.len() {
            return Err(DocumentError::NoSuchLayer);
        }
        let id = self.take_id();
        let mut copy = self.layers[index].with_id(id);
        copy.name = format!("{} copy", copy.name);
        self.layers.insert(index + 1, copy);
        self.active = index + 1;
        Ok(index + 1)
    }

    pub fn remove_layer(&mut self, index: usize) -> Result<(), DocumentError> {
        if index >= self.layers.len() {
            return Err(DocumentError::NoSuchLayer);
        }
        if self.layers.len() == 1 {
            return Err(DocumentError::LastLayer);
        }
        self.layers.remove(index);
        // Keep the active layer where it was, or the layer that has slid into
        // the slot if the active one went.
        if self.active > index || self.active >= self.layers.len() {
            self.active = self.active.saturating_sub(1).min(self.layers.len() - 1);
        }
        Ok(())
    }

    /// Moves a layer to another position in the stack. The active layer stays
    /// the same *layer*, wherever it ends up.
    pub fn move_layer(&mut self, from: usize, to: usize) -> Result<(), DocumentError> {
        if from >= self.layers.len() || to >= self.layers.len() {
            return Err(DocumentError::NoSuchLayer);
        }
        let active_id = self.active_layer().id();
        let layer = self.layers.remove(from);
        self.layers.insert(to, layer);
        self.active = self.index_of(active_id).expect("the active layer is still in the stack");
        Ok(())
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
        if index == 0 {
            return Err(DocumentError::NothingBelow);
        }
        if !matches!(self.layers[index - 1].kind, LayerKind::Pixels) {
            return Err(DocumentError::CannotMergeInto);
        }
        let top = self.layers.remove(index);
        let below = &mut self.layers[index - 1];
        below.apply_mask();
        if top.visible {
            Self::blend_layer(&mut below.raster, &top);
        }
        if self.active >= index {
            self.active = self.active.saturating_sub(1);
        }
        Ok(())
    }

    /// Replaces every layer with one, `Background`, holding the composite.
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
        let (w, h) = (f64::from(self.width), f64::from(self.height));
        // Where a point of the old canvas lands on the new one, so a smart
        // object's placement turns with the canvas rather than being
        // resampled.
        let turn = match turns.rem_euclid(4) {
            0 => Affine::IDENTITY,
            1 => Affine { a: 0.0, b: 1.0, c: -1.0, d: 0.0, e: h, f: 0.0 },
            2 => Affine { a: -1.0, b: 0.0, c: 0.0, d: -1.0, e: w, f: h },
            _ => Affine { a: 0.0, b: -1.0, c: 1.0, d: 0.0, e: 0.0, f: w },
        };
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
        let shift = Affine::translation(f64::from(dx), f64::from(dy));
        for layer in &mut self.layers {
            layer.map_rasters(|r| r.resized(width, height, dx, dy), |m| shift.then(m), width, height);
        }
        self.width = width;
        self.height = height;
    }

    pub fn flip_canvas_horizontal(&mut self) {
        let (width, height) = (self.width, self.height);
        let flip = Affine { a: -1.0, e: f64::from(width), ..Affine::IDENTITY };
        for layer in &mut self.layers {
            layer.map_rasters(Raster::flipped_horizontal, |m| flip.then(m), width, height);
        }
    }

    pub fn flip_canvas_vertical(&mut self) {
        let (width, height) = (self.width, self.height);
        let flip = Affine { d: -1.0, f: f64::from(height), ..Affine::IDENTITY };
        for layer in &mut self.layers {
            layer.map_rasters(Raster::flipped_vertical, |m| flip.then(m), width, height);
        }
    }

    /// Composites one layer onto `dst`, through its mask, opacity and blend
    /// mode. An adjustment layer has nothing of its own to draw: it adjusts
    /// what is already there, and its opacity and mask say how much of that
    /// shows; its blend mode blends the adjusted result back over the
    /// original, as in Photoshop.
    fn blend_layer(dst: &mut Raster, layer: &Layer) {
        match &layer.kind {
            LayerKind::Adjustment(adjustment) => {
                if layer.opacity <= 0.0 {
                    return;
                }
                let mut adjusted = dst.clone();
                adjustment.apply(&mut adjusted, &dst.bounds());
                for y in 0..dst.height() as i32 {
                    for x in 0..dst.width() as i32 {
                        let t = layer.opacity * f32::from(layer.mask_cover(x, y)) / 255.0;
                        if t <= 0.0 {
                            continue;
                        }
                        let was = dst.get(x, y);
                        let mut now = adjusted.get(x, y);
                        if layer.blend != BlendMode::Normal && was.a > 0 {
                            now = now.blend_over(was, layer.blend);
                        }
                        dst.set(x, y, if t >= 1.0 { now } else { was.lerp(now, t) });
                    }
                }
            }
            _ => dst.composite_blend(&layer.rendered(), layer.opacity, layer.blend),
        }
    }

    /// Flattens every visible layer, bottom to top, onto a transparent
    /// buffer. Hidden layers and layers at zero opacity contribute nothing.
    pub fn composite(&self) -> Raster {
        let mut out = Raster::new(self.width, self.height);
        self.composite_into(&mut out);
        out
    }

    /// [`Document::composite`] into an existing buffer, to avoid allocating a
    /// frame every redraw.
    pub fn composite_into(&self, out: &mut Raster) {
        // Reusing the buffer matters: at 6000x4500 a fresh one is 108 MB,
        // and this runs for every stroke update.
        if out.width() == self.width && out.height() == self.height {
            out.clear();
        } else {
            *out = Raster::new(self.width, self.height);
        }
        for layer in self.layers.iter().filter(|l| l.visible) {
            Self::blend_layer(out, layer);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: Rgba = Rgba::opaque(255, 0, 0);

    fn names(doc: &Document) -> Vec<&str> {
        doc.layers().iter().map(|l| l.name.as_str()).collect()
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
        doc.move_layer(1, 0).unwrap();
        assert_eq!(names(&doc), vec!["Layer 2", "Background", "Layer 3"]);
        assert_eq!(doc.active_layer().name, "Layer 2");
        assert_eq!(doc.active_index(), 0);
        assert_eq!(doc.move_layer(0, 9), Err(DocumentError::NoSuchLayer));
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
        doc.add_adjustment_layer(Adjustment::Invert, None);
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
        doc.add_adjustment_layer(Adjustment::Invert, None);
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
        let i = doc.add_adjustment_layer(Adjustment::Invert, None);
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
        doc.add_adjustment_layer(Adjustment::Invert, Some(white_mask_with_black_at(2, 1, 1, 0)));
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
        doc.add_adjustment_layer(Adjustment::Invert, None);
        doc.merge_down(1).unwrap();
        assert_eq!(names(&doc), vec!["Background"]);
        assert_eq!(doc.layer(0).unwrap().raster.get(0, 0), Rgba::BLACK);

        doc.add_adjustment_layer(Adjustment::Invert, None);
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
        doc.add_adjustment_layer(Adjustment::Invert, None);
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
        doc.set_smart_transform(1, Affine::translation(1.0, 1.0)).unwrap();
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
        doc.add_adjustment_layer(Adjustment::Invert, None);
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
}
