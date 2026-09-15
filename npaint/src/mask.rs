//! A per-pixel selection mask: which pixels an edit may touch, and how much.
//!
//! Coverage is 8-bit, not a bit per pixel, so a selection can have a soft
//! edge — feathering, and the smoothed edges the automatic tools produce —
//! without a second representation. `0` is outside, `255` fully inside, and
//! everything between is a partial edit: the editor blends the result of a
//! gesture back over what was there in proportion to the coverage.
//!
//! Nothing here knows about layers or tools. The mask is the size of the
//! document and is addressed in document pixels.

use crate::geometry::{Point, Rect};

/// Coverage at or above this counts as "in the selection" for the questions
/// that need a yes or a no: the marching ants, and `contains`.
pub const SOLID: u8 = 128;

/// How two selections combine.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum SelectMode {
    /// The new selection replaces the old one.
    #[default]
    Replace,
    /// Shift-drag: everything in either.
    Add,
    /// Alt-drag: the old one with the new one taken out of it.
    Subtract,
    /// Shift+Alt-drag: only what is in both.
    Intersect,
}

impl SelectMode {
    /// The mode the modifier keys ask for.
    pub fn from_modifiers(shift: bool, alt: bool) -> SelectMode {
        match (shift, alt) {
            (true, true) => SelectMode::Intersect,
            (true, false) => SelectMode::Add,
            (false, true) => SelectMode::Subtract,
            (false, false) => SelectMode::Replace,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Mask {
    width: u32,
    height: u32,
    cover: Vec<u8>,
    /// Bounding box of every non-zero pixel, kept current by every operation
    /// here so that `clip` is cheap and edits touch as little as possible.
    bounds: Rect,
}

impl Mask {
    pub fn new(width: u32, height: u32) -> Mask {
        Mask { width, height, cover: vec![0; (width as usize) * (height as usize)], bounds: Rect::default() }
    }

    pub fn filled(width: u32, height: u32) -> Mask {
        Mask {
            width,
            height,
            cover: vec![255; (width as usize) * (height as usize)],
            bounds: Rect::new(0, 0, width as i32, height as i32),
        }
    }

    pub fn from_rect(width: u32, height: u32, rect: Rect) -> Mask {
        let mut mask = Mask::new(width, height);
        let r = rect.intersect(&Rect::new(0, 0, width as i32, height as i32));
        let stride = width as usize;
        for y in r.y..r.bottom() {
            for x in r.x..r.right() {
                mask.cover[(y as usize) * stride + (x as usize)] = 255;
            }
        }
        mask.bounds = r;
        mask
    }

    /// Builds a mask from a per-pixel coverage function.
    pub fn from_fn(width: u32, height: u32, mut f: impl FnMut(i32, i32) -> u8) -> Mask {
        let mut mask = Mask::new(width, height);
        for y in 0..height as i32 {
            for x in 0..width as i32 {
                mask.cover[(y as usize) * (width as usize) + (x as usize)] = f(x, y);
            }
        }
        mask.recompute_bounds();
        mask
    }

    /// Wraps raw coverage. Returns None if it is not one byte per pixel.
    pub fn from_cover(width: u32, height: u32, cover: Vec<u8>) -> Option<Mask> {
        if cover.len() != (width as usize) * (height as usize) {
            return None;
        }
        let mut mask = Mask { width, height, cover, bounds: Rect::default() };
        mask.recompute_bounds();
        Some(mask)
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn size(&self) -> Rect {
        Rect::new(0, 0, self.width as i32, self.height as i32)
    }

    pub fn cover_slice(&self) -> &[u8] {
        &self.cover
    }

    fn index(&self, x: i32, y: i32) -> Option<usize> {
        if x < 0 || y < 0 || x >= self.width as i32 || y >= self.height as i32 {
            return None;
        }
        Some((y as usize) * (self.width as usize) + (x as usize))
    }

    pub fn cover(&self, x: i32, y: i32) -> u8 {
        self.index(x, y).map_or(0, |i| self.cover[i])
    }

    pub fn set(&mut self, x: i32, y: i32, cover: u8) {
        if let Some(i) = self.index(x, y) {
            self.cover[i] = cover;
        }
    }

    pub fn contains(&self, x: i32, y: i32) -> bool {
        self.cover(x, y) >= SOLID
    }

    /// The bounding box of everything selected; empty when nothing is.
    pub fn bounds(&self) -> Rect {
        self.bounds
    }

    pub fn is_empty(&self) -> bool {
        self.bounds.is_empty()
    }

    /// Whether every pixel of the document is fully selected, which is the
    /// same as having no selection at all.
    pub fn is_everything(&self) -> bool {
        self.bounds == self.size() && self.cover.iter().all(|&c| c == 255)
    }

    pub fn count(&self) -> usize {
        self.cover.iter().filter(|&&c| c >= SOLID).count()
    }

    pub fn recompute_bounds(&mut self) {
        let (mut x0, mut y0, mut x1, mut y1) = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
        for y in 0..self.height as i32 {
            for x in 0..self.width as i32 {
                if self.cover[(y as usize) * (self.width as usize) + (x as usize)] > 0 {
                    x0 = x0.min(x);
                    y0 = y0.min(y);
                    x1 = x1.max(x);
                    y1 = y1.max(y);
                }
            }
        }
        self.bounds = if x0 > x1 { Rect::default() } else { Rect::new(x0, y0, x1 - x0 + 1, y1 - y0 + 1) };
    }

    /// Combines `other` into this mask. Both must be the same size; a mask of
    /// a different size is ignored, which is what a stale selection after a
    /// canvas resize would be.
    pub fn combine(&mut self, other: &Mask, mode: SelectMode) {
        if other.width != self.width || other.height != self.height {
            return;
        }
        match mode {
            SelectMode::Replace => self.cover.copy_from_slice(&other.cover),
            SelectMode::Add => {
                for (a, b) in self.cover.iter_mut().zip(&other.cover) {
                    *a = (*a).max(*b);
                }
            }
            SelectMode::Subtract => {
                for (a, b) in self.cover.iter_mut().zip(&other.cover) {
                    *a = a.saturating_sub(*b);
                }
            }
            SelectMode::Intersect => {
                for (a, b) in self.cover.iter_mut().zip(&other.cover) {
                    *a = (*a).min(*b);
                }
            }
        }
        self.recompute_bounds();
    }

    /// The mask shifted by whole pixels; what leaves the document is lost.
    pub fn translated(&self, dx: i32, dy: i32) -> Mask {
        let mut out = Mask::new(self.width, self.height);
        let area = Rect::new(self.bounds.x + dx, self.bounds.y + dy, self.bounds.w, self.bounds.h).intersect(&self.size());
        for y in area.y..area.bottom() {
            for x in area.x..area.right() {
                out.set(x, y, self.cover(x - dx, y - dy));
            }
        }
        out.bounds = area;
        out
    }

    pub fn invert(&mut self) {
        for c in &mut self.cover {
            *c = 255 - *c;
        }
        self.recompute_bounds();
    }

    /// Squared Euclidean distance from every pixel to the nearest pixel where
    /// `inside` is false, by Felzenszwalb's transform: exact, and linear in
    /// the number of pixels rather than in the radius.
    fn distance_sq(&self, inside: impl Fn(u8) -> bool) -> Vec<f64> {
        const FAR: f64 = 1e12;
        let (w, h) = (self.width as usize, self.height as usize);
        let mut grid: Vec<f64> = self.cover.iter().map(|&c| if inside(c) { FAR } else { 0.0 }).collect();

        // One dimension at a time: columns, then rows.
        let mut f = vec![0.0; w.max(h)];
        let mut d = vec![0.0; w.max(h)];
        let mut v = vec![0usize; w.max(h)];
        let mut z = vec![0.0; w.max(h) + 1];
        for x in 0..w {
            for (y, item) in f.iter_mut().enumerate().take(h) {
                *item = grid[y * w + x];
            }
            edt_1d(&f[..h], &mut d[..h], &mut v[..h], &mut z[..=h]);
            for y in 0..h {
                grid[y * w + x] = d[y];
            }
        }
        for y in 0..h {
            f[..w].copy_from_slice(&grid[y * w..y * w + w]);
            edt_1d(&f[..w], &mut d[..w], &mut v[..w], &mut z[..=w]);
            grid[y * w..y * w + w].copy_from_slice(&d[..w]);
        }
        grid
    }

    /// Expands the selection by `radius` pixels in every direction.
    pub fn grow(&mut self, radius: u32) {
        if radius == 0 {
            return;
        }
        // Distance from outside pixels to the selection: anything within the
        // radius joins it.
        let mut inverted = self.clone();
        inverted.invert_raw();
        let dist = inverted.distance_sq(|c| c >= SOLID);
        let limit = f64::from(radius) * f64::from(radius);
        for (i, d) in dist.iter().enumerate() {
            if *d <= limit {
                self.cover[i] = 255;
            }
        }
        self.recompute_bounds();
    }

    /// Shrinks the selection by `radius` pixels.
    ///
    /// The edge of the canvas counts as an edge of the selection: contracting
    /// a select-all pulls the border in, which is what it is usually asked
    /// for.
    pub fn contract(&mut self, radius: u32) {
        if radius == 0 {
            return;
        }
        let dist = self.distance_sq(|c| c >= SOLID);
        let limit = f64::from(radius) * f64::from(radius);
        let (w, h) = (self.width as i32, self.height as i32);
        for (i, d) in dist.iter().enumerate() {
            let (x, y) = ((i % self.width as usize) as i32, (i / self.width as usize) as i32);
            let to_border = f64::from((x + 1).min(y + 1).min(w - x).min(h - y));
            if d.min(to_border * to_border) <= limit {
                self.cover[i] = 0;
            }
        }
        self.recompute_bounds();
    }

    /// Softens the edge over `radius` pixels, so an edit fades out instead of
    /// stopping dead.
    pub fn feather(&mut self, radius: u32) {
        if radius == 0 {
            return;
        }
        // Three box blurs make a close enough Gaussian, and each is O(pixels).
        // A third of the radius each, so the whole transition spans about the
        // radius asked for rather than three times it.
        let pass = ((f64::from(radius) / 3.0).round() as u32).max(1);
        for _ in 0..3 {
            self.box_blur(pass);
        }
        self.recompute_bounds();
    }

    /// Rounds off the edge: every pixel takes the majority verdict of the
    /// square around it, which shaves single-pixel spurs and fills nicks
    /// without moving a straight edge.
    pub fn smooth(&mut self, radius: u32) {
        if radius == 0 {
            return;
        }
        let (w, h) = (self.width as i32, self.height as i32);
        let sum = self.integral(|c| u32::from(c >= SOLID));
        let r = radius as i32;
        let mut out = vec![0u8; self.cover.len()];
        for y in 0..h {
            for x in 0..w {
                let x0 = (x - r).max(0);
                let y0 = (y - r).max(0);
                let x1 = (x + r + 1).min(w);
                let y1 = (y + r + 1).min(h);
                let inside = integral_sum(&sum, w, x0, y0, x1, y1);
                let area = ((x1 - x0) * (y1 - y0)) as u32;
                out[(y as usize) * (w as usize) + (x as usize)] = if inside * 2 > area { 255 } else { 0 };
            }
        }
        self.cover = out;
        self.recompute_bounds();
    }

    /// Paints a round dab of `cover` into the mask, with a one-pixel soft rim
    /// so a brushed edge is not a staircase. `cover` of 0 rubs out instead.
    pub fn stamp_disc(&mut self, centre: (f64, f64), diameter: f64, cover: u8) {
        let radius = (diameter / 2.0).max(0.5);
        let (cx, cy) = centre;
        let x0 = (cx - radius - 1.0).floor().max(0.0) as i32;
        let y0 = (cy - radius - 1.0).floor().max(0.0) as i32;
        let x1 = ((cx + radius + 1.0).ceil() as i32).min(self.width as i32);
        let y1 = ((cy + radius + 1.0).ceil() as i32).min(self.height as i32);
        for y in y0..y1 {
            for x in x0..x1 {
                let d = (f64::from(x) + 0.5 - cx).hypot(f64::from(y) + 0.5 - cy);
                // Full strength inside, fading over the last pixel.
                let strength = ((radius + 0.5 - d).clamp(0.0, 1.0) * 255.0) as u32;
                if strength == 0 {
                    continue;
                }
                let Some(i) = self.index(x, y) else { continue };
                let was = u32::from(self.cover[i]);
                let want = u32::from(cover);
                self.cover[i] = if cover == 0 {
                    // Rubbing out takes away in proportion to the strength.
                    (was * (255 - strength) / 255) as u8
                } else {
                    was.max(want * strength / 255) as u8
                };
            }
        }
        self.recompute_bounds();
    }

    /// Softens a hard edge by one pixel: every pixel takes the share of its
    /// 3x3 neighbourhood that is inside. Flat interiors and flat outsides are
    /// left exactly as they were, so only the staircase is touched. Past the
    /// edge of the document the nearest pixel stands in, so a selection that
    /// runs off the canvas does not fade out along it.
    pub fn antialias(&mut self) {
        let (w, h) = (self.width as i32, self.height as i32);
        let inside = |m: &Mask, x: i32, y: i32| u32::from(m.contains(x.clamp(0, w - 1), y.clamp(0, h - 1)));
        let mut out = self.cover.clone();
        for y in 0..h {
            for x in 0..w {
                let mut sum = 0;
                for dy in -1..=1 {
                    for dx in -1..=1 {
                        sum += inside(self, x + dx, y + dy);
                    }
                }
                if sum == 0 || sum == 9 {
                    continue;
                }
                out[(y as usize) * (self.width as usize) + (x as usize)] = (sum * 255 / 9) as u8;
            }
        }
        self.cover = out;
        self.recompute_bounds();
    }

    fn invert_raw(&mut self) {
        for c in &mut self.cover {
            *c = 255 - *c;
        }
    }

    fn integral(&self, f: impl Fn(u8) -> u32) -> Vec<u32> {
        let (w, h) = (self.width as usize, self.height as usize);
        let mut sum = vec![0u32; (w + 1) * (h + 1)];
        for y in 0..h {
            let mut row = 0;
            for x in 0..w {
                row += f(self.cover[y * w + x]);
                sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
            }
        }
        sum
    }

    fn box_blur(&mut self, radius: u32) {
        let (w, h) = (self.width as i32, self.height as i32);
        let sum = self.integral(u32::from);
        let r = radius as i32;
        let mut out = vec![0u8; self.cover.len()];
        for y in 0..h {
            for x in 0..w {
                let x0 = (x - r).max(0);
                let y0 = (y - r).max(0);
                let x1 = (x + r + 1).min(w);
                let y1 = (y + r + 1).min(h);
                let total = integral_sum(&sum, w, x0, y0, x1, y1);
                let area = ((x1 - x0) * (y1 - y0)) as u32;
                out[(y as usize) * (w as usize) + (x as usize)] = (total / area.max(1)) as u8;
            }
        }
        self.cover = out;
    }

    /// The outline of the selection as closed loops of document-space points,
    /// walking pixel boundaries — what the marching ants are drawn along.
    ///
    /// Runs of points in the same direction are merged, so a rectangular
    /// selection comes back as four corners rather than a point per pixel.
    pub fn contours(&self) -> Vec<Vec<Point>> {
        let mut edges: std::collections::HashMap<(i32, i32), Vec<(i32, i32)>> = std::collections::HashMap::new();
        let mut push = |a: (i32, i32), b: (i32, i32)| edges.entry(a).or_default().push(b);
        for y in 0..self.height as i32 {
            for x in 0..self.width as i32 {
                if !self.contains(x, y) {
                    continue;
                }
                // Each side with an unselected neighbour is a piece of the
                // outline, wound so the selected side is on the inside.
                if !self.contains(x, y - 1) {
                    push((x, y), (x + 1, y));
                }
                if !self.contains(x + 1, y) {
                    push((x + 1, y), (x + 1, y + 1));
                }
                if !self.contains(x, y + 1) {
                    push((x + 1, y + 1), (x, y + 1));
                }
                if !self.contains(x - 1, y) {
                    push((x, y + 1), (x, y));
                }
            }
        }

        let mut loops = Vec::new();
        let starts: Vec<(i32, i32)> = edges.keys().copied().collect();
        for start in starts {
            while edges.get(&start).is_some_and(|v| !v.is_empty()) {
                let mut points = vec![start];
                let mut at = start;
                while let Some(next) = edges.get_mut(&at).and_then(Vec::pop) {
                    if edges.get(&at).is_some_and(Vec::is_empty) {
                        edges.remove(&at);
                    }
                    if next == start {
                        break;
                    }
                    points.push(next);
                    at = next;
                }
                if points.len() > 2 {
                    loops.push(simplify(points));
                }
            }
        }
        loops
    }

    /// Blends `edited` back over `base` in proportion to the coverage: where
    /// the selection is solid the edit stands, where it is not the original
    /// pixels come back, and a feathered edge fades between the two.
    pub fn apply(&self, edited: &mut crate::raster::Raster, base: &crate::raster::Raster, clip: &Rect) {
        let area = self.size().intersect(&clip.intersect(&edited.bounds()));
        edited.map_at(&area, |now, x, y| {
            let cover = self.cover(x, y);
            if cover == 255 {
                return now;
            }
            base.get(x, y).lerp(now, f32::from(cover) / 255.0)
        });
    }
}

/// Felzenszwalb's 1-D squared distance transform of a sampled function.
fn edt_1d(f: &[f64], d: &mut [f64], v: &mut [usize], z: &mut [f64]) {
    let n = f.len();
    if n == 0 {
        return;
    }
    let mut k = 0usize;
    v[0] = 0;
    z[0] = f64::NEG_INFINITY;
    z[1] = f64::INFINITY;
    for q in 1..n {
        let mut s;
        loop {
            let r = v[k];
            s = ((f[q] + (q * q) as f64) - (f[r] + (r * r) as f64)) / (2.0 * q as f64 - 2.0 * r as f64);
            if s <= z[k] && k > 0 {
                k -= 1;
            } else {
                break;
            }
        }
        k += 1;
        v[k] = q;
        z[k] = s;
        z[k + 1] = f64::INFINITY;
    }
    let mut k = 0usize;
    for (q, out) in d.iter_mut().enumerate().take(n) {
        while z[k + 1] < q as f64 {
            k += 1;
        }
        let vk = v[k];
        *out = ((q as f64 - vk as f64) * (q as f64 - vk as f64)) + f[vk];
    }
}

fn integral_sum(sum: &[u32], w: i32, x0: i32, y0: i32, x1: i32, y1: i32) -> u32 {
    let stride = (w + 1) as usize;
    let at = |x: i32, y: i32| sum[(y as usize) * stride + x as usize];
    at(x1, y1) + at(x0, y0) - at(x1, y0) - at(x0, y1)
}

/// Drops the points in the middle of a straight run.
fn simplify(points: Vec<(i32, i32)>) -> Vec<Point> {
    let n = points.len();
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let prev = points[(i + n - 1) % n];
        let here = points[i];
        let next = points[(i + 1) % n];
        let straight = (here.0 - prev.0) * (next.1 - here.1) == (here.1 - prev.1) * (next.0 - here.0);
        if !straight {
            out.push(Point::new(f64::from(here.0), f64::from(here.1)));
        }
    }
    if out.is_empty() {
        out = points.iter().map(|p| Point::new(f64::from(p.0), f64::from(p.1))).collect();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::Rgba;
    use crate::raster::Raster;

    fn rect_mask() -> Mask {
        Mask::from_rect(10, 10, Rect::new(2, 2, 4, 4))
    }

    #[test]
    fn a_rect_mask_knows_what_it_covers() {
        let m = rect_mask();
        assert!(m.contains(2, 2) && m.contains(5, 5));
        assert!(!m.contains(1, 2) && !m.contains(6, 6));
        assert_eq!(m.bounds(), Rect::new(2, 2, 4, 4));
        assert_eq!(m.count(), 16);
        assert!(!m.is_empty());
    }

    #[test]
    fn modes_combine_two_masks() {
        let a = Mask::from_rect(10, 10, Rect::new(0, 0, 4, 4));
        let b = Mask::from_rect(10, 10, Rect::new(2, 0, 4, 4));

        let mut add = a.clone();
        add.combine(&b, SelectMode::Add);
        assert_eq!(add.count(), 24);
        assert_eq!(add.bounds(), Rect::new(0, 0, 6, 4));

        let mut sub = a.clone();
        sub.combine(&b, SelectMode::Subtract);
        assert_eq!(sub.count(), 8);
        assert!(!sub.contains(2, 0) && sub.contains(1, 0));

        let mut and = a.clone();
        and.combine(&b, SelectMode::Intersect);
        assert_eq!(and.bounds(), Rect::new(2, 0, 2, 4));

        let mut replace = a.clone();
        replace.combine(&b, SelectMode::Replace);
        assert_eq!(replace.bounds(), b.bounds());
    }

    #[test]
    fn modifiers_name_the_modes() {
        assert_eq!(SelectMode::from_modifiers(false, false), SelectMode::Replace);
        assert_eq!(SelectMode::from_modifiers(true, false), SelectMode::Add);
        assert_eq!(SelectMode::from_modifiers(false, true), SelectMode::Subtract);
        assert_eq!(SelectMode::from_modifiers(true, true), SelectMode::Intersect);
    }

    #[test]
    fn inverting_swaps_inside_and_out() {
        let mut m = rect_mask();
        m.invert();
        assert!(!m.contains(3, 3));
        assert!(m.contains(0, 0));
        assert_eq!(m.bounds(), Rect::new(0, 0, 10, 10));
    }

    #[test]
    fn growing_and_contracting_move_the_edge_by_the_radius() {
        let mut m = rect_mask();
        m.grow(2);
        assert_eq!(m.bounds(), Rect::new(0, 0, 8, 8));
        assert!(m.contains(0, 2), "straight out from the edge");
        assert!(!m.contains(0, 0), "but the corner is further than two away");

        let mut m = rect_mask();
        m.contract(1);
        assert_eq!(m.bounds(), Rect::new(3, 3, 2, 2));

        let mut m = rect_mask();
        m.contract(9);
        assert!(m.is_empty(), "contracting past the middle deselects");

        // The canvas edge is an edge too: contracting everything pulls in.
        let mut m = Mask::filled(10, 10);
        m.contract(2);
        assert_eq!(m.bounds(), Rect::new(2, 2, 6, 6));
    }

    #[test]
    fn feathering_fades_the_edge_without_a_hard_stop() {
        let mut m = Mask::from_rect(20, 20, Rect::new(5, 5, 10, 10));
        m.feather(3);
        assert_eq!(m.cover(10, 10), 255, "the middle is untouched");
        let edge = m.cover(5, 10);
        assert!(edge > 0 && edge < 255, "the edge is partial: {edge}");
        assert!(m.cover(3, 10) > 0, "and it reaches outside the old edge");
    }

    #[test]
    fn smoothing_takes_off_a_spur_and_fills_a_nick() {
        let mut m = Mask::from_rect(20, 20, Rect::new(4, 4, 10, 10));
        m.set(2, 9, 255); // a spur hanging off the side
        m.set(8, 8, 0); // a hole in the middle
        m.recompute_bounds();
        m.smooth(2);
        assert!(!m.contains(2, 9), "the spur is outvoted");
        assert!(m.contains(8, 8), "the hole is filled in");
        assert!(m.contains(9, 9));
    }

    #[test]
    fn a_dab_adds_a_round_patch_with_a_soft_rim() {
        let mut m = Mask::new(20, 20);
        m.stamp_disc((10.0, 10.0), 8.0, 255);
        assert_eq!(m.cover(10, 10), 255, "the middle of the dab");
        assert_eq!(m.cover(2, 2), 0, "and nothing in the corner");
        let rim = m.cover(6, 10);
        assert!(rim > 0 && rim < 255, "the rim is partial: {rim}");
        // A dab of 8 across, centred on a pixel boundary: eight pixels wide.
        assert_eq!(m.bounds(), Rect::new(6, 6, 8, 8));
    }

    #[test]
    fn a_dab_of_nothing_rubs_out_what_was_there() {
        let mut m = Mask::from_rect(20, 20, Rect::new(0, 0, 20, 20));
        m.stamp_disc((10.0, 10.0), 8.0, 0);
        assert_eq!(m.cover(10, 10), 0, "rubbed out");
        assert_eq!(m.cover(2, 2), 255, "away from the dab, untouched");
    }

    #[test]
    fn dabs_build_up_rather_than_cutting_each_other_out() {
        let mut m = Mask::new(20, 20);
        m.stamp_disc((8.0, 10.0), 6.0, 255);
        m.stamp_disc((12.0, 10.0), 6.0, 255);
        assert_eq!(m.cover(8, 10), 255);
        assert_eq!(m.cover(12, 10), 255);
        assert_eq!(m.cover(10, 10), 255, "the overlap stays solid");
    }

    #[test]
    fn antialiasing_only_touches_the_staircase() {
        let mut m = Mask::from_rect(10, 10, Rect::new(2, 2, 6, 6));
        m.antialias();
        assert_eq!(m.cover(5, 5), 255, "the middle is left alone");
        assert_eq!(m.cover(0, 0), 0, "and so is the far outside");
        assert!(m.cover(2, 2) < 255 && m.cover(2, 2) > 0, "the corner is softened");
        assert!(m.cover(1, 5) > 0, "and the edge bleeds one pixel out");
    }

    #[test]
    fn a_rectangle_traces_as_one_loop_of_four_corners() {
        let loops = rect_mask().contours();
        assert_eq!(loops.len(), 1);
        let mut corners: Vec<(i32, i32)> = loops[0].iter().map(|p| (p.x as i32, p.y as i32)).collect();
        corners.sort();
        assert_eq!(corners, vec![(2, 2), (2, 6), (6, 2), (6, 6)]);
    }

    #[test]
    fn two_islands_trace_as_two_loops() {
        let mut m = Mask::from_rect(20, 20, Rect::new(1, 1, 3, 3));
        let other = Mask::from_rect(20, 20, Rect::new(10, 10, 3, 3));
        m.combine(&other, SelectMode::Add);
        assert_eq!(m.contours().len(), 2);
    }

    #[test]
    fn a_hole_traces_as_its_own_loop() {
        let mut m = Mask::from_rect(20, 20, Rect::new(2, 2, 10, 10));
        m.set(6, 6, 0);
        m.recompute_bounds();
        assert_eq!(m.contours().len(), 2, "the outside and the hole");
    }

    #[test]
    fn nothing_selected_traces_nothing() {
        assert!(Mask::new(8, 8).contours().is_empty());
    }

    #[test]
    fn applying_puts_back_what_was_outside_and_fades_the_edge() {
        let base = Raster::filled(4, 1, Rgba::WHITE);
        let mut edited = Raster::filled(4, 1, Rgba::BLACK);
        let mask = Mask::from_fn(4, 1, |x, _| match x {
            0 => 255,
            1 => 128,
            _ => 0,
        });
        let all = edited.bounds();
        mask.apply(&mut edited, &base, &all);
        assert_eq!(edited.get(0, 0), Rgba::BLACK, "fully selected: the edit stands");
        assert_eq!(edited.get(2, 0), Rgba::WHITE, "outside: the original comes back");
        let half = edited.get(1, 0);
        assert!(half.r > 100 && half.r < 160, "half covered, half the edit: {half:?}");
    }

    #[test]
    fn everything_selected_is_recognised_as_no_selection() {
        assert!(Mask::filled(4, 4).is_everything());
        assert!(!Mask::from_rect(4, 4, Rect::new(0, 0, 4, 3)).is_everything());
    }
}
