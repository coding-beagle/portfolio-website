//! The move tool: drag the selected pixels (or the whole layer) by whole
//! pixels. A transform session with only translation, committed on release.
//!
//! What a drag pushes over the edge of the canvas is not cut off: it goes
//! into the layer's [`Offscreen`] store, so dragging back brings it back.
//! The drag works on the layer's pixels *and* that store as one picture,
//! and the selection divides it: a marquee out past the edge picks up what
//! is out there, and one over the canvas leaves it alone.

use super::{Gesture, PointerEvent, Tool, ToolContext, ToolKind};
use crate::document::Document;
use crate::geometry::{Point, Rect};
use crate::layer::Offscreen;
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
    /// The pixels being dragged and where they sit, which is the canvas
    /// unless the layer had pixels off it to carry along.
    moving: Offscreen,
    stationary: Raster,
    /// What the layer keeps off the canvas that is *not* being dragged.
    left: Option<Offscreen>,
    /// Whether the store this gesture puts back is the layer's pixels'.
    /// A drag on a layer mask moves a raster that has no store of its own,
    /// so what it pushes off the canvas is cut off as it always was.
    keeps_offscreen: bool,
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

impl Moving {
    /// Where the drag has put the pixels, and what of that is off the
    /// canvas for the layer to keep.
    fn settled(self, canvas: Rect) -> Option<Offscreen> {
        let keeps = self.keeps_offscreen;
        let left = self.left;
        let moved = self.moving.translated(self.offset.0, self.offset.1);
        let outside = keeps.then(|| Offscreen::outside(moved.rect, &moved.raster, canvas)).flatten();
        Offscreen::merged(outside, left)
    }
}

/// `bounds` where an offset puts it.
fn shifted(bounds: Rect, (dx, dy): (i32, i32)) -> Rect {
    Rect::new(bounds.x + dx, bounds.y + dy, bounds.w, bounds.h)
}

/// What a move is about to shift, and what it leaves behind.
#[derive(Debug)]
pub struct Split {
    /// The pixels the selection holds, and where they sit.
    pub moving: Offscreen,
    /// The rest of the canvas, ready to be redrawn under them.
    pub stationary: Raster,
    /// The rest of what the layer keeps off the canvas.
    pub left: Option<Offscreen>,
    /// Whether what the move pushes off the canvas is the layer's to keep.
    /// A drag on a *mask* moves a raster the size of the document with no
    /// store behind it, so what leaves is cut off as it always was.
    pub keeps_offscreen: bool,
}

/// Divides everything the active layer holds — its surface, and the pixels
/// it keeps off the canvas — by the selection, taking the store out of the
/// layer so that the move owns it until it is done.
///
/// The drag and the arrow keys both come through here, so they cannot mean
/// two different things by the same move.
pub fn split_for_move(document: &mut Document, selection: &Selection) -> Split {
    let canvas = document.bounds();
    let keeps_offscreen = !document.active_layer().editing_mask();
    let stored = document.active_layer_mut().offscreen.take();
    // A layer with nothing outside the canvas — nearly every layer — is
    // split over the canvas alone, without a copy of it being made first.
    let (store, aside) = if keeps_offscreen { (stored, None) } else { (None, stored) };
    let Some(store) = store else {
        let (moving, stationary) = selection.split(document.active_surface());
        return Split { moving: Offscreen::new(canvas, moving), stationary, left: aside, keeps_offscreen };
    };
    let whole = Offscreen::new(canvas, document.active_surface().clone()).over(Some(store));
    let at = (whole.rect.x, whole.rect.y);
    let (moving, stationary) = selection.split_at(&whole.raster, at);
    let left = Offscreen::outside(whole.rect, &stationary, canvas);
    let window = Rect::new(canvas.x - at.0, canvas.y - at.1, canvas.w, canvas.h);
    Split {
        moving: Offscreen::new(whole.rect, moving),
        stationary: stationary.crop_padded(&window),
        left,
        keeps_offscreen,
    }
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
        // keeping up with the pointer and lagging behind it. Pixels carried
        // in from outside the canvas can put those bounds well outside it,
        // and only what the canvas shows is drawn.
        let dirty = g
            .bounds
            .map_or_else(Rect::default, |b| shifted(b, previous).union(&shifted(b, (dx, dy))))
            .intersect(&ctx.document.bounds());
        let (ox, oy) = (g.moving.rect.x, g.moving.rect.y);
        let surface = ctx.document.active_surface_mut();
        surface.copy_from(&g.stationary, &dirty);
        surface.merge_translated_in(&g.moving.raster, ox + dx, oy + dy, &dirty);
        self.dirty = Some(dirty);
        *ctx.selection = g.selection.translated(dx, dy);
        true
    }
}

