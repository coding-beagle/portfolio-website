//! Rubber-band shapes: line, rectangle, ellipse.
//!
//! Dragging shows the shape live. Rather than a separate preview layer, the
//! tool keeps the layer as it was when the drag began and redraws the shape
//! onto a fresh copy of it on every move — simple, and the composite the page
//! renders is always the real document.

use super::{constrain_angle, constrain_square, Gesture, PointerEvent, Tool, ToolContext, ToolKind};
use crate::geometry::{Point, Rect};
use crate::raster::Raster;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    Line,
    Rectangle,
    Ellipse,
}

#[derive(Debug)]
pub struct ShapeTool {
    shape: Shape,
    gesture: Option<(Point, Raster)>,
}

impl ShapeTool {
    pub fn new(shape: Shape) -> ShapeTool {
        ShapeTool { shape, gesture: None }
    }

    /// The rectangle a rectangle/ellipse drag describes, after the modifiers.
    /// Shift constrains to a square; alt draws out from the centre.
    fn drag_rect(start: Point, ev: PointerEvent) -> Rect {
        let end = if ev.shift { constrain_square(start, ev.pos) } else { ev.pos };
        if ev.alt {
            let origin = Point::new(2.0 * start.x - end.x, 2.0 * start.y - end.y);
            Rect::from_drag(origin, end)
        } else {
            Rect::from_drag(start, end)
        }
    }

    fn draw(&mut self, ctx: &mut ToolContext, ev: PointerEvent) {
        let Some((start, base)) = self.gesture.as_ref() else { return };
        let start = *start;
        let clip = ctx.clip();
        let settings = ctx.settings;
        let size = settings.size.max(1);
        let raster = ctx.document.active_surface_mut();
        *raster = base.clone();
        match self.shape {
            Shape::Line => {
                let end = if ev.shift { constrain_angle(start, ev.pos) } else { ev.pos };
                raster.draw_line(start, end, size, settings.color, &clip);
            }
            Shape::Rectangle => {
                let rect = Self::drag_rect(start, ev);
                if settings.fill {
                    raster.fill_rect(rect, settings.color, &clip);
                } else {
                    raster.stroke_rect(rect, size, settings.color, &clip);
                }
            }
            Shape::Ellipse => {
                let rect = Self::drag_rect(start, ev);
                if settings.fill {
                    raster.fill_ellipse(rect, settings.color, &clip);
                } else {
                    raster.stroke_ellipse(rect, size, settings.color, &clip);
                }
            }
        }
    }
}

