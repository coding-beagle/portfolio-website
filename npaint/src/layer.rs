//! One layer of a document: what it draws, how it is masked, and the
//! properties the layers panel shows.
//!
//! Three kinds of layer share the struct. A **pixel** layer is a raster and
//! nothing else. A **smart object** keeps its source picture at its own size
//! and a transform that places it in the document; `raster` is only what
//! that renders to, and every transform starts again from the source, so
//! scaling one down and back up loses nothing. An **adjustment** layer has no
//! pixels of its own: it applies an [`Adjustment`] to everything below it at
//! composite time, and its `raster` stays empty.
//!
//! Any layer may carry a **mask**: a second, grey raster the same size as
//! the document. White shows the layer, black hides it, and grey is in
//! between. It is a raster rather than a [`crate::mask::Mask`] so that every
//! tool, adjustment and transform the editor has already works on it — the
//! editor simply points them at the mask instead of the pixels while the
//! layer's [`Target`] is `Mask`.

use std::borrow::Cow;

use crate::adjust::Adjustment;
use crate::color::Rgba;
use crate::mask::Mask;
use crate::raster::Raster;
use crate::transform::Affine;

/// Identifies a layer for as long as the document lives, independent of its
/// position in the stack. The page keys its layer list on this so a reorder
/// does not rebuild every row.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct LayerId(pub u32);

/// How a layer combines with what is below it. Only `Normal` exists yet; the
/// enum is here so a second mode is an arm in [`Raster::composite_over`]'s
/// caller rather than a redesign.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum BlendMode {
    #[default]
    Normal,
}

/// A picture kept at its own size, placed in the document by a transform.
#[derive(Clone, Debug, PartialEq)]
pub struct SmartObject {
    pub source: Raster,
    /// Source pixel coordinates → document coordinates.
    pub transform: Affine,
}

impl SmartObject {
    /// The object as it lands on a document of the given size.
    pub fn render(&self, width: u32, height: u32) -> Raster {
        self.source.transformed_into(&self.transform, width, height)
    }

    /// The placement that fits `source` inside a `width` x `height` document
    /// without enlarging it, centred — what Place does.
    pub fn placed(source: Raster, width: u32, height: u32) -> SmartObject {
        let (sw, sh) = (f64::from(source.width().max(1)), f64::from(source.height().max(1)));
        let scale = (f64::from(width) / sw).min(f64::from(height) / sh).min(1.0);
        let dx = ((f64::from(width) - sw * scale) / 2.0).round();
        let dy = ((f64::from(height) - sh * scale) / 2.0).round();
        let transform = Affine::translation(dx, dy).then(&Affine::scaling(scale, scale));
        SmartObject { source, transform }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum LayerKind {
    Pixels,
    Adjustment(Adjustment),
    Smart(SmartObject),
}

impl LayerKind {
    pub fn name(&self) -> &'static str {
        match self {
            LayerKind::Pixels => "pixels",
            LayerKind::Adjustment(_) => "adjustment",
            LayerKind::Smart(_) => "smart",
        }
    }
}

/// Which of a layer's two rasters the tools are editing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Target {
    #[default]
    Pixels,
    Mask,
}

/// Why a layer's pixels cannot be painted on right now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditRefusal {
    /// A smart object's pixels are rendered from its source; rasterize it or
    /// paint on its mask.
    SmartObject,
    /// An adjustment layer has no pixels; only its mask can be painted.
    AdjustmentLayer,
}

impl std::fmt::Display for EditRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            EditRefusal::SmartObject => "a smart object cannot be painted on directly: rasterize it, or paint on its mask",
            EditRefusal::AdjustmentLayer => "an adjustment layer has no pixels: paint on its mask instead",
        })
    }
}

impl std::error::Error for EditRefusal {}

