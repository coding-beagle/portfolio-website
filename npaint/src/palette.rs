//! Palettes: a fixed set of colours, and a picture conformed to them.
//!
//! A [`Palette`] is what the page's palette panel holds — the sixteen or
//! thirty-two colours a piece of pixel art is drawn in — and what
//! [`crate::adjust::Kind::Palette`] maps a photograph onto: every pixel
//! becomes the palette colour nearest it, with the rounding error hidden by
//! a dither, exactly as [`crate::dither`] hides the error of rounding to a
//! number of levels.
//!
//! The difference from a dither is the target. A dither rounds each channel
//! to the nearest of an evenly spaced ladder, so the step it perturbs by is
//! known in advance; a palette's colours are anywhere at all, so the ordered
//! patterns perturb by [`Palette::spread`] — how far apart the palette's
//! colours typically are — and the diffusion passes carry the error of the
//! whole colour rather than of one channel.
//!
//! Alpha is left exactly as it was found, as with every other adjustment,
//! and a fully transparent pixel is not mapped at all: nothing shows through
//! a hole, so rounding its colour would only drag what is stored under it
//! into the picture.

use crate::color::Rgba;
use crate::dither::{bayer, hash, DitherMethod, ERROR_ROWS};
use crate::geometry::Rect;
use crate::raster::Raster;
use std::collections::HashMap;

/// How many colours a palette may hold. A palette is a set of colours
/// someone chose; past this it is an image.
pub const MAX_COLORS: usize = 256;

/// How coarsely [`Palette::from_image`] buckets colours before counting
/// them: 32 levels a channel, so shades within about eight of each other
/// count as the same colour rather than as thousands of near-misses.
const BUCKET_LEVELS: u32 = 32;

/// One bucket of [`Palette::from_image`]: how many pixels fell in it and
/// their totals, which give the colour it reports.
type Bucket = (u32, [u64; 3]);

/// A set of colours to draw in, or to conform a picture to.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Palette {
    colors: Vec<Rgba>,
}

impl Palette {
    /// The palette, with no more colours than [`MAX_COLORS`]. Alpha plays no
    /// part in matching, so the colours are kept as they came.
    pub fn new(colors: Vec<Rgba>) -> Palette {
        let mut colors = colors;
        colors.truncate(MAX_COLORS);
        Palette { colors }
    }

    /// Colours as `[r, g, b]` each, which is how a palette crosses to the
    /// page and rides in an adjustment's parameters. A run too short to
    /// finish a colour is dropped.
    pub fn from_flat(flat: &[f32]) -> Palette {
        let byte = |v: f32| if v.is_finite() { v.round().clamp(0.0, 255.0) as u8 } else { 0 };
        Palette::new(flat.as_chunks::<3>().0.iter().map(|c| Rgba::opaque(byte(c[0]), byte(c[1]), byte(c[2]))).collect())
    }

    pub fn to_flat(&self) -> Vec<f32> {
        self.colors.iter().flat_map(|c| [f32::from(c.r), f32::from(c.g), f32::from(c.b)]).collect()
    }

    pub fn colors(&self) -> &[Rgba] {
        &self.colors
    }

    pub fn is_empty(&self) -> bool {
        self.colors.is_empty()
    }

    /// The palette colour nearest `p`, keeping `p`'s own alpha. An empty
    /// palette has nothing to offer and gives the colour back untouched.
    pub fn nearest(&self, p: Rgba) -> Rgba {
        match self.nearest_to([f32::from(p.r), f32::from(p.g), f32::from(p.b)]) {
            Some(c) => c.with_alpha(p.a),
            None => p,
        }
    }

    /// The nearest colour to a point in `0..=255` RGB, by straight Euclidean
    /// distance. Not a perceptual distance: a palette is usually chosen for
    /// how its colours sit together, and the cheap answer is the one every
    /// pixel-art tool gives.
    fn nearest_to(&self, rgb: [f32; 3]) -> Option<Rgba> {
        self.colors
            .iter()
            .copied()
            .map(|c| {
                let d = [f32::from(c.r) - rgb[0], f32::from(c.g) - rgb[1], f32::from(c.b) - rgb[2]];
                (d[0] * d[0] + d[1] * d[1] + d[2] * d[2], c)
            })
            .min_by(|a, b| a.0.total_cmp(&b.0))
            .map(|(_, c)| c)
    }

