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

/// The widest a median may reach, in pixels. It reads `(2r + 1)²` pixels for
/// every one it writes, and that is what puts a ceiling on it.
pub const MAX_MEDIAN_RADIUS: f32 = 8.0;
/// The longest a motion blur may smear, in pixels.
pub const MAX_MOTION_DISTANCE: f32 = 200.0;
/// The largest a pixelate cell may be, in pixels.
pub const MAX_CELL: f32 = 100.0;

/// A copy of everything within a filter's reach of the clip, taken before
/// the filter writes anything.
///
/// This is how the filters here keep the clip-independence rule: what a
/// pixel becomes is decided by what was around it, not by what a previous
/// pass of the same filter has already put there, and not by where the
/// rectangle it was asked for happens to end.
struct Around {
    pixels: Raster,
    area: Rect,
    whole: Rect,
}

impl Around {
    /// The copy, and the rectangle the filter is to write. `None` when
    /// there is nothing to do.
    fn new(raster: &Raster, clip: &Rect, reach: i32) -> Option<(Around, Rect)> {
        let whole = raster.bounds();
        let target = clip.intersect(&whole);
        let area = clip.inflate(reach.max(0)).intersect(&whole);
        if target.is_empty() || area.is_empty() {
            return None;
        }
        let pixels = raster.resized(area.w as u32, area.h as u32, -area.x, -area.y);
        Some((Around { pixels, area, whole }, target))
    }

    /// The pixel at a document position, with the edge of the picture
    /// repeated beyond it. Reading transparency in from outside would draw
    /// a border round every filtered layer.
    fn get(&self, x: i32, y: i32) -> Rgba {
        let x = x.clamp(self.whole.x, self.whole.right() - 1);
        let y = y.clamp(self.whole.y, self.whole.bottom() - 1);
        self.pixels.get(x - self.area.x, y - self.area.y)
    }

    /// [`Around::get`] as premultiplied `[r, g, b, a]`, which is what the
    /// filters that move alpha about work in.
    fn premultiplied(&self, x: i32, y: i32) -> [f32; 4] {
        let p = self.get(x, y);
        let a = f32::from(p.a) / 255.0;
        [f32::from(p.r) * a, f32::from(p.g) * a, f32::from(p.b) * a, f32::from(p.a)]
    }
}

/// Replaces every pixel with the middle colour of the square around it.
///
/// Where a blur mixes the neighbours together, a median picks one of them,
/// so speckles vanish while edges stay where they are. That is what makes it
/// the tool for scanner dust and for the flattening that turns a photograph
/// into something poster-like at a wide radius.
pub fn median(raster: &mut Raster, clip: &Rect, radius: f32) {
    let r = radius.round().clamp(0.0, MAX_MEDIAN_RADIUS) as i32;
    if r < 1 {
        return;
    }
    let Some((src, target)) = Around::new(raster, clip, r) else { return };
    let mut window: Vec<u8> = Vec::with_capacity(((2 * r + 1) * (2 * r + 1)) as usize);
    raster.map_at(&target, |p, x, y| {
        // The channels are taken apart and each one's own middle value
        // chosen, which is what every median filter of this kind does: it
        // can invent a colour that was not in the window, and it keeps the
        // hard edges that matter more.
        let middle = |channel: usize, window: &mut Vec<u8>| {
            window.clear();
            for dy in -r..=r {
                for dx in -r..=r {
                    let q = src.get(x + dx, y + dy);
                    window.push([q.r, q.g, q.b][channel]);
                }
            }
            let half = window.len() / 2;
            *window.select_nth_unstable(half).1
        };
        Rgba::new(middle(0, &mut window), middle(1, &mut window), middle(2, &mut window), p.a)
    });
}

