//! Points and rectangles.

/// A position in document space. Fractional so that a pointer can be in the
/// middle of a pixel when zoomed in; rasterising rounds as it sees fit.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub const fn new(x: f64, y: f64) -> Point {
        Point { x, y }
    }

    pub fn distance_to(self, other: Point) -> f64 {
        (self.x - other.x).hypot(self.y - other.y)
    }

    /// The nearest pixel to this point.
    pub fn round(self) -> (i32, i32) {
        (self.x.floor() as i32, self.y.floor() as i32)
    }
}

/// A size in screen (CSS) pixels. Fractional, like [`Point`], because a
/// window is not measured in document pixels.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Size {
    pub w: f64,
    pub h: f64,
}

impl Size {
    pub const fn new(w: f64, h: f64) -> Size {
        Size { w, h }
    }

    /// Whether the size is too small to map anything into.
    pub fn is_empty(self) -> bool {
        self.w <= 0.0 || self.h <= 0.0
    }
}

/// An axis-aligned rectangle of whole pixels. `w` and `h` are never negative;
/// an empty rect has an area of zero.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Hash)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    pub const fn new(x: i32, y: i32, w: i32, h: i32) -> Rect {
        Rect { x, y, w, h }
    }

    /// The rectangle spanning two corners, in any order. Both corners are
    /// included, so two equal points give a 1x1 rect.
    pub fn from_corners(a: (i32, i32), b: (i32, i32)) -> Rect {
        let x0 = a.0.min(b.0);
        let y0 = a.1.min(b.1);
        let x1 = a.0.max(b.0);
        let y1 = a.1.max(b.1);
        Rect::new(x0, y0, x1 - x0 + 1, y1 - y0 + 1)
    }

    /// Like [`Rect::from_corners`], but the pointer positions are pixel
    /// *boundaries*, which is what a marquee drag wants: dragging from the
    /// left edge of pixel 0 to the left edge of pixel 4 selects four pixels.
    pub fn from_drag(a: Point, b: Point) -> Rect {
        let x0 = a.x.min(b.x).round() as i32;
        let y0 = a.y.min(b.y).round() as i32;
        let x1 = a.x.max(b.x).round() as i32;
        let y1 = a.y.max(b.y).round() as i32;
        Rect::new(x0, y0, x1 - x0, y1 - y0)
    }

    pub const fn right(&self) -> i32 {
        self.x + self.w
    }

    pub const fn bottom(&self) -> i32 {
        self.y + self.h
    }

    pub const fn is_empty(&self) -> bool {
        self.w <= 0 || self.h <= 0
    }

    pub fn area(&self) -> i64 {
        if self.is_empty() {
            0
        } else {
            i64::from(self.w) * i64::from(self.h)
        }
    }

    pub const fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x && y >= self.y && x < self.right() && y < self.bottom()
    }

    pub fn intersect(&self, other: &Rect) -> Rect {
        let x0 = self.x.max(other.x);
        let y0 = self.y.max(other.y);
        let x1 = self.right().min(other.right());
        let y1 = self.bottom().min(other.bottom());
        if x1 <= x0 || y1 <= y0 {
            Rect::default()
        } else {
            Rect::new(x0, y0, x1 - x0, y1 - y0)
        }
    }

    /// Grows the rect by `amount` on every side (shrinks for negative values).
    pub fn inflate(&self, amount: i32) -> Rect {
        Rect::new(
            self.x - amount,
            self.y - amount,
            (self.w + 2 * amount).max(0),
            (self.h + 2 * amount).max(0),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corners_in_any_order_give_the_same_rect() {
        let a = Rect::from_corners((5, 7), (1, 2));
        let b = Rect::from_corners((1, 2), (5, 7));
        assert_eq!(a, b);
        assert_eq!(a, Rect::new(1, 2, 5, 6));
    }

    #[test]
    fn a_single_point_is_one_pixel() {
        assert_eq!(Rect::from_corners((3, 3), (3, 3)), Rect::new(3, 3, 1, 1));
    }

    #[test]
    fn drag_between_boundaries_counts_whole_pixels() {
        let r = Rect::from_drag(Point::new(0.0, 0.0), Point::new(4.0, 2.0));
        assert_eq!(r, Rect::new(0, 0, 4, 2));
        let r = Rect::from_drag(Point::new(4.0, 2.0), Point::new(0.0, 0.0));
        assert_eq!(r, Rect::new(0, 0, 4, 2));
    }

    #[test]
    fn a_drag_with_no_extent_is_empty() {
        assert!(Rect::from_drag(Point::new(1.2, 1.2), Point::new(1.4, 1.4)).is_empty());
    }

    #[test]
    fn intersection() {
        let a = Rect::new(0, 0, 10, 10);
        let b = Rect::new(5, 5, 10, 10);
        assert_eq!(a.intersect(&b), Rect::new(5, 5, 5, 5));
        assert!(a.intersect(&Rect::new(20, 20, 1, 1)).is_empty());
        assert!(a.intersect(&Rect::new(10, 0, 5, 5)).is_empty(), "touching edges do not overlap");
    }

    #[test]
    fn contains_is_half_open() {
        let r = Rect::new(2, 2, 3, 3);
        assert!(r.contains(2, 2));
        assert!(r.contains(4, 4));
        assert!(!r.contains(5, 4));
        assert!(!r.contains(1, 2));
    }

    #[test]
    fn inflate_and_deflate() {
        assert_eq!(Rect::new(2, 2, 2, 2).inflate(1), Rect::new(1, 1, 4, 4));
        assert_eq!(Rect::new(2, 2, 2, 2).inflate(-2), Rect::new(4, 4, 0, 0));
    }
}
