//! Blend modes: how a layer's colour combines with what is already below it.
//!
//! The formulas are the W3C compositing ones, which is what every editor
//! uses. A mode is a function `B(backdrop, source)` of two colours in
//! `0..=1`; the alpha handling around it is the same for all of them and is
//! done once, in [`Rgba::blend_over`]: the blended colour is mixed with the
//! plain source by the backdrop's alpha (so a layer over transparency shows
//! its own colour, whatever the mode), and the result is composited source-
//! over as usual.

use crate::color::Rgba;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum BlendMode {
    #[default]
    Normal,
    Darken,
    Multiply,
    ColorBurn,
    Lighten,
    Screen,
    ColorDodge,
    Overlay,
    SoftLight,
    HardLight,
    Difference,
    Exclusion,
    Hue,
    Saturation,
    Color,
    Luminosity,
}

impl BlendMode {
    /// Every mode, in the order the layers panel lists them.
    pub const ALL: &'static [BlendMode] = &[
        BlendMode::Normal,
        BlendMode::Darken,
        BlendMode::Multiply,
        BlendMode::ColorBurn,
        BlendMode::Lighten,
        BlendMode::Screen,
        BlendMode::ColorDodge,
        BlendMode::Overlay,
        BlendMode::SoftLight,
        BlendMode::HardLight,
        BlendMode::Difference,
        BlendMode::Exclusion,
        BlendMode::Hue,
        BlendMode::Saturation,
        BlendMode::Color,
        BlendMode::Luminosity,
    ];

    /// The name the page and the file format use.
    pub fn name(self) -> &'static str {
        match self {
            BlendMode::Normal => "normal",
            BlendMode::Darken => "darken",
            BlendMode::Multiply => "multiply",
            BlendMode::ColorBurn => "color-burn",
            BlendMode::Lighten => "lighten",
            BlendMode::Screen => "screen",
            BlendMode::ColorDodge => "color-dodge",
            BlendMode::Overlay => "overlay",
            BlendMode::SoftLight => "soft-light",
            BlendMode::HardLight => "hard-light",
            BlendMode::Difference => "difference",
            BlendMode::Exclusion => "exclusion",
            BlendMode::Hue => "hue",
            BlendMode::Saturation => "saturation",
            BlendMode::Color => "color",
            BlendMode::Luminosity => "luminosity",
        }
    }

    /// What the layers panel shows.
    pub fn label(self) -> &'static str {
        match self {
            BlendMode::Normal => "Normal",
            BlendMode::Darken => "Darken",
            BlendMode::Multiply => "Multiply",
            BlendMode::ColorBurn => "Colour Burn",
            BlendMode::Lighten => "Lighten",
            BlendMode::Screen => "Screen",
            BlendMode::ColorDodge => "Colour Dodge",
            BlendMode::Overlay => "Overlay",
            BlendMode::SoftLight => "Soft Light",
            BlendMode::HardLight => "Hard Light",
            BlendMode::Difference => "Difference",
            BlendMode::Exclusion => "Exclusion",
            BlendMode::Hue => "Hue",
            BlendMode::Saturation => "Saturation",
            BlendMode::Color => "Colour",
            BlendMode::Luminosity => "Luminosity",
        }
    }

    pub fn from_name(name: &str) -> Option<BlendMode> {
        BlendMode::ALL.iter().copied().find(|m| m.name() == name)
    }

    /// Whether the mode works on each channel on its own.
    fn separable(self) -> bool {
        !matches!(self, BlendMode::Hue | BlendMode::Saturation | BlendMode::Color | BlendMode::Luminosity)
    }

    /// `B(cb, cs)` for one channel of a separable mode.
    fn channel(self, cb: f32, cs: f32) -> f32 {
        match self {
            BlendMode::Normal => cs,
            BlendMode::Darken => cb.min(cs),
            BlendMode::Multiply => cb * cs,
            BlendMode::ColorBurn => {
                if cb >= 1.0 {
                    1.0
                } else if cs <= 0.0 {
                    0.0
                } else {
                    1.0 - ((1.0 - cb) / cs).min(1.0)
                }
            }
            BlendMode::Lighten => cb.max(cs),
            BlendMode::Screen => cb + cs - cb * cs,
            BlendMode::ColorDodge => {
                if cb <= 0.0 {
                    0.0
                } else if cs >= 1.0 {
                    1.0
                } else {
                    (cb / (1.0 - cs)).min(1.0)
                }
            }
            BlendMode::Overlay => BlendMode::HardLight.channel(cs, cb),
            BlendMode::SoftLight => {
                if cs <= 0.5 {
                    cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb)
                } else {
                    let d = if cb <= 0.25 { ((16.0 * cb - 12.0) * cb + 4.0) * cb } else { cb.sqrt() };
                    cb + (2.0 * cs - 1.0) * (d - cb)
                }
            }
            BlendMode::HardLight => {
                if cs <= 0.5 {
                    BlendMode::Multiply.channel(cb, 2.0 * cs)
                } else {
                    BlendMode::Screen.channel(cb, 2.0 * cs - 1.0)
                }
            }
            BlendMode::Difference => (cb - cs).abs(),
            BlendMode::Exclusion => cb + cs - 2.0 * cb * cs,
            _ => unreachable!("non-separable modes go through `rgb`"),
        }
    }

    /// `B(cb, cs)` on whole colours in `0..=1`.
    fn rgb(self, cb: [f32; 3], cs: [f32; 3]) -> [f32; 3] {
        if self.separable() {
            return [self.channel(cb[0], cs[0]), self.channel(cb[1], cs[1]), self.channel(cb[2], cs[2])];
        }
        match self {
            BlendMode::Hue => set_lum(set_sat(cs, sat(cb)), lum(cb)),
            BlendMode::Saturation => set_lum(set_sat(cb, sat(cs)), lum(cb)),
            BlendMode::Color => set_lum(cs, lum(cb)),
            BlendMode::Luminosity => set_lum(cb, lum(cs)),
            _ => unreachable!(),
        }
    }
}

