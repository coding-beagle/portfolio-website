//! Select Subject: find the thing the picture is *of*, with no model to ask.
//!
//! There is no neural network here and nowhere to put one — the whole page is
//! about 110 KB and runs offline — so this is the classical pipeline, which
//! does well on the pictures people actually cut out (a subject that stands
//! out from its background) and is honest about the rest:
//!
//! 1. Shrink the image. Everything up to the last step happens at about
//!    192 pixels across, which is enough to find a subject and cheap enough
//!    to iterate over several times.
//! 2. Score every pixel on three priors that agree surprisingly often:
//!    *contrast* (a colour unlike the rest of the picture is interesting),
//!    *background likeness* (a colour like the ones around the border is
//!    not), and *position* (photographers put subjects near the middle).
//! 3. Split the scores in two with Otsu's threshold — the split that leaves
//!    the two halves as tight as possible.
//! 4. Learn a colour model for each side of that split and re-decide every
//!    pixel with its neighbours in mind, a few times over. This is iterated
//!    conditional modes: a cheap stand-in for a graph cut that cleans up
//!    speckle and pulls the boundary onto real edges.
//! 5. Keep the biggest piece, fill its holes, and put the edge back at full
//!    resolution by classifying the band around it with the same colour
//!    models — so the mask is crisp at the size the user is actually working.

use super::{distance, edges};
use crate::color::Rgba;
use crate::mask::Mask;
use crate::raster::Raster;

/// The long side of the image the search runs on.
const WORKING: u32 = 192;
/// Colour bins per channel for the histograms: 16³ is fine enough to tell a
/// subject from its background and coarse enough to be a reliable count.
const LEVELS: usize = 16;
const BINS: usize = LEVELS * LEVELS * LEVELS;
/// How much a disagreeing neighbour costs, against the colour evidence.
const SMOOTHNESS: f32 = 2.2;
/// Rounds of re-deciding every pixel.
const PASSES: usize = 6;

fn bin_of(c: Rgba) -> usize {
    let q = |v: u8| (usize::from(v) * LEVELS / 256).min(LEVELS - 1);
    (q(c.r) * LEVELS + q(c.g)) * LEVELS + q(c.b)
}

fn bin_color(bin: usize) -> Rgba {
    let step = (256 / LEVELS) as u8;
    let half = step / 2;
    let b = bin % LEVELS;
    let g = (bin / LEVELS) % LEVELS;
    let r = bin / (LEVELS * LEVELS);
    Rgba::opaque(r as u8 * step + half, g as u8 * step + half, b as u8 * step + half)
}

/// A box-filtered copy no larger than `longest` on its long side.
fn downscale(source: &Raster, longest: u32) -> (Raster, f64) {
    let (w, h) = (source.width(), source.height());
    let scale = f64::from(longest) / f64::from(w.max(h).max(1));
    if scale >= 1.0 {
        return (source.clone(), 1.0);
    }
    let (nw, nh) = ((f64::from(w) * scale).round().max(1.0) as u32, (f64::from(h) * scale).round().max(1.0) as u32);
    let mut out = Raster::new(nw, nh);
    for y in 0..nh {
        for x in 0..nw {
            let x0 = (u64::from(x) * u64::from(w) / u64::from(nw)) as i32;
            let x1 = ((u64::from(x) + 1) * u64::from(w) / u64::from(nw)).max(u64::from(x0 as u32) + 1) as i32;
            let y0 = (u64::from(y) * u64::from(h) / u64::from(nh)) as i32;
            let y1 = ((u64::from(y) + 1) * u64::from(h) / u64::from(nh)).max(u64::from(y0 as u32) + 1) as i32;
            let (mut r, mut g, mut b, mut a, mut n) = (0u32, 0u32, 0u32, 0u32, 0u32);
            for sy in y0..y1.min(h as i32) {
                for sx in x0..x1.min(w as i32) {
                    let p = source.get(sx, sy);
                    r += u32::from(p.r);
                    g += u32::from(p.g);
                    b += u32::from(p.b);
                    a += u32::from(p.a);
                    n += 1;
                }
            }
            let n = n.max(1);
            out.set(x as i32, y as i32, Rgba::new((r / n) as u8, (g / n) as u8, (b / n) as u8, (a / n) as u8));
        }
    }
    (out, scale)
}

