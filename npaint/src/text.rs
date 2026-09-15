//! Text: what a text layer says and how it is set.
//!
//! The engine has no fonts. A text layer is a smart object whose source
//! picture was drawn by the page — the browser has the fonts, and
//! `CanvasRenderingContext2D` sets type well — and which remembers the text
//! and style it was drawn from, so it can be drawn again when either
//! changes. What lives here is that memory: the [`TextObject`], the
//! [`TextStyle`] the options bar sets, and the rule for keeping a block of
//! text anchored when its width changes.

use crate::color::Rgba;
use crate::geometry::Point;

/// How the lines of a block sit against one another, and which edge of the
/// block stays put when the text is edited.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum TextAlign {
    #[default]
    Left,
    Center,
    Right,
}

impl TextAlign {
    pub const ALL: &'static [TextAlign] = &[TextAlign::Left, TextAlign::Center, TextAlign::Right];

    pub fn name(self) -> &'static str {
        match self {
            TextAlign::Left => "left",
            TextAlign::Center => "center",
            TextAlign::Right => "right",
        }
    }

    pub fn from_name(name: &str) -> Option<TextAlign> {
        TextAlign::ALL.iter().copied().find(|a| a.name() == name)
    }

    /// The alignment as one byte, for the file: its position in
    /// [`TextAlign::ALL`].
    pub fn anchor_index(self) -> u8 {
        TextAlign::ALL.iter().position(|a| *a == self).unwrap_or(0) as u8
    }

    pub fn from_anchor_index(index: u8) -> Option<TextAlign> {
        TextAlign::ALL.get(usize::from(index)).copied()
    }

    /// How far across the block the fixed point is: the left edge stays
    /// for left-aligned text, the middle for centred, the right edge for
    /// right-aligned.
    pub fn anchor(self) -> f64 {
        match self {
            TextAlign::Left => 0.0,
            TextAlign::Center => 0.5,
            TextAlign::Right => 1.0,
        }
    }
}

/// The type settings: what the options bar shows for the text tool, and what
/// a text layer was set in.
#[derive(Clone, Debug, PartialEq)]
pub struct TextStyle {
    /// A CSS font family, as the page will pass it to the canvas.
    pub font: String,
    /// The font size in document pixels.
    pub size: f64,
    pub bold: bool,
    pub italic: bool,
    pub align: TextAlign,
}

/// The largest and smallest type the engine accepts, in pixels. The upper
/// bound keeps the page's rendering canvas within what a browser allows.
pub const MIN_SIZE: f64 = 1.0;
pub const MAX_SIZE: f64 = 2000.0;

impl Default for TextStyle {
    fn default() -> TextStyle {
        TextStyle { font: "sans-serif".to_owned(), size: 48.0, bold: false, italic: false, align: TextAlign::Left }
    }
}

impl TextStyle {
    pub fn set_size(&mut self, size: f64) {
        self.size = if size.is_finite() { size.clamp(MIN_SIZE, MAX_SIZE) } else { self.size };
    }
}

/// A text layer's memory: the text, how it is set, its colour, and where in
/// the rendered picture the block of text begins.
#[derive(Clone, Debug, PartialEq)]
pub struct TextObject {
    pub text: String,
    pub style: TextStyle,
    pub color: Rgba,
    /// Where the top-left corner of the block of text sits in the source
    /// picture — the padding the page gave the rendering for overhangs and
    /// antialiasing. A new layer is placed so that this point lands on the
    /// click, and the page puts its caret here.
    pub origin: Point,
}

impl TextObject {
    /// Empty text in the given style; what a fresh text layer holds until
    /// the first character is typed.
    pub fn empty(style: TextStyle, color: Rgba) -> TextObject {
        TextObject { text: String::new(), style, color, origin: Point::default() }
    }

    /// Whether there is anything to see. Whitespace alone is nothing: a
    /// layer of it would be invisible and baffling.
    pub fn is_blank(&self) -> bool {
        self.text.trim().is_empty()
    }

    /// The name the layers panel shows: the first line of the text, cut
    /// short, or "Text" when there is none yet.
    pub fn layer_name(&self) -> String {
        const MAX: usize = 24;
        let line = self.text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
        if line.is_empty() {
            return "Text".to_owned();
        }
        if line.chars().count() <= MAX {
            return line.to_owned();
        }
        let mut cut: String = line.chars().take(MAX - 1).collect();
        cut.push('…');
        cut
    }

    /// The fixed point of the block in source pixels: the corner or middle
    /// of its top edge that [`TextAlign::anchor`] names, given the width of
    /// the whole source picture. When the text is set again and the block
    /// comes out wider or narrower, the new rendering is placed so that this
    /// point stays where it was.
    pub fn anchor(&self, source_width: u32) -> Point {
        let block_width = (f64::from(source_width) - 2.0 * self.origin.x).max(0.0);
        Point::new(self.origin.x + block_width * self.style.align.anchor(), self.origin.y)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alignments_round_trip_and_anchor_the_matching_edge() {
        for a in TextAlign::ALL {
            assert_eq!(TextAlign::from_name(a.name()), Some(*a));
        }
        assert_eq!(TextAlign::from_name("justify"), None);
        for a in TextAlign::ALL {
            assert_eq!(TextAlign::from_anchor_index(a.anchor_index()), Some(*a));
        }
        assert_eq!(TextAlign::from_anchor_index(7), None);
        let mut t = TextObject::empty(TextStyle::default(), Rgba::BLACK);
        t.origin = Point::new(10.0, 6.0);
        // A 100-wide source with 10 of padding each side is an 80-wide block.
        assert_eq!(t.anchor(100), Point::new(10.0, 6.0));
        t.style.align = TextAlign::Center;
        assert_eq!(t.anchor(100), Point::new(50.0, 6.0));
        t.style.align = TextAlign::Right;
        assert_eq!(t.anchor(100), Point::new(90.0, 6.0));
    }

    #[test]
    fn the_layer_is_named_after_its_first_line() {
        let mut t = TextObject::empty(TextStyle::default(), Rgba::BLACK);
        assert_eq!(t.layer_name(), "Text");
        assert!(t.is_blank());
        t.text = "  \n\n".to_owned();
        assert!(t.is_blank());
        assert_eq!(t.layer_name(), "Text");
        t.text = "\n  Hello there \nsecond".to_owned();
        assert!(!t.is_blank());
        assert_eq!(t.layer_name(), "Hello there");
        t.text = "abcdefghijklmnopqrstuvwxyz0123".to_owned();
        assert_eq!(t.layer_name(), "abcdefghijklmnopqrstuvw…");
        assert_eq!(t.layer_name().chars().count(), 24);
    }

    #[test]
    fn the_size_is_clamped_and_never_nan() {
        let mut s = TextStyle::default();
        s.set_size(0.0);
        assert_eq!(s.size, MIN_SIZE);
        s.set_size(1e9);
        assert_eq!(s.size, MAX_SIZE);
        s.set_size(f64::NAN);
        assert_eq!(s.size, MAX_SIZE, "a NaN leaves the size alone");
        s.set_size(72.0);
        assert_eq!(s.size, 72.0);
    }
}
