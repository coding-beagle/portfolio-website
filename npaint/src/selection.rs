//! The current selection: which pixels an edit is allowed to touch.
//!
//! Three shapes, in order of how much they cost to carry: nothing selected
//! (everything may be edited), a rectangular marquee, and a per-pixel
//! [`Mask`] for everything the automatic tools produce. The mask is the
//! general case — the other two are there because a rectangle is worth
//! keeping exact, and because the common case deserves to be free.
//!
//! Painting still clips to a *rectangle*: every primitive in `raster.rs`
//! takes one, and none of them know about masks. What makes a mask selection
//! hold is [`Selection::apply`] — the editor keeps the pixels from before the
//! gesture and blends the result back through the coverage afterwards, so a
//! tool that paints over the whole bounding box only leaves paint where the
//! selection allows it, softly where the coverage is partial.

use crate::color::Rgba;
use crate::geometry::{Point, Rect};
use crate::mask::{Mask, SelectMode};
use crate::raster::Raster;

#[derive(Clone, Debug, PartialEq, Default)]
pub enum Selection {
    /// Everything is selected.
    #[default]
    None,
    Rect(Rect),
    Mask(Mask),
}

impl Selection {
    /// A rectangle that bounds every selected pixel within `bounds`. Painting
    /// clips to this; for a rectangular selection it is exact, and for a mask
    /// it is the box the coverage then cuts down.
    pub fn clip(&self, bounds: Rect) -> Rect {
        match self {
            Selection::None => bounds,
            Selection::Rect(r) => r.intersect(&bounds),
            Selection::Mask(m) => m.bounds().intersect(&bounds),
        }
    }

    pub fn contains(&self, x: i32, y: i32) -> bool {
        match self {
            Selection::None => true,
            Selection::Rect(r) => r.contains(x, y),
            Selection::Mask(m) => m.contains(x, y),
        }
    }

    /// How much of a pixel is selected, `0..=255`.
    pub fn cover(&self, x: i32, y: i32) -> u8 {
        match self {
            Selection::None => 255,
            Selection::Rect(r) => {
                if r.contains(x, y) {
                    255
                } else {
                    0
                }
            }
            Selection::Mask(m) => m.cover(x, y),
        }
    }

    pub fn is_none(&self) -> bool {
        matches!(self, Selection::None)
    }

    /// The bounding box of the selection, if there is one.
    pub fn rect(&self) -> Option<Rect> {
        match self {
            Selection::None => None,
            Selection::Rect(r) => Some(*r),
            Selection::Mask(m) => (!m.is_empty()).then(|| m.bounds()),
        }
    }

    pub fn mask(&self) -> Option<&Mask> {
        match self {
            Selection::Mask(m) => Some(m),
            _ => None,
        }
    }

    /// The selection as a mask the size of the document — what the automatic
    /// tools combine their result into.
    pub fn to_mask(&self, bounds: Rect) -> Mask {
        let (w, h) = (bounds.w.max(0) as u32, bounds.h.max(0) as u32);
        match self {
            Selection::None => Mask::filled(w, h),
            Selection::Rect(r) => Mask::from_rect(w, h, *r),
            Selection::Mask(m) if m.width() == w && m.height() == h => m.clone(),
            // A mask left over from a document of another size means nothing.
            Selection::Mask(_) => Mask::filled(w, h),
        }
    }

    /// Makes a rectangular selection, or clears it if the rect has no area —
    /// a click with the marquee tool deselects, the same as in Photoshop.
    pub fn set_rect(&mut self, rect: Rect, bounds: Rect) {
        let clipped = rect.intersect(&bounds);
        *self = if clipped.is_empty() { Selection::None } else { Selection::Rect(clipped) };
    }

    /// Takes a mask as the selection, collapsing the two cases that are not
    /// really a selection: nothing selected, and everything selected.
    pub fn set_mask(&mut self, mask: Mask) {
        *self = if mask.is_empty() || mask.is_everything() {
            Selection::None
        } else if let Some(rect) = as_rectangle(&mask) {
            Selection::Rect(rect)
        } else {
            Selection::Mask(mask)
        };
    }