/// Otsu's threshold of a set of `0..=255` scores: the cut that leaves the
/// least variance within the two groups.
pub fn otsu(values: &[u8]) -> u8 {
    let mut histogram = [0u32; 256];
    for &v in values {
        histogram[usize::from(v)] += 1;
    }
    let total: u32 = values.len() as u32;
    if total == 0 {
        return 128;
    }
    let sum: f64 = histogram.iter().enumerate().map(|(i, &n)| i as f64 * f64::from(n)).sum();
    let (mut back_weight, mut back_sum) = (0f64, 0f64);
    let (mut best, mut best_variance) = (0u8, -1f64);
    for (t, &count) in histogram.iter().enumerate() {
        back_weight += f64::from(count);
        if back_weight == 0.0 {
            continue;
        }
        let fore_weight = f64::from(total) - back_weight;
        if fore_weight == 0.0 {
            break;
        }
        back_sum += t as f64 * f64::from(count);
        let back_mean = back_sum / back_weight;
        let fore_mean = (sum - back_sum) / fore_weight;
        let between = back_weight * fore_weight * (back_mean - fore_mean) * (back_mean - fore_mean);
        if between > best_variance {
            best_variance = between;
            best = t as u8;
        }
    }
    best
}

/// A colour histogram used as a likelihood: how typical a colour is of the
/// pixels it was built from.
struct ColorModel {
    counts: Vec<f32>,
    total: f32,
}

impl ColorModel {
    fn new() -> ColorModel {
        // One imaginary observation per bin, so an unseen colour is unlikely
        // rather than impossible and the logarithm stays finite.
        ColorModel { counts: vec![1.0; BINS], total: BINS as f32 }
    }

    fn add(&mut self, c: Rgba) {
        self.counts[bin_of(c)] += 1.0;
        self.total += 1.0;
    }

    /// Spreads each bin's count over its neighbours in colour space, so a
    /// colour just off one that was seen is not treated as a stranger.
    fn blur(&mut self) {
        let mut out = self.counts.clone();
        for r in 0..LEVELS {
            for g in 0..LEVELS {
                for b in 0..LEVELS {
                    let mut sum = 0.0;
                    let mut n = 0.0;
                    for dr in -1i32..=1 {
                        for dg in -1i32..=1 {
                            for db in -1i32..=1 {
                                let (rr, gg, bb) = (r as i32 + dr, g as i32 + dg, b as i32 + db);
                                if rr < 0 || gg < 0 || bb < 0 {
                                    continue;
                                }
                                let (rr, gg, bb) = (rr as usize, gg as usize, bb as usize);
                                if rr >= LEVELS || gg >= LEVELS || bb >= LEVELS {
                                    continue;
                                }
                                sum += self.counts[(rr * LEVELS + gg) * LEVELS + bb];
                                n += 1.0;
                            }
                        }
                    }
                    out[(r * LEVELS + g) * LEVELS + b] = sum / n;
                }
            }
        }
        self.total = out.iter().sum();
        self.counts = out;
    }

    fn cost(&self, c: Rgba) -> f32 {
        -(self.counts[bin_of(c)] / self.total).ln()
    }
}

/// Keeps only the largest four-connected run of `true`, which throws away the
/// speckle the colour models leave behind.
pub fn largest_component(inside: &[bool], w: usize, h: usize) -> Vec<bool> {
    let mut seen = vec![false; inside.len()];
    let mut best: Vec<usize> = Vec::new();
    for start in 0..inside.len() {
        if !inside[start] || seen[start] {
            continue;
        }
        let mut stack = vec![start];
        let mut group = Vec::new();
        seen[start] = true;
        while let Some(i) = stack.pop() {
            group.push(i);
            let (x, y) = (i % w, i / w);
            let mut visit = |nx: usize, ny: usize, stack: &mut Vec<usize>| {
                let n = ny * w + nx;
                if inside[n] && !seen[n] {
                    seen[n] = true;
                    stack.push(n);
                }
            };
            if x > 0 {
                visit(x - 1, y, &mut stack);
            }
            if x + 1 < w {
                visit(x + 1, y, &mut stack);
            }
            if y > 0 {
                visit(x, y - 1, &mut stack);
            }
            if y + 1 < h {
                visit(x, y + 1, &mut stack);
            }
        }
        if group.len() > best.len() {
            best = group;
        }
    }
    let mut out = vec![false; inside.len()];
    for i in best {
        out[i] = true;
    }
    out
}