/// Smears the picture along a line: the average of what a pixel would have
/// passed over, moving `distance` pixels in the direction `angle` names.
///
/// It works on premultiplied colour, alpha and all, for the reason the blur
/// does: a streak that leaves the edge of the picture has to fade out, not
/// drag whatever was stored under the transparent pixels along with it.
pub fn motion_blur(raster: &mut Raster, clip: &Rect, angle: f32, distance: f32) {
    let distance = distance.clamp(0.0, MAX_MOTION_DISTANCE);
    let steps = distance.round() as i32;
    if steps < 1 {
        return;
    }
    let (sin, cos) = angle.to_radians().sin_cos();
    let half = distance / 2.0;
    let Some((src, target)) = Around::new(raster, clip, half.ceil() as i32 + 1) else { return };
    raster.map_at(&target, |_, x, y| {
        let mut sum = [0f32; 4];
        // One sample a pixel along the line, from one end of the smear to
        // the other, so the length of the streak is the distance asked for
        // whatever direction it runs in.
        for step in 0..=steps {
            let t = -half + distance * (step as f32) / (steps as f32);
            let sx = x + (cos * t).round() as i32;
            let sy = y + (sin * t).round() as i32;
            let q = src.premultiplied(sx, sy);
            for (acc, v) in sum.iter_mut().zip(q) {
                *acc += v;
            }
        }
        let n = (steps + 1) as f32;
        unpremultiply([sum[0] / n, sum[1] / n, sum[2] / n, sum[3] / n])
    });
}

/// Squares the picture off: every cell of `size` pixels becomes the one
/// colour its pixels average to.
///
/// The cells are laid out from the document's own origin rather than from
/// the clip's, which is what makes a preview through a selection line up
/// with the same filter applied to the whole layer.
pub fn pixelate(raster: &mut Raster, clip: &Rect, size: f32) {
    let size = size.round().clamp(1.0, MAX_CELL) as i32;
    if size < 2 {
        return;
    }
    let Some((src, target)) = Around::new(raster, clip, size) else { return };
    let cell = |v: i32| v.div_euclid(size);
    let (cx0, cy0) = (cell(target.x), cell(target.y));
    let (cx1, cy1) = (cell(target.right() - 1), cell(target.bottom() - 1));
    let across = (cx1 - cx0 + 1) as usize;
    // Every cell averaged once, rather than once for each pixel that asks.
    let mut colours = Vec::with_capacity(across * (cy1 - cy0 + 1) as usize);
    for cy in cy0..=cy1 {
        for cx in cx0..=cx1 {
            let mut sum = [0f32; 4];
            for y in (cy * size)..(cy * size + size) {
                for x in (cx * size)..(cx * size + size) {
                    let q = src.premultiplied(x, y);
                    for (acc, v) in sum.iter_mut().zip(q) {
                        *acc += v;
                    }
                }
            }
            let n = (size * size) as f32;
            colours.push(unpremultiply([sum[0] / n, sum[1] / n, sum[2] / n, sum[3] / n]));
        }
    }
    raster.map_at(&target, |_, x, y| {
        colours[(cell(y) - cy0) as usize * across + (cell(x) - cx0) as usize]
    });
}

/// Lights the picture from one side as though it were stamped into metal:
/// mid-grey everywhere it is flat, lighter and darker where it changes.
///
/// `angle` is where the light comes from and `amount` how deep the relief
/// is, as a percentage.
pub fn emboss(raster: &mut Raster, clip: &Rect, angle: f32, amount: f32) {
    let k = amount / 100.0;
    let (sin, cos) = angle.to_radians().sin_cos();
    let (dx, dy) = (cos.round() as i32, -sin.round() as i32);
    if k.abs() < f32::EPSILON || (dx == 0 && dy == 0) {
        return;
    }
    let Some((src, target)) = Around::new(raster, clip, 1) else { return };
    raster.map_at(&target, |p, x, y| {
        let (lit, shade) = (src.get(x - dx, y - dy), src.get(x + dx, y + dy));
        let ch = |a: u8, b: u8| (MID_GREY + (f32::from(a) - f32::from(b)) * k).round().clamp(0.0, 255.0) as u8;
        Rgba::new(ch(lit.r, shade.r), ch(lit.g, shade.g), ch(lit.b, shade.b), p.a)
    });
}