    /// Combines `mask` into the selection the way the modifier keys asked.
    pub fn combine(&mut self, mask: &Mask, mode: SelectMode, bounds: Rect) {
        let mut base = match mode {
            SelectMode::Replace => Mask::new(mask.width(), mask.height()),
            _ => self.to_mask(bounds),
        };
        base.combine(mask, if mode == SelectMode::Replace { SelectMode::Add } else { mode });
        self.set_mask(base);
    }

    pub fn invert(&mut self, bounds: Rect) {
        let mut mask = self.to_mask(bounds);
        mask.invert();
        self.set_mask(mask);
    }

    /// Runs a mask operation — grow, contract, feather, smooth — over
    /// whatever shape the selection currently has. Nothing selected means
    /// everything is, and there is no edge to move, so it stays that way.
    pub fn modify(&mut self, bounds: Rect, op: impl FnOnce(&mut Mask)) -> bool {
        if self.is_none() {
            return false;
        }
        let mut mask = self.to_mask(bounds);
        op(&mut mask);
        self.set_mask(mask);
        true
    }

    /// Splits a layer into the pixels this selection holds and the pixels it
    /// leaves behind — what the move tool and the free transform drag. A
    /// partly covered pixel is split between the two in proportion.
    pub fn split(&self, layer: &Raster) -> (Raster, Raster) {
        match self {
            Selection::None => (layer.clone(), Raster::new(layer.width(), layer.height())),
            Selection::Rect(r) => layer.split(r),
            Selection::Mask(m) => {
                let mut moving = Raster::new(layer.width(), layer.height());
                let mut stationary = layer.clone();
                let area = m.bounds().intersect(&layer.bounds());
                for y in area.y..area.bottom() {
                    for x in area.x..area.right() {
                        let cover = f32::from(m.cover(x, y)) / 255.0;
                        if cover <= 0.0 {
                            continue;
                        }
                        let pixel = layer.get(x, y);
                        moving.set(x, y, pixel.scaled_alpha(cover));
                        // Fully taken means gone, exactly — a colour left
                        // behind at zero alpha is not the same as nothing.
                        stationary.set(
                            x,
                            y,
                            if cover >= 1.0 { Rgba::TRANSPARENT } else { pixel.scaled_alpha(1.0 - cover) },
                        );
                    }
                }
                (moving, stationary)
            }
        }
    }

    /// Moves the selection by whole pixels, keeping it inside the document.
    pub fn translated(&self, dx: i32, dy: i32, bounds: Rect) -> Selection {
        match self {
            Selection::None => Selection::None,
            Selection::Rect(r) => {
                let mut out = Selection::None;
                out.set_rect(Rect::new(r.x + dx, r.y + dy, r.w, r.h), bounds);
                out
            }
            Selection::Mask(m) => {
                let mut out = Selection::None;
                out.set_mask(m.translated(dx, dy));
                out
            }
        }
    }

    /// Puts back what the gesture should not have touched: `base` is the
    /// layer as it was before, `edited` is what the tool produced. Only a
    /// mask needs this — a rectangle is enforced exactly by the clip.
    pub fn apply(&self, edited: &mut Raster, base: &Raster) {
        if let Selection::Mask(m) = self {
            m.apply(edited, base);
        }
    }

    /// Whether enforcing this selection needs the before-picture that
    /// [`Selection::apply`] blends against.
    pub fn needs_base(&self) -> bool {
        matches!(self, Selection::Mask(_))
    }

    /// The marching ants, as closed loops in document coordinates.
    pub fn contours(&self, bounds: Rect) -> Vec<Vec<Point>> {
        match self {
            Selection::None => Vec::new(),
            Selection::Rect(r) => {
                let r = r.intersect(&bounds);
                if r.is_empty() {
                    return Vec::new();
                }
                let (x0, y0, x1, y1) = (f64::from(r.x), f64::from(r.y), f64::from(r.right()), f64::from(r.bottom()));
                vec![vec![Point::new(x0, y0), Point::new(x1, y0), Point::new(x1, y1), Point::new(x0, y1)]]
            }
            Selection::Mask(m) => m.contours(),
        }
    }
}

