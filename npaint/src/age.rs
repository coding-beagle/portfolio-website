//! The Age filter: a picture as the years would leave it.
//!
//! One slider is time. As it winds forward the tones fade towards the middle
//! and the blacks lift, the colour drains, the paper yellows and the edges
//! brown and darken; foxing — the rust-coloured spots damp storage puts on
//! old paper — comes out in blotches, and dust and scratches gather. Two more
//! sliders say how much of the last two the years bring, so a clean fade and
//! a mistreated print are both on offer.
//!
//! Everything is a function of the pixel's own colour, where it is, and the
//! size of the picture, keyed by [`crate::dither::hash`] as the noise filter
//! is. That is what makes it an adjustment like any other: the same pixel
//! comes out the same whatever rectangle it is asked for, so the preview
//! through a selection and the commit agree, and an adjustment layer of it
//! sits still while the layers under it are painted. The spots and
//! scratches are worked out once per call from the picture's size and then
//! looked up, since a spot decided pixel by pixel would cost every pixel a
//! search of its neighbourhood.

use crate::adjust::luminance;
use crate::color::Rgba;
use crate::dither::hash;
use crate::geometry::Rect;
use crate::raster::Raster;

/// How many years the slider runs to. Everything scales from `years` over
/// this, so it is also where every effect is at its fullest.
pub const MAX_YEARS: f32 = 200.0;

/// What the paper has gone: an old print's whites.
const PAPER: [f32; 3] = [232.0, 206.0, 154.0];
/// The brown the edges darken towards.
const EDGE: [f32; 3] = [88.0, 58.0, 28.0];
/// Foxing's rust.
const RUST: [f32; 3] = [152.0, 88.0, 34.0];
/// A speck of dirt, and a fleck where the emulsion has gone.
const DIRT: [f32; 3] = [42.0, 32.0, 22.0];
const FLECK: [f32; 3] = [246.0, 240.0, 226.0];
/// What a scratch shows: the pale base under the image.
const SCRATCH: [f32; 3] = [240.0, 234.0, 220.0];

/// How much of the way to mid-grey the tones fade at full age.
const FADE: f32 = 0.5;
/// How far the black point lifts at full age, as a fraction of the range.
const LIFT: f32 = 0.16;
/// How much colour goes at full age.
const DRAIN: f32 = 0.65;
/// How far the paper has yellowed at full age.
const YELLOW: f32 = 0.75;
/// How much of the picture's shorter side the edge darkening reaches in
/// over, and how strong it is at full age.
const EDGE_REACH: f32 = 0.22;
const EDGE_DARKEN: f32 = 0.55;
/// The grain the years add, in levels at full age.
const GRAIN: f32 = 7.0;

/// Foxing is decided per cell of this many pixels: at most one spot each.
const FOX_CELL: i32 = 28;
/// The share of cells that carry a spot at full foxing and full age.
const FOX_DENSITY: f32 = 0.4;
/// A spot's radius, in pixels: this much, plus up to this much again —
/// squared, so most spots are small and a few are blotches.
const FOX_RADIUS: f32 = 2.5;
const FOX_RADIUS_SPREAD: f32 = 16.0;
/// How far a spot's rim wanders in and out, as a share of its radius, and
/// the size of the grain that decides where.
const FOX_RAGGED: f32 = 0.45;
const FOX_RAGGED_CELL: i32 = 5;
/// How solid a spot is at its heart.
const FOX_STRENGTH: f32 = 0.72;

/// The share of pixels that carry a speck of dirt, and a fleck, at full
/// wear and full age.
const DIRT_DENSITY: f32 = 0.02;
const FLECK_DENSITY: f32 = 0.012;
/// Scratches at full wear and full age; they arrive with the years.
const MAX_SCRATCHES: usize = 22;
/// How far off vertical a scratch may lean: `dx` per pixel of `dy`.
const SCRATCH_LEAN: f32 = 0.35;
/// A scratch's length as a share of the picture's height, and its width in
/// pixels from the centre line to nothing.
const SCRATCH_LENGTH: f32 = 0.12;
const SCRATCH_LENGTH_SPREAD: f32 = 0.45;
const SCRATCH_HALF_WIDTH: f32 = 0.9;
const SCRATCH_STRENGTH: f32 = 0.6;

