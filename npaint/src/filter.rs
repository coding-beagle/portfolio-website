//! The filters that read more than one pixel: blur, and the two built on it.
//!
//! Everything in [`crate::adjust`] but the dither is a function of one
//! colour. These are not — what is *around* a pixel decides what it becomes —
//! so they live here and [`crate::adjust::Kind`] delegates to them through
//! its `apply` rather than through a lookup table. Doing it that way means
//! they get the dialog, the live preview, the undo step, the selection and
//! their life as an adjustment layer without any of it knowing they are
//! different.
//!
//! **Two rules they have to keep.**
//!
//! *The answer may not depend on the clip.* A preview through a selection
//! composites a rectangle at a time, so a pixel must come out the same
//! whatever rectangle it was asked for. A blur therefore reads from a
//! working copy of everything within its reach of the clip — not just the
//! clip — and the noise is keyed to the pixel's document position rather
//! than drawn from a running generator. (Noise that was drawn afresh each
//! time would also *crawl*: an adjustment layer recomposites on every brush
//! dab underneath it, and the grain would boil.)
//!
//! *Alpha is the exception here.* Every other adjustment leaves alpha alone.
//! A blur cannot: softening an edge against transparency is most of what it
//! is for, and blurring the colours while pinning the alpha drags whatever
//! is stored under the transparent pixels into view as a halo. So the blur
//! works on premultiplied colour, alpha and all. Sharpen and noise keep
//! alpha as they found it.

use crate::color::Rgba;
use crate::dither::hash;
use crate::geometry::Rect;
use crate::raster::Raster;

/// The widest a blur may be, in pixels. A blur reads three times its radius
/// out from every pixel it writes, so this is also what bounds the work.
pub const MAX_BLUR_RADIUS: f32 = 50.0;
/// How many box passes make the Gaussian. Three is the usual answer, and the
/// one [`crate::mask::Mask::feather`] already uses.
const PASSES: i32 = 3;

/// Softens the clip with a Gaussian-ish blur of `radius` pixels.
///
/// Three box passes stand in for the Gaussian, as they do for a feathered
/// mask: each is a running average, so the cost is the area and not the
/// area times the radius.
pub fn blur(raster: &mut Raster, clip: &Rect, radius: f32) {
    let r = radius.round().clamp(0.0, MAX_BLUR_RADIUS) as i32;
    if r < 1 {
        return;
    }
    // Everything within the passes' combined reach of the clip has a say in
    // what the clip becomes, so that much is read in. Clamping at the edge
    // of *that* only ever touches pixels outside the clip, which are thrown
    // away — which is what makes the answer the same whatever the clip is.
    let area = clip.inflate(PASSES * r).intersect(&raster.bounds());
    let target = clip.intersect(&raster.bounds());
    if area.is_empty() || target.is_empty() {
        return;
    }
    let (w, h) = (area.w as usize, area.h as usize);
    let mut buf = vec![[0f32; 4]; w * h];
    for y in 0..h {
        for x in 0..w {
            let p = raster.get(area.x + x as i32, area.y + y as i32);
            let a = f32::from(p.a) / 255.0;
            buf[y * w + x] = [f32::from(p.r) * a, f32::from(p.g) * a, f32::from(p.b) * a, f32::from(p.a)];
        }
    }
    let mut tmp = vec![[0f32; 4]; w * h];
    let mut prefix = vec![[0f64; 4]; w.max(h) + 1];
    let r = r as usize;
    for _ in 0..PASSES {
        box_pass(&buf, &mut tmp, w, h, r, &mut prefix, Axis::X);
        box_pass(&tmp, &mut buf, w, h, r, &mut prefix, Axis::Y);
    }
    for y in target.y..target.bottom() {
        for x in target.x..target.right() {
            let p = buf[((y - area.y) as usize) * w + (x - area.x) as usize];
            raster.set(x, y, unpremultiply(p));
        }
    }
}

/// Unsharp mask: the picture plus what a blur of it threw away.
///
/// `amount` is a percentage — 100 puts the whole of the difference back,
/// which is a firm sharpening; 0 does nothing.
pub fn sharpen(raster: &mut Raster, clip: &Rect, radius: f32, amount: f32) {
    if amount.abs() < f32::EPSILON {
        return;
    }
    let mut soft = raster.clone();
    blur(&mut soft, clip, radius.max(1.0));
    let k = amount / 100.0;
    raster.map_at(clip, |p, x, y| {
        let b = soft.get(x, y);
        let ch = |s: u8, blurred: u8| {
            (f32::from(s) + (f32::from(s) - f32::from(blurred)) * k).round().clamp(0.0, 255.0) as u8
        };
        Rgba::new(ch(p.r, b.r), ch(p.g, b.g), ch(p.b, b.b), p.a)
    });
}

