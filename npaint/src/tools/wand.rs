//! The two automatic selection tools: the magic wand, which takes what the
//! click landed on, and quick select, which grows a region as you brush it.
//!
//! Both only ever change the selection — the pixels are never touched — and
//! both honour the modifier keys the marquee uses: shift adds, alt takes
//! away, both together keeps the overlap.

use super::{Gesture, PointerEvent, Tool, ToolContext, ToolKind};
use crate::autoselect::{wand, QuickSelect};
use crate::geometry::Point;
use crate::mask::{Mask, SelectMode};
use crate::selection::Selection;

#[derive(Debug, Default)]
pub struct MagicWandTool;

impl Tool for MagicWandTool {
    fn kind(&self) -> ToolKind {
        ToolKind::Wand
    }

    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        let source = ctx.sample();
        let (x, y) = ev.pos.round();
        let mask = wand(
            &source,
            (x, y),
            ctx.settings.tolerance,
            ctx.settings.sample_mode,
            ctx.settings.antialias,
        );
        let bounds = ctx.document.bounds();
        ctx.selection.combine(&mask, SelectMode::from_modifiers(ev.shift, ev.alt), bounds);
        Gesture::Passive
    }

    fn update(&mut self, _ctx: &mut ToolContext, _ev: PointerEvent) -> bool {
        false
    }

    fn finish(&mut self, _ctx: &mut ToolContext, _ev: PointerEvent) -> bool {
        false
    }

    fn cancel(&mut self, _ctx: &mut ToolContext) {}
}

/// Quick select keeps its working state for the length of one stroke: the
/// image it is reading, what it has taken so far, and the selection it is
/// adding to.
#[derive(Default)]
pub struct QuickSelectTool {
    stroke: Option<Stroke>,
}

struct Stroke {
    state: QuickSelect,
    /// The selection as it was before the stroke, so that every dab combines
    /// against the same thing rather than piling up.
    base: Selection,
    mode: SelectMode,
}

impl std::fmt::Debug for QuickSelectTool {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("QuickSelectTool").field("stroking", &self.stroke.is_some()).finish()
    }
}

impl QuickSelectTool {
    fn dab(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let Some(stroke) = self.stroke.as_mut() else { return false };
        let grown = stroke.state.dab((ev.pos.x, ev.pos.y), ctx.settings.size, ctx.settings.tolerance);
        if !grown {
            return false;
        }
        let bounds = ctx.document.bounds();
        let mut next = stroke.base.clone();
        next.combine(stroke.state.mask(), stroke.mode, bounds);
        *ctx.selection = next;
        true
    }
}

impl Tool for QuickSelectTool {
    fn kind(&self) -> ToolKind {
        ToolKind::QuickSelect
    }

    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        let source = ctx.sample();
        self.stroke = Some(Stroke {
            state: QuickSelect::new(&source),
            base: ctx.selection.clone(),
            mode: SelectMode::from_modifiers(ev.shift, ev.alt),
        });
        self.dab(ctx, ev);
        Gesture::Passive
    }

    fn update(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        self.dab(ctx, ev)
    }

    fn finish(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        self.dab(ctx, ev);
        let Some(stroke) = self.stroke.take() else { return false };
        if stroke.state.mask().is_empty() {
            return false;
        }
        // Tidy the edge once, at the end: doing it per dab would fight the
        // growing and cost a pass over the image every pointer move.
        let bounds = ctx.document.bounds();
        let mut next = stroke.base;
        next.combine(&stroke.state.finish(), stroke.mode, bounds);
        *ctx.selection = next;
        true
    }

    fn cancel(&mut self, ctx: &mut ToolContext) {
        if let Some(stroke) = self.stroke.take() {
            *ctx.selection = stroke.base;
        }
    }
}

/// The refine brush: paint the selection itself. Drag to add to it, Alt-drag
/// to take away — the way you fix the bits an automatic selection got wrong,
/// without starting again.
#[derive(Debug, Default)]
pub struct RefineTool {
    stroke: Option<Refining>,
}

