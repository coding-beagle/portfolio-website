//! Zoom and pan: the mapping between the canvas element and the document.
//!
//! `pan` is where the document's origin lands on screen, in CSS pixels, and
//! `zoom` is screen pixels per document pixel. Both are kept here rather than
//! in the page so that zoom-about-a-point, fit-to-window and the clamping
//! are testable — and so pointer events can be handed to the engine in screen
//! space, which keeps the page from knowing the transform at all.

use crate::geometry::{Point, Size};

pub const MIN_ZOOM: f64 = 1.0 / 32.0;
pub const MAX_ZOOM: f64 = 64.0;

/// The zoom levels the zoom in/out buttons step through, in the manner of
/// Photoshop's preset list.
pub const ZOOM_STEPS: &[f64] = &[
    1.0 / 32.0,
    1.0 / 16.0,
    1.0 / 8.0,
    0.25,
    1.0 / 3.0,
    0.5,
    2.0 / 3.0,
    1.0,
    2.0,
    3.0,
    4.0,
    6.0,
    8.0,
    12.0,
    16.0,
    24.0,
    32.0,
    64.0,
];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Viewport {
    zoom: f64,
    pan: Point,
    /// The size of the window the document is drawn into, in CSS pixels.
    /// Kept here so that a zoom which has to fill that window — the zoom
    /// tool's marquee — can be worked out in the engine rather than in the
    /// page. Every operation that is told the size records it, and the page
    /// reports it on resize.
    view: Size,
}

impl Default for Viewport {
    fn default() -> Viewport {
        Viewport { zoom: 1.0, pan: Point::new(0.0, 0.0), view: Size::default() }
    }
}

impl Viewport {
    pub fn zoom(&self) -> f64 {
        self.zoom
    }

    pub fn pan(&self) -> Point {
        self.pan
    }

    pub fn view(&self) -> Size {
        self.view
    }

    pub fn set_view(&mut self, w: f64, h: f64) {
        self.view = Size::new(w, h);
    }

    pub fn screen_to_doc(&self, screen: Point) -> Point {
        Point::new((screen.x - self.pan.x) / self.zoom, (screen.y - self.pan.y) / self.zoom)
    }

    pub fn doc_to_screen(&self, doc: Point) -> Point {
        Point::new(doc.x * self.zoom + self.pan.x, doc.y * self.zoom + self.pan.y)
    }

    pub fn pan_by(&mut self, dx: f64, dy: f64) {
        self.pan.x += dx;
        self.pan.y += dy;
    }

    /// Changes the zoom so that the document point under `anchor` (a screen
    /// position) stays under it — what zooming with the wheel at the cursor
    /// needs. The zoom is clamped to `MIN_ZOOM..=MAX_ZOOM`.
    pub fn set_zoom_about(&mut self, zoom: f64, anchor: Point) {
        let zoom = zoom.clamp(MIN_ZOOM, MAX_ZOOM);
        let doc = self.screen_to_doc(anchor);
        self.zoom = zoom;
        self.pan = Point::new(anchor.x - doc.x * zoom, anchor.y - doc.y * zoom);
    }

    pub fn zoom_by_about(&mut self, factor: f64, anchor: Point) {
        self.set_zoom_about(self.zoom * factor, anchor);
    }

    /// The next preset zoom above the current one, or the current one if it
    /// is already at the top.
    pub fn next_step_in(&self) -> f64 {
        ZOOM_STEPS
            .iter()
            .copied()
            .find(|z| *z > self.zoom * 1.001)
            .unwrap_or(self.zoom)
    }

    pub fn next_step_out(&self) -> f64 {
        ZOOM_STEPS
            .iter()
            .rev()
            .copied()
            .find(|z| *z < self.zoom * 0.999)
            .unwrap_or(self.zoom)
    }

