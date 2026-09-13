//! Image adjustments: per-pixel colour operations on a layer.
//!
//! An [`Adjustment`] is a pure function from one colour to another, applied
//! to every pixel inside a clip. Alpha is never touched. Each variant is
//! built from a name and a flat list of parameters so the page can describe
//! an adjustment dialog as data and the engine can stay the only place that
//! knows what the numbers mean.

use crate::color::Rgba;
use crate::geometry::Rect;
use crate::raster::Raster;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Adjustment {
    /// `brightness` and `contrast` in `-100..=100`.
    BrightnessContrast { brightness: f32, contrast: f32 },
    /// `hue` in degrees `-180..=180`; `saturation` and `lightness` in
    /// `-100..=100`.
    HueSaturation { hue: f32, saturation: f32, lightness: f32 },
    /// Input levels: `black` and `white` in `0..=255`, `gamma` in `0.1..=10`.
    Levels { black: f32, white: f32, gamma: f32 },
    Invert,
    Desaturate,
    /// `levels` per channel, `2..=255`.
    Posterize { levels: f32 },
    /// Luminance threshold, `0..=255`.
    Threshold { level: f32 },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdjustmentError(pub String);

impl std::fmt::Display for AdjustmentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for AdjustmentError {}

impl Adjustment {
    pub const NAMES: &'static [&'static str] = &[
        "brightness-contrast",
        "hue-saturation",
        "levels",
        "invert",
        "desaturate",
        "posterize",
        "threshold",
    ];

    /// Builds an adjustment from its name and parameters, in the order the
    /// variant's fields are declared. Missing parameters take their neutral
    /// value; extra ones are ignored.
    pub fn from_params(name: &str, params: &[f32]) -> Result<Adjustment, AdjustmentError> {
        let p = |i: usize, default: f32| params.get(i).copied().unwrap_or(default);
        Ok(match name {
            "brightness-contrast" => Adjustment::BrightnessContrast {
                brightness: p(0, 0.0).clamp(-100.0, 100.0),
                contrast: p(1, 0.0).clamp(-100.0, 100.0),
            },
            "hue-saturation" => Adjustment::HueSaturation {
                hue: p(0, 0.0).clamp(-180.0, 180.0),
                saturation: p(1, 0.0).clamp(-100.0, 100.0),
                lightness: p(2, 0.0).clamp(-100.0, 100.0),
            },
            "levels" => Adjustment::Levels {
                black: p(0, 0.0).clamp(0.0, 254.0),
                white: p(1, 255.0).clamp(1.0, 255.0),
                gamma: p(2, 1.0).clamp(0.1, 10.0),
            },
            "invert" => Adjustment::Invert,
            "desaturate" => Adjustment::Desaturate,
            "posterize" => Adjustment::Posterize { levels: p(0, 4.0).clamp(2.0, 255.0) },
            "threshold" => Adjustment::Threshold { level: p(0, 128.0).clamp(0.0, 255.0) },
            other => return Err(AdjustmentError(format!("unknown adjustment: {other}"))),
        })
    }

    pub fn name(&self) -> &'static str {
        match self {
            Adjustment::BrightnessContrast { .. } => "brightness-contrast",
            Adjustment::HueSaturation { .. } => "hue-saturation",
            Adjustment::Levels { .. } => "levels",
            Adjustment::Invert => "invert",
            Adjustment::Desaturate => "desaturate",
            Adjustment::Posterize { .. } => "posterize",
            Adjustment::Threshold { .. } => "threshold",
        }
    }

    /// Whether the adjustment has parameters worth a dialog.
    pub fn has_params(&self) -> bool {
        !matches!(self, Adjustment::Invert | Adjustment::Desaturate)
    }

    /// Applies the adjustment to every pixel of `raster` inside `clip`.
    pub fn apply(&self, raster: &mut Raster, clip: &Rect) {
        match self.lut() {
            Some(lut) => raster.map_in(clip, |p| Rgba::new(lut[p.r as usize], lut[p.g as usize], lut[p.b as usize], p.a)),
            None => raster.map_in(clip, |p| self.map(p)),
        }
    }

    /// The adjustment applied to one colour.
    pub fn map(&self, p: Rgba) -> Rgba {
        match *self {
            Adjustment::HueSaturation { hue, saturation, lightness } => {
                let (h, s, l) = rgb_to_hsl(p);
                let h = (h + hue).rem_euclid(360.0);
                let s = if saturation >= 0.0 {
                    s + (1.0 - s) * (saturation / 100.0)
                } else {
                    s * (1.0 + saturation / 100.0)
                };
                let l = if lightness >= 0.0 {
                    l + (1.0 - l) * (lightness / 100.0)
                } else {
                    l * (1.0 + lightness / 100.0)
                };
                hsl_to_rgb(h, s.clamp(0.0, 1.0), l.clamp(0.0, 1.0)).with_alpha(p.a)
            }
            Adjustment::Desaturate => {
                let y = luminance(p);
                Rgba::new(y, y, y, p.a)
            }
            Adjustment::Threshold { level } => {
                let v = if f32::from(luminance(p)) >= level { 255 } else { 0 };
                Rgba::new(v, v, v, p.a)
            }
            _ => {
                let lut = self.lut().expect("every other adjustment is per-channel");
                Rgba::new(lut[p.r as usize], lut[p.g as usize], lut[p.b as usize], p.a)
            }
        }
    }

    /// A per-channel lookup table, for the adjustments that treat each
    /// channel independently. `None` for the ones that need the whole colour.
    fn lut(&self) -> Option<[u8; 256]> {
        let f: Box<dyn Fn(f32) -> f32> = match *self {
            Adjustment::BrightnessContrast { brightness, contrast } => {
                let b = brightness / 100.0;
                // Contrast as a slope about mid-grey; +100 is a slope of 3,
                // -100 flattens to grey.
                let c = if contrast >= 0.0 { 1.0 + contrast / 50.0 } else { 1.0 + contrast / 100.0 };
                Box::new(move |v| (v - 0.5) * c + 0.5 + b)
            }
            Adjustment::Levels { black, white, gamma } => {
                let lo = black / 255.0;
                let hi = (white / 255.0).max(lo + 1.0 / 255.0);
                Box::new(move |v| ((v - lo) / (hi - lo)).clamp(0.0, 1.0).powf(1.0 / gamma))
            }
            Adjustment::Invert => Box::new(|v| 1.0 - v),
            Adjustment::Posterize { levels } => {
                let n = levels.round().max(2.0);
                Box::new(move |v| ((v * n).floor().min(n - 1.0)) / (n - 1.0))
            }
            _ => return None,
        };
        let mut lut = [0u8; 256];
        for (i, slot) in lut.iter_mut().enumerate() {
            *slot = (f(i as f32 / 255.0).clamp(0.0, 1.0) * 255.0).round() as u8;
        }
        Some(lut)
    }
}