    /// How far apart the palette's colours typically are, in `0..=1` of one
    /// channel: the mean distance from a colour to its nearest neighbour.
    /// This is the palette's answer to a dither's step — the most an ordered
    /// pattern may move a pixel before it lands on the wrong colour
    /// altogether. Fewer than two colours have no spacing, so it is zero.
    pub fn spread(&self) -> f32 {
        if self.colors.len() < 2 {
            return 0.0;
        }
        let total: f32 = self
            .colors
            .iter()
            .map(|c| {
                self.colors
                    .iter()
                    .filter(|o| *o != c)
                    .map(|o| {
                        let d = [
                            f32::from(c.r) - f32::from(o.r),
                            f32::from(c.g) - f32::from(o.g),
                            f32::from(c.b) - f32::from(o.b),
                        ];
                        (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt()
                    })
                    .fold(f32::MAX, f32::min)
            })
            .sum();
        // The distance is across all three channels; one channel's share of
        // it is what a threshold is added to.
        total / self.colors.len() as f32 / 255.0 / 3f32.sqrt()
    }

    /// The colours a picture is mostly made of, most used first, at most
    /// `max` of them.
    ///
    /// Near-identical shades are counted together (see [`BUCKET_LEVELS`])
    /// and each bucket reports the average of what fell in it, so a
    /// photograph gives the colours it is actually drawn in rather than
    /// `max` shades of one of them.
    pub fn from_image(raster: &Raster, max: usize) -> Palette {
        let mut buckets: HashMap<(u8, u8, u8), Bucket> = HashMap::new();
        let step = 256 / BUCKET_LEVELS;
        for y in 0..raster.height() as i32 {
            for x in 0..raster.width() as i32 {
                let p = raster.get(x, y);
                if p.a == 0 {
                    continue;
                }
                let key = |v: u8| (u32::from(v) / step) as u8;
                let entry = buckets.entry((key(p.r), key(p.g), key(p.b))).or_insert((0, [0; 3]));
                entry.0 += 1;
                entry.1[0] += u64::from(p.r);
                entry.1[1] += u64::from(p.g);
                entry.1[2] += u64::from(p.b);
            }
        }
        let mut found: Vec<((u8, u8, u8), Bucket)> = buckets.into_iter().collect();
        // The key breaks ties, so the same picture always gives the same
        // palette in the same order.
        found.sort_by(|a, b| b.1 .0.cmp(&a.1 .0).then(a.0.cmp(&b.0)));
        found.truncate(max.min(MAX_COLORS));
        Palette::new(
            found
                .into_iter()
                .map(|(_, (count, sum))| {
                    let mean = |c: usize| (sum[c] / u64::from(count)) as u8;
                    Rgba::opaque(mean(0), mean(1), mean(2))
                })
                .collect(),
        )
    }

    /// Every pixel of `clip` replaced by the palette colour nearest it, with
    /// `method` hiding the error. `None` is a plain nearest match.
    ///
    /// `strength` is `0.0..=1.0` of the pattern (or of the error passed on)
    /// and `scale` the size of an ordered pattern's cell in pixels, as they
    /// are for a dither.
    pub fn map(&self, raster: &mut Raster, clip: &Rect, method: Option<DitherMethod>, strength: f32, scale: i32) {
        if self.is_empty() {
            return;
        }
        match method {
            None => raster.map_in(clip, |p| self.nearest(p)),
            Some(m) if m.is_ordered() => self.map_ordered(raster, clip, m, strength, scale),
            Some(m) => self.map_diffused(raster, clip, m, strength),
        }
    }

    fn map_ordered(&self, raster: &mut Raster, clip: &Rect, method: DitherMethod, strength: f32, scale: i32) {
        let cell = scale.max(1);
        // The threshold may move a pixel by up to the gap between
        // neighbouring colours; more and it would land past the colour the
        // dither is mixing towards.
        let span = strength.clamp(0.0, 1.0) * self.spread() * 255.0;
        let noise = method == DitherMethod::Noise;
        raster.map_at(clip, |p, x, y| {
            if p.a == 0 {
                return p;
            }
            let (px, py) = (x.div_euclid(cell), y.div_euclid(cell));
            let channel = |c: u32, v: u8| {
                let t = if noise { hash(px, py, c) } else { bayer(method, px, py) };
                f32::from(v) + (t - 0.5) * span
            };
            match self.nearest_to([channel(0, p.r), channel(1, p.g), channel(2, p.b)]) {
                Some(c) => c.with_alpha(p.a),
                None => p,
            }
        });
    }

    /// The error-diffusion pass, the same shape as the dither's: the debt
    /// owed to the rows still to come is carried in a ring, and what a pixel
    /// could not be given is handed on to the neighbours after it.
    fn map_diffused(&self, raster: &mut Raster, clip: &Rect, method: DitherMethod, strength: f32) {
        let area = clip.intersect(&raster.bounds());
        if area.is_empty() {
            return;
        }
        let strength = strength.clamp(0.0, 1.0);
        let (kernel, divisor) = method.kernel();
        let width = area.w as usize;
        let mut rows: [Vec<f32>; ERROR_ROWS] = std::array::from_fn(|_| vec![0.0f32; width * 3]);
        let mut base = 0usize;
        for y in area.y..area.bottom() {
            for x in area.x..area.right() {
                let i = (x - area.x) as usize;
                let p = raster.get(x, y);
                if p.a == 0 {
                    continue;
                }
                let wanted = [
                    f32::from(p.r) + rows[base][i * 3],
                    f32::from(p.g) + rows[base][i * 3 + 1],
                    f32::from(p.b) + rows[base][i * 3 + 2],
                ];
                let Some(got) = self.nearest_to(wanted) else { continue };
                raster.set(x, y, got.with_alpha(p.a));
                let err = [
                    (wanted[0] - f32::from(got.r)) * strength,
                    (wanted[1] - f32::from(got.g)) * strength,
                    (wanted[2] - f32::from(got.b)) * strength,
                ];
                for (dx, dy, weight) in kernel {
                    let nx = i as i32 + dx;
                    if nx < 0 || nx >= width as i32 {
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

#[cfg(test)]
mod tests {
    use super::*;

    const BLACK: Rgba = Rgba::opaque(0, 0, 0);
    const WHITE: Rgba = Rgba::opaque(255, 255, 255);
    const RED: Rgba = Rgba::opaque(255, 0, 0);

    fn mono() -> Palette {
        Palette::new(vec![BLACK, WHITE])
    }

    fn flat(w: u32, h: u32, color: Rgba) -> Raster {
        let mut r = Raster::new(w, h);
        r.fill_rect(Rect::new(0, 0, w as i32, h as i32), color, &Rect::new(0, 0, w as i32, h as i32));
        r
    }

    #[test]
    fn colours_cross_the_boundary_as_numbers() {
        let p = Palette::new(vec![RED, WHITE]);
        assert_eq!(p.to_flat(), vec![255.0, 0.0, 0.0, 255.0, 255.0, 255.0]);
        assert_eq!(Palette::from_flat(&p.to_flat()), p);
        assert!(Palette::from_flat(&[1.0, 2.0]).is_empty(), "two thirds of a colour is no colour");
    }

    #[test]
    fn a_colour_lands_on_the_nearest_one_and_keeps_its_alpha() {
        let p = mono();
        assert_eq!(p.nearest(Rgba::opaque(200, 200, 200)), WHITE);
        assert_eq!(p.nearest(Rgba::new(20, 20, 20, 77)), Rgba::new(0, 0, 0, 77));
        assert_eq!(Palette::default().nearest(RED), RED, "an empty palette has nothing to say");
    }

    #[test]
    fn mapping_without_a_dither_is_the_nearest_colour_everywhere() {
        let mut r = flat(4, 4, Rgba::opaque(200, 200, 200));
        let area = r.bounds();
        mono().map(&mut r, &area, None, 1.0, 1);
        for y in 0..4 {
            for x in 0..4 {
                assert_eq!(r.get(x, y), WHITE);
            }
        }
    }

    #[test]
    fn an_ordered_dither_mixes_the_two_nearest_colours() {
        let mut r = flat(8, 8, Rgba::opaque(128, 128, 128));
        let area = r.bounds();
        mono().map(&mut r, &area, Some(DitherMethod::Bayer4), 1.0, 1);
        let lit = (0..8).flat_map(|y| (0..8).map(move |x| (x, y))).filter(|(x, y)| r.get(*x, *y) == WHITE).count();
        assert!(lit > 20 && lit < 44, "mid grey is about half white: {lit} of 64");
    }

    #[test]
    fn a_diffused_dither_averages_out_to_the_colour_it_was_given() {
        let mut r = flat(16, 16, Rgba::opaque(64, 64, 64));
        let area = r.bounds();
        mono().map(&mut r, &area, Some(DitherMethod::FloydSteinberg), 1.0, 1);
        let lit = (0..16).flat_map(|y| (0..16).map(move |x| (x, y))).filter(|(x, y)| r.get(*x, *y) == WHITE).count();
        assert!(lit > 40 && lit < 90, "a quarter of the way up is about a quarter white: {lit} of 256");
    }

    #[test]
    fn a_hole_is_left_alone_by_every_route() {
        for method in [None, Some(DitherMethod::Bayer4), Some(DitherMethod::FloydSteinberg)] {
            let mut r = flat(4, 4, Rgba::TRANSPARENT);
            let area = r.bounds();
            mono().map(&mut r, &area, method, 1.0, 1);
            assert_eq!(r.get(1, 1), Rgba::TRANSPARENT, "{method:?}");
        }
    }

    #[test]
    fn the_spread_is_how_far_apart_the_colours_are() {
        assert_eq!(Palette::new(vec![RED]).spread(), 0.0, "one colour has no spacing");
        assert!(mono().spread() > 0.9, "black and white are as far apart as colours get");
        let close = Palette::new(vec![BLACK, Rgba::opaque(8, 8, 8)]);
        assert!(close.spread() < 0.05, "two near shades are close: {}", close.spread());
    }

    #[test]
    fn a_palette_from_a_picture_is_its_colours_most_used_first() {
        let mut r = flat(10, 10, RED);
        r.fill_rect(Rect::new(0, 0, 10, 3), WHITE, &r.bounds());
        // A shade a hair off the red counts with it rather than as its own.
        r.fill_rect(Rect::new(0, 9, 10, 1), Rgba::opaque(252, 2, 2), &r.bounds());
        let p = Palette::from_image(&r, 8);
        assert_eq!(p.colors().len(), 2, "two colours, not three: {:?}", p.colors());
        assert!(p.colors()[0].r > 240 && p.colors()[0].g < 10, "the red covers most of it");
        assert_eq!(p.colors()[1], WHITE);
    }

    #[test]
    fn a_palette_from_a_picture_stops_where_it_is_asked_to() {
        let mut r = Raster::new(8, 8);
        for y in 0..8 {
            for x in 0..8 {
                r.set(x, y, Rgba::opaque((x * 32) as u8, (y * 32) as u8, 0));
            }
        }
        assert_eq!(Palette::from_image(&r, 4).colors().len(), 4);
        assert!(Palette::from_image(&Raster::new(4, 4), 8).is_empty(), "nothing opaque, nothing to count");
    }

    #[test]
    fn a_palette_holds_no_more_colours_than_it_may() {
        let many: Vec<Rgba> = (0..MAX_COLORS + 10).map(|i| Rgba::opaque(i as u8, 0, 0)).collect();
        assert_eq!(Palette::new(many).colors().len(), MAX_COLORS);
    }
}
