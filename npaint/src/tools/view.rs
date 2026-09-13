//! Tools that change the view rather than the document: zoom and hand.

use super::{Gesture, PointerEvent, Tool, ToolContext, ToolKind};
use crate::geometry::Point;

/// The zoom tool, Photoshop style: click to zoom in a step about the click,
/// Alt+click to zoom out, and drag to scrub the zoom continuously — right to
/// enlarge, left to shrink — about where the drag began.
///
/// Turning `scrubby_zoom` off in the options bar makes a drag mark out the
/// rectangle to zoom into instead. Either way a drag that never leaves the
/// click slop is a click.
#[derive(Debug, Default)]
pub struct ZoomTool {
    gesture: Option<Drag>,
}

#[derive(Debug, Clone, Copy)]
struct Drag {
    start_screen: Point,
    at_screen: Point,
    start_zoom: f64,
    /// Whether this drag scrubs; read once at `begin` so that toggling the
    /// option mid-gesture cannot change what the gesture is doing.
    scrubby: bool,
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
        self.gesture = Some(Drag {
            start_screen: ev.screen,
            at_screen: ev.screen,
            start_zoom: ctx.viewport.zoom(),
            scrubby: ctx.settings.scrubby_zoom,
            moved: false,
        });
        Gesture::Passive
    }

    fn update(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let Some(g) = self.gesture.as_mut() else { return false };
        let dx = ev.screen.x - g.start_screen.x;
        if !g.moved && dx.abs() < CLICK_SLOP && (ev.screen.y - g.start_screen.y).abs() < CLICK_SLOP {
            return false;
        }
        g.moved = true;
        g.at_screen = ev.screen;
        if !g.scrubby {
            // The marquee is drawn by the page and changes nothing until the
            // pointer comes up; redrawing is all that is wanted here.
            return true;
        }
        let zoom = g.start_zoom * 2f64.powf(dx / SCRUB_PIXELS_PER_DOUBLING);
        ctx.viewport.set_zoom_about(zoom, g.start_screen);
        true
    }

    fn finish(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let Some(g) = self.gesture.take() else { return false };
        if g.moved {
            if g.scrubby {
                return true;
            }
            // A marquee too thin to have an area is a slip, not an ask for a
            // 64x zoom of a hairline: leave the view where it was.
            return ctx.viewport.zoom_to_screen_rect(g.start_screen, ev.screen);
        }
        let next = if ev.alt { ctx.viewport.next_step_out() } else { ctx.viewport.next_step_in() };
        ctx.viewport.set_zoom_about(next, g.start_screen);
        true
    }

    fn cancel(&mut self, ctx: &mut ToolContext) {
        if let Some(g) = self.gesture.take() {
            if g.scrubby {
                ctx.viewport.set_zoom_about(g.start_zoom, g.start_screen);
            }
        }
    }

    fn overlay(&self) -> Option<[f64; 4]> {
        let g = self.gesture?;
        if g.scrubby || !g.moved {
            return None;
        }
        let x = g.start_screen.x.min(g.at_screen.x);
        let y = g.start_screen.y.min(g.at_screen.y);
        Some([x, y, (g.at_screen.x - g.start_screen.x).abs(), (g.at_screen.y - g.start_screen.y).abs()])
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
            let mut vp = Viewport::default();
            vp.set_view(400.0, 400.0);
            Rig { doc: Document::new(100, 100, Rgba::WHITE), sel: Selection::None, vp, settings: ToolSettings::default() }
        }
        fn marquee() -> Rig {
            let mut rig = Rig::new();
            rig.settings.scrubby_zoom = false;
            rig
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
    fn cancel_restores_a_scrubbed_zoom() {
        let mut rig = Rig::new();
        let mut tool = ZoomTool::default();
        tool.begin(&mut rig.ctx(), screen(0.0, 0.0, false));
        tool.update(&mut rig.ctx(), screen(200.0, 0.0, false));
        tool.cancel(&mut rig.ctx());
        assert_eq!(rig.vp.zoom(), 1.0);
    }

    #[test]
    fn dragging_zooms_into_the_rectangle_drawn() {
        let mut rig = Rig::marquee();
        let mut tool = ZoomTool::default();
        // A 100x100 box in the middle of a 400x400 view, at 1:1.
        tool.begin(&mut rig.ctx(), screen(100.0, 100.0, false));
        assert!(tool.update(&mut rig.ctx(), screen(200.0, 200.0, false)));
        assert_eq!(rig.vp.zoom(), 1.0, "nothing moves until the pointer comes up");
        assert!(tool.finish(&mut rig.ctx(), screen(200.0, 200.0, false)));
        assert_eq!(rig.vp.zoom(), 4.0);
        let centre = rig.vp.doc_to_screen(Point::new(150.0, 150.0));
        assert!((centre.x - 200.0).abs() < 1e-9 && (centre.y - 200.0).abs() < 1e-9, "{centre:?}");
    }

    #[test]
    fn a_marquee_zoom_reads_the_same_dragged_either_way() {
        let mut rig = Rig::marquee();
        let mut tool = ZoomTool::default();
        tool.begin(&mut rig.ctx(), screen(200.0, 200.0, false));
        tool.update(&mut rig.ctx(), screen(100.0, 100.0, false));
        tool.finish(&mut rig.ctx(), screen(100.0, 100.0, false));
        assert_eq!(rig.vp.zoom(), 4.0);
    }

    #[test]
    fn the_page_is_given_the_marquee_to_draw() {
        let mut rig = Rig::marquee();
        let mut tool = ZoomTool::default();
        tool.begin(&mut rig.ctx(), screen(200.0, 200.0, false));
        assert_eq!(tool.overlay(), None, "nothing to draw for a click");
        tool.update(&mut rig.ctx(), screen(140.0, 180.0, false));
        assert_eq!(tool.overlay(), Some([140.0, 180.0, 60.0, 20.0]));
        tool.finish(&mut rig.ctx(), screen(140.0, 180.0, false));
        assert_eq!(tool.overlay(), None, "and nothing once the gesture is over");
    }

    #[test]
    fn a_scrub_has_no_marquee() {
        let mut rig = Rig::new();
        let mut tool = ZoomTool::default();
        tool.begin(&mut rig.ctx(), screen(20.0, 20.0, false));
        tool.update(&mut rig.ctx(), screen(80.0, 20.0, false));
        assert_eq!(tool.overlay(), None);
    }

    #[test]
    fn a_marquee_with_no_area_leaves_the_view_alone() {
        let mut rig = Rig::marquee();
        let mut tool = ZoomTool::default();
        tool.begin(&mut rig.ctx(), screen(50.0, 50.0, false));
        // Straight down: a hairline, not a rectangle.
        tool.update(&mut rig.ctx(), screen(50.0, 150.0, false));
        assert!(!tool.finish(&mut rig.ctx(), screen(50.0, 150.0, false)));
        assert_eq!(rig.vp.zoom(), 1.0);
    }

    #[test]
    fn cancelling_a_marquee_leaves_the_view_alone() {
        let mut rig = Rig::marquee();
        let mut tool = ZoomTool::default();
        tool.begin(&mut rig.ctx(), screen(10.0, 10.0, false));
        tool.update(&mut rig.ctx(), screen(60.0, 60.0, false));
        tool.cancel(&mut rig.ctx());
        assert_eq!(rig.vp.zoom(), 1.0);
        assert_eq!(tool.overlay(), None);
    }

    #[test]
    fn the_option_is_read_once_per_gesture() {
        let mut rig = Rig::new();
        let mut tool = ZoomTool::default();
        tool.begin(&mut rig.ctx(), screen(20.0, 20.0, false));
        rig.settings.scrubby_zoom = false;
        tool.update(&mut rig.ctx(), screen(20.0 + SCRUB_PIXELS_PER_DOUBLING, 20.0, false));
        assert!((rig.vp.zoom() - 2.0).abs() < 1e-9, "the drag that began as a scrub stays one");
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
