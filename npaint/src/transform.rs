//! Geometric transforms: an affine matrix, resampling a raster through one,
//! and the interactive free-transform session behind Ctrl+T.
//!
//! The session works on a *moving* buffer (the selected pixels, or the whole
//! layer when nothing is selected) over a *static* one (everything else). Its
//! state is a single matrix from the moving buffer's original coordinates to
//! where they are now; move, scale and rotate all just multiply onto it. The
//! handle hit-testing is here too, so it can be tested without a browser and
//! so the page only has to draw what the session reports.

use crate::color::Rgba;
use crate::geometry::{Point, Rect};
use crate::raster::Raster;
use crate::snap::Snap;

/// A 2D affine transform `[a c e; b d f]`: `x' = a x + c y + e`,
/// `y' = b x + d y + f`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Affine {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

impl Affine {
    pub const IDENTITY: Affine = Affine { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 };

    pub fn translation(dx: f64, dy: f64) -> Affine {
        Affine { e: dx, f: dy, ..Affine::IDENTITY }
    }

    pub fn scaling(sx: f64, sy: f64) -> Affine {
        Affine { a: sx, d: sy, ..Affine::IDENTITY }
    }

    pub fn rotation(radians: f64) -> Affine {
        let (s, c) = radians.sin_cos();
        Affine { a: c, b: s, c: -s, d: c, e: 0.0, f: 0.0 }
    }

    /// `self` applied after `other`: `(self ∘ other)(p) = self(other(p))`.
    pub fn then(&self, other: &Affine) -> Affine {
        // self * other
        Affine {
            a: self.a * other.a + self.c * other.b,
            b: self.b * other.a + self.d * other.b,
            c: self.a * other.c + self.c * other.d,
            d: self.b * other.c + self.d * other.d,
            e: self.a * other.e + self.c * other.f + self.e,
            f: self.b * other.e + self.d * other.f + self.f,
        }
    }

    /// The transform that does `about`-centred `inner`: translate to the
    /// origin, apply, translate back. Then applied after `self`.
    pub fn pre_about(&self, inner: &Affine, about: Point) -> Affine {
        Affine::translation(about.x, about.y)
            .then(inner)
            .then(&Affine::translation(-about.x, -about.y))
            .then(self)
    }

    pub fn apply(&self, p: Point) -> Point {
        Point::new(self.a * p.x + self.c * p.y + self.e, self.b * p.x + self.d * p.y + self.f)
    }

    pub fn determinant(&self) -> f64 {
        self.a * self.d - self.b * self.c
    }

    pub fn inverse(&self) -> Option<Affine> {
        let det = self.determinant();
        if det.abs() < 1e-12 {
            return None;
        }
        let a = self.d / det;
        let b = -self.b / det;
        let c = -self.c / det;
        let d = self.a / det;
        Some(Affine {
            a,
            b,
            c,
            d,
            e: -(a * self.e + c * self.f),
            f: -(b * self.e + d * self.f),
        })
    }

    /// The rotation of the x axis, in radians.
    pub fn angle(&self) -> f64 {
        self.b.atan2(self.a)
    }

    /// The scale along each axis (lengths of the basis vectors).
    pub fn scale(&self) -> (f64, f64) {
        (self.a.hypot(self.b), self.c.hypot(self.d))
    }
}


/// A 2D projective transform — a homography. The matrix is row-major:
/// `[m0 m1 m2; m3 m4 m5; m6 m7 m8]` applied to `(x, y, 1)`, with the answer
/// divided by the third coordinate it comes out with.
///
/// An [`Affine`] is the case where the bottom row is `0 0 1`, and that is
/// what every drag but a corner distortion produces. The rest of the family
/// is what lets the four corners of the transform box go anywhere a plane
/// seen at an angle could put them, which is the whole of the 3D transform:
/// a picture on a plane in space, projected back onto the canvas, is exactly
/// a homography of the picture.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Projective {
    pub m: [f64; 9],
}

/// Below this a denominator is treated as a degenerate matrix rather than a
/// very large coordinate. Points that far out are off any canvas anyway.
const NEAR_ZERO: f64 = 1e-12;
/// How far in front of the vanishing line a point has to be to be drawn.
/// Small enough to keep every pixel of a plausible placement, large enough
/// that what is kept has finite coordinates.
const HORIZON_EPS: f64 = 1e-6;

impl From<Affine> for Projective {
    fn from(a: Affine) -> Projective {
        Projective { m: [a.a, a.c, a.e, a.b, a.d, a.f, 0.0, 0.0, 1.0] }
    }
}

