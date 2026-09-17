//! Freehand strokes: the brush, the pencil, the eraser, the clone stamp and
//! the healing brush.
//!
//! All five are the same gesture — stamp a dab at every pixel the pointer
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
//!
//! The clone stamp is the one that reads pixels to write them: Alt-click
//! sets the source anchor, and the first stroke after that fixes the offset
//! from the pointer to the source, which the dab then copies from. The
//! pixels it reads are a copy taken when the stroke began, so painting over
//! the source does not feed back into itself. *Aligned* keeps that offset
//! across strokes, so a run of separate strokes rebuilds one continuous
//! copy; without it every stroke starts from the anchor again.
//!
//! The healing brush is that same copy with the seam taken out of it. While
//! the pointer is down it is the clone stamp exactly; when the pointer comes
//! up, the whole of what the stroke covered is blended into its surroundings
//! in the gradient domain (see [`crate::heal`]), so the patch keeps its
//! texture and takes on the tone of where it landed. Photoshop's does the
//! same thing at the same moment, and for the same reason: the blend is over
//! the whole stroke, which is not something a dab at a time can give.
//!
//! Three settings shape the path before it is stamped. *Smoothing* makes
//! the brush trail the pointer — each event moves the brush only part of
//! the way towards it — which rounds off the jitter of a hand; the stroke
//! catches up to the pointer when it ends. *Pressure* from a pen scales the
//! dab. *Symmetry* lays every segment down again at its mirror images and
//! turns about the canvas centre, all into the one coverage mask, so the
//! copies never compound where they meet.

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
    /// Paints what is at the same offset from the pointer as the source
    /// anchor was when the stroke began.
    Clone,
    /// The clone stamp, with the copy blended into its surroundings when the
    /// stroke ends so that no seam shows.
    Heal,
}

impl StrokeMode {
    /// Whether the mode paints pixels read from elsewhere in the picture,
    /// which is what needs a source anchor and an offset.
    fn copies_pixels(self) -> bool {
        matches!(self, StrokeMode::Clone | StrokeMode::Heal)
    }
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
    /// Everything the stroke has stamped, clipped — the healing brush's
    /// working area, and cheaper to accumulate here than to find by
    /// searching the mask when the stroke ends.
    covered: Rect,
    /// Clone only: the pixels to copy from, as they were when the stroke
    /// began, and how far they are from the pointer.
    source: Option<CloneSource>,
}

#[derive(Debug)]
struct CloneSource {
    pixels: Raster,
    dx: i32,
    dy: i32,
}

/// How far the clone stamp's source is from a stroke starting at `at`: the
/// offset already in force while that is what the next dab would use, and
/// the one the anchor gives otherwise. None when nothing has been anchored.
///
/// Whole pixels: the stamp is a straight copy, so a fractional offset would
/// only blur what it was asked to reproduce exactly.
pub fn clone_offset_for(settings: &super::ToolSettings, at: Point) -> Option<(i32, i32)> {
    let anchor = settings.clone_anchor?;
    match settings.clone_offset {
        Some(kept) if settings.clone_aligned => Some(kept),
        _ => Some(((anchor.x - at.x).round() as i32, (anchor.y - at.y).round() as i32)),
    }
}

/// How far the brush moves towards the pointer on each event, for a
/// smoothing setting: all the way at 0, a twentieth of the way at 1.
fn follow(smoothing: f32) -> f64 {
    1.0 - 0.95 * f64::from(smoothing.clamp(0.0, 1.0))
}

impl StrokeTool {
    pub fn new(mode: StrokeMode) -> StrokeTool {
        StrokeTool { mode, gesture: None, previous_end: None, touched: None }
    }

    /// The pixels a clone stroke starting at `at` should copy from, or None
    /// when no source anchor has been set yet.
    fn clone_source(&mut self, ctx: &mut ToolContext, at: Point) -> Option<CloneSource> {
        let (dx, dy) = clone_offset_for(ctx.settings, at)?;
        ctx.settings.clone_offset = Some((dx, dy));
        Some(CloneSource { pixels: ctx.sample(), dx, dy })
    }