fn lum(c: [f32; 3]) -> f32 {
    0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
}

fn sat(c: [f32; 3]) -> f32 {
    c[0].max(c[1]).max(c[2]) - c[0].min(c[1]).min(c[2])
}

fn clip_color(c: [f32; 3]) -> [f32; 3] {
    let l = lum(c);
    let n = c[0].min(c[1]).min(c[2]);
    let x = c[0].max(c[1]).max(c[2]);
    let mut out = c;
    if n < 0.0 {
        for v in &mut out {
            *v = l + (*v - l) * l / (l - n).max(1e-6);
        }
    }
    if x > 1.0 {
        for v in &mut out {
            *v = l + (*v - l) * (1.0 - l) / (x - l).max(1e-6);
        }
    }
    out
}

fn set_lum(c: [f32; 3], l: f32) -> [f32; 3] {
    let d = l - lum(c);
    clip_color([c[0] + d, c[1] + d, c[2] + d])
}

fn set_sat(c: [f32; 3], s: f32) -> [f32; 3] {
    // Sort the channels, stretch the range between min and max to `s`.
    let mut idx = [0usize, 1, 2];
    idx.sort_by(|&a, &b| c[a].partial_cmp(&c[b]).unwrap_or(std::cmp::Ordering::Equal));
    let (lo, mid, hi) = (idx[0], idx[1], idx[2]);
    let mut out = [0.0; 3];
    if c[hi] > c[lo] {
        out[mid] = (c[mid] - c[lo]) * s / (c[hi] - c[lo]);
        out[hi] = s;
    }
    out
}

