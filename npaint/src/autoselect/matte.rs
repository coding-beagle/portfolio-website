//! Turning a matte — a per-pixel "how much of the subject is here" map — into
//! a selection.
//!
//! Where the matte comes from is not this module's business. Today it is the
//! U²-Net the page can download and run, at whatever resolution the model
//! works in (320x320 for that one); tomorrow it could be another model, or
//! something drawn by hand. What is here is the part that would otherwise be
//! written twice: scaling it up to the document, deciding where the subject
//! stops, throwing away the stray blobs, and keeping the soft edge that makes
//! the difference between a cut-out and a sticker.

use super::subject::{fill_holes, largest_component, otsu};
use crate::mask::Mask;

/// How wide the fade around the threshold is, in matte levels. Wide enough
/// that hair and motion blur survive as partial coverage, narrow enough that
/// a confident matte still comes out crisp.
const SOFT_BAND: f32 = 48.0;

/// Builds a selection the size of the document from `matte`, which is
/// `matte_w` by `matte_h` single-channel coverage.
///
/// Returns an empty mask if the matte is the wrong size for its dimensions or
/// says nothing at all.
pub fn mask_from_matte(width: u32, height: u32, matte: &[u8], matte_w: u32, matte_h: u32) -> Mask {
    let (mw, mh) = (matte_w as usize, matte_h as usize);
    if mw == 0 || mh == 0 || matte.len() != mw * mh || width == 0 || height == 0 {
        return Mask::new(width, height);
    }

    // Where the subject stops, decided on the matte's own histogram rather
    // than a fixed value: models differ in how confident they are.
    let threshold = otsu(matte);
    let mut inside: Vec<bool> = matte.iter().map(|&v| v > threshold).collect();
    if !inside.iter().any(|&v| v) {
        return Mask::new(width, height);
    }
    inside = largest_component(&inside, mw, mh);
    fill_holes(&mut inside, mw, mh);

    // Up to full size. The hard decision is sampled; the soft edge comes from
    // the matte itself, sampled smoothly, so the two agree on where the
    // boundary is and disagree only about how sharp it is.
    let low = f32::from(threshold) - SOFT_BAND / 2.0;
    Mask::from_fn(width, height, |x, y| {
        let (u, v) = (
            (f64::from(x) + 0.5) * mw as f64 / f64::from(width) - 0.5,
            (f64::from(y) + 0.5) * mh as f64 / f64::from(height) - 0.5,
        );
        let keep = {
            let sx = (u.round() as i64).clamp(0, mw as i64 - 1) as usize;
            let sy = (v.round() as i64).clamp(0, mh as i64 - 1) as usize;
            inside[sy * mw + sx]
        };
        let near_edge = neighbours_differ(&inside, mw, mh, u, v, keep);
        if !keep && !near_edge {
            return 0;
        }
        let soft = ((bilinear(matte, mw, mh, u, v) - low) / SOFT_BAND).clamp(0.0, 1.0);
        if keep {
            // Inside, never less than the hard decision says at the middle:
            // a confident interior must not be eaten by a timid matte.
            (soft.max(0.5) * 255.0).round() as u8
        } else {
            (soft * 255.0).round() as u8
        }
    })
}

/// Whether the hard decision changes within a pixel's neighbourhood, which is
/// where the soft edge is allowed to spill outside it.
fn neighbours_differ(inside: &[bool], mw: usize, mh: usize, u: f64, v: f64, keep: bool) -> bool {
    let at = |x: i64, y: i64| {
        let x = x.clamp(0, mw as i64 - 1) as usize;
        let y = y.clamp(0, mh as i64 - 1) as usize;
        inside[y * mw + x]
    };
    let (x0, y0) = (u.floor() as i64, v.floor() as i64);
    [(x0, y0), (x0 + 1, y0), (x0, y0 + 1), (x0 + 1, y0 + 1)].iter().any(|&(x, y)| at(x, y) != keep)
}

/// The matte sampled between its pixels, so the edge does not come back as a
/// staircase of the model's resolution.
fn bilinear(matte: &[u8], mw: usize, mh: usize, u: f64, v: f64) -> f32 {
    let x0 = u.floor();
    let y0 = v.floor();
    let (fx, fy) = ((u - x0) as f32, (v - y0) as f32);
    let at = |x: f64, y: f64| {
        let x = (x as i64).clamp(0, mw as i64 - 1) as usize;
        let y = (y as i64).clamp(0, mh as i64 - 1) as usize;
        f32::from(matte[y * mw + x])
    };
    let top = at(x0, y0) * (1.0 - fx) + at(x0 + 1.0, y0) * fx;
    let bottom = at(x0, y0 + 1.0) * (1.0 - fx) + at(x0 + 1.0, y0 + 1.0) * fx;
    top * (1.0 - fy) + bottom * fy
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 16x16 matte with a solid 8x8 block in the middle.
    fn block_matte() -> Vec<u8> {
        let mut m = vec![0u8; 16 * 16];
        for y in 4..12 {
            for x in 4..12 {
                m[y * 16 + x] = 255;
            }
        }
        m
    }

    #[test]
    fn scales_the_matte_up_to_the_document() {
        let mask = mask_from_matte(64, 64, &block_matte(), 16, 16);
        assert!(mask.contains(32, 32), "the middle of the block");
        assert!(!mask.contains(4, 4), "and not the corner");
        // The block covers a quarter of the matte, so about a quarter of the
        // document. The matte is sampled at its pixel centres, so the half
        // way point of the edge lands half a matte pixel — two document
        // pixels here — outside the block: 32x32 at the least, 36x36 at the
        // most.
        let count = mask.count();
        assert!((32 * 32..=36 * 36).contains(&count), "{count}");
    }

    #[test]
    fn keeps_a_soft_edge_where_the_matte_is_soft() {
        let mut matte = vec![0u8; 16 * 16];
        for y in 4..12 {
            for x in 4..12 {
                // A ramp along the left edge of the block: a blurry boundary.
                matte[y * 16 + x] = if x == 4 { 90 } else if x == 5 { 170 } else { 255 };
            }
        }
        let mask = mask_from_matte(16, 16, &matte, 16, 16);
        assert_eq!(mask.cover(8, 8), 255, "well inside is solid");
        let edge = mask.cover(4, 8);
        assert!(edge > 0 && edge < 255, "the ramp survives as partial coverage: {edge}");
    }

    #[test]
    fn throws_away_a_stray_blob_and_fills_a_hole() {
        let mut matte = block_matte();
        matte[1] = 255; // a speck in the corner
        matte[8 * 16 + 8] = 0; // and a hole in the middle
        let mask = mask_from_matte(16, 16, &matte, 16, 16);
        assert!(!mask.contains(1, 0), "the speck is not the subject");
        assert!(mask.contains(8, 8), "and the hole is filled in");
    }

    #[test]
    fn an_empty_or_malformed_matte_selects_nothing() {
        assert!(mask_from_matte(32, 32, &[0u8; 256], 16, 16).is_empty());
        assert!(mask_from_matte(32, 32, &[255u8; 10], 16, 16).is_empty(), "wrong length");
        assert!(mask_from_matte(32, 32, &[], 0, 0).is_empty());
    }
}
