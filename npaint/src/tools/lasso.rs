//! The lasso: a selection drawn freehand.
//!
//! The gesture is a run of points, and the selection is the inside of the
//! polygon they close — [`Mask::from_polygon`] does the work, and everything
//! that already understands a mask (the ants, the enforcement, feather and
//! grow) understands this one. Like the marquees it is a [`Gesture::Passive`]
//! tool: it never touches a pixel.
//!
//! The modifiers work as they do on the marquees, held when the drag
//! *starts*: Shift adds, Alt takes away, both keep the overlap.
//!
//! The outline is redrawn on every move, so the selection under the pointer
//! is always the one the mouse button would leave behind. Points closer
//! together than a pixel are dropped on the way in: a slow hand otherwise
//! puts thousands of them on one spot, and none of them change the answer.

use super::{Gesture, PointerEvent, Tool, ToolContext, ToolKind};
use crate::geometry::Point;
use crate::mask::{Mask, SelectMode};
use crate::selection::Selection;

/// How far the pointer must travel before the path takes another point.
const MIN_STEP: f64 = 1.0;

#[derive(Debug, Default)]
pub struct LassoTool {
    drag: Option<Drag>,
}

#[derive(Debug)]
struct Drag {
    points: Vec<Point>,
    /// The selection before the drag, which the new shape combines with.
    base: Selection,
    mode: SelectMode,
}

impl LassoTool {
    /// Takes the point if the hand has moved far enough since the last one.
    fn push(&mut self, pos: Point) {
        if let Some(d) = self.drag.as_mut() {
            match d.points.last() {
                Some(last) if last.distance_to(pos) < MIN_STEP => {}
                _ => d.points.push(pos),
            }
        }
    }

    fn apply(&mut self, ctx: &mut ToolContext) -> bool {
        let Some(d) = self.drag.as_ref() else { return false };
        let bounds = ctx.document.bounds();
        // Fewer than three points is a click, not a loop: a click with no
        // modifier has already dropped the old selection, which is what
        // clicking with a marquee does too.
        if d.points.len() < 3 {
            if d.mode != SelectMode::Replace {
                *ctx.selection = d.base.clone();
            }
            return true;
        }
        let mut mask = Mask::from_polygon(bounds.w as u32, bounds.h as u32, &d.points);
        if ctx.settings.antialias {
            mask.antialias();
        }
        if d.mode == SelectMode::Replace {
            ctx.selection.set_mask(mask);
        } else {
            let mut next = d.base.clone();
            next.combine(&mask, d.mode, bounds);
            *ctx.selection = next;
        }
        true
    }
}

