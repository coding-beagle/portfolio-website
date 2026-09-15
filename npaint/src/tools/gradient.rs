//! The gradient tool: drag out the two ends and the clip fills with the
//! blend between them.
//!
//! It previews the way the shape tools do — keep the surface from before the
//! drag, put it back, paint the gradient again — but where a shape covers a
//! rectangle, a gradient covers everything the selection allows. So the area
//! it puts back and the area it reports dirty are both the whole clip, and
//! the cost of a drag is the cost of the fill.
//!
//! The colours are the foreground and the background, which is what the two
//! swatches are for; the options bar's Reverse swaps them, so the gradient
//! can be turned round without touching the swatches.

use super::{constrain_angle, Gesture, PointerEvent, Tool, ToolContext, ToolKind};
use crate::geometry::{Point, Rect};
use crate::gradient::Gradient;
use crate::raster::Raster;

#[derive(Debug, Default)]
pub struct GradientTool {
    gesture: Option<(Point, Raster)>,
    /// The clip the drag began in: the area the preview keeps repainting,
    /// and what [`Tool::dirtied`] reports.
    area: Rect,
}

impl GradientTool {
    fn draw(&mut self, ctx: &mut ToolContext, ev: PointerEvent) {
        let Some((start, base)) = self.gesture.as_ref() else { return };
        let start = *start;
        // Shift snaps the drag to 45°, as it does for a line.
        let end = if ev.shift { constrain_angle(start, ev.pos) } else { ev.pos };
        let settings = ctx.settings.clone();
        let (from, to) = if settings.gradient_reverse {
            (settings.background, settings.color)
        } else {
            (settings.color, settings.background)
        };
        let gradient = Gradient { shape: settings.gradient_shape, start, end, from, to };
        let area = self.area;
        let raster = ctx.document.active_surface_mut();
        raster.copy_from(base, &area);
        raster.fill_gradient(&gradient, settings.opacity, &area);
    }
}

