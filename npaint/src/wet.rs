//! Wet paint: how wet each pixel of a layer still is, and what that lets
//! the paint do.
//!
//! The wet brush ([`crate::tools::WetBrushTool`]) lays down paint that stays
//! wet for a while. While it is wet it can be pushed about: brushing into it
//! smears it and the brush takes some of it up, and if the canvas is tilted
//! it runs downhill, a little every frame, until it dries. Drying is the
//! only clock in the engine — [`crate::editor::Editor::wet_tick`] is where
//! the page hands time in — and everything else here is a function of the
//! wetness map and the pixels.
//!
//! The map is not part of the document. It is not saved, an undo dries it,
//! and a new document starts dry: wetness is a property of the afternoon,
//! not of the picture. It lives on the tool settings rather than the layer
//! for the same reason the clone stamp's anchor does — it is shared state
//! the tools and the editor both read, and it has no business in a snapshot.

use crate::dither::hash;
use crate::geometry::Rect;
use crate::layer::LayerId;
use crate::raster::Raster;

/// How much of a wet pixel's paint moves on per second at a full tilt. The
/// front of a run advances a pixel a frame; this is how fast the colour
/// follows it, and so how fast a drip visibly grows — a few dozen pixels a
/// second reads as paint running, faster reads as a bug.
pub const FLOW_RATE: f32 = 20.0;
/// How wet the front of a run is compared with what it ran from, so a run
/// thins out rather than going on to the edge; drying is what stops it.
const SPREAD: f32 = 0.985;
/// The hash channel the drips read, and how few of the lines across the
/// flow drip at all: the streak is `hash` to this power, so most lines
/// barely move and a few run away, which is what a drip is.
const CH_STREAK: u32 = 500;
const STREAK_POWER: i32 = 3;
const STREAK_FLOOR: f32 = 0.04;

/// Wetness per pixel of one layer, `0.0..=1.0`.
#[derive(Clone, Debug, PartialEq)]
pub struct WetPaint {
    layer: LayerId,
    width: u32,
    height: u32,
    wetness: Vec<f32>,
    /// Where any wetness is, or `None` when all of it has dried. Kept so
    /// that a tick costs the wet part of the layer and not the layer.
    bounds: Option<Rect>,
}

impl WetPaint {
    /// A dry map the size of `raster`, for `layer`.
    pub fn new(layer: LayerId, raster: &Raster) -> WetPaint {
        WetPaint {
            layer,
            width: raster.width(),
            height: raster.height(),
            wetness: vec![0.0; (raster.width() as usize) * (raster.height() as usize)],
            bounds: None,
        }
    }

    pub fn layer(&self) -> LayerId {
        self.layer
    }

    /// Whether the map still matches the raster it was made for. A crop or
    /// a resize leaves a map that means nothing, and it has to go.
    pub fn fits(&self, raster: &Raster) -> bool {
        self.width == raster.width() && self.height == raster.height()
    }

    /// Where the wet paint is, or `None` when the map is dry.
    pub fn bounds(&self) -> Option<Rect> {
        self.bounds
    }

    pub fn is_dry(&self) -> bool {
        self.bounds.is_none()
    }

    fn index(&self, x: i32, y: i32) -> Option<usize> {
        (x >= 0 && y >= 0 && (x as u32) < self.width && (y as u32) < self.height)
            .then(|| (y as usize) * (self.width as usize) + x as usize)
    }

    /// How wet a pixel is; dry off the map.
    pub fn get(&self, x: i32, y: i32) -> f32 {
        self.index(x, y).map_or(0.0, |i| self.wetness[i])
    }

    /// Wets a pixel to at least `amount`.
    pub fn wet(&mut self, x: i32, y: i32, amount: f32) {
        let amount = amount.clamp(0.0, 1.0);
        if amount <= 0.0 {
            return;
        }
        let Some(i) = self.index(x, y) else { return };
        if amount > self.wetness[i] {
            self.wetness[i] = amount;
            let here = Rect::new(x, y, 1, 1);
            self.bounds = Some(self.bounds.map_or(here, |b| b.union(&here)));
        }
    }

