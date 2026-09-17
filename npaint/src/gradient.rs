//! Gradients: a colour worked out from where the pixel is.
//!
//! A [`Gradient`] is a run of colour *stops*, two points and a *shape* — the
//! rule that turns a position into a fraction of the way along the run.
//! Every shape is a different [`GradientShape::fraction`] and nothing else,
//! which is why adding one is a variant and an arm.
//!
//! The stops are what the page's gradient editor edits: each is a colour and
//! how far along it sits, and [`GradientStops::sample`] mixes the two on
//! either side of the fraction asked for. Two stops are the plain blend the
//! tool laid down before there was an editor.
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

/// One colour, and how far along the gradient it sits, `0.0..=1.0`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GradientStop {
    pub at: f32,
    pub color: Rgba,
}

/// The colours a gradient runs through, in order along it.
///
/// Kept sorted by [`GradientStops::new`], which is the only way one is
/// built, so [`GradientStops::sample`] can walk them without checking.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct GradientStops {
    stops: Vec<GradientStop>,
}

/// How many stops one gradient may carry. The editor has to leave room to
/// grab each one, and a file that says a million is not a gradient.
pub const MAX_STOPS: usize = 32;

impl GradientStops {
    /// The stops sorted along the gradient, each pinned to `0.0..=1.0`, and
    /// no more of them than [`MAX_STOPS`].
    pub fn new(stops: Vec<GradientStop>) -> GradientStops {
        let mut stops = stops;
        stops.truncate(MAX_STOPS);
        for stop in &mut stops {
            stop.at = if stop.at.is_finite() { stop.at.clamp(0.0, 1.0) } else { 0.0 };
        }
        stops.sort_by(|a, b| a.at.total_cmp(&b.at));
        GradientStops { stops }
    }

    /// The plain blend from one colour to another: what the tool laid down
    /// before there was an editor, and what the swatches still give it.
    pub fn two(from: Rgba, to: Rgba) -> GradientStops {
        GradientStops::new(vec![GradientStop { at: 0.0, color: from }, GradientStop { at: 1.0, color: to }])
    }

    /// Stops as `[position, r, g, b, a]` each, which is how they cross to
    /// the page. A run too short to finish a stop is dropped.
    pub fn from_flat(flat: &[f32]) -> GradientStops {
        let byte = |v: f32| if v.is_finite() { v.round().clamp(0.0, 255.0) as u8 } else { 0 };
        GradientStops::new(
            flat.as_chunks::<5>()
                .0
                .iter()
                .map(|c| GradientStop { at: c[0], color: Rgba::new(byte(c[1]), byte(c[2]), byte(c[3]), byte(c[4])) })
                .collect(),
        )
    }

    pub fn to_flat(&self) -> Vec<f32> {
        self.stops
            .iter()
            .flat_map(|s| {
                let c = s.color;
                [s.at, f32::from(c.r), f32::from(c.g), f32::from(c.b), f32::from(c.a)]
            })
            .collect()
    }

    pub fn stops(&self) -> &[GradientStop] {
        &self.stops
    }

    pub fn is_empty(&self) -> bool {
        self.stops.is_empty()
    }

    /// The same colours the other way round, which is what Reverse does.
    pub fn reversed(&self) -> GradientStops {
        GradientStops::new(
            self.stops.iter().map(|s| GradientStop { at: 1.0 - s.at, color: s.color }).collect(),
        )
    }

    /// The colour a fraction of the way along, mixed from the stops on
    /// either side of it. Past either end it holds that end's colour, and
    /// with no stops at all there is nothing to draw, so it is transparent.
    pub fn sample(&self, t: f32) -> Rgba {
        let t = t.clamp(0.0, 1.0);
        let Some(first) = self.stops.first() else { return Rgba::TRANSPARENT };
        if t <= first.at {
            return first.color;
        }
        let last = self.stops[self.stops.len() - 1];
        if t >= last.at {
            return last.color;
        }
        // The run the fraction falls in starts at the *last* stop at or
        // before it, so two stops in one place are a hard edge: the later
        // one takes over rather than being mixed with over no distance.
        let start = self.stops.iter().rposition(|s| s.at <= t).unwrap_or(0);
        let (lo, hi) = (self.stops[start], self.stops[(start + 1).min(self.stops.len() - 1)]);
        let span = hi.at - lo.at;
        if span <= f32::EPSILON {
            return hi.color;
        }
        lo.color.lerp(hi.color, (t - lo.at) / span)
    }
}

/// A gradient ready to be asked for the colour at a pixel.
#[derive(Clone, Debug, PartialEq)]
pub struct Gradient {
    pub shape: GradientShape,
    pub start: Point,
    pub end: Point,
    pub stops: GradientStops,
}

