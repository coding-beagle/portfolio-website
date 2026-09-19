//! The wet brush: paint that stays wet.
//!
//! It paints like the brush, and every pixel it paints is marked wet in the
//! layer's [`WetPaint`] map. Where the brush crosses paint that is still wet
//! three more things happen, each by how wet the ground is: the wet paint
//! under the brush is dragged along in the direction the brush is moving,
//! the brush takes some of that paint up — so a blue brush drawn through wet
//! red comes out the other side purple, and trails it — and what it lays
//! down mixes with what is there rather than covering it. Dry paint takes
//! the brush like the ordinary one does.
//!
//! Unlike the brush, overlapping dabs within a stroke compound: paint on
//! paint is the point of it. The drying and the running when the canvas is
//! tilted are the editor's ([`crate::editor::Editor::wet_tick`]); the tool
//! only ever sees the map as it is when the pointer arrives.

use super::{Gesture, PointerEvent, Tool, ToolContext, ToolKind};
use crate::color::Rgba;
use crate::geometry::{Point, Rect};
use crate::raster::Raster;
use crate::wet::WetPaint;

/// How much of the wet paint under a dab is dragged along with it.
const SMEAR: f32 = 0.6;
/// How far the drag reaches back, as a fraction of the brush size.
const SMEAR_REACH: f32 = 0.35;
/// How much of the wet paint a dab crosses the brush takes up.
const PICKUP: f32 = 0.3;
/// How far apart the dabs fall along the path, as a fraction of the size.
const SPACING: f32 = 0.25;

#[derive(Debug, Default)]
pub struct WetBrushTool {
    gesture: Option<InProgress>,
    touched: Option<Rect>,
}

#[derive(Debug)]
struct InProgress {
    last: Point,
    /// The layer, and the wetness, before the stroke, for cancel.
    base: Raster,
    wet_base: Option<WetPaint>,
    /// The paint the brush is carrying: the foreground colour to start
    /// with, and whatever it has taken up since.
    load: Rgba,
}

/// The map for the active layer, made fresh if there is none or it belongs
/// to another layer or another size of it.
fn map_for<'a>(ctx: &'a mut ToolContext) -> &'a mut WetPaint {
    let id = ctx.document.active_layer().id();
    let surface = ctx.document.active_surface();
    let stale = ctx
        .settings
        .wet
        .as_ref()
        .is_none_or(|w| w.layer() != id || !w.fits(surface));
    if stale {
        ctx.settings.wet = Some(WetPaint::new(id, surface));
    }
    ctx.settings.wet.as_mut().expect("just made")
}

/// Coverage of a pixel by a round dab: 1 out to `hardness` of the radius,
/// then a straight fade to nothing at the rim.
fn coverage(dx: f64, dy: f64, radius: f64, hardness: f64) -> f32 {
    let n = dx.hypot(dy) / radius;
    if n > 1.0 {
        return 0.0;
    }
    if n <= hardness {
        return 1.0;
    }
    (1.0 - (n - hardness) / (1.0 - hardness).max(1e-9)) as f32
}