/// Where hash channels start for each of the things decided at random, so
/// none of them read each other's dice.
const CH_FOX: u32 = 100;
const CH_DIRT: u32 = 200;
const CH_FLECK: u32 = 201;
const CH_GRAIN: u32 = 202;
const CH_EDGE: u32 = 203;
const CH_SCRATCH: u32 = 300;

/// A foxing spot: where it is, how big, and how strong.
#[derive(Clone, Copy, Debug)]
struct Spot {
    cx: f32,
    cy: f32,
    radius: f32,
    strength: f32,
}

/// A scratch: a thin, nearly vertical line from `(x0, y0)` down `length`
/// pixels, leaning `lean` pixels sideways per pixel down.
#[derive(Clone, Copy, Debug)]
struct Scratch {
    x0: f32,
    y0: f32,
    lean: f32,
    length: f32,
    bounds: Rect,
}

impl Scratch {
    /// How far a pixel centre is from the scratch's centre line, or `None`
    /// when it is nowhere near.
    fn distance(&self, x: i32, y: i32) -> Option<f32> {
        if !self.bounds.contains(x, y) {
            return None;
        }
        let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
        let t = ((py - self.y0) / self.length).clamp(0.0, 1.0);
        let (lx, ly) = (
            self.x0 + self.lean * self.length * t,
            self.y0 + self.length * t,
        );
        Some((px - lx).hypot(py - ly))
    }
}

/// The spots and scratches a picture of this size carries, at these
/// settings — the part of the filter that is worked out once.
struct Blemishes {
    spots: Vec<Option<Spot>>,
    cells_across: i32,
    cells_down: i32,
    scratches: Vec<Scratch>,
}

impl Blemishes {
    fn new(whole: &Rect, age: f32, foxing: f32, wear: f32) -> Blemishes {
        let cells_across = whole.w / FOX_CELL + 1;
        let cells_down = whole.h / FOX_CELL + 1;
        let density = FOX_DENSITY * foxing * (0.3 + 0.7 * age);
        let mut spots = Vec::with_capacity((cells_across * cells_down) as usize);
        for cy in 0..cells_down {
            for cx in 0..cells_across {
                let roll = hash(cx, cy, CH_FOX);
                spots.push((roll < density).then(|| Spot {
                    cx: (cx * FOX_CELL) as f32 + hash(cx, cy, CH_FOX + 1) * FOX_CELL as f32,
                    cy: (cy * FOX_CELL) as f32 + hash(cx, cy, CH_FOX + 2) * FOX_CELL as f32,
                    radius: FOX_RADIUS
                        + hash(cx, cy, CH_FOX + 3).powi(2) * FOX_RADIUS_SPREAD * (0.4 + 0.6 * age),
                    strength: FOX_STRENGTH
                        * (0.5 + 0.5 * hash(cx, cy, CH_FOX + 4))
                        * (0.4 + 0.6 * age),
                }));
            }
        }
        let count = (MAX_SCRATCHES as f32 * wear * age).round() as usize;
        let scratches = (0..count)
            .map(|i| {
                let i = i as i32;
                let roll = |c: u32| hash(i, 0, CH_SCRATCH + c);
                let length = (SCRATCH_LENGTH + roll(3) * SCRATCH_LENGTH_SPREAD) * whole.h as f32;
                let lean = (roll(2) - 0.5) * 2.0 * SCRATCH_LEAN;
                let x0 = whole.x as f32 + roll(0) * whole.w as f32;
                let y0 = whole.y as f32 + roll(1) * (whole.h as f32 - length).max(0.0);
                let x1 = x0 + lean * length;
                let pad = SCRATCH_HALF_WIDTH.ceil() as i32 + 1;
                let bounds = Rect::from_corners(
                    (x0.min(x1).floor() as i32 - pad, y0.floor() as i32 - pad),
                    (
                        x0.max(x1).ceil() as i32 + pad,
                        (y0 + length).ceil() as i32 + pad,
                    ),
                );
                Scratch {
                    x0,
                    y0,
                    lean,
                    length,
                    bounds,
                }
            })
            .collect();
        Blemishes {
            spots,
            cells_across,
            cells_down,
            scratches,
        }
    }

