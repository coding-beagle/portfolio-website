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
        let Some(inv) = m.inverse() else {
            return Raster::new(width, height);
        };
        let mut out = Raster::new(width, height);
        // Only destination pixels the source's bounds can reach need
        // sampling: transform the source corners and take their extent.
        let (w, h) = (self.width() as f64, self.height() as f64);
        let corners = [Point::new(0.0, 0.0), Point::new(w, 0.0), Point::new(0.0, h), Point::new(w, h)].map(|p| m.apply(p));
        let x0 = corners.iter().map(|p| p.x).fold(f64::INFINITY, f64::min).floor().max(0.0) as i32;
        let y0 = corners.iter().map(|p| p.y).fold(f64::INFINITY, f64::min).floor().max(0.0) as i32;
        let x1 = corners.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max).ceil().min(f64::from(width)) as i32;
        let y1 = corners.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max).ceil().min(f64::from(height)) as i32;
        for y in y0..y1 {
            for x in x0..x1 {
                let src = inv.apply(Point::new(f64::from(x) + 0.5, f64::from(y) + 0.5));
                let p = self.sample_bilinear(src.x - 0.5, src.y - 0.5);
                if p.a > 0 {
                    out.set(x, y, p);
                }
            }
        }
        out
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

/// What the pointer is doing to the box.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Drag {
    /// Where the pointer went down and the matrix it found, so snapping
    /// can re-derive the box from the total drag rather than nudging it
    /// step by step.
    Move { start: Point, origin: Affine },
    Scale { handle: Handle, anchor: Point },
    Rotate { last_angle: f64 },
}

/// What the pointer would do at a position, for the page to pick a cursor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hit {
    Handle(Handle),
    Inside,
    Rotate,
    Outside,
}