impl Tool for MoveTool {
    fn kind(&self) -> ToolKind {
        ToolKind::Move
    }

    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        let Split { moving, stationary, left, keeps_offscreen } = split_for_move(ctx.document, ctx.selection);
        let bounds = moving.content_bounds();
        self.gesture = Some(Moving {
            start: ev.pos,
            moving,
            stationary,
            left,
            keeps_offscreen,
            selection: ctx.selection.clone(),
            offset: (0, 0),
            bounds,
        });
        self.dirty = Some(Rect::default());
        Gesture::EditsActiveLayer
    }

    fn update(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        self.apply(ctx, ev)
    }

    fn finish(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let changed = self.apply(ctx, ev);
        if let Some(gesture) = self.gesture.take() {
            let canvas = ctx.document.bounds();
            ctx.document.active_layer_mut().offscreen = gesture.settled(canvas);
        }
        changed
    }

    fn dirtied(&self) -> Option<Rect> {
        self.dirty
    }

    fn cancel(&mut self, ctx: &mut ToolContext) {
        self.dirty = None;
        if let Some(g) = self.gesture.take() {
            let canvas = ctx.document.bounds();
            let selection = g.selection.clone();
            let (ox, oy) = (g.moving.rect.x, g.moving.rect.y);
            let mut back = g.stationary.clone();
            back.merge_translated_in(&g.moving.raster, ox, oy, &canvas);
            *ctx.document.active_surface_mut() = back;
            // Where the pixels began is where an unmoved drag leaves them,
            // so the store goes back the way `finish` would put it.
            ctx.document.active_layer_mut().offscreen = Moving { offset: (0, 0), ..g }.settled(canvas);
            *ctx.selection = selection;
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

    /// A move tool driven from `from` to `to` on `d`, as the editor drives
    /// it: one gesture, begun and finished.
    fn drag(d: &mut Document, sel: &mut Selection, from: (f64, f64), to: (f64, f64)) {
        let mut vp = Viewport::default();
        let mut settings = ToolSettings::default();
        let mut tool = MoveTool::default();
        let mut ctx = ToolContext { document: d, selection: sel, viewport: &mut vp, settings: &mut settings };
        tool.begin(&mut ctx, PointerEvent::at(from.0, from.1));
        tool.finish(&mut ctx, PointerEvent::at(to.0, to.1));
    }

    #[test]
    fn pixels_dragged_off_the_canvas_are_kept_and_come_back() {
        let mut d = doc();
        let mut sel = Selection::None;
        drag(&mut d, &mut sel, (0.0, 0.0), (20.0, 0.0));
        assert_eq!(d.active_layer().raster.content_bounds(), None, "the canvas is empty");
        let kept = d.active_layer().offscreen.as_ref().expect("the pixels went somewhere");
        assert_eq!(kept.rect, Rect::new(22, 2, 6, 6), "from the red pixel to the black one, out past the edge");
        assert_eq!(kept.raster.get(0, 0), RED);
        assert_eq!(d.content_bounds(), Rect::new(0, 0, 28, 10), "Reveal All can see it");

        drag(&mut d, &mut sel, (0.0, 0.0), (-20.0, 0.0));
        assert_eq!(d.active_layer().raster.get(2, 2), RED, "and back where it started");
        assert_eq!(d.active_layer().raster.get(7, 7), Rgba::BLACK);
        assert_eq!(d.active_layer().offscreen, None, "with nothing left outside");
    }

    #[test]
    fn a_selection_moves_only_the_canvas_and_leaves_what_is_outside_it() {
        let mut d = doc();
        let mut sel = Selection::None;
        drag(&mut d, &mut sel, (0.0, 0.0), (20.0, 0.0));
        let kept = d.active_layer().offscreen.clone().expect("out past the edge");
        // Something back on the canvas for the selection to have work to do.
        d.active_layer_mut().raster.set(1, 1, RED);

        let mut sel = Selection::Rect(Rect::new(0, 0, 4, 4));
        drag(&mut d, &mut sel, (0.0, 0.0), (0.0, 2.0));
        assert_eq!(d.active_layer().raster.get(1, 3), RED, "the selected pixel moved");
        assert_eq!(d.active_layer().offscreen, Some(kept), "and what is off the canvas stayed out there");
    }

    #[test]
    fn a_marquee_out_past_the_edge_picks_up_what_is_out_there() {
        let mut d = doc();
        let mut sel = Selection::None;
        // Both pixels off the right of the canvas: red at (22, 2), black at (27, 7).
        drag(&mut d, &mut sel, (0.0, 0.0), (20.0, 0.0));

        // A marquee around the red one alone, dragged back onto the canvas.
        let mut sel = Selection::Rect(Rect::new(20, 0, 4, 4));
        drag(&mut d, &mut sel, (0.0, 0.0), (-20.0, 0.0));
        assert_eq!(d.active_layer().raster.get(2, 2), RED, "the selected one came back");
        assert_eq!(sel, Selection::Rect(Rect::new(0, 0, 4, 4)), "and the marquee came with it");
        let kept = d.active_layer().offscreen.as_ref().expect("the other one stayed");
        assert_eq!(kept.rect, Rect::new(27, 7, 1, 1));
        assert_eq!(kept.raster.get(0, 0), Rgba::BLACK);
    }

    #[test]
    fn a_drag_on_a_mask_is_still_cut_off_at_the_canvas() {
        let mut d = doc();
        d.active_layer_mut().add_mask(Raster::filled(10, 10, Rgba::WHITE));
        let mut sel = Selection::None;
        drag(&mut d, &mut sel, (0.0, 0.0), (20.0, 0.0));
        assert_eq!(d.active_layer().offscreen, None, "a mask has no store to put anything in");
        assert_eq!(d.active_layer().raster.get(2, 2), RED, "and the pixels under it did not move");
    }

    #[test]
    fn cancelling_a_drag_leaves_what_was_already_outside_where_it_was() {
        let mut d = doc();
        let mut sel = Selection::None;
        drag(&mut d, &mut sel, (0.0, 0.0), (20.0, 0.0));
        let kept = d.active_layer().offscreen.clone();

        let mut vp = Viewport::default();
        let mut settings = ToolSettings::default();
        let mut tool = MoveTool::default();
        let mut ctx = ToolContext { document: &mut d, selection: &mut sel, viewport: &mut vp, settings: &mut settings };
        tool.begin(&mut ctx, PointerEvent::at(0.0, 0.0));
        tool.update(&mut ctx, PointerEvent::at(-20.0, 0.0));
        tool.cancel(&mut ctx);
        assert_eq!(d.active_layer().offscreen, kept);
        assert_eq!(d.active_layer().raster.content_bounds(), None);
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