    fn stamp_to(&mut self, ctx: &mut ToolContext, to: Point, pressure: f64) {
        let mut size = ctx.settings.size.max(1);
        if ctx.settings.pressure_size {
            size = ((f64::from(size) * pressure.clamp(0.0, 1.0)).round() as u32).max(1);
        }
        let hardness = if self.mode == StrokeMode::Pencil { 1.0 } else { ctx.settings.hardness };
        let clip = ctx.clip();
        self.touched = None;
        let Some(g) = self.gesture.as_mut() else { return };
        let all = g.mask.bounds();
        let from = g.last;
        let tip = ctx.settings.tip;
        let bounds = ctx.document.bounds();
        let centre = Point::new(f64::from(bounds.w) / 2.0, f64::from(bounds.h) / 2.0);
        let froms = ctx.settings.symmetry.images(from, centre);
        let tos = ctx.settings.symmetry.images(to, centre);
        let reach = (size as i32) / 2 + 1;
        let mut segment = Rect::default();
        for (a, b) in froms.iter().zip(&tos) {
            stamp_spaced(*a, *b, spacing(size), |p| tip.stamp(&mut g.mask, p, size, hardness, &all));
            // Coverage only grew within each segment's reach, and each
            // pixel's result depends only on its coverage and the base, so
            // only that part needs re-blending; the rest of the stroke is
            // already right.
            segment = segment.union(&Rect::from_corners(a.round(), b.round()).inflate(reach));
        }
        g.last = to;
        let region = segment.intersect(&clip);
        g.covered = g.covered.union(&region);
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
                        // Off the edge of the source the copy has nothing to
                        // lay down, and `Raster::get` says so with a
                        // transparent pixel that leaves `before` as it was.
                        StrokeMode::Clone | StrokeMode::Heal => match &g.source {
                            Some(src) => src.pixels.get(x + src.dx, y + src.dy).scaled_alpha(opacity).over(before),
                            None => before,
                        },
                    };
                    if cover == 255 { full } else { before.lerp(full, f32::from(cover) / 255.0) }
                };
                layer.set(x, y, after);
            }
        }
        self.touched = Some(region);
    }

    /// The healing brush's second half: the whole of what the stroke copied,
    /// pulled into tone with what surrounds it, once the pointer is up.
    ///
    /// The grid handed to the solver is the stroke's area grown by a pixel,
    /// so its outermost ring is picture the stroke never touched and is
    /// where the correction is pinned; everything inside is solved for. The
    /// answer is added to the copied pixels, which are then laid over the
    /// layer exactly as the clone stamp laid them, coverage and opacity and
    /// all — so a soft rim stays soft and a selection still holds.
    fn blend_seam(&mut self, ctx: &mut ToolContext) {
        let opacity = ctx.settings.opacity;
        let bounds = ctx.document.bounds();
        let Some(g) = self.gesture.as_ref() else { return };
        let Some(source) = g.source.as_ref() else { return };
        if g.covered.is_empty() {
            return;
        }
        let grid = g.covered.inflate(1);
        let (width, height) = (grid.w as usize, grid.h as usize);
        // Both sides of the difference come from the one sampled picture, so
        // that "all layers" compares like with like: where the copy is read
        // from, and where it is going. Past the edge of the picture there is
        // nothing to match, so the nearest pixel that is in it stands in.
        let read = |x: i32, y: i32| {
            let inside_x = x.clamp(bounds.x, bounds.right() - 1);
            let inside_y = y.clamp(bounds.y, bounds.bottom() - 1);
            let here = source.pixels.get(inside_x, inside_y);
            (here, source.pixels.get(inside_x + source.dx, inside_y + source.dy))
        };
        let mut known = vec![[0.0f32; 3]; width * height];
        let mut unknown = vec![false; width * height];
        for row in 0..height {
            for column in 0..width {
                let (x, y) = (grid.x + column as i32, grid.y + row as i32);
                let i = row * width + column;
                unknown[i] = g.covered.contains(x, y) && g.mask.get(x, y).a > 0;
                let (here, copied) = read(x, y);
                // Transparent on either side is no colour to match, and a
                // difference taken against one would be a difference against
                // whatever happens to be stored under it.
                if here.a > 0 && copied.a > 0 {
                    known[i] = [
                        f32::from(here.r) - f32::from(copied.r),
                        f32::from(here.g) - f32::from(copied.g),
                        f32::from(here.b) - f32::from(copied.b),
                    ];
                }
            }
        }
        let correction = crate::heal::harmonic_fill(&known, &unknown, width, height);
        let layer = ctx.document.active_surface_mut();
        for row in 0..height {
            for column in 0..width {
                let i = row * width + column;
                if !unknown[i] {
                    continue;
                }
                let (x, y) = (grid.x + column as i32, grid.y + row as i32);
                let copied = source.pixels.get(x + source.dx, y + source.dy);
                let before = g.base.get(x, y);
                if copied.a == 0 {
                    continue;
                }
                let healed = Rgba::new(
                    level(f32::from(copied.r) + correction[i][0]),
                    level(f32::from(copied.g) + correction[i][1]),
                    level(f32::from(copied.b) + correction[i][2]),
                    copied.a,
                );
                let full = healed.scaled_alpha(opacity).over(before);
                let cover = g.mask.get(x, y).a;
                let after =
                    if cover == 255 { full } else { before.lerp(full, f32::from(cover) / 255.0) };
                layer.set(x, y, after);
            }
        }
        let covered = g.covered;
        self.touched = Some(self.touched.map_or(covered, |already| already.union(&covered)));
    }
}

