//! The erosion brush: rain on a picture that is read as a landscape.
//!
//! Brightness is height. Every dab lets a shower of droplets fall inside the
//! brush, and each one runs downhill — towards the darkest of its eight
//! neighbours — carrying colour with it: it picks up some of what it runs
//! over and lays down some of what it carries, and where it runs it carves,
//! darkening the ground a little so that the next drop finds the channel
//! deeper. Rain over a portrait streaks it downhill into the shadows; rain
//! over a landscape cuts gullies where the tone already falls away. A drop
//! stops when every way is uphill — a pool — when it runs off the picture or
//! out of the selection, or when it has come far enough.
//!
//! The drops fall where a hash of the dab and the drop says they fall, so a
//! stroke is the same stroke every time and the tests can look at what it
//! did. Nothing here is a function of time; only of the pointer's path.

use super::{Gesture, PointerEvent, Tool, ToolContext, ToolKind};
use crate::adjust::luminance;
use crate::color::Rgba;
use crate::dither::hash;
use crate::geometry::{Point, Rect};
use crate::raster::Raster;

/// Drops per dab per pixel of brush area at full rain.
const DROPS_PER_PIXEL: f32 = 0.06;
/// The fewest drops a dab lets fall, so a small brush still does something.
const MIN_DROPS: u32 = 3;
/// How far a drop may run, as a multiple of the brush size, and the bounds
/// on that so a one-pixel brush still runs and a huge one does not run off
/// the world.
const RUN_PER_SIZE: f32 = 3.0;
const MIN_RUN: u32 = 24;
const MAX_RUN: u32 = 600;
/// How much of what a drop carries it leaves on each pixel it crosses, and
/// how much of the pixel it takes up with it.
const DEPOSIT: f32 = 0.22;
const PICKUP: f32 = 0.12;
/// How far each pixel a drop falls across is darkened: the carving. A level
/// step carves half as much, and only once the drop has fallen at all, so a
/// plain is left alone while a gentle slope still shows the channel.
const CARVE: f32 = 0.1;
const LEVEL_CARVE: f32 = 0.5;
/// A little disorder in which way is down, in levels of brightness, so runs
/// wander rather than falling in dead straight lines. It only ever picks
/// among ways that really are down or level: it cannot invent a slope.
const WANDER: f32 = 6.0;
/// How many level steps in a row a drop may take before it is a puddle.
/// Eight-bit brightness makes plateaus of a smooth gradient, so a drop has
/// to be able to cross a few; on truly flat ground it soon gives up.
const MAX_FLAT_STEPS: u32 = 12;
/// The hash channels the drops read.
const CH_DROP_X: u32 = 400;
const CH_DROP_Y: u32 = 401;
const CH_WANDER: u32 = 402;
/// How far apart along the pointer's path the showers fall, as a fraction
/// of the brush size.
const SPACING: f32 = 0.5;

#[derive(Debug, Default)]
pub struct ErodeTool {
    gesture: Option<InProgress>,
    /// What the last dab changed, for [`Tool::dirtied`].
    touched: Option<Rect>,
}

#[derive(Debug)]
struct InProgress {
    last: Point,
    /// The layer before the stroke, for cancel.
    base: Raster,
    /// Which dab this is, so every shower rolls different dice.
    dab: i32,
}

/// The eight ways a drop may step.
const STEPS: [(i32, i32); 8] = [
    (-1, -1),
    (0, -1),
    (1, -1),
    (-1, 0),
    (1, 0),
    (-1, 1),
    (0, 1),
    (1, 1),
];

/// A pixel's height: its brightness. What is not there is not ground —
/// a transparent pixel is off the edge of the world, and a drop that
/// reaches one runs away.
fn height(p: Rgba) -> Option<f32> {
    (p.a > 0).then(|| f32::from(luminance(p)))
}

