//! The magic wand: select the pixels that look like the one clicked.

use super::distance;
use crate::mask::Mask;
use crate::raster::Raster;

/// Which pixels the wand is allowed to take.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum SampleMode {
    /// Only the patch joined to the click — Photoshop's "Contiguous".
    #[default]
    Contiguous,
    /// Every pixel in the image that matches, wherever it is.
    Global,
}

impl SampleMode {
    pub fn name(self) -> &'static str {
        match self {
            SampleMode::Contiguous => "contiguous",
            SampleMode::Global => "global",
        }
    }

    pub fn from_name(name: &str) -> Option<SampleMode> {
        match name {
            "contiguous" => Some(SampleMode::Contiguous),
            "global" => Some(SampleMode::Global),
            _ => None,
        }
    }
}

/// Selects the pixels within `tolerance` of the one at `seed`.
///
/// `soften` gives the result a one-pixel soft edge, which is what keeps a
/// wand selection from looking like a staircase when it is filled or cut.
pub fn wand(source: &Raster, seed: (i32, i32), tolerance: u8, mode: SampleMode, soften: bool) -> Mask {
    let (w, h) = (source.width(), source.height());
    let mut mask = Mask::new(w, h);
    if !source.bounds().contains(seed.0, seed.1) {
        return mask;
    }
    let target = source.get(seed.0, seed.1);
    let matches = |x: i32, y: i32| distance(source.get(x, y), target) <= tolerance;

    match mode {
        SampleMode::Global => {
            for y in 0..h as i32 {
                for x in 0..w as i32 {
                    if matches(x, y) {
                        mask.set(x, y, 255);
                    }
                }
            }
        }
        SampleMode::Contiguous => {
            // A four-way flood from the click. Explicit stack rather than
            // recursion: a big flat image would blow the wasm stack.
            let mut stack = vec![seed];
            mask.set(seed.0, seed.1, 255);
            while let Some((x, y)) = stack.pop() {
                for (nx, ny) in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)] {
                    if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                        continue;
                    }
                    if mask.cover(nx, ny) > 0 || !matches(nx, ny) {
                        continue;
                    }
                    mask.set(nx, ny, 255);
                    stack.push((nx, ny));
                }
            }
        }
    }
    mask.recompute_bounds();
    if soften {
        mask.antialias();
    }
    mask
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::Rgba;

    const RED: Rgba = Rgba::opaque(255, 0, 0);
    const NEARLY_RED: Rgba = Rgba::opaque(245, 8, 0);

    /// Two red squares on white, one in each of two opposite corners.
    fn spotted() -> Raster {
        let mut r = Raster::filled(10, 10, Rgba::WHITE);
        for y in 0..3 {
            for x in 0..3 {
                r.set(x, y, RED);
                r.set(x + 7, y + 7, NEARLY_RED);
            }
        }
        r
    }

    #[test]
    fn takes_the_patch_under_the_click() {
        let m = wand(&spotted(), (1, 1), 0, SampleMode::Contiguous, false);
        assert_eq!(m.bounds(), crate::geometry::Rect::new(0, 0, 3, 3));
        assert_eq!(m.count(), 9);
    }

    #[test]
    fn tolerance_decides_what_counts_as_the_same_colour() {
        let source = spotted();
        let tight = wand(&source, (1, 1), 0, SampleMode::Global, false);
        assert_eq!(tight.count(), 9, "only the exact red");
        let loose = wand(&source, (1, 1), 12, SampleMode::Global, false);
        assert_eq!(loose.count(), 18, "both reds, near enough");
    }

    #[test]
    fn contiguous_leaves_the_far_patch_alone() {
        let m = wand(&spotted(), (1, 1), 12, SampleMode::Contiguous, false);
        assert!(m.contains(2, 2));
        assert!(!m.contains(8, 8), "not joined to the click");
    }

    #[test]
    fn the_background_is_one_patch_around_the_spots() {
        let m = wand(&spotted(), (5, 5), 0, SampleMode::Contiguous, false);
        assert!(m.contains(5, 0) && m.contains(0, 9));
        assert!(!m.contains(1, 1));
        assert_eq!(m.count(), 100 - 18);
    }

    #[test]
    fn a_click_outside_the_image_selects_nothing() {
        assert!(wand(&spotted(), (-1, 4), 255, SampleMode::Contiguous, false).is_empty());
    }

    #[test]
    fn softening_gives_the_edge_partial_coverage() {
        let m = wand(&spotted(), (1, 1), 0, SampleMode::Contiguous, true);
        assert_eq!(m.cover(0, 0), 255, "well inside");
        let edge = m.cover(3, 1);
        assert!(edge > 0 && edge < 255, "just outside the edge: {edge}");
    }
}