    /// Zooms and pans so the screen rectangle spanned by `a` and `b` fills the
    /// view, centred — what dragging a marquee with the zoom tool asks for.
    /// The zoom is clamped like any other, and the whole rectangle stays
    /// visible when the aspect ratios differ, so the drawn box is a floor on
    /// what is shown rather than a promise of exactly it.
    ///
    /// Returns false, changing nothing, if the view size is not known yet or
    /// the rectangle has no area to fill it with.
    pub fn zoom_to_screen_rect(&mut self, a: Point, b: Point) -> bool {
        if self.view.is_empty() {
            return false;
        }
        let top_left = self.screen_to_doc(Point::new(a.x.min(b.x), a.y.min(b.y)));
        let bottom_right = self.screen_to_doc(Point::new(a.x.max(b.x), a.y.max(b.y)));
        let w = bottom_right.x - top_left.x;
        let h = bottom_right.y - top_left.y;
        if w <= 0.0 || h <= 0.0 {
            return false;
        }
        let zoom = (self.view.w / w).min(self.view.h / h).clamp(MIN_ZOOM, MAX_ZOOM);
        let centre = Point::new((top_left.x + bottom_right.x) / 2.0, (top_left.y + bottom_right.y) / 2.0);
        self.zoom = zoom;
        self.pan = Point::new(self.view.w / 2.0 - centre.x * zoom, self.view.h / 2.0 - centre.y * zoom);
        true
    }

    /// Zooms and pans so the whole document is centred in a view of the given
    /// size with a little margin, without enlarging past 100% — a small image
    /// fitted to a big window should stay at its real size, not become a
    /// blurry poster.
    pub fn fit(&mut self, doc_w: u32, doc_h: u32, view_w: f64, view_h: f64) {
        const MARGIN: f64 = 24.0;
        self.view = Size::new(view_w, view_h);
        let avail_w = (view_w - 2.0 * MARGIN).max(1.0);
        let avail_h = (view_h - 2.0 * MARGIN).max(1.0);
        let zoom = (avail_w / f64::from(doc_w.max(1)))
            .min(avail_h / f64::from(doc_h.max(1)))
            .min(1.0)
            .clamp(MIN_ZOOM, MAX_ZOOM);
        self.zoom = zoom;
        self.center(doc_w, doc_h, view_w, view_h);
    }