impl Rgba {
    /// Composites `self` over `dst` through a blend mode. Normal is plain
    /// source-over; every other mode blends the colours first, in proportion
    /// to how much backdrop there is to blend with.
    pub fn blend_over(self, dst: Rgba, mode: BlendMode) -> Rgba {
        if mode == BlendMode::Normal || self.a == 0 {
            return self.over(dst);
        }
        if dst.a == 0 {
            return self.over(dst);
        }
        let unit = |v: u8| f32::from(v) / 255.0;
        let cs = [unit(self.r), unit(self.g), unit(self.b)];
        let cb = [unit(dst.r), unit(dst.g), unit(dst.b)];
        let blended = mode.rgb(cb, cs);
        let ab = unit(dst.a);
        let mix = |i: usize| ((1.0 - ab) * cs[i] + ab * blended[i]).clamp(0.0, 1.0);
        let to = |v: f32| (v * 255.0).round() as u8;
        Rgba::new(to(mix(0)), to(mix(1)), to(mix(2)), self.a).over(dst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: Rgba = Rgba::opaque(255, 0, 0);
    const GREY: Rgba = Rgba::opaque(128, 128, 128);

    #[test]
    fn every_mode_round_trips_its_name() {
        for mode in BlendMode::ALL {
            assert_eq!(BlendMode::from_name(mode.name()), Some(*mode));
            assert!(!mode.label().is_empty());
        }
        assert_eq!(BlendMode::from_name("dissolve"), None);
    }

    #[test]
    fn normal_is_plain_source_over() {
        assert_eq!(RED.blend_over(GREY, BlendMode::Normal), RED);
        let half = Rgba::new(255, 0, 0, 128);
        assert_eq!(half.blend_over(GREY, BlendMode::Normal), half.over(GREY));
    }

    #[test]
    fn multiply_darkens_and_screen_lightens() {
        let m = GREY.blend_over(GREY, BlendMode::Multiply);
        assert!((m.r as i32 - 64).abs() <= 1, "{m}");
        let s = GREY.blend_over(GREY, BlendMode::Screen);
        assert!((s.r as i32 - 192).abs() <= 1, "{s}");
        assert_eq!(Rgba::WHITE.blend_over(GREY, BlendMode::Multiply), GREY, "white multiplies to nothing");
        assert_eq!(Rgba::BLACK.blend_over(GREY, BlendMode::Screen), GREY, "black screens to nothing");
    }

    #[test]
    fn darken_and_lighten_pick_a_side() {
        assert_eq!(Rgba::BLACK.blend_over(GREY, BlendMode::Darken), Rgba::BLACK);
        assert_eq!(Rgba::BLACK.blend_over(GREY, BlendMode::Lighten), GREY);
        assert_eq!(Rgba::WHITE.blend_over(GREY, BlendMode::Difference).r, 127);
    }

    #[test]
    fn overlay_keeps_mid_grey_and_neutral_modes_leave_the_backdrop() {
        assert!((GREY.blend_over(GREY, BlendMode::Overlay).r as i32 - 128).abs() <= 2);
        for mode in [BlendMode::Overlay, BlendMode::SoftLight, BlendMode::HardLight] {
            let out = GREY.blend_over(RED, mode);
            assert!((out.r as i32 - 255).abs() <= 2 && out.g <= 2, "{mode:?} with mid grey changed red to {out}");
        }
    }

    #[test]
    fn hue_and_colour_take_the_hue_and_keep_the_light() {
        let blue = Rgba::opaque(0, 0, 255);
        let out = blue.blend_over(RED, BlendMode::Hue);
        assert!(out.b > out.r, "took the hue: {out}");
        let lum_in = 0.3 * 255.0;
        let lum_out = 0.3 * f32::from(out.r) + 0.59 * f32::from(out.g) + 0.11 * f32::from(out.b);
        assert!((lum_in - lum_out).abs() < 3.0, "kept the lightness: {out}");
        let lit = GREY.blend_over(RED, BlendMode::Luminosity);
        let lum_lit = 0.3 * f32::from(lit.r) + 0.59 * f32::from(lit.g) + 0.11 * f32::from(lit.b);
        assert!((lum_lit - 128.0).abs() < 3.0, "grey's lightness on red's hue: {lit}");
        assert!(lit.r > lit.g, "still red");
    }

    #[test]
    fn over_transparency_every_mode_is_just_the_source() {
        for mode in BlendMode::ALL {
            assert_eq!(RED.blend_over(Rgba::TRANSPARENT, *mode), RED, "{mode:?}");
        }
    }

    #[test]
    fn source_alpha_still_scales_the_effect() {
        let faint = Rgba::new(0, 0, 0, 64);
        let out = faint.blend_over(Rgba::WHITE, BlendMode::Multiply);
        assert!(out.r > 180 && out.r < 200, "a quarter of the way to black: {out}");
        assert_eq!(out.a, 255);
    }
}