/// Keeps the edges and throws the flat parts away: dark lines on white,
/// where the picture changes fastest.
///
/// The gradient is the Sobel one, taken a channel at a time rather than on
/// the brightness alone — a red shape on a green ground of the same
/// brightness has an edge, and a filter that looked only at luminance would
/// miss it. (The luminance version, which is the one an automatic selection
/// wants, is [`crate::autoselect::edges`].)
pub fn find_edges(raster: &mut Raster, clip: &Rect, amount: f32) {
    let k = amount / 100.0;
    let Some((src, target)) = Around::new(raster, clip, 1) else { return };
    raster.map_at(&target, |p, x, y| {
        let at = |dx: i32, dy: i32| src.get(x + dx, y + dy);
        let ch = |pick: fn(&Rgba) -> u8| {
            let v = |dx, dy| f32::from(pick(&at(dx, dy)));
            let gx = v(1, -1) + 2.0 * v(1, 0) + v(1, 1) - v(-1, -1) - 2.0 * v(-1, 0) - v(-1, 1);
            let gy = v(-1, 1) + 2.0 * v(0, 1) + v(1, 1) - v(-1, -1) - 2.0 * v(0, -1) - v(1, -1);
            // The four Sobel weights on each side, so a step from black to
            // white comes out as a line of full strength.
            (255.0 - gx.hypot(gy) / 4.0 * k).round().clamp(0.0, 255.0) as u8
        };
        Rgba::new(ch(|q| q.r), ch(|q| q.g), ch(|q| q.b), p.a)
    });
}