/// Lets one drop fall at `(x, y)` and run downhill through `layer` inside
/// `clip`, for up to `run` steps at `strength` (`0..=1`). Returns the
/// rectangle it changed, or `None` if it fell somewhere it could not run.
///
/// Public to the crate for the tests; the tool is what calls it.
pub(crate) fn drop(
    layer: &mut Raster,
    clip: &Rect,
    x: i32,
    y: i32,
    run: u32,
    strength: f32,
    seed: i32,
) -> Option<Rect> {
    if !clip.contains(x, y) {
        return None;
    }
    let mut h = height(layer.get(x, y))?;
    // Where the drop goes is decided first, over the ground as it lies, and
    // only then is the ground changed: a drop that carved as it went would
    // measure its own channel, find itself in a hole at the next bend and
    // pool there.
    let mut path: Vec<(i32, i32, bool)> = Vec::new();
    let (mut cx, mut cy) = (x, y);
    let mut came_from = (x, y);
    let mut flat_steps = 0;
    for step in 0..run {
        // The lowest of the neighbours that are down or level — never back
        // the way it came — with a little wander among them so that a run
        // does not fall in a dead straight line.
        let mut best: Option<((i32, i32), f32, f32)> = None;
        for (i, (dx, dy)) in STEPS.iter().enumerate() {
            let (nx, ny) = (cx + dx, cy + dy);
            if !clip.contains(nx, ny) || (nx, ny) == came_from {
                continue;
            }
            let Some(nh) = height(layer.get(nx, ny)) else {
                continue;
            };
            if nh > h {
                continue;
            }
            let wander = (hash(nx + seed, ny + step as i32, CH_WANDER + i as u32) - 0.5) * WANDER;
            let score = nh + wander;
            if best.is_none_or(|(_, s, _)| score < s) {
                best = Some(((nx, ny), score, nh));
            }
        }
        // Every way is up: the drop pools here.
        let Some(((nx, ny), _, nh)) = best else { break };
        let descending = nh < h;
        if descending {
            flat_steps = 0;
        } else {
            flat_steps += 1;
            if flat_steps > MAX_FLAT_STEPS {
                break;
            }
        }
        path.push((nx, ny, descending));
        came_from = (cx, cy);
        (cx, cy) = (nx, ny);
        h = nh;
    }
    // Then the water: along the path it lays down some of what it carries,
    // takes up some of what it crosses, and — where it is falling, or
    // flowing on from a fall — carves.
    let mut carry = layer.get(x, y);
    let mut has_fallen = false;
    let mut touched = Rect::new(x, y, 1, 1);
    for (nx, ny, descending) in path {
        let next = layer.get(nx, ny);
        has_fallen |= descending;
        let laid = next.lerp(carry.with_alpha(next.a), DEPOSIT * strength);
        let carve = match (descending, has_fallen) {
            (true, _) => CARVE * strength,
            (false, true) => CARVE * LEVEL_CARVE * strength,
            (false, false) => 0.0,
        };
        let carved = Rgba::new(
            (f32::from(laid.r) * (1.0 - carve)).round() as u8,
            (f32::from(laid.g) * (1.0 - carve)).round() as u8,
            (f32::from(laid.b) * (1.0 - carve)).round() as u8,
            laid.a,
        );
        if carved != next {
            layer.set(nx, ny, carved);
            touched = touched.union(&Rect::new(nx, ny, 1, 1));
        }
        carry = carry.lerp(next.with_alpha(carry.a), PICKUP);
    }
    Some(touched)
}

impl ErodeTool {
    fn shower_at(&mut self, ctx: &mut ToolContext, centre: Point) {
        let size = ctx.settings.size.max(1);
        let strength = ctx.settings.opacity.clamp(0.0, 1.0);
        let clip = ctx.clip();
        let Some(g) = self.gesture.as_mut() else {
            return;
        };
        g.dab += 1;
        let radius = f64::from(size) / 2.0;
        let area = (radius * radius * std::f64::consts::PI) as f32;
        let drops = ((area * DROPS_PER_PIXEL * strength).round() as u32).max(MIN_DROPS);
        let run = ((size as f32 * RUN_PER_SIZE) as u32).clamp(MIN_RUN, MAX_RUN);
        let layer = ctx.document.active_surface_mut();
        let mut touched: Option<Rect> = None;
        for i in 0..drops as i32 {
            // A point in the disc: a square's worth of dice, thrown again
            // by the next channel if the first lands outside.
            let (mut u, mut v) = (hash(g.dab, i, CH_DROP_X), hash(g.dab, i, CH_DROP_Y));
            let mut channel = 1;
            while (u - 0.5).hypot(v - 0.5) > 0.5 && channel < 8 {
                u = hash(g.dab, i, CH_DROP_X + 2 * channel);
                v = hash(g.dab, i, CH_DROP_Y + 2 * channel);
                channel += 1;
            }
            let x = (centre.x - radius + f64::from(u) * 2.0 * radius).floor() as i32;
            let y = (centre.y - radius + f64::from(v) * 2.0 * radius).floor() as i32;
            if let Some(ran) = drop(layer, &clip, x, y, run, strength, g.dab * 131 + i) {
                touched = Some(touched.map_or(ran, |t| t.union(&ran)));
            }
        }
        self.touched = match (self.touched, touched) {
            (Some(a), Some(b)) => Some(a.union(&b)),
            (a, b) => a.or(b),
        };
    }