    /// How strongly foxing marks a pixel, `0..=1`: the nearest spots'
    /// falloff, roughened so the blotches are not discs.
    fn foxing_at(&self, x: i32, y: i32) -> f32 {
        let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
        let (cx, cy) = (x / FOX_CELL, y / FOX_CELL);
        let mut mark = 0.0f32;
        for dy in -1..=1 {
            for dx in -1..=1 {
                let (sx, sy) = (cx + dx, cy + dy);
                if sx < 0 || sy < 0 || sx >= self.cells_across || sy >= self.cells_down {
                    continue;
                }
                let Some(spot) = self.spots[(sy * self.cells_across + sx) as usize] else {
                    continue;
                };
                // The rim wanders in and out by a slow grain that belongs
                // to the pixel, so a spot is a blotch and not a disc, and
                // spots that overlap share one outline.
                let rim =
                    1.0 + (value_noise(x, y, FOX_RAGGED_CELL, CH_FOX + 5) - 0.5) * 2.0 * FOX_RAGGED;
                let d = (px - spot.cx).hypot(py - spot.cy) / (spot.radius * rim);
                if d >= 1.0 {
                    continue;
                }
                // Foxing is darkest at its edge, where the damp stopped.
                let falloff = (1.0 - d * d) * (0.55 + 0.45 * d);
                mark = mark.max(falloff * spot.strength * (0.8 + 0.2 * hash(x, y, CH_FOX + 6)));
            }
        }
        mark
    }

    /// How strongly a scratch shows at a pixel, `0..=1`.
    fn scratch_at(&self, x: i32, y: i32) -> f32 {
        let mut mark = 0.0f32;
        for s in &self.scratches {
            if let Some(d) = s.distance(x, y) {
                if d < SCRATCH_HALF_WIDTH {
                    mark = mark.max((1.0 - d / SCRATCH_HALF_WIDTH) * SCRATCH_STRENGTH);
                }
            }
        }
        mark
    }
}

