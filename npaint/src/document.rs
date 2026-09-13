//! The layer stack.
//!
//! Layers are stored bottom-first, the way they are composited: index 0 is the
//! bottom of the stack. The page reverses the order for display so the top
//! layer is at the top of the panel, as in every layer-based editor.

use crate::color::Rgba;
use crate::layer::{BlendMode, Layer, LayerId};
use crate::raster::Raster;

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
}

impl std::fmt::Display for DocumentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            DocumentError::NoSuchLayer => "no such layer",
            DocumentError::LastLayer => "a document needs at least one layer",
            DocumentError::SizeMismatch => "the image is not the document's size",
            DocumentError::NothingBelow => "there is no layer below to merge into",
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

    pub fn bounds(&self) -> crate::geometry::Rect {
        crate::geometry::Rect::new(0, 0, self.width as i32, self.height as i32)
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
        let index = self.active + 1;
        self.layers.insert(index, Layer::new(id, name, raster));
        self.active = index;
        index
    }

    /// Copies a layer, placing the copy directly above it and making it active.
    pub fn duplicate_layer(&mut self, index: usize) -> Result<usize, DocumentError> {
        let source = self.layers.get(index).ok_or(DocumentError::NoSuchLayer)?.clone();
        let id = self.take_id();
        let mut copy = Layer::new(id, format!("{} copy", source.name), source.raster);
        copy.visible = source.visible;
        copy.opacity = source.opacity;
        copy.blend = source.blend;
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
    /// The result keeps the lower layer's identity and name.
    pub fn merge_down(&mut self, index: usize) -> Result<(), DocumentError> {
        if index >= self.layers.len() {
            return Err(DocumentError::NoSuchLayer);
        }
        if index == 0 {
            return Err(DocumentError::NothingBelow);
        }
        let top = self.layers.remove(index);
        let below = &mut self.layers[index - 1];
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
    pub fn layer_via_copy(&mut self, clip: crate::geometry::Rect) -> usize {
        let (inside, _) = self.active_layer().raster.split(&clip);
        let name = format!("{} copy", self.active_layer().name);
        self.insert_layer_above_active(inside, Some(&name))
    }

    /// Rotates the whole canvas, every layer, by quarter turns clockwise.
    /// Odd turns swap the document's width and height.
    pub fn rotate_canvas(&mut self, turns: i32) {
        for layer in &mut self.layers {
            layer.raster = layer.raster.rotated_quarter(turns);
        }
        if turns.rem_euclid(2) == 1 {
            std::mem::swap(&mut self.width, &mut self.height);
        }
    }

    /// Resizes the canvas, keeping the existing pixels at `(dx, dy)` in the
    /// new one. Every layer is document-sized, so they all move together.
    pub fn resize_canvas(&mut self, width: u32, height: u32, dx: i32, dy: i32) {
        let (width, height) = (width.max(1), height.max(1));
        for layer in &mut self.layers {
            layer.raster = layer.raster.resized(width, height, dx, dy);
        }
        self.width = width;
        self.height = height;
    }

    pub fn flip_canvas_horizontal(&mut self) {
        for layer in &mut self.layers {
            layer.raster = layer.raster.flipped_horizontal();
        }
    }

    pub fn flip_canvas_vertical(&mut self) {
        for layer in &mut self.layers {
            layer.raster = layer.raster.flipped_vertical();
        }
    }

    fn blend_layer(dst: &mut Raster, layer: &Layer) {
        match layer.blend {
            BlendMode::Normal => dst.composite_over(&layer.raster, layer.opacity),
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
        *out = Raster::new(self.width, self.height);
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
