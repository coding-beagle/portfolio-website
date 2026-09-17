//! The marquees — rectangular and elliptical — and the crop tool, which
//! is a rectangular marquee whose selection the page then crops to.
//!
//! The modifier keys work as they do in Photoshop: held when the drag
//! *starts*, Shift adds to the selection, Alt takes away, and both keep the
//! overlap. Shift pressed *during* the drag constrains the shape to a
//! square or circle, and Alt during the drag draws it out from the centre.

use super::{constrain_square, Gesture, PointerEvent, Tool, ToolContext, ToolKind};
use crate::geometry::{Point, Rect};
use crate::mask::{Mask, SelectMode};
use crate::selection::Selection;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MarqueeShape {
    Rectangle,
    Ellipse,
}

#[derive(Debug)]
pub struct MarqueeTool {
    shape: MarqueeShape,
    crop: bool,
    drag: Option<Drag>,
}

#[derive(Debug)]
struct Drag {
    start: Point,
    /// The selection before the drag, which the new shape combines with.
    base: Selection,
    mode: SelectMode,
    /// Whether Shift and Alt were down when the drag began: those chose the
    /// mode, and only count as constraints once they have been let go of
    /// and pressed again.
    shift_at_start: bool,
    alt_at_start: bool,
    shift_released: bool,
    alt_released: bool,
}

impl MarqueeTool {
    pub fn new(shape: MarqueeShape, crop: bool) -> MarqueeTool {
        MarqueeTool { shape, crop, drag: None }
    }

    fn rect(d: &Drag, ev: PointerEvent) -> Rect {
        let constrain = ev.shift && (!d.shift_at_start || d.shift_released);
        let centred = ev.alt && (!d.alt_at_start || d.alt_released);
        let end = if constrain { constrain_square(d.start, ev.pos) } else { ev.pos };
        if centred {
            let origin = Point::new(2.0 * d.start.x - end.x, 2.0 * d.start.y - end.y);
            Rect::from_drag(origin, end)
        } else {
            Rect::from_drag(d.start, end)
        }
    }

    fn apply(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let Some(d) = self.drag.as_mut() else { return false };
        if !ev.shift {
            d.shift_released = true;
        }
        if !ev.alt {
            d.alt_released = true;
        }
        let bounds = ctx.document.bounds();
        let rect = Self::rect(d, ev);
        match (self.shape, d.mode) {
            (MarqueeShape::Rectangle, SelectMode::Replace) => ctx.selection.set_rect(rect),
            (MarqueeShape::Rectangle, mode) => {
                let mut next = d.base.clone();
                next.combine(&Mask::from_rect(bounds.w as u32, bounds.h as u32, rect), mode, bounds);
                *ctx.selection = next;
            }
            (MarqueeShape::Ellipse, mode) => {
                let mut mask = ellipse_mask(bounds.w as u32, bounds.h as u32, rect);
                if ctx.settings.antialias {
                    mask.antialias();
                }
                if mode == SelectMode::Replace {
                    ctx.selection.set_mask(mask);
                } else {
                    let mut next = d.base.clone();
                    next.combine(&mask, mode, bounds);
                    *ctx.selection = next;
                }
            }
        }
        true
    }
}

/// The ellipse inscribed in `rect`, as a mask of `w` by `h`.
fn ellipse_mask(w: u32, h: u32, rect: Rect) -> Mask {
    if rect.is_empty() {
        return Mask::new(w, h);
    }
    let cx = f64::from(rect.x) + f64::from(rect.w) / 2.0;
    let cy = f64::from(rect.y) + f64::from(rect.h) / 2.0;
    let rx = f64::from(rect.w) / 2.0;
    let ry = f64::from(rect.h) / 2.0;
    let area = rect.intersect(&Rect::new(0, 0, w as i32, h as i32));
    let mut mask = Mask::new(w, h);
    for y in area.y..area.bottom() {
        for x in area.x..area.right() {
            let dx = (f64::from(x) + 0.5 - cx) / rx;
            let dy = (f64::from(y) + 0.5 - cy) / ry;
            if dx * dx + dy * dy <= 1.0 {
                mask.set(x, y, 255);
            }
        }
    }
    mask.recompute_bounds();
    mask
}