/// Ages the clip by `years` (`0..=MAX_YEARS`), with `foxing` and `wear` in
/// `0..=100` saying how much of the spotting and the dust and scratches the
/// years bring.
pub fn age(raster: &mut Raster, clip: &Rect, years: f32, foxing: f32, wear: f32) {
    let age = (years / MAX_YEARS).clamp(0.0, 1.0);
    if age <= 0.0 {
        return;
    }
    let foxing = (foxing / 100.0).clamp(0.0, 1.0);
    let wear = (wear / 100.0).clamp(0.0, 1.0);
    let whole = raster.bounds();
    let target = clip.intersect(&whole);
    if target.is_empty() {
        return;
    }
    let blemishes = Blemishes::new(&whole, age, foxing, wear);
    let edge_reach = (whole.w.min(whole.h) as f32 * EDGE_REACH).max(1.0);
    let fade = FADE * age;
    let lift = LIFT * age;
    let drain = DRAIN * age;
    let yellow = YELLOW * age;
    let edge_darken = EDGE_DARKEN * age;
    let grain = GRAIN * age;
    let dirt_density = DIRT_DENSITY * wear * age;
    let fleck_density = FLECK_DENSITY * wear * age;

    raster.map_at(&target, |p, x, y| {
        // Nothing there to age.
        if p.a == 0 {
            return p;
        }
        let mut c = [f32::from(p.r), f32::from(p.g), f32::from(p.b)];

        // The tones go: towards the middle, and the blacks up off the floor.
        let grey = f32::from(luminance(p));
        for v in &mut c {
            *v += (128.0 - *v) * fade;
            *v = *v * (1.0 - lift) + 255.0 * lift;
        }
        let faded_grey = grey + (128.0 - grey) * fade;
        let faded_grey = faded_grey * (1.0 - lift) + 255.0 * lift;
        // The colour drains, then what is left takes the paper's cast: a
        // multiply, so the whites go the paper's colour and the darks stay
        // dark rather than everything going flat orange.
        for (v, paper) in c.iter_mut().zip(PAPER) {
            *v += (faded_grey - *v) * drain;
            let yellowed = *v * paper / 255.0;
            *v += (yellowed - *v) * yellow;
        }

        // The edges brown, in by `edge_reach`, with a ragged line to them.
        let to_edge = (x - whole.x)
            .min(whole.right() - 1 - x)
            .min(y - whole.y)
            .min(whole.bottom() - 1 - y) as f32;
        let ragged = 0.7 + 0.6 * value_noise(x, y, 24, CH_EDGE);
        let edge = (1.0 - to_edge / (edge_reach * ragged)).clamp(0.0, 1.0);
        let edge = edge * edge * edge_darken;
        mix(&mut c, EDGE, edge);

        // Foxing sits on top of the paper, whatever was printed there.
        let fox = blemishes.foxing_at(x, y);
        if fox > 0.0 {
            mix(&mut c, RUST, fox);
        }

        // Dust, flecks and scratches.
        if hash(x, y, CH_DIRT) < dirt_density {
            mix(&mut c, DIRT, 0.7);
        } else if hash(x, y, CH_FLECK) < fleck_density {
            mix(&mut c, FLECK, 0.8);
        }
        let scratch = blemishes.scratch_at(x, y);
        if scratch > 0.0 {
            mix(&mut c, SCRATCH, scratch);
        }

        // And the grain of a print that has sat in the light.
        let g = (hash(x, y, CH_GRAIN) - 0.5) * 2.0 * grain;
        for v in &mut c {
            *v += g;
        }

        Rgba::new(level(c[0]), level(c[1]), level(c[2]), p.a)
    });
}

/// Moves `c` towards `to` by `t`.
fn mix(c: &mut [f32; 3], to: [f32; 3], t: f32) {
    let t = t.clamp(0.0, 1.0);
    for (v, target) in c.iter_mut().zip(to) {
        *v += (target - *v) * t;
    }
}

/// A channel back in the `0..=255` a picture is kept in.
fn level(v: f32) -> u8 {
    v.round().clamp(0.0, 255.0) as u8
}

/// Smooth noise in `0..1`: the hash at the corners of a `cell`-pixel grid,
/// blended across each cell, so it varies slowly rather than per pixel.
fn value_noise(x: i32, y: i32, cell: i32, channel: u32) -> f32 {
    let (gx, gy) = (x.div_euclid(cell), y.div_euclid(cell));
    let (fx, fy) = (
        x.rem_euclid(cell) as f32 / cell as f32,
        y.rem_euclid(cell) as f32 / cell as f32,
    );
    let smooth = |t: f32| t * t * (3.0 - 2.0 * t);
    let (sx, sy) = (smooth(fx), smooth(fy));
    let top = hash(gx, gy, channel) + (hash(gx + 1, gy, channel) - hash(gx, gy, channel)) * sx;
    let bottom = hash(gx, gy + 1, channel)
        + (hash(gx + 1, gy + 1, channel) - hash(gx, gy + 1, channel)) * sx;
    top + (bottom - top) * sy
}

#[cfg(test)]
mod tests {
    use super::*;

    const GREY: Rgba = Rgba::opaque(128, 128, 128);

    /// A picture with a clean middle, so tests can read it without the edge
    /// darkening in the way.
    fn print() -> Raster {
        Raster::filled(120, 120, Rgba::opaque(40, 90, 200))
    }

    #[test]
    fn no_years_is_no_change() {
        let before = print();
        let mut after = before.clone();
        let all = after.bounds();
        age(&mut after, &all, 0.0, 100.0, 100.0);
        assert_eq!(before.pixels(), after.pixels());
    }