impl Gradient {
    /// The colour at a pixel, taken at the pixel's centre.
    pub fn at(&self, x: i32, y: i32) -> Rgba {
        let p = Point::new(f64::from(x) + 0.5, f64::from(y) + 0.5);
        self.stops.sample(self.shape.fraction(self.start, self.end, p))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: Rgba = Rgba::opaque(255, 0, 0);
    const GREEN: Rgba = Rgba::opaque(0, 255, 0);
    const BLUE: Rgba = Rgba::opaque(0, 0, 255);

    fn grad(shape: GradientShape) -> Gradient {
        Gradient {
            shape,
            start: Point::new(0.0, 0.0),
            end: Point::new(10.0, 0.0),
            stops: GradientStops::two(RED, BLUE),
        }
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
        let g = Gradient { stops: GradientStops::two(RED, Rgba::TRANSPARENT), ..grad(GradientShape::Linear) };
        let mid = g.at(5, 0);
        assert_eq!((mid.r, mid.g, mid.b), (255, 0, 0), "still red, only thinner");
        assert!(mid.a > 100 && mid.a < 155, "about half gone: {}", mid.a);
    }

    #[test]
    fn stops_are_sorted_and_pinned_to_the_run() {
        let stops = GradientStops::new(vec![
            GradientStop { at: 2.0, color: BLUE },
            GradientStop { at: -1.0, color: RED },
            GradientStop { at: 0.5, color: GREEN },
        ]);
        let at: Vec<f32> = stops.stops().iter().map(|s| s.at).collect();
        assert_eq!(at, vec![0.0, 0.5, 1.0]);
        assert_eq!(stops.stops()[0].color, RED);
        assert_eq!(stops.stops()[2].color, BLUE);
    }

    #[test]
    fn a_middle_stop_is_reached_where_it_sits() {
        let stops = GradientStops::new(vec![
            GradientStop { at: 0.0, color: RED },
            GradientStop { at: 0.25, color: GREEN },
            GradientStop { at: 1.0, color: BLUE },
        ]);
        assert_eq!(stops.sample(0.25), GREEN);
        // Between red and green a quarter of the way along, and between
        // green and blue for the rest of it.
        assert_eq!(stops.sample(0.125), RED.lerp(GREEN, 0.5));
        assert_eq!(stops.sample(0.625), GREEN.lerp(BLUE, 0.5));
    }

    #[test]
    fn two_stops_in_one_place_are_a_hard_edge() {
        let stops = GradientStops::new(vec![
            GradientStop { at: 0.0, color: RED },
            GradientStop { at: 0.5, color: RED },
            GradientStop { at: 0.5, color: BLUE },
            GradientStop { at: 1.0, color: BLUE },
        ]);
        assert_eq!(stops.sample(0.49), RED);
        assert_eq!(stops.sample(0.5), BLUE);
    }

    #[test]
    fn reversing_turns_the_run_round() {
        let stops = GradientStops::new(vec![
            GradientStop { at: 0.0, color: RED },
            GradientStop { at: 0.25, color: GREEN },
            GradientStop { at: 1.0, color: BLUE },
        ]);
        let back = stops.reversed();
        assert_eq!(back.sample(0.0), BLUE);
        assert_eq!(back.sample(0.75), GREEN);
        assert_eq!(back.sample(1.0), RED);
        assert_eq!(back.reversed(), stops);
    }

    #[test]
    fn stops_cross_the_boundary_as_numbers() {
        let stops = GradientStops::two(RED, Rgba::new(0, 0, 255, 128));
        assert_eq!(stops.to_flat(), vec![0.0, 255.0, 0.0, 0.0, 255.0, 1.0, 0.0, 0.0, 255.0, 128.0]);
        assert_eq!(GradientStops::from_flat(&stops.to_flat()), stops);
        assert!(GradientStops::from_flat(&[0.0, 1.0]).is_empty(), "half a stop is no stop");
        assert!(GradientStops::from_flat(&[]).is_empty());
    }

    #[test]
    fn no_stops_at_all_draws_nothing() {
        let g = Gradient { stops: GradientStops::default(), ..grad(GradientShape::Linear) };
        assert_eq!(g.at(5, 0), Rgba::TRANSPARENT);
    }

    #[test]
    fn a_gradient_carries_no_more_stops_than_it_may() {
        let many: Vec<GradientStop> =
            (0..MAX_STOPS + 10).map(|i| GradientStop { at: i as f32 / 100.0, color: RED }).collect();
        assert_eq!(GradientStops::new(many).stops().len(), MAX_STOPS);
    }
}