impl Tool for LassoTool {
    fn kind(&self) -> ToolKind {
        ToolKind::Lasso
    }

    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        let mode = SelectMode::from_modifiers(ev.shift, ev.alt);
        let base = ctx.selection.clone();
        if mode == SelectMode::Replace {
            *ctx.selection = Selection::None;
        }
        self.drag = Some(Drag { points: vec![ev.pos], base, mode });
        Gesture::Passive
    }

    fn update(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        if self.drag.is_none() {
            return false;
        }
        self.push(ev.pos);
        self.apply(ctx)
    }

    fn finish(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        if self.drag.is_none() {
            return false;
        }
        self.push(ev.pos);
        let changed = self.apply(ctx);
        self.drag = None;
        changed
    }

    fn cancel(&mut self, ctx: &mut ToolContext) {
        if let Some(d) = self.drag.take() {
            *ctx.selection = d.base;
        }
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

    /// Drives a whole gesture: down at the first point, moves through the
    /// rest, up at the last.
    fn drive(start: Selection, shift: bool, alt: bool, path: &[(f64, f64)]) -> Selection {
        let mut doc = Document::new(20, 20, Rgba::WHITE);
        let mut selection = start;
        let mut settings = ToolSettings { antialias: false, ..ToolSettings::default() };
        let mut tool = LassoTool::default();
        let ev = |(x, y): (f64, f64)| PointerEvent {
            pos: Point::new(x, y),
            screen: Point::new(x, y),
            shift,
            alt,
            pressure: 1.0,
        };
        let mut ctx = ToolContext {
            document: &mut doc,
            selection: &mut selection,
            viewport: &mut Viewport::default(),
            settings: &mut settings,
        };
        let (first, rest) = path.split_first().unwrap();
        tool.begin(&mut ctx, ev(*first));
        let (last, middle) = rest.split_last().unwrap();
        for p in middle {
            tool.update(&mut ctx, ev(*p));
        }
        tool.finish(&mut ctx, ev(*last));
        selection
    }

    const SQUARE: &[(f64, f64)] = &[(4.0, 4.0), (12.0, 4.0), (12.0, 12.0), (4.0, 12.0)];

    #[test]
    fn a_loop_selects_its_inside() {
        let s = drive(Selection::None, false, false, SQUARE);
        assert!(s.contains(8, 8));
        assert!(!s.contains(2, 2));
        // A square loop is a rectangle, and the selection says so: a mask
        // that turns out to be one collapses back into `Selection::Rect`.
        assert_eq!(s, Selection::Rect(Rect::new(4, 4, 8, 8)));

        // A triangle cannot collapse, and stays a mask.
        let s = drive(Selection::None, false, false, &[(2.0, 2.0), (16.0, 2.0), (2.0, 16.0)]);
        assert!(s.mask().is_some());
        assert!(s.contains(3, 3) && !s.contains(15, 15));
    }

    #[test]
    fn the_path_closes_itself() {
        // Three quarters of the square: the lasso joins the last point back
        // to the first, so the open side is closed by the straight run home.
        let s = drive(Selection::None, false, false, &SQUARE[..3]);
        assert!(s.contains(10, 6), "inside the triangle the three points close");
        assert!(!s.contains(5, 11), "and outside it");
    }

    #[test]
    fn a_click_deselects() {
        let s = drive(Selection::Rect(Rect::new(0, 0, 5, 5)), false, false, &[(2.0, 2.0), (2.0, 2.0)]);
        assert_eq!(s, Selection::None, "no loop, no selection");
    }

    #[test]
    fn shift_adds_and_alt_takes_away() {
        let first = Selection::Rect(Rect::new(0, 0, 3, 3));
        let s = drive(first.clone(), true, false, SQUARE);
        assert!(s.contains(1, 1) && s.contains(8, 8), "both");

        let s = drive(Selection::Rect(Rect::new(0, 0, 20, 20)), false, true, SQUARE);
        assert!(s.contains(1, 1), "what the loop missed is still selected");
        assert!(!s.contains(8, 8), "and what it caught is gone");

        // Shift+Alt is the overlap.
        let s = drive(Selection::Rect(Rect::new(0, 0, 8, 8)), true, true, SQUARE);
        assert!(s.contains(6, 6));
        assert!(!s.contains(1, 1) && !s.contains(10, 10));
    }

    #[test]
    fn points_on_the_same_spot_are_dropped() {
        let mut tool = LassoTool {
            drag: Some(Drag { points: vec![Point::new(5.0, 5.0)], base: Selection::None, mode: SelectMode::Replace }),
        };
        tool.push(Point::new(5.2, 5.0));
        tool.push(Point::new(5.4, 5.0));
        assert_eq!(tool.drag.as_ref().unwrap().points.len(), 1, "neither moved a pixel");
        tool.push(Point::new(9.0, 5.0));
        assert_eq!(tool.drag.as_ref().unwrap().points.len(), 2);
    }

    #[test]
    fn cancel_puts_back_what_was_there() {
        let mut doc = Document::new(20, 20, Rgba::WHITE);
        let mut selection = Selection::Rect(Rect::new(0, 0, 4, 4));
        let mut settings = ToolSettings::default();
        let mut tool = LassoTool::default();
        let mut ctx = ToolContext {
            document: &mut doc,
            selection: &mut selection,
            viewport: &mut Viewport::default(),
            settings: &mut settings,
        };
        tool.begin(&mut ctx, PointerEvent::at(8.0, 8.0));
        tool.update(&mut ctx, PointerEvent::at(14.0, 8.0));
        tool.update(&mut ctx, PointerEvent::at(14.0, 14.0));
        tool.cancel(&mut ctx);
        assert_eq!(selection, Selection::Rect(Rect::new(0, 0, 4, 4)));
    }

    #[test]
    fn antialiasing_softens_the_edge() {
        let mut doc = Document::new(20, 20, Rgba::WHITE);
        let mut selection = Selection::None;
        let mut settings = ToolSettings { antialias: true, ..ToolSettings::default() };
        let mut tool = LassoTool::default();
        let mut ctx = ToolContext {
            document: &mut doc,
            selection: &mut selection,
            viewport: &mut Viewport::default(),
            settings: &mut settings,
        };
        tool.begin(&mut ctx, PointerEvent::at(4.0, 4.0));
        for (x, y) in &SQUARE[1..] {
            tool.update(&mut ctx, PointerEvent::at(*x, *y));
        }
        tool.finish(&mut ctx, PointerEvent::at(4.0, 12.0));
        let mask = selection.mask().expect("a mask");
        let soft = (0..20).flat_map(|y| (0..20).map(move |x| (x, y))).filter(|(x, y)| {
            let c = mask.cover(*x, *y);
            c > 0 && c < 255
        });
        assert!(soft.count() > 0, "the rim is partly covered");
    }
}