/// The level an embossed picture settles to where nothing is happening.
const MID_GREY: f32 = 128.0;

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

    /// A picture with colour, an edge and some transparency in it: enough
    /// for a filter to have something to do everywhere.
    fn scene() -> Raster {
        let mut r = Raster::new(24, 24);
        let all = r.bounds();
        r.fill_rect(Rect::new(0, 0, 24, 24), Rgba::opaque(60, 90, 140), &all);
        r.fill_rect(Rect::new(6, 4, 10, 12), Rgba::opaque(230, 200, 40), &all);
        r.fill_rect(Rect::new(0, 18, 24, 6), Rgba::TRANSPARENT, &all);
        r.set(3, 3, Rgba::opaque(255, 255, 255));
        r
    }

    /// The rule every filter here has to keep: a pixel comes out the same
    /// however the picture was cut up to ask for it.
    fn agrees_whatever_the_clip(what: &str, filter: impl Fn(&mut Raster, &Rect)) {
        let source = scene();
        let (w, h) = (source.width() as i32, source.height() as i32);
        let all = source.bounds();
        let mut whole = source.clone();
        filter(&mut whole, &all);

        // The same picture filtered a strip at a time, as a preview through
        // a selection asks for it.
        let mut in_strips = source.clone();
        for left in (0..w).step_by(5) {
            let mut piece = source.clone();
            filter(&mut piece, &Rect::new(left, 0, 5, h));
            for y in 0..h {
                for x in left..(left + 5).min(w) {
                    in_strips.set(x, y, piece.get(x, y));
                }
            }
        }
        for y in 0..h {
            for x in 0..w {
                assert_eq!(in_strips.get(x, y), whole.get(x, y), "{what} at {x},{y} depends on the rectangle it was asked for");
            }
        }
    }

    #[test]
    fn no_filter_depends_on_the_rectangle_it_was_asked_for() {
        agrees_whatever_the_clip("median", |r, c| median(r, c, 2.0));
        agrees_whatever_the_clip("motion blur", |r, c| motion_blur(r, c, 30.0, 12.0));
        agrees_whatever_the_clip("pixelate", |r, c| pixelate(r, c, 7.0));
        agrees_whatever_the_clip("emboss", |r, c| emboss(r, c, 135.0, 100.0));
        agrees_whatever_the_clip("find edges", |r, c| find_edges(r, c, 100.0));
    }

    #[test]
    fn a_median_takes_out_a_speckle_and_leaves_the_edge() {
        let mut r = scene();
        let all = r.bounds();
        median(&mut r, &all, 2.0);
        assert_eq!(r.get(3, 3), Rgba::opaque(60, 90, 140), "the single white pixel is outvoted");
        assert_eq!(r.get(10, 10), Rgba::opaque(230, 200, 40), "well inside the block, nothing moved");
        // A blur would have smeared this across several pixels; a median
        // keeps it one pixel wide.
        assert_eq!(r.get(5, 10), Rgba::opaque(60, 90, 140));
        assert_eq!(r.get(6, 10), Rgba::opaque(230, 200, 40), "the edge is still where it was");
    }

    #[test]
    fn a_median_of_nothing_does_nothing() {
        let before = scene();
        let mut after = before.clone();
        let all = after.bounds();
        median(&mut after, &all, 0.4);
        assert_eq!(after, before);
    }

    #[test]
    fn a_motion_blur_smears_along_its_own_angle() {
        let mut r = Raster::new(21, 21);
        let all = r.bounds();
        r.fill_rect(Rect::new(10, 10, 1, 1), RED, &all);
        motion_blur(&mut r, &all, 0.0, 9.0);
        assert!(r.get(13, 10).a > 0, "spread sideways");
        assert_eq!(r.get(10, 13).a, 0, "and not up or down");
        assert_eq!((r.get(13, 10).r, r.get(13, 10).g), (255, 0), "no dark halo against transparency");
        assert!(r.get(10, 10).a < 255, "the pixel itself thinned out");
    }

    #[test]
    fn pixelate_lays_its_cells_out_from_the_documents_own_origin() {
        let mut r = Raster::new(8, 8);
        let all = r.bounds();
        r.fill_rect(Rect::new(0, 0, 4, 4), Rgba::opaque(200, 200, 200), &all);
        pixelate(&mut r, &all, 4.0);
        // The top-left cell is exactly the light square, so it keeps its
        // colour; the cell beside it saw nothing and stays empty.
        assert_eq!(r.get(0, 0), Rgba::opaque(200, 200, 200));
        assert_eq!(r.get(3, 3), Rgba::opaque(200, 200, 200));
        assert_eq!(r.get(4, 0).a, 0);
        // Every pixel of a cell is the same colour, which is the point.
        let mut one_cell = Raster::new(8, 8);
        one_cell.fill_rect(Rect::new(2, 2, 3, 3), RED, &all);
        pixelate(&mut one_cell, &all, 4.0);
        assert_eq!(one_cell.get(0, 0), one_cell.get(3, 3), "a cell is one colour");
        assert_ne!(one_cell.get(0, 0), one_cell.get(4, 4), "and the next cell is its own");
    }

    #[test]
    fn an_emboss_is_flat_where_the_picture_is_flat() {
        let mut r = Raster::filled(8, 8, Rgba::opaque(90, 120, 200));
        let all = r.bounds();
        emboss(&mut r, &all, 135.0, 100.0);
        assert_eq!(r.get(4, 4), Rgba::opaque(128, 128, 128), "nothing happening, mid-grey");

        // A step from black to white, lit from one side and then the
        // other: the same relief, turned over.
        let step = {
            let mut step = Raster::filled(8, 8, Rgba::opaque(0, 0, 0));
            step.fill_rect(Rect::new(4, 0, 4, 8), Rgba::opaque(255, 255, 255), &all);
            step
        };
        let mut lit_right = step.clone();
        emboss(&mut lit_right, &all, 0.0, 100.0);
        let mut lit_left = step.clone();
        emboss(&mut lit_left, &all, 180.0, 100.0);
        assert!(lit_right.get(4, 4).r < 128, "the step is in shadow: {}", lit_right.get(4, 4));
        assert!(lit_left.get(4, 4).r > 128, "and lit from the other side it catches the light");
        assert_eq!(lit_right.get(0, 4), Rgba::opaque(128, 128, 128), "away from it, flat grey");
        assert_eq!(lit_right.get(0, 4).a, 255, "alpha is left alone");
    }

    #[test]
    fn find_edges_keeps_the_edges_and_whitens_the_rest() {
        let mut r = Raster::filled(12, 12, Rgba::opaque(40, 40, 40));
        let all = r.bounds();
        r.fill_rect(Rect::new(6, 0, 6, 12), Rgba::opaque(220, 220, 220), &all);
        find_edges(&mut r, &all, 100.0);
        assert_eq!(r.get(1, 6), Rgba::opaque(255, 255, 255), "a flat field comes out white");
        assert_eq!(r.get(10, 6), Rgba::opaque(255, 255, 255));
        assert!(r.get(5, 6).r < 100, "and the step is a dark line: {}", r.get(5, 6));
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
