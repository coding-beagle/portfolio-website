//! The move tool: drag the selected pixels (or the whole layer) by whole
//! pixels. A transform session with only translation, committed on release.

use super::{Gesture, PointerEvent, Tool, ToolContext, ToolKind};
use crate::geometry::Point;
use crate::raster::Raster;
use crate::selection::Selection;
use crate::snap::Snap;

#[derive(Debug, Default)]
pub struct MoveTool {
    gesture: Option<Moving>,
}

#[derive(Debug)]
struct Moving {
    start: Point,
    moving: Raster,
    stationary: Raster,
    /// The selection as it was when the drag began; it travels with the
    /// pixels, whatever shape it is.
    selection: Selection,
    /// The offset applied so far, so a move that ends where it began is a
    /// no-op and updates only happen on whole-pixel changes.
    offset: (i32, i32),
    /// Where the moving pixels were, for snapping their edges and centre to
    /// the guides. `None` when there is nothing visible to snap.
    bounds: Option<crate::geometry::Rect>,
}

impl MoveTool {
    fn apply(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let Some(g) = self.gesture.as_mut() else { return false };
        let mut dx = ev.pos.x - g.start.x;
        let mut dy = ev.pos.y - g.start.y;
        let snap = Snap::new(&ctx.settings.guides, ctx.document.bounds(), ctx.viewport.zoom());
        if let (Some(snap), Some(b)) = (snap, g.bounds) {
            let (x0, y0) = (f64::from(b.x) + dx, f64::from(b.y) + dy);
            let (x1, y1) = (f64::from(b.right()) + dx, f64::from(b.bottom()) + dy);
            let (sx, sy) = snap.offset(&[x0, x1, (x0 + x1) / 2.0], &[y0, y1, (y0 + y1) / 2.0]);
            dx += sx;
            dy += sy;
        }
        let dx = dx.round() as i32;
        let dy = dy.round() as i32;
        if (dx, dy) == g.offset {
            return false;
        }
        g.offset = (dx, dy);
        let mut out = g.stationary.clone();
        out.merge_over(&g.moving.translated(dx, dy));
        *ctx.document.active_surface_mut() = out;
        let bounds = ctx.document.bounds();
        *ctx.selection = g.selection.translated(dx, dy, bounds);
        true
    }
}