impl WetBrushTool {
    fn dab(&mut self, ctx: &mut ToolContext, at: Point, from: Point) {
        let size = ctx.settings.size.max(1);
        let opacity = ctx.settings.opacity.clamp(0.0, 1.0);
        let hardness = f64::from(ctx.settings.hardness.clamp(0.0, 1.0));
        let clip = ctx.clip();
        let radius = (f64::from(size) / 2.0).max(0.5);
        // The dab's centre sits on a pixel centre when the size is odd and
        // on a corner when it is even, as the brush's does.
        let (cx, cy) = (at.x, at.y);
        let rect = Rect::from_corners(
            ((cx - radius).floor() as i32, (cy - radius).floor() as i32),
            ((cx + radius).ceil() as i32, (cy + radius).ceil() as i32),
        )
        .intersect(&clip);
        if rect.is_empty() {
            return;
        }
        // Which way the brush is going, for the smear to drag along.
        let (mx, my) = (at.x - from.x, at.y - from.y);
        let moving = mx.hypot(my) > 1e-6;
        let reach = f64::from(size) * f64::from(SMEAR_REACH);
        let (back_x, back_y) = if moving {
            let len = mx.hypot(my);
            (mx / len * reach, my / len * reach)
        } else {
            (0.0, 0.0)
        };
        let Some(g) = self.gesture.as_mut() else {
            return;
        };
        let load = g.load;
        // Padded rather than clipped, so a dab hanging over the edge of the
        // canvas still reads its pixels from where they are.
        let around = rect.inflate(reach.ceil() as i32 + 1);
        let before = ctx.document.active_surface().crop_padded(&around);
        let get_before = |x: i32, y: i32| before.get(x - around.x, y - around.y);
        let wet = map_for(ctx);
        // What the brush picks up: the wet ground it crossed, weighted by
        // how wet and how covered.
        let mut picked = [0.0f32; 4];
        let mut weight = 0.0f32;
        let mut covered = 0.0f32;
        let mut painted: Vec<(i32, i32, Rgba, f32)> =
            Vec::with_capacity((rect.w * rect.h) as usize);
        for y in rect.y..rect.bottom() {
            for x in rect.x..rect.right() {
                let cover = coverage(
                    f64::from(x) + 0.5 - cx,
                    f64::from(y) + 0.5 - cy,
                    radius,
                    hardness,
                );
                if cover <= 0.0 {
                    continue;
                }
                let w = wet.get(x, y);
                let ground = get_before(x, y);
                // Wet paint is dragged along: what was a little way back
                // along the stroke is pulled under the brush.
                let dragged = if moving && w > 0.0 {
                    let behind = get_before(
                        (f64::from(x) + 0.5 - back_x).floor() as i32,
                        (f64::from(y) + 0.5 - back_y).floor() as i32,
                    );
                    ground.lerp(behind, w * SMEAR * cover)
                } else {
                    ground
                };
                let laid = dragged.lerp(load, cover * opacity);
                painted.push((x, y, laid, cover));
                if w > 0.0 && ground.a > 0 {
                    let k = w * cover;
                    let a = f32::from(ground.a) / 255.0;
                    picked[0] += f32::from(ground.r) * a * k;
                    picked[1] += f32::from(ground.g) * a * k;
                    picked[2] += f32::from(ground.b) * a * k;
                    picked[3] += a * k;
                    weight += k;
                }
                covered += cover;
            }
        }
        for &(x, y, _, cover) in &painted {
            wet.wet(x, y, cover);
        }
        let layer = ctx.document.active_surface_mut();
        for (x, y, laid, _) in painted {
            layer.set(x, y, laid);
        }
        // The brush comes away carrying some of the wet paint it crossed.
        if weight > 0.0 && picked[3] > 0.0 && covered > 0.0 {
            let average = Rgba::new(
                (picked[0] / picked[3]).round().clamp(0.0, 255.0) as u8,
                (picked[1] / picked[3]).round().clamp(0.0, 255.0) as u8,
                (picked[2] / picked[3]).round().clamp(0.0, 255.0) as u8,
                255,
            );
            g.load = load.lerp(average, PICKUP * (weight / covered).clamp(0.0, 1.0));
        }
        self.touched = Some(self.touched.map_or(rect, |t| t.union(&rect)));
    }

    fn stroke_to(&mut self, ctx: &mut ToolContext, to: Point) {
        self.touched = None;
        let Some(g) = self.gesture.as_ref() else {
            return;
        };
        let from = g.last;
        let spacing = (f64::from(ctx.settings.size) * f64::from(SPACING)).max(1.0);
        let len = from.distance_to(to);
        let steps = (len / spacing).ceil().max(1.0) as u32;
        let mut last = from;
        for i in 1..=steps {
            let t = f64::from(i) / f64::from(steps);
            let at = Point::new(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
            self.dab(ctx, at, last);
            last = at;
        }
        if let Some(g) = self.gesture.as_mut() {
            g.last = to;
        }
    }
}

impl Tool for WetBrushTool {
    fn kind(&self) -> ToolKind {
        ToolKind::WetBrush
    }

    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        let base = ctx.document.active_surface().clone();
        self.gesture = Some(InProgress {
            last: ev.pos,
            base,
            wet_base: ctx.settings.wet.clone(),
            load: ctx.settings.color.with_alpha(255),
        });
        self.touched = None;
        self.dab(ctx, ev.pos, ev.pos);
        Gesture::EditsActiveLayer
    }

    fn update(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        if self.gesture.is_none() {
            return false;
        }
        self.stroke_to(ctx, ev.pos);
        true
    }

    fn finish(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        if self.gesture.is_none() {
            return false;
        }
        self.stroke_to(ctx, ev.pos);
        self.gesture = None;
        true
    }

    fn cancel(&mut self, ctx: &mut ToolContext) {
        if let Some(g) = self.gesture.take() {
            *ctx.document.active_surface_mut() = g.base;
            ctx.settings.wet = g.wet_base;
        }
        self.touched = None;
    }