    /// Showers along the pointer's path from where the last one fell.
    fn rain_to(&mut self, ctx: &mut ToolContext, to: Point) {
        self.touched = None;
        let Some(g) = self.gesture.as_ref() else {
            return;
        };
        let from = g.last;
        let spacing = (f64::from(ctx.settings.size) * f64::from(SPACING)).max(1.0);
        let len = from.distance_to(to);
        let steps = (len / spacing).ceil().max(1.0) as u32;
        for i in 1..=steps {
            let t = f64::from(i) / f64::from(steps);
            let at = Point::new(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
            self.shower_at(ctx, at);
        }
        if let Some(g) = self.gesture.as_mut() {
            g.last = to;
        }
    }
}

impl Tool for ErodeTool {
    fn kind(&self) -> ToolKind {
        ToolKind::Erode
    }

    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        let layer = ctx.document.active_surface();
        self.gesture = Some(InProgress {
            last: ev.pos,
            base: layer.clone(),
            dab: 0,
        });
        self.touched = None;
        self.shower_at(ctx, ev.pos);
        Gesture::EditsActiveLayer
    }

    fn update(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        if self.gesture.is_none() {
            return false;
        }
        self.rain_to(ctx, ev.pos);
        true
    }

    fn finish(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        if self.gesture.is_none() {
            return false;
        }
        self.rain_to(ctx, ev.pos);
        self.gesture = None;
        true
    }

    fn cancel(&mut self, ctx: &mut ToolContext) {
        if let Some(g) = self.gesture.take() {
            *ctx.document.active_surface_mut() = g.base;
        }
        self.touched = None;
    }

