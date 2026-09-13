//! Freehand strokes: the brush, the pencil and the eraser.
//!
//! All three are the same gesture — stamp a disc at every pixel the pointer
//! passes — and differ only in what the stamp does. The stroke is built up as
//! a coverage mask and applied to a copy of the layer taken at the start,
//! so overlapping stamps within one stroke do not compound: a 50% brush lays
//! down 50% everywhere it goes, as in Photoshop, rather than growing darker
//! where the pointer slowed down.

use super::{Gesture, PointerEvent, Tool, ToolContext, ToolKind};
use crate::color::Rgba;
use crate::geometry::{Point, Rect};
use crate::raster::Raster;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StrokeMode {
    /// Paints the colour at the brush opacity.
    Brush,
    /// Paints the colour fully opaque, whatever the opacity setting.
    Pencil,
    /// Removes alpha, by the brush opacity.
    Eraser,
}

#[derive(Debug)]
pub struct StrokeTool {
    mode: StrokeMode,
    gesture: Option<InProgress>,
}

#[derive(Debug)]
struct InProgress {
    last: Point,
    /// The active layer as it was before the stroke.
    base: Raster,
    /// Where the stroke has been: alpha 255 for covered pixels.
    mask: Raster,
    /// The bounding box of everything stamped so far, so each update only
    /// re-applies the part of the layer the stroke has reached.
    dirty: Rect,
}

impl StrokeTool {
    pub fn new(mode: StrokeMode) -> StrokeTool {
        StrokeTool { mode, gesture: None }
    }

    fn stamp_to(&mut self, ctx: &mut ToolContext, to: Point) {
        let size = ctx.settings.size.max(1);
        let clip = ctx.clip();
        let Some(g) = self.gesture.as_mut() else { return };
        let all = g.mask.bounds();
        let from = g.last;
        g.mask.stamp_along(from, to, |m, p| m.stamp_disc(p, size, Rgba::WHITE, &all));
        g.last = to;

        let reach = (size as i32) / 2 + 1;
        let (fx, fy) = from.round();
        let (tx, ty) = to.round();
        let segment = Rect::from_corners((fx, fy), (tx, ty)).inflate(reach);
        g.dirty = if g.dirty.is_empty() { segment } else { union(g.dirty, segment) };

        let region = g.dirty.intersect(&clip);
        let layer = ctx.document.active_surface_mut();
        let color = ctx.settings.color;
        let opacity = ctx.settings.opacity;
        let mode = self.mode;
        for y in region.y..region.bottom() {
            for x in region.x..region.right() {
                let covered = g.mask.get(x, y).a > 0;
                let before = g.base.get(x, y);
                let after = if !covered {
                    before
                } else {
                    match mode {
                        StrokeMode::Brush => color.scaled_alpha(opacity).over(before),
                        StrokeMode::Pencil => color.with_alpha(255).over(before),
                        StrokeMode::Eraser => before.scaled_alpha(1.0 - opacity),
                    }
                };
                layer.set(x, y, after);
            }
        }
    }
}

fn union(a: Rect, b: Rect) -> Rect {
    let x0 = a.x.min(b.x);
    let y0 = a.y.min(b.y);
    let x1 = a.right().max(b.right());
    let y1 = a.bottom().max(b.bottom());
    Rect::new(x0, y0, x1 - x0, y1 - y0)
}