    fn dirtied(&self) -> Option<Rect> {
        Some(self.touched.unwrap_or_default())
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
    const BLUE: Rgba = Rgba::opaque(0, 0, 255);

    struct Rig {
        doc: Document,
        selection: Selection,
        viewport: Viewport,
        settings: ToolSettings,
        tool: WetBrushTool,
    }

    impl Rig {
        fn new() -> Rig {
            Rig {
                doc: Document::new(64, 64, Rgba::WHITE),
                selection: Selection::None,
                viewport: Viewport::default(),
                settings: ToolSettings {
                    color: RED,
                    size: 6,
                    ..ToolSettings::default()
                },
                tool: WetBrushTool::default(),
            }
        }

        fn stroke(&mut self, points: &[(f64, f64)]) {
            let mut ctx = ToolContext {
                document: &mut self.doc,
                selection: &mut self.selection,
                viewport: &mut self.viewport,
                settings: &mut self.settings,
            };
            let (first, rest) = points.split_first().unwrap();
            self.tool
                .begin(&mut ctx, PointerEvent::at(first.0, first.1));
            for p in rest {
                self.tool.update(&mut ctx, PointerEvent::at(p.0, p.1));
            }
            let last = points.last().unwrap();
            self.tool.finish(&mut ctx, PointerEvent::at(last.0, last.1));
        }

        fn px(&self, x: i32, y: i32) -> Rgba {
            self.doc.active_surface().get(x, y)
        }
    }

    #[test]
    fn a_stroke_paints_and_leaves_the_paint_wet() {
        let mut rig = Rig::new();
        rig.stroke(&[(10.0, 10.0), (30.0, 10.0)]);
        assert_eq!(rig.px(20, 10), RED);
        assert_eq!(rig.px(20, 30), Rgba::WHITE);
        let wet = rig.settings.wet.as_ref().expect("a map was made");
        assert_eq!(wet.layer(), rig.doc.active_layer().id());
        assert!(wet.get(20, 10) > 0.99);
        assert_eq!(wet.get(20, 30), 0.0);
    }

    #[test]
    fn a_brush_through_wet_paint_takes_it_up_and_trails_it() {
        let mut rig = Rig::new();
        rig.stroke(&[(10.0, 20.0), (40.0, 20.0)]);
        rig.settings.color = BLUE;
        rig.stroke(&[(25.0, 5.0), (25.0, 50.0)]);
        // Past the red band the blue stroke is no longer pure blue.
        let after = rig.px(25, 40);
        assert!(after.r > 0, "the brush picked nothing up: {after}");
        assert!(after.b > after.r, "but it is still mostly blue: {after}");
        // Before it reached the red it was.
        assert_eq!(rig.px(25, 8), BLUE);
    }

    #[test]
    fn dry_ground_takes_the_brush_clean() {
        let mut rig = Rig::new();
        rig.stroke(&[(10.0, 20.0), (40.0, 20.0)]);
        rig.settings.wet.as_mut().unwrap().dry(1.0);
        rig.settings.color = BLUE;
        rig.stroke(&[(25.0, 5.0), (25.0, 50.0)]);
        assert_eq!(rig.px(25, 40), BLUE, "dry paint is just ground");
    }

    #[test]
    fn cancel_puts_back_the_paint_and_the_wetness() {
        let mut rig = Rig::new();
        rig.stroke(&[(10.0, 10.0)]);
        let wet_before = rig.settings.wet.clone();
        let mut ctx = ToolContext {
            document: &mut rig.doc,
            selection: &mut rig.selection,
            viewport: &mut rig.viewport,
            settings: &mut rig.settings,
        };
        rig.tool.begin(&mut ctx, PointerEvent::at(40.0, 40.0));
        rig.tool.update(&mut ctx, PointerEvent::at(50.0, 50.0));
        rig.tool.cancel(&mut ctx);
        assert_eq!(rig.px(45, 45), Rgba::WHITE);
        assert_eq!(rig.settings.wet, wet_before);
    }

    #[test]
    fn a_map_from_another_layer_is_replaced() {
        let mut rig = Rig::new();
        rig.stroke(&[(10.0, 10.0)]);
        let first = rig.settings.wet.as_ref().unwrap().layer();
        rig.doc.add_layer();
        rig.stroke(&[(20.0, 20.0)]);
        let wet = rig.settings.wet.as_ref().unwrap();
        assert_ne!(wet.layer(), first);
        assert_eq!(wet.get(10, 10), 0.0, "the old layer's wetness went with it");
    }
}