impl Projective {
    pub const IDENTITY: Projective = Projective { m: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0] };

    /// `self` applied after `other`: `(self ∘ other)(p) = self(other(p))`.
    pub fn then(&self, other: &Projective) -> Projective {
        let mut m = [0.0; 9];
        for row in 0..3 {
            for col in 0..3 {
                m[row * 3 + col] = (0..3).map(|k| self.m[row * 3 + k] * other.m[k * 3 + col]).sum();
            }
        }
        Projective { m }
    }

    /// `self` with `a` applied after it — the affine that every ordinary
    /// drag composes onto the placement.
    pub fn after(&self, a: &Affine) -> Projective {
        Projective::from(*a).then(self)
    }

    /// The transform that does `about`-centred `inner`, applied after
    /// `self`. [`Affine::pre_about`] for a placement that may be projective.
    pub fn pre_about(&self, inner: &Affine, about: Point) -> Projective {
        let centred = Affine::translation(about.x, about.y).then(inner).then(&Affine::translation(-about.x, -about.y));
        self.after(&centred)
    }

    pub fn apply(&self, p: Point) -> Point {
        let w = self.m[6] * p.x + self.m[7] * p.y + self.m[8];
        let w = if w.abs() < NEAR_ZERO { NEAR_ZERO.copysign(w) } else { w };
        Point::new(
            (self.m[0] * p.x + self.m[1] * p.y + self.m[2]) / w,
            (self.m[3] * p.x + self.m[4] * p.y + self.m[5]) / w,
        )
    }

    /// The affine this is, when the bottom row says it is one. The renderer
    /// takes the affine path when it can: no divide a pixel, and a whole-
    /// pixel shift can be copied rather than resampled.
    pub fn as_affine(&self) -> Option<Affine> {
        let i = self.m[8];
        if i.abs() < NEAR_ZERO || self.m[6].abs() > NEAR_ZERO || self.m[7].abs() > NEAR_ZERO {
            return None;
        }
        Some(Affine {
            a: self.m[0] / i,
            b: self.m[3] / i,
            c: self.m[1] / i,
            d: self.m[4] / i,
            e: self.m[2] / i,
            f: self.m[5] / i,
        })
    }

    pub fn inverse(&self) -> Option<Projective> {
        let m = &self.m;
        let cofactor = |r: usize, c: usize| {
            let rows: Vec<usize> = (0..3).filter(|&i| i != r).collect();
            let cols: Vec<usize> = (0..3).filter(|&i| i != c).collect();
            let minor = m[rows[0] * 3 + cols[0]] * m[rows[1] * 3 + cols[1]]
                - m[rows[0] * 3 + cols[1]] * m[rows[1] * 3 + cols[0]];
            if (r + c).is_multiple_of(2) { minor } else { -minor }
        };
        let det = (0..3).map(|c| m[c] * cofactor(0, c)).sum::<f64>();
        if det.abs() < NEAR_ZERO {
            return None;
        }
        // The adjugate is the transpose of the cofactors.
        let mut out = [0.0; 9];
        for row in 0..3 {
            for col in 0..3 {
                out[row * 3 + col] = cofactor(col, row) / det;
            }
        }
        Some(Projective { m: out })
    }

    /// Whether `p` is on the side of the horizon that this placement puts
    /// in view. A homography maps the whole plane, but half of it lands
    /// *behind* the viewer and comes out mirrored through the vanishing
    /// line; only the half with the same sign as the picture's own is
    /// really there. `w_at` is the third coordinate before the divide, and
    /// `front` is its sign where the picture is.
    fn w_at(&self, p: Point) -> f64 {
        self.m[6] * p.x + self.m[7] * p.y + self.m[8]
    }

    /// The box `corners` land in, with whatever falls behind the horizon
    /// left out. `None` when none of it is in front.
    ///
    /// Taking the four mapped corners' extent is not enough on its own: a
    /// corner beyond the vanishing line maps to the far side of the plane,
    /// and the extent it gives is inside out. So the quadrilateral is
    /// clipped against the horizon first and what is left is what is
    /// measured.
    pub fn image_bounds(&self, corners: [Point; 4]) -> Option<(Point, Point)> {
        let centre = Point::new(
            corners.iter().map(|p| p.x).sum::<f64>() / 4.0,
            corners.iter().map(|p| p.y).sum::<f64>() / 4.0,
        );
        let front = self.w_at(centre);
        if front.abs() < NEAR_ZERO {
            return None;
        }
        // Just in front of the horizon rather than on it: a vertex exactly
        // on the line has nowhere finite to go.
        let depth = |p: Point| self.w_at(p) * front.signum() - HORIZON_EPS;
        let mut kept: Vec<Point> = Vec::with_capacity(8);
        for i in 0..4 {
            let (a, b) = (corners[i], corners[(i + 1) % 4]);
            let (da, db) = (depth(a), depth(b));
            if da >= 0.0 {
                kept.push(a);
            }
            if (da >= 0.0) != (db >= 0.0) {
                let t = da / (da - db);
                kept.push(Point::new(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
            }
        }
        if kept.len() < 3 {
            return None;
        }
        let placed: Vec<Point> = kept.iter().map(|p| self.apply(*p)).collect();
        let fold = |f: fn(f64, f64) -> f64, pick: fn(&Point) -> f64, seed: f64| placed.iter().map(pick).fold(seed, f);
        Some((
            Point::new(fold(f64::min, |p| p.x, f64::INFINITY), fold(f64::min, |p| p.y, f64::INFINITY)),
            Point::new(fold(f64::max, |p| p.x, f64::NEG_INFINITY), fold(f64::max, |p| p.y, f64::NEG_INFINITY)),
        ))
    }

    /// The homography taking the four points of `src` to the four of `dst`,
    /// in the same order. `None` when the two quadrilaterals do not fix one
    /// — three points of either in a line, or a corner dragged through
    /// another until the shape folds over.
    pub fn from_quad(src: [Point; 4], dst: [Point; 4]) -> Option<Projective> {
        let from = Projective::from_unit_square(src)?.inverse()?;
        Some(Projective::from_unit_square(dst)?.then(&from))
    }

    /// The homography taking the corners of the unit square, clockwise from
    /// the origin, to `quad`.
    ///
    /// Eight numbers describe a homography — the ninth is a free scale — and
    /// each corner gives two equations, so four corners settle it. Taking
    /// the ninth as 1 is only safe when the origin has somewhere finite to
    /// go, which for the unit square it has: it is one of the corners. That
    /// is why [`Projective::from_quad`] goes the long way round through here
    /// rather than solving `src` to `dst` directly — a rectangle somewhere
    /// on a canvas may well have the origin on the very line the placement
    /// sends to infinity, and then there is no answer with a 1 in the
    /// corner to find.
    fn from_unit_square(quad: [Point; 4]) -> Option<Projective> {
        const UNIT: [Point; 4] = [Point { x: 0.0, y: 0.0 }, Point { x: 1.0, y: 0.0 }, Point { x: 1.0, y: 1.0 }, Point { x: 0.0, y: 1.0 }];
        let mut a = [[0.0f64; 9]; 8];
        for i in 0..4 {
            let (s, d) = (UNIT[i], quad[i]);
            a[i * 2] = [s.x, s.y, 1.0, 0.0, 0.0, 0.0, -s.x * d.x, -s.y * d.x, d.x];
            a[i * 2 + 1] = [0.0, 0.0, 0.0, s.x, s.y, 1.0, -s.x * d.y, -s.y * d.y, d.y];
        }
        let h = solve(&mut a)?;
        Some(Projective { m: [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1.0] })
    }
}

/// The smallest box holding all four points.
fn extent_of(corners: &[Point; 4]) -> (Point, Point) {
    let fold = |f: fn(f64, f64) -> f64, pick: fn(&Point) -> f64, seed: f64| corners.iter().map(pick).fold(seed, f);
    (
        Point::new(fold(f64::min, |p| p.x, f64::INFINITY), fold(f64::min, |p| p.y, f64::INFINITY)),
        Point::new(fold(f64::max, |p| p.x, f64::NEG_INFINITY), fold(f64::max, |p| p.y, f64::NEG_INFINITY)),
    )
}

/// Gauss–Jordan with partial pivoting on eight equations in eight unknowns,
/// the rows given as coefficients followed by the right-hand side.
fn solve(rows: &mut [[f64; 9]; 8]) -> Option<[f64; 8]> {
    for col in 0..8 {
        let pivot = (col..8).max_by(|&i, &j| rows[i][col].abs().total_cmp(&rows[j][col].abs()))?;
        if rows[pivot][col].abs() < NEAR_ZERO {
            return None;
        }
        rows.swap(col, pivot);
        let scale = rows[col][col];
        for v in rows[col].iter_mut() {
            *v /= scale;
        }
        for row in 0..8 {
            if row == col {
                continue;
            }
            let factor = rows[row][col];
            if factor == 0.0 {
                continue;
            }
            let pivot_row = rows[col];
            for (k, v) in rows[row].iter_mut().enumerate().skip(col) {
                *v -= factor * pivot_row[k];
            }
        }
    }
    let mut out = [0.0; 8];
    for (i, slot) in out.iter_mut().enumerate() {
        *slot = rows[i][8];
    }
    Some(out)
}

/// Whether four corners, in order round the shape, still make a shape a
/// picture can be laid into: convex, wound the same way all round, with area
/// to it. A corner dragged past its neighbours would otherwise fold the
/// picture over itself and the homography would put part of it behind the
/// viewer.
fn is_convex_quad(q: &[Point; 4]) -> bool {
    let mut sign = 0.0;
    for i in 0..4 {
        let (a, b, c) = (q[i], q[(i + 1) % 4], q[(i + 2) % 4]);
        let cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if cross.abs() < MIN_CORNER_AREA {
            return false;
        }
        if sign == 0.0 {
            sign = cross;
        } else if (cross > 0.0) != (sign > 0.0) {
            return false;
        }
    }
    true
}

/// How much twice-the-area a corner must keep for the quad to count as a
/// shape, in square document pixels.
const MIN_CORNER_AREA: f64 = 1.0;

impl Raster {
    /// This buffer resampled through `m` (source → destination) into a new
    /// buffer of the same size, with bilinear filtering on premultiplied
    /// colour so that edges against transparency do not go dark.
    pub fn transformed(&self, m: &Affine) -> Raster {
        self.transformed_into(m, self.width(), self.height())
    }

    /// [`Raster::transformed`] into a buffer of another size — how a smart
    /// object's source, which is whatever size the picture was, lands on the
    /// document.
    pub fn transformed_into(&self, m: &Affine, width: u32, height: u32) -> Raster {
        self.projected_into(&Projective::from(*m), width, height)
    }

    /// [`Raster::transformed_into`] through a placement that may be
    /// projective, which is what a smart object carries.
    pub fn projected_into(&self, m: &Projective, width: u32, height: u32) -> Raster {
        let mut out = Raster::new(width, height);
        let all = out.bounds();
        self.project_over(&mut out, m, &all);
        out
    }

    /// This buffer resampled through `m` and composited over `out`, inside
    /// `clip`. Redrawing part of a placement costs that part, which is what
    /// lets a free transform redraw where its box was and where it has gone
    /// rather than the whole document on every pointer event.
    pub fn transform_over(&self, out: &mut Raster, m: &Affine, clip: &Rect) {
        let Some(inv) = m.inverse() else { return };
        let placed = self.placed_corners(|p| m.apply(p));
        let reach = extent_of(&placed);
        self.resample_over(out, clip, reach, |p| Some(inv.apply(p)));
    }

    /// [`Raster::transform_over`] through a placement that may be
    /// projective. An affine one takes the affine path, which costs a
    /// multiply-add a pixel rather than a divide.
    pub fn project_over(&self, out: &mut Raster, m: &Projective, clip: &Rect) {
        if let Some(affine) = m.as_affine() {
            return self.transform_over(out, &affine, clip);
        }
        let Some(inv) = m.inverse() else { return };
        let corners = self.placed_corners(|p| p);
        let Some((min, max)) = m.image_bounds(corners) else { return };
        // Which side of the destination's own horizon the picture is on.
        // The other side holds the picture again, mirrored through the
        // vanishing line, and must not be drawn.
        let middle = m.apply(Point::new(
            f64::from(self.width()) / 2.0,
            f64::from(self.height()) / 2.0,
        ));
        let front = inv.w_at(middle).signum();
        self.resample_over(out, clip, (min, max), |p| {
            let w = inv.w_at(p);
            (w.signum() == front && w.abs() >= NEAR_ZERO).then(|| inv.apply(p))
        });
    }

    /// This buffer's four corners in its own coordinates, or wherever
    /// `place` puts them.
    fn placed_corners(&self, place: impl Fn(Point) -> Point) -> [Point; 4] {
        let (w, h) = (f64::from(self.width()), f64::from(self.height()));
        [Point::new(0.0, 0.0), Point::new(w, 0.0), Point::new(w, h), Point::new(0.0, h)].map(place)
    }

    /// Draws this buffer over `out` inside `clip`, taking each destination
    /// pixel's colour from wherever `source_of` says it came from. `reach`
    /// is where the placed picture can land at all: nothing outside it is
    /// even asked about.
    fn resample_over(&self, out: &mut Raster, clip: &Rect, reach: (Point, Point), source_of: impl Fn(Point) -> Option<Point>) {
        let area = clip.intersect(&out.bounds());
        if area.is_empty() {
            return;
        }
        let (min, max) = reach;
        let x0 = min.x.floor().max(f64::from(area.x)) as i32;
        let y0 = min.y.floor().max(f64::from(area.y)) as i32;
        let x1 = max.x.ceil().min(f64::from(area.right())) as i32;
        let y1 = max.y.ceil().min(f64::from(area.bottom())) as i32;
        for y in y0..y1 {
            for x in x0..x1 {
                let Some(src) = source_of(Point::new(f64::from(x) + 0.5, f64::from(y) + 0.5)) else { continue };
                let p = self.sample_bilinear(src.x - 0.5, src.y - 0.5);
                if p.a > 0 {
                    out.blend(x, y, p, &area);
                }
            }
        }
    }

    /// Bilinear sample at a continuous position where integer coordinates
    /// are pixel centres. Outside the buffer is transparent.
    fn sample_bilinear(&self, x: f64, y: f64) -> Rgba {
        let x0 = x.floor();
        let y0 = y.floor();
        let fx = x - x0;
        let fy = y - y0;
        let (x0, y0) = (x0 as i32, y0 as i32);
        let mut acc = [0.0f64; 4];
        let mut total_w = 0.0;
        for (dx, dy, wgt) in [(0, 0, (1.0 - fx) * (1.0 - fy)), (1, 0, fx * (1.0 - fy)), (0, 1, (1.0 - fx) * fy), (1, 1, fx * fy)] {
            if wgt <= 0.0 {
                continue;
            }
            let p = self.get(x0 + dx, y0 + dy);
            let a = f64::from(p.a) / 255.0;
            acc[0] += f64::from(p.r) * a * wgt;
            acc[1] += f64::from(p.g) * a * wgt;
            acc[2] += f64::from(p.b) * a * wgt;
            acc[3] += a * wgt;
            total_w += wgt;
        }
        if total_w <= 0.0 || acc[3] <= 0.0 {
            return Rgba::TRANSPARENT;
        }
        let a = acc[3];
        Rgba::new(
            (acc[0] / a).round().clamp(0.0, 255.0) as u8,
            (acc[1] / a).round().clamp(0.0, 255.0) as u8,
            (acc[2] / a).round().clamp(0.0, 255.0) as u8,
            (a * 255.0).round().clamp(0.0, 255.0) as u8,
        )
    }
}

// ---- The interactive session --------------------------------------------------

/// The eight handles of the transform box, in this order, which is also the
/// order [`TransformSession::handles`] reports them in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Handle {
    TopLeft,
    Top,
    TopRight,
    Right,
    BottomRight,
    Bottom,
    BottomLeft,
    Left,
}

