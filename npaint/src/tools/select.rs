//! The rectangular marquee.

use super::{constrain_square, Gesture, PointerEvent, Tool, ToolContext, ToolKind};
use crate::geometry::{Point, Rect};

#[derive(Debug, Default)]
pub struct MarqueeTool {
    start: Option<Point>,
}

impl MarqueeTool {
    fn rect(start: Point, ev: PointerEvent) -> Rect {
        let end = if ev.shift { constrain_square(start, ev.pos) } else { ev.pos };
        Rect::from_drag(start, end)
    }
}

impl Tool for MarqueeTool {
    fn kind(&self) -> ToolKind {
        ToolKind::Select
    }

    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        self.start = Some(ev.pos);
        // A click clears the old selection straight away, the way Photoshop
        // does; dragging then grows a new one from nothing.
        *ctx.selection = crate::selection::Selection::None;
        Gesture::Passive
    }

    fn update(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let Some(start) = self.start else { return false };
        let bounds = ctx.document.bounds();
        ctx.selection.set_rect(Self::rect(start, ev), bounds);
        true
    }

    fn finish(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let changed = self.update(ctx, ev);
        self.start = None;
        changed
    }

    fn cancel(&mut self, ctx: &mut ToolContext) {
        self.start = None;
        *ctx.selection = crate::selection::Selection::None;
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

    fn drive(events: &[(&str, PointerEvent)]) -> Selection {
        let mut doc = Document::new(20, 20, Rgba::WHITE);
        let mut selection = Selection::None;
        let settings = ToolSettings::default();
        let mut tool = MarqueeTool::default();
        for (what, ev) in events {
            let mut ctx = ToolContext { document: &mut doc, selection: &mut selection, viewport: &mut Viewport::default(), settings: &settings };
            match *what {
                "begin" => {
                    tool.begin(&mut ctx, *ev);
                }
                "update" => {
                    tool.update(&mut ctx, *ev);
                }
                "finish" => {
                    tool.finish(&mut ctx, *ev);
                }
                "cancel" => tool.cancel(&mut ctx),
                _ => unreachable!(),
            }
        }
        selection
    }

    #[test]
    fn a_drag_selects_the_dragged_rect() {
        let s = drive(&[
            ("begin", PointerEvent::at(2.0, 3.0)),
            ("update", PointerEvent::at(6.0, 4.0)),
            ("finish", PointerEvent::at(7.0, 8.0)),
        ]);
        assert_eq!(s, Selection::Rect(Rect::new(2, 3, 5, 5)));
    }

    #[test]
    fn a_click_deselects() {
        let s = drive(&[
            ("begin", PointerEvent::at(2.0, 3.0)),
            ("update", PointerEvent::at(6.0, 4.0)),
            ("finish", PointerEvent::at(7.0, 8.0)),
            ("begin", PointerEvent::at(1.0, 1.0)),
            ("finish", PointerEvent::at(1.0, 1.0)),
        ]);
        assert_eq!(s, Selection::None);
    }

    #[test]
    fn shift_makes_a_square() {
        let ev = PointerEvent { pos: Point::new(12.0, 4.0), screen: Point::new(12.0, 4.0), shift: true, alt: false };
        let s = drive(&[("begin", PointerEvent::at(2.0, 2.0)), ("finish", ev)]);
        assert_eq!(s, Selection::Rect(Rect::new(2, 2, 10, 10)));
    }

    #[test]
    fn selection_clips_to_the_document() {
        let s = drive(&[("begin", PointerEvent::at(15.0, 15.0)), ("finish", PointerEvent::at(40.0, 40.0))]);
        assert_eq!(s, Selection::Rect(Rect::new(15, 15, 5, 5)));
    }

    #[test]
    fn cancel_clears() {
        let s = drive(&[
            ("begin", PointerEvent::at(2.0, 3.0)),
            ("update", PointerEvent::at(6.0, 4.0)),
            ("cancel", PointerEvent::default()),
        ]);
        assert_eq!(s, Selection::None);
    }
}
