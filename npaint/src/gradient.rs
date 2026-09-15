//! Gradients: a colour worked out from where the pixel is.
//!
//! A [`Gradient`] is two colours, two points and a *shape* — the rule that
//! turns a position into a fraction of the way from one colour to the other.
//! Every shape is a different [`GradientShape::fraction`] and nothing else,
//! which is why adding one is a variant and an arm.
//!
//! The mix is [`Rgba::lerp`], which interpolates premultiplied, so a
//! gradient that runs out to transparent fades rather than darkening into a
//! grey halo on the way.

use crate::color::Rgba;
use crate::geometry::Point;

/// How a gradient lays its colours out between its two points.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum GradientShape {
    /// Bands square to the line from start to end.
    #[default]
    Linear,
    /// Rings about the start; the end fixes the radius.
    Radial,
    /// Mirrored about the start, so the first colour runs out both ways.
    Reflected,
    /// A sweep round the start, a full turn from the line to the end.
    Angle,
}

impl GradientShape {
    /// In the order the options bar lists them; the name is what crosses to
    /// the page.
    pub const ALL: &'static [GradientShape] =
        &[GradientShape::Linear, GradientShape::Radial, GradientShape::Reflected, GradientShape::Angle];

    pub fn name(self) -> &'static str {
        match self {
            GradientShape::Linear => "linear",
            GradientShape::Radial => "radial",
            GradientShape::Reflected => "reflected",
            GradientShape::Angle => "angle",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            GradientShape::Linear => "Linear",
            GradientShape::Radial => "Radial",
            GradientShape::Reflected => "Reflected",
            GradientShape::Angle => "Angle",
        }
    }

    pub fn from_name(name: &str) -> Option<GradientShape> {
        Self::ALL.iter().copied().find(|s| s.name() == name)
    }

    /// How far from `start` towards `end` the point `p` is, `0.0..=1.0`.
    ///
    /// A drag that went nowhere has no direction to lay anything out along,
    /// so it answers 1.0 everywhere: the whole clip becomes the end colour,
    /// which is the hard edge Photoshop gives for the same gesture.
    pub fn fraction(self, start: Point, end: Point, p: Point) -> f32 {
        let (dx, dy) = (end.x - start.x, end.y - start.y);
        let span = dx * dx + dy * dy;
        if span <= f64::EPSILON {
            return 1.0;
        }
        let (px, py) = (p.x - start.x, p.y - start.y);
        let t = match self {
            GradientShape::Linear => (px * dx + py * dy) / span,
            GradientShape::Reflected => ((px * dx + py * dy) / span).abs(),
            GradientShape::Radial => (px.hypot(py)) / span.sqrt(),
            GradientShape::Angle => {
                // The angle from the drag's own direction, round a whole
                // turn: the line the drag drew is where the sweep starts.
                let turn = (py.atan2(px) - dy.atan2(dx)).rem_euclid(std::f64::consts::TAU);
                turn / std::f64::consts::TAU
            }
        };
        (t as f32).clamp(0.0, 1.0)
    }
}

/// A gradient ready to be asked for the colour at a pixel.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Gradient {
    pub shape: GradientShape,
    pub start: Point,
    pub end: Point,
    pub from: Rgba,
    pub to: Rgba,
}

impl Gradient {
    /// The colour at a pixel, taken at the pixel's centre.
    pub fn at(&self, x: i32, y: i32) -> Rgba {
        let p = Point::new(f64::from(x) + 0.5, f64::from(y) + 0.5);
        self.from.lerp(self.to, self.shape.fraction(self.start, self.end, p))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: Rgba = Rgba::opaque(255, 0, 0);
    const BLUE: Rgba = Rgba::opaque(0, 0, 255);

    fn grad(shape: GradientShape) -> Gradient {
        Gradient { shape, start: Point::new(0.0, 0.0), end: Point::new(10.0, 0.0), from: RED, to: BLUE }
    }

    #[test]
    fn every_shape_round_trips_its_name() {
        for shape in GradientShape::ALL {
            assert_eq!(GradientShape::from_name(shape.name()), Some(*shape));
            assert!(!shape.label().is_empty());
        }
        assert_eq!(GradientShape::from_name("spiral"), None);
    }

    #[test]
    fn a_linear_gradient_runs_along_the_drag() {
        let g = grad(GradientShape::Linear);
        assert_eq!(g.at(0, 0).r, 242, "all but half a pixel of the way to red");
        assert_eq!(g.at(9, 0).b, 242);
        // Halfway is halfway, whatever the row.
        assert_eq!(g.at(5, 0), g.at(5, 40));
        // And it holds its ends past them.
        assert_eq!(g.at(-50, 0), RED);
        assert_eq!(g.at(80, 0), BLUE);
    }

    #[test]
    fn a_radial_gradient_only_cares_about_distance() {
        let g = grad(GradientShape::Radial);
        assert_eq!(g.at(3, 0), g.at(0, 3), "the same ring");
        assert_eq!(g.at(0, 0).r, 237, "the centre is all but the first colour");
        assert_eq!(g.at(20, 20), BLUE, "past the radius it is the last");
    }

    #[test]
    fn a_reflected_gradient_is_the_same_both_ways() {
        let g = grad(GradientShape::Reflected);
        assert_eq!(g.at(4, 0), g.at(-5, 0), "mirrored about the start");
        assert_eq!(g.at(9, 0).b, 242);
    }

    #[test]
    fn an_angle_gradient_sweeps_a_whole_turn() {
        let g = grad(GradientShape::Angle);
        // Just anticlockwise of the drag is the far end of the sweep; just
        // clockwise of it is the near end.
        assert!(g.at(10, -1).b > 240, "a hair before the line has come all the way round");
        assert!(g.at(10, 1).r > 240, "a hair after it has only just started");
    }

    #[test]
    fn a_drag_that_went_nowhere_is_the_end_colour() {
        let g = Gradient { end: Point::new(0.0, 0.0), ..grad(GradientShape::Linear) };
        assert_eq!(g.at(0, 0), BLUE);
        assert_eq!(g.at(99, 99), BLUE);
    }

    #[test]
    fn a_gradient_out_to_transparent_fades_without_a_halo() {
        let g = Gradient { to: Rgba::TRANSPARENT, ..grad(GradientShape::Linear) };
        let mid = g.at(5, 0);
        assert_eq!((mid.r, mid.g, mid.b), (255, 0, 0), "still red, only thinner");
        assert!(mid.a > 100 && mid.a < 155, "about half gone: {}", mid.a);
    }
}
