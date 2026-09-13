//! Turning a painted-on checkerboard into real transparency.
//!
//! Pictures saved from a screenshot, or exported wrongly, often carry the
//! editor's transparency checkerboard baked into their pixels. This finds
//! the board — its two colours, its cell size and where the grid sits — by
//! walking along the picture's edges, then makes it transparent.
//!
//! The edge of the subject is where a naive cut looks worst, so pixels are
//! not simply dropped or kept: each is unmixed from the checker colour that
//! was expected under it (the "colour to alpha" of GIMP), which gives an
//! anti-aliased edge a proper partial alpha and its own colour back. To keep
//! that from eating pale parts of the subject, only pixels reachable from the
//! picture's border through board-like pixels are treated, plus the one-pixel
//! fringe of the subject around them.

use crate::color::Rgba;
use crate::geometry::Rect;
use crate::raster::Raster;

/// How far, per channel, a pixel may be from a board colour and still count
/// as it while the board is being found. Loose enough for JPEG artefacts.
const TOLERANCE: i32 = 12;

/// The checkerboard a picture carries.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Checker {
    a: Rgba,
    b: Rgba,
    /// Cell size in pixels.
    cell: u32,
    /// Where the grid lines fall: `x % cell == offset_x` is a cell boundary.
    offset_x: u32,
    offset_y: u32,
    /// The parity of `cell_x + cell_y` at which the colour is `a`.
    parity: u32,
}

impl Checker {
    pub fn cell(&self) -> u32 {
        self.cell
    }

    /// The board colour that would be under `(x, y)`.
    fn expected(&self, x: u32, y: u32) -> Rgba {
        let ix = (x + self.cell - self.offset_x) / self.cell;
        let iy = (y + self.cell - self.offset_y) / self.cell;
        if (ix + iy) % 2 == self.parity {
            self.a
        } else {
            self.b
        }
    }
}

fn near(p: Rgba, q: Rgba) -> bool {
    (i32::from(p.r) - i32::from(q.r)).abs() <= TOLERANCE
        && (i32::from(p.g) - i32::from(q.g)).abs() <= TOLERANCE
        && (i32::from(p.b) - i32::from(q.b)).abs() <= TOLERANCE
}

/// The length of the run of pixels near `color`, from `(x, y)` stepping by
/// `(dx, dy)`, stopping at the edge.
fn run(r: &Raster, mut x: i32, mut y: i32, dx: i32, dy: i32, color: Rgba) -> u32 {
    let mut n = 0;
    while x >= 0 && y >= 0 && x < r.width() as i32 && y < r.height() as i32 && near(r.get(x, y), color) {
        n += 1;
        x += dx;
        y += dy;
    }
    n
}

/// Finds the board, if the picture has one. Each corner is tried in turn,
/// since the subject may sit over some of them; the board found has to
/// agree with most of the border to count.
pub fn detect(r: &Raster) -> Option<Checker> {
    let (w, h) = (r.width(), r.height());
    if w < 4 || h < 4 {
        return None;
    }
    let corners = [(0, 0, 1, 1), (w as i32 - 1, 0, -1, 1), (0, h as i32 - 1, 1, -1), (w as i32 - 1, h as i32 - 1, -1, -1)];
    for (cx, cy, dx, dy) in corners {
        let Some(c) = detect_from(r, cx, cy, dx, dy) else { continue };
        if agreement(r, &c) >= 0.6 {
            return Some(c);
        }
    }
    None
}

fn detect_from(r: &Raster, cx: i32, cy: i32, dx: i32, dy: i32) -> Option<Checker> {
    let (w, h) = (r.width(), r.height());
    let a = r.get(cx, cy);
    if a.a == 0 {
        return None;
    }
    // Along the row: a run of `a`, then a full cell of the other colour.
    let r1 = run(r, cx, cy, dx, 0, a);
    if r1 == 0 || r1 >= w {
        return None;
    }
    let bx = cx + dx * r1 as i32;
    let b = r.get(bx, cy);
    if near(a, b) || b.a == 0 {
        return None;
    }
    let cell = run(r, bx, cy, dx, 0, b);
    // A one-pixel checker is noise, and a board needs at least two full
    // cells across to be one.
    if cell < 2 || cell > w / 2 || r1 > cell {
        return None;
    }
    // Down the column, the first run of `a` says where the rows change.
    let r3 = run(r, cx, cy, 0, dy, a);
    if r3 == 0 || r3 > cell {
        return None;
    }
    // Below that run, the colour must switch to `b` — a stripe is not a board.
    let by = cy + dy * r3 as i32;
    if by < 0 || by >= h as i32 || !near(r.get(cx, by), b) {
        return None;
    }
    // The grid line nearest the corner, as a global position.
    let boundary_x = if dx > 0 { r1 } else { w - r1 };
    let boundary_y = if dy > 0 { r3 } else { h - r3 };
    let mut c = Checker { a, b, cell, offset_x: boundary_x % cell, offset_y: boundary_y % cell, parity: 0 };
    // Fix the parity so that the corner comes out as `a`.
    if c.expected(cx as u32, cy as u32) != a {
        c.parity = 1;
    }
    Some(c)
}

