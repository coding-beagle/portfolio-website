//! Dithering: quantising colour to a few levels per channel while keeping
//! the tones in between by pushing the rounding error somewhere the eye
//! blends it back.
//!
//! Two families, with the same three knobs in front of them:
//!
//! * **Ordered** — a threshold matrix tiled over the picture (the Bayer
//!   matrices) or a hash of the coordinates (noise). Every pixel is decided
//!   on its own, so the pattern is the same wherever the picture is cropped,
//!   and it costs one lookup.
//! * **Error diffusion** — round the pixel, then hand what was lost to the
//!   neighbours that have not been decided yet (Floyd–Steinberg and its
//!   relatives). Much better tone, at the price of a serial pass and a
//!   result that depends on where the pass started.
//!
//! The pattern is indexed by *document* coordinates, not by the clip, so a
//! dither previewed through a selection lines up with the same dither
//! applied to the whole layer.

use crate::adjust::luminance;
use crate::color::Rgba;
use crate::geometry::Rect;
use crate::raster::Raster;

/// How the rounding error is hidden.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DitherMethod {
    Bayer2,
    Bayer4,
    Bayer8,
    Noise,
    FloydSteinberg,
    JarvisJudiceNinke,
    Stucki,
    Atkinson,
    Sierra,
}

impl DitherMethod {
    /// In the order the page's dropdown lists them; the index is what
    /// travels as the adjustment's first parameter.
    pub const ALL: &'static [DitherMethod] = &[
        DitherMethod::Bayer2,
        DitherMethod::Bayer4,
        DitherMethod::Bayer8,
        DitherMethod::Noise,
        DitherMethod::FloydSteinberg,
        DitherMethod::JarvisJudiceNinke,
        DitherMethod::Stucki,
        DitherMethod::Atkinson,
        DitherMethod::Sierra,
    ];

    /// The method at `index`, clamped to the list.
    pub fn from_index(index: f32) -> DitherMethod {
        let i = if index.is_finite() { index.round().clamp(0.0, (Self::ALL.len() - 1) as f32) as usize } else { 0 };
        Self::ALL[i]
    }

    pub fn index(self) -> f32 {
        Self::ALL.iter().position(|m| *m == self).unwrap_or(0) as f32
    }

    pub fn label(self) -> &'static str {
        match self {
            DitherMethod::Bayer2 => "Ordered 2×2",
            DitherMethod::Bayer4 => "Ordered 4×4",
            DitherMethod::Bayer8 => "Ordered 8×8",
            DitherMethod::Noise => "Noise",
            DitherMethod::FloydSteinberg => "Floyd–Steinberg",
            DitherMethod::JarvisJudiceNinke => "Jarvis–Judice–Ninke",
            DitherMethod::Stucki => "Stucki",
            DitherMethod::Atkinson => "Atkinson",
            DitherMethod::Sierra => "Sierra",
        }
    }

    /// Whether the method reads a threshold off a pattern rather than
    /// passing its error on, which is also the only family `scale` means
    /// anything to.
    pub fn is_ordered(self) -> bool {
        matches!(self, DitherMethod::Bayer2 | DitherMethod::Bayer4 | DitherMethod::Bayer8 | DitherMethod::Noise)
    }

    /// The diffusion kernel as `(dx, dy, weight)` with its divisor. Only the
    /// cells *after* the current pixel in reading order appear, so a single
    /// left-to-right, top-to-bottom pass never revisits a decided pixel.
    fn kernel(self) -> (&'static [(i32, i32, f32)], f32) {
        match self {
            DitherMethod::FloydSteinberg => (&[(1, 0, 7.0), (-1, 1, 3.0), (0, 1, 5.0), (1, 1, 1.0)], 16.0),
            DitherMethod::JarvisJudiceNinke => (
                &[
                    (1, 0, 7.0),
                    (2, 0, 5.0),
                    (-2, 1, 3.0),
                    (-1, 1, 5.0),
                    (0, 1, 7.0),
                    (1, 1, 5.0),
                    (2, 1, 3.0),
                    (-2, 2, 1.0),
                    (-1, 2, 3.0),
                    (0, 2, 5.0),
                    (1, 2, 3.0),
                    (2, 2, 1.0),
                ],
                48.0,
            ),
            DitherMethod::Stucki => (
                &[
                    (1, 0, 8.0),
                    (2, 0, 4.0),
                    (-2, 1, 2.0),
                    (-1, 1, 4.0),
                    (0, 1, 8.0),
                    (1, 1, 4.0),
                    (2, 1, 2.0),
                    (-2, 2, 1.0),
                    (-1, 2, 2.0),
                    (0, 2, 4.0),
                    (1, 2, 2.0),
                    (2, 2, 1.0),
                ],
                42.0,
            ),
            // Atkinson passes on only three quarters of the error, which is
            // what gives it its high contrast.
            DitherMethod::Atkinson => (&[(1, 0, 1.0), (2, 0, 1.0), (-1, 1, 1.0), (0, 1, 1.0), (1, 1, 1.0), (0, 2, 1.0)], 8.0),
            DitherMethod::Sierra => (
                &[
                    (1, 0, 5.0),
                    (2, 0, 3.0),
                    (-2, 1, 2.0),
                    (-1, 1, 4.0),
                    (0, 1, 5.0),
                    (1, 1, 4.0),
                    (2, 1, 2.0),
                    (-1, 2, 2.0),
                    (0, 2, 3.0),
                    (1, 2, 2.0),
                ],
                32.0,
            ),
            _ => (&[], 1.0),
        }
    }
}