#[derive(Clone, Debug, PartialEq)]
pub struct Layer {
    id: LayerId,
    pub name: String,
    pub visible: bool,
    /// `0.0..=1.0`.
    pub opacity: f32,
    pub blend: BlendMode,
    pub kind: LayerKind,
    /// The pixels as they composite: painted directly for a pixel layer,
    /// rendered from the source for a smart object, empty for an adjustment.
    pub raster: Raster,
    /// The layer mask, a grey document-sized raster, if there is one.
    pub mask: Option<Raster>,
    /// A mask can be switched off without being thrown away.
    pub mask_enabled: bool,
    /// Which raster the tools edit. `Mask` means nothing without a mask.
    pub target: Target,
}

/// How much a mask pixel shows: its brightness, with anything transparent
/// counting as white. A fresh (transparent) raster is therefore a mask that
/// reveals everything, and erasing on a mask reveals rather than leaving a
/// hole.
pub fn mask_cover(p: Rgba) -> u8 {
    let lum = f32::from(crate::adjust::luminance(p));
    let a = f32::from(p.a) / 255.0;
    (lum * a + 255.0 * (1.0 - a)).round().clamp(0.0, 255.0) as u8
}

/// A grey raster from coverage: what a mask made from a selection looks like.
pub fn mask_raster(mask: &Mask) -> Raster {
    let mut out = Raster::new(mask.width(), mask.height());
    for y in 0..mask.height() as i32 {
        for x in 0..mask.width() as i32 {
            let v = mask.cover(x, y);
            out.set(x, y, Rgba::opaque(v, v, v));
        }
    }
    out
}

impl Layer {
    pub fn new(id: LayerId, name: impl Into<String>, raster: Raster) -> Layer {
        Layer {
            id,
            name: name.into(),
            visible: true,
            opacity: 1.0,
            blend: BlendMode::Normal,
            kind: LayerKind::Pixels,
            raster,
            mask: None,
            mask_enabled: true,
            target: Target::Pixels,
        }
    }

    /// An adjustment layer. It starts with a mask — white, or the selection
    /// handed in — because a mask is the only thing on it that can be
    /// painted.
    pub fn new_adjustment(id: LayerId, name: impl Into<String>, adjustment: Adjustment, mask: Raster) -> Layer {
        let mut layer = Layer::new(id, name, Raster::new(0, 0));
        layer.kind = LayerKind::Adjustment(adjustment);
        layer.mask = Some(mask);
        layer.target = Target::Mask;
        layer
    }

    /// A smart object, rendered for a `width` x `height` document.
    pub fn new_smart(id: LayerId, name: impl Into<String>, object: SmartObject, width: u32, height: u32) -> Layer {
        let raster = object.render(width, height);
        let mut layer = Layer::new(id, name, raster);
        layer.kind = LayerKind::Smart(object);
        layer
    }

    pub fn id(&self) -> LayerId {
        self.id
    }

    /// The same layer under another id — a duplicate.
    pub fn with_id(&self, id: LayerId) -> Layer {
        Layer { id, ..self.clone() }
    }

    pub fn set_opacity(&mut self, opacity: f32) {
        self.opacity = opacity.clamp(0.0, 1.0);
    }

    pub fn is_adjustment(&self) -> bool {
        matches!(self.kind, LayerKind::Adjustment(_))
    }

    pub fn is_smart(&self) -> bool {
        matches!(self.kind, LayerKind::Smart(_))
    }

    pub fn adjustment(&self) -> Option<Adjustment> {
        match self.kind {
            LayerKind::Adjustment(a) => Some(a),
            _ => None,
        }
    }

    pub fn smart_object(&self) -> Option<&SmartObject> {
        match &self.kind {
            LayerKind::Smart(s) => Some(s),
            _ => None,
        }
    }

    /// Whether the tools are painting on the mask rather than the pixels.
    pub fn editing_mask(&self) -> bool {
        self.target == Target::Mask && self.mask.is_some()
    }