impl Tool for StrokeTool {
    fn kind(&self) -> ToolKind {
        match self.mode {
            StrokeMode::Brush => ToolKind::Brush,
            StrokeMode::Pencil => ToolKind::Pencil,
            StrokeMode::Eraser => ToolKind::Eraser,
        }
    }

    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        let layer = ctx.document.active_surface();
        self.gesture = Some(InProgress {
            last: ev.pos,
            base: layer.clone(),
            mask: Raster::new(layer.width(), layer.height()),
            dirty: Rect::default(),
        });
        // A click without movement still lays down one dab.
        self.stamp_to(ctx, ev.pos);
        Gesture::EditsActiveLayer
    }

    fn update(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        if self.gesture.is_none() {
            return false;
        }
        self.stamp_to(ctx, ev.pos);
        true
    }

    fn finish(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let changed = self.update(ctx, ev);
        self.gesture = None;
        changed
    }

    fn cancel(&mut self, ctx: &mut ToolContext) {
        if let Some(g) = self.gesture.take() {
            *ctx.document.active_surface_mut() = g.base;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::Document;
    use crate::selection::Selection;
    use crate::tools::ToolSettings;
    use crate::viewport::Viewport;

    const RED: Rgba = Rgba::opaque(255, 0, 0);

    struct Rig {
        doc: Document,
        selection: Selection,
        viewport: Viewport,
        settings: ToolSettings,
        tool: StrokeTool,
    }

    impl Rig {
        fn new(mode: StrokeMode) -> Rig {
            Rig {
                doc: Document::new(30, 30, Rgba::TRANSPARENT),
                selection: Selection::None,
                viewport: Viewport::default(),
                settings: ToolSettings { color: RED, size: 1, ..ToolSettings::default() },
                tool: StrokeTool::new(mode),
            }
        }

        fn stroke(&mut self, points: &[(f64, f64)]) {
            let mut ctx = ToolContext {
                document: &mut self.doc,
                selection: &mut self.selection,
                viewport: &mut self.viewport,
                settings: &self.settings,
            };
            let (first, rest) = points.split_first().unwrap();
            self.tool.begin(&mut ctx, PointerEvent::at(first.0, first.1));
            for p in rest {
                self.tool.update(&mut ctx, PointerEvent::at(p.0, p.1));
            }
            let last = points.last().unwrap();
            self.tool.finish(&mut ctx, PointerEvent::at(last.0, last.1));
        }

        fn px(&self, x: i32, y: i32) -> Rgba {
            self.doc.active_layer().raster.get(x, y)
        }

        fn painted(&self) -> usize {
            self.doc.active_layer().raster.pixels().iter().filter(|p| p.a > 0).count()
        }
    }

    #[test]
    fn a_click_is_one_dab() {
        let mut rig = Rig::new(StrokeMode::Pencil);
        rig.stroke(&[(5.0, 5.0)]);
        assert_eq!(rig.painted(), 1);
        assert_eq!(rig.px(5, 5), RED);
    }

    #[test]
    fn a_stroke_is_continuous_between_events() {
        let mut rig = Rig::new(StrokeMode::Pencil);
        rig.stroke(&[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)]);
        for i in 0..=10 {
            assert_eq!(rig.px(i, 0), RED, "({i},0)");
            assert_eq!(rig.px(10, i), RED, "(10,{i})");
        }
        assert_eq!(rig.painted(), 21);
    }

    #[test]
    fn brush_opacity_does_not_compound_within_a_stroke() {
        let mut rig = Rig::new(StrokeMode::Brush);
        rig.settings.size = 5;
        rig.settings.opacity = 0.5;
        // Scribble back and forth over the same pixels.
        rig.stroke(&[(5.0, 5.0), (15.0, 5.0), (5.0, 5.0), (15.0, 5.0)]);
        assert_eq!(rig.px(10, 5).a, 128);
        assert_eq!((rig.px(10, 5).r, rig.px(10, 5).g), (255, 0));
    }

    #[test]
    fn separate_strokes_do_compound() {
        let mut rig = Rig::new(StrokeMode::Brush);
        rig.settings.opacity = 0.5;
        rig.stroke(&[(5.0, 5.0)]);
        rig.stroke(&[(5.0, 5.0)]);
        assert!(rig.px(5, 5).a > 128, "got {}", rig.px(5, 5));
    }

    #[test]
    fn pencil_ignores_opacity() {
        let mut rig = Rig::new(StrokeMode::Pencil);
        rig.settings.opacity = 0.1;
        rig.stroke(&[(5.0, 5.0)]);
        assert_eq!(rig.px(5, 5), RED);
    }

    #[test]
    fn eraser_removes_paint() {
        let mut rig = Rig::new(StrokeMode::Eraser);
        rig.doc.active_layer_mut().raster.fill_rect(Rect::new(0, 0, 30, 30), RED, &Rect::new(0, 0, 30, 30));
        rig.settings.size = 3;
        rig.stroke(&[(10.0, 10.0), (20.0, 10.0)]);
        assert_eq!(rig.px(15, 10).a, 0);
        assert_eq!(rig.px(15, 20), RED);
    }

    #[test]
    fn strokes_stay_inside_the_selection() {
        let mut rig = Rig::new(StrokeMode::Pencil);
        rig.selection = Selection::Rect(Rect::new(0, 0, 10, 30));
        rig.settings.size = 6;
        rig.stroke(&[(0.0, 15.0), (29.0, 15.0)]);
        assert_eq!(rig.px(5, 15), RED);
        assert_eq!(rig.px(10, 15), Rgba::TRANSPARENT);
        assert_eq!(rig.px(25, 15), Rgba::TRANSPARENT);
    }

    #[test]
    fn cancel_restores_the_layer() {
        let mut rig = Rig::new(StrokeMode::Pencil);
        let mut ctx = ToolContext {
            document: &mut rig.doc,
            selection: &mut rig.selection,
            viewport: &mut rig.viewport,
            settings: &rig.settings,
        };
        rig.tool.begin(&mut ctx, PointerEvent::at(1.0, 1.0));
        rig.tool.update(&mut ctx, PointerEvent::at(9.0, 9.0));
        rig.tool.cancel(&mut ctx);
        assert_eq!(rig.painted(), 0);
    }

    #[test]
    fn big_brush_paints_a_disc() {
        let mut rig = Rig::new(StrokeMode::Brush);
        rig.settings.size = 9;
        rig.stroke(&[(15.0, 15.0)]);
        let n = rig.painted();
        assert!((55..=70).contains(&n), "a 9px disc covers ~64 pixels, got {n}");
        assert_eq!(rig.px(15, 15), RED);
        assert_eq!(rig.px(15, 10), Rgba::TRANSPARENT, "outside the disc");
    }
}
