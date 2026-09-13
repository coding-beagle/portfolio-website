//! Snapping to guides and the canvas edges while moving and transforming.
//!
//! The page owns the guides (they are drawn out of the rulers there) and
//! hands the engine a copy whenever they change. A drag asks [`Snap`] for the
//! smallest nudge that lands one of its interesting positions — the edges and
//! centre of what is being dragged — on a guide or a canvas edge, and applies
//! it only when that nudge is within [`SNAP_PX`] on screen. The canvas
//! contributes its edges and its centre lines.

use crate::geometry::{Point, Rect};

/// How close, in CSS pixels, a position has to be to a line to snap to it.
pub const SNAP_PX: f64 = 6.0;

/// The guides, in document pixels, and whether snapping is on at all. It
/// starts off: the page switches it on from its saved preference, and the
/// engine's tests, which work on ten-pixel documents, are not pulled about
/// by the canvas edges.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Guides {
    /// Horizontal guides: y positions.
    pub h: Vec<f64>,
    /// Vertical guides: x positions.
    pub v: Vec<f64>,
    pub enabled: bool,
}

/// Everything a drag needs to snap: the lines, the canvas, and how far a
/// position may be pulled, in document pixels.
#[derive(Clone, Copy, Debug)]
pub struct Snap<'a> {
    guides: &'a Guides,
    canvas: Rect,
    threshold: f64,
}

impl<'a> Snap<'a> {
    /// `None` when snapping is switched off, so callers can skip the work.
    pub fn new(guides: &'a Guides, canvas: Rect, zoom: f64) -> Option<Snap<'a>> {
        guides.enabled.then(|| Snap { guides, canvas, threshold: SNAP_PX / zoom.max(f64::EPSILON) })
    }

    /// The lines a horizontal position may land on.
    fn x_targets(&self) -> Vec<f64> {
        let (x0, x1) = (f64::from(self.canvas.x), f64::from(self.canvas.right()));
        self.guides.v.iter().copied().chain([x0, x1, (x0 + x1) / 2.0]).collect()
    }

    /// The lines a vertical position may land on.
    fn y_targets(&self) -> Vec<f64> {
        let (y0, y1) = (f64::from(self.canvas.y), f64::from(self.canvas.bottom()));
        self.guides.h.iter().copied().chain([y0, y1, (y0 + y1) / 2.0]).collect()
    }

    /// The smallest nudge within the threshold that puts one of `values` on
    /// one of `targets`, or zero.
    fn nudge(&self, values: &[f64], targets: &[f64]) -> f64 {
        let mut best = 0.0;
        let mut best_size = self.threshold;
        for &v in values {
            for &t in targets {
                let d = t - v;
                if d.abs() <= best_size {
                    best = d;
                    best_size = d.abs();
                }
            }
        }
        best
    }

    /// The `(dx, dy)` to add so that one of `xs` and one of `ys` land on a
    /// line, each axis independently.
    pub fn offset(&self, xs: &[f64], ys: &[f64]) -> (f64, f64) {
        (self.nudge(xs, &self.x_targets()), self.nudge(ys, &self.y_targets()))
    }

    /// A single point pulled onto nearby lines.
    pub fn point(&self, p: Point) -> Point {
        let (dx, dy) = self.offset(&[p.x], &[p.y]);
        Point::new(p.x + dx, p.y + dy)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn guides() -> Guides {
        Guides { h: vec![50.0], v: vec![20.0, 80.0], enabled: true }
    }

    #[test]
    fn pulls_the_nearest_edge_onto_a_guide() {
        let g = guides();
        let s = Snap::new(&g, Rect::new(0, 0, 100, 100), 1.0).unwrap();
        // Left edge at 17, right at 37: the left edge is 3 from the guide at 20.
        assert_eq!(s.offset(&[17.0, 37.0, 27.0], &[10.0, 30.0, 20.0]), (3.0, 0.0));
        // The right edge is nearer to 80 than the left is to anything.
        assert_eq!(s.offset(&[60.0, 78.0], &[45.0, 60.0]), (2.0, 5.0));
    }

    #[test]
    fn beyond_the_threshold_nothing_happens() {
        let g = guides();
        let s = Snap::new(&g, Rect::new(0, 0, 100, 100), 1.0).unwrap();
        assert_eq!(s.offset(&[30.0], &[30.0]), (0.0, 0.0));
    }

    #[test]
    fn the_threshold_is_a_screen_distance() {
        let g = guides();
        let zoomed_out = Snap::new(&g, Rect::new(0, 0, 100, 100), 0.25).unwrap();
        assert_eq!(zoomed_out.offset(&[30.0], &[30.0]), (-10.0, 20.0));
        let zoomed_in = Snap::new(&g, Rect::new(0, 0, 100, 100), 4.0).unwrap();
        assert_eq!(zoomed_in.offset(&[18.0], &[48.5]), (0.0, 1.5));
    }

    #[test]
    fn canvas_edges_count_too() {
        let g = Guides { enabled: true, ..Guides::default() };
        let s = Snap::new(&g, Rect::new(0, 0, 100, 100), 1.0).unwrap();
        assert_eq!(s.point(Point::new(2.0, 97.0)), Point::new(0.0, 100.0));
    }

    #[test]
    fn the_canvas_centre_is_a_target() {
        let g = Guides { enabled: true, ..Guides::default() };
        let s = Snap::new(&g, Rect::new(0, 0, 100, 80), 1.0).unwrap();
        assert_eq!(s.point(Point::new(52.0, 37.0)), Point::new(50.0, 40.0));
    }

    #[test]
    fn switched_off_is_none() {
        let g = Guides { enabled: false, ..guides() };
        assert!(Snap::new(&g, Rect::new(0, 0, 10, 10), 1.0).is_none());
    }
}