    /// The raster the tools edit: the mask while it is the target, else
    /// the pixels.
    pub fn surface(&self) -> &Raster {
        match (&self.target, &self.mask) {
            (Target::Mask, Some(mask)) => mask,
            _ => &self.raster,
        }
    }

    pub fn surface_mut(&mut self) -> &mut Raster {
        match (&self.target, &mut self.mask) {
            (Target::Mask, Some(mask)) => mask,
            _ => &mut self.raster,
        }
    }

    /// Why the current surface cannot be edited, if it cannot. A mask always
    /// can; the pixels of a smart object or an adjustment layer never can.
    pub fn edit_refusal(&self) -> Option<EditRefusal> {
        if self.editing_mask() {
            return None;
        }
        match self.kind {
            LayerKind::Pixels => None,
            LayerKind::Smart(_) => Some(EditRefusal::SmartObject),
            LayerKind::Adjustment(_) => Some(EditRefusal::AdjustmentLayer),
        }
    }

    /// Switches what the tools edit. Asking for the mask of a layer that has
    /// none leaves the target on the pixels.
    pub fn set_target(&mut self, target: Target) {
        self.target = if target == Target::Mask && self.mask.is_none() { Target::Pixels } else { target };
    }

    /// Gives the layer a mask and makes it the target, as adding one does
    /// in every editor.
    pub fn add_mask(&mut self, mask: Raster) {
        self.mask = Some(mask);
        self.mask_enabled = true;
        self.target = Target::Mask;
    }

    pub fn remove_mask(&mut self) -> Option<Raster> {
        self.target = Target::Pixels;
        self.mask.take()
    }

    /// How much of the pixel at `(x, y)` the mask lets through, `0..=255`.
    /// Everything, when there is no mask or it is switched off.
    pub fn mask_cover(&self, x: i32, y: i32) -> u8 {
        match &self.mask {
            Some(mask) if self.mask_enabled => mask_cover(mask.get(x, y)),
            _ => 255,
        }
    }

    /// The mask as coverage, for turning it into a selection.
    pub fn mask_as_selection(&self) -> Option<Mask> {
        let mask = self.mask.as_ref()?;
        Some(Mask::from_fn(mask.width(), mask.height(), |x, y| mask_cover(mask.get(x, y))))
    }