impl Tool for MarqueeTool {
    fn kind(&self) -> ToolKind {
        match (self.shape, self.crop) {
            (_, true) => ToolKind::Crop,
            (MarqueeShape::Rectangle, false) => ToolKind::Select,
            (MarqueeShape::Ellipse, false) => ToolKind::EllipseSelect,
        }
    }

    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        let mode = SelectMode::from_modifiers(ev.shift, ev.alt);
        let base = ctx.selection.clone();
        // A plain click clears the old selection straight away, the way
        // Photoshop does; dragging then grows a new one from nothing. With
        // a modifier the old one is what the drag builds on.
        if mode == SelectMode::Replace {
            *ctx.selection = Selection::None;
        }
        self.drag = Some(Drag {
            start: ev.pos,
            base,
            mode,
            shift_at_start: ev.shift,
            alt_at_start: ev.alt,
            shift_released: false,
            alt_released: false,
        });
        Gesture::Passive
    }

    fn update(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        self.apply(ctx, ev)
    }

    fn finish(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let changed = self.apply(ctx, ev);
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
    use crate::tools::ToolSettings;
    use crate::viewport::Viewport;

    fn drive_with(shape: MarqueeShape, start: Selection, events: &[(&str, PointerEvent)]) -> Selection {
        let mut doc = Document::new(20, 20, Rgba::WHITE);
        let mut selection = start;
        let mut settings = ToolSettings { antialias: false, ..ToolSettings::default() };
        let mut tool = MarqueeTool::new(shape, false);
        for (what, ev) in events {
            let mut ctx = ToolContext { document: &mut doc, selection: &mut selection, viewport: &mut Viewport::default(), settings: &mut settings };
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

    fn drive(events: &[(&str, PointerEvent)]) -> Selection {
        drive_with(MarqueeShape::Rectangle, Selection::None, events)
    }

    fn with(x: f64, y: f64, shift: bool, alt: bool) -> PointerEvent {
        PointerEvent { pos: Point::new(x, y), screen: Point::new(x, y), shift, alt, pressure: 1.0 }
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
    fn shift_during_the_drag_makes_a_square() {
        let s = drive(&[("begin", PointerEvent::at(2.0, 2.0)), ("finish", with(12.0, 4.0, true, false))]);
        assert_eq!(s, Selection::Rect(Rect::new(2, 2, 10, 10)));
    }

    #[test]
    fn alt_during_the_drag_draws_from_the_centre() {
        let s = drive(&[("begin", PointerEvent::at(10.0, 10.0)), ("finish", with(12.0, 13.0, false, true))]);
        assert_eq!(s, Selection::Rect(Rect::new(8, 7, 4, 6)));
    }

    #[test]
    fn shift_at_the_start_adds_and_alt_takes_away() {
        let first = Selection::Rect(Rect::new(0, 0, 4, 4));
        let s = drive_with(
            MarqueeShape::Rectangle,
            first.clone(),
            &[("begin", with(10.0, 10.0, true, false)), ("finish", with(14.0, 12.0, true, false))],
        );
        assert!(s.contains(1, 1) && s.contains(12, 11), "both rectangles");
        assert!(!s.contains(6, 6));
        assert_eq!(s.rect(), Some(Rect::new(0, 0, 14, 12)), "not squared: shift chose the mode");

        let s = drive_with(
            MarqueeShape::Rectangle,
            first.clone(),
            &[("begin", with(2.0, 0.0, false, true)), ("finish", with(4.0, 4.0, false, true))],
        );
        assert_eq!(s, Selection::Rect(Rect::new(0, 0, 2, 4)), "the right half taken away, not drawn from the centre");

        let s = drive_with(
            MarqueeShape::Rectangle,
            first,
            &[("begin", with(2.0, 2.0, true, true)), ("finish", with(10.0, 10.0, true, true))],
        );
        assert_eq!(s, Selection::Rect(Rect::new(2, 2, 2, 2)), "the overlap");
    }

    #[test]
    fn shift_let_go_and_pressed_again_constrains_after_all() {
        let s = drive_with(
            MarqueeShape::Rectangle,
            Selection::Rect(Rect::new(0, 0, 2, 2)),
            &[
                ("begin", with(10.0, 10.0, true, false)),
                ("update", with(12.0, 11.0, false, false)),
                ("finish", with(16.0, 12.0, true, false)),
            ],
        );
        assert!(s.contains(15, 15), "squared to 6x6");
        assert!(s.contains(1, 1), "and still added to what was there");
    }

    #[test]
    fn an_ellipse_is_rounder_than_its_box() {
        let s = drive_with(MarqueeShape::Ellipse, Selection::None, &[("begin", PointerEvent::at(2.0, 2.0)), ("finish", PointerEvent::at(14.0, 14.0))]);
        assert!(s.mask().is_some(), "not a rectangle");
        assert!(s.contains(8, 8));
        assert!(!s.contains(2, 2), "the corner is outside");
        assert!(s.contains(8, 2), "the top of the disc is inside");
        let s = drive_with(MarqueeShape::Ellipse, Selection::None, &[("begin", PointerEvent::at(2.0, 2.0)), ("finish", with(14.0, 5.0, true, false))]);
        assert_eq!(s.rect(), Some(Rect::new(2, 2, 12, 12)), "shift makes a circle");
    }

    #[test]
    fn a_marquee_may_be_dragged_past_the_document() {
        // Where a layer may be holding pixels a move pushed out there; only
        // a rectangle can say so, a mask being the size of the document.
        let s = drive(&[("begin", PointerEvent::at(15.0, 15.0)), ("finish", PointerEvent::at(40.0, 40.0))]);
        assert_eq!(s, Selection::Rect(Rect::new(15, 15, 25, 25)));
        let e = drive(&[("begin", PointerEvent::at(15.0, 15.0)), ("finish", PointerEvent::at(40.0, 40.0))]);
        assert_eq!(e.clip(Rect::new(0, 0, 20, 20)), Rect::new(15, 15, 5, 5), "what may be painted is not");
    }

    #[test]
    fn cancel_puts_back_what_was_there() {
        let s = drive(&[
            ("begin", PointerEvent::at(2.0, 3.0)),
            ("update", PointerEvent::at(6.0, 4.0)),
            ("cancel", PointerEvent::default()),
        ]);
        assert_eq!(s, Selection::None);
        let s = drive_with(
            MarqueeShape::Rectangle,
            Selection::Rect(Rect::new(0, 0, 2, 2)),
            &[("begin", with(5.0, 5.0, true, false)), ("update", with(9.0, 9.0, true, false)), ("cancel", PointerEvent::default())],
        );
        assert_eq!(s, Selection::Rect(Rect::new(0, 0, 2, 2)));
    }

    #[test]
    fn the_crop_tool_is_a_marquee_by_another_name() {
        let mut tool = MarqueeTool::new(MarqueeShape::Rectangle, true);
        assert_eq!(tool.kind(), ToolKind::Crop);
        let mut doc = Document::new(20, 20, Rgba::WHITE);
        let mut selection = Selection::None;
        let mut settings = ToolSettings::default();
        let mut ctx = ToolContext { document: &mut doc, selection: &mut selection, viewport: &mut Viewport::default(), settings: &mut settings };
        tool.begin(&mut ctx, PointerEvent::at(1.0, 1.0));
        tool.finish(&mut ctx, PointerEvent::at(5.0, 5.0));
        assert_eq!(selection, Selection::Rect(Rect::new(1, 1, 4, 4)));
    }
}
