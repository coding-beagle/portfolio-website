//! A rectangular buffer of pixels and the primitive operations on it.
//!
//! Every drawing operation takes a `clip` rectangle and touches nothing
//! outside it. Callers pass the intersection of the buffer bounds and the
//! current selection, which is how selections constrain painting without any
//! tool needing to know about them.

use crate::color::Rgba;
use crate::geometry::{Point, Rect};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Raster {
    width: u32,
    height: u32,
    pixels: Vec<Rgba>,
}

impl Raster {
    /// A fully transparent buffer.
    pub fn new(width: u32, height: u32) -> Raster {
        Raster::filled(width, height, Rgba::TRANSPARENT)
    }

    pub fn filled(width: u32, height: u32, color: Rgba) -> Raster {
        Raster {
            width,
            height,
            pixels: vec![color; (width as usize) * (height as usize)],
        }
    }

    /// Builds a raster from straight-alpha RGBA bytes, as `ImageData` holds
    /// them. Returns `None` if the byte count does not match the size.
    pub fn from_rgba_bytes(width: u32, height: u32, bytes: &[u8]) -> Option<Raster> {
        if bytes.len() != (width as usize) * (height as usize) * 4 {
            return None;
        }
        let (chunks, _) = bytes.as_chunks::<4>();
        let pixels = chunks.iter().map(|p| Rgba::new(p[0], p[1], p[2], p[3])).collect();
        Some(Raster { width, height, pixels })
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn bounds(&self) -> Rect {
        Rect::new(0, 0, self.width as i32, self.height as i32)
    }

    pub fn pixels(&self) -> &[Rgba] {
        &self.pixels
    }

    fn index(&self, x: i32, y: i32) -> Option<usize> {
        if x < 0 || y < 0 || x >= self.width as i32 || y >= self.height as i32 {
            None
        } else {
            Some(y as usize * self.width as usize + x as usize)
        }
    }

    /// The pixel at `(x, y)`, or transparent if that is off the buffer.
    pub fn get(&self, x: i32, y: i32) -> Rgba {
        self.index(x, y).map_or(Rgba::TRANSPARENT, |i| self.pixels[i])
    }

    /// Overwrites a pixel outright; off-buffer coordinates are ignored.
    pub fn set(&mut self, x: i32, y: i32, color: Rgba) {
        if let Some(i) = self.index(x, y) {
            self.pixels[i] = color;
        }
    }

    /// Composites `color` over the pixel at `(x, y)` if it is inside `clip`.
    pub fn blend(&mut self, x: i32, y: i32, color: Rgba, clip: &Rect) {
        if !clip.contains(x, y) {
            return;
        }
        if let Some(i) = self.index(x, y) {
            self.pixels[i] = color.over(self.pixels[i]);
        }
    }

    /// Erases a pixel to transparent if it is inside `clip`. `strength` is how
    /// much of the alpha to remove, `0.0..=1.0`.
    pub fn erase(&mut self, x: i32, y: i32, strength: f32, clip: &Rect) {
        if !clip.contains(x, y) {
            return;
        }
        if let Some(i) = self.index(x, y) {
            let p = self.pixels[i];
            self.pixels[i] = p.scaled_alpha(1.0 - strength);
        }
    }

    /// Writes every pixel of the buffer as straight-alpha RGBA bytes into
    /// `out`, which must hold `width * height * 4` bytes.
    pub fn write_rgba_bytes(&self, out: &mut [u8]) {
        debug_assert_eq!(out.len(), self.pixels.len() * 4);
        let (chunks, _) = out.as_chunks_mut::<4>();
        for (dst, px) in chunks.iter_mut().zip(&self.pixels) {
            *dst = [px.r, px.g, px.b, px.a];
        }
    }

    pub fn to_rgba_bytes(&self) -> Vec<u8> {
        let mut out = vec![0; self.pixels.len() * 4];
        self.write_rgba_bytes(&mut out);
        out
    }

    /// Composites every pixel of `src` over `self`, with `src` scaled by
    /// `opacity`. The two must be the same size.
    pub fn composite_over(&mut self, src: &Raster, opacity: f32) {
        debug_assert_eq!((self.width, self.height), (src.width, src.height));
        if opacity <= 0.0 {
            return;
        }
        for (dst, s) in self.pixels.iter_mut().zip(&src.pixels) {
            if s.a == 0 {
                continue;
            }
            let s = if opacity >= 1.0 { *s } else { s.scaled_alpha(opacity) };
            *dst = s.over(*dst);
        }
    }

    // ---- Primitives -------------------------------------------------------

    /// Applies `f` to every pixel of `rect ∩ clip`. The workhorse behind the
    /// filled shapes.
    fn for_each_in(&mut self, rect: Rect, clip: &Rect, mut f: impl FnMut(&mut Raster, i32, i32)) {
        let r = rect.intersect(clip).intersect(&self.bounds());
        for y in r.y..r.bottom() {
            for x in r.x..r.right() {
                f(self, x, y);
            }
        }
    }

    pub fn fill_rect(&mut self, rect: Rect, color: Rgba, clip: &Rect) {
        let r = rect.intersect(clip).intersect(&self.bounds());
        for y in r.y..r.bottom() {
            for x in r.x..r.right() {
                let i = y as usize * self.width as usize + x as usize;
                self.pixels[i] = color.over(self.pixels[i]);
            }
        }
    }

    /// Draws the outline of `rect`, `thickness` pixels wide, growing inward.
    pub fn stroke_rect(&mut self, rect: Rect, thickness: u32, color: Rgba, clip: &Rect) {
        if rect.is_empty() {
            return;
        }
        let t = thickness as i32;
        let inner = Rect::new(rect.x + t, rect.y + t, rect.w - 2 * t, rect.h - 2 * t);
        if inner.is_empty() {
            self.fill_rect(rect, color, clip);
            return;
        }
        self.for_each_in(rect, clip, |r, x, y| {
            if !inner.contains(x, y) {
                let i = y as usize * r.width as usize + x as usize;
                r.pixels[i] = color.over(r.pixels[i]);
            }
        });
    }

    /// Fills the ellipse inscribed in `rect`.
    pub fn fill_ellipse(&mut self, rect: Rect, color: Rgba, clip: &Rect) {
        if rect.is_empty() {
            return;
        }
        let inside = ellipse_test(rect);
        self.for_each_in(rect, clip, |r, x, y| {
            if inside(x, y) {
                let i = y as usize * r.width as usize + x as usize;
                r.pixels[i] = color.over(r.pixels[i]);
            }
        });
    }

    /// Draws the outline of the ellipse inscribed in `rect`, `thickness`
    /// pixels wide, growing inward.
    pub fn stroke_ellipse(&mut self, rect: Rect, thickness: u32, color: Rgba, clip: &Rect) {
        if rect.is_empty() {
            return;
        }
        let t = thickness as i32;
        let inner_rect = Rect::new(rect.x + t, rect.y + t, rect.w - 2 * t, rect.h - 2 * t);
        if inner_rect.is_empty() {
            self.fill_ellipse(rect, color, clip);
            return;
        }
        let outer = ellipse_test(rect);
        let inner = ellipse_test(inner_rect);
        self.for_each_in(rect, clip, |r, x, y| {
            if outer(x, y) && !inner(x, y) {
                let i = y as usize * r.width as usize + x as usize;
                r.pixels[i] = color.over(r.pixels[i]);
            }
        });
    }

    /// Composites a filled disc of `diameter` pixels centred on `center`.
    ///
    /// A diameter of 1 is a single pixel, which is what a pencil wants. Larger
    /// discs are centred on the pixel grid so a stroke does not wobble as the
    /// pointer crosses pixel boundaries.
    pub fn stamp_disc(&mut self, center: Point, diameter: u32, color: Rgba, clip: &Rect) {
        self.stamp(center, diameter, clip, |r, x, y| r.blend(x, y, color, clip));
    }

    /// Like [`Raster::stamp_disc`], but erasing instead of painting.
    pub fn erase_disc(&mut self, center: Point, diameter: u32, strength: f32, clip: &Rect) {
        self.stamp(center, diameter, clip, |r, x, y| r.erase(x, y, strength, clip));
    }

    fn stamp(&mut self, center: Point, diameter: u32, clip: &Rect, mut f: impl FnMut(&mut Raster, i32, i32)) {
        let (cx, cy) = center.round();
        if diameter <= 1 {
            f(self, cx, cy);
            return;
        }
        let d = diameter as i32;
        let rect = Rect::new(cx - d / 2, cy - d / 2, d, d);
        let inside = ellipse_test(rect);
        self.for_each_in(rect, clip, |r, x, y| {
            if inside(x, y) {
                f(r, x, y);
            }
        });
    }

    /// Stamps `stamp` at every pixel step along the segment from `a` to `b`
    /// (Bresenham), including both ends. Used for brush strokes and lines.
    pub fn stamp_along(&mut self, a: Point, b: Point, mut stamp: impl FnMut(&mut Raster, Point)) {
        let (x0, y0) = a.round();
        let (x1, y1) = b.round();
        let dx = (x1 - x0).abs();
        let dy = -(y1 - y0).abs();
        let sx = if x0 < x1 { 1 } else { -1 };
        let sy = if y0 < y1 { 1 } else { -1 };
        let mut err = dx + dy;
        let (mut x, mut y) = (x0, y0);
        loop {
            stamp(self, Point::new(f64::from(x), f64::from(y)));
            if x == x1 && y == y1 {
                break;
            }
            let e2 = 2 * err;
            if e2 >= dy {
                err += dy;
                x += sx;
            }
            if e2 <= dx {
                err += dx;
                y += sy;
            }
        }
    }

    // ---- Whole-buffer operations ----------------------------------------------

    /// Applies `f` to every pixel inside `clip`, in place.
    pub fn map_in(&mut self, clip: &Rect, mut f: impl FnMut(Rgba) -> Rgba) {
        let r = clip.intersect(&self.bounds());
        for y in r.y..r.bottom() {
            let row = y as usize * self.width as usize;
            for x in r.x..r.right() {
                let i = row + x as usize;
                self.pixels[i] = f(self.pixels[i]);
            }
        }
    }

    /// The smallest rect containing every pixel with any alpha, or `None`
    /// for an empty buffer.
    pub fn content_bounds(&self) -> Option<Rect> {
        let (mut x0, mut y0, mut x1, mut y1) = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
        for y in 0..self.height as i32 {
            for x in 0..self.width as i32 {
                if self.get(x, y).a > 0 {
                    x0 = x0.min(x);
                    y0 = y0.min(y);
                    x1 = x1.max(x);
                    y1 = y1.max(y);
                }
            }
        }
        (x0 <= x1).then(|| Rect::new(x0, y0, x1 - x0 + 1, y1 - y0 + 1))
    }

    /// Splits the buffer into the pixels inside `clip` and the pixels outside
    /// it, each as a full-size buffer with the rest transparent. This is how
    /// a transform moves only the selected pixels.
    pub fn split(&self, clip: &Rect) -> (Raster, Raster) {
        let mut inside = Raster::new(self.width, self.height);
        let mut outside = self.clone();
        let r = clip.intersect(&self.bounds());
        for y in r.y..r.bottom() {
            for x in r.x..r.right() {
                inside.set(x, y, self.get(x, y));
                outside.set(x, y, Rgba::TRANSPARENT);
            }
        }
        (inside, outside)
    }

    /// The buffer shifted by whole pixels; what falls off the edge is lost.
    pub fn translated(&self, dx: i32, dy: i32) -> Raster {
        let mut out = Raster::new(self.width, self.height);
        for y in 0..self.height as i32 {
            for x in 0..self.width as i32 {
                let p = self.get(x - dx, y - dy);
                if p.a > 0 {
                    out.set(x, y, p);
                }
            }
        }
        out
    }

    pub fn flipped_horizontal(&self) -> Raster {
        let w = self.width as i32;
        let mut out = Raster::new(self.width, self.height);
        for y in 0..self.height as i32 {
            for x in 0..w {
                out.set(w - 1 - x, y, self.get(x, y));
            }
        }
        out
    }

    pub fn flipped_vertical(&self) -> Raster {
        let h = self.height as i32;
        let mut out = Raster::new(self.width, self.height);
        for y in 0..h {
            for x in 0..self.width as i32 {
                out.set(x, h - 1 - y, self.get(x, y));
            }
        }
        out
    }

    /// Rotated by `turns` quarter turns clockwise, exactly. Odd turns swap
    /// the width and height.
    pub fn rotated_quarter(&self, turns: i32) -> Raster {
        let turns = turns.rem_euclid(4);
        let (w, h) = (self.width as i32, self.height as i32);
        match turns {
            0 => self.clone(),
            1 => {
                let mut out = Raster::new(self.height, self.width);
                for y in 0..h {
                    for x in 0..w {
                        out.set(h - 1 - y, x, self.get(x, y));
                    }
                }
                out
            }
            2 => {
                let mut out = Raster::new(self.width, self.height);
                for y in 0..h {
                    for x in 0..w {
                        out.set(w - 1 - x, h - 1 - y, self.get(x, y));
                    }
                }
                out
            }
            _ => {
                let mut out = Raster::new(self.height, self.width);
                for y in 0..h {
                    for x in 0..w {
                        out.set(y, w - 1 - x, self.get(x, y));
                    }
                }
                out
            }
        }
    }

    /// This buffer placed centred in a new one of `width` by `height`,
    /// cropped or padded as needed.
    pub fn recentred(&self, width: u32, height: u32) -> Raster {
        let mut out = Raster::new(width, height);
        let dx = (width as i32 - self.width as i32) / 2;
        let dy = (height as i32 - self.height as i32) / 2;
        for y in 0..self.height as i32 {
            for x in 0..self.width as i32 {
                out.set(x + dx, y + dy, self.get(x, y));
            }
        }
        out
    }

    /// The buffer in a canvas of a new size, with the old content placed at
    /// `(dx, dy)`. Padding is transparent; anything outside is lost. This is
    /// what resizing the canvas by dragging an edge needs — `recentred` only
    /// knows how to grow about the middle.
    pub fn resized(&self, width: u32, height: u32, dx: i32, dy: i32) -> Raster {
        let mut out = Raster::new(width, height);
        for y in 0..self.height as i32 {
            for x in 0..self.width as i32 {
                out.set(x + dx, y + dy, self.get(x, y));
            }
        }
        out
    }

    /// Composites `other` over `self` at full opacity, in place.
    pub fn merge_over(&mut self, other: &Raster) {
        self.composite_over(other, 1.0);
    }

    /// A line from `a` to `b` of the given `thickness`.
    ///
    /// Each step overwrites rather than blends where discs overlap, so a
    /// translucent line has uniform alpha instead of dark bands.
    pub fn draw_line(&mut self, a: Point, b: Point, thickness: u32, color: Rgba, clip: &Rect) {
        let mut covered = Raster::new(self.width, self.height);
        let all = covered.bounds();
        covered.stamp_along(a, b, |r, p| r.stamp_disc(p, thickness, Rgba::WHITE, &all));
        for y in 0..self.height as i32 {
            for x in 0..self.width as i32 {
                if covered.get(x, y).a > 0 {
                    self.blend(x, y, color, clip);
                }
            }
        }
    }
}

/// A predicate for "is this pixel centre inside the ellipse inscribed in
/// `rect`". Pixel centres are at `+0.5`, which is what keeps a 1x1 rect a
/// single pixel and a 2x2 rect all four.
fn ellipse_test(rect: Rect) -> impl Fn(i32, i32) -> bool {
    let cx = f64::from(rect.x) + f64::from(rect.w) / 2.0;
    let cy = f64::from(rect.y) + f64::from(rect.h) / 2.0;
    let rx = f64::from(rect.w) / 2.0;
    let ry = f64::from(rect.h) / 2.0;
    move |x, y| {
        let dx = (f64::from(x) + 0.5 - cx) / rx;
        let dy = (f64::from(y) + 0.5 - cy) / ry;
        dx * dx + dy * dy <= 1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: Rgba = Rgba::opaque(255, 0, 0);

    fn count(r: &Raster, color: Rgba) -> usize {
        r.pixels().iter().filter(|p| **p == color).count()
    }

    #[test]
    fn new_raster_is_transparent() {
        let r = Raster::new(3, 2);
        assert_eq!(r.pixels().len(), 6);
        assert!(r.pixels().iter().all(|p| *p == Rgba::TRANSPARENT));
    }

    #[test]
    fn get_and_set_ignore_out_of_bounds() {
        let mut r = Raster::new(2, 2);
        r.set(5, 5, RED);
        r.set(-1, 0, RED);
        assert_eq!(count(&r, RED), 0);
        assert_eq!(r.get(9, 9), Rgba::TRANSPARENT);
        r.set(1, 1, RED);
        assert_eq!(r.get(1, 1), RED);
    }

    #[test]
    fn bytes_round_trip() {
        let mut r = Raster::new(2, 1);
        r.set(0, 0, Rgba::new(1, 2, 3, 4));
        r.set(1, 0, Rgba::new(5, 6, 7, 8));
        let bytes = r.to_rgba_bytes();
        assert_eq!(bytes, vec![1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(Raster::from_rgba_bytes(2, 1, &bytes), Some(r));
        assert_eq!(Raster::from_rgba_bytes(2, 2, &bytes), None);
    }

    #[test]
    fn fill_rect_clips_to_the_clip_and_the_buffer() {
        let mut r = Raster::new(4, 4);
        let clip = Rect::new(1, 1, 2, 2);
        r.fill_rect(Rect::new(-5, -5, 20, 20), RED, &clip);
        assert_eq!(count(&r, RED), 4);
        assert_eq!(r.get(1, 1), RED);
        assert_eq!(r.get(0, 0), Rgba::TRANSPARENT);
        assert_eq!(r.get(3, 3), Rgba::TRANSPARENT);
    }

    #[test]
    fn stroke_rect_leaves_the_middle_alone() {
        let mut r = Raster::new(5, 5);
        let all = r.bounds();
        r.stroke_rect(Rect::new(0, 0, 5, 5), 1, RED, &all);
        assert_eq!(count(&r, RED), 16);
        assert_eq!(r.get(2, 2), Rgba::TRANSPARENT);
        assert_eq!(r.get(0, 4), RED);
    }

    #[test]
    fn thick_stroke_on_a_small_rect_fills_it() {
        let mut r = Raster::new(5, 5);
        let all = r.bounds();
        r.stroke_rect(Rect::new(1, 1, 3, 3), 5, RED, &all);
        assert_eq!(count(&r, RED), 9);
    }

    #[test]
    fn ellipse_in_a_square_is_a_disc() {
        let mut r = Raster::new(7, 7);
        let all = r.bounds();
        r.fill_ellipse(Rect::new(0, 0, 7, 7), RED, &all);
        assert_eq!(r.get(3, 3), RED, "centre");
        assert_eq!(r.get(3, 0), RED, "top of the disc");
        assert_eq!(r.get(0, 0), Rgba::TRANSPARENT, "corner");
        let n = count(&r, RED);
        assert!((30..=40).contains(&n), "a 7px disc covers ~38 pixels, got {n}");
    }

    #[test]
    fn tiny_ellipses_still_draw() {
        let mut r = Raster::new(3, 3);
        let all = r.bounds();
        r.fill_ellipse(Rect::new(1, 1, 1, 1), RED, &all);
        assert_eq!(count(&r, RED), 1);
        let mut r = Raster::new(3, 3);
        r.fill_ellipse(Rect::new(0, 0, 2, 2), RED, &all);
        assert_eq!(count(&r, RED), 4);
    }

    #[test]
    fn stroked_ellipse_is_hollow() {
        let mut r = Raster::new(9, 9);
        let all = r.bounds();
        r.stroke_ellipse(Rect::new(0, 0, 9, 9), 1, RED, &all);
        assert_eq!(r.get(4, 4), Rgba::TRANSPARENT);
        assert_eq!(r.get(4, 0), RED);
        assert_eq!(r.get(0, 4), RED);
    }

    #[test]
    fn one_pixel_disc_is_one_pixel() {
        let mut r = Raster::new(5, 5);
        let all = r.bounds();
        r.stamp_disc(Point::new(2.7, 2.2), 1, RED, &all);
        assert_eq!(count(&r, RED), 1);
        assert_eq!(r.get(2, 2), RED);
    }

    #[test]
    fn disc_respects_the_clip() {
        let mut r = Raster::new(9, 9);
        r.stamp_disc(Point::new(4.0, 4.0), 7, RED, &Rect::new(0, 0, 4, 9));
        assert!(count(&r, RED) > 0);
        for y in 0..9 {
            for x in 4..9 {
                assert_eq!(r.get(x, y), Rgba::TRANSPARENT, "({x},{y}) is outside the clip");
            }
        }
    }

    #[test]
    fn erase_disc_removes_alpha() {
        let mut r = Raster::filled(3, 3, RED);
        let all = r.bounds();
        r.erase_disc(Point::new(1.0, 1.0), 1, 1.0, &all);
        assert_eq!(r.get(1, 1).a, 0);
        assert_eq!(r.get(0, 0), RED);
        r.erase_disc(Point::new(0.0, 0.0), 1, 0.5, &all);
        assert_eq!(r.get(0, 0).a, 128);
    }

    #[test]
    fn line_visits_every_column_of_a_shallow_slope() {
        let mut r = Raster::new(10, 4);
        let all = r.bounds();
        r.draw_line(Point::new(0.0, 0.0), Point::new(9.0, 2.0), 1, RED, &all);
        for x in 0..10 {
            assert!((0..4).any(|y| r.get(x, y) == RED), "column {x} is empty");
        }
        assert_eq!(r.get(0, 0), RED);
        assert_eq!(r.get(9, 2), RED);
    }

    #[test]
    fn line_direction_does_not_matter() {
        let all = Rect::new(0, 0, 8, 8);
        let mut a = Raster::new(8, 8);
        let mut b = Raster::new(8, 8);
        a.draw_line(Point::new(1.0, 6.0), Point::new(6.0, 1.0), 1, RED, &all);
        b.draw_line(Point::new(6.0, 1.0), Point::new(1.0, 6.0), 1, RED, &all);
        assert_eq!(a, b);
    }

    #[test]
    fn translucent_line_has_uniform_alpha() {
        let mut r = Raster::new(20, 5);
        let all = r.bounds();
        let half = Rgba::new(0, 0, 255, 100);
        r.draw_line(Point::new(0.0, 2.0), Point::new(19.0, 2.0), 3, half, &all);
        let alphas: Vec<u8> = (0..20).map(|x| r.get(x, 2).a).collect();
        assert!(alphas.iter().all(|a| *a == 100), "got {alphas:?}");
    }

    #[test]
    fn content_bounds_finds_the_painted_area() {
        let mut r = Raster::new(10, 10);
        assert_eq!(r.content_bounds(), None);
        r.set(3, 4, RED);
        r.set(7, 5, Rgba::new(0, 0, 0, 1));
        assert_eq!(r.content_bounds(), Some(Rect::new(3, 4, 5, 2)));
    }

    #[test]
    fn split_partitions_the_pixels() {
        let r = Raster::filled(4, 4, RED);
        let (inside, outside) = r.split(&Rect::new(0, 0, 2, 4));
        assert_eq!(count(&inside, RED), 8);
        assert_eq!(count(&outside, RED), 8);
        assert_eq!(inside.get(0, 0), RED);
        assert_eq!(outside.get(0, 0), Rgba::TRANSPARENT);
        let mut back = outside.clone();
        back.merge_over(&inside);
        assert_eq!(back, r);
    }

    #[test]
    fn translated_moves_and_drops_the_overflow() {
        let mut r = Raster::new(3, 3);
        r.set(0, 0, RED);
        r.set(2, 2, Rgba::BLACK);
        let t = r.translated(1, 1);
        assert_eq!(t.get(1, 1), RED);
        assert_eq!(count(&t, Rgba::BLACK), 0);
        assert_eq!(t.get(0, 0), Rgba::TRANSPARENT);
    }

    #[test]
    fn flips_mirror_exactly() {
        let mut r = Raster::new(3, 2);
        r.set(0, 0, RED);
        assert_eq!(r.flipped_horizontal().get(2, 0), RED);
        assert_eq!(r.flipped_vertical().get(0, 1), RED);
        assert_eq!(r.flipped_horizontal().flipped_horizontal(), r);
    }

    #[test]
    fn quarter_rotations_are_exact_and_compose() {
        let mut r = Raster::new(3, 2);
        r.set(0, 0, RED); // top-left
        let cw = r.rotated_quarter(1);
        assert_eq!((cw.width(), cw.height()), (2, 3));
        assert_eq!(cw.get(1, 0), RED, "top-left goes to top-right");
        let ccw = r.rotated_quarter(-1);
        assert_eq!(ccw.get(0, 2), RED, "top-left goes to bottom-left");
        assert_eq!(r.rotated_quarter(2).get(2, 1), RED);
        assert_eq!(r.rotated_quarter(1).rotated_quarter(3), r);
        assert_eq!(r.rotated_quarter(4), r);
    }

    #[test]
    fn recentred_pads_and_crops_about_the_middle() {
        let r = Raster::filled(2, 2, RED);
        let big = r.recentred(4, 4);
        assert_eq!(count(&big, RED), 4);
        assert_eq!(big.get(1, 1), RED);
        assert_eq!(big.get(0, 0), Rgba::TRANSPARENT);
        let small = big.recentred(2, 2);
        assert_eq!(small, r);
    }

    #[test]
    fn resizing_places_the_old_content_where_it_is_told() {
        let r = Raster::filled(2, 2, RED);
        let wider = r.resized(4, 2, 2, 0);
        assert_eq!(wider.get(2, 0), RED);
        assert_eq!(wider.get(0, 0), Rgba::TRANSPARENT);
        assert_eq!(count(&wider, RED), 4);
        // Cropping keeps only what still fits.
        let cropped = r.resized(1, 2, 0, 0);
        assert_eq!(count(&cropped, RED), 2);
    }

    #[test]
    fn map_in_only_touches_the_clip() {
        let mut r = Raster::filled(3, 3, RED);
        r.map_in(&Rect::new(1, 1, 1, 1), |_| Rgba::BLACK);
        assert_eq!(count(&r, Rgba::BLACK), 1);
        assert_eq!(r.get(1, 1), Rgba::BLACK);
    }

    #[test]
    fn composite_over_honours_opacity() {
        let mut bottom = Raster::filled(1, 1, Rgba::WHITE);
        let top = Raster::filled(1, 1, Rgba::BLACK);
        bottom.composite_over(&top, 0.0);
        assert_eq!(bottom.get(0, 0), Rgba::WHITE);
        bottom.composite_over(&top, 1.0);
        assert_eq!(bottom.get(0, 0), Rgba::BLACK);
        let mut bottom = Raster::filled(1, 1, Rgba::WHITE);
        bottom.composite_over(&top, 0.5);
        assert!((bottom.get(0, 0).r as i32 - 127).abs() <= 1);
    }
}
