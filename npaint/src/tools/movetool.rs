//! The move tool: drag the selected pixels (or the whole layer) by whole
//! pixels. A transform session with only translation, committed on release.

use super::{Gesture, PointerEvent, Tool, ToolContext, ToolKind};
use crate::geometry::{Point, Rect};
use crate::raster::Raster;

#[derive(Debug, Default)]
pub struct MoveTool {
    gesture: Option<Moving>,
}

#[derive(Debug)]
struct Moving {
    start: Point,
    moving: Raster,
    stationary: Raster,
    selection: Option<Rect>,
    /// The offset applied so far, so a move that ends where it began is a
    /// no-op and updates only happen on whole-pixel changes.
    offset: (i32, i32),
}

impl MoveTool {
    fn apply(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let Some(g) = self.gesture.as_mut() else { return false };
        let dx = (ev.pos.x - g.start.x).round() as i32;
        let dy = (ev.pos.y - g.start.y).round() as i32;
        if (dx, dy) == g.offset {
            return false;
        }
        g.offset = (dx, dy);
        let mut out = g.stationary.clone();
        out.merge_over(&g.moving.translated(dx, dy));
        ctx.document.active_layer_mut().raster = out;
        if let Some(rect) = g.selection {
            let bounds = ctx.document.bounds();
            ctx.selection.set_rect(Rect::new(rect.x + dx, rect.y + dy, rect.w, rect.h), bounds);
        }
        true
    }
}

impl Tool for MoveTool {
    fn kind(&self) -> ToolKind {
        ToolKind::Move
    }

    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        let layer = &ctx.document.active_layer().raster;
        let selection = ctx.selection.rect();
        let (moving, stationary) = match selection {
            Some(rect) => layer.split(&rect),
            None => (layer.clone(), Raster::new(layer.width(), layer.height())),
        };
        self.gesture = Some(Moving { start: ev.pos, moving, stationary, selection, offset: (0, 0) });
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
            ctx.document.active_layer_mut().raster = back;
            if let Some(rect) = g.selection {
                let bounds = ctx.document.bounds();
                ctx.selection.set_rect(rect, bounds);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::Rgba;
    use crate::document::Document;
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
        let settings = ToolSettings::default();
        let mut tool = MoveTool::default();
        let mut ctx = ToolContext { document: &mut d, selection: &mut sel, viewport: &mut vp, settings: &settings };
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
        let settings = ToolSettings::default();
        let mut tool = MoveTool::default();
        let mut ctx = ToolContext { document: &mut d, selection: &mut sel, viewport: &mut vp, settings: &settings };
        tool.begin(&mut ctx, PointerEvent::at(1.0, 1.0));
        tool.finish(&mut ctx, PointerEvent::at(3.0, 1.0));
        assert_eq!(d.active_layer().raster.get(4, 2), RED);
        assert_eq!(d.active_layer().raster.get(7, 7), Rgba::BLACK, "outside the selection stays");
        assert_eq!(sel, Selection::Rect(Rect::new(2, 0, 5, 5)));
    }

    #[test]
    fn cancel_puts_everything_back() {
        let mut d = doc();
        let mut sel = Selection::Rect(Rect::new(0, 0, 5, 5));
        let mut vp = Viewport::default();
        let settings = ToolSettings::default();
        let mut tool = MoveTool::default();
        let mut ctx = ToolContext { document: &mut d, selection: &mut sel, viewport: &mut vp, settings: &settings };
        tool.begin(&mut ctx, PointerEvent::at(1.0, 1.0));
        tool.update(&mut ctx, PointerEvent::at(3.0, 3.0));
        tool.cancel(&mut ctx);
        assert_eq!(d.active_layer().raster.get(2, 2), RED);
        assert_eq!(sel, Selection::Rect(Rect::new(0, 0, 5, 5)));
    }
}