    /// Pans so the document is centred in the view at the current zoom.
    pub fn center(&mut self, doc_w: u32, doc_h: u32, view_w: f64, view_h: f64) {
        self.view = Size::new(view_w, view_h);
        self.pan = Point::new(
            ((view_w - f64::from(doc_w) * self.zoom) / 2.0).round(),
            ((view_h - f64::from(doc_h) * self.zoom) / 2.0).round(),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: Point, b: Point) -> bool {
        (a.x - b.x).abs() < 1e-9 && (a.y - b.y).abs() < 1e-9
    }

    #[test]
    fn identity_by_default() {
        let v = Viewport::default();
        let p = Point::new(12.0, 34.0);
        assert_eq!(v.screen_to_doc(p), p);
        assert_eq!(v.doc_to_screen(p), p);
    }

    #[test]
    fn transforms_invert_each_other() {
        let mut v = Viewport::default();
        v.set_zoom_about(3.0, Point::new(100.0, 50.0));
        v.pan_by(-7.0, 11.0);
        let p = Point::new(12.0, 34.0);
        assert!(close(v.screen_to_doc(v.doc_to_screen(p)), p));
    }

    #[test]
    fn zooming_about_a_point_keeps_it_fixed() {
        let mut v = Viewport::default();
        v.pan_by(20.0, 30.0);
        let anchor = Point::new(150.0, 90.0);
        let before = v.screen_to_doc(anchor);
        v.zoom_by_about(2.5, anchor);
        assert!(close(v.screen_to_doc(anchor), before));
        assert_eq!(v.zoom(), 2.5);
    }

    #[test]
    fn zoom_is_clamped() {
        let mut v = Viewport::default();
        v.set_zoom_about(1000.0, Point::default());
        assert_eq!(v.zoom(), MAX_ZOOM);
        v.set_zoom_about(0.0, Point::default());
        assert_eq!(v.zoom(), MIN_ZOOM);
    }

    #[test]
    fn steps_walk_the_preset_list() {
        let mut v = Viewport::default();
        assert_eq!(v.next_step_in(), 2.0);
        assert_eq!(v.next_step_out(), 2.0 / 3.0);
        v.set_zoom_about(1.5, Point::default());
        assert_eq!(v.next_step_in(), 2.0, "from between presets, the next one up");
        assert_eq!(v.next_step_out(), 1.0);
        v.set_zoom_about(MAX_ZOOM, Point::default());
        assert_eq!(v.next_step_in(), MAX_ZOOM, "stays put at the top");
        v.set_zoom_about(MIN_ZOOM, Point::default());
        assert_eq!(v.next_step_out(), MIN_ZOOM);
    }

    #[test]
    fn fit_shrinks_a_big_image_and_centres_it() {
        let mut v = Viewport::default();
        v.fit(2000, 1000, 1000.0, 1000.0);
        // (1000 - 48) / 2000
        assert!((v.zoom() - 0.476).abs() < 1e-9);
        let centre = v.doc_to_screen(Point::new(1000.0, 500.0));
        assert!((centre.x - 500.0).abs() <= 0.5 && (centre.y - 500.0).abs() <= 0.5, "{centre:?}");
    }

    #[test]
    fn zooming_to_a_rectangle_fills_the_view_with_it() {
        let mut v = Viewport::default();
        v.set_view(400.0, 400.0);
        // A 100x100 screen box at 1:1 is 100 document pixels across.
        assert!(v.zoom_to_screen_rect(Point::new(50.0, 50.0), Point::new(150.0, 150.0)));
        assert_eq!(v.zoom(), 4.0);
        let centre = v.doc_to_screen(Point::new(100.0, 100.0));
        assert!(close(centre, Point::new(200.0, 200.0)), "{centre:?}");
    }

    #[test]
    fn a_rectangle_of_the_wrong_shape_still_fits_inside_the_view() {
        let mut v = Viewport::default();
        v.set_view(400.0, 400.0);
        // Wide and short: the width is what runs out first.
        v.zoom_to_screen_rect(Point::new(0.0, 0.0), Point::new(200.0, 50.0));
        assert_eq!(v.zoom(), 2.0);
        let tl = v.doc_to_screen(Point::new(0.0, 0.0));
        let br = v.doc_to_screen(Point::new(200.0, 50.0));
        assert!(tl.x >= -0.5 && br.x <= 400.5, "{tl:?} {br:?}");
        assert!(tl.y >= -0.5 && br.y <= 400.5, "the short side is centred, not stretched");
    }

    #[test]
    fn zooming_to_a_rectangle_needs_a_view_and_an_area() {
        let mut v = Viewport::default();
        assert!(!v.zoom_to_screen_rect(Point::new(0.0, 0.0), Point::new(10.0, 10.0)), "no view size yet");
        v.set_view(400.0, 400.0);
        assert!(!v.zoom_to_screen_rect(Point::new(5.0, 5.0), Point::new(5.0, 60.0)), "no width");
        assert_eq!(v.zoom(), 1.0);
    }

    #[test]
    fn a_rectangle_zoom_is_clamped_like_any_other() {
        let mut v = Viewport::default();
        v.set_view(400.0, 400.0);
        v.zoom_to_screen_rect(Point::new(0.0, 0.0), Point::new(1.0, 1.0));
        assert_eq!(v.zoom(), MAX_ZOOM);
    }

    #[test]
    fn fitting_records_the_view_size() {
        let mut v = Viewport::default();
        v.fit(100, 100, 800.0, 600.0);
        assert_eq!(v.view(), Size::new(800.0, 600.0));
    }

    #[test]
    fn fit_does_not_enlarge_a_small_image() {
        let mut v = Viewport::default();
        v.fit(100, 100, 1000.0, 1000.0);
        assert_eq!(v.zoom(), 1.0);
        assert_eq!(v.pan(), Point::new(450.0, 450.0));
    }
}
