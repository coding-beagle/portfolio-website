//! Colours and alpha compositing.

use std::fmt;

/// A straight (non-premultiplied) 8-bit RGBA colour.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Hash)]
pub struct Rgba {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Rgba {
    pub const TRANSPARENT: Rgba = Rgba::new(0, 0, 0, 0);
    pub const BLACK: Rgba = Rgba::new(0, 0, 0, 255);
    pub const WHITE: Rgba = Rgba::new(255, 255, 255, 255);

    pub const fn new(r: u8, g: u8, b: u8, a: u8) -> Rgba {
        Rgba { r, g, b, a }
    }

    pub const fn opaque(r: u8, g: u8, b: u8) -> Rgba {
        Rgba::new(r, g, b, 255)
    }

    /// Parses `#rgb`, `#rrggbb` or `#rrggbbaa`, with or without the hash.
    pub fn from_hex(text: &str) -> Result<Rgba, ColorParseError> {
        let hex = text.trim().trim_start_matches('#');
        let digits: Vec<u8> = hex
            .chars()
            .map(|c| c.to_digit(16).map(|d| d as u8))
            .collect::<Option<_>>()
            .ok_or(ColorParseError)?;
        match digits.as_slice() {
            [r, g, b] => Ok(Rgba::opaque(r * 17, g * 17, b * 17)),
            [r1, r0, g1, g0, b1, b0] => Ok(Rgba::opaque(r1 * 16 + r0, g1 * 16 + g0, b1 * 16 + b0)),
            [r1, r0, g1, g0, b1, b0, a1, a0] => Ok(Rgba::new(
                r1 * 16 + r0,
                g1 * 16 + g0,
                b1 * 16 + b0,
                a1 * 16 + a0,
            )),
            _ => Err(ColorParseError),
        }
    }

    /// `#rrggbb` — the form an `<input type="color">` understands.
    pub fn to_hex(self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }

    pub const fn with_alpha(self, a: u8) -> Rgba {
        Rgba { a, ..self }
    }

    /// Scales the alpha by `factor` in `0.0..=1.0`, leaving the colour alone.
    pub fn scaled_alpha(self, factor: f32) -> Rgba {
        let a = (f32::from(self.a) * factor.clamp(0.0, 1.0)).round() as u8;
        self.with_alpha(a)
    }

    /// Mixes towards `other` by `t` in `0.0..=1.0`, as straight alpha over
    /// premultiplied channels — mixing straight colours would drag the hue of
    /// a transparent pixel into a solid one and leave a halo.
    pub fn lerp(self, other: Rgba, t: f32) -> Rgba {
        let t = t.clamp(0.0, 1.0);
        let (sa, oa) = (f32::from(self.a) / 255.0, f32::from(other.a) / 255.0);
        let a = sa + (oa - sa) * t;
        if a <= 0.0 {
            return Rgba::TRANSPARENT;
        }
        let channel = |s: u8, o: u8| {
            let v = (f32::from(s) * sa + (f32::from(o) * oa - f32::from(s) * sa) * t) / a;
            v.round().clamp(0.0, 255.0) as u8
        };
        Rgba::new(
            channel(self.r, other.r),
            channel(self.g, other.g),
            channel(self.b, other.b),
            (a * 255.0).round() as u8,
        )
    }

    /// Composites `self` over `dst` with the standard "source over" operator.
    ///
    /// Both colours are straight alpha, which is what the canvas `ImageData`
    /// format wants, so the maths un-premultiplies at the end. Fully opaque and
    /// fully transparent sources take the fast paths — they are by far the most
    /// common cases when painting.
    pub fn over(self, dst: Rgba) -> Rgba {
        match self.a {
            255 => self,
            0 => dst,
            _ => {
                let sa = f32::from(self.a) / 255.0;
                let da = f32::from(dst.a) / 255.0;
                let out_a = sa + da * (1.0 - sa);
                if out_a <= 0.0 {
                    return Rgba::TRANSPARENT;
                }
                let channel = |s: u8, d: u8| {
                    let v = (f32::from(s) * sa + f32::from(d) * da * (1.0 - sa)) / out_a;
                    v.round().clamp(0.0, 255.0) as u8
                };
                Rgba::new(
                    channel(self.r, dst.r),
                    channel(self.g, dst.g),
                    channel(self.b, dst.b),
                    (out_a * 255.0).round() as u8,
                )
            }
        }
    }
}

impl fmt::Display for Rgba {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "rgba({}, {}, {}, {})", self.r, self.g, self.b, self.a)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ColorParseError;

impl fmt::Display for ColorParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("expected a colour like #rrggbb")
    }
}

impl std::error::Error for ColorParseError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_hex_form() {
        assert_eq!(Rgba::from_hex("#f0a"), Ok(Rgba::opaque(255, 0, 170)));
        assert_eq!(Rgba::from_hex("ff8800"), Ok(Rgba::opaque(255, 136, 0)));
        assert_eq!(Rgba::from_hex("#ff880080"), Ok(Rgba::new(255, 136, 0, 128)));
        assert_eq!(Rgba::from_hex(" #FFFFFF "), Ok(Rgba::WHITE));
    }

    #[test]
    fn rejects_bad_hex() {
        assert!(Rgba::from_hex("#gg0000").is_err());
        assert!(Rgba::from_hex("#12345").is_err());
        assert!(Rgba::from_hex("").is_err());
    }

    #[test]
    fn hex_round_trips() {
        let c = Rgba::opaque(18, 52, 86);
        assert_eq!(Rgba::from_hex(&c.to_hex()), Ok(c));
    }

    #[test]
    fn opaque_source_replaces_destination() {
        assert_eq!(Rgba::BLACK.over(Rgba::WHITE), Rgba::BLACK);
    }

    #[test]
    fn transparent_source_leaves_destination() {
        assert_eq!(Rgba::TRANSPARENT.over(Rgba::WHITE), Rgba::WHITE);
    }

    #[test]
    fn half_alpha_over_white_is_a_midpoint() {
        let out = Rgba::new(0, 0, 0, 128).over(Rgba::WHITE);
        assert_eq!(out.a, 255);
        assert!((out.r as i32 - 127).abs() <= 1, "got {out}");
    }

    #[test]
    fn two_translucent_layers_accumulate_alpha() {
        let half = Rgba::new(255, 0, 0, 128);
        let out = half.over(half);
        // 0.5 + 0.5 * 0.5 = 0.75
        assert!((out.a as i32 - 191).abs() <= 1, "got {out}");
        assert_eq!((out.r, out.g, out.b), (255, 0, 0));
    }

    #[test]
    fn over_transparent_keeps_colour() {
        let c = Rgba::new(10, 20, 30, 77);
        assert_eq!(c.over(Rgba::TRANSPARENT), c);
    }

    #[test]
    fn scaled_alpha_clamps() {
        assert_eq!(Rgba::WHITE.scaled_alpha(0.5).a, 128);
        assert_eq!(Rgba::WHITE.scaled_alpha(2.0).a, 255);
        assert_eq!(Rgba::WHITE.scaled_alpha(-1.0).a, 0);
    }
}