/// Rec. 601 luma, the usual "how bright is this pixel".
pub fn luminance(p: Rgba) -> u8 {
    (0.299 * f32::from(p.r) + 0.587 * f32::from(p.g) + 0.114 * f32::from(p.b)).round() as u8
}

/// Hue in degrees `0..360`, saturation and lightness in `0..=1`.
pub fn rgb_to_hsl(p: Rgba) -> (f32, f32, f32) {
    let r = f32::from(p.r) / 255.0;
    let g = f32::from(p.g) / 255.0;
    let b = f32::from(p.b) / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if max == min {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };
    let h = if max == r {
        (g - b) / d + if g < b { 6.0 } else { 0.0 }
    } else if max == g {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    (h * 60.0, s, l)
}

pub fn hsl_to_rgb(h: f32, s: f32, l: f32) -> Rgba {
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let hp = h.rem_euclid(360.0) / 60.0;
    let x = c * (1.0 - (hp % 2.0 - 1.0).abs());
    let (r, g, b) = match hp as i32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let m = l - c / 2.0;
    let to = |v: f32| ((v + m).clamp(0.0, 1.0) * 255.0).round() as u8;
    Rgba::opaque(to(r), to(g), to(b))
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: Rgba = Rgba::opaque(255, 0, 0);
    const GREY: Rgba = Rgba::opaque(128, 128, 128);

    #[test]
    fn every_name_builds_with_defaults_that_are_neutral() {
        for name in Adjustment::NAMES {
            let adj = Adjustment::from_params(name, &[]).unwrap();
            assert_eq!(adj.name(), *name);
            if matches!(adj, Adjustment::Invert | Adjustment::Desaturate | Adjustment::Posterize { .. } | Adjustment::Threshold { .. }) {
                continue;
            }
            let out = adj.map(Rgba::opaque(200, 100, 50));
            assert!((out.r as i32 - 200).abs() <= 1 && (out.g as i32 - 100).abs() <= 1 && (out.b as i32 - 50).abs() <= 1, "{name} with defaults changed the colour: {out}");
        }
        assert!(Adjustment::from_params("sepia", &[]).is_err());
    }

    #[test]
    fn alpha_is_preserved() {
        let p = Rgba::new(10, 20, 30, 77);
        for name in Adjustment::NAMES {
            let adj = Adjustment::from_params(name, &[50.0, 50.0, 2.0]).unwrap();
            assert_eq!(adj.map(p).a, 77, "{name}");
        }
    }

    #[test]
    fn invert_and_desaturate() {
        assert_eq!(Adjustment::Invert.map(RED), Rgba::opaque(0, 255, 255));
        let d = Adjustment::Desaturate.map(RED);
        assert_eq!((d.r, d.g, d.b), (76, 76, 76));
    }

    #[test]
    fn brightness_and_contrast_move_the_right_way() {
        let brighter = Adjustment::from_params("brightness-contrast", &[50.0, 0.0]).unwrap();
        assert!(brighter.map(GREY).r > 128);
        let darker = Adjustment::from_params("brightness-contrast", &[-50.0, 0.0]).unwrap();
        assert!(darker.map(GREY).r < 128);
        let punchy = Adjustment::from_params("brightness-contrast", &[0.0, 50.0]).unwrap();
        assert!(punchy.map(Rgba::opaque(200, 200, 200)).r > 200);
        assert!(punchy.map(Rgba::opaque(50, 50, 50)).r < 50);
        let flat = Adjustment::from_params("brightness-contrast", &[0.0, -100.0]).unwrap();
        assert_eq!(flat.map(Rgba::WHITE).r, 128, "no contrast is all mid-grey");
    }

    #[test]
    fn levels_stretch_the_range() {
        let adj = Adjustment::from_params("levels", &[64.0, 192.0, 1.0]).unwrap();
        assert_eq!(adj.map(Rgba::opaque(64, 64, 64)).r, 0);
        assert_eq!(adj.map(Rgba::opaque(192, 192, 192)).r, 255);
        assert_eq!(adj.map(GREY).r, 128);
        let bright_mid = Adjustment::from_params("levels", &[0.0, 255.0, 2.0]).unwrap();
        assert!(bright_mid.map(GREY).r > 128, "gamma above 1 lifts the midtones");
    }

    #[test]
    fn hue_rotation_walks_the_wheel() {
        let adj = Adjustment::from_params("hue-saturation", &[120.0]).unwrap();
        let g = adj.map(RED);
        assert_eq!((g.r, g.g, g.b), (0, 255, 0));
        let sat_out = Adjustment::from_params("hue-saturation", &[0.0, -100.0]).unwrap();
        let grey = sat_out.map(RED);
        assert_eq!(grey.r, grey.g);
        assert_eq!(grey.g, grey.b);
        let lighter = Adjustment::from_params("hue-saturation", &[0.0, 0.0, 100.0]).unwrap();
        assert_eq!(lighter.map(RED), Rgba::WHITE);
    }

    #[test]
    fn posterize_and_threshold() {
        let two = Adjustment::from_params("posterize", &[2.0]).unwrap();
        assert_eq!(two.map(Rgba::opaque(100, 200, 0)), Rgba::opaque(0, 255, 0));
        let t = Adjustment::from_params("threshold", &[128.0]).unwrap();
        assert_eq!(t.map(Rgba::opaque(200, 200, 200)), Rgba::WHITE);
        assert_eq!(t.map(Rgba::opaque(50, 50, 50)), Rgba::BLACK);
    }

    #[test]
    fn hsl_round_trips() {
        for p in [RED, GREY, Rgba::WHITE, Rgba::BLACK, Rgba::opaque(12, 200, 99), Rgba::opaque(250, 30, 180)] {
            let (h, s, l) = rgb_to_hsl(p);
            let back = hsl_to_rgb(h, s, l);
            assert!((back.r as i32 - p.r as i32).abs() <= 1 && (back.g as i32 - p.g as i32).abs() <= 1 && (back.b as i32 - p.b as i32).abs() <= 1, "{p} -> {back}");
        }
        assert_eq!(rgb_to_hsl(Rgba::opaque(0, 0, 255)).0, 240.0);
    }

    #[test]
    fn apply_is_clipped() {
        let mut r = Raster::filled(3, 1, Rgba::WHITE);
        Adjustment::Invert.apply(&mut r, &Rect::new(1, 0, 1, 1));
        assert_eq!(r.get(0, 0), Rgba::WHITE);
        assert_eq!(r.get(1, 0), Rgba::BLACK);
        assert_eq!(r.get(2, 0), Rgba::WHITE);
    }
}