    #[test]
    fn the_years_fade_drain_and_yellow_the_middle() {
        let mut r = print();
        let all = r.bounds();
        age(&mut r, &all, 120.0, 0.0, 0.0);
        let p = r.get(60, 60);
        // Less blue and more red than a bright blue started with: the
        // colour has drained and the paper's cast has taken over.
        assert!(p.b < 200, "{p}");
        assert!(p.r > 40, "{p}");
        // And the contrast has gone: a black print greys.
        let mut dark = Raster::filled(120, 120, Rgba::BLACK);
        age(&mut dark, &all, 200.0, 0.0, 0.0);
        assert!(dark.get(60, 60).r > 20, "{}", dark.get(60, 60));
    }

    #[test]
    fn the_edges_go_darker_than_the_middle() {
        let mut r = Raster::filled(120, 120, Rgba::WHITE);
        let all = r.bounds();
        age(&mut r, &all, 150.0, 0.0, 0.0);
        let middle = luminance(r.get(60, 60));
        let corner = luminance(r.get(1, 1));
        assert!(corner < middle, "corner {corner} middle {middle}");
    }

    #[test]
    fn foxing_puts_rust_on_the_paper_and_wear_marks_it() {
        let clean = {
            let mut r = Raster::filled(200, 200, Rgba::WHITE);
            let all = r.bounds();
            age(&mut r, &all, 200.0, 0.0, 0.0);
            r
        };
        let foxed = {
            let mut r = Raster::filled(200, 200, Rgba::WHITE);
            let all = r.bounds();
            age(&mut r, &all, 200.0, 100.0, 0.0);
            r
        };
        let worn = {
            let mut r = Raster::filled(200, 200, Rgba::WHITE);
            let all = r.bounds();
            age(&mut r, &all, 200.0, 0.0, 100.0);
            r
        };
        let differs = |a: &Raster, b: &Raster| {
            a.pixels()
                .iter()
                .zip(b.pixels())
                .filter(|(p, q)| p != q)
                .count()
        };
        let spotted = differs(&clean, &foxed);
        assert!(spotted > 500, "foxing marked only {spotted} pixels");
        assert!(
            spotted < 200 * 200 / 2,
            "foxing covered the picture: {spotted}"
        );
        let marked = differs(&clean, &worn);
        assert!(marked > 200, "wear marked only {marked} pixels");
        // Somewhere a spot is redder than the paper around it.
        let reddest = foxed
            .pixels()
            .iter()
            .map(|p| i32::from(p.r) - i32::from(p.b))
            .max()
            .unwrap();
        let paper = i32::from(clean.get(100, 100).r) - i32::from(clean.get(100, 100).b);
        assert!(reddest > paper + 10, "no rust: {reddest} vs {paper}");
    }

    #[test]
    fn the_answer_does_not_depend_on_the_clip() {
        let source = print();
        let all = source.bounds();
        let mut whole = source.clone();
        age(&mut whole, &all, 140.0, 80.0, 80.0);
        let mut pieces = source.clone();
        for y in (0..120).step_by(37) {
            for x in (0..120).step_by(41) {
                age(&mut pieces, &Rect::new(x, y, 41, 37), 140.0, 80.0, 80.0);
            }
        }
        assert_eq!(whole.pixels(), pieces.pixels());
    }

    #[test]
    fn alpha_is_kept_and_empty_pixels_are_left_alone() {
        let mut r = Raster::new(40, 40);
        let all = r.bounds();
        r.fill_rect(Rect::new(10, 10, 20, 20), GREY.with_alpha(90), &all);
        age(&mut r, &all, 200.0, 100.0, 100.0);
        assert_eq!(r.get(20, 20).a, 90);
        assert_eq!(r.get(2, 2), Rgba::TRANSPARENT);
    }

    #[test]
    fn value_noise_is_smooth_and_in_range() {
        for x in 0..64 {
            let a = value_noise(x, 5, 16, 7);
            let b = value_noise(x + 1, 5, 16, 7);
            assert!((0.0..=1.0).contains(&a));
            assert!((a - b).abs() < 0.25, "jumped from {a} to {b} at {x}");
        }
    }
}
