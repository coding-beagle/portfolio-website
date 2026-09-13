//! The automatic selections: the ones that look at the pixels and work out
//! what the user meant, rather than being drawn by hand.
//!
//! Each of these takes a [`Raster`] to read — the active layer, or the
//! flattened image when the user asks it to sample every layer — and gives
//! back a [`Mask`]. None of them touch the document, the history or the
//! viewport: they are pure functions of the pixels, which is what makes them
//! testable against small hand-built images.

pub mod matte;
pub mod quick;
pub mod subject;
pub mod wand;

pub use matte::mask_from_matte;
pub use quick::QuickSelect;
pub use subject::select_subject;
pub use wand::{wand, SampleMode};

use crate::color::Rgba;
use crate::raster::Raster;

/// How far apart two colours are, `0..=255`: the largest difference across
/// the channels, alpha included. The largest rather than the average, so a
/// pixel that differs in one channel alone is still a different colour —
/// which is what a tolerance is asked to mean.
pub fn distance(a: Rgba, b: Rgba) -> u8 {
    let d = |x: u8, y: u8| x.abs_diff(y);
    d(a.r, b.r).max(d(a.g, b.g)).max(d(a.b, b.b)).max(d(a.a, b.a))
}

/// How strongly the image changes at a pixel: the Sobel gradient magnitude,
/// capped at 255. Edges are where the automatic tools should stop.
pub fn edges(source: &Raster) -> Vec<u8> {
    let (w, h) = (source.width() as i32, source.height() as i32);
    let luma = |x: i32, y: i32| {
        let p = source.get(x.clamp(0, w - 1), y.clamp(0, h - 1));
        // Alpha counts: the edge of a cut-out is an edge.
        let l = 0.299 * f32::from(p.r) + 0.587 * f32::from(p.g) + 0.114 * f32::from(p.b);
        l * (f32::from(p.a) / 255.0)
    };
    let mut out = vec![0u8; (w * h).max(0) as usize];
    for y in 0..h {
        for x in 0..w {
            let gx = luma(x + 1, y - 1) + 2.0 * luma(x + 1, y) + luma(x + 1, y + 1)
                - luma(x - 1, y - 1)
                - 2.0 * luma(x - 1, y)
                - luma(x - 1, y + 1);
            let gy = luma(x - 1, y + 1) + 2.0 * luma(x, y + 1) + luma(x + 1, y + 1)
                - luma(x - 1, y - 1)
                - 2.0 * luma(x, y - 1)
                - luma(x + 1, y - 1);
            out[(y * w + x) as usize] = (gx.hypot(gy) / 4.0).min(255.0) as u8;
        }
    }
    out
}

/// The set of colours a selection contains, coarse enough to be cheap to
/// test against: a 16-per-channel grid of "was something like this in
/// there?". What Select Similar compares every pixel with.
#[derive(Debug, Default)]
pub struct ColorSet {
    levels: Vec<bool>,
}

const SET_LEVELS: usize = 16;

impl ColorSet {
    pub fn new() -> ColorSet {
        ColorSet { levels: vec![false; SET_LEVELS * SET_LEVELS * SET_LEVELS] }
    }

    fn bin(c: Rgba) -> usize {
        let q = |v: u8| (usize::from(v) * SET_LEVELS / 256).min(SET_LEVELS - 1);
        (q(c.r) * SET_LEVELS + q(c.g)) * SET_LEVELS + q(c.b)
    }

    pub fn add(&mut self, c: Rgba) {
        self.levels[Self::bin(c)] = true;
    }

    /// Whether `c` is within `tolerance` of any colour in the set. The grid
    /// is walked out by however many bins the tolerance covers, so a wide
    /// tolerance costs a wider walk rather than a pass over every colour.
    pub fn holds(&self, c: Rgba, tolerance: u8) -> bool {
        let step = (256 / SET_LEVELS) as i32;
        let reach = (i32::from(tolerance) + step - 1) / step;
        let q = |v: u8| (i32::from(v) * SET_LEVELS as i32 / 256).min(SET_LEVELS as i32 - 1);
        let (r, g, b) = (q(c.r), q(c.g), q(c.b));
        for dr in -reach..=reach {
            for dg in -reach..=reach {
                for db in -reach..=reach {
                    let (rr, gg, bb) = (r + dr, g + dg, b + db);
                    if rr < 0 || gg < 0 || bb < 0 {
                        continue;
                    }
                    let (rr, gg, bb) = (rr as usize, gg as usize, bb as usize);
                    if rr >= SET_LEVELS || gg >= SET_LEVELS || bb >= SET_LEVELS {
                        continue;
                    }
                    if self.levels[(rr * SET_LEVELS + gg) * SET_LEVELS + bb] {
                        return true;
                    }
                }
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distance_is_the_widest_channel_apart() {
        assert_eq!(distance(Rgba::BLACK, Rgba::WHITE), 255);
        assert_eq!(distance(Rgba::opaque(10, 10, 10), Rgba::opaque(10, 40, 12)), 30);
        assert_eq!(distance(Rgba::WHITE, Rgba::WHITE), 0);
        assert_eq!(distance(Rgba::WHITE, Rgba::WHITE.with_alpha(0)), 255, "alpha counts");
    }

    #[test]
    fn a_colour_set_holds_what_was_put_in_it_and_its_neighbours() {
        let mut set = ColorSet::new();
        set.add(Rgba::opaque(200, 40, 40));
        assert!(set.holds(Rgba::opaque(200, 40, 40), 0));
        assert!(!set.holds(Rgba::opaque(40, 200, 40), 0));
        assert!(set.holds(Rgba::opaque(214, 52, 30), 32), "near enough, with room to spare");
        assert!(!set.holds(Rgba::opaque(40, 200, 40), 32));
    }

    #[test]
    fn edges_light_up_at_a_boundary_and_nowhere_else() {
        let mut r = Raster::filled(9, 9, Rgba::WHITE);
        for y in 0..9 {
            for x in 0..4 {
                r.set(x, y, Rgba::BLACK);
            }
        }
        let e = edges(&r);
        let at = |x: i32, y: i32| e[(y * 9 + x) as usize];
        assert!(at(3, 4) > 100 && at(4, 4) > 100, "the boundary");
        assert_eq!(at(1, 4), 0, "flat black");
        assert_eq!(at(7, 4), 0, "flat white");
    }
}
