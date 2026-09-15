//! Freehand strokes: the brush, the pencil and the eraser.
//!
//! All three are the same gesture — stamp a dab at every pixel the pointer
//! passes — and differ only in what the stamp does. The stroke is built up as
//! a coverage mask and applied to a copy of the layer taken at the start,
//! so overlapping stamps within one stroke do not compound: a 50% brush lays
//! down 50% everywhere it goes, as in Photoshop, rather than growing darker
//! where the pointer slowed down. The shape of the dab is the brush tip
//! ([`crate::brush::BrushTip`]): a disc soft at the rim by the brush's
//! hardness, or a square, a nib, chalk or spatter. Where the coverage is
//! partial the paint is mixed in by that much; the pencil is always hard.
//!
//! Shift-clicking joins the new stroke to where the last one ended with a
//! straight line, as in Photoshop, so a run of Shift-clicks draws a polyline.

use super::{Gesture, PointerEvent, Tool, ToolContext, ToolKind};
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
    /// Where the previous stroke ended, for Shift-click to draw a line from.
    previous_end: Option<Point>,
    /// What the last stamp changed, for [`Tool::dirtied`].
    touched: Option<Rect>,
}

#[derive(Debug)]
struct InProgress {
    last: Point,
    /// The active layer as it was before the stroke.
    base: Raster,
    /// Where the stroke has been: alpha 255 for covered pixels.
    mask: Raster,
}

impl StrokeTool {
    pub fn new(mode: StrokeMode) -> StrokeTool {
        StrokeTool { mode, gesture: None, previous_end: None, touched: None }
    }

    fn stamp_to(&mut self, ctx: &mut ToolContext, to: Point) {
        let size = ctx.settings.size.max(1);
        let hardness = if self.mode == StrokeMode::Pencil { 1.0 } else { ctx.settings.hardness };
        let clip = ctx.clip();
        self.touched = None;
        let Some(g) = self.gesture.as_mut() else { return };
        let all = g.mask.bounds();
        let from = g.last;
        let tip = ctx.settings.tip;
        stamp_spaced(from, to, spacing(size), |p| tip.stamp(&mut g.mask, p, size, hardness, &all));
        g.last = to;

        let reach = (size as i32) / 2 + 1;
        let (fx, fy) = from.round();
        let (tx, ty) = to.round();
        // Coverage only grew within this segment's reach, and each pixel's
        // result depends only on its coverage and the base, so only that
        // part needs re-blending; the rest of the stroke is already right.
        let segment = Rect::from_corners((fx, fy), (tx, ty)).inflate(reach);
        let region = segment.intersect(&clip);
        let layer = ctx.document.active_surface_mut();
        let color = ctx.settings.color;
        let opacity = ctx.settings.opacity;
        let mode = self.mode;
        for y in region.y..region.bottom() {
            for x in region.x..region.right() {
                let mut cover = g.mask.get(x, y).a;
                // The pencil is hard whatever the tip: a grain of chalk is
                // a whole pixel or nothing.
                if mode == StrokeMode::Pencil && cover > 0 {
                    cover = 255;
                }
                let before = g.base.get(x, y);
                let after = if cover == 0 {
                    before
                } else {
                    let full = match mode {
                        StrokeMode::Brush => color.scaled_alpha(opacity).over(before),
                        StrokeMode::Pencil => color.with_alpha(255).over(before),
                        StrokeMode::Eraser => before.scaled_alpha(1.0 - opacity),
                    };
                    if cover == 255 { full } else { before.lerp(full, f32::from(cover) / 255.0) }
                };
                layer.set(x, y, after);
            }
        }
        self.touched = Some(region);
    }
}

/// How far apart the discs along a stroke are stamped, in pixels. Coverage
/// combines by maximum, so discs a small fraction of their diameter apart
/// merge into a band whose edge dips by well under a pixel between stamps,
/// while costing that fraction of stamping at every pixel.
fn spacing(size: u32) -> f64 {
    f64::from(size / 16).max(1.0)
}

