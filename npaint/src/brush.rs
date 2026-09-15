//! Brush tips: the shape of coverage one dab lays down.
//!
//! A stroke is a run of dabs (see `tools/stroke.rs`), and every dab is
//! *coverage* — an alpha per pixel, combined with what the stroke has
//! already covered by maximum, so overlapping dabs never compound. A tip is
//! the rule from a pixel's position to that coverage. The round tip is the
//! classic soft disc; the others reshape or texture it:
//!
//! * **Round** — a disc, solid out to `hardness` of the radius and fading
//!   to nothing at the rim.
//! * **Square** — the same, measured as a square (Chebyshev distance), so
//!   the dab has corners.
//! * **Calligraphy** — a flat nib: an ellipse a quarter as thick as it is
//!   wide, tilted 45°, so a stroke thickens and thins with its direction.
//! * **Chalk** — the disc broken up by a grain that is fixed to the canvas,
//!   so a stroke that passes twice over a point finds the same grain there
//!   rather than filling it in.
//! * **Spatter** — a scatter of dots inside the disc, a fresh handful per
//!   dab, so where the pointer lingers the dots build up.
//!
//! Everything here is deterministic: the grain and the scatter come from
//! [`crate::dither::hash`] of the coordinates (and, for spatter, of the dab
//! centre), so a stroke replays identically and the tests are exact.

use crate::dither::hash;
use crate::geometry::{Point, Rect};
use crate::raster::Raster;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum BrushTip {
    #[default]
    Round,
    Square,
    Calligraphy,
    Chalk,
    Spatter,
}

impl BrushTip {
    pub const ALL: &'static [BrushTip] = &[BrushTip::Round, BrushTip::Square, BrushTip::Calligraphy, BrushTip::Chalk, BrushTip::Spatter];

