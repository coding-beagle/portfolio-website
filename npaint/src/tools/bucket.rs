//! The paint bucket: click, and the patch of colour under the pointer is
//! filled with the foreground colour.
//!
//! Finding the patch is the magic wand's job, with the same options —
//! tolerance, contiguous or global, sampling the active layer or every
//! layer, a soft edge — so a fill stops exactly where a wand selection
//! would. The fill itself lands at the brush opacity and is held to the
//! patch by blending back over the layer as it was, the same way a mask
//! selection holds any other edit.

use super::{Gesture, PointerEvent, Tool, ToolContext, ToolKind};
use crate::autoselect::wand;
use crate::geometry::Rect;

#[derive(Debug, Default)]
pub struct BucketTool {
    /// The patch the click filled, for [`Tool::dirtied`].
    filled: Option<Rect>,
}

impl Tool for BucketTool {
    fn kind(&self) -> ToolKind {
        ToolKind::Bucket
    }

    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        self.filled = None;
        let source = ctx.sample();
        let (x, y) = ev.pos.round();
        let clip = ctx.clip();
        if !clip.contains(x, y) {
            return Gesture::Passive;
        }
        let patch = wand(&source, (x, y), ctx.settings.tolerance, ctx.settings.sample_mode, ctx.settings.antialias);
        if patch.is_empty() {
            return Gesture::Passive;
        }
        let color = ctx.settings.color.scaled_alpha(ctx.settings.opacity);
        let layer = ctx.document.active_surface_mut();
        let base = layer.clone();
        let area = patch.bounds().intersect(&clip);
        layer.fill_rect(patch.bounds(), color, &clip);
        patch.apply(layer, &base, &area);
        self.filled = Some(area);
        Gesture::EditsActiveLayer
    }

    fn dirtied(&self) -> Option<Rect> {
        self.filled
    }

    fn update(&mut self, _ctx: &mut ToolContext, _ev: PointerEvent) -> bool {
        false
    }

    fn finish(&mut self, _ctx: &mut ToolContext, _ev: PointerEvent) -> bool {
        false
    }

    fn cancel(&mut self, _ctx: &mut ToolContext) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::Rgba;
    use crate::document::Document;
    use crate::geometry::Rect;
    use crate::selection::Selection;
    use crate::tools::ToolSettings;
    use crate::viewport::Viewport;

    const RED: Rgba = Rgba::opaque(255, 0, 0);
    const BLUE: Rgba = Rgba::opaque(0, 0, 255);

    /// White with a red square from (2,2) to (5,5).
    fn doc() -> Document {
        let mut doc = Document::new(10, 10, Rgba::WHITE);
        doc.active_layer_mut().raster.fill_rect(Rect::new(2, 2, 4, 4), RED, &Rect::new(0, 0, 10, 10));
        doc
    }

    fn fill(doc: &mut Document, sel: Selection, settings: ToolSettings, at: (f64, f64)) -> Gesture {
        let mut sel = sel;
        let mut settings = settings;
        let mut ctx = ToolContext { document: doc, selection: &mut sel, viewport: &mut Viewport::default(), settings: &mut settings };
        BucketTool::default().begin(&mut ctx, PointerEvent::at(at.0, at.1))
    }

    fn settings() -> ToolSettings {
        ToolSettings { color: BLUE, antialias: false, ..ToolSettings::default() }
    }

    #[test]
    fn fills_the_patch_under_the_click_and_nothing_else() {
        let mut doc = doc();
        assert_eq!(fill(&mut doc, Selection::None, settings(), (3.0, 3.0)), Gesture::EditsActiveLayer);
        let r = &doc.active_layer().raster;
        assert_eq!(r.get(3, 3), BLUE);
        assert_eq!(r.get(5, 5), BLUE, "the whole square");
        assert_eq!(r.get(1, 1), Rgba::WHITE, "the background is untouched");
        assert_eq!(r.pixels().iter().filter(|p| **p == BLUE).count(), 16);
    }

    #[test]
    fn a_selection_holds_the_fill_and_opacity_thins_it() {
        let mut doc = doc();
        let mut s = settings();
        s.opacity = 0.5;
        fill(&mut doc, Selection::Rect(Rect::new(0, 0, 4, 10)), s, (3.0, 3.0));
        let r = &doc.active_layer().raster;
        assert_eq!(r.get(4, 3), RED, "outside the selection");
        let inside = r.get(3, 3);
        assert!(inside.b > 100 && inside.r > 100, "half blue over red: {inside}");
    }

    #[test]
    fn a_click_outside_the_selection_does_nothing() {
        let mut doc = doc();
        assert_eq!(fill(&mut doc, Selection::Rect(Rect::new(0, 0, 2, 2)), settings(), (3.0, 3.0)), Gesture::Passive);
        assert_eq!(doc.active_layer().raster.get(3, 3), RED);
    }

    #[test]
    fn global_mode_reaches_every_matching_patch() {
        let mut doc = doc();
        doc.active_layer_mut().raster.set(8, 8, RED);
        let mut s = settings();
        s.sample_mode = crate::autoselect::SampleMode::Global;
        fill(&mut doc, Selection::None, s, (3.0, 3.0));
        assert_eq!(doc.active_layer().raster.get(8, 8), BLUE);
    }
}