/// Fills anything enclosed by the region: background that cannot reach the
/// border is a hole, not background.
pub fn fill_holes(inside: &mut [bool], w: usize, h: usize) {
    let mut outside = vec![false; inside.len()];
    let mut stack = Vec::new();
    for x in 0..w {
        for y in [0, h - 1] {
            if !inside[y * w + x] && !outside[y * w + x] {
                outside[y * w + x] = true;
                stack.push(y * w + x);
            }
        }
    }
    for y in 0..h {
        for x in [0, w - 1] {
            if !inside[y * w + x] && !outside[y * w + x] {
                outside[y * w + x] = true;
                stack.push(y * w + x);
            }
        }
    }
    while let Some(i) = stack.pop() {
        let (x, y) = (i % w, i / w);
        let mut visit = |nx: usize, ny: usize, stack: &mut Vec<usize>| {
            let n = ny * w + nx;
            if !inside[n] && !outside[n] {
                outside[n] = true;
                stack.push(n);
            }
        };
        if x > 0 {
            visit(x - 1, y, &mut stack);
        }
        if x + 1 < w {
            visit(x + 1, y, &mut stack);
        }
        if y > 0 {
            visit(x, y - 1, &mut stack);
        }
        if y + 1 < h {
            visit(x, y + 1, &mut stack);
        }
    }
    for i in 0..inside.len() {
        if !outside[i] {
            inside[i] = true;
        }
    }
}