/// Scatters the colours by up to `amount` percent of the full range.
///
/// The grain is [`crate::dither::hash`] of the pixel's document position, so
/// it is the same grain every time the pixel is composited: an adjustment
/// layer of noise sits still while the layers under it are painted.
/// `mono` moves the three channels together, which grains the picture
/// without colouring it.
pub fn noise(raster: &mut Raster, clip: &Rect, amount: f32, mono: bool) {
    let k = amount.clamp(0.0, 100.0) / 100.0 * 255.0;
    if k <= 0.0 {
        return;
    }
    raster.map_at(clip, |p, x, y| {
        let shift = |c: u32| (hash(x, y, c) - 0.5) * 2.0 * k;
        let (dr, dg, db) = if mono {
            let d = shift(0);
            (d, d, d)
        } else {
            (shift(0), shift(1), shift(2))
        };
        let ch = |v: u8, d: f32| (f32::from(v) + d).round().clamp(0.0, 255.0) as u8;
        Rgba::new(ch(p.r, dr), ch(p.g, dg), ch(p.b, db), p.a)
    });
}

enum Axis {
    X,
    Y,
}

/// One box pass along `axis`: every pixel becomes the average of the
/// `2r + 1` around it. The window shrinks rather than wrapping or repeating
/// at the edges — the same rule [`crate::mask::Mask::smooth`] uses — so an
/// edge is not dragged towards whatever is beyond it.
fn box_pass(src: &[[f32; 4]], dst: &mut [[f32; 4]], w: usize, h: usize, r: usize, prefix: &mut [[f64; 4]], axis: Axis) {
    let (lines, len, step, start) = match axis {
        Axis::X => (h, w, 1, w),
        Axis::Y => (w, h, w, 1),
    };
    for line in 0..lines {
        let base = line * start;
        prefix[0] = [0.0; 4];
        for i in 0..len {
            let p = src[base + i * step];
            let q = prefix[i];
            prefix[i + 1] = [
                q[0] + f64::from(p[0]),
                q[1] + f64::from(p[1]),
                q[2] + f64::from(p[2]),
                q[3] + f64::from(p[3]),
            ];
        }
        for i in 0..len {
            let lo = i.saturating_sub(r);
            let hi = (i + r + 1).min(len);
            let n = (hi - lo) as f64;
            let (a, b) = (prefix[lo], prefix[hi]);
            let mean = |k: usize| ((b[k] - a[k]) / n) as f32;
            dst[base + i * step] = [mean(0), mean(1), mean(2), mean(3)];
        }
    }
}