impl Handle {
    pub const ALL: [Handle; 8] = [
        Handle::TopLeft,
        Handle::Top,
        Handle::TopRight,
        Handle::Right,
        Handle::BottomRight,
        Handle::Bottom,
        Handle::BottomLeft,
        Handle::Left,
    ];

    /// The handle's position in the unit box `[0,1]²`.
    fn unit(self) -> Point {
        match self {
            Handle::TopLeft => Point::new(0.0, 0.0),
            Handle::Top => Point::new(0.5, 0.0),
            Handle::TopRight => Point::new(1.0, 0.0),
            Handle::Right => Point::new(1.0, 0.5),
            Handle::BottomRight => Point::new(1.0, 1.0),
            Handle::Bottom => Point::new(0.5, 1.0),
            Handle::BottomLeft => Point::new(0.0, 1.0),
            Handle::Left => Point::new(0.0, 0.5),
        }
    }

    fn opposite(self) -> Handle {
        match self {
            Handle::TopLeft => Handle::BottomRight,
            Handle::Top => Handle::Bottom,
            Handle::TopRight => Handle::BottomLeft,
            Handle::Right => Handle::Left,
            Handle::BottomRight => Handle::TopLeft,
            Handle::Bottom => Handle::Top,
            Handle::BottomLeft => Handle::TopRight,
            Handle::Left => Handle::Right,
        }
    }

    fn scales_x(self) -> bool {
        !matches!(self, Handle::Top | Handle::Bottom)
    }

    fn scales_y(self) -> bool {
        !matches!(self, Handle::Left | Handle::Right)
    }

    fn is_corner(self) -> bool {
        matches!(self, Handle::TopLeft | Handle::TopRight | Handle::BottomRight | Handle::BottomLeft)
    }
}

/// Where a corner handle sits in a quadrilateral given clockwise from the
/// top left, as [`TransformSession::corners`] gives one. `None` for the four
/// handles in the middles of the edges.
fn corner_index(handle: Handle) -> Option<usize> {
    match handle {
        Handle::TopLeft => Some(0),
        Handle::TopRight => Some(1),
        Handle::BottomRight => Some(2),
        Handle::BottomLeft => Some(3),
        _ => None,
    }
}

/// The direction a quadrilateral's top edge runs in.
fn quad_angle(quad: &[Point; 4]) -> f64 {
    (quad[1].y - quad[0].y).atan2(quad[1].x - quad[0].x)
}

/// The whole-pixel shift `m` comes to, when a shift is all it is: no turn,
/// no scale, no perspective, and both offsets landing on a pixel.
fn whole_pixel_shift(m: &Projective) -> Option<(i32, i32)> {
    let m = m.as_affine()?;
    let square = m.a == 1.0 && m.b == 0.0 && m.c == 0.0 && m.d == 1.0;
    let whole = m.e.fract() == 0.0 && m.f.fract() == 0.0;
    // A placement further off than this is nowhere near the canvas, and the
    // general path deals with it rather than an overflowing cast.
    let near = m.e.abs() < f64::from(i32::MAX) && m.f.abs() < f64::from(i32::MAX);
    (square && whole && near).then_some((m.e as i32, m.f as i32))
}

/// `m` as it applies to a document of every `step`th pixel: shrink into the
/// full-size frame, place, and shrink the answer back down again.
fn reduced_matrix(m: &Projective, step: u32) -> Projective {
    let up = f64::from(step.max(1));
    let down = Projective::from(Affine::scaling(up.recip(), up.recip()));
    down.then(m).then(&Projective::from(Affine::scaling(up, up)))
}

/// What the pointer is doing to the box.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Drag {
    /// Where the pointer went down and the matrix it found, so snapping
    /// can re-derive the box from the total drag rather than nudging it
    /// step by step.
    Move { start: Point, origin: Projective },
    /// A handle drag. It reads Ctrl on every move rather than at the start,
    /// so one gesture can scale, then distort, then scale again; that only
    /// works if each move starts again from where the drag began, which is
    /// what `origin` and `quad` are for.
    Scale { handle: Handle, anchor: Point, origin: Projective, quad: [Point; 4] },
    Rotate { last_angle: f64 },
}

/// What the pointer would do at a position, for the page to pick a cursor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hit {
    Handle(Handle),
    Inside,
    /// The wheel above the box's top edge. It turns the box, as anywhere
    /// outside the box does, but it is a thing you can see and aim at —
    /// and, being a target of its own, it is not lost to whatever else the
    /// page has under that pixel.
    Wheel,
    Rotate,
}

/// How far out from the top edge the rotation wheel sits, as a multiple of
/// the grab radius — so it keeps its distance on screen at any zoom.
const WHEEL_GAP: f64 = 2.5;

#[derive(Clone, Debug)]
pub struct TransformSession {
    moving: Raster,
    stationary: Raster,
    /// The moving pixels' bounding box in their own (original) coordinates.
    bounds: Rect,
    /// Original coordinates → current document position. Affine until a
    /// corner is pulled out of square; see [`Projective`].
    matrix: Projective,
    drag: Option<Drag>,
    /// Where the selection rect was, so it can be moved with the pixels.
    selection: Option<Rect>,
}

/// The numbers the page shows while transforming.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TransformInfo {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub angle_degrees: f64,
}

impl TransformSession {
    /// Starts a session over `layer`, moving the pixels inside `selection`
    /// (or every painted pixel when there is none). Returns `None` when
    /// there is nothing to move.
    pub fn new(layer: &Raster, selection: Option<Rect>) -> Option<TransformSession> {
        let (moving, stationary, bounds) = match selection {
            Some(rect) => {
                let (inside, outside) = layer.split(&rect);
                (inside, outside, rect.intersect(&layer.bounds()))
            }
            None => (layer.clone(), Raster::new(layer.width(), layer.height()), layer.content_bounds()?),
        };
        if bounds.is_empty() {
            return None;
        }
        Some(TransformSession {
            moving,
            stationary,
            bounds,
            matrix: Projective::IDENTITY,
            drag: None,
            selection,
        })
    }

    /// A session over pixels that have already been split out — what a
    /// non-rectangular selection hands over, since only it knows which
    /// pixels it holds.
    pub fn from_parts(moving: Raster, stationary: Raster, bounds: Rect, selection: Option<Rect>) -> Option<TransformSession> {
        if bounds.is_empty() {
            return None;
        }
        Some(TransformSession { moving, stationary, bounds, matrix: Projective::IDENTITY, drag: None, selection })
    }

    /// A session that starts from a placement already made: a smart
    /// object's source (at its own size) and the transform that puts it on
    /// the document. `stationary` gives the document's size.
    pub fn placed(moving: Raster, stationary: Raster, matrix: Projective) -> Option<TransformSession> {
        let bounds = moving.bounds();
        if bounds.is_empty() {
            return None;
        }
        Some(TransformSession { moving, stationary, bounds, matrix, drag: None, selection: None })
    }

