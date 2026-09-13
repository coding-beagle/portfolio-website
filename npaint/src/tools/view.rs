//! Tools that change the view rather than the document: zoom and hand.

use super::{Gesture, PointerEvent, Tool, ToolContext, ToolKind};
use crate::geometry::Point;

/// The zoom tool, Photoshop style: click to zoom in a step about the click,
/// Alt+click to zoom out, and drag ("scrubby zoom") to zoom continuously —
/// right to enlarge, left to shrink — about where the drag began.
#[derive(Debug, Default)]
pub struct ZoomTool {
    gesture: Option<Scrub>,
}

#[derive(Debug, Clone, Copy)]
struct Scrub {
    start_screen: Point,
    start_zoom: f64,
    moved: bool,
}

/// Screen pixels of horizontal drag that double the zoom.
const SCRUB_PIXELS_PER_DOUBLING: f64 = 120.0;
/// A drag shorter than this is a click.
const CLICK_SLOP: f64 = 3.0;

impl Tool for ZoomTool {
    fn kind(&self) -> ToolKind {
        ToolKind::Zoom
    }

    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        self.gesture = Some(Scrub { start_screen: ev.screen, start_zoom: ctx.viewport.zoom(), moved: false });
        Gesture::Passive
    }

    fn update(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let Some(g) = self.gesture.as_mut() else { return false };
        let dx = ev.screen.x - g.start_screen.x;
        if !g.moved && dx.abs() < CLICK_SLOP && (ev.screen.y - g.start_screen.y).abs() < CLICK_SLOP {
            return false;
        }
        g.moved = true;
        let zoom = g.start_zoom * 2f64.powf(dx / SCRUB_PIXELS_PER_DOUBLING);
        ctx.viewport.set_zoom_about(zoom, g.start_screen);
        true
    }

    fn finish(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let Some(g) = self.gesture.take() else { return false };
        if g.moved {
            return true;
        }
        let next = if ev.alt { ctx.viewport.next_step_out() } else { ctx.viewport.next_step_in() };
        ctx.viewport.set_zoom_about(next, g.start_screen);
        true
    }

    fn cancel(&mut self, ctx: &mut ToolContext) {
        if let Some(g) = self.gesture.take() {
            ctx.viewport.set_zoom_about(g.start_zoom, g.start_screen);
        }
    }
}

/// The hand: drag to pan.
#[derive(Debug, Default)]
pub struct HandTool {
    last: Option<Point>,
}

impl Tool for HandTool {
    fn kind(&self) -> ToolKind {
        ToolKind::Hand
    }

    fn begin(&mut self, _ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        self.last = Some(ev.screen);
        Gesture::Passive
    }

    fn update(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let Some(last) = self.last else { return false };
        ctx.viewport.pan_by(ev.screen.x - last.x, ev.screen.y - last.y);
        self.last = Some(ev.screen);
        true
    }

    fn finish(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let changed = self.update(ctx, ev);
        self.last = None;
        changed
    }

    fn cancel(&mut self, _ctx: &mut ToolContext) {
        self.last = None;
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

    fn screen(x: f64, y: f64, alt: bool) -> PointerEvent {
        PointerEvent { pos: Point::new(x, y), screen: Point::new(x, y), shift: false, alt }
    }

    struct Rig {
        doc: Document,
        sel: Selection,
        vp: Viewport,
        settings: ToolSettings,
    }

    impl Rig {
        fn new() -> Rig {
            Rig { doc: Document::new(100, 100, Rgba::WHITE), sel: Selection::None, vp: Viewport::default(), settings: ToolSettings::default() }
        }
        fn ctx(&mut self) -> ToolContext<'_> {
            ToolContext { document: &mut self.doc, selection: &mut self.sel, viewport: &mut self.vp, settings: &self.settings }
        }
    }

    #[test]
    fn a_click_steps_in_and_alt_click_steps_out() {
        let mut rig = Rig::new();
        let mut tool = ZoomTool::default();
        tool.begin(&mut rig.ctx(), screen(50.0, 50.0, false));
        assert!(tool.finish(&mut rig.ctx(), screen(51.0, 50.0, false)), "a pixel of wobble is still a click");
        assert_eq!(rig.vp.zoom(), 2.0);
        assert_eq!(rig.vp.screen_to_doc(Point::new(50.0, 50.0)), Point::new(50.0, 50.0), "zoomed about the click");
        tool.begin(&mut rig.ctx(), screen(50.0, 50.0, true));
        tool.finish(&mut rig.ctx(), screen(50.0, 50.0, true));
        assert_eq!(rig.vp.zoom(), 1.0);
    }

    #[test]
    fn dragging_scrubs_the_zoom_about_the_press_point() {
        let mut rig = Rig::new();
        let mut tool = ZoomTool::default();
        tool.begin(&mut rig.ctx(), screen(20.0, 20.0, false));
        assert!(tool.update(&mut rig.ctx(), screen(20.0 + SCRUB_PIXELS_PER_DOUBLING, 20.0, false)));
        assert!((rig.vp.zoom() - 2.0).abs() < 1e-9);
        assert!(tool.update(&mut rig.ctx(), screen(20.0 - SCRUB_PIXELS_PER_DOUBLING, 20.0, false)));
        assert!((rig.vp.zoom() - 0.5).abs() < 1e-9);
        let anchor = rig.vp.screen_to_doc(Point::new(20.0, 20.0));
        assert_eq!(anchor, Point::new(20.0, 20.0));
        tool.finish(&mut rig.ctx(), screen(20.0 - SCRUB_PIXELS_PER_DOUBLING, 20.0, false));
        assert!((rig.vp.zoom() - 0.5).abs() < 1e-9, "a drag does not also click");
    }

    #[test]
    fn cancel_restores_the_zoom() {
        let mut rig = Rig::new();
        let mut tool = ZoomTool::default();
        tool.begin(&mut rig.ctx(), screen(0.0, 0.0, false));
        tool.update(&mut rig.ctx(), screen(200.0, 0.0, false));
        tool.cancel(&mut rig.ctx());
        assert_eq!(rig.vp.zoom(), 1.0);
    }

    #[test]
    fn the_hand_pans() {
        let mut rig = Rig::new();
        let mut tool = HandTool::default();
        tool.begin(&mut rig.ctx(), screen(10.0, 10.0, false));
        tool.update(&mut rig.ctx(), screen(15.0, 12.0, false));
        tool.finish(&mut rig.ctx(), screen(20.0, 20.0, false));
        assert_eq!(rig.vp.pan(), Point::new(10.0, 10.0));
    }
}