/// How many rows below the current one any kernel reaches, and so how many
/// rows of error the pass has to carry.
const ERROR_ROWS: usize = 3;

/// The smallest and largest number of output levels per channel. Two is
/// black and white; 255 leaves nothing to round.
pub const MIN_LEVELS: f32 = 2.0;
pub const MAX_LEVELS: f32 = 255.0;
/// The largest pattern cell, in pixels.
pub const MAX_SCALE: f32 = 16.0;

/// A dither, ready to apply. Built by [`crate::adjust::Adjustment`] from the
/// dialog's numbers.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Dither {
    pub method: DitherMethod,
    /// Output levels per channel, `2..=255`.
    pub levels: f32,
    /// How much of the pattern (or of the error) is actually used,
    /// `0..=1`. Zero is a plain rounding — posterize.
    pub strength: f32,
    /// The size of one cell of the pattern in pixels, `1..=16`. Ordered
    /// methods only.
    pub scale: f32,
    /// Throw the colour away first and dither the grey.
    pub mono: bool,
}

impl Dither {
    /// The colour a pixel rounds to with no dither at all, which is what a
    /// per-pixel view of this adjustment can honestly say.
    pub fn quantize(&self, p: Rgba) -> Rgba {
        let n = self.levels();
        let v = self.channels(p);
        Rgba::new(to_byte(step(v[0], n)), to_byte(step(v[1], n)), to_byte(step(v[2], n)), p.a)
    }

    pub fn apply(&self, raster: &mut Raster, clip: &Rect) {
        if self.method.is_ordered() {
            self.apply_ordered(raster, clip);
        } else {
            self.apply_diffused(raster, clip);
        }
    }

    fn levels(&self) -> f32 {
        self.levels.round().clamp(MIN_LEVELS, MAX_LEVELS)
    }

    fn cell(&self) -> i32 {
        self.scale.round().clamp(1.0, MAX_SCALE) as i32
    }

    /// The pixel as three `0..=1` channels, greyed first if asked.
    fn channels(&self, p: Rgba) -> [f32; 3] {
        if self.mono {
            let y = f32::from(luminance(p)) / 255.0;
            [y; 3]
        } else {
            [f32::from(p.r) / 255.0, f32::from(p.g) / 255.0, f32::from(p.b) / 255.0]
        }
    }