/// A premultiplied `[r, g, b, a]` — colours scaled by alpha, alpha in
/// `0..=255` — back to the straight colour the rest of the engine uses.
fn unpremultiply(p: [f32; 4]) -> Rgba {
    let a = p[3].clamp(0.0, 255.0);
    if a < 0.5 {
        return Rgba::TRANSPARENT;
    }
    let scale = 255.0 / a;
    let ch = |v: f32| (v * scale).round().clamp(0.0, 255.0) as u8;
    Rgba::new(ch(p[0]), ch(p[1]), ch(p[2]), a.round() as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: Rgba = Rgba::opaque(255, 0, 0);

    fn checker(n: i32) -> Raster {
        let mut r = Raster::new(n as u32, n as u32);
        for y in 0..n {
            for x in 0..n {
                let v = if (x + y) % 2 == 0 { 255 } else { 0 };
                r.set(x, y, Rgba::opaque(v, v, v));
            }
        }
        r
    }

    #[test]
    fn a_blur_evens_out_a_checkerboard() {
        let mut r = checker(16);
        let all = r.bounds();
        blur(&mut r, &all, 3.0);
        for y in 4..12 {
            for x in 4..12 {
                let p = r.get(x, y);
                assert!((100..=155).contains(&p.r), "settled towards mid-grey at {x},{y}: {p}");
                assert_eq!(p.a, 255, "an opaque picture stays opaque");
            }
        }
    }

    #[test]
    fn a_radius_under_a_pixel_does_nothing() {
        let before = checker(8);
        let mut after = before.clone();
        let all = after.bounds();
        blur(&mut after, &all, 0.4);
        assert_eq!(after, before);
    }

    #[test]
    fn a_blur_gives_the_same_answer_whatever_the_clip() {
        let source = checker(24);
        let all = source.bounds();
        let mut whole = source.clone();
        blur(&mut whole, &all, 4.0);

        // The same picture blurred a strip at a time, as a preview through a
        // selection would ask for it.
        let mut in_strips = source.clone();
        for x in (0..24).step_by(5) {
            let mut piece = source.clone();
            blur(&mut piece, &Rect::new(x, 0, 5, 24), 4.0);
            for y in 0..24 {
                for x in x..(x + 5).min(24) {
                    in_strips.set(x, y, piece.get(x, y));
                }
            }
        }
        // Exactly equal up to a level: the running sums are taken over
        // different stretches of buffer, so the last bit can round either
        // way. What must not happen is the seam a real clip dependency
        // would leave.
        for y in 0..24 {
            for x in 0..24 {
                let (a, b) = (in_strips.get(x, y), whole.get(x, y));
                let off = i32::from(a.r) - i32::from(b.r);
                assert!(off.abs() <= 1, "a blur may not depend on the rectangle it was asked for: {a} vs {b} at {x},{y}");
            }
        }
    }

    #[test]
    fn a_blur_softens_the_edge_of_a_transparent_layer() {
        let mut r = Raster::new(16, 16);
        r.fill_rect(Rect::new(4, 4, 8, 8), RED, &Rect::new(0, 0, 16, 16));
        let all = r.bounds();
        blur(&mut r, &all, 2.0);
        let rim = r.get(3, 8);
        assert!(rim.a > 0 && rim.a < 255, "the edge has spread out into the empty part: {rim}");
        assert_eq!((rim.r, rim.g, rim.b), (255, 0, 0), "and it is still red, not a dark halo");
        // Three box passes of radius 2 reach six pixels, so the far corner
        // is only just within range of the square and barely marked.
        assert!(r.get(15, 15).a < 20, "well away from it, all but nothing: {}", r.get(15, 15));
    }

    #[test]
    fn sharpening_pulls_an_edge_further_apart() {
        let mut r = Raster::new(16, 16);
        let all = Rect::new(0, 0, 16, 16);
        r.fill_rect(Rect::new(0, 0, 16, 16), Rgba::opaque(120, 120, 120), &all);
        r.fill_rect(Rect::new(8, 0, 8, 16), Rgba::opaque(160, 160, 160), &all);
        sharpen(&mut r, &all, 2.0, 100.0);
        assert!(r.get(7, 8).r < 120, "the dark side of the edge went darker");
        assert!(r.get(8, 8).r > 160, "and the light side lighter");
        assert_eq!(r.get(0, 8).r, 120, "away from the edge, nothing happened");
    }

    #[test]
    fn sharpening_by_nothing_does_nothing() {
        let before = checker(8);
        let mut after = before.clone();
        let all = after.bounds();
        sharpen(&mut after, &all, 3.0, 0.0);
        assert_eq!(after, before);
    }

    #[test]
    fn noise_is_the_same_grain_every_time() {
        let flat = Raster::filled(16, 16, Rgba::opaque(128, 128, 128));
        let all = flat.bounds();
        let mut once = flat.clone();
        noise(&mut once, &all, 40.0, false);
        let mut twice = flat.clone();
        noise(&mut twice, &all, 40.0, false);
        assert_eq!(once, twice, "the grain is keyed to the pixel, so it never crawls");
        assert_ne!(once, flat, "and it did something");

        // And a piece of it is the same piece however it was asked for.
        let mut piece = flat.clone();
        noise(&mut piece, &Rect::new(4, 4, 4, 4), 40.0, false);
        assert_eq!(piece.get(5, 5), once.get(5, 5));
        assert_eq!(piece.get(0, 0), flat.get(0, 0), "and nothing outside it moved");
    }

    #[test]
    fn mono_noise_keeps_the_colour() {
        let flat = Raster::filled(8, 8, Rgba::opaque(128, 100, 60));
        let all = flat.bounds();
        let mut grained = flat.clone();
        noise(&mut grained, &all, 20.0, true);
        for y in 0..8 {
            for x in 0..8 {
                let (was, now) = (flat.get(x, y), grained.get(x, y));
                let d = i32::from(now.r) - i32::from(was.r);
                assert_eq!(i32::from(now.g) - i32::from(was.g), d, "every channel moved together");
                assert_eq!(now.a, 255);
            }
        }
    }

    #[test]
    fn noise_leaves_alpha_alone() {
        let mut r = Raster::new(8, 8);
        r.set(0, 0, RED.with_alpha(40));
        let all = r.bounds();
        noise(&mut r, &all, 100.0, false);
        assert_eq!(r.get(0, 0).a, 40);
        assert_eq!(r.get(4, 4).a, 0, "and an empty pixel stays empty");
    }
}