/// Calls `stamp` at points from `a` to `b` no more than `spacing` apart,
/// always including `b`, and `a` too when the two are the same.
fn stamp_spaced(a: Point, b: Point, spacing: f64, mut stamp: impl FnMut(Point)) {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let len = dx.hypot(dy);
    let steps = (len / spacing).ceil().max(1.0);
    for i in 0..=steps as u32 {
        let t = f64::from(i) / steps;
        stamp(Point::new(a.x + dx * t, a.y + dy * t));
    }
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
        // With Shift, the stroke starts where the last one ended, so the
        // first stamp draws a straight line from there to the click.
        let from = if ev.shift { self.previous_end.unwrap_or(ev.pos) } else { ev.pos };
        self.gesture = Some(InProgress {
            last: from,
            base: layer.clone(),
            mask: Raster::new(layer.width(), layer.height()),
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
        self.previous_end = self.gesture.take().map(|g| g.last);
        changed
    }

    fn cancel(&mut self, ctx: &mut ToolContext) {
        if let Some(g) = self.gesture.take() {
            *ctx.document.active_surface_mut() = g.base;
        }
        self.touched = None;
    }

    fn dirtied(&self) -> Option<Rect> {
        self.touched
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
            self.stroke_with(points, false);
        }

        /// A stroke whose every event carries the Shift state.
        fn stroke_with(&mut self, points: &[(f64, f64)], shift: bool) {
            let at = |x: f64, y: f64| PointerEvent { shift, ..PointerEvent::at(x, y) };
            let mut ctx = ToolContext {
                document: &mut self.doc,
                selection: &mut self.selection,
                viewport: &mut self.viewport,
                settings: &mut self.settings,
            };
            let (first, rest) = points.split_first().unwrap();
            self.tool.begin(&mut ctx, at(first.0, first.1));
            for p in rest {
                self.tool.update(&mut ctx, at(p.0, p.1));
            }
            let last = points.last().unwrap();
            self.tool.finish(&mut ctx, at(last.0, last.1));
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
    fn shift_click_draws_a_line_from_where_the_last_stroke_ended() {
        let mut rig = Rig::new(StrokeMode::Pencil);
        rig.stroke(&[(0.0, 0.0), (5.0, 0.0)]);
        rig.stroke_with(&[(5.0, 10.0)], true);
        for i in 0..=10 {
            assert_eq!(rig.px(5, i), RED, "(5,{i})");
        }
        assert_eq!(rig.painted(), 16);
        // And the next Shift-click continues from there.
        rig.stroke_with(&[(15.0, 10.0)], true);
        assert_eq!(rig.px(10, 10), RED);
        assert_eq!(rig.painted(), 26);
    }

    #[test]
    fn a_plain_click_does_not_join_to_the_last_stroke() {
        let mut rig = Rig::new(StrokeMode::Pencil);
        rig.stroke(&[(0.0, 0.0)]);
        rig.stroke(&[(10.0, 0.0)]);
        assert_eq!(rig.painted(), 2);
    }

    #[test]
    fn the_first_shift_click_is_just_a_dab() {
        let mut rig = Rig::new(StrokeMode::Pencil);
        rig.stroke_with(&[(10.0, 10.0)], true);
        assert_eq!(rig.painted(), 1);
    }

    #[test]
    fn a_wide_stroke_has_no_gaps_between_its_spaced_stamps() {
        let mut rig = Rig::new(StrokeMode::Pencil);
        rig.doc = Document::new(100, 100, Rgba::TRANSPARENT);
        rig.settings.size = 48;
        rig.stroke(&[(10.0, 50.0), (90.0, 50.0)]);
        for x in 10..=90 {
            assert_eq!(rig.px(x, 50), RED, "centre ({x},50)");
            assert_eq!(rig.px(x, 27), RED, "top edge ({x},27)");
            assert_eq!(rig.px(x, 73), RED, "bottom edge ({x},73)");
        }
        assert_eq!(rig.px(50, 25), Rgba::TRANSPARENT);
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
            settings: &mut rig.settings,
        };
        rig.tool.begin(&mut ctx, PointerEvent::at(1.0, 1.0));
        rig.tool.update(&mut ctx, PointerEvent::at(9.0, 9.0));
        rig.tool.cancel(&mut ctx);
        assert_eq!(rig.painted(), 0);
    }

    #[test]
    fn a_soft_brush_fades_at_the_rim_and_the_pencil_never_does() {
        let mut rig = Rig::new(StrokeMode::Brush);
        rig.settings.size = 15;
        rig.settings.hardness = 0.0;
        rig.stroke(&[(15.0, 15.0)]);
        assert_eq!(rig.px(15, 15), RED, "solid in the middle");
        let rim = rig.px(15, 9).a;
        assert!(rim > 0 && rim < 255, "faint at the rim: {rim}");
        assert_eq!((rig.px(15, 9).r, rig.px(15, 9).g), (255, 0), "but still red");

        let mut rig = Rig::new(StrokeMode::Pencil);
        rig.settings.size = 15;
        rig.settings.hardness = 0.0;
        rig.stroke(&[(15.0, 15.0)]);
        assert_eq!(rig.px(15, 9), RED, "the pencil is hard whatever the setting");
    }

    #[test]
    fn the_tip_shapes_the_stroke() {
        use crate::brush::BrushTip;
        let mut rig = Rig::new(StrokeMode::Brush);
        rig.settings.size = 9;
        rig.settings.tip = BrushTip::Square;
        rig.stroke(&[(15.0, 15.0)]);
        assert_eq!(rig.painted(), 81, "a 9px square dab is 81 pixels");
        assert_eq!(rig.px(11, 11), RED, "corners included");

        let mut rig = Rig::new(StrokeMode::Pencil);
        rig.settings.size = 9;
        rig.settings.tip = BrushTip::Chalk;
        rig.stroke(&[(5.0, 15.0), (25.0, 15.0)]);
        let n = rig.painted();
        assert!(n > 0 && n < 21 * 9, "grainy: {n} of the band");
        assert!(rig.doc.active_layer().raster.pixels().iter().all(|p| p.a == 0 || *p == RED), "the pencil keeps chalk hard");
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