/// The fraction of border pixels that look like the board says they should.
fn agreement(r: &Raster, c: &Checker) -> f64 {
    let (w, h) = (r.width(), r.height());
    let mut hits = 0u32;
    let mut total = 0u32;
    let mut check = |x: u32, y: u32| {
        total += 1;
        if near(r.get(x as i32, y as i32), c.expected(x, y)) {
            hits += 1;
        }
    };
    for x in 0..w {
        check(x, 0);
        check(x, h - 1);
    }
    for y in 1..h.saturating_sub(1) {
        check(0, y);
        check(w - 1, y);
    }
    f64::from(hits) / f64::from(total.max(1))
}

/// Unmixes `p` from the background `bg` it is assumed to be blended over:
/// the smallest alpha that could produce it, and the colour that does.
fn unmix(p: Rgba, bg: Rgba) -> Rgba {
    let channel = |c: u8, b: u8| -> f32 {
        let (c, b) = (f32::from(c), f32::from(b));
        if c > b {
            (c - b) / (255.0 - b).max(1.0)
        } else {
            (b - c) / b.max(1.0)
        }
    };
    let alpha = channel(p.r, bg.r).max(channel(p.g, bg.g)).max(channel(p.b, bg.b)).clamp(0.0, 1.0);
    if alpha <= 0.0 {
        return Rgba::TRANSPARENT;
    }
    let restore = |c: u8, b: u8| -> u8 {
        let (c, b) = (f32::from(c), f32::from(b));
        (b + (c - b) / alpha).round().clamp(0.0, 255.0) as u8
    };
    Rgba { r: restore(p.r, bg.r), g: restore(p.g, bg.g), b: restore(p.b, bg.b), a: (alpha * f32::from(p.a)).round() as u8 }
}