/// Whether a mask is exactly a solid rectangle, in which case it is cheaper
/// and more exact to keep it as one.
fn as_rectangle(mask: &Mask) -> Option<Rect> {
    let bounds = mask.bounds();
    if bounds.is_empty() {
        return None;
    }
    for y in bounds.y..bounds.bottom() {
        for x in bounds.x..bounds.right() {
            if mask.cover(x, y) != 255 {
                return None;
            }
        }
    }
    Some(bounds)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOUNDS: Rect = Rect::new(0, 0, 10, 10);

    #[test]
    fn no_selection_means_everything() {
        let s = Selection::None;
        assert_eq!(s.clip(BOUNDS), BOUNDS);
        assert!(s.contains(-100, 3));
        assert_eq!(s.rect(), None);
        assert_eq!(s.cover(5, 5), 255);
        assert!(s.contours(BOUNDS).is_empty());
    }

    #[test]
    fn a_rect_selection_clips_to_the_document() {
        let mut s = Selection::None;
        s.set_rect(Rect::new(5, 5, 20, 20), BOUNDS);
        assert_eq!(s, Selection::Rect(Rect::new(5, 5, 5, 5)));
        assert_eq!(s.clip(BOUNDS), Rect::new(5, 5, 5, 5));
        assert!(s.contains(5, 5));
        assert!(!s.contains(4, 5));
    }

    #[test]
    fn an_empty_or_off_document_rect_deselects() {
        let mut s = Selection::Rect(Rect::new(1, 1, 2, 2));
        s.set_rect(Rect::new(3, 3, 0, 0), BOUNDS);
        assert!(s.is_none());
        s.set_rect(Rect::new(50, 50, 5, 5), BOUNDS);
        assert!(s.is_none());
    }

    #[test]
    fn a_mask_that_is_really_a_rectangle_is_kept_as_one() {
        let mut s = Selection::None;
        s.set_mask(Mask::from_rect(10, 10, Rect::new(2, 2, 3, 3)));
        assert_eq!(s, Selection::Rect(Rect::new(2, 2, 3, 3)));
    }

    #[test]
    fn an_empty_or_complete_mask_is_no_selection() {
        let mut s = Selection::Rect(Rect::new(1, 1, 2, 2));
        s.set_mask(Mask::new(10, 10));
        assert!(s.is_none());
        s.set_mask(Mask::filled(10, 10));
        assert!(s.is_none(), "everything selected is the same as nothing selected");
    }

    #[test]
    fn a_ragged_mask_stays_a_mask_and_clips_to_its_bounds() {
        let mut s = Selection::None;
        let mask = Mask::from_fn(10, 10, |x, y| if x == y { 255 } else { 0 });
        s.set_mask(mask);
        assert!(s.mask().is_some());
        assert_eq!(s.clip(BOUNDS), Rect::new(0, 0, 10, 10));
        assert!(s.contains(4, 4));
        assert!(!s.contains(4, 5));
    }

    #[test]
    fn modes_combine_against_what_is_already_there() {
        let mut s = Selection::Rect(Rect::new(0, 0, 4, 10));
        let right = Mask::from_rect(10, 10, Rect::new(6, 0, 4, 10));

        s.combine(&right, SelectMode::Add, BOUNDS);
        assert!(s.contains(1, 1) && s.contains(7, 1) && !s.contains(5, 1));

        let mut s = Selection::Rect(Rect::new(0, 0, 10, 10));
        s.combine(&right, SelectMode::Subtract, BOUNDS);
        assert_eq!(s, Selection::Rect(Rect::new(0, 0, 6, 10)));

        let mut s = Selection::Rect(Rect::new(0, 0, 8, 10));
        s.combine(&right, SelectMode::Intersect, BOUNDS);
        assert_eq!(s, Selection::Rect(Rect::new(6, 0, 2, 10)));

        let mut s = Selection::Rect(Rect::new(0, 0, 4, 10));
        s.combine(&right, SelectMode::Replace, BOUNDS);
        assert_eq!(s, Selection::Rect(Rect::new(6, 0, 4, 10)));
    }

    #[test]
    fn inverting_a_rect_leaves_the_rest_of_the_document() {
        let mut s = Selection::Rect(Rect::new(0, 0, 4, 10));
        s.invert(BOUNDS);
        assert_eq!(s, Selection::Rect(Rect::new(4, 0, 6, 10)));
        assert!(!s.contains(1, 1));
    }

    #[test]
    fn inverting_nothing_selects_nothing() {
        // Everything was selected, so the inverse is nothing at all — and
        // there is nowhere to paint until the user selects something again.
        let mut s = Selection::None;
        s.invert(BOUNDS);
        assert_eq!(s.rect(), None);
    }

    #[test]
    fn growing_moves_the_edge_of_whatever_shape_is_there() {
        let mut s = Selection::Rect(Rect::new(4, 4, 2, 2));
        assert!(s.modify(BOUNDS, |m| m.grow(2)));
        assert_eq!(s.rect(), Some(Rect::new(2, 2, 6, 6)));
        assert!(!Selection::None.modify(BOUNDS, |m| m.grow(2)), "no edge to move");
    }

    #[test]
    fn splitting_a_mask_divides_a_partly_covered_pixel() {
        let layer = Raster::filled(4, 1, Rgba::WHITE);
        let mut s = Selection::None;
        s.set_mask(Mask::from_fn(4, 1, |x, _| match x {
            0 => 255,
            1 => 128,
            _ => 0,
        }));
        let (moving, stationary) = s.split(&layer);
        assert_eq!(moving.get(0, 0).a, 255);
        assert_eq!(stationary.get(0, 0).a, 0);
        assert_eq!(moving.get(1, 0).a, 128);
        assert_eq!(stationary.get(1, 0).a, 127);
        assert_eq!(moving.get(3, 0).a, 0);
        assert_eq!(stationary.get(3, 0), Rgba::WHITE);
    }

    #[test]
    fn a_mask_selection_puts_back_what_was_painted_outside_it() {
        let base = Raster::filled(4, 2, Rgba::WHITE);
        let mut edited = Raster::filled(4, 2, Rgba::BLACK);
        let mut s = Selection::None;
        // A stair step, so it cannot collapse back into a rectangle.
        s.set_mask(Mask::from_fn(4, 2, |x, y| if x < 2 || y > 0 { 255 } else { 0 }));
        assert!(s.needs_base(), "a mask is enforced by putting pixels back");
        s.apply(&mut edited, &base);
        assert_eq!(edited.get(0, 0), Rgba::BLACK, "inside: the paint stands");
        assert_eq!(edited.get(3, 0), Rgba::WHITE, "outside: the original comes back");
        assert_eq!(edited.get(3, 1), Rgba::BLACK);
    }

    #[test]
    fn a_rect_selection_needs_no_putting_back() {
        assert!(!Selection::Rect(Rect::new(0, 0, 2, 2)).needs_base());
        assert!(!Selection::None.needs_base());
    }

    #[test]
    fn a_rect_traces_as_its_four_corners() {
        let s = Selection::Rect(Rect::new(2, 3, 4, 5));
        let loops = s.contours(BOUNDS);
        assert_eq!(loops.len(), 1);
        assert_eq!(loops[0].len(), 4);
        assert_eq!(loops[0][0], Point::new(2.0, 3.0));
        assert_eq!(loops[0][2], Point::new(6.0, 8.0));
    }

    #[test]
    fn moving_carries_the_selection_along() {
        let s = Selection::Rect(Rect::new(1, 1, 2, 2)).translated(3, 0, BOUNDS);
        assert_eq!(s.rect(), Some(Rect::new(4, 1, 2, 2)));
    }
}