impl Tool for MoveTool {
    fn kind(&self) -> ToolKind {
        ToolKind::Move
    }

    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        let layer = ctx.document.active_surface();
        let (moving, stationary) = ctx.selection.split(layer);
        let selection = ctx.selection.clone();
        let bounds = moving.content_bounds();
        self.gesture = Some(Moving { start: ev.pos, moving, stationary, selection, offset: (0, 0), bounds });
        Gesture::EditsActiveLayer
    }

    fn update(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        self.apply(ctx, ev)
    }

    fn finish(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let changed = self.apply(ctx, ev);
        self.gesture = None;
        changed
    }

    fn cancel(&mut self, ctx: &mut ToolContext) {
        if let Some(g) = self.gesture.take() {
            let mut back = g.stationary;
            back.merge_over(&g.moving);
            *ctx.document.active_surface_mut() = back;
            *ctx.selection = g.selection;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::Rgba;
    use crate::document::Document;
    use crate::geometry::Rect;
    use crate::mask::Mask;
    use crate::selection::Selection;
    use crate::tools::ToolSettings;
    use crate::viewport::Viewport;

    const RED: Rgba = Rgba::opaque(255, 0, 0);

    fn doc() -> Document {
        let mut d = Document::new(10, 10, Rgba::TRANSPARENT);
        d.active_layer_mut().raster.set(2, 2, RED);
        d.active_layer_mut().raster.set(7, 7, Rgba::BLACK);
        d
    }

    #[test]
    fn moves_the_whole_layer_without_a_selection() {
        let mut d = doc();
        let mut sel = Selection::None;
        let mut vp = Viewport::default();
        let mut settings = ToolSettings::default();
        let mut tool = MoveTool::default();
        let mut ctx = ToolContext { document: &mut d, selection: &mut sel, viewport: &mut vp, settings: &mut settings };
        tool.begin(&mut ctx, PointerEvent::at(5.0, 5.0));
        assert!(tool.update(&mut ctx, PointerEvent::at(6.0, 7.0)));
        assert!(!tool.update(&mut ctx, PointerEvent::at(6.2, 7.3)), "same pixel offset is not a change");
        tool.finish(&mut ctx, PointerEvent::at(6.0, 7.0));
        let r = &d.active_layer().raster;
        assert_eq!(r.get(3, 4), RED);
        assert_eq!(r.get(8, 9), Rgba::BLACK);
        assert_eq!(r.get(2, 2), Rgba::TRANSPARENT);
    }

    #[test]
    fn moves_only_the_selection_and_takes_the_marquee_along() {
        let mut d = doc();
        let mut sel = Selection::Rect(Rect::new(0, 0, 5, 5));
        let mut vp = Viewport::default();
        let mut settings = ToolSettings::default();
        let mut tool = MoveTool::default();
        let mut ctx = ToolContext { document: &mut d, selection: &mut sel, viewport: &mut vp, settings: &mut settings };
        tool.begin(&mut ctx, PointerEvent::at(1.0, 1.0));
        tool.finish(&mut ctx, PointerEvent::at(3.0, 1.0));
        assert_eq!(d.active_layer().raster.get(4, 2), RED);
        assert_eq!(d.active_layer().raster.get(7, 7), Rgba::BLACK, "outside the selection stays");
        assert_eq!(sel, Selection::Rect(Rect::new(2, 0, 5, 5)));
    }

    #[test]
    fn moves_the_pixels_a_mask_holds_and_nothing_else() {
        let mut d = doc();
        let mut sel = Selection::None;
        // A square with a bite out of one corner, so it stays a mask rather
        // than collapsing back into a rectangle.
        sel.set_mask(Mask::from_fn(10, 10, |x, y| u8::from(x < 4 && y < 4 && !(x == 3 && y == 3)) * 255));
        let mut vp = Viewport::default();
        let mut settings = ToolSettings::default();
        let mut tool = MoveTool::default();
        let mut ctx = ToolContext { document: &mut d, selection: &mut sel, viewport: &mut vp, settings: &mut settings };
        tool.begin(&mut ctx, PointerEvent::at(1.0, 1.0));
        tool.finish(&mut ctx, PointerEvent::at(4.0, 1.0));
        let r = &d.active_layer().raster;
        assert_eq!(r.get(5, 2), RED, "the pixel inside the L came along");
        assert_eq!(r.get(2, 2), Rgba::TRANSPARENT);
        assert_eq!(r.get(7, 7), Rgba::BLACK, "and nothing outside moved");
        assert!(sel.contains(5, 1), "the mask moved with it");
        assert!(!sel.contains(2, 1));
    }

    #[test]
    fn snaps_the_moving_pixels_edge_onto_a_guide() {
        let mut d = Document::new(40, 40, Rgba::TRANSPARENT);
        d.active_layer_mut().raster.set(10, 10, RED);
        let mut sel = Selection::None;
        let mut vp = Viewport::default();
        let mut settings = ToolSettings::default();
        settings.guides.enabled = true;
        settings.guides.v = vec![20.0];
        let mut tool = MoveTool::default();
        let mut ctx = ToolContext { document: &mut d, selection: &mut sel, viewport: &mut vp, settings: &mut settings };
        tool.begin(&mut ctx, PointerEvent::at(5.0, 5.0));
        // Dragged 8 right the pixel spans 18..19, its right edge one short of
        // the guide: it lands against the guide. Nothing is near vertically.
        tool.finish(&mut ctx, PointerEvent::at(13.0, 5.0));
        assert_eq!(d.active_layer().raster.get(19, 10), RED);
        assert_eq!(d.active_layer().raster.get(18, 10), Rgba::TRANSPARENT);
    }

    #[test]
    fn cancel_puts_everything_back() {
        let mut d = doc();
        let mut sel = Selection::Rect(Rect::new(0, 0, 5, 5));
        let mut vp = Viewport::default();
        let mut settings = ToolSettings::default();
        let mut tool = MoveTool::default();
        let mut ctx = ToolContext { document: &mut d, selection: &mut sel, viewport: &mut vp, settings: &mut settings };
        tool.begin(&mut ctx, PointerEvent::at(1.0, 1.0));
        tool.update(&mut ctx, PointerEvent::at(3.0, 3.0));
        tool.cancel(&mut ctx);
        assert_eq!(d.active_layer().raster.get(2, 2), RED);
        assert_eq!(sel, Selection::Rect(Rect::new(0, 0, 5, 5)));
    }
}