    fn apply_ordered(&self, raster: &mut Raster, clip: &Rect) {
        let n = self.levels();
        let cell = self.cell();
        // One step of the output ramp: the most the threshold may move a
        // pixel, or neighbouring levels would swap.
        let span = self.strength.clamp(0.0, 1.0) / (n - 1.0);
        let noise = self.method == DitherMethod::Noise;
        let mono = self.mono;
        raster.map_at(clip, |p, x, y| {
            // Nothing shows through a hole, so its colour is left as it is
            // rather than being rounded to something arbitrary.
            if p.a == 0 {
                return p;
            }
            let (px, py) = (x.div_euclid(cell), y.div_euclid(cell));
            let v = self.channels(p);
            let mut out = [0u8; 3];
            for (c, slot) in out.iter_mut().enumerate() {
                // A noise dither decides each channel separately, which
                // disperses it better; in mono the three must agree.
                let t = if noise {
                    hash(px, py, if mono { 0 } else { c as u32 })
                } else {
                    bayer(self.method, px, py)
                };
                *slot = to_byte(step(v[c] + (t - 0.5) * span, n));
            }
            Rgba::new(out[0], out[1], out[2], p.a)
        });
    }

    fn apply_diffused(&self, raster: &mut Raster, clip: &Rect) {
        let area = clip.intersect(&raster.bounds());
        if area.is_empty() {
            return;
        }
        let n = self.levels();
        let strength = self.strength.clamp(0.0, 1.0);
        let (kernel, divisor) = self.method.kernel();
        let w = area.w as usize;
        // A ring of the rows still to come: the current row's debt is read
        // and cleared, then it becomes the row two below.
        let mut rows: [Vec<f32>; ERROR_ROWS] = std::array::from_fn(|_| vec![0.0f32; w * 3]);
        let mut base = 0usize;
        for y in area.y..area.bottom() {
            for x in area.x..area.right() {
                let i = (x - area.x) as usize;
                let p = raster.get(x, y);
                // Nothing is visible through a hole, so it is left alone and
                // its error is dropped rather than smeared into the picture.
                if p.a == 0 {
                    continue;
                }
                let v = self.channels(p);
                let mut out = [0u8; 3];
                let mut err = [0.0f32; 3];
                for c in 0..3 {
                    let wanted = v[c] + rows[base][i * 3 + c];
                    let got = step(wanted, n);
                    out[c] = to_byte(got);
                    err[c] = (wanted - got) * strength;
                }
                raster.set(x, y, Rgba::new(out[0], out[1], out[2], p.a));
                for (dx, dy, weight) in kernel {
                    let nx = i as i32 + dx;
                    if nx < 0 || nx >= w as i32 {
                        continue;
                    }
                    let row = (base + *dy as usize) % ERROR_ROWS;
                    let at = nx as usize * 3;
                    for c in 0..3 {
                        rows[row][at + c] += err[c] * weight / divisor;
                    }
                }
            }
            rows[base].fill(0.0);
            base = (base + 1) % ERROR_ROWS;
        }
    }
}

/// Rounds a `0..=1` value to the nearest of `n` evenly spaced levels.
fn step(v: f32, n: f32) -> f32 {
    ((v.clamp(0.0, 1.0) * (n - 1.0)).round()) / (n - 1.0)
}

fn to_byte(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0).round() as u8
}

const BAYER2: [u8; 4] = [0, 2, 3, 1];

#[rustfmt::skip]
const BAYER4: [u8; 16] = [
     0,  8,  2, 10,
    12,  4, 14,  6,
     3, 11,  1,  9,
    15,  7, 13,  5,
];

#[rustfmt::skip]
const BAYER8: [u8; 64] = [
     0, 32,  8, 40,  2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44,  4, 36, 14, 46,  6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
     3, 35, 11, 43,  1, 33,  9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47,  7, 39, 13, 45,  5, 37,
    63, 31, 55, 23, 61, 29, 53, 21,
];

/// The threshold the tiled matrix holds at `(x, y)`, in `0..1`. Half a step
/// is added so the thresholds sit in the middle of their slots and the
/// matrix is symmetric about 0.5.
fn bayer(method: DitherMethod, x: i32, y: i32) -> f32 {
    let (matrix, side): (&[u8], i32) = match method {
        DitherMethod::Bayer2 => (&BAYER2, 2),
        DitherMethod::Bayer4 => (&BAYER4, 4),
        _ => (&BAYER8, 8),
    };
    let i = (y.rem_euclid(side) * side + x.rem_euclid(side)) as usize;
    (f32::from(matrix[i]) + 0.5) / matrix.len() as f32
}