/// Finds the subject of `source` and returns it as a mask the same size.
/// An image with nothing to find comes back empty, and the caller says so.
pub fn select_subject(source: &Raster) -> Mask {
    let (w, h) = (source.width(), source.height());
    if w == 0 || h == 0 {
        return Mask::new(w, h);
    }
    let (small, _) = downscale(source, WORKING);
    let (sw, sh) = (small.width() as usize, small.height() as usize);
    if sw < 4 || sh < 4 {
        return alpha_mask(source);
    }

    // ---- The three priors --------------------------------------------------
    let mut histogram = vec![0u32; BINS];
    for p in small.pixels() {
        histogram[bin_of(*p)] += 1;
    }
    let occupied: Vec<usize> = (0..BINS).filter(|&b| histogram[b] > 0).collect();
    let contrast: Vec<f32> = {
        let mut per_bin = vec![0f32; BINS];
        for &i in &occupied {
            let ci = bin_color(i);
            let mut sum = 0f32;
            for &j in &occupied {
                sum += histogram[j] as f32 * f32::from(distance(ci, bin_color(j)));
            }
            per_bin[i] = sum;
        }
        per_bin
    };

    // Colours that ring the picture are the best guess at the background.
    let mut border = ColorModel::new();
    for x in 0..sw {
        for y in [0usize, 1, sh - 2, sh - 1] {
            border.add(small.get(x as i32, y as i32));
        }
    }
    for y in 0..sh {
        for x in [0usize, 1, sw - 2, sw - 1] {
            border.add(small.get(x as i32, y as i32));
        }
    }
    border.blur();

    // What the pixels themselves say — contrast and unlikeness to the border.
    let evidence: Vec<f32> = (0..sw * sh)
        .map(|i| {
            let p = small.get((i % sw) as i32, (i / sw) as i32);
            contrast[bin_of(p)] * 0.5 + border.cost(p) * 4000.0
        })
        .collect();
    let span = evidence.iter().copied().fold(f32::NEG_INFINITY, f32::max)
        - evidence.iter().copied().fold(f32::INFINITY, f32::min);
    if span <= 1e-3 {
        // Nothing stands out from anything: there is no subject to find, and
        // the position prior alone would invent one in the middle.
        return alpha_mask(source);
    }

    // Then where it is: photographers put subjects near the middle, and a
    // transparent pixel is not the subject of anything.
    let (cx, cy) = (sw as f32 / 2.0, sh as f32 / 2.0);
    let radius = cx.hypot(cy);
    let score: Vec<f32> = (0..sw * sh)
        .map(|i| {
            let (x, y) = ((i % sw) as f32, (i / sw) as f32);
            let centre = 1.0 - 0.45 * ((x - cx).hypot(y - cy) / radius).min(1.0);
            let solid = f32::from(small.get(x as i32, y as i32).a) / 255.0;
            evidence[i] * centre * solid
        })
        .collect();
    let bytes = to_bytes(&score);
    let threshold = otsu(&bytes);
    let mut inside: Vec<bool> = bytes.iter().map(|&v| v > threshold).collect();

    // ---- Learn the two colour models and re-decide, with neighbours --------
    let grad = edges(&small);
    for _ in 0..PASSES {
        let (mut fg, mut bg) = (ColorModel::new(), ColorModel::new());
        for (i, &is_in) in inside.iter().enumerate() {
            let p = small.get((i % sw) as i32, (i / sw) as i32);
            if is_in {
                fg.add(p);
            } else {
                bg.add(p);
            }
        }
        fg.blur();
        bg.blur();
        let mut next = inside.clone();
        for y in 0..sh {
            for x in 0..sw {
                let i = y * sw + x;
                let p = small.get(x as i32, y as i32);
                let (mut cost_in, mut cost_out) = (fg.cost(p), bg.cost(p));
                // Disagreeing with a neighbour costs less where the image
                // already changes: that is where a boundary belongs.
                for (nx, ny) in neighbours(x, y, sw, sh) {
                    let n = ny * sw + nx;
                    let edge = f32::from(grad[n]) / 255.0;
                    let penalty = SMOOTHNESS * (1.0 - edge);
                    if inside[n] {
                        cost_out += penalty;
                    } else {
                        cost_in += penalty;
                    }
                }
                next[i] = cost_in < cost_out;
            }
        }
        if next == inside {
            break;
        }
        inside = next;
    }

    inside = largest_component(&inside, sw, sh);
    fill_holes(&mut inside, sw, sh);
    if !inside.iter().any(|&v| v) {
        return alpha_mask(source);
    }

    // ---- Back to full size, with the edge decided on real pixels ----------
    let (mut fg, mut bg) = (ColorModel::new(), ColorModel::new());
    for (i, &is_in) in inside.iter().enumerate() {
        let p = small.get((i % sw) as i32, (i / sw) as i32);
        if is_in {
            fg.add(p);
        } else {
            bg.add(p);
        }
    }
    fg.blur();
    bg.blur();

    let sample = |x: i32, y: i32| {
        let sx = ((f64::from(x) + 0.5) * sw as f64 / f64::from(w)).floor() as i32;
        let sy = ((f64::from(y) + 0.5) * sh as f64 / f64::from(h)).floor() as i32;
        let sx = sx.clamp(0, sw as i32 - 1) as usize;
        let sy = sy.clamp(0, sh as i32 - 1) as usize;
        inside[sy * sw + sx]
    };
    let mut mask = Mask::from_fn(w, h, |x, y| {
        let here = sample(x, y);
        let border = [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)].iter().any(|&(nx, ny)| sample(nx, ny) != here);
        if !border {
            return u8::from(here) * 255;
        }
        // On the boundary the small image cannot say where the edge is; the
        // colour models can, at the resolution the user sees.
        let p = source.get(x, y);
        u8::from(fg.cost(p) < bg.cost(p)) * 255
    });
    mask.smooth(1);
    mask.antialias();
    mask
}

fn neighbours(x: usize, y: usize, w: usize, h: usize) -> Vec<(usize, usize)> {
    let mut out = Vec::with_capacity(4);
    if x > 0 {
        out.push((x - 1, y));
    }
    if x + 1 < w {
        out.push((x + 1, y));
    }
    if y > 0 {
        out.push((x, y - 1));
    }
    if y + 1 < h {
        out.push((x, y + 1));
    }
    out
}

