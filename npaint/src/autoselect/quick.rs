//! Quick select: brush over roughly what you want and the region grows out
//! to the edges around it.
//!
//! Each dab of the brush seeds a flood that spreads through pixels close in
//! colour to what the brush has covered so far, and stops where the image
//! changes sharply. Painting keeps adding to the same growing region, so a
//! stroke across a subject picks up the whole of it rather than restarting.
//!
//! The edge map and the source pixels are prepared once per gesture — both
//! cost a pass over the image, which is far too much to redo for every
//! pointer move.

use super::{distance, edges};
use crate::color::Rgba;
use crate::mask::Mask;
use crate::raster::Raster;

/// How far from the brush a single dab may spread, as a multiple of the
/// brush's own size. Without a leash a dab on a flat background swallows the
/// whole image and the gesture stops feeling like a brush.
const REACH: f64 = 6.0;

pub struct QuickSelect {
    width: u32,
    height: u32,
    source: Raster,
    edges: Vec<u8>,
    /// Everything the gesture has taken so far.
    mask: Mask,
    /// The running average colour of what the brush itself has covered: the
    /// description of "what the user is pointing at".
    sum: [u64; 4],
    samples: u64,
}

impl QuickSelect {
    pub fn new(source: &Raster) -> QuickSelect {
        QuickSelect {
            width: source.width(),
            height: source.height(),
            edges: edges(source),
            source: source.clone(),
            mask: Mask::new(source.width(), source.height()),
            sum: [0; 4],
            samples: 0,
        }
    }

    pub fn mask(&self) -> &Mask {
        &self.mask
    }

    fn mean(&self) -> Rgba {
        if self.samples == 0 {
            return Rgba::TRANSPARENT;
        }
        let c = |i: usize| (self.sum[i] / self.samples) as u8;
        Rgba::new(c(0), c(1), c(2), c(3))
    }

    fn edge_at(&self, x: i32, y: i32) -> u8 {
        self.edges[(y as usize) * (self.width as usize) + (x as usize)]
    }

    /// Adds everything around a dab of the brush at `centre`.
    ///
    /// `tolerance` is the options-bar value: how far a pixel's colour may be
    /// from what the brush has covered. Returns whether anything new was
    /// taken.
    pub fn dab(&mut self, centre: (f64, f64), diameter: u32, tolerance: u8) -> bool {
        let (w, h) = (self.width as i32, self.height as i32);
        let radius = (f64::from(diameter) / 2.0).max(0.5);
        let (cx, cy) = centre;

        // The pixels under the brush itself: seeds, and the description of
        // what is wanted.
        let mut stack = Vec::new();
        let before = self.mask.count();
        let x0 = (cx - radius).floor().max(0.0) as i32;
        let y0 = (cy - radius).floor().max(0.0) as i32;
        let x1 = (cx + radius).ceil().min(f64::from(w)) as i32;
        let y1 = (cy + radius).ceil().min(f64::from(h)) as i32;
        for y in y0..y1 {
            for x in x0..x1 {
                let (dx, dy) = (f64::from(x) + 0.5 - cx, f64::from(y) + 0.5 - cy);
                if dx.hypot(dy) > radius {
                    continue;
                }
                let p = self.source.get(x, y);
                self.sum[0] += u64::from(p.r);
                self.sum[1] += u64::from(p.g);
                self.sum[2] += u64::from(p.b);
                self.sum[3] += u64::from(p.a);
                self.samples += 1;
                if self.mask.cover(x, y) < 255 {
                    self.mask.set(x, y, 255);
                }
                stack.push((x, y));
            }
        }
        if stack.is_empty() {
            return false;
        }

        // Grow out from the dab. A pixel joins if it looks like what the
        // brush has covered and the step into it does not cross an edge.
        let wanted = self.mean();
        let reach = radius * REACH;
        let edge_limit = tolerance.max(24);
        while let Some((x, y)) = stack.pop() {
            for (nx, ny) in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)] {
                if nx < 0 || ny < 0 || nx >= w || ny >= h || self.mask.cover(nx, ny) == 255 {
                    continue;
                }
                if (f64::from(nx) + 0.5 - cx).hypot(f64::from(ny) + 0.5 - cy) > reach {
                    continue;
                }
                if self.edge_at(nx, ny) > edge_limit {
                    continue;
                }
                if distance(self.source.get(nx, ny), wanted) > tolerance {
                    continue;
                }
                self.mask.set(nx, ny, 255);
                stack.push((nx, ny));
            }
        }
        self.mask.recompute_bounds();
        self.mask.count() != before
    }

    /// The selection to keep when the gesture ends: the edges rounded off and
    /// softened, which is what stops a grown region from looking chewed.
    pub fn finish(&self) -> Mask {
        let mut out = self.mask.clone();
        out.smooth(1);
        out.antialias();
        out
    }

    pub fn size(&self) -> (u32, u32) {
        (self.width, self.height)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SKY: Rgba = Rgba::opaque(80, 140, 220);
    const SAND: Rgba = Rgba::opaque(220, 200, 150);

    /// Sky over sand, with a hard horizon halfway down.
    fn beach() -> Raster {
        let mut r = Raster::filled(40, 40, SKY);
        for y in 20..40 {
            for x in 0..40 {
                r.set(x, y, SAND);
            }
        }
        r
    }

    #[test]
    fn a_dab_grows_to_the_edge_and_stops() {
        let source = beach();
        let mut q = QuickSelect::new(&source);
        assert!(q.dab((20.0, 10.0), 6, 32));
        let m = q.mask();
        assert!(m.contains(20, 2), "up to the top of the sky");
        assert!(m.contains(5, 10), "and out sideways");
        assert!(!m.contains(20, 25), "but not across the horizon");
    }

    #[test]
    fn more_dabs_take_more_of_the_region() {
        let source = beach();
        let mut q = QuickSelect::new(&source);
        q.dab((6.0, 10.0), 4, 32);
        let after_one = q.mask().count();
        assert!(q.dab((34.0, 10.0), 4, 32), "a second dab further along adds to it");
        assert!(q.mask().count() > after_one);
    }

    #[test]
    fn a_dab_stays_within_reach_of_the_brush() {
        let source = Raster::filled(200, 200, SKY);
        let mut q = QuickSelect::new(&source);
        q.dab((100.0, 100.0), 4, 64);
        let m = q.mask();
        assert!(m.contains(100, 90));
        assert!(!m.contains(100, 10), "a flat image does not swallow the lot in one dab");
    }

    #[test]
    fn the_finished_selection_has_a_soft_edge() {
        let source = beach();
        let mut q = QuickSelect::new(&source);
        q.dab((20.0, 10.0), 6, 32);
        let finished = q.finish();
        assert_eq!(finished.cover(20, 5), 255);
        let edge = finished.cover(20, 20);
        assert!(edge < 255, "the horizon is where it fades out: {edge}");
    }

    #[test]
    fn a_dab_outside_the_image_does_nothing() {
        let source = beach();
        let mut q = QuickSelect::new(&source);
        assert!(!q.dab((-50.0, -50.0), 4, 32));
        assert!(q.mask().is_empty());
    }
}