/// A value in `0..1` from the coordinates alone: the same pixel always gets
/// the same "random" threshold, so the noise does not crawl between
/// previews or between a preview and the commit.
fn hash(x: i32, y: i32, c: u32) -> f32 {
    let mut h = (x as u32).wrapping_mul(0x8da6_b343) ^ (y as u32).wrapping_mul(0xd816_3841) ^ c.wrapping_mul(0xcb1a_b31f);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2c1b_3c6d);
    h ^= h >> 12;
    h = h.wrapping_mul(0x297a_2d39);
    h ^= h >> 15;
    f32::from((h >> 16) as u16) / 65536.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dither(method: DitherMethod) -> Dither {
        Dither { method, levels: 2.0, strength: 1.0, scale: 1.0, mono: false }
    }

    /// A flat grey field, the hardest thing for a dither to get right.
    fn flat(v: u8, w: u32, h: u32) -> Raster {
        Raster::filled(w, h, Rgba::opaque(v, v, v))
    }

    fn mean(r: &Raster) -> f32 {
        r.pixels().iter().map(|p| f32::from(p.r)).sum::<f32>() / r.pixels().len() as f32
    }

    #[test]
    fn every_method_holds_the_average_of_a_flat_field() {
        for method in DitherMethod::ALL {
            let mut r = flat(128, 32, 32);
            let bounds = r.bounds();
            dither(*method).apply(&mut r, &bounds);
            // Two levels: every pixel is black or white.
            assert!(r.pixels().iter().all(|p| p.r == 0 || p.r == 255), "{}", method.label());
            let m = mean(&r);
            assert!((m - 128.0).abs() < 24.0, "{} averaged {m}", method.label());
        }
    }

    #[test]
    fn a_flat_field_comes_out_flat_when_it_lands_on_a_level() {
        for method in DitherMethod::ALL {
            let mut r = flat(255, 8, 8);
            let bounds = r.bounds();
            dither(*method).apply(&mut r, &bounds);
            assert!(r.pixels().iter().all(|p| *p == Rgba::WHITE), "{}", method.label());
        }
    }

    #[test]
    fn no_strength_is_a_plain_rounding() {
        for method in DitherMethod::ALL {
            let mut r = flat(100, 8, 8);
            let bounds = r.bounds();
            Dither { strength: 0.0, ..dither(*method) }.apply(&mut r, &bounds);
            assert!(r.pixels().iter().all(|p| *p == Rgba::BLACK), "{}", method.label());
        }
    }

    #[test]
    fn levels_land_on_the_ramp_and_reach_both_ends() {
        let mut r = flat(128, 16, 16);
        let bounds = r.bounds();
        Dither { levels: 4.0, ..dither(DitherMethod::Bayer4) }.apply(&mut r, &bounds);
        for p in r.pixels() {
            assert!(matches!(p.r, 0 | 85 | 170 | 255), "{p} is not on a four-level ramp");
        }
    }

    #[test]
    fn alpha_is_never_touched_and_holes_are_left_alone() {
        for method in DitherMethod::ALL {
            let mut r = flat(128, 4, 4);
            r.set(1, 1, Rgba::new(9, 9, 9, 0));
            let bounds = r.bounds();
            dither(*method).apply(&mut r, &bounds);
            assert_eq!(r.get(1, 1), Rgba::new(9, 9, 9, 0), "{}", method.label());
            assert!(r.pixels().iter().all(|p| p.a == 255 || p.a == 0), "{}", method.label());
        }
    }

    #[test]
    fn mono_throws_the_colour_away_and_colour_keeps_it() {
        let mut r = Raster::filled(16, 16, Rgba::opaque(200, 40, 40));
        let bounds = r.bounds();
        let mut grey = r.clone();
        Dither { mono: true, ..dither(DitherMethod::Bayer8) }.apply(&mut grey, &bounds);
        assert!(grey.pixels().iter().all(|p| p.r == p.g && p.g == p.b), "mono left a cast");
        dither(DitherMethod::Bayer8).apply(&mut r, &bounds);
        assert!(r.pixels().iter().any(|p| p.r != p.g), "colour was thrown away");
    }

    #[test]
    fn the_clip_is_respected_and_the_pattern_is_placed_by_document_position() {
        for method in DitherMethod::ALL {
            let mut whole = flat(128, 8, 8);
            let bounds = whole.bounds();
            dither(*method).apply(&mut whole, &bounds);
            let mut part = flat(128, 8, 8);
            let strip = Rect::new(2, 0, 4, 8);
            dither(*method).apply(&mut part, &strip);
            assert_eq!(part.get(0, 0), Rgba::opaque(128, 128, 128), "{} wrote outside the clip", method.label());
            if method.is_ordered() {
                // An ordered pattern is read from where the pixel *is*, so a
                // clipped run matches the whole one inside the clip.
                for y in 0..8 {
                    for x in 2..6 {
                        assert_eq!(part.get(x, y), whole.get(x, y), "{} moved with the clip", method.label());
                    }
                }
            }
        }
    }

    #[test]
    fn scale_makes_the_cells_bigger() {
        let mut r = flat(128, 16, 16);
        let bounds = r.bounds();
        Dither { scale: 4.0, ..dither(DitherMethod::Bayer2) }.apply(&mut r, &bounds);
        // Every 4x4 block is one cell of the 2x2 matrix, so it is uniform.
        for by in 0..4 {
            for bx in 0..4 {
                let first = r.get(bx * 4, by * 4);
                for y in 0..4 {
                    for x in 0..4 {
                        assert_eq!(r.get(bx * 4 + x, by * 4 + y), first, "block ({bx},{by}) is not one cell");
                    }
                }
            }
        }
    }

    #[test]
    fn an_ordered_dither_of_a_ramp_is_monotone_on_average() {
        let mut r = Raster::new(256, 8);
        for y in 0..8 {
            for x in 0..256 {
                r.set(x, y, Rgba::opaque(x as u8, x as u8, x as u8));
            }
        }
        let bounds = r.bounds();
        Dither { mono: true, ..dither(DitherMethod::Bayer8) }.apply(&mut r, &bounds);
        let column = |x: i32| (0..8).map(|y| f32::from(r.get(x, y).r)).sum::<f32>() / 8.0;
        assert!(column(16) < column(128), "the dark end stayed darker");
        assert!(column(128) < column(240));
    }

    #[test]
    fn methods_index_both_ways_and_out_of_range_is_clamped() {
        for method in DitherMethod::ALL {
            assert_eq!(DitherMethod::from_index(method.index()), *method);
            assert!(!method.label().is_empty());
        }
        assert_eq!(DitherMethod::from_index(-5.0), DitherMethod::Bayer2);
        assert_eq!(DitherMethod::from_index(999.0), DitherMethod::Sierra);
        assert_eq!(DitherMethod::from_index(f32::NAN), DitherMethod::Bayer2);
    }

    #[test]
    fn hash_stays_in_range_and_does_not_repeat_across_the_channels() {
        for x in 0..20 {
            for y in 0..20 {
                for c in 0..3 {
                    let v = hash(x, y, c);
                    assert!((0.0..1.0).contains(&v), "{v}");
                }
                assert_ne!(hash(x, y, 0), hash(x, y, 1));
            }
        }
    }

    #[test]
    fn bayer_thresholds_cover_the_range_evenly() {
        for method in [DitherMethod::Bayer2, DitherMethod::Bayer4, DitherMethod::Bayer8] {
            let side = match method {
                DitherMethod::Bayer2 => 2,
                DitherMethod::Bayer4 => 4,
                _ => 8,
            };
            let mut seen: Vec<f32> = (0..side).flat_map(|y| (0..side).map(move |x| bayer(method, x, y))).collect();
            seen.sort_by(|a, b| a.partial_cmp(b).unwrap());
            seen.dedup();
            assert_eq!(seen.len(), (side * side) as usize, "{} repeats a threshold", method.label());
            assert!(seen.iter().all(|v| (0.0..1.0).contains(v)));
            // Symmetric about the middle: as many below as above.
            assert_eq!(seen.iter().filter(|v| **v < 0.5).count(), seen.len() / 2);
        }
    }
}