fn to_bytes(score: &[f32]) -> Vec<u8> {
    let lo = score.iter().copied().fold(f32::INFINITY, f32::min);
    let hi = score.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let span = (hi - lo).max(f32::EPSILON);
    score.iter().map(|v| (((v - lo) / span) * 255.0).round().clamp(0.0, 255.0) as u8).collect()
}

/// The fallback when there is no subject to find: whatever is not
/// transparent. On a photograph that is everything, and the caller treats an
/// everything-selection as having found nothing.
fn alpha_mask(source: &Raster) -> Mask {
    Mask::from_fn(source.width(), source.height(), |x, y| u8::from(source.get(x, y).a > 0) * 255)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disc_on_a_field(bg: Rgba, fg: Rgba) -> Raster {
        let mut r = Raster::filled(120, 120, bg);
        for y in 0..120 {
            for x in 0..120 {
                if (f64::from(x) - 60.0).hypot(f64::from(y) - 60.0) < 28.0 {
                    r.set(x, y, fg);
                }
            }
        }
        r
    }

    #[test]
    fn otsu_splits_two_clusters_between_them() {
        let mut values = vec![10u8; 100];
        values.extend(std::iter::repeat_n(200u8, 100));
        let t = otsu(&values);
        // Everything above the threshold is foreground, so any cut from the
        // low cluster up to just under the high one splits them.
        assert!((10..200).contains(&t), "the cut falls between the two: {t}");
    }

    #[test]
    fn otsu_of_nothing_is_the_middle() {
        assert_eq!(otsu(&[]), 128);
    }

    #[test]
    fn the_largest_piece_wins_and_the_speckle_goes() {
        // A 4x4 grid: a 2x2 block in the corner and a lone pixel elsewhere.
        let mut inside = vec![false; 16];
        for i in [0, 1, 4, 5, 15] {
            inside[i] = true;
        }
        let out = largest_component(&inside, 4, 4);
        assert!(out[0] && out[5]);
        assert!(!out[15], "the speck is dropped");
    }

    #[test]
    fn holes_are_filled_but_the_outside_is_left_alone() {
        let mut inside = vec![false; 25];
        for y in 1..4 {
            for x in 1..4 {
                inside[y * 5 + x] = true;
            }
        }
        inside[2 * 5 + 2] = false; // a hole in the middle
        fill_holes(&mut inside, 5, 5);
        assert!(inside[2 * 5 + 2], "the hole is filled");
        assert!(!inside[0], "and the outside is still outside");
    }

    #[test]
    fn finds_a_subject_that_stands_out_from_its_background() {
        let source = disc_on_a_field(Rgba::opaque(240, 240, 235), Rgba::opaque(190, 40, 40));
        let mask = select_subject(&source);
        assert!(mask.contains(60, 60), "the middle of the disc is selected");
        assert!(!mask.contains(5, 5), "the corner is not");
        assert!(!mask.contains(60, 5), "nor the background above it");
        // Roughly the area of the disc, allowing for the edge treatment.
        let area = std::f64::consts::PI * 28.0 * 28.0;
        let count = mask.count() as f64;
        assert!(count > area * 0.75 && count < area * 1.35, "{count} against {area}");
    }

    #[test]
    fn the_subject_can_be_off_centre() {
        let mut source = Raster::filled(120, 120, Rgba::opaque(245, 245, 240));
        for y in 10..50 {
            for x in 8..48 {
                source.set(x, y, Rgba::opaque(30, 60, 160));
            }
        }
        let mask = select_subject(&source);
        assert!(mask.contains(28, 30));
        assert!(!mask.contains(90, 90));
    }

    #[test]
    fn a_cut_out_with_transparency_selects_what_is_there() {
        let mut source = Raster::new(60, 60);
        for y in 20..40 {
            for x in 20..40 {
                source.set(x, y, Rgba::opaque(20, 160, 90));
            }
        }
        let mask = select_subject(&source);
        assert!(mask.contains(30, 30));
        assert!(!mask.contains(2, 2));
    }

    #[test]
    fn a_picture_of_nothing_finds_nothing_to_select() {
        let flat = Raster::filled(80, 80, Rgba::opaque(128, 128, 128));
        let mask = select_subject(&flat);
        assert!(mask.is_everything() || mask.is_empty(), "no subject: the caller says so");
    }
}