#[derive(Debug)]
struct Refining {
    mask: Mask,
    /// 255 to add, 0 to rub out; read once, so a gesture does not change its
    /// mind halfway through.
    cover: u8,
    last: Point,
}

impl RefineTool {
    fn paint(&mut self, ctx: &mut ToolContext, to: Point) -> bool {
        let Some(stroke) = self.stroke.as_mut() else { return false };
        let size = f64::from(ctx.settings.size.max(1));
        // Dab along the way, so a fast drag is a stroke and not a dotted line.
        let span = stroke.last.distance_to(to);
        let steps = (span / (size / 4.0).max(1.0)).ceil().max(1.0) as i32;
        for i in 1..=steps {
            let t = f64::from(i) / f64::from(steps);
            let at = (
                stroke.last.x + (to.x - stroke.last.x) * t,
                stroke.last.y + (to.y - stroke.last.y) * t,
            );
            stroke.mask.stamp_disc(at, size, stroke.cover);
        }
        stroke.last = to;
        let mut next = Selection::None;
        next.set_mask(stroke.mask.clone());
        *ctx.selection = next;
        true
    }
}

impl Tool for RefineTool {
    fn kind(&self) -> ToolKind {
        ToolKind::Refine
    }

    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        let bounds = ctx.document.bounds();
        // "Nothing selected" means everything may be edited, but a brush that
        // starts there is building a selection from scratch, not rubbing one
        // out of the whole canvas.
        let mask = if ctx.selection.is_none() {
            Mask::new(ctx.document.width(), ctx.document.height())
        } else {
            ctx.selection.to_mask(bounds)
        };
        self.stroke = Some(Refining {
            mask,
            cover: if ev.alt { 0 } else { 255 },
            last: ev.pos,
        });
        self.paint(ctx, ev.pos);
        Gesture::Passive
    }

    fn update(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        self.paint(ctx, ev.pos)
    }

    fn finish(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let changed = self.paint(ctx, ev.pos);
        self.stroke = None;
        changed
    }

    fn cancel(&mut self, _ctx: &mut ToolContext) {
        self.stroke = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::Rgba;
    use crate::document::Document;
    use crate::geometry::Rect;
    use crate::tools::ToolSettings;
    use crate::viewport::Viewport;

    const RED: Rgba = Rgba::opaque(220, 30, 30);

    struct Rig {
        doc: Document,
        sel: Selection,
        vp: Viewport,
        settings: ToolSettings,
    }

    impl Rig {
        /// A white document with a red square from (2,2) to (7,7).
        fn new() -> Rig {
            let mut doc = Document::new(20, 20, Rgba::WHITE);
            for y in 2..8 {
                for x in 2..8 {
                    doc.active_layer_mut().raster.set(x, y, RED);
                }
            }
            Rig {
                doc,
                sel: Selection::None,
                vp: Viewport::default(),
                settings: ToolSettings { antialias: false, ..ToolSettings::default() },
            }
        }
        fn ctx(&mut self) -> ToolContext<'_> {
            ToolContext {
                document: &mut self.doc,
                selection: &mut self.sel,
                viewport: &mut self.vp,
                settings: &mut self.settings,
            }
        }
    }

    fn at(x: f64, y: f64, shift: bool, alt: bool) -> PointerEvent {
        PointerEvent { pos: Point::new(x, y), screen: Point::new(x, y), shift, alt, pressure: 1.0 }
    }

    #[test]
    fn the_wand_takes_the_patch_that_was_clicked() {
        let mut rig = Rig::new();
        let mut tool = MagicWandTool;
        tool.begin(&mut rig.ctx(), at(4.0, 4.0, false, false));
        assert_eq!(rig.sel, Selection::Rect(Rect::new(2, 2, 6, 6)));
    }

    #[test]
    fn the_wand_adds_and_subtracts_with_the_modifiers() {
        let mut rig = Rig::new();
        let mut tool = MagicWandTool;
        tool.begin(&mut rig.ctx(), at(4.0, 4.0, false, false));
        // Shift-click the white background: both patches, which is
        // everything, and everything is the same as no selection at all.
        tool.begin(&mut rig.ctx(), at(15.0, 15.0, true, false));
        assert!(rig.sel.is_none());

        tool.begin(&mut rig.ctx(), at(4.0, 4.0, false, false));
        tool.begin(&mut rig.ctx(), at(4.0, 4.0, false, true));
        assert!(rig.sel.is_none(), "taking it away again leaves nothing");
    }

    #[test]
    fn the_wand_respects_the_tolerance() {
        let mut rig = Rig::new();
        rig.doc.active_layer_mut().raster.set(10, 10, Rgba::opaque(215, 35, 28));
        rig.settings.sample_mode = crate::autoselect::SampleMode::Global;
        let mut tool = MagicWandTool;
        tool.begin(&mut rig.ctx(), at(4.0, 4.0, false, false));
        assert!(rig.sel.contains(10, 10), "a near-enough red, sampled globally");

        rig.settings.tolerance = 0;
        tool.begin(&mut rig.ctx(), at(4.0, 4.0, false, false));
        assert!(!rig.sel.contains(10, 10), "an exact match only");
        assert!(rig.sel.contains(3, 3));
    }

    #[test]
    fn quick_select_grows_the_region_it_is_brushed_over() {
        let mut rig = Rig::new();
        let mut tool = QuickSelectTool::default();
        tool.begin(&mut rig.ctx(), at(4.0, 4.0, false, false));
        tool.finish(&mut rig.ctx(), at(5.0, 5.0, false, false));
        assert!(rig.sel.contains(3, 3), "inside the square");
        assert!(!rig.sel.contains(15, 15), "and not out in the background");
    }

    #[test]
    fn quick_select_puts_the_selection_back_if_the_stroke_is_abandoned() {
        let mut rig = Rig::new();
        rig.sel = Selection::Rect(Rect::new(0, 0, 3, 3));
        let mut tool = QuickSelectTool::default();
        tool.begin(&mut rig.ctx(), at(4.0, 4.0, false, false));
        tool.update(&mut rig.ctx(), at(5.0, 5.0, false, false));
        tool.cancel(&mut rig.ctx());
        assert_eq!(rig.sel, Selection::Rect(Rect::new(0, 0, 3, 3)));
    }

    #[test]
    fn the_refine_brush_adds_to_the_selection_and_alt_takes_away() {
        let mut rig = Rig::new();
        rig.settings.size = 6;
        let mut tool = RefineTool::default();
        tool.begin(&mut rig.ctx(), at(10.0, 10.0, false, false));
        tool.finish(&mut rig.ctx(), at(14.0, 10.0, false, false));
        assert!(rig.sel.contains(10, 10) && rig.sel.contains(14, 10), "painted along the drag");
        assert!(!rig.sel.contains(2, 2));

        // Alt over the same place rubs it out again.
        let mut tool = RefineTool::default();
        tool.begin(&mut rig.ctx(), at(10.0, 10.0, false, true));
        tool.finish(&mut rig.ctx(), at(14.0, 10.0, false, true));
        assert!(!rig.sel.contains(10, 10));
        assert!(!rig.sel.contains(14, 10));
    }

    #[test]
    fn the_refine_brush_builds_on_the_selection_that_is_there() {
        let mut rig = Rig::new();
        rig.sel = Selection::Rect(Rect::new(0, 0, 4, 4));
        rig.settings.size = 6;
        let mut tool = RefineTool::default();
        tool.begin(&mut rig.ctx(), at(14.0, 14.0, false, false));
        tool.finish(&mut rig.ctx(), at(14.0, 14.0, false, false));
        assert!(rig.sel.contains(1, 1), "what was selected before is still selected");
        assert!(rig.sel.contains(14, 14), "and the new dab joined it");
    }

    #[test]
    fn none_of_the_selection_tools_touch_the_pixels() {
        assert!(!ToolKind::Wand.edits_pixels());
        assert!(!ToolKind::QuickSelect.edits_pixels());
        assert!(!ToolKind::Refine.edits_pixels());
    }
}