    pub fn matrix(&self) -> Projective {
        self.matrix
    }

    /// This session at `step`-to-one: the same pixels and the same placement
    /// in a document of every `step`th pixel. A drag previews on one of
    /// these while the canvas is zoomed out far enough that the screen
    /// cannot tell, so that dragging a layer the size of a 4K canvas costs a
    /// sixteenth of the pixels a frame. [`TransformSession::follow`] keeps
    /// it in step with the drag; the document itself is left alone until the
    /// session commits, which is the one full-size pass.
    pub fn reduced(&self, step: u32) -> TransformSession {
        let s = step.max(1) as i32;
        // The box only ever covers pixels that are in the buffer, so these
        // are never negative and plain division rounds the way it should.
        let up = |v: i32| (v + s - 1) / s;
        let (x0, y0) = (self.bounds.x / s, self.bounds.y / s);
        let (x1, y1) = (up(self.bounds.right()), up(self.bounds.bottom()));
        TransformSession {
            moving: self.moving.downscaled(step),
            stationary: self.stationary.downscaled(step),
            bounds: Rect::new(x0, y0, x1 - x0, y1 - y0),
            matrix: reduced_matrix(&self.matrix, step),
            drag: None,
            selection: None,
        }
    }

    /// Takes `matrix` at this session's scale: what a reduced twin does on
    /// every pointer event, so that what is previewed is the drag itself.
    pub fn follow(&mut self, matrix: &Projective, step: u32) {
        self.matrix = reduced_matrix(matrix, step);
    }

    pub fn is_dragging(&self) -> bool {
        self.drag.is_some()
    }

    /// A point of the original box, given in unit coordinates, where it is now.
    fn box_point(&self, unit: Point) -> Point {
        self.matrix.apply(Point::new(
            f64::from(self.bounds.x) + unit.x * f64::from(self.bounds.w),
            f64::from(self.bounds.y) + unit.y * f64::from(self.bounds.h),
        ))
    }

    fn centre(&self) -> Point {
        self.box_point(Point::new(0.5, 0.5))
    }

    /// The eight handles in document space, in [`Handle::ALL`] order.
    pub fn handles(&self) -> [Point; 8] {
        Handle::ALL.map(|h| self.box_point(h.unit()))
    }

    /// The four corners in document space, clockwise from top-left.
    pub fn corners(&self) -> [Point; 4] {
        [Handle::TopLeft, Handle::TopRight, Handle::BottomRight, Handle::BottomLeft].map(|h| self.box_point(h.unit()))
    }

    pub fn info(&self) -> TransformInfo {
        let (sx, sy) = self.scale();
        let tl = self.box_point(Point::new(0.0, 0.0));
        TransformInfo {
            x: tl.x,
            y: tl.y,
            width: f64::from(self.bounds.w) * sx,
            height: f64::from(self.bounds.h) * sy,
            scale_x: sx,
            scale_y: sy,
            angle_degrees: self.angle().to_degrees(),
        }
    }

    /// The direction the box's top edge runs in. Everything that works
    /// "along the box's own axes" — a scale, a flip, the size fields —
    /// measures from this rather than from the matrix, so that it still
    /// means something once a corner has been pulled out of square.
    fn angle(&self) -> f64 {
        let [tl, tr, ..] = self.corners();
        (tr.y - tl.y).atan2(tr.x - tl.x)
    }

    /// How far the box has been stretched along each of its own axes, as a
    /// multiple of the original.
    fn scale(&self) -> (f64, f64) {
        let [tl, tr, _, bl] = self.corners();
        let along = |a: Point, b: Point, n: i32| a.distance_to(b) / f64::from(n.max(1));
        (along(tl, tr, self.bounds.w), along(tl, bl, self.bounds.h))
    }

    /// The box's four corners in the moving buffer's own coordinates, in
    /// the same order as [`TransformSession::corners`]. A distortion is
    /// stated as where these four are to land.
    fn source_corners(&self) -> [Point; 4] {
        let b = self.bounds;
        let (x0, y0) = (f64::from(b.x), f64::from(b.y));
        let (x1, y1) = (f64::from(b.right()), f64::from(b.bottom()));
        [Point::new(x0, y0), Point::new(x1, y0), Point::new(x1, y1), Point::new(x0, y1)]
    }

    /// Places the box's four corners on `dst`, which is what a distorted,
    /// skewed or foreshortened drag asks for. Refuses a quadrilateral that
    /// has folded over or collapsed, so the picture is never turned inside
    /// out: the drag simply stops following the pointer there.
    fn set_corners(&mut self, dst: [Point; 4]) -> bool {
        if !is_convex_quad(&dst) {
            return false;
        }
        match Projective::from_quad(self.source_corners(), dst) {
            Some(m) => {
                self.matrix = m;
                true
            }
            None => false,
        }
    }

    /// Where the rotation wheel sits: out beyond the middle of the top
    /// edge, along that edge's outward normal, so it stands off the box
    /// whichever way the box has been turned. `tolerance` is the grab
    /// radius in document pixels, which is what makes the gap a constant
    /// size on screen.
    pub fn wheel(&self, tolerance: f64) -> Point {
        let top = self.box_point(Handle::Top.unit());
        let [tl, tr, ..] = self.corners();
        let edge = (tr.x - tl.x, tr.y - tl.y);
        let length = edge.0.hypot(edge.1);
        // A box squashed to nothing has no edge to stand off from; up will do.
        let normal = if length < 1e-9 { (0.0, -1.0) } else { (edge.1 / length, -edge.0 / length) };
        let centre = self.centre();
        let outward = if (top.x - centre.x) * normal.0 + (top.y - centre.y) * normal.1 >= 0.0 { 1.0 } else { -1.0 };
        let gap = tolerance * WHEEL_GAP * outward;
        Point::new(top.x + normal.0 * gap, top.y + normal.1 * gap)
    }

    /// What is under `p`. `tolerance` is how close counts as on a handle, in
    /// document pixels — pass something like `8 / zoom` so it is a constant
    /// size on screen.
    pub fn hit(&self, p: Point, tolerance: f64) -> Hit {
        // The wheel is asked about first: it sits outside the box, where
        // every pixel turns it anyway, so nothing is taken away from the
        // handles by letting it have its own answer.
        if self.wheel(tolerance).distance_to(p) <= tolerance {
            return Hit::Wheel;
        }
        for (handle, pos) in Handle::ALL.iter().zip(self.handles()) {
            if pos.distance_to(p) <= tolerance {
                return Hit::Handle(*handle);
            }
        }
        if self.contains(p) {
            return Hit::Inside;
        }
        // Anywhere outside the box turns it. A ring round the corners is a
        // small target to aim at and gives nothing at all when overshot,
        // and the further out the grip, the finer the angle it sets.
        Hit::Rotate
    }

    fn contains(&self, p: Point) -> bool {
        let Some(inv) = self.matrix.inverse() else { return false };
        let local = inv.apply(p);
        let b = self.bounds;
        local.x >= f64::from(b.x)
            && local.x <= f64::from(b.right())
            && local.y >= f64::from(b.y)
            && local.y <= f64::from(b.bottom())
    }

    /// Begins a move from `p`, wherever `p` is — the move tool grabs a smart
    /// object anywhere, handles or no handles.
    pub fn begin_move(&mut self, p: Point) {
        self.drag = Some(Drag::Move { start: p, origin: self.matrix });
    }

    /// Begins a drag: a handle scales, inside the box moves, outside it
    /// turns. Every point on the canvas does one of the three.
    pub fn pointer_down(&mut self, p: Point, tolerance: f64) {
        self.drag = Some(match self.hit(p, tolerance) {
            Hit::Handle(handle) => Drag::Scale {
                handle,
                anchor: self.box_point(handle.opposite().unit()),
                origin: self.matrix,
                quad: self.corners(),
            },
            Hit::Inside => Drag::Move { start: p, origin: self.matrix },
            Hit::Wheel | Hit::Rotate => {
                let c = self.centre();
                Drag::Rotate { last_angle: (p.y - c.y).atan2(p.x - c.x) }
            }
        });
    }

    /// Continues a drag. `shift` keeps scaling proportional and snaps
    /// rotation to 15°; `alt` scales about the centre instead of the
    /// opposite handle. Returns whether the matrix changed.
    pub fn pointer_move(&mut self, p: Point, shift: bool, alt: bool) -> bool {
        self.pointer_move_snapped(p, shift, alt, false, None)
    }

