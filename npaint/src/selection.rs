//! The current selection: which pixels painting is allowed to touch.
//!
//! Only rectangular marquees exist yet. The type is an enum so a lasso or a
//! magic wand becomes a new variant with its own [`Selection::clip`] and
//! [`Selection::contains`], and no tool changes.

use crate::geometry::Rect;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Selection {
    /// Everything is selected.
    #[default]
    None,
    Rect(Rect),
}

impl Selection {
    /// A rectangle that bounds every selected pixel within `bounds`. Painting
    /// clips to this; for a rectangular selection it is exact.
    pub fn clip(&self, bounds: Rect) -> Rect {
        match self {
            Selection::None => bounds,
            Selection::Rect(r) => r.intersect(&bounds),
        }
    }

    pub fn contains(&self, x: i32, y: i32) -> bool {
        match self {
            Selection::None => true,
            Selection::Rect(r) => r.contains(x, y),
        }
    }

    pub fn is_none(&self) -> bool {
        matches!(self, Selection::None)
    }

    /// The marquee to draw, if there is one.
    pub fn rect(&self) -> Option<Rect> {
        match self {
            Selection::None => None,
            Selection::Rect(r) => Some(*r),
        }
    }

    /// Makes a rectangular selection, or clears it if the rect has no area —
    /// a click with the marquee tool deselects, the same as in Photoshop.
    pub fn set_rect(&mut self, rect: Rect, bounds: Rect) {
        let clipped = rect.intersect(&bounds);
        *self = if clipped.is_empty() {
            Selection::None
        } else {
            Selection::Rect(clipped)
        };
    }
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
}
