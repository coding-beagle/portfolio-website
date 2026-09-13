//! The subject box: drag a rectangle around the thing you want, and the
//! page runs the subject model over just that part of the picture, so a
//! small thing in a big picture gets the model's full resolution.
//!
//! The tool itself only draws out the box. It goes into the tool settings
//! rather than the selection, so Shift and Alt can still combine the result
//! with whatever was selected before, and the page reads it back once the
//! drag ends (`Editor::subject_box`), runs the model, and hands the matte to
//! `Editor::select_subject_in_box`, which clears it.

use super::{Gesture, PointerEvent, Tool, ToolContext, ToolKind};
use crate::geometry::{Point, Rect};

#[derive(Debug, Default)]
pub struct SubjectBoxTool {
    start: Option<Point>,
}

impl SubjectBoxTool {
    fn apply(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let Some(start) = self.start else { return false };
        let rect = Rect::from_drag(start, ev.pos).intersect(&ctx.document.bounds());
        let next = (!rect.is_empty()).then_some(rect);
        let changed = ctx.settings.subject_box != next;
        ctx.settings.subject_box = next;
        changed
    }
}

impl Tool for SubjectBoxTool {
    fn kind(&self) -> ToolKind {
        ToolKind::SubjectBox
    }

    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        ctx.settings.subject_box = None;
        self.start = Some(ev.pos);
        Gesture::Passive
    }

    fn update(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        self.apply(ctx, ev)
    }

    fn finish(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let changed = self.apply(ctx, ev);
        self.start = None;
        changed
    }

    fn cancel(&mut self, ctx: &mut ToolContext) {
        self.start = None;
        ctx.settings.subject_box = None;
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

    #[test]
    fn the_drag_becomes_a_box_clipped_to_the_canvas_and_leaves_the_selection_alone() {
        let mut d = Document::new(20, 20, Rgba::WHITE);
        let mut sel = Selection::Rect(Rect::new(1, 1, 2, 2));
        let mut vp = Viewport::default();
        let mut settings = ToolSettings::default();
        let mut tool = SubjectBoxTool::default();
        let mut ctx = ToolContext { document: &mut d, selection: &mut sel, viewport: &mut vp, settings: &mut settings };
        tool.begin(&mut ctx, PointerEvent::at(5.0, 5.0));
        assert!(tool.update(&mut ctx, PointerEvent::at(30.0, 12.0)));
        assert!(!tool.update(&mut ctx, PointerEvent::at(30.0, 12.0)), "no change, no redraw");
        tool.finish(&mut ctx, PointerEvent::at(30.0, 12.0));
        assert_eq!(settings.subject_box, Some(Rect::new(5, 5, 15, 7)));
        assert_eq!(sel, Selection::Rect(Rect::new(1, 1, 2, 2)));
    }

    #[test]
    fn cancel_drops_the_box() {
        let mut d = Document::new(20, 20, Rgba::WHITE);
        let mut sel = Selection::None;
        let mut vp = Viewport::default();
        let mut settings = ToolSettings::default();
        let mut tool = SubjectBoxTool::default();
        let mut ctx = ToolContext { document: &mut d, selection: &mut sel, viewport: &mut vp, settings: &mut settings };
        tool.begin(&mut ctx, PointerEvent::at(5.0, 5.0));
        tool.update(&mut ctx, PointerEvent::at(10.0, 10.0));
        tool.cancel(&mut ctx);
        assert_eq!(settings.subject_box, None);
    }
}