    /// Time passes: every wet pixel dries by `amount`. Returns whether any
    /// paint is still wet.
    pub fn dry(&mut self, amount: f32) -> bool {
        let Some(bounds) = self.bounds else {
            return false;
        };
        let mut left: Option<Rect> = None;
        for y in bounds.y..bounds.bottom() {
            for x in bounds.x..bounds.right() {
                let i = (y as usize) * (self.width as usize) + x as usize;
                if self.wetness[i] <= 0.0 {
                    continue;
                }
                self.wetness[i] = (self.wetness[i] - amount).max(0.0);
                if self.wetness[i] > 0.0 {
                    let here = Rect::new(x, y, 1, 1);
                    left = Some(left.map_or(here, |b| b.union(&here)));
                }
            }
        }
        self.bounds = left;
        left.is_some()
    }

    /// Wet paint runs the way the canvas is tilted. `tilt` is how far it
    /// leans on each axis, `-1.0..=1.0`, and `amount` how much of a pixel's
    /// paint may move this tick at full wetness; `cover` is how much of each
    /// pixel the selection lets be painted. Returns what changed.
    ///
    /// Every wet pixel gives some of its colour to the neighbour below it —
    /// below being wherever the tilt points, split between the two axes by
    /// how far the tilt leans each way — and passes most of its wetness on,
    /// so the run advances a pixel at a time and thins as it goes. The pixel
    /// it ran from keeps its colour: a run leaves a trail, it does not pick
    /// the paint up and carry it off. The lines across the flow drip
    /// unevenly — most hardly at all, a few a long way — by a hash of where
    /// each line is, which is what makes it look like paint running and not
    /// a smear sliding.
    pub fn flow(
        &mut self,
        raster: &mut Raster,
        tilt: (f32, f32),
        amount: f32,
        cover: impl Fn(i32, i32) -> u8,
    ) -> Option<Rect> {
        let bounds = self.bounds?;
        let (tx, ty) = tilt;
        let lean = tx.abs() + ty.abs();
        if lean <= 0.0 || amount <= 0.0 {
            return None;
        }
        let (weight_x, weight_y) = (tx.abs() / lean, ty.abs() / lean);
        let (step_x, step_y) = (tx.signum() as i32, ty.signum() as i32);
        let whole = raster.bounds();
        let area = bounds.inflate(1).intersect(&whole);
        let before = raster.crop(&area);
        let get_before = |x: i32, y: i32| before.get(x - area.x, y - area.y);
        let mut moved: Option<Rect> = None;
        // Wetness is read from a copy too, so a run does not chase itself
        // across the whole map in one tick — a copy of the wet part only,
        // since this runs every frame.
        let was: Vec<f32> = (bounds.y..bounds.bottom())
            .flat_map(|y| {
                let row = (y as usize) * (self.width as usize);
                self.wetness[row + bounds.x as usize..row + bounds.right() as usize]
                    .iter()
                    .copied()
            })
            .collect();
        // Which line across the flow a pixel is on: its column when the
        // paint runs mostly up or down, its row when mostly sideways.
        let line = |x: i32, y: i32| if weight_y >= weight_x { x } else { y };
        for y in bounds.y..bounds.bottom() {
            for x in bounds.x..bounds.right() {
                let w = was[((y - bounds.y) * bounds.w + (x - bounds.x)) as usize];
                if w <= 0.0 {
                    continue;
                }
                let source = get_before(x, y);
                if source.a == 0 {
                    continue;
                }
                let streak = STREAK_FLOOR
                    + (1.0 - STREAK_FLOOR) * hash(line(x, y), 0, CH_STREAK).powi(STREAK_POWER);
                for (dx, dy, weight) in [(step_x, 0, weight_x), (0, step_y, weight_y)] {
                    if weight <= 0.0 || (dx == 0 && dy == 0) {
                        continue;
                    }
                    let (nx, ny) = (x + dx, y + dy);
                    if !whole.contains(nx, ny) {
                        continue;
                    }
                    let allowed = f32::from(cover(nx, ny)) / 255.0;
                    let t = (w * amount * weight * streak * allowed).clamp(0.0, 1.0);
                    if t <= 0.0 {
                        continue;
                    }
                    let target = raster.get(nx, ny);
                    raster.set(nx, ny, target.lerp(source, t));
                    self.wet(nx, ny, w * SPREAD * allowed);
                    let here = Rect::new(nx, ny, 1, 1);
                    moved = Some(moved.map_or(here, |m| m.union(&here)));
                }
            }
        }
        moved
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::Rgba;

    const RED: Rgba = Rgba::opaque(255, 0, 0);

    fn fresh(size: u32) -> (WetPaint, Raster) {
        let raster = Raster::filled(size, size, Rgba::WHITE);
        (WetPaint::new(LayerId(1), &raster), raster)
    }

    #[test]
    fn wetting_and_drying_track_the_bounds() {
        let (mut wet, _) = fresh(16);
        assert!(wet.is_dry());
        wet.wet(3, 4, 1.0);
        wet.wet(10, 12, 0.5);
        assert_eq!(wet.bounds(), Some(Rect::new(3, 4, 8, 9)));
        assert!(wet.dry(0.6));
        assert_eq!(
            wet.bounds(),
            Some(Rect::new(3, 4, 1, 1)),
            "the half-wet one has dried"
        );
        assert!(!wet.dry(0.5));
        assert!(wet.is_dry());
        wet.wet(-1, 3, 1.0);
        assert!(wet.is_dry(), "off the map is nowhere");
    }

    #[test]
    fn a_tilt_runs_wet_paint_downhill_and_nothing_else() {
        let (mut wet, mut raster) = fresh(16);
        raster.set(8, 2, RED);
        wet.wet(8, 2, 1.0);
        let all = raster.bounds();
        let mut moved = None;
        for _ in 0..30 {
            if let Some(m) = wet.flow(&mut raster, (0.0, 1.0), 0.5, |_, _| 255) {
                moved = Some(m);
            }
        }
        assert!(moved.is_some());
        assert!(
            raster.get(8, 6).r > raster.get(8, 6).g,
            "no red has run down: {}",
            raster.get(8, 6)
        );
        assert_eq!(raster.get(8, 1), Rgba::WHITE, "nothing ran uphill");
        assert_eq!(raster.get(7, 4), Rgba::WHITE, "nothing ran sideways");
        assert_eq!(
            raster.get(8, 2),
            RED,
            "the run leaves a trail rather than carrying the paint off"
        );
        assert_eq!(all, raster.bounds());
    }

    #[test]
    fn a_run_stops_where_the_selection_does_and_where_the_tilt_is_flat() {
        let (mut wet, mut raster) = fresh(16);
        raster.set(8, 2, RED);
        wet.wet(8, 2, 1.0);
        for _ in 0..40 {
            wet.flow(
                &mut raster,
                (0.0, 1.0),
                0.5,
                |_, y| if y < 6 { 255 } else { 0 },
            );
        }
        assert_eq!(raster.get(8, 6), Rgba::WHITE);
        assert_ne!(raster.get(8, 4), Rgba::WHITE);
        let (mut still, mut flat) = fresh(8);
        flat.set(4, 4, RED);
        still.wet(4, 4, 1.0);
        assert!(still.flow(&mut flat, (0.0, 0.0), 1.0, |_, _| 255).is_none());
    }

    #[test]
    fn a_map_knows_when_the_layer_has_changed_size() {
        let (wet, raster) = fresh(8);
        assert!(wet.fits(&raster));
        assert!(!wet.fits(&Raster::new(8, 9)));
    }
}