impl Tool for ShapeTool {
    fn kind(&self) -> ToolKind {
        match self.shape {
            Shape::Line => ToolKind::Line,
            Shape::Rectangle => ToolKind::Rectangle,
            Shape::Ellipse => ToolKind::Ellipse,
        }
    }

    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        self.gesture = Some((ev.pos, ctx.document.active_surface().clone()));
        Gesture::EditsActiveLayer
    }

    fn update(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        if self.gesture.is_none() {
            return false;
        }
        self.draw(ctx, ev);
        true
    }

    fn finish(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let changed = self.update(ctx, ev);
        self.gesture = None;
        changed
    }

    fn cancel(&mut self, ctx: &mut ToolContext) {
        if let Some((_, base)) = self.gesture.take() {
            *ctx.document.active_surface_mut() = base;
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

    fn run(shape: Shape, settings: ToolSettings, selection: Selection, start: PointerEvent, moves: &[PointerEvent]) -> Raster {
        let mut doc = Document::new(20, 20, Rgba::TRANSPARENT);
        let mut selection = selection;
        let mut tool = ShapeTool::new(shape);
        let mut ctx = ToolContext { document: &mut doc, selection: &mut selection, viewport: &mut Viewport::default(), settings: &settings };
        tool.begin(&mut ctx, start);
        let (last, rest) = moves.split_last().unwrap();
        for ev in rest {
            tool.update(&mut ctx, *ev);
        }
        tool.finish(&mut ctx, *last);
        doc.active_layer().raster.clone()
    }

    fn settings() -> ToolSettings {
        ToolSettings { color: RED, size: 1, ..ToolSettings::default() }
    }

    fn painted(r: &Raster) -> usize {
        r.pixels().iter().filter(|p| p.a > 0).count()
    }

    #[test]
    fn a_filled_rectangle_covers_the_drag() {
        let r = run(Shape::Rectangle, settings(), Selection::None, PointerEvent::at(2.0, 2.0), &[PointerEvent::at(6.0, 5.0)]);
        assert_eq!(painted(&r), 12);
        assert_eq!(r.get(2, 2), RED);
        assert_eq!(r.get(5, 4), RED);
        assert_eq!(r.get(6, 5), Rgba::TRANSPARENT);
    }

    #[test]
    fn only_the_final_position_is_kept() {
        let r = run(
            Shape::Rectangle,
            settings(),
            Selection::None,
            PointerEvent::at(0.0, 0.0),
            &[PointerEvent::at(19.0, 19.0), PointerEvent::at(2.0, 2.0)],
        );
        assert_eq!(painted(&r), 4, "the earlier, larger preview must be gone");
    }

    #[test]
    fn outline_mode_strokes() {
        let s = ToolSettings { fill: false, ..settings() };
        let r = run(Shape::Rectangle, s, Selection::None, PointerEvent::at(0.0, 0.0), &[PointerEvent::at(5.0, 5.0)]);
        assert_eq!(painted(&r), 16);
        assert_eq!(r.get(2, 2), Rgba::TRANSPARENT);
    }

    #[test]
    fn shift_constrains_to_a_square() {
        let ev = PointerEvent { pos: Point::new(10.0, 3.0), screen: Point::new(10.0, 3.0), shift: true, alt: false };
        let r = run(Shape::Rectangle, settings(), Selection::None, PointerEvent::at(0.0, 0.0), &[ev]);
        assert_eq!(painted(&r), 100);
    }

    #[test]
    fn alt_draws_from_the_centre() {
        let ev = PointerEvent { pos: Point::new(12.0, 12.0), screen: Point::new(12.0, 12.0), shift: false, alt: true };
        let r = run(Shape::Rectangle, settings(), Selection::None, PointerEvent::at(10.0, 10.0), &[ev]);
        assert_eq!(r.get(8, 8), RED);
        assert_eq!(r.get(11, 11), RED);
        assert_eq!(r.get(12, 12), Rgba::TRANSPARENT);
        assert_eq!(painted(&r), 16);
    }

    #[test]
    fn ellipse_is_rounder_than_its_box() {
        let r = run(Shape::Ellipse, settings(), Selection::None, PointerEvent::at(0.0, 0.0), &[PointerEvent::at(11.0, 11.0)]);
        assert_eq!(r.get(0, 0), Rgba::TRANSPARENT);
        assert_eq!(r.get(5, 5), RED);
        assert!(painted(&r) < 121);
    }

    #[test]
    fn line_connects_its_ends() {
        let r = run(Shape::Line, settings(), Selection::None, PointerEvent::at(1.0, 1.0), &[PointerEvent::at(10.0, 1.0)]);
        assert_eq!(painted(&r), 10);
        assert_eq!(r.get(1, 1), RED);
        assert_eq!(r.get(10, 1), RED);
    }

    #[test]
    fn shift_snaps_a_line_to_45_degrees() {
        let ev = PointerEvent { pos: Point::new(10.0, 1.0), screen: Point::new(10.0, 1.0), shift: true, alt: false };
        let r = run(Shape::Line, settings(), Selection::None, PointerEvent::at(0.0, 0.0), &[ev]);
        assert_eq!(r.get(10, 0), RED);
        assert_eq!(r.get(10, 1), Rgba::TRANSPARENT);
    }

    #[test]
    fn shapes_are_clipped_by_the_selection() {
        let sel = Selection::Rect(Rect::new(0, 0, 5, 20));
        let r = run(Shape::Rectangle, settings(), sel, PointerEvent::at(0.0, 0.0), &[PointerEvent::at(20.0, 20.0)]);
        assert_eq!(painted(&r), 100);
        assert_eq!(r.get(5, 0), Rgba::TRANSPARENT);
    }

    #[test]
    fn cancel_puts_the_layer_back() {
        let mut doc = Document::new(5, 5, Rgba::WHITE);
        let mut selection = Selection::None;
        let settings = settings();
        let mut tool = ShapeTool::new(Shape::Ellipse);
        let mut ctx = ToolContext { document: &mut doc, selection: &mut selection, viewport: &mut Viewport::default(), settings: &settings };
        tool.begin(&mut ctx, PointerEvent::at(0.0, 0.0));
        tool.update(&mut ctx, PointerEvent::at(4.0, 4.0));
        assert_eq!(doc.active_layer().raster.get(2, 2), RED);
        let mut ctx = ToolContext { document: &mut doc, selection: &mut selection, viewport: &mut Viewport::default(), settings: &settings };
        tool.cancel(&mut ctx);
        assert_eq!(doc.active_layer().raster.get(2, 2), Rgba::WHITE);
    }
}