    /// The pixels as they composite: the raster with the mask applied to
    /// its alpha. Borrowed when there is no mask to apply.
    pub fn rendered(&self) -> Cow<'_, Raster> {
        match &self.mask {
            Some(mask) if self.mask_enabled => {
                let mut out = self.raster.clone();
                for y in 0..out.height() as i32 {
                    for x in 0..out.width() as i32 {
                        let cover = mask_cover(mask.get(x, y));
                        if cover < 255 {
                            let p = out.get(x, y);
                            out.set(x, y, p.scaled_alpha(f32::from(cover) / 255.0));
                        }
                    }
                }
                Cow::Owned(out)
            }
            _ => Cow::Borrowed(&self.raster),
        }
    }

    /// Bakes the mask into the pixels and drops it. A smart object is
    /// rasterized by it, since its source cannot carry a mask; an adjustment
    /// layer keeps its mask, having nothing to bake it into.
    pub fn apply_mask(&mut self) {
        if self.mask.is_none() || self.is_adjustment() {
            return;
        }
        self.raster = self.rendered().into_owned();
        self.kind = LayerKind::Pixels;
        self.remove_mask();
    }

    /// Turns a smart object into plain pixels: what it renders to now.
    /// Nothing to do for the other kinds.
    pub fn rasterize(&mut self) {
        if self.is_smart() {
            self.kind = LayerKind::Pixels;
        }
    }

    /// Applies the same raster operation to the pixels and the mask —
    /// what a canvas flip, rotation or resize does. An adjustment layer's
    /// empty raster is left empty, and a smart object is re-rendered from
    /// its source after `place` adjusts its transform, rather than being
    /// resampled twice.
    pub fn map_rasters(&mut self, f: impl Fn(&Raster) -> Raster, place: impl Fn(&Affine) -> Affine, width: u32, height: u32) {
        match &mut self.kind {
            LayerKind::Pixels => self.raster = f(&self.raster),
            LayerKind::Adjustment(_) => {}
            LayerKind::Smart(object) => {
                object.transform = place(&object.transform);
                self.raster = object.render(width, height);
            }
        }
        if let Some(mask) = &self.mask {
            self.mask = Some(f(mask));
        }
    }

    /// Moves a smart object's placement and re-renders it.
    pub fn set_smart_transform(&mut self, transform: Affine, width: u32, height: u32) {
        if let LayerKind::Smart(object) = &mut self.kind {
            object.transform = transform;
            self.raster = object.render(width, height);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: Rgba = Rgba::opaque(255, 0, 0);

    #[test]
    fn opacity_is_clamped() {
        let mut layer = Layer::new(LayerId(1), "a", Raster::new(1, 1));
        layer.set_opacity(3.0);
        assert_eq!(layer.opacity, 1.0);
        layer.set_opacity(-3.0);
        assert_eq!(layer.opacity, 0.0);
    }

    #[test]
    fn mask_cover_reads_brightness_and_treats_transparent_as_white() {
        assert_eq!(mask_cover(Rgba::WHITE), 255);
        assert_eq!(mask_cover(Rgba::BLACK), 0);
        assert_eq!(mask_cover(Rgba::TRANSPARENT), 255);
        assert_eq!(mask_cover(Rgba::new(0, 0, 0, 128)), 127, "half-erased black is half a mask");
        assert_eq!(mask_cover(Rgba::opaque(128, 128, 128)), 128);
    }

    #[test]
    fn the_surface_follows_the_target_only_when_there_is_a_mask() {
        let mut layer = Layer::new(LayerId(1), "a", Raster::filled(2, 2, RED));
        layer.set_target(Target::Mask);
        assert_eq!(layer.target, Target::Pixels, "no mask to edit");
        assert!(!layer.editing_mask());
        assert_eq!(layer.surface().get(0, 0), RED);

        layer.add_mask(Raster::filled(2, 2, Rgba::BLACK));
        assert!(layer.editing_mask());
        assert_eq!(layer.surface().get(0, 0), Rgba::BLACK);
        layer.surface_mut().set(0, 0, Rgba::WHITE);
        assert_eq!(layer.mask.as_ref().unwrap().get(0, 0), Rgba::WHITE);
        assert_eq!(layer.raster.get(0, 0), RED, "the pixels were not touched");

        layer.set_target(Target::Pixels);
        assert_eq!(layer.surface().get(0, 0), RED);
        layer.remove_mask();
        assert_eq!(layer.target, Target::Pixels);
        assert!(layer.mask.is_none());
    }

    #[test]
    fn rendered_applies_the_mask_unless_it_is_off() {
        let mut layer = Layer::new(LayerId(1), "a", Raster::filled(2, 1, RED));
        assert!(matches!(layer.rendered(), Cow::Borrowed(_)));
        let mut mask = Raster::filled(2, 1, Rgba::WHITE);
        mask.set(1, 0, Rgba::BLACK);
        layer.add_mask(mask);
        let shown = layer.rendered();
        assert_eq!(shown.get(0, 0), RED);
        assert_eq!(shown.get(1, 0).a, 0);
        layer.mask_enabled = false;
        assert_eq!(layer.rendered().get(1, 0), RED);
        assert_eq!(layer.mask_cover(1, 0), 255);
    }

    #[test]
    fn applying_a_mask_bakes_it_in() {
        let mut layer = Layer::new(LayerId(1), "a", Raster::filled(2, 1, RED));
        let mut mask = Raster::filled(2, 1, Rgba::WHITE);
        mask.set(1, 0, Rgba::BLACK);
        layer.add_mask(mask);
        layer.apply_mask();
        assert!(layer.mask.is_none());
        assert_eq!(layer.raster.get(0, 0), RED);
        assert_eq!(layer.raster.get(1, 0).a, 0);
    }

    #[test]
    fn a_mask_becomes_a_selection_and_a_selection_a_mask() {
        let mask = Mask::from_fn(3, 1, |x, _| if x == 1 { 255 } else { 0 });
        let raster = mask_raster(&mask);
        assert_eq!(raster.get(1, 0), Rgba::WHITE);
        assert_eq!(raster.get(0, 0), Rgba::BLACK);
        let mut layer = Layer::new(LayerId(1), "a", Raster::new(3, 1));
        layer.add_mask(raster);
        let back = layer.mask_as_selection().unwrap();
        assert!(back.contains(1, 0));
        assert!(!back.contains(0, 0));
    }

    #[test]
    fn only_pixel_layers_and_masks_can_be_painted() {
        let pixels = Layer::new(LayerId(1), "a", Raster::new(2, 2));
        assert_eq!(pixels.edit_refusal(), None);

        let adjustment = Layer::new_adjustment(LayerId(2), "levels", Adjustment::Invert, Raster::new(2, 2));
        assert!(adjustment.editing_mask(), "an adjustment layer starts on its mask");
        assert_eq!(adjustment.edit_refusal(), None);
        let mut on_pixels = adjustment.clone();
        on_pixels.set_target(Target::Pixels);
        assert_eq!(on_pixels.edit_refusal(), Some(EditRefusal::AdjustmentLayer));
        assert_eq!(on_pixels.raster.width(), 0, "and there are no pixels there anyway");

        let object = SmartObject { source: Raster::filled(1, 1, RED), transform: Affine::IDENTITY };
        let mut smart = Layer::new_smart(LayerId(3), "photo", object, 2, 2);
        assert_eq!(smart.edit_refusal(), Some(EditRefusal::SmartObject));
        assert_eq!(smart.raster.get(0, 0), RED, "rendered on creation");
        smart.rasterize();
        assert_eq!(smart.edit_refusal(), None);
        assert_eq!(smart.kind, LayerKind::Pixels);
    }

    #[test]
    fn placing_fits_and_centres_without_enlarging() {
        let object = SmartObject::placed(Raster::filled(4, 2, RED), 8, 8);
        let layer = Layer::new_smart(LayerId(1), "p", object, 8, 8);
        assert_eq!(layer.raster.get(2, 3), RED, "sits in the middle at its own size");
        assert_eq!(layer.raster.get(2, 2).a, 0);
        assert_eq!(layer.raster.get(6, 3).a, 0);

        let object = SmartObject::placed(Raster::filled(40, 20, RED), 8, 8);
        let (sx, sy) = object.transform.scale();
        assert!((sx - 0.2).abs() < 1e-9 && (sy - 0.2).abs() < 1e-9, "a big one is scaled to fit");
        let layer = Layer::new_smart(LayerId(1), "p", object, 8, 8);
        assert_eq!(layer.raster.get(4, 4), RED);
        assert_eq!(layer.raster.get(4, 0).a, 0);
    }

    #[test]
    fn a_smart_object_re_renders_from_its_source_when_moved() {
        let object = SmartObject { source: Raster::filled(1, 1, RED), transform: Affine::IDENTITY };
        let mut layer = Layer::new_smart(LayerId(1), "p", object, 4, 4);
        layer.set_smart_transform(Affine::translation(2.0, 2.0), 4, 4);
        assert_eq!(layer.raster.get(2, 2), RED);
        assert_eq!(layer.raster.get(0, 0).a, 0);
        assert_eq!(layer.smart_object().unwrap().source.get(0, 0), RED, "the source is untouched");
    }
}