    fn dirtied(&self) -> Option<Rect> {
        // A dab that did nothing still says so, rather than asking for the
        // whole document to be redrawn.
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

    /// A hillside: bright at the top, dark at the bottom, so down is down.
    fn slope(size: u32) -> Raster {
        let mut r = Raster::new(size, size);
        for y in 0..size as i32 {
            let v = 255 - (y * 255 / size as i32) as u8;
            let all = r.bounds();
            r.fill_rect(Rect::new(0, y, size as i32, 1), Rgba::opaque(v, v, v), &all);
        }
        r
    }

    #[test]
    fn a_drop_runs_downhill_and_stops_at_the_bottom() {
        let mut r = slope(32);
        let all = r.bounds();
        let ran = drop(&mut r, &all, 16, 4, 100, 1.0, 1).unwrap();
        assert!(ran.bottom() > 20, "ran only to {}", ran.bottom());
        assert!(ran.y <= 5);
        // Where it ran it carved: darker than the row it is on was.
        let before = slope(32);
        let mut darker = 0;
        for y in ran.y..ran.bottom() {
            for x in ran.x..ran.right() {
                if r.get(x, y).r < before.get(x, y).r {
                    darker += 1;
                }
            }
        }
        assert!(darker > 10, "{darker}");
    }

    #[test]
    fn a_drop_carries_colour_with_it() {
        let mut r = slope(32);
        let all = r.bounds();
        // A tinted band across the slope, no brighter or darker than the
        // grey it replaces, so the drop runs through it rather than pooling
        // in it: what it carries out the other side should be tinted too.
        for y in 3..6 {
            let v = r.get(0, y).r;
            r.fill_rect(
                Rect::new(0, y, 32, 1),
                Rgba::opaque(v + 20, v - 10, v - 10),
                &all,
            );
        }
        let ran = drop(&mut r, &all, 16, 1, 100, 1.0, 5).unwrap();
        assert!(ran.bottom() > 8, "pooled in the band: {ran:?}");
        let tinted = (7..32).any(|y| (0..32).any(|x| r.get(x, y).r != r.get(x, y).g));
        assert!(tinted, "no colour ran downhill");
    }

    #[test]
    fn flat_ground_is_left_as_it_was() {
        let mut r = Raster::filled(40, 40, Rgba::opaque(180, 180, 180));
        let all = r.bounds();
        let before = r.clone();
        for i in 0..20 {
            drop(&mut r, &all, 20, 20, 100, 1.0, i);
        }
        assert_eq!(
            r.pixels(),
            before.pixels(),
            "a drop on a plain has nothing to carve or carry"
        );
    }

    #[test]
    fn a_drop_in_a_pool_goes_nowhere() {
        let mut r = Raster::filled(16, 16, Rgba::opaque(10, 10, 10));
        let all = r.bounds();
        // A single dark pixel with bright all round it — but the drop lands
        // on the dark one, so every way is up.
        r.fill_rect(Rect::new(0, 0, 16, 16), Rgba::opaque(200, 200, 200), &all);
        r.set(8, 8, Rgba::opaque(10, 10, 10));
        let ran = drop(&mut r, &all, 8, 8, 100, 1.0, 1).unwrap();
        assert_eq!(ran, Rect::new(8, 8, 1, 1));
        assert_eq!(r.get(8, 8), Rgba::opaque(10, 10, 10));
    }

    #[test]
    fn a_drop_stays_inside_the_clip_and_off_the_transparent() {
        let mut r = slope(32);
        let all = r.bounds();
        let clip = Rect::new(0, 0, 32, 12);
        let ran = drop(&mut r, &clip, 16, 2, 100, 1.0, 1).unwrap();
        assert!(ran.bottom() <= 12, "{ran:?}");
        let mut holed = slope(32);
        holed.clear_in(&Rect::new(0, 12, 32, 1));
        let ran = drop(&mut holed, &all, 16, 2, 100, 1.0, 1).unwrap();
        assert!(ran.bottom() <= 12, "ran across the hole: {ran:?}");
        assert!(
            drop(&mut holed, &all, 16, 12, 100, 1.0, 1).is_none(),
            "nothing to land on"
        );
    }

    #[test]
    fn a_stroke_erodes_only_where_it_rained_and_reports_it() {
        let mut doc = Document::new(64, 64, Rgba::TRANSPARENT);
        *doc.active_surface_mut() = slope(64);
        let mut selection = Selection::None;
        let mut viewport = Viewport::default();
        let mut settings = ToolSettings {
            size: 10,
            ..ToolSettings::default()
        };
        let mut tool = ErodeTool::default();
        let mut ctx = ToolContext {
            document: &mut doc,
            selection: &mut selection,
            viewport: &mut viewport,
            settings: &mut settings,
        };
        assert_eq!(
            tool.begin(&mut ctx, PointerEvent::at(32.0, 8.0)),
            Gesture::EditsActiveLayer
        );
        let touched = tool.dirtied().unwrap();
        assert!(!touched.is_empty());
        assert!(tool.update(&mut ctx, PointerEvent::at(40.0, 8.0)));
        assert!(tool.finish(&mut ctx, PointerEvent::at(40.0, 8.0)));
        let before = slope(64);
        let after = doc.active_surface();
        let changed: Vec<(i32, i32)> = (0..64)
            .flat_map(|y| (0..64).map(move |x| (x, y)))
            .filter(|&(x, y)| before.get(x, y) != after.get(x, y))
            .collect();
        assert!(!changed.is_empty());
        // Nothing far to the left of the shower has moved.
        assert!(changed.iter().all(|&(x, _)| x >= 20), "{changed:?}");
    }

    #[test]
    fn a_drop_on_a_gentle_slope_runs_a_long_way_and_carves_a_channel() {
        // A level per pixel and a bit: plateaus a few pixels wide, as an
        // eight-bit gradient has.
        let mut r = slope(200);
        let before = r.clone();
        let all = r.bounds();
        let ran = drop(&mut r, &all, 100, 20, 240, 1.0, 3).unwrap();
        assert!(ran.h > 100, "ran only {} rows", ran.h);
        let carved = (ran.y..ran.bottom())
            .filter(|&y| (ran.x..ran.right()).any(|x| r.get(x, y).r < before.get(x, y).r))
            .count();
        assert!(
            carved > ran.h as usize / 2,
            "carved on {carved} of {} rows",
            ran.h
        );
    }

    #[test]
    fn cancel_puts_the_ground_back() {
        let mut doc = Document::new(32, 32, Rgba::TRANSPARENT);
        *doc.active_surface_mut() = slope(32);
        let mut selection = Selection::None;
        let mut viewport = Viewport::default();
        let mut settings = ToolSettings {
            size: 8,
            ..ToolSettings::default()
        };
        let mut tool = ErodeTool::default();
        let mut ctx = ToolContext {
            document: &mut doc,
            selection: &mut selection,
            viewport: &mut viewport,
            settings: &mut settings,
        };
        tool.begin(&mut ctx, PointerEvent::at(16.0, 4.0));
        tool.cancel(&mut ctx);
        assert_eq!(doc.active_surface().pixels(), slope(32).pixels());
    }
}
