//! The move tool: drag the selected pixels (or the whole layer) by whole
//! pixels. A transform session with only translation, committed on release.

use super::{Gesture, PointerEvent, Tool, ToolContext, ToolKind};
use crate::geometry::{Point, Rect};
use crate::raster::Raster;
use crate::selection::Selection;
use crate::snap::Snap;

#[derive(Debug, Default)]
pub struct MoveTool {
    gesture: Option<Moving>,
    /// What the last call redrew, for [`Tool::dirtied`]. Kept here rather
    /// than on the gesture because the pointer coming up ends the gesture
    /// and the answer is wanted after that.
    dirty: Option<Rect>,
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
    /// the guides, and for working out what a shift of them redraws. `None`
    /// when there is nothing visible to move.
    bounds: Option<Rect>,
}

/// `bounds` where an offset puts it.
fn shifted(bounds: Rect, (dx, dy): (i32, i32)) -> Rect {
    Rect::new(bounds.x + dx, bounds.y + dy, bounds.w, bounds.h)
}

/// How far a drag from `start` to `now` has shifted the pixels, in whole
/// document pixels, with the edges and centre of `bounds` pulled onto the
/// guides.
///
/// The editor's reduced preview of a move works this out for itself rather
/// than through the gesture, and the two have to land in the same place or
/// the pixels would jump when the pointer comes up. They agree because this
/// is the only place that decides it.
pub fn drag_offset(start: Point, now: Point, bounds: Option<Rect>, snap: Option<&Snap>) -> (i32, i32) {
    let mut dx = now.x - start.x;
    let mut dy = now.y - start.y;
    if let (Some(snap), Some(b)) = (snap, bounds) {
        let (x0, y0) = (f64::from(b.x) + dx, f64::from(b.y) + dy);
        let (x1, y1) = (f64::from(b.right()) + dx, f64::from(b.bottom()) + dy);
        let (sx, sy) = snap.offset(&[x0, x1, (x0 + x1) / 2.0], &[y0, y1, (y0 + y1) / 2.0]);
        dx += sx;
        dy += sy;
    }
    (dx.round() as i32, dy.round() as i32)
}

impl MoveTool {
    fn apply(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let Some(g) = self.gesture.as_mut() else { return false };
        let snap = Snap::new(&ctx.settings.guides, ctx.document.bounds(), ctx.viewport.zoom());
        let (dx, dy) = drag_offset(g.start, ev.pos, g.bounds, snap.as_ref());
        if (dx, dy) == g.offset {
            return false;
        }
        let previous = g.offset;
        g.offset = (dx, dy);
        // Only where the moving pixels were and where they have gone can
        // have changed: put the layer back over the first and lay them down
        // again on the second, rather than rebuilding the whole surface.
        // On a 4K document that is the difference between the pixels
        // keeping up with the pointer and lagging behind it.
        let dirty = g.bounds.map_or_else(Rect::default, |b| shifted(b, previous).union(&shifted(b, (dx, dy))));
        let surface = ctx.document.active_surface_mut();
        surface.copy_from(&g.stationary, &dirty);
        surface.merge_translated_in(&g.moving, dx, dy, &dirty);
        self.dirty = Some(dirty);
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
        self.dirty = Some(Rect::default());
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

    fn dirtied(&self) -> Option<Rect> {
        self.dirty
    }

    fn cancel(&mut self, ctx: &mut ToolContext) {
        self.dirty = None;
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
    fn a_drag_redraws_only_where_the_pixels_were_and_where_they_have_gone() {
        // The page recomposites, re-uploads and re-mips whatever this
        // reports, so a drag on a large document must not claim all of it.
        let all = Rect::new(0, 0, 100, 100);
        let item = |d: &mut Document| d.active_layer_mut().raster.fill_rect(Rect::new(10, 10, 8, 8), RED, &all);

        let mut d = Document::new(100, 100, Rgba::TRANSPARENT);
        item(&mut d);
        let mut sel = Selection::None;
        let mut vp = Viewport::default();
        let mut settings = ToolSettings::default();
        let mut tool = MoveTool::default();
        let mut ctx = ToolContext { document: &mut d, selection: &mut sel, viewport: &mut vp, settings: &mut settings };
        tool.begin(&mut ctx, PointerEvent::at(50.0, 50.0));
        assert_eq!(tool.dirtied(), Some(Rect::default()), "nothing drawn yet");
        tool.update(&mut ctx, PointerEvent::at(55.0, 50.0));
        // Where the item was (10, 10, 8, 8) and where it now is (15, 10, 8, 8).
        assert_eq!(tool.dirtied(), Some(Rect::new(10, 10, 13, 8)));
        // Carry on in steps, and end up with what one straight drag gives:
        // patching frame by frame must leave no trace of the frames before.
        for at in [61.0, 58.0, 70.0, 64.0] {
            tool.update(&mut ctx, PointerEvent::at(at, 50.0 + at / 10.0));
        }
        tool.finish(&mut ctx, PointerEvent::at(64.0, 56.4));

        let mut straight = Document::new(100, 100, Rgba::TRANSPARENT);
        item(&mut straight);
        let mut sel2 = Selection::None;
        let mut tool2 = MoveTool::default();
        let mut ctx2 = ToolContext { document: &mut straight, selection: &mut sel2, viewport: &mut vp, settings: &mut settings };
        tool2.begin(&mut ctx2, PointerEvent::at(50.0, 50.0));
        tool2.finish(&mut ctx2, PointerEvent::at(64.0, 56.4));
        assert_eq!(d.active_layer().raster, straight.active_layer().raster);
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