    /// [`TransformSession::pointer_move`] with the 3D modifier and guides to
    /// snap to: a move pulls the box's edges and centre onto them, a scale
    /// pulls the handle.
    ///
    /// `ctrl` takes the handle out of the box's own rectangle and into the
    /// plane: a corner goes wherever the pointer does (with `shift`, so does
    /// its mirror image, which is what foreshortens the opposite edge), and
    /// an edge handle slides its edge sideways. Any of the three leaves a
    /// placement that is no longer affine — see [`Projective`].
    pub fn pointer_move_snapped(&mut self, p: Point, shift: bool, alt: bool, ctrl: bool, snap: Option<&Snap>) -> bool {
        let Some(drag) = self.drag else { return false };
        match drag {
            Drag::Move { start, origin } => {
                self.matrix = origin.after(&Affine::translation(p.x - start.x, p.y - start.y));
                if let Some(snap) = snap {
                    let c = self.centre();
                    let corners = self.corners();
                    let xs: Vec<f64> = corners.iter().map(|q| q.x).chain([c.x]).collect();
                    let ys: Vec<f64> = corners.iter().map(|q| q.y).chain([c.y]).collect();
                    let (dx, dy) = snap.offset(&xs, &ys);
                    self.translate(dx, dy);
                }
            }
            Drag::Scale { handle, anchor, origin, quad } => {
                let p = snap.map_or(p, |s| s.point(p));
                if ctrl {
                    return self.drag_in_plane(handle, quad, p, shift);
                }
                self.matrix = origin;
                let anchor = if alt { self.centre() } else { anchor };
                self.scale_towards(handle, anchor, p, shift);
            }
            Drag::Rotate { last_angle } => {
                let c = self.centre();
                let angle = (p.y - c.y).atan2(p.x - c.x);
                let mut delta = angle - last_angle;
                if shift {
                    let step = 15f64.to_radians();
                    let current = self.angle();
                    let target = ((current + delta) / step).round() * step;
                    delta = target - current;
                }
                self.rotate_about(delta, c);
                self.drag = Some(Drag::Rotate { last_angle: angle });
            }
        }
        true
    }

    /// The Ctrl half of a handle drag, from the box as it stood when the
    /// drag began: a corner to where the pointer is, an edge along itself.
    ///
    /// `mirror` is Shift on a corner: the corner's movement across the box
    /// is answered by the opposite end of its own edge moving the other way,
    /// and its movement along the box by the far end of the side it is on.
    /// Each shortens an edge about its middle, which is what a plane turned
    /// away from the viewer does to the edge going away.
    fn drag_in_plane(&mut self, handle: Handle, quad: [Point; 4], p: Point, mirror: bool) -> bool {
        let Some(index) = corner_index(handle) else {
            return self.skew_edge(handle, quad, p);
        };
        let mut dst = quad;
        dst[index] = p;
        if mirror {
            let (s, c) = quad_angle(&quad).sin_cos();
            let (ux, uy) = ((c, s), (-s, c));
            let d = (p.x - quad[index].x, p.y - quad[index].y);
            let dot = |v: (f64, f64), u: (f64, f64)| v.0 * u.0 + v.1 * u.1;
            let (along, across) = (dot(d, ux), dot(d, uy));
            let shift = |q: Point, k: f64, u: (f64, f64)| Point::new(q.x + k * u.0, q.y + k * u.1);
            // Across the top of the box (0,1) and (3,2) are paired; down its
            // side (0,3) and (1,2) are.
            let row = [1, 0, 3, 2][index];
            let column = [3, 2, 1, 0][index];
            dst[row] = shift(quad[row], -along, ux);
            dst[column] = shift(quad[column], -across, uy);
        }
        self.set_corners(dst)
    }

    /// An edge handle dragged with Ctrl: the edge slides along its own
    /// direction, which shears the picture.
    fn skew_edge(&mut self, handle: Handle, quad: [Point; 4], p: Point) -> bool {
        let (ends, axis) = match handle {
            Handle::Top => ([0, 1], true),
            Handle::Bottom => ([3, 2], true),
            Handle::Left => ([0, 3], false),
            Handle::Right => ([1, 2], false),
            _ => return false,
        };
        let (s, c) = quad_angle(&quad).sin_cos();
        let along = if axis { (c, s) } else { (-s, c) };
        let was = Point::new((quad[ends[0]].x + quad[ends[1]].x) / 2.0, (quad[ends[0]].y + quad[ends[1]].y) / 2.0);
        let slide = (p.x - was.x) * along.0 + (p.y - was.y) * along.1;
        let mut dst = quad;
        for i in ends {
            dst[i] = Point::new(quad[i].x + slide * along.0, quad[i].y + slide * along.1);
        }
        self.set_corners(dst)
    }

    pub fn pointer_up(&mut self) {
        self.drag = None;
    }

    pub fn translate(&mut self, dx: f64, dy: f64) {
        self.matrix = self.matrix.after(&Affine::translation(dx, dy));
    }

    pub fn rotate_about(&mut self, radians: f64, about: Point) {
        self.matrix = self.matrix.pre_about(&Affine::rotation(radians), about);
    }

    /// Rotates about the box centre — the menu's "rotate 90°" while
    /// transforming.
    pub fn rotate(&mut self, radians: f64) {
        let c = self.centre();
        self.rotate_about(radians, c);
    }

    pub fn flip_horizontal(&mut self) {
        self.flip(-1.0, 1.0);
    }

    pub fn flip_vertical(&mut self) {
        self.flip(1.0, -1.0);
    }

    /// Moves the box so its top-left corner lands on `(x, y)`.
    pub fn set_position(&mut self, x: f64, y: f64) {
        let tl = self.box_point(Point::new(0.0, 0.0));
        self.translate(x - tl.x, y - tl.y);
    }

    /// Scales the box, about its top-left corner and along its own axes, to
    /// `width` by `height` document pixels.
    pub fn set_size(&mut self, width: f64, height: f64) {
        let (sx, sy) = self.scale();
        let kx = width / (f64::from(self.bounds.w) * sx).max(1e-9);
        let ky = height / (f64::from(self.bounds.h) * sy).max(1e-9);
        let tl = self.box_point(Point::new(0.0, 0.0));
        let theta = self.angle();
        let in_frame = Affine::rotation(theta).then(&Affine::scaling(kx.max(0.01), ky.max(0.01))).then(&Affine::rotation(-theta));
        self.matrix = self.matrix.pre_about(&in_frame, tl);
    }

    /// Turns the box, about its centre, to an absolute angle.
    pub fn set_angle(&mut self, radians: f64) {
        let delta = radians - self.angle();
        self.rotate(delta);
    }

    /// Mirrors along the box's own axes, about its centre.
    fn flip(&mut self, sx: f64, sy: f64) {
        let c = self.centre();
        let theta = self.angle();
        let in_frame = Affine::rotation(theta).then(&Affine::scaling(sx, sy)).then(&Affine::rotation(-theta));
        self.matrix = self.matrix.pre_about(&in_frame, c);
    }

    /// Scales so that `handle` lands on `target` while `anchor` stays put,
    /// measured along the box's own (possibly rotated) axes.
    fn scale_towards(&mut self, handle: Handle, anchor: Point, target: Point, proportional: bool) {
        let theta = self.angle();
        let (s, c) = theta.sin_cos();
        let ux = (c, s);
        let uy = (-s, c);
        let dot = |v: (f64, f64), u: (f64, f64)| v.0 * u.0 + v.1 * u.1;
        let current = self.box_point(handle.unit());
        let cur = (current.x - anchor.x, current.y - anchor.y);
        let tgt = (target.x - anchor.x, target.y - anchor.y);
        let ratio = |axis: (f64, f64)| {
            let denom = dot(cur, axis);
            if denom.abs() < 1e-9 {
                1.0
            } else {
                dot(tgt, axis) / denom
            }
        };
        let mut kx = if handle.scales_x() { ratio(ux) } else { 1.0 };
        let mut ky = if handle.scales_y() { ratio(uy) } else { 1.0 };
        if proportional && handle.is_corner() {
            // Follow the axis the pointer has pulled further along, keeping
            // the signs so a drag through the anchor still mirrors.
            let k = if kx.abs() > ky.abs() { kx.abs() } else { ky.abs() };
            kx = k.copysign(kx);
            ky = k.copysign(ky);
        }
        // Refuse to collapse the box entirely; the matrix would not invert.
        let floor = |k: f64| if k.abs() < 0.01 { 0.01f64.copysign(k) } else { k };
        let in_frame = Affine::rotation(theta).then(&Affine::scaling(floor(kx), floor(ky))).then(&Affine::rotation(-theta));
        self.matrix = self.matrix.pre_about(&in_frame, anchor);
    }

    /// The layer as it looks with the transform applied.
    pub fn render(&self) -> Raster {
        let mut out = self.stationary.clone();
        let all = out.bounds();
        self.render_into(&mut out, &all);
        out
    }

    /// [`TransformSession::render`] into a buffer that already holds an
    /// earlier rendering of this session, redrawing only `clip`. Everything
    /// outside `clip` is left alone, so the caller has to have covered
    /// wherever the moving pixels have been since.
    pub fn render_into(&self, out: &mut Raster, clip: &Rect) {
        out.copy_from(&self.stationary, clip);
        match whole_pixel_shift(&self.matrix) {
            // Resampling a placement that is only a shift by whole pixels
            // gives back exactly the pixels it started from, so they are
            // laid down as they are. This is the common case — dragging a
            // placed picture about — and it is where the bilinear pass
            // costs the most, since nothing has moved off its own pixel.
            Some((dx, dy)) => out.merge_translated_in(&self.moving, dx, dy, clip),
            None => self.moving.project_over(out, &self.matrix, clip),
        }
    }