#[derive(Clone, Debug)]
pub struct TransformSession {
    moving: Raster,
    stationary: Raster,
    /// The moving pixels' bounding box in their own (original) coordinates.
    bounds: Rect,
    /// Original coordinates → current document position.
    matrix: Affine,
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
            matrix: Affine::IDENTITY,
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
        Some(TransformSession { moving, stationary, bounds, matrix: Affine::IDENTITY, drag: None, selection })
    }

    /// A session that starts from a placement already made: a smart
    /// object's source (at its own size) and the transform that puts it on
    /// the document. `stationary` gives the document's size.
    pub fn placed(moving: Raster, stationary: Raster, matrix: Affine) -> Option<TransformSession> {
        let bounds = moving.bounds();
        if bounds.is_empty() {
            return None;
        }
        Some(TransformSession { moving, stationary, bounds, matrix, drag: None, selection: None })
    }

    pub fn matrix(&self) -> Affine {
        self.matrix
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
        let (sx, sy) = self.matrix.scale();
        let tl = self.box_point(Point::new(0.0, 0.0));
        TransformInfo {
            x: tl.x,
            y: tl.y,
            width: f64::from(self.bounds.w) * sx,
            height: f64::from(self.bounds.h) * sy,
            scale_x: sx,
            scale_y: sy,
            angle_degrees: self.matrix.angle().to_degrees(),
        }
    }

    /// What is under `p`. `tolerance` is how close counts as on a handle, in
    /// document pixels — pass something like `8 / zoom` so it is a constant
    /// size on screen.
    pub fn hit(&self, p: Point, tolerance: f64) -> Hit {
        for (handle, pos) in Handle::ALL.iter().zip(self.handles()) {
            if pos.distance_to(p) <= tolerance {
                return Hit::Handle(*handle);
            }
        }
        if self.contains(p) {
            return Hit::Inside;
        }
        // Just outside a corner is the rotate zone.
        let ring = tolerance * 4.0;
        let near_corner = self.corners().iter().any(|c| c.distance_to(p) <= ring);
        if near_corner {
            Hit::Rotate
        } else {
            Hit::Outside
        }
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

    /// Begins a drag. Returns whether anything was hit.
    pub fn pointer_down(&mut self, p: Point, tolerance: f64) -> bool {
        self.drag = match self.hit(p, tolerance) {
            Hit::Handle(handle) => Some(Drag::Scale { handle, anchor: self.box_point(handle.opposite().unit()) }),
            Hit::Inside => Some(Drag::Move { start: p, origin: self.matrix }),
            Hit::Rotate => {
                let c = self.centre();
                Some(Drag::Rotate { last_angle: (p.y - c.y).atan2(p.x - c.x) })
            }
            Hit::Outside => None,
        };
        self.drag.is_some()
    }

    /// Continues a drag. `shift` keeps scaling proportional and snaps
    /// rotation to 15°; `alt` scales about the centre instead of the
    /// opposite handle. Returns whether the matrix changed.
    pub fn pointer_move(&mut self, p: Point, shift: bool, alt: bool) -> bool {
        self.pointer_move_snapped(p, shift, alt, None)
    }

    /// [`TransformSession::pointer_move`] with guides to snap to: a move
    /// pulls the box's edges and centre onto them, a scale pulls the handle.
    pub fn pointer_move_snapped(&mut self, p: Point, shift: bool, alt: bool, snap: Option<&Snap>) -> bool {
        let Some(drag) = self.drag else { return false };
        match drag {
            Drag::Move { start, origin } => {
                self.matrix = Affine::translation(p.x - start.x, p.y - start.y).then(&origin);
                if let Some(snap) = snap {
                    let c = self.centre();
                    let corners = self.corners();
                    let xs: Vec<f64> = corners.iter().map(|q| q.x).chain([c.x]).collect();
                    let ys: Vec<f64> = corners.iter().map(|q| q.y).chain([c.y]).collect();
                    let (dx, dy) = snap.offset(&xs, &ys);
                    self.translate(dx, dy);
                }
            }
            Drag::Scale { handle, anchor } => {
                let anchor = if alt { self.centre() } else { anchor };
                let p = snap.map_or(p, |s| s.point(p));
                self.scale_towards(handle, anchor, p, shift || (alt && handle.is_corner() && shift));
            }
            Drag::Rotate { last_angle } => {
                let c = self.centre();
                let angle = (p.y - c.y).atan2(p.x - c.x);
                let mut delta = angle - last_angle;
                if shift {
                    let step = 15f64.to_radians();
                    let current = self.matrix.angle();
                    let target = ((current + delta) / step).round() * step;
                    delta = target - current;
                }
                self.rotate_about(delta, c);
                self.drag = Some(Drag::Rotate { last_angle: angle });
            }
        }
        true
    }

    pub fn pointer_up(&mut self) {
        self.drag = None;
    }

    pub fn translate(&mut self, dx: f64, dy: f64) {
        self.matrix = Affine::translation(dx, dy).then(&self.matrix);
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
        let (sx, sy) = self.matrix.scale();
        let kx = width / (f64::from(self.bounds.w) * sx).max(1e-9);
        let ky = height / (f64::from(self.bounds.h) * sy).max(1e-9);
        let tl = self.box_point(Point::new(0.0, 0.0));
        let theta = self.matrix.angle();
        let in_frame = Affine::rotation(theta).then(&Affine::scaling(kx.max(0.01), ky.max(0.01))).then(&Affine::rotation(-theta));
        self.matrix = self.matrix.pre_about(&in_frame, tl);
    }

    /// Turns the box, about its centre, to an absolute angle.
    pub fn set_angle(&mut self, radians: f64) {
        let delta = radians - self.matrix.angle();
        self.rotate(delta);
    }

    /// Mirrors along the box's own axes, about its centre.
    fn flip(&mut self, sx: f64, sy: f64) {
        let c = self.centre();
        let theta = self.matrix.angle();
        let in_frame = Affine::rotation(theta).then(&Affine::scaling(sx, sy)).then(&Affine::rotation(-theta));
        self.matrix = self.matrix.pre_about(&in_frame, c);
    }

    /// Scales so that `handle` lands on `target` while `anchor` stays put,
    /// measured along the box's own (possibly rotated) axes.
    fn scale_towards(&mut self, handle: Handle, anchor: Point, target: Point, proportional: bool) {
        let theta = self.matrix.angle();
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
        let same_size = (self.moving.width(), self.moving.height()) == (out.width(), out.height());
        let moved = if self.matrix == Affine::IDENTITY && same_size {
            self.moving.clone()
        } else {
            self.moving.transformed_into(&self.matrix, out.width(), out.height())
        };
        out.merge_over(&moved);
        out
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
        assert!(s.pointer_down(Point::new(6.0, 6.0), 0.5));
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
        assert!(s.pointer_down(Point::new(10.0, 8.0), 0.5)); // bottom-right
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
    fn edge_handles_scale_one_axis() {
        let mut s = TransformSession::new(&layer(), None).unwrap();
        assert!(s.pointer_down(Point::new(10.0, 6.0), 0.5)); // right edge
        s.pointer_move(Point::new(13.0, 2.0), false, false);
        let (sx, sy) = s.matrix().scale();
        assert!((sx - 1.5).abs() < 1e-9, "sx {sx}");
        assert!((sy - 1.0).abs() < 1e-9, "sy {sy}");
    }

    #[test]
    fn shift_keeps_corner_scaling_proportional() {
        let mut s = TransformSession::new(&layer(), None).unwrap();
        s.pointer_down(Point::new(10.0, 8.0), 0.5);
        s.pointer_move(Point::new(16.0, 9.0), true, false);
        let (sx, sy) = s.matrix().scale();
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
        let (sx, _) = s.matrix().scale();
        assert!((sx - 2.0).abs() < 1e-9, "6 → 12 wide about the centre");
    }

    #[test]
    fn rotating_near_a_corner() {
        let mut s = TransformSession::new(&layer(), None).unwrap();
        let c = s.centre();
        // Just outside the bottom-right corner.
        assert_eq!(s.hit(Point::new(11.0, 9.0), 0.5), Hit::Rotate);
        assert!(s.pointer_down(Point::new(11.0, 9.0), 0.5));
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
        assert!(s.pointer_down(Point::new(6.0, 6.0), 0.5));
        // Right edge would be at 27; the guide at 30 pulls it the last 3.
        // Dragged 20 down as well, so the canvas top is out of reach.
        s.pointer_move_snapped(Point::new(23.0, 26.0), false, false, Some(&snap));
        assert_eq!(s.moved_selection(), Some(Rect::new(24, 24, 6, 4)));
        // Well away from it, the drag is exact and the total drag, not the
        // step from the snapped position, is what counts.
        s.pointer_move_snapped(Point::new(70.0, 26.0), false, false, Some(&snap));
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
    fn hit_testing_outside_starts_nothing() {
        let mut s = TransformSession::new(&layer(), None).unwrap();
        assert_eq!(s.hit(Point::new(0.0, 19.0), 0.5), Hit::Outside);
        assert!(!s.pointer_down(Point::new(0.0, 19.0), 0.5));
        assert!(!s.pointer_move(Point::new(1.0, 19.0), false, false));
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
        let (sx, sy) = s.matrix().scale();
        assert!((sx - 2.0).abs() < 1e-9 && (sy - 0.5).abs() < 1e-9, "turning did not change the size");
    }

    #[test]
    fn a_placed_session_starts_where_the_object_already_is() {
        // A 2x2 red source placed at (4, 4) on a 10x10 document.
        let source = Raster::filled(2, 2, RED);
        let mut s = TransformSession::placed(source, Raster::new(10, 10), Affine::translation(4.0, 4.0)).unwrap();
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
        assert!(TransformSession::placed(Raster::new(0, 0), Raster::new(4, 4), Affine::IDENTITY).is_none());
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
