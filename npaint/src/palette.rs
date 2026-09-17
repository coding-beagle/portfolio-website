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

/// The furthest apart [`Palette::from_image`] will insist its colours are,
/// as an RGB distance (the whole cube's diagonal is about 442). Full bias
/// leaves only a handful of colours from any picture, which is the point of
/// the far end of the slider.
const MAX_SEPARATION: f32 = 192.0;

/// How many colours the cut is asked for before the ones too close together
/// are dropped: the bias throws candidates away, so there have to be spares
/// for it to work through.
const OVERSAMPLE: usize = 4;

/// How coarsely [`Palette::from_image`] buckets colours before counting
/// them: 32 levels a channel, so shades within about eight of each other
/// count as the same colour rather than as thousands of near-misses.
const BUCKET_LEVELS: u32 = 32;

/// One cell of the colour cube while the picture is being gathered: how
/// many pixels fell in it, and their totals, which give its average colour.
type Cell = (u32, [u64; 3]);

/// One bucket of [`Palette::from_image`]: a colour the picture holds, and
/// how many pixels of it there are.
#[derive(Clone, Copy, Debug)]
struct Bucket {
    color: [u8; 3],
    count: u32,
}

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

    /// The picture's colours, at most `max` of them, held at least
    /// `separation` apart.
    ///
    /// The cut itself is a median cut: the coarse buckets of the picture
    /// (see [`BUCKET_LEVELS`]) are one box in colour space, split again and
    /// again — the widest box, across its widest channel, at the middle of
    /// that channel's range — until there are as many boxes as are wanted,
    /// each reporting its own pixel-weighted average. Halving a box by
    /// *colour* rather than by pixel count is what stops a crowded cluster
    /// of near-identical shades being divided over and over while the rest
    /// of the picture waits.
    ///
    /// That alone is not always enough — a photograph really is mostly one
    /// or two colours, and a cut fine enough to reach the rest of it comes
    /// back with several shades of those. `separation` is the answer:
    /// `0.0..=1.0` of [`MAX_SEPARATION`], the least an answer may resemble
    /// the ones already found. The cut is asked for more colours than are
    /// wanted ([`OVERSAMPLE`]) and they are taken in order of how much of
    /// the picture each covers, each one skipped if it is nearer than that
    /// to one already taken. At zero nothing is skipped and the cut's own
    /// answer stands; wound up, near-shades give way to colours from
    /// elsewhere in the picture, and a picture that has nothing else to
    /// offer comes back with fewer colours than were asked for.
    ///
    /// They come back by how much of the picture each covers, most first;
    /// the page sorts them however it likes to show them.
    pub fn from_image(raster: &Raster, max: usize, separation: f32) -> Palette {
        let max = max.min(MAX_COLORS);
        if max == 0 {
            return Palette::default();
        }
        let apart = if separation.is_finite() { separation.clamp(0.0, 1.0) * MAX_SEPARATION } else { 0.0 };
        let wanted = if apart > 0.0 { max.saturating_mul(OVERSAMPLE).min(MAX_COLORS) } else { max };
        let mut chosen: Vec<Bucket> = Vec::new();
        for candidate in median_cut(gather(raster), wanted) {
            if chosen.len() == max {
                break;
            }
            if chosen.iter().all(|kept| apart_enough(kept.color, candidate.color, apart)) {
                chosen.push(candidate);
            }
        }
        Palette::new(chosen.into_iter().map(|b| Rgba::opaque(b.color[0], b.color[1], b.color[2])).collect())
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

/// The picture as coarse buckets: one entry per cell of the colour cube
/// that any pixel fell in, holding the average colour of those pixels and
/// how many there were. Fully transparent pixels are not colours of the
/// picture and are left out.
fn gather(raster: &Raster) -> Vec<Bucket> {
    let mut cells: HashMap<(u8, u8, u8), Cell> = HashMap::new();
    let step = 256 / BUCKET_LEVELS;
    for y in 0..raster.height() as i32 {
        for x in 0..raster.width() as i32 {
            let p = raster.get(x, y);
            if p.a == 0 {
                continue;
            }
            let key = |v: u8| (u32::from(v) / step) as u8;
            let cell = cells.entry((key(p.r), key(p.g), key(p.b))).or_insert((0, [0; 3]));
            cell.0 += 1;
            cell.1[0] += u64::from(p.r);
            cell.1[1] += u64::from(p.g);
            cell.1[2] += u64::from(p.b);
        }
    }
    let mut found: Vec<((u8, u8, u8), Cell)> = cells.into_iter().collect();
    // The cell breaks ties, so the same picture always gives the same
    // palette rather than whatever order the map happened to hold.
    found.sort_by(|a, b| b.1 .0.cmp(&a.1 .0).then(a.0.cmp(&b.0)));
    found
        .into_iter()
        .map(|(_, (count, sum))| {
            let mean = |c: usize| (sum[c] / u64::from(count)) as u8;
            Bucket { color: [mean(0), mean(1), mean(2)], count }
        })
        .collect()
}

/// How small a share of the picture a bucket may be and still count as one
/// of its colours: below this it is a stray pixel or a compression artefact,
/// and it is dropped as long as enough buckets are left to fill the palette.
const NEGLIGIBLE_SHARE: u64 = 2000;

/// The buckets cut down to at most `max` colours, most of the picture first.
/// See [`Palette::from_image`] for what the cut is and why.
fn median_cut(buckets: Vec<Bucket>, max: usize) -> Vec<Bucket> {
    if max == 0 || buckets.is_empty() {
        return Vec::new();
    }
    let total = weight(&buckets);
    let worth_it: Vec<Bucket> =
        buckets.iter().copied().filter(|b| u64::from(b.count) * NEGLIGIBLE_SHARE >= total).collect();
    let buckets = if worth_it.len() >= max { worth_it } else { buckets };
    let mut boxes: Vec<Vec<Bucket>> = vec![buckets];
    while boxes.len() < max {
        // The widest box is the one worth splitting; a box that is one
        // colour wide has nothing left to say, so a picture with fewer
        // colours than asked for simply stops here.
        let Some(next) = boxes
            .iter()
            .enumerate()
            .filter(|(_, b)| b.len() > 1 && spread_of(b).1 > 0)
            .max_by(|a, b| spread_of(a.1).1.cmp(&spread_of(b.1).1).then(weight(a.1).cmp(&weight(b.1))))
            .map(|(i, _)| i)
        else {
            break;
        };
        let (channel, _) = spread_of(&boxes[next]);
        let mut members = boxes.remove(next);
        members.sort_by_key(|b| b.color[channel]);
        // Cut the box in half *by colour*, not by pixel count: a photograph
        // is mostly one or two colours, and splitting where the pixels are
        // would keep dividing those and never reach the rest of it. What
        // comes out is one entry per region of colour the picture uses.
        let lo = u32::from(members[0].color[channel]);
        let hi = u32::from(members[members.len() - 1].color[channel]);
        let middle = ((lo + hi) / 2) as u8;
        let at = match members.iter().position(|b| b.color[channel] > middle) {
            // Unless everything is on one side of the middle, which happens
            // when the box is a tight cluster and one outlier: then halve
            // the pixels instead, so the split still separates something.
            Some(at) if at > 0 => at,
            _ => {
                let half = weight(&members) / 2;
                let mut carried = 0u64;
                members.iter().position(|b| {
                    carried += u64::from(b.count);
                    carried > half
                }).unwrap_or(0)
            }
        };
        let at = at.clamp(1, members.len() - 1);
        let rest = members.split_off(at);
        boxes.push(members);
        boxes.push(rest);
    }
    let mut colors: Vec<Bucket> = boxes.iter().map(|b| average(b)).collect();
    colors.sort_by(|a, b| b.count.cmp(&a.count).then(a.color.cmp(&b.color)));
    colors
}

/// Whether two colours are at least `apart` from each other, in plain RGB
/// distance. Squared on both sides, to keep the root out of the loop.
fn apart_enough(a: [u8; 3], b: [u8; 3], apart: f32) -> bool {
    let squared: f32 = (0..3)
        .map(|c| {
            let d = f32::from(a[c]) - f32::from(b[c]);
            d * d
        })
        .sum();
    squared >= apart * apart
}

/// The channel a box is widest across, and how wide that is.
fn spread_of(members: &[Bucket]) -> (usize, u8) {
    (0..3)
        .map(|c| {
            let lo = members.iter().map(|b| b.color[c]).min().unwrap_or(0);
            let hi = members.iter().map(|b| b.color[c]).max().unwrap_or(0);
            (c, hi - lo)
        })
        .max_by_key(|(_, width)| *width)
        .unwrap_or((0, 0))
}

/// How many of the picture's pixels a box holds.
fn weight(members: &[Bucket]) -> u64 {
    members.iter().map(|b| u64::from(b.count)).sum()
}

/// The box as one colour: the average of its pixels, not of its buckets, so
/// the shade most of the box actually is wins.
fn average(members: &[Bucket]) -> Bucket {
    let total = weight(members).max(1);
    let channel = |c: usize| {
        (members.iter().map(|b| u64::from(b.color[c]) * u64::from(b.count)).sum::<u64>() / total) as u8
    };
    Bucket { color: [channel(0), channel(1), channel(2)], count: total.min(u64::from(u32::MAX)) as u32 }
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
    fn a_palette_from_a_picture_is_its_colours_most_of_it_first() {
        let mut r = flat(10, 10, RED);
        r.fill_rect(Rect::new(0, 0, 10, 3), WHITE, &r.bounds());
        // A shade a hair off the red counts with it rather than as its own.
        r.fill_rect(Rect::new(0, 9, 10, 1), Rgba::opaque(252, 2, 2), &r.bounds());
        let p = Palette::from_image(&r, 8, 0.0);
        assert_eq!(p.colors().len(), 2, "two colours, not three: {:?}", p.colors());
        assert!(p.colors()[0].r > 240 && p.colors()[0].g < 10, "the red covers most of it");
        assert_eq!(p.colors()[1], WHITE);
        assert_eq!(Palette::from_image(&r, 0, 0.0).colors().len(), 0, "none asked for, none given");
    }

    #[test]
    fn a_picture_of_one_colour_s_shades_does_not_spend_the_palette_on_them() {
        // Most of the picture is near-identical blues; a corner of it is
        // red and another green. Counting the commonest colours would give
        // three blues and lose both of the others.
        let mut r = Raster::new(20, 20);
        let bounds = r.bounds();
        for y in 0..20 {
            for x in 0..20 {
                r.set(x, y, Rgba::opaque(20 + (x as u8 % 5), 40 + (y as u8 % 5), 200 + (x as u8 % 6)));
            }
        }
        r.fill_rect(Rect::new(0, 0, 3, 3), RED, &bounds);
        r.fill_rect(Rect::new(17, 17, 3, 3), Rgba::opaque(0, 255, 0), &bounds);

        let colors = Palette::from_image(&r, 3, 0.0).colors().to_vec();
        assert_eq!(colors.len(), 3, "{colors:?}");
        let has = |want: Rgba| colors.iter().any(|c| {
            let d = |a: u8, b: u8| i32::from(a) - i32::from(b);
            d(c.r, want.r).abs() < 40 && d(c.g, want.g).abs() < 40 && d(c.b, want.b).abs() < 40
        });
        assert!(has(Rgba::opaque(22, 42, 202)), "the blue the picture is mostly made of: {colors:?}");
        assert!(has(RED), "and the red corner: {colors:?}");
        assert!(has(Rgba::opaque(0, 255, 0)), "and the green one: {colors:?}");
        assert!(colors[0].b > 150, "the blue covers the most, so it comes first");
    }

    #[test]
    fn a_palette_from_a_picture_stops_where_it_is_asked_to() {
        let mut r = Raster::new(8, 8);
        for y in 0..8 {
            for x in 0..8 {
                r.set(x, y, Rgba::opaque((x * 32) as u8, (y * 32) as u8, 0));
            }
        }
        assert_eq!(Palette::from_image(&r, 4, 0.0).colors().len(), 4);
        assert!(Palette::from_image(&Raster::new(4, 4), 8, 0.0).is_empty(), "nothing opaque, nothing to count");
    }

    #[test]
    fn a_bias_towards_distinct_colours_keeps_the_near_shades_out() {
        // Most of the picture is four shades of blue, close enough that a
        // cut fine enough to reach the two corners keeps some of them.
        let mut r = Raster::new(20, 20);
        let bounds = r.bounds();
        for y in 0..20 {
            for x in 0..20 {
                r.set(x, y, Rgba::opaque(10 * (x as u8 / 5), 30 + 10 * (y as u8 / 5), 200));
            }
        }
        r.fill_rect(Rect::new(0, 0, 4, 4), RED, &bounds);
        r.fill_rect(Rect::new(16, 16, 4, 4), Rgba::opaque(0, 255, 0), &bounds);

        let near = |c: Rgba, want: Rgba| {
            let d = |a: u8, b: u8| (i32::from(a) - i32::from(b)).abs();
            d(c.r, want.r) < 50 && d(c.g, want.g) < 50 && d(c.b, want.b) < 50
        };
        let blues = |palette: &Palette| palette.colors().iter().filter(|c| c.b > 150 && c.r < 100).count();

        let loose = Palette::from_image(&r, 5, 0.0);
        assert!(blues(&loose) > 1, "the cut alone keeps shades of the blue: {:?}", loose.colors());

        let strict = Palette::from_image(&r, 5, 0.5);
        assert_eq!(blues(&strict), 1, "wound up, one blue stands for all of them: {:?}", strict.colors());
        assert!(strict.colors().iter().any(|c| near(*c, RED)), "{:?}", strict.colors());
        assert!(strict.colors().iter().any(|c| near(*c, Rgba::opaque(0, 255, 0))), "{:?}", strict.colors());

        // Wound all the way up, every answer is as far from the others as
        // the bias says, so a picture with nothing else to offer simply
        // gives fewer colours.
        let strictest = Palette::from_image(&r, 5, 1.0);
        assert!(!strictest.is_empty(), "there is always the one it started from");
        for (i, a) in strictest.colors().iter().enumerate() {
            for b in &strictest.colors()[i + 1..] {
                let d = |x: u8, y: u8| f32::from(x) - f32::from(y);
                let apart = (d(a.r, b.r).powi(2) + d(a.g, b.g).powi(2) + d(a.b, b.b).powi(2)).sqrt();
                assert!(apart >= MAX_SEPARATION, "{a} and {b} are only {apart} apart");
            }
        }
    }

    #[test]
    fn a_palette_holds_no_more_colours_than_it_may() {
        let many: Vec<Rgba> = (0..MAX_COLORS + 10).map(|i| Rgba::opaque(i as u8, 0, 0)).collect();
        assert_eq!(Palette::new(many).colors().len(), MAX_COLORS);
    }
}