impl Tool for GradientTool {
    fn kind(&self) -> ToolKind {
        ToolKind::Gradient
    }

    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        self.area = ctx.clip();
        self.gesture = Some((ev.pos, ctx.document.active_surface().clone()));
        Gesture::EditsActiveLayer
    }

    fn update(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        if self.gesture.is_none() {
            return false;
        }
        self.draw(ctx, ev);
        true
    }

    fn finish(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let changed = self.update(ctx, ev);
        self.gesture = None;
        changed
    }

    fn cancel(&mut self, ctx: &mut ToolContext) {
        if let Some((_, base)) = self.gesture.take() {
            *ctx.document.active_surface_mut() = base;
        }
    }

    fn dirtied(&self) -> Option<Rect> {
        Some(self.area)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::Rgba;
    use crate::document::Document;
    use crate::gradient::GradientShape;
    use crate::selection::Selection;
    use crate::tools::ToolSettings;
    use crate::viewport::Viewport;

    const RED: Rgba = Rgba::opaque(255, 0, 0);
    const BLUE: Rgba = Rgba::opaque(0, 0, 255);

    fn settings() -> ToolSettings {
        ToolSettings { color: RED, background: BLUE, ..ToolSettings::default() }
    }

    fn run(settings: ToolSettings, selection: Selection, path: &[(f64, f64)]) -> (Raster, Option<Rect>) {
        let mut doc = Document::new(20, 20, Rgba::WHITE);
        let mut selection = selection;
        let mut settings = settings;
        let mut tool = GradientTool::default();
        let mut ctx = ToolContext {
            document: &mut doc,
            selection: &mut selection,
            viewport: &mut Viewport::default(),
            settings: &mut settings,
        };
        let (first, rest) = path.split_first().unwrap();
        tool.begin(&mut ctx, PointerEvent::at(first.0, first.1));
        let (last, middle) = rest.split_last().unwrap();
        for p in middle {
            tool.update(&mut ctx, PointerEvent::at(p.0, p.1));
        }
        tool.finish(&mut ctx, PointerEvent::at(last.0, last.1));
        let dirty = tool.dirtied();
        (doc.active_layer().raster.clone(), dirty)
    }

    #[test]
    fn a_drag_fills_the_layer_from_one_colour_to_the_other() {
        let (r, dirty) = run(settings(), Selection::None, &[(0.0, 0.0), (19.0, 0.0)]);
        assert!(r.get(0, 0).r > 240, "the first colour at the start");
        assert!(r.get(19, 0).b > 240, "the second at the end");
        assert!(r.get(10, 0).r > 0 && r.get(10, 0).b > 0, "and a mix between");
        assert_eq!(r.get(10, 0), r.get(10, 19), "square to the drag, so every row is the same");
        assert_eq!(dirty, Some(Rect::new(0, 0, 20, 20)));
    }

    #[test]
    fn reverse_turns_it_round() {
        let s = ToolSettings { gradient_reverse: true, ..settings() };
        let (r, _) = run(s, Selection::None, &[(0.0, 0.0), (19.0, 0.0)]);
        assert!(r.get(0, 0).b > 240, "the swatches have swapped");
        assert!(r.get(19, 0).r > 240);
    }

    #[test]
    fn only_the_last_drag_position_is_kept() {
        let (r, _) = run(settings(), Selection::None, &[(0.0, 0.0), (19.0, 19.0), (19.0, 0.0)]);
        assert_eq!(r.get(10, 0), r.get(10, 19), "the earlier diagonal must be gone");
    }

    #[test]
    fn the_selection_holds_it_in() {
        let sel = Selection::Rect(Rect::new(0, 0, 10, 20));
        let (r, dirty) = run(settings(), sel, &[(0.0, 0.0), (19.0, 0.0)]);
        assert_eq!(r.get(15, 0), Rgba::WHITE, "outside the selection is untouched");
        assert!(r.get(5, 0).r > 0);
        assert_eq!(dirty, Some(Rect::new(0, 0, 10, 20)), "and only that is redrawn");
    }

    #[test]
    fn opacity_lets_the_layer_through() {
        let s = ToolSettings { opacity: 0.5, ..settings() };
        let (r, _) = run(s, Selection::None, &[(0.0, 0.0), (19.0, 0.0)]);
        let p = r.get(0, 0);
        assert!(p.r > 200 && p.g > 100, "half red over white is pink, not red: {p}");
    }

    #[test]
    fn a_radial_gradient_is_round() {
        let s = ToolSettings { gradient_shape: GradientShape::Radial, ..settings() };
        let (r, _) = run(s, Selection::None, &[(10.0, 10.0), (19.0, 10.0)]);
        assert_eq!(r.get(14, 10), r.get(10, 14), "the same ring");
        assert!(r.get(10, 10).r > 230, "all but a shade of the first colour at the centre");
    }

    #[test]
    fn cancel_puts_the_layer_back() {
        let mut doc = Document::new(8, 8, Rgba::WHITE);
        let mut selection = Selection::None;
        let mut settings = settings();
        let mut tool = GradientTool::default();
        let mut ctx = ToolContext {
            document: &mut doc,
            selection: &mut selection,
            viewport: &mut Viewport::default(),
            settings: &mut settings,
        };
        tool.begin(&mut ctx, PointerEvent::at(0.0, 0.0));
        tool.update(&mut ctx, PointerEvent::at(7.0, 7.0));
        assert_ne!(doc.active_layer().raster.get(0, 0), Rgba::WHITE);
        let mut ctx = ToolContext {
            document: &mut doc,
            selection: &mut selection,
            viewport: &mut Viewport::default(),
            settings: &mut settings,
        };
        tool.cancel(&mut ctx);
        assert_eq!(doc.active_layer().raster.get(0, 0), Rgba::WHITE);
    }
}