    /// Where in the document the moved pixels can land: the box's corners
    /// where they are now, grown by a pixel for the resampling at its edge.
    /// Nothing [`TransformSession::render`] draws falls outside it, so it is
    /// all a preview has to redraw.
    pub fn rendered_bounds(&self) -> Rect {
        let corners = self.corners();
        let x0 = corners.iter().map(|p| p.x).fold(f64::INFINITY, f64::min).floor() as i32;
        let y0 = corners.iter().map(|p| p.y).fold(f64::INFINITY, f64::min).floor() as i32;
        let x1 = corners.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max).ceil() as i32;
        let y1 = corners.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max).ceil() as i32;
        Rect::new(x0, y0, x1 - x0, y1 - y0).inflate(1)
    }

    /// Where the selection rect should be after the transform: the bounding
    /// box of the moved box, if the session started with a selection.
    pub fn moved_selection(&self) -> Option<Rect> {
        self.selection?;
        let corners = self.corners();
        let x0 = corners.iter().map(|p| p.x).fold(f64::INFINITY, f64::min).round() as i32;
        let y0 = corners.iter().map(|p| p.y).fold(f64::INFINITY, f64::min).round() as i32;
        let x1 = corners.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max).round() as i32;
        let y1 = corners.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max).round() as i32;
        Some(Rect::new(x0, y0, x1 - x0, y1 - y0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: Rgba = Rgba::opaque(255, 0, 0);

    fn close(a: Point, b: Point) -> bool {
        (a.x - b.x).abs() < 1e-6 && (a.y - b.y).abs() < 1e-6
    }

    #[test]
    fn affine_composition_and_inverse() {
        let m = Affine::translation(10.0, 5.0).then(&Affine::rotation(std::f64::consts::FRAC_PI_2)).then(&Affine::scaling(2.0, 3.0));
        let p = Point::new(1.0, 1.0);
        // scale → (2,3); rotate 90° → (-3,2); translate → (7,7)
        assert!(close(m.apply(p), Point::new(7.0, 7.0)), "{:?}", m.apply(p));
        let inv = m.inverse().unwrap();
        assert!(close(inv.apply(m.apply(p)), p));
        assert!((m.angle() - std::f64::consts::FRAC_PI_2).abs() < 1e-9);
        let (sx, sy) = m.scale();
        assert!((sx - 2.0).abs() < 1e-9 && (sy - 3.0).abs() < 1e-9);
        assert!(Affine::scaling(0.0, 1.0).inverse().is_none());
    }

    #[test]
    fn pre_about_keeps_the_pivot_fixed() {
        let pivot = Point::new(4.0, 9.0);
        let m = Affine::IDENTITY.pre_about(&Affine::rotation(1.0), pivot);
        assert!(close(m.apply(pivot), pivot));
    }

    #[test]
    fn identity_resample_is_exact() {
        let mut r = Raster::new(5, 5);
        r.set(2, 2, RED);
        r.set(0, 4, Rgba::new(0, 0, 255, 128));
        assert_eq!(r.transformed(&Affine::IDENTITY), r);
    }

    #[test]
    fn whole_pixel_translation_is_exact() {
        let mut r = Raster::new(5, 5);
        r.set(1, 1, RED);
        let t = r.transformed(&Affine::translation(2.0, 1.0));
        assert_eq!(t.get(3, 2), RED);
        assert_eq!(t.pixels().iter().filter(|p| p.a > 0).count(), 1);
    }

    #[test]
    fn half_pixel_translation_spreads_with_premultiplied_colour() {
        let mut r = Raster::new(4, 1);
        r.set(1, 0, RED);
        let t = r.transformed(&Affine::translation(0.5, 0.0));
        assert_eq!(t.get(1, 0).a, 128);
        assert_eq!(t.get(2, 0).a, 128);
        assert_eq!((t.get(2, 0).r, t.get(2, 0).g), (255, 0), "no darkening against transparency");
    }

    #[test]
    fn doubling_a_block_about_its_corner() {
        let mut r = Raster::new(8, 8);
        r.fill_rect(Rect::new(0, 0, 2, 2), RED, &Rect::new(0, 0, 8, 8));
        let t = r.transformed(&Affine::scaling(2.0, 2.0));
        // Bilinear: the interior is solid, the edge pixels are partial, and
        // the coverage (total alpha) is the same as four times the source.
        assert_eq!(t.pixels().iter().filter(|p| p.a == 255).count(), 4);
        assert_eq!(t.get(2, 2), RED);
        assert!(t.get(3, 3).a > 0 && t.get(3, 3).a < 255);
        assert_eq!(t.get(5, 5), Rgba::TRANSPARENT);
        // Bilinear against transparency loses a little at the border, but
        // most of the mass survives.
        let coverage: u32 = t.pixels().iter().map(|p| u32::from(p.a)).sum();
        assert!(coverage > 16 * 255 * 8 / 10 && coverage <= 16 * 255, "coverage {coverage}");
    }

    fn layer() -> Raster {
        let mut r = Raster::new(20, 20);
        r.fill_rect(Rect::new(4, 4, 6, 4), RED, &Rect::new(0, 0, 20, 20));
        r
    }

    #[test]
    fn redrawing_part_of_a_transform_agrees_with_redrawing_all_of_it() {
        // A preview redraws only where the box was and where it has gone.
        // What it leaves behind has to be what a whole rendering would have
        // put there, or the picture keeps a smear of the last frame.
        fn check(session: &mut TransformSession, change: impl Fn(&mut TransformSession), what: &str) {
            let mut patched = session.render();
            let was = session.rendered_bounds();
            change(session);
            let dirty = was.union(&session.rendered_bounds());
            session.render_into(&mut patched, &dirty);
            assert_eq!(patched, session.render(), "{what}");
        }
        // Over an empty document, as a smart object is, and over pixels that
        // stay put, as a selection's transform is.
        let opaque = Raster::filled(20, 20, Rgba::opaque(0, 0, 255));
        for stationary in [Raster::new(20, 20), opaque] {
            let make = || TransformSession::placed(layer(), stationary.clone(), Affine::translation(2.0, 1.0).into()).unwrap();
            check(&mut make(), |s| s.translate(3.0, -2.0), "moved");
            check(&mut make(), |s| s.rotate(0.4), "turned");
            check(&mut make(), |s| s.set_size(11.0, 3.0), "scaled");
            check(
                &mut make(),
                |s| {
                    s.set_corners([Point::new(5.0, 4.0), Point::new(22.0, 1.0), Point::new(22.0, 21.0), Point::new(2.0, 21.0)]);
                },
                "put in perspective",
            );
        }
        check(&mut TransformSession::new(&layer(), None).unwrap(), |s| s.translate(3.0, -2.0), "a layer moved");
    }

    #[test]
    fn a_whole_pixel_shift_lays_the_pixels_down_untouched() {
        // The fast path has to give what the resampling would have, or a
        // placed picture would come out subtly different from a dragged one.
        let source = layer();
        let mut s = TransformSession::placed(source.clone(), Raster::filled(20, 20, Rgba::opaque(0, 0, 255)), Projective::IDENTITY).unwrap();
        s.translate(3.0, -2.0);
        let resampled = {
            let mut out = Raster::filled(20, 20, Rgba::opaque(0, 0, 255));
            let all = out.bounds();
            source.transform_over(&mut out, &Affine::translation(3.0, -2.0), &all);
            out
        };
        assert_eq!(s.render(), resampled, "the shift and the resampling agree");
        assert_eq!(s.render().get(7, 2), RED, "and the pixels went where they were sent");

        // Half a pixel is not a shift, and still goes through the resampling.
        s.translate(0.5, 0.0);
        assert_ne!(s.render(), resampled);
    }

    #[test]
    fn session_starts_on_the_content_or_the_selection() {
        let s = TransformSession::new(&layer(), None).unwrap();
        assert!(close(s.handles()[0], Point::new(4.0, 4.0)));
        assert!(close(s.handles()[4], Point::new(10.0, 8.0)));
        let s = TransformSession::new(&layer(), Some(Rect::new(0, 0, 10, 10))).unwrap();
        assert!(close(s.handles()[4], Point::new(10.0, 10.0)));
        assert!(TransformSession::new(&Raster::new(5, 5), None).is_none(), "nothing to transform");
    }

    #[test]
    fn moving_drags_the_pixels_and_the_selection() {
        let mut s = TransformSession::new(&layer(), Some(Rect::new(4, 4, 6, 4))).unwrap();
        s.pointer_down(Point::new(6.0, 6.0), 0.5);
        assert!(matches!(s.drag, Some(Drag::Move { .. })));
        s.pointer_move(Point::new(9.0, 8.0), false, false);
        s.pointer_up();
        let out = s.render();
        assert_eq!(out.get(7, 6), RED);
        assert_eq!(out.get(4, 4), Rgba::TRANSPARENT);
        assert_eq!(s.moved_selection(), Some(Rect::new(7, 6, 6, 4)));
        let info = s.info();
        assert!((info.x - 7.0).abs() < 1e-9 && (info.angle_degrees).abs() < 1e-9);
    }

    #[test]
    fn scaling_by_a_corner_keeps_the_opposite_corner() {
        let mut s = TransformSession::new(&layer(), None).unwrap();
        s.pointer_down(Point::new(10.0, 8.0), 0.5); // bottom-right
        s.pointer_move(Point::new(16.0, 12.0), false, false);
        let h = s.handles();
        assert!(close(h[0], Point::new(4.0, 4.0)), "top-left stayed: {:?}", h[0]);
        assert!(close(h[4], Point::new(16.0, 12.0)), "bottom-right followed: {:?}", h[4]);
        let info = s.info();
        assert!((info.scale_x - 2.0).abs() < 1e-9 && (info.scale_y - 2.0).abs() < 1e-9);
        let out = s.render();
        assert_eq!(out.get(13, 10), RED);
    }

    #[test]
    fn the_wheel_stands_off_the_top_edge_and_turns_the_box() {
        let mut s = TransformSession::new(&layer(), None).unwrap();
        // The box is (4,4)-(10,8), so the middle of its top edge is (7,4)
        // and the wheel stands off it by two and a half grab radii.
        let wheel = s.wheel(1.0);
        assert!(close(wheel, Point::new(7.0, 1.5)), "{wheel:?}");
        assert_eq!(s.hit(wheel, 1.0), Hit::Wheel);
        assert_eq!(s.hit(Point::new(7.0, 4.0), 1.0), Hit::Handle(Handle::Top), "and it has not taken the handle's place");

        // Dragging it turns the box about its centre, as anywhere outside
        // the box does.
        s.pointer_down(wheel, 1.0);
        assert!(s.pointer_move(Point::new(12.0, 6.0), false, false));
        s.pointer_up();
        assert!((s.info().angle_degrees - 90.0).abs() < 1e-6, "{:?}", s.info());
        // And the wheel has gone round with it: still off the top edge,
        // which now faces right.
        let turned = s.wheel(1.0);
        assert!(close(turned, Point::new(s.centre().x + 4.5, s.centre().y)), "{turned:?}");
    }

    // ---- The 3D transform: Ctrl on a handle ----------------------------------

    #[test]
    fn a_homography_takes_the_four_corners_where_it_is_told() {
        let src = [Point::new(0.0, 0.0), Point::new(4.0, 0.0), Point::new(4.0, 4.0), Point::new(0.0, 4.0)];
        let dst = [Point::new(0.0, 0.0), Point::new(8.0, 1.0), Point::new(6.0, 9.0), Point::new(1.0, 5.0)];
        let m = Projective::from_quad(src, dst).unwrap();
        for (a, b) in src.iter().zip(dst) {
            assert!(close(m.apply(*a), b), "{:?} → {:?}", a, m.apply(*a));
        }
        assert!(m.as_affine().is_none(), "four corners that are not a parallelogram are not affine");
        let inv = m.inverse().unwrap();
        assert!(close(inv.apply(m.apply(src[2])), src[2]));
        // Three corners in a line settle nothing.
        let flat = [Point::new(0.0, 0.0), Point::new(1.0, 0.0), Point::new(2.0, 0.0), Point::new(3.0, 0.0)];
        assert!(Projective::from_quad(src, flat).is_none());
    }

    #[test]
    fn an_affine_placement_is_still_recognised_as_one() {
        let m = Affine::translation(3.0, 2.0).then(&Affine::rotation(0.7)).then(&Affine::scaling(2.0, 0.5));
        let p = Projective::from(m);
        assert_eq!(p.as_affine(), Some(m));
        // And the two renderers agree pixel for pixel on it.
        let mut source = Raster::new(16, 16);
        source.fill_rect(Rect::new(2, 2, 9, 5), RED, &Rect::new(0, 0, 16, 16));
        let mut affine = Raster::new(16, 16);
        let mut projective = Raster::new(16, 16);
        let all = affine.bounds();
        source.transform_over(&mut affine, &m, &all);
        source.project_over(&mut projective, &p, &all);
        assert_eq!(affine, projective);
    }

    #[test]
    fn a_picture_laid_into_a_trapezoid_fills_it() {
        let source = Raster::filled(8, 8, RED);
        let dst = [Point::new(2.0, 0.0), Point::new(6.0, 0.0), Point::new(8.0, 8.0), Point::new(0.0, 8.0)];
        let src = [Point::new(0.0, 0.0), Point::new(8.0, 0.0), Point::new(8.0, 8.0), Point::new(0.0, 8.0)];
        let m = Projective::from_quad(src, dst).unwrap();
        let out = source.projected_into(&m, 8, 8);
        assert_eq!(out.get(4, 1), RED, "the narrow end is filled");
        assert!(out.get(2, 7).a > 0 && out.get(2, 7).r == 255, "and so is the wide one");
        assert_eq!(out.get(0, 0).a, 0, "outside the shape, nothing");
        assert_eq!(out.get(7, 1).a, 0);
    }

    #[test]
    fn ctrl_takes_a_corner_wherever_the_pointer_goes() {
        let mut s = TransformSession::new(&layer(), None).unwrap();
        let was = s.corners();
        s.pointer_down(Point::new(4.0, 4.0), 0.5); // the top-left corner
        assert!(s.pointer_move_snapped(Point::new(1.0, 1.0), false, false, true, None));
        let now = s.corners();
        assert!(close(now[0], Point::new(1.0, 1.0)), "the corner followed the pointer: {:?}", now[0]);
        for i in 1..4 {
            assert!(close(now[i], was[i]), "the other three stayed: {:?}", now[i]);
        }
        assert!(s.matrix().as_affine().is_none(), "a corner out of square is no longer an affine placement");
        // Ctrl is read on every move, so letting it go part-way through the
        // same drag scales from where the drag began rather than from the
        // distortion.
        assert!(s.pointer_move_snapped(Point::new(1.0, 1.0), false, false, false, None));
        assert!(s.matrix().as_affine().is_some(), "and the box is square again");
    }

    #[test]
    fn ctrl_and_shift_foreshorten_the_opposite_edge() {
        let mut s = TransformSession::new(&layer(), None).unwrap();
        s.pointer_down(Point::new(4.0, 4.0), 0.5);
        // The top-left corner two pixels out to the left: the top-right one
        // answers by going two out to the right.
        assert!(s.pointer_move_snapped(Point::new(2.0, 4.0), true, false, true, None));
        let c = s.corners();
        assert!(close(c[0], Point::new(2.0, 4.0)), "{:?}", c[0]);
        assert!(close(c[1], Point::new(12.0, 4.0)), "{:?}", c[1]);
        assert!(close(c[2], Point::new(10.0, 8.0)) && close(c[3], Point::new(4.0, 8.0)), "the bottom is untouched");
        assert!(s.matrix().as_affine().is_none());
        // The picture is still the same width about the same middle: a
        // plane turned away, not a plane dragged sideways.
        assert!(((c[0].x + c[1].x) / 2.0 - 7.0).abs() < 1e-9);
    }

    #[test]
    fn ctrl_on_an_edge_handle_shears() {
        let mut s = TransformSession::new(&layer(), None).unwrap();
        s.pointer_down(Point::new(7.0, 4.0), 0.5); // the top edge
        assert!(s.pointer_move_snapped(Point::new(10.0, 9.0), false, false, true, None));
        let c = s.corners();
        assert!(close(c[0], Point::new(7.0, 4.0)) && close(c[1], Point::new(13.0, 4.0)), "the top slid along itself");
        assert!(close(c[2], Point::new(10.0, 8.0)) && close(c[3], Point::new(4.0, 8.0)), "the bottom stayed");
        assert!(s.matrix().as_affine().is_some(), "a shear is still affine");
    }

    #[test]
    fn a_corner_dragged_through_the_shape_is_refused() {
        let mut s = TransformSession::new(&layer(), None).unwrap();
        s.pointer_down(Point::new(4.0, 4.0), 0.5);
        let was = s.matrix();
        // Past the opposite corner: the quadrilateral would fold over and
        // the picture would come out inside itself.
        assert!(!s.pointer_move_snapped(Point::new(20.0, 20.0), false, false, true, None));
        assert_eq!(s.matrix(), was, "the box is left where it was");
    }

    #[test]
    fn a_distorted_box_still_reads_as_a_box() {
        let mut s = TransformSession::new(&layer(), None).unwrap();
        s.pointer_down(Point::new(4.0, 4.0), 0.5);
        s.pointer_move_snapped(Point::new(2.0, 2.0), false, false, true, None);
        s.pointer_up();
        // Inside the shape is still inside it, and the numbers the bar
        // shows come off the corners rather than off a matrix that no
        // longer decomposes.
        assert_eq!(s.hit(Point::new(7.0, 6.0), 0.5), Hit::Inside);
        assert_eq!(s.hit(Point::new(30.0, 30.0), 0.5), Hit::Rotate);
        assert_eq!(s.hit(Point::new(2.0, 2.0), 0.5), Hit::Handle(Handle::TopLeft));
        let info = s.info();
        assert!((info.x - 2.0).abs() < 1e-9 && (info.y - 2.0).abs() < 1e-9);
        assert!(info.width > 6.0 && info.height > 4.0, "the box grew: {info:?}");
        // And it can still be moved as a whole.
        s.translate(1.0, 0.0);
        assert!(close(s.corners()[0], Point::new(3.0, 2.0)));
    }

    #[test]
    fn edge_handles_scale_one_axis() {
        let mut s = TransformSession::new(&layer(), None).unwrap();
        s.pointer_down(Point::new(10.0, 6.0), 0.5); // right edge
        s.pointer_move(Point::new(13.0, 2.0), false, false);
        let (sx, sy) = s.matrix().as_affine().unwrap().scale();
        assert!((sx - 1.5).abs() < 1e-9, "sx {sx}");
        assert!((sy - 1.0).abs() < 1e-9, "sy {sy}");
    }

    #[test]
    fn shift_keeps_corner_scaling_proportional() {
        let mut s = TransformSession::new(&layer(), None).unwrap();
        s.pointer_down(Point::new(10.0, 8.0), 0.5);
        s.pointer_move(Point::new(16.0, 9.0), true, false);
        let (sx, sy) = s.matrix().as_affine().unwrap().scale();
        assert!((sx - sy).abs() < 1e-9);
        assert!((sx - 2.0).abs() < 1e-9);
    }

    #[test]
    fn alt_scales_about_the_centre() {
        let mut s = TransformSession::new(&layer(), None).unwrap();
        let before = s.centre();
        s.pointer_down(Point::new(10.0, 8.0), 0.5);
        s.pointer_move(Point::new(13.0, 10.0), false, true);
        assert!(close(s.centre(), before));
        let (sx, _) = s.matrix().as_affine().unwrap().scale();
        assert!((sx - 2.0).abs() < 1e-9, "6 → 12 wide about the centre");
    }

    #[test]
    fn rotating_near_a_corner() {
        let mut s = TransformSession::new(&layer(), None).unwrap();
        let c = s.centre();
        // Just outside the bottom-right corner.
        assert_eq!(s.hit(Point::new(11.0, 9.0), 0.5), Hit::Rotate);
        s.pointer_down(Point::new(11.0, 9.0), 0.5);
        // Sweep a quarter turn around the centre.
        let r = Point::new(11.0, 9.0).distance_to(c);
        let a0 = (9.0 - c.y).atan2(11.0 - c.x);
        let a1 = a0 + std::f64::consts::FRAC_PI_2;
        s.pointer_move(Point::new(c.x + r * a1.cos(), c.y + r * a1.sin()), false, false);
        assert!((s.info().angle_degrees - 90.0).abs() < 1e-6, "{}", s.info().angle_degrees);
        assert!(close(s.centre(), c));
    }

    #[test]
    fn a_snapped_move_lands_the_box_edge_on_a_guide() {
        use crate::snap::Guides;
        let guides = Guides { h: vec![], v: vec![30.0], enabled: true };
        let snap = Snap::new(&guides, Rect::new(0, 0, 100, 100), 1.0).unwrap();
        let mut s = TransformSession::new(&layer(), Some(Rect::new(4, 4, 6, 4))).unwrap();
        s.pointer_down(Point::new(6.0, 6.0), 0.5);
        // Right edge would be at 27; the guide at 30 pulls it the last 3.
        // Dragged 20 down as well, so the canvas top is out of reach.
        s.pointer_move_snapped(Point::new(23.0, 26.0), false, false, false, Some(&snap));
        assert_eq!(s.moved_selection(), Some(Rect::new(24, 24, 6, 4)));
        // Well away from it, the drag is exact and the total drag, not the
        // step from the snapped position, is what counts.
        s.pointer_move_snapped(Point::new(70.0, 26.0), false, false, false, Some(&snap));
        assert_eq!(s.moved_selection(), Some(Rect::new(68, 24, 6, 4)));
    }

    #[test]
    fn shift_snaps_rotation() {
        let mut s = TransformSession::new(&layer(), None).unwrap();
        let c = s.centre();
        s.pointer_down(Point::new(11.0, 9.0), 0.5);
        let r = Point::new(11.0, 9.0).distance_to(c);
        let a0 = (9.0 - c.y).atan2(11.0 - c.x);
        let a1 = a0 + 40f64.to_radians();
        s.pointer_move(Point::new(c.x + r * a1.cos(), c.y + r * a1.sin()), true, false);
        assert!((s.info().angle_degrees - 45.0).abs() < 1e-6, "{}", s.info().angle_degrees);
    }

    #[test]
    fn anywhere_outside_the_box_turns_it() {
        let mut s = TransformSession::new(&layer(), None).unwrap();
        // Well clear of the box, not just in a ring round a corner.
        let far = Point::new(0.0, 19.0);
        assert_eq!(s.hit(far, 0.5), Hit::Rotate);
        s.pointer_down(far, 0.5);
        let c = s.centre();
        let r = far.distance_to(c);
        let turned = (far.y - c.y).atan2(far.x - c.x) + 30f64.to_radians();
        assert!(s.pointer_move(Point::new(c.x + r * turned.cos(), c.y + r * turned.sin()), false, false));
        assert!((s.info().angle_degrees - 30.0).abs() < 1e-6, "{}", s.info().angle_degrees);
    }

    #[test]
    fn flips_and_quarter_turns_within_a_session() {
        let mut s = TransformSession::new(&layer(), None).unwrap();
        s.flip_horizontal();
        assert!(close(s.handles()[0], Point::new(10.0, 4.0)), "{:?}", s.handles()[0]);
        assert!(close(s.centre(), Point::new(7.0, 6.0)));
        let out = s.render();
        assert_eq!(out.get(4, 4), RED, "still covers the same box");
        s.flip_horizontal();
        s.rotate(std::f64::consts::PI);
        assert!(close(s.handles()[0], Point::new(10.0, 8.0)));
    }

    #[test]
    fn the_numbers_in_the_bar_can_be_typed() {
        let mut s = TransformSession::new(&layer(), None).unwrap();
        s.set_position(1.0, 2.0);
        let info = s.info();
        assert!((info.x - 1.0).abs() < 1e-9 && (info.y - 2.0).abs() < 1e-9);
        s.set_size(12.0, 2.0);
        let info = s.info();
        assert!((info.width - 12.0).abs() < 1e-9 && (info.height - 2.0).abs() < 1e-9, "{info:?}");
        assert!((info.x - 1.0).abs() < 1e-9, "scaled about the top-left, which stayed put");
        s.set_angle(30f64.to_radians());
        assert!((s.info().angle_degrees - 30.0).abs() < 1e-6);
        s.set_angle(0.0);
        assert!(s.info().angle_degrees.abs() < 1e-6);
        let (sx, sy) = s.matrix().as_affine().unwrap().scale();
        assert!((sx - 2.0).abs() < 1e-9 && (sy - 0.5).abs() < 1e-9, "turning did not change the size");
    }

    #[test]
    fn a_placed_session_starts_where_the_object_already_is() {
        // A 2x2 red source placed at (4, 4) on a 10x10 document.
        let source = Raster::filled(2, 2, RED);
        let mut s = TransformSession::placed(source, Raster::new(10, 10), Affine::translation(4.0, 4.0).into()).unwrap();
        assert!(close(s.handles()[0], Point::new(4.0, 4.0)));
        assert!(close(s.handles()[4], Point::new(6.0, 6.0)));
        let out = s.render();
        assert_eq!((out.width(), out.height()), (10, 10), "rendered at the document's size, not the source's");
        assert_eq!(out.get(5, 5), RED);
        assert_eq!(out.get(0, 0), Rgba::TRANSPARENT);
        s.translate(-4.0, -4.0);
        let out = s.render();
        assert_eq!(out.get(0, 0), RED);
        assert_eq!(out.get(5, 5), Rgba::TRANSPARENT);
        assert!(TransformSession::placed(Raster::new(0, 0), Raster::new(4, 4), Projective::IDENTITY).is_none());
    }

    #[test]
    fn transformed_into_lands_on_a_canvas_of_another_size() {
        let src = Raster::filled(2, 2, RED);
        let out = src.transformed_into(&Affine::translation(1.0, 1.0), 4, 4);
        assert_eq!((out.width(), out.height()), (4, 4));
        assert_eq!(out.get(1, 1), RED);
        assert_eq!(out.get(2, 2), RED);
        assert_eq!(out.get(3, 3), Rgba::TRANSPARENT);
        assert_eq!(out.get(0, 0), Rgba::TRANSPARENT);
    }

    #[test]
    fn stationary_pixels_are_left_alone() {
        let mut r = layer();
        r.set(15, 15, Rgba::BLACK);
        let mut s = TransformSession::new(&r, Some(Rect::new(4, 4, 6, 4))).unwrap();
        s.translate(-4.0, -4.0);
        let out = s.render();
        assert_eq!(out.get(15, 15), Rgba::BLACK);
        assert_eq!(out.get(0, 0), RED);
        assert_eq!(out.get(4, 4), Rgba::TRANSPARENT);
    }
}