/// A corrected channel back in the 0..=255 a picture is kept in.
fn level(value: f32) -> u8 {
    value.clamp(0.0, 255.0).round() as u8
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
            StrokeMode::Clone => ToolKind::Clone,
            StrokeMode::Heal => ToolKind::Heal,
        }
    }

    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        if self.mode.copies_pixels() {
            // Alt-click marks where to copy from; it paints nothing, and the
            // offset the last anchor gave is no longer the one in force.
            if ev.alt {
                ctx.settings.clone_anchor = Some(ev.pos);
                ctx.settings.clone_offset = None;
                return Gesture::Passive;
            }
            if ctx.settings.clone_anchor.is_none() {
                return Gesture::Passive;
            }
        }
        let source = if self.mode.copies_pixels() { self.clone_source(ctx, ev.pos) } else { None };
        let layer = ctx.document.active_surface();
        // With Shift, the stroke starts where the last one ended, so the
        // first stamp draws a straight line from there to the click.
        let from = if ev.shift { self.previous_end.unwrap_or(ev.pos) } else { ev.pos };
        self.gesture = Some(InProgress {
            last: from,
            base: layer.clone(),
            mask: Raster::new(layer.width(), layer.height()),
            covered: Rect::default(),
            source,
        });
        // A click without movement still lays down one dab.
        self.stamp_to(ctx, ev.pos, ev.pressure);
        Gesture::EditsActiveLayer
    }

    fn update(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        let Some(g) = self.gesture.as_ref() else { return false };
        // Smoothing: the brush goes only part of the way to the pointer.
        let k = follow(ctx.settings.smoothing);
        let to = Point::new(g.last.x + (ev.pos.x - g.last.x) * k, g.last.y + (ev.pos.y - g.last.y) * k);
        self.stamp_to(ctx, to, ev.pressure);
        true
    }

    fn finish(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        if self.gesture.is_none() {
            return false;
        }
        // The stroke ends where the pointer is, smoothing or no smoothing.
        self.stamp_to(ctx, ev.pos, ev.pressure);
        if self.mode == StrokeMode::Heal {
            self.blend_seam(ctx);
        }
        self.previous_end = self.gesture.take().map(|g| g.last);
        true
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
    const GREEN: Rgba = Rgba::opaque(0, 255, 0);

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
            self.gesture(points, shift, false);
        }

        /// One Alt-click, which is how the clone stamp is given its source.
        fn alt_click(&mut self, x: f64, y: f64) {
            self.gesture(&[(x, y)], false, true);
        }

        fn gesture(&mut self, points: &[(f64, f64)], shift: bool, alt: bool) {
            let at = |x: f64, y: f64| PointerEvent { shift, alt, ..PointerEvent::at(x, y) };
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
    fn smoothing_rounds_a_corner_off_and_still_ends_at_the_pointer() {
        let mut rig = Rig::new(StrokeMode::Pencil);
        rig.stroke(&[(5.0, 5.0), (25.0, 5.0), (25.0, 25.0)]);
        assert_eq!(rig.px(25, 5), RED, "no smoothing: the corner is painted");

        let mut rig = Rig::new(StrokeMode::Pencil);
        rig.settings.smoothing = 0.8;
        rig.stroke(&[(5.0, 5.0), (25.0, 5.0), (25.0, 25.0)]);
        assert_eq!(rig.px(25, 5), Rgba::TRANSPARENT, "smoothed: the brush cut the corner");
        assert_eq!(rig.px(25, 25), RED, "but it ends where the pointer did");
        assert_eq!(rig.px(5, 5), RED);
        assert!(rig.painted() > 20, "and it is one continuous line");
    }

    #[test]
    fn pen_pressure_scales_the_dab_unless_switched_off() {
        let at = |p: f64| PointerEvent { pressure: p, ..PointerEvent::at(15.0, 15.0) };
        let dab = |pressure_size: bool, pressure: f64| {
            let mut rig = Rig::new(StrokeMode::Brush);
            rig.settings.size = 20;
            rig.settings.pressure_size = pressure_size;
            let mut ctx = ToolContext { document: &mut rig.doc, selection: &mut rig.selection, viewport: &mut rig.viewport, settings: &mut rig.settings };
            rig.tool.begin(&mut ctx, at(pressure));
            rig.tool.finish(&mut ctx, at(pressure));
            rig.painted()
        };
        let full = dab(true, 1.0);
        let half = dab(true, 0.5);
        assert!(half * 3 < full && half > 0, "half the pressure is a quarter of the area: {half} of {full}");
        assert_eq!(dab(false, 0.5), full, "switched off, the pen presses as a mouse does");
        assert_eq!(dab(true, 0.0), 1, "no pressure at all is still a pixel");
    }

    #[test]
    fn symmetry_paints_the_images_too_without_compounding() {
        use crate::tools::Symmetry;
        let mut rig = Rig::new(StrokeMode::Brush);
        rig.settings.opacity = 0.5;
        rig.settings.size = 5;
        // The canvas is 30x30, so the centre is (15,15).
        rig.settings.symmetry = Symmetry { mirror_x: true, ..Symmetry::default() };
        rig.stroke(&[(5.0, 10.0), (12.0, 10.0)]);
        assert_eq!(rig.px(8, 10).a, 128);
        assert_eq!(rig.px(22, 10).a, 128, "mirrored across x = 15");
        assert_eq!(rig.px(15, 20).a, 0);

        let mut rig = Rig::new(StrokeMode::Brush);
        rig.settings.opacity = 0.5;
        rig.settings.size = 5;
        rig.settings.symmetry = Symmetry { mirror_x: true, mirror_y: true, ..Symmetry::default() };
        // A stroke through the centre meets its own images there.
        rig.stroke(&[(5.0, 15.0), (25.0, 15.0)]);
        assert_eq!(rig.px(15, 15).a, 128, "where the copies overlap they do not compound");
        assert_eq!(rig.px(25, 15).a, 128);

        let mut rig = Rig::new(StrokeMode::Pencil);
        rig.settings.symmetry = Symmetry { radial: 4, ..Symmetry::default() };
        rig.stroke(&[(20.0, 15.0)]);
        for (x, y) in [(20, 15), (15, 20), (10, 15), (15, 10)] {
            assert_eq!(rig.px(x, y), RED, "({x},{y})");
        }
        assert_eq!(rig.painted(), 4);
    }

    /// A band of green down the left of the canvas, to clone from.
    fn with_green_band(rig: &mut Rig) {
        let all = Rect::new(0, 0, 30, 30);
        rig.doc.active_layer_mut().raster.fill_rect(Rect::new(0, 0, 6, 30), GREEN, &all);
    }

    #[test]
    fn the_clone_stamp_copies_from_the_anchor() {
        let mut rig = Rig::new(StrokeMode::Clone);
        with_green_band(&mut rig);
        rig.settings.clone_anchor = Some(Point::new(3.0, 5.0));
        rig.stroke(&[(20.0, 5.0), (20.0, 25.0)]);
        // The offset is (-17, 0), so the stroke reads the band all the way down.
        assert_eq!(rig.px(20, 5), GREEN);
        assert_eq!(rig.px(20, 25), GREEN);
        assert_eq!(rig.px(20, 4), Rgba::TRANSPARENT, "only where the brush went");
    }

    #[test]
    fn alt_click_sets_the_source_and_paints_nothing() {
        let mut rig = Rig::new(StrokeMode::Clone);
        with_green_band(&mut rig);
        rig.alt_click(3.0, 5.0);
        assert_eq!(rig.settings.clone_anchor, Some(Point::new(3.0, 5.0)));
        assert_eq!(rig.px(3, 5), GREEN, "the click left the pixels alone");
    }

    #[test]
    fn a_clone_stroke_without_a_source_does_nothing() {
        let mut rig = Rig::new(StrokeMode::Clone);
        with_green_band(&mut rig);
        let before = rig.painted();
        rig.stroke(&[(20.0, 5.0), (20.0, 25.0)]);
        assert_eq!(rig.painted(), before);
    }

    #[test]
    fn aligned_keeps_one_offset_across_strokes_and_unaligned_starts_again() {
        // Aligned: the second stroke carries on from where the copy was, so
        // a point 4 further down reads 4 further down the band.
        let mut rig = Rig::new(StrokeMode::Clone);
        with_green_band(&mut rig);
        rig.doc.active_layer_mut().raster.set(3, 9, RED);
        rig.settings.clone_anchor = Some(Point::new(3.0, 5.0));
        rig.stroke(&[(20.0, 5.0)]);
        rig.stroke(&[(20.0, 9.0)]);
        assert_eq!(rig.px(20, 9), RED, "the offset stayed (-17, 0)");

        // Unaligned: the second stroke starts from the anchor again, so it
        // reads the anchor's own pixel wherever it is put down.
        let mut rig = Rig::new(StrokeMode::Clone);
        with_green_band(&mut rig);
        rig.doc.active_layer_mut().raster.set(3, 9, RED);
        rig.settings.clone_anchor = Some(Point::new(3.0, 5.0));
        rig.settings.clone_aligned = false;
        rig.stroke(&[(20.0, 5.0)]);
        rig.stroke(&[(20.0, 9.0)]);
        assert_eq!(rig.px(20, 9), GREEN, "the offset was taken afresh");
    }

    #[test]
    fn a_new_anchor_starts_the_offset_again_even_when_aligned() {
        let mut rig = Rig::new(StrokeMode::Clone);
        with_green_band(&mut rig);
        rig.doc.active_layer_mut().raster.set(3, 9, RED);
        rig.settings.clone_anchor = Some(Point::new(3.0, 5.0));
        rig.stroke(&[(20.0, 5.0)]);
        rig.alt_click(3.0, 9.0);
        rig.stroke(&[(20.0, 20.0)]);
        assert_eq!(rig.px(20, 20), RED, "the copy reads the pixel just anchored");
    }

    #[test]
    fn cloning_across_the_source_does_not_feed_back() {
        // A stroke that runs over its own source reads the pixels as they
        // were when it began, so the copy does not smear itself along.
        let mut rig = Rig::new(StrokeMode::Clone);
        with_green_band(&mut rig);
        rig.settings.clone_anchor = Some(Point::new(3.0, 15.0));
        rig.stroke(&[(5.0, 15.0), (25.0, 15.0)]);
        assert_eq!(rig.px(7, 15), GREEN, "the band, moved two to the right");
        assert_eq!(rig.px(9, 15), Rgba::TRANSPARENT, "and then what was beyond it");
        assert_eq!(rig.px(25, 15), Rgba::TRANSPARENT);
    }

    #[test]
    fn the_clone_stamp_stays_inside_the_selection() {
        let mut rig = Rig::new(StrokeMode::Clone);
        // A wide field to copy from, so the source is green right along the
        // stroke and only the selection decides where the paint lands.
        rig.doc.active_layer_mut().raster.fill_rect(Rect::new(0, 0, 15, 30), GREEN, &Rect::new(0, 0, 30, 30));
        rig.selection = Selection::Rect(Rect::new(10, 0, 8, 30));
        rig.settings.clone_anchor = Some(Point::new(3.0, 15.0));
        rig.stroke(&[(8.0, 15.0), (25.0, 15.0)]);
        assert_eq!(rig.px(12, 15), GREEN);
        assert_eq!(rig.px(19, 15), Rgba::TRANSPARENT);
    }

    #[test]
    fn a_clone_source_off_the_canvas_lays_down_nothing() {
        let mut rig = Rig::new(StrokeMode::Clone);
        with_green_band(&mut rig);
        rig.settings.clone_anchor = Some(Point::new(3.0, 15.0));
        // The offset is (+20, 0): every source pixel is past the right edge.
        rig.stroke(&[(-17.0, 15.0), (-17.0, 15.0)]);
        rig.settings.clone_anchor = Some(Point::new(29.0, 15.0));
        rig.stroke(&[(5.0, 15.0)]);
        assert_eq!(rig.px(5, 15), GREEN, "unchanged: the source is empty there");
    }

    /// A picture in two tones: a dark field on the left with a brighter mark
    /// in it, and a lighter field on the right to copy the mark onto. A
    /// hundred levels between the two fields, fifty between field and mark.
    fn two_tones(rig: &mut Rig) {
        let all = Rect::new(0, 0, 60, 60);
        rig.doc = Document::new(60, 60, Rgba::opaque(200, 200, 200));
        let raster = &mut rig.doc.active_layer_mut().raster;
        raster.fill_rect(Rect::new(0, 0, 20, 60), Rgba::opaque(100, 100, 100), &all);
        raster.fill_rect(Rect::new(9, 29, 3, 3), Rgba::opaque(150, 150, 150), &all);
        rig.settings.size = 9;
        rig.settings.clone_anchor = Some(Point::new(10.0, 30.0));
    }

    #[test]
    fn the_healing_brush_takes_the_tone_it_lands_in_and_keeps_the_detail() {
        let mut rig = Rig::new(StrokeMode::Clone);
        two_tones(&mut rig);
        rig.stroke(&[(40.0, 30.0)]);
        assert_eq!(rig.px(38, 30).r, 100, "the clone stamp brings the dark field with it");
        assert_eq!(rig.px(40, 30).r, 150, "mark and all");

        let mut rig = Rig::new(StrokeMode::Heal);
        two_tones(&mut rig);
        rig.stroke(&[(40.0, 30.0)]);
        let (field, mark) = (i32::from(rig.px(38, 30).r), i32::from(rig.px(40, 30).r));
        assert!((field - 200).abs() <= 1, "the field is gone into its surroundings: {field}");
        assert!((mark - 250).abs() <= 1, "the mark is still fifty levels above it: {mark}");
    }

    #[test]
    fn the_healing_brush_is_the_clone_stamp_until_the_stroke_ends() {
        let mut rig = Rig::new(StrokeMode::Heal);
        two_tones(&mut rig);
        {
            let mut ctx = ToolContext {
                document: &mut rig.doc,
                selection: &mut rig.selection,
                viewport: &mut rig.viewport,
                settings: &mut rig.settings,
            };
            rig.tool.begin(&mut ctx, PointerEvent::at(40.0, 30.0));
        }
        assert_eq!(rig.px(40, 30).r, 150, "a plain copy while the pointer is still down");
        {
            let mut ctx = ToolContext {
                document: &mut rig.doc,
                selection: &mut rig.selection,
                viewport: &mut rig.viewport,
                settings: &mut rig.settings,
            };
            rig.tool.finish(&mut ctx, PointerEvent::at(40.0, 30.0));
        }
        assert!((i32::from(rig.px(40, 30).r) - 250).abs() <= 1, "and blended when it comes up");
    }

    #[test]
    fn healing_onto_nothing_is_a_plain_copy() {
        let mut rig = Rig::new(StrokeMode::Heal);
        with_green_band(&mut rig);
        rig.settings.size = 5;
        rig.settings.clone_anchor = Some(Point::new(3.0, 5.0));
        rig.stroke(&[(20.0, 5.0)]);
        assert_eq!(rig.px(20, 5), GREEN, "nothing round it to take a tone from");
    }

    #[test]
    fn the_healing_brush_stays_inside_the_selection() {
        let mut rig = Rig::new(StrokeMode::Heal);
        let all = Rect::new(0, 0, 30, 30);
        rig.doc.active_layer_mut().raster.fill_rect(Rect::new(0, 0, 15, 30), GREEN, &all);
        rig.selection = Selection::Rect(Rect::new(10, 0, 8, 30));
        rig.settings.clone_anchor = Some(Point::new(3.0, 15.0));
        rig.stroke(&[(8.0, 15.0), (25.0, 15.0)]);
        assert_eq!(rig.px(12, 15), GREEN);
        assert_eq!(rig.px(19, 15), Rgba::TRANSPARENT);
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