/// Makes the board transparent within `clip`. Returns whether any pixel
/// changed.
pub fn remove(r: &mut Raster, c: &Checker, clip: &Rect) -> bool {
    let (w, h) = (r.width() as usize, r.height() as usize);
    // How board-like each pixel is: the alpha it would keep, in 0..=255.
    let likeness: Vec<u8> = (0..w * h)
        .map(|i| {
            let (x, y) = ((i % w) as u32, (i / w) as u32);
            let p = r.get(x as i32, y as i32);
            if p.a == 0 {
                0
            } else {
                unmix(p, c.expected(x, y)).a
            }
        })
        .collect();
    // Flood from the border through pixels that are mostly board.
    let passable = |i: usize| likeness[i] <= 128;
    let mut region = vec![false; w * h];
    let mut stack: Vec<usize> = Vec::new();
    for x in 0..w {
        stack.push(x);
        stack.push((h - 1) * w + x);
    }
    for y in 0..h {
        stack.push(y * w);
        stack.push(y * w + w - 1);
    }
    while let Some(i) = stack.pop() {
        if region[i] || !passable(i) {
            continue;
        }
        region[i] = true;
        let (x, y) = (i % w, i / w);
        if x > 0 {
            stack.push(i - 1);
        }
        if x + 1 < w {
            stack.push(i + 1);
        }
        if y > 0 {
            stack.push(i - w);
        }
        if y + 1 < h {
            stack.push(i + w);
        }
    }
    // The region and its fringe get unmixed; the rest is the subject.
    let mut changed = false;
    for y in clip.y.max(0)..clip.bottom().min(h as i32) {
        for x in clip.x.max(0)..clip.right().min(w as i32) {
            let (ux, uy) = (x as usize, y as usize);
            let i = uy * w + ux;
            let touched = region[i]
                || (ux > 0 && region[i - 1])
                || (ux + 1 < w && region[i + 1])
                || (uy > 0 && region[i - w])
                || (uy + 1 < h && region[i + w]);
            if !touched {
                continue;
            }
            let p = r.get(x, y);
            if p.a == 0 {
                continue;
            }
            let out = unmix(p, c.expected(ux as u32, uy as u32));
            if out != p {
                r.set(x, y, out);
                changed = true;
            }
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIGHT: Rgba = Rgba::opaque(255, 255, 255);
    const DARK: Rgba = Rgba::opaque(204, 204, 204);
    const RED: Rgba = Rgba::opaque(255, 0, 0);

    /// A 40x40 board of 8px cells whose grid is shifted by (3, 5), with a
    /// red square in the middle and one half-mixed pixel on its edge.
    fn picture() -> Raster {
        let mut r = Raster::new(40, 40);
        for y in 0..40u32 {
            for x in 0..40u32 {
                let ix = (x + 3) / 8;
                let iy = (y + 5) / 8;
                r.set(x as i32, y as i32, if (ix + iy) % 2 == 0 { LIGHT } else { DARK });
            }
        }
        r.fill_rect(Rect::new(15, 15, 10, 10), RED, &Rect::new(0, 0, 40, 40));
        // A pixel that is half red, half whatever board colour was under it.
        let under = r.get(14, 20);
        let mix = |a: u8, b: u8| ((u16::from(a) + u16::from(b)) / 2) as u8;
        r.set(14, 20, Rgba::opaque(mix(RED.r, under.r), mix(RED.g, under.g), mix(RED.b, under.b)));
        r
    }

    #[test]
    fn finds_the_board_its_cell_and_its_phase() {
        let r = picture();
        let c = detect(&r).expect("a board");
        assert_eq!(c.cell(), 8);
        for y in 0..40u32 {
            for x in 0..40u32 {
                let subject = (15..25).contains(&x) && (15..25).contains(&y);
                let mixed = (x, y) == (14, 20);
                if !subject && !mixed {
                    assert_eq!(c.expected(x, y), r.get(x as i32, y as i32), "at {x},{y}");
                }
            }
        }
    }

    #[test]
    fn a_plain_picture_or_stripes_are_not_a_board() {
        let mut r = Raster::new(20, 20);
        r.fill_rect(Rect::new(0, 0, 20, 20), LIGHT, &Rect::new(0, 0, 20, 20));
        assert!(detect(&r).is_none());
        for x in 0..20 {
            if (x / 4) % 2 == 1 {
                r.fill_rect(Rect::new(x, 0, 1, 20), DARK, &Rect::new(0, 0, 20, 20));
            }
        }
        assert!(detect(&r).is_none(), "vertical stripes");
    }

    #[test]
    fn the_subject_may_cover_the_first_corner() {
        let mut r = picture();
        r.fill_rect(Rect::new(0, 0, 6, 6), RED, &Rect::new(0, 0, 40, 40));
        assert!(detect(&r).is_some());
    }

    #[test]
    fn removal_clears_the_board_keeps_the_subject_and_unmixes_its_edge() {
        let mut r = picture();
        let c = detect(&r).unwrap();
        assert!(remove(&mut r, &c, &Rect::new(0, 0, 40, 40)));
        assert_eq!(r.get(0, 0), Rgba::TRANSPARENT);
        assert_eq!(r.get(39, 39), Rgba::TRANSPARENT);
        assert_eq!(r.get(20, 20), RED, "the subject is untouched");
        let edge = r.get(14, 20);
        assert!((120..=136).contains(&edge.a), "half alpha, got {edge:?}");
        assert!(edge.r > 240 && edge.g < 16 && edge.b < 16, "and red again, got {edge:?}");
        assert!(!remove(&mut r, &c, &Rect::new(0, 0, 40, 40)), "nothing left to do");
    }

    #[test]
    fn pale_pixels_inside_the_subject_stay() {
        let mut r = picture();
        r.set(20, 20, LIGHT);
        let c = detect(&r).unwrap();
        remove(&mut r, &c, &Rect::new(0, 0, 40, 40));
        assert_eq!(r.get(20, 20), LIGHT, "enclosed by red, so not board");
    }
}