    /// The name the page uses; part of the wasm API.
    pub fn name(self) -> &'static str {
        match self {
            BrushTip::Round => "round",
            BrushTip::Square => "square",
            BrushTip::Calligraphy => "calligraphy",
            BrushTip::Chalk => "chalk",
            BrushTip::Spatter => "spatter",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            BrushTip::Round => "Round",
            BrushTip::Square => "Square",
            BrushTip::Calligraphy => "Calligraphy",
            BrushTip::Chalk => "Chalk",
            BrushTip::Spatter => "Spatter",
        }
    }

    pub fn from_name(name: &str) -> Option<BrushTip> {
        BrushTip::ALL.iter().copied().find(|t| t.name() == name)
    }

    /// Whether the hardness slider means anything to the tip. Chalk has its
    /// grain and spatter its dots instead of a soft rim.
    pub fn has_hardness(self) -> bool {
        matches!(self, BrushTip::Round | BrushTip::Square | BrushTip::Calligraphy)
    }

    /// Lays one dab of this tip into `mask`, a coverage buffer: alpha 255
    /// where the dab is solid, less where it fades, never lowering what is
    /// already there. `diameter` is the dab's width in pixels and `hardness`
    /// (`0.0..=1.0`) how far out it stays solid. Nothing is written outside
    /// `clip`. The dab never reaches outside the `diameter`-sized square
    /// centred on `center`, which is what the stroke's dirty rectangle
    /// relies on.
    pub fn stamp(self, mask: &mut Raster, center: Point, diameter: u32, hardness: f32, clip: &Rect) {
        let diameter = diameter.max(1);
        if diameter <= 1 {
            // Every tip is a single pixel at its smallest — spatter too,
            // since a dotted line one pixel wide is just a faint line.
            mask.stamp_disc(center, 1, crate::color::Rgba::WHITE, clip);
            return;
        }
        let (cx, cy) = center.round();
        let d = diameter as i32;
        let rect = Rect::new(cx - d / 2, cy - d / 2, d, d);
        let radius = f64::from(diameter) / 2.0;
        let mid = (f64::from(rect.x) + radius, f64::from(rect.y) + radius);
        let hardness = f64::from(hardness.clamp(0.0, 1.0));
        // Coverage from a normalised distance: 1 out to `hardness`, then a
        // straight fade to 0 at 1.
        let soften = move |n: f64| -> u8 {
            if n > 1.0 {
                return 0;
            }
            let t = if n <= hardness { 1.0 } else { 1.0 - (n - hardness) / (1.0 - hardness).max(1e-9) };
            (t * 255.0).round() as u8
        };
        let offset = move |x: i32, y: i32| (f64::from(x) + 0.5 - mid.0, f64::from(y) + 0.5 - mid.1);
        match self {
            BrushTip::Round => mask.stamp_soft_disc(center, diameter, hardness as f32, clip),
            BrushTip::Square => mask.max_cover_in(rect, clip, |x, y| {
                let (dx, dy) = offset(x, y);
                soften(dx.abs().max(dy.abs()) / radius)
            }),
            BrushTip::Calligraphy => {
                // The nib runs from lower left to upper right, as a pen held
                // in the right hand does; a quarter as thick as it is long,
                // and never thinner than a pixel.
                let along = radius;
                let across = (radius / 4.0).max(0.5);
                let (s, c) = std::f64::consts::FRAC_PI_4.sin_cos();
                mask.max_cover_in(rect, clip, |x, y| {
                    let (dx, dy) = offset(x, y);
                    let u = dx * c - dy * s;
                    let v = dx * s + dy * c;
                    soften((u / along).hypot(v / across))
                })
            }
            BrushTip::Chalk => mask.max_cover_in(rect, clip, |x, y| {
                let (dx, dy) = offset(x, y);
                let base = soften(dx.hypot(dy) / radius);
                if base == 0 {
                    return 0;
                }
                // The grain: a third of the pixels are skipped outright and
                // the rest vary, keyed to the canvas so it never crawls.
                let grain = f64::from(hash(x, y, 0x6368_616c));
                if grain < 0.33 {
                    return 0;
                }
                (f64::from(base) * (0.45 + 0.55 * grain)).round() as u8
            }),
            BrushTip::Spatter => {
                // Dots the size of a cell, each cell getting one with a
                // probability tuned so that a stroke — which stamps every
                // `size / 16` pixels — ends up about half covered, however
                // wide it is. The seed is the dab's position, so each dab
                // throws a different handful.
                let cell = (d / 8).max(1);
                let seed = (cx as u32).wrapping_mul(0x9e37_79b9) ^ (cy as u32).wrapping_mul(0x85eb_ca6b) ^ 0x7370_6174;
                let spacing = f64::from(diameter / 16).max(1.0);
                let p = 1.0 - 0.5f64.powf(spacing / f64::from(diameter));
                // The dots are clipped to the dab's square as well, so a
                // dot thrown near the rim never reaches past it.
                let within = rect.intersect(clip);
                let cells_x = rect.x.div_euclid(cell)..=rect.right().div_euclid(cell);
                let cells_y = rect.y.div_euclid(cell)..=rect.bottom().div_euclid(cell);
                let mut thrown = false;
                for j in cells_y {
                    for i in cells_x.clone() {
                        if f64::from(hash(i, j, seed)) >= p {
                            continue;
                        }
                        let jx = f64::from(hash(i, j, seed ^ 1));
                        let jy = f64::from(hash(i, j, seed ^ 2));
                        let at = Point::new(f64::from(i * cell) + jx * f64::from(cell), f64::from(j * cell) + jy * f64::from(cell));
                        if (at.x - mid.0).hypot(at.y - mid.1) > radius {
                            continue;
                        }
                        mask.stamp_disc(at, cell as u32, crate::color::Rgba::WHITE, &within);
                        thrown = true;
                    }
                }
                // A dab that threw nothing — likely for a small brush —
                // still leaves one dot, so a click always shows.
                if !thrown {
                    let jx = f64::from(hash(cx, cy, seed ^ 3)) - 0.5;
                    let jy = f64::from(hash(cx, cy, seed ^ 4)) - 0.5;
                    let at = Point::new(mid.0 + jx * radius, mid.1 + jy * radius);
                    mask.stamp_disc(at, cell as u32, crate::color::Rgba::WHITE, &within);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dab(tip: BrushTip, diameter: u32, hardness: f32) -> Raster {
        let mut mask = Raster::new(64, 64);
        let all = mask.bounds();
        tip.stamp(&mut mask, Point::new(32.0, 32.0), diameter, hardness, &all);
        mask
    }

    fn covered(mask: &Raster) -> usize {
        mask.pixels().iter().filter(|p| p.a > 0).count()
    }

    fn solid(mask: &Raster) -> usize {
        mask.pixels().iter().filter(|p| p.a == 255).count()
    }

    #[test]
    fn every_tip_round_trips_its_name() {
        for tip in BrushTip::ALL {
            assert_eq!(BrushTip::from_name(tip.name()), Some(*tip));
            assert!(!tip.label().is_empty());
        }
        assert_eq!(BrushTip::from_name("fan"), None);
        assert_eq!(BrushTip::default(), BrushTip::Round);
    }

    #[test]
    fn every_tip_is_one_pixel_at_its_smallest() {
        for tip in BrushTip::ALL {
            let m = dab(*tip, 1, 1.0);
            assert_eq!(covered(&m), 1, "{tip:?}");
            assert_eq!(m.get(32, 32).a, 255, "{tip:?}");
        }
    }

    #[test]
    fn no_tip_reaches_outside_its_square() {
        for tip in BrushTip::ALL {
            for diameter in [2u32, 7, 16, 33] {
                let m = dab(*tip, diameter, 0.0);
                let d = diameter as i32;
                let square = Rect::new(32 - d / 2, 32 - d / 2, d, d);
                for y in 0..64 {
                    for x in 0..64 {
                        if m.get(x, y).a > 0 {
                            assert!(square.contains(x, y), "{tip:?} at {diameter}px painted ({x},{y}) outside {square:?}");
                        }
                    }
                }
                assert!(covered(&m) > 0, "{tip:?} at {diameter}px painted nothing");
            }
        }
    }

    #[test]
    fn the_square_tip_has_corners_and_the_round_one_does_not() {
        let square = dab(BrushTip::Square, 20, 1.0);
        let round = dab(BrushTip::Round, 20, 1.0);
        assert_eq!(solid(&square), 400, "a 20px square is 400 pixels");
        assert_eq!(square.get(22, 22).a, 255, "the corner is painted");
        assert_eq!(round.get(22, 22).a, 0, "and the disc's is not");
        assert!(solid(&round) < 400);
    }

    #[test]
    fn softness_fades_the_rim_of_the_shaped_tips() {
        for tip in [BrushTip::Square, BrushTip::Calligraphy] {
            let hard = dab(tip, 21, 1.0);
            let soft = dab(tip, 21, 0.0);
            assert_eq!(covered(&hard), covered(&soft), "{tip:?}: softness changes the fade, not the footprint");
            assert!(solid(&soft) < solid(&hard), "{tip:?}: the soft dab is not solid to the rim");
            assert_eq!(soft.get(32, 32).a, 255, "{tip:?}: solid in the middle");
            let rim = soft.pixels().iter().filter(|p| p.a > 0 && p.a < 255).count();
            assert!(rim > 0, "{tip:?}: some partial coverage");
        }
    }

    #[test]
    fn the_calligraphy_nib_is_long_one_way_and_thin_the_other() {
        let m = dab(BrushTip::Calligraphy, 33, 1.0);
        // Along the nib (lower left to upper right) it reaches the rim.
        assert_eq!(m.get(32 + 10, 32 - 10).a, 255);
        assert_eq!(m.get(32 - 10, 32 + 10).a, 255);
        // Across it (upper left to lower right) it is thin.
        assert_eq!(m.get(32 - 10, 32 - 10).a, 0);
        assert_eq!(m.get(32 + 10, 32 + 10).a, 0);
        let disc = dab(BrushTip::Round, 33, 1.0);
        assert!(covered(&m) * 3 < covered(&disc), "well under a third of the disc");
    }

    #[test]
    fn chalk_is_the_disc_with_holes_in_it_and_the_holes_stay_put() {
        let chalk = dab(BrushTip::Chalk, 31, 1.0);
        let disc = dab(BrushTip::Round, 31, 1.0);
        let (c, d) = (covered(&chalk), covered(&disc));
        assert!(c * 10 > d * 5 && c * 10 < d * 8, "roughly two thirds of the disc: {c} of {d}");
        for y in 0..64 {
            for x in 0..64 {
                assert!(chalk.get(x, y).a <= disc.get(x, y).a, "never more than the disc at ({x},{y})");
            }
        }
        // A second dab a pixel over leaves the same pixels bare where the
        // two overlap: the grain belongs to the canvas, not to the dab.
        let mut twice = chalk.clone();
        let all = twice.bounds();
        BrushTip::Chalk.stamp(&mut twice, Point::new(33.0, 32.0), 31, 1.0, &all);
        for y in 20..44 {
            for x in 22..42 {
                assert_eq!(twice.get(x, y).a == 0, chalk.get(x, y).a == 0, "({x},{y})");
            }
        }
    }

    #[test]
    fn spatter_is_dots_that_build_up() {
        let one = dab(BrushTip::Spatter, 32, 1.0);
        let disc = dab(BrushTip::Round, 32, 1.0);
        let c = covered(&one);
        assert!(c > 0 && c * 4 < covered(&disc), "sparse: {c} of {}", covered(&disc));
        assert_eq!(solid(&one), c, "the dots are hard");
        // More dabs at the same spot: more dots, never fewer.
        let mut many = one.clone();
        let all = many.bounds();
        for i in 1..16 {
            BrushTip::Spatter.stamp(&mut many, Point::new(32.0 + f64::from(i) * 0.01, 32.0), 32, 1.0, &all);
        }
        assert!(covered(&many) >= c);
        let mut moved = one.clone();
        BrushTip::Spatter.stamp(&mut moved, Point::new(33.0, 32.0), 32, 1.0, &all);
        assert!(covered(&moved) > c, "a dab a pixel over throws a different handful");
    }

    #[test]
    fn nothing_is_written_outside_the_clip() {
        for tip in BrushTip::ALL {
            let mut mask = Raster::new(64, 64);
            let clip = Rect::new(0, 0, 32, 64);
            tip.stamp(&mut mask, Point::new(32.0, 32.0), 24, 0.5, &clip);
            for y in 0..64 {
                for x in 32..64 {
                    assert_eq!(mask.get(x, y).a, 0, "{tip:?} wrote at ({x},{y})");
                }
            }
            assert!(covered(&mask) > 0, "{tip:?}");
        }
    }
}
