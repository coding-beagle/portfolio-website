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

#[derive(Clone, Debug, PartialEq)]
pub enum Adjustment {
    /// `brightness` and `contrast` in `-100..=100`.
    BrightnessContrast { brightness: f32, contrast: f32 },
    /// `hue` in degrees `-180..=180`; `saturation` and `lightness` in
    /// `-100..=100`.
    HueSaturation { hue: f32, saturation: f32, lightness: f32 },
    /// Input levels: `black` and `white` in `0..=255`, `gamma` in `0.1..=10`.
    Levels { black: f32, white: f32, gamma: f32 },
    /// A tone curve through `points` (input, output) in `0..=255`, sorted by
    /// input, applied to every channel. Two points, `(0,0)` and
    /// `(255,255)`, are the identity.
    Curves { points: Vec<(f32, f32)> },
    /// Colour balance: for each of shadows, midtones and highlights, a
    /// cyan–red, magenta–green and yellow–blue shift in `-100..=100`.
    ColorBalance { shadows: [f32; 3], midtones: [f32; 3], highlights: [f32; 3] },
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
        "curves",
        "color-balance",
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
            "curves" => Adjustment::Curves { points: curve_points(params) },
            "color-balance" => {
                let c = |i: usize| p(i, 0.0).clamp(-100.0, 100.0);
                Adjustment::ColorBalance {
                    shadows: [c(0), c(1), c(2)],
                    midtones: [c(3), c(4), c(5)],
                    highlights: [c(6), c(7), c(8)],
                }
            }
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
            Adjustment::Curves { .. } => "curves",
            Adjustment::ColorBalance { .. } => "color-balance",
            Adjustment::Invert => "invert",
            Adjustment::Desaturate => "desaturate",
            Adjustment::Posterize { .. } => "posterize",
            Adjustment::Threshold { .. } => "threshold",
        }
    }

    /// The name the layers panel shows an adjustment layer under.
    pub fn label(&self) -> &'static str {
        match self {
            Adjustment::BrightnessContrast { .. } => "Brightness/Contrast",
            Adjustment::HueSaturation { .. } => "Hue/Saturation",
            Adjustment::Levels { .. } => "Levels",
            Adjustment::Curves { .. } => "Curves",
            Adjustment::ColorBalance { .. } => "Colour Balance",
            Adjustment::Invert => "Invert",
            Adjustment::Desaturate => "Desaturate",
            Adjustment::Posterize { .. } => "Posterize",
            Adjustment::Threshold { .. } => "Threshold",
        }
    }

    /// The parameters in the order [`Adjustment::from_params`] takes them,
    /// so an adjustment layer's dialog can open showing what it has.
    pub fn params(&self) -> Vec<f32> {
        match self {
            Adjustment::BrightnessContrast { brightness, contrast } => vec![*brightness, *contrast],
            Adjustment::HueSaturation { hue, saturation, lightness } => vec![*hue, *saturation, *lightness],
            Adjustment::Levels { black, white, gamma } => vec![*black, *white, *gamma],
            Adjustment::Curves { points } => points.iter().flat_map(|(x, y)| [*x, *y]).collect(),
            Adjustment::ColorBalance { shadows, midtones, highlights } => {
                shadows.iter().chain(midtones).chain(highlights).copied().collect()
            }
            Adjustment::Invert | Adjustment::Desaturate => Vec::new(),
            Adjustment::Posterize { levels } => vec![*levels],
            Adjustment::Threshold { level } => vec![*level],
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
        match self {
            Adjustment::HueSaturation { hue, saturation, lightness } => {
                let (h, s, l) = rgb_to_hsl(p);
                let h = (h + hue).rem_euclid(360.0);
                let s = if *saturation >= 0.0 {
                    s + (1.0 - s) * (saturation / 100.0)
                } else {
                    s * (1.0 + saturation / 100.0)
                };
                let l = if *lightness >= 0.0 {
                    l + (1.0 - l) * (lightness / 100.0)
                } else {
                    l * (1.0 + lightness / 100.0)
                };
                hsl_to_rgb(h, s.clamp(0.0, 1.0), l.clamp(0.0, 1.0)).with_alpha(p.a)
            }
            Adjustment::ColorBalance { shadows, midtones, highlights } => {
                // How much each tonal range has a say, from the pixel's
                // brightness: the shadows own the dark end, the highlights
                // the bright end, the midtones the middle.
                let l = f32::from(luminance(p)) / 255.0;
                let ws = (1.0 - l) * (1.0 - l);
                let wh = l * l;
                let wm = (1.0 - ws - wh).max(0.0);
                let shift = |i: usize| (shadows[i] * ws + midtones[i] * wm + highlights[i] * wh) / 100.0 * 255.0 * 0.5;
                let ch = |v: u8, i: usize| (f32::from(v) + shift(i)).round().clamp(0.0, 255.0) as u8;
                Rgba::new(ch(p.r, 0), ch(p.g, 1), ch(p.b, 2), p.a)
            }
            Adjustment::Desaturate => {
                let y = luminance(p);
                Rgba::new(y, y, y, p.a)
            }
            Adjustment::Threshold { level } => {
                let v = if f32::from(luminance(p)) >= *level { 255 } else { 0 };
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
        let f: Box<dyn Fn(f32) -> f32> = match self {
            Adjustment::BrightnessContrast { brightness, contrast } => {
                let b = brightness / 100.0;
                // Contrast as a slope about mid-grey; +100 is a slope of 3,
                // -100 flattens to grey.
                let c = if *contrast >= 0.0 { 1.0 + contrast / 50.0 } else { 1.0 + contrast / 100.0 };
                Box::new(move |v| (v - 0.5) * c + 0.5 + b)
            }
            Adjustment::Levels { black, white, gamma } => {
                let lo = black / 255.0;
                let hi = (white / 255.0).max(lo + 1.0 / 255.0);
                let gamma = *gamma;
                Box::new(move |v| ((v - lo) / (hi - lo)).clamp(0.0, 1.0).powf(1.0 / gamma))
            }
            Adjustment::Curves { points } => {
                let curve = curve_lut(points);
                return Some(curve);
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

/// Reads curve points from a flat parameter list: pairs, clamped to the
/// range, sorted by input, with the identity's two ends as the fallback.
fn curve_points(params: &[f32]) -> Vec<(f32, f32)> {
    let mut points: Vec<(f32, f32)> = params
        .as_chunks::<2>()
        .0
        .iter()
        .map(|p| (p[0].clamp(0.0, 255.0), p[1].clamp(0.0, 255.0)))
        .collect();
    if points.len() < 2 {
        return vec![(0.0, 0.0), (255.0, 255.0)];
    }
    points.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    // Two points on the same input are one point.
    points.dedup_by(|a, b| (a.0 - b.0).abs() < 0.5);
    if points.len() < 2 {
        return vec![(0.0, 0.0), (255.0, 255.0)];
    }
    points
}

/// The lookup table for a curve: a monotone cubic through the points
/// (Fritsch–Carlson), which follows them smoothly without overshooting
/// between them, and holds level beyond the first and last.
fn curve_lut(points: &[(f32, f32)]) -> [u8; 256] {
    let n = points.len();
    let mut lut = [0u8; 256];
    if n < 2 {
        for (i, slot) in lut.iter_mut().enumerate() {
            *slot = i as u8;
        }
        return lut;
    }
    // Secant slopes, then the tangent at each point.
    let delta: Vec<f32> = (0..n - 1).map(|i| (points[i + 1].1 - points[i].1) / (points[i + 1].0 - points[i].0).max(1e-6)).collect();
    let mut m = vec![0.0f32; n];
    m[0] = delta[0];
    m[n - 1] = delta[n - 2];
    for i in 1..n - 1 {
        m[i] = if delta[i - 1] * delta[i] <= 0.0 { 0.0 } else { (delta[i - 1] + delta[i]) / 2.0 };
    }
    for i in 0..n - 1 {
        if delta[i] == 0.0 {
            m[i] = 0.0;
            m[i + 1] = 0.0;
            continue;
        }
        let a = m[i] / delta[i];
        let b = m[i + 1] / delta[i];
        let s = a * a + b * b;
        if s > 9.0 {
            let t = 3.0 / s.sqrt();
            m[i] = t * a * delta[i];
            m[i + 1] = t * b * delta[i];
        }
    }
    for (x, slot) in lut.iter_mut().enumerate() {
        let x = x as f32;
        let y = if x <= points[0].0 {
            points[0].1
        } else if x >= points[n - 1].0 {
            points[n - 1].1
        } else {
            let i = (0..n - 1).find(|&i| x < points[i + 1].0).unwrap_or(n - 2);
            let (x0, y0) = points[i];
            let (x1, y1) = points[i + 1];
            let h = (x1 - x0).max(1e-6);
            let t = (x - x0) / h;
            let t2 = t * t;
            let t3 = t2 * t;
            let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
            let h10 = t3 - 2.0 * t2 + t;
            let h01 = -2.0 * t3 + 3.0 * t2;
            let h11 = t3 - t2;
            h00 * y0 + h10 * h * m[i] + h01 * y1 + h11 * h * m[i + 1]
        };
        *slot = y.round().clamp(0.0, 255.0) as u8;
    }
    lut
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

// ---- Automatic levels ------------------------------------------------------------

/// The share of pixels clipped at each end when the levels are worked out
/// automatically, so a few stray pixels do not set the range.
const AUTO_CLIP: f64 = 0.001;

/// The black and white points of one channel's histogram, with the darkest
/// and brightest `AUTO_CLIP` of the pixels clipped off.
fn auto_range(hist: &[u64; 256], total: u64) -> (u8, u8) {
    if total == 0 {
        return (0, 255);
    }
    let clip = (total as f64 * AUTO_CLIP) as u64;
    let mut lo = 0usize;
    let mut seen = 0;
    while lo < 255 && seen + hist[lo] <= clip {
        seen += hist[lo];
        lo += 1;
    }
    let mut hi = 255usize;
    seen = 0;
    while hi > lo && seen + hist[hi] <= clip {
        seen += hist[hi];
        hi -= 1;
    }
    (lo as u8, hi as u8)
}

fn stretch(lo: u8, hi: u8) -> [u8; 256] {
    let mut lut = [0u8; 256];
    let span = f32::from(hi.max(lo + 1)) - f32::from(lo);
    for (i, slot) in lut.iter_mut().enumerate() {
        *slot = (((i as f32 - f32::from(lo)) / span).clamp(0.0, 1.0) * 255.0).round() as u8;
    }
    lut
}

/// Stretches the pixels inside `clip` to the full range: each channel on
/// its own for Auto Levels (`per_channel`), which also corrects a colour
/// cast, or all three together for Auto Contrast, which keeps the colours
/// as they are. Only pixels with any alpha count.
pub fn auto_levels(raster: &mut Raster, clip: &Rect, per_channel: bool) {
    let area = clip.intersect(&raster.bounds());
    let mut hist = [[0u64; 256]; 3];
    let mut total = 0u64;
    for y in area.y..area.bottom() {
        for x in area.x..area.right() {
            let p = raster.get(x, y);
            if p.a == 0 {
                continue;
            }
            hist[0][p.r as usize] += 1;
            hist[1][p.g as usize] += 1;
            hist[2][p.b as usize] += 1;
            total += 1;
        }
    }
    let luts: [[u8; 256]; 3] = if per_channel {
        [0, 1, 2].map(|c| {
            let (lo, hi) = auto_range(&hist[c], total);
            stretch(lo, hi)
        })
    } else {
        let mut all = [0u64; 256];
        for h in &hist {
            for (a, b) in all.iter_mut().zip(h) {
                *a += b;
            }
        }
        let (lo, hi) = auto_range(&all, total * 3);
        let lut = stretch(lo, hi);
        [lut; 3]
    };
    raster.map_in(&area, |p| Rgba::new(luts[0][p.r as usize], luts[1][p.g as usize], luts[2][p.b as usize], p.a));
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
    fn params_round_trip_through_from_params() {
        for name in Adjustment::NAMES {
            let adj = Adjustment::from_params(name, &[30.0, 200.0, 2.0, 40.0]).unwrap();
            assert_eq!(Adjustment::from_params(name, &adj.params()).unwrap(), adj, "{name}");
            assert!(!adj.label().is_empty());
        }
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
    fn curves_pass_through_their_points_and_stay_monotone() {
        let identity = Adjustment::from_params("curves", &[]).unwrap();
        assert_eq!(identity.map(GREY), GREY);
        // An S: darker shadows, brighter highlights, the middle held.
        let s = Adjustment::from_params("curves", &[0.0, 0.0, 64.0, 40.0, 128.0, 128.0, 192.0, 215.0, 255.0, 255.0]).unwrap();
        assert_eq!(s.map(Rgba::opaque(64, 64, 64)).r, 40);
        assert_eq!(s.map(GREY).r, 128);
        assert_eq!(s.map(Rgba::opaque(192, 192, 192)).r, 215);
        let lut = curve_lut(&curve_points(&s.params()));
        assert!(lut.windows(2).all(|w| w[0] <= w[1]), "never dips");
        // Points come in any order and land sorted; a lone point is ignored.
        let backwards = Adjustment::from_params("curves", &[255.0, 200.0, 0.0, 10.0]).unwrap();
        assert_eq!(backwards.params(), vec![0.0, 10.0, 255.0, 200.0]);
        assert_eq!(Adjustment::from_params("curves", &[9.0, 9.0]).unwrap().params(), vec![0.0, 0.0, 255.0, 255.0]);
        // A curve held flat past its last point does not wrap.
        let clipped = Adjustment::from_params("curves", &[0.0, 0.0, 128.0, 255.0]).unwrap();
        assert_eq!(clipped.map(Rgba::opaque(200, 200, 200)).r, 255);
    }

    #[test]
    fn colour_balance_shifts_the_range_it_is_told_to() {
        let warm_shadows = Adjustment::from_params("color-balance", &[100.0, 0.0, 0.0]).unwrap();
        let dark = warm_shadows.map(Rgba::opaque(20, 20, 20));
        assert!(dark.r > 20 + 60, "red rose in the shadows: {dark}");
        assert_eq!(dark.g, 20);
        let light = warm_shadows.map(Rgba::opaque(240, 240, 240));
        assert!(light.r <= 245, "and hardly in the highlights: {light}");
        let blue_highlights = Adjustment::from_params("color-balance", &[0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 100.0]).unwrap();
        assert!(blue_highlights.map(Rgba::opaque(200, 200, 200)).b > 230);
        assert!(blue_highlights.map(Rgba::opaque(20, 20, 20)).b < 30);
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

    #[test]
    fn auto_levels_stretch_a_flat_picture_and_auto_contrast_keeps_the_cast() {
        // A dull, reddish gradient: red 60..=160, green and blue 40..=140.
        let mut r = Raster::new(101, 1);
        for x in 0..101 {
            r.set(x, 0, Rgba::opaque(60 + x as u8, 40 + x as u8, 40 + x as u8));
        }
        let all = r.bounds();
        let mut levels = r.clone();
        auto_levels(&mut levels, &all, true);
        assert_eq!(levels.get(0, 0), Rgba::BLACK, "each channel starts at black");
        assert_eq!(levels.get(100, 0), Rgba::WHITE, "and ends at white: the cast is gone");
        let mut contrast = r.clone();
        auto_levels(&mut contrast, &all, false);
        let end = contrast.get(100, 0);
        assert_eq!(end.r, 255);
        assert!(end.g < 255, "the cast stays: {end}");
        assert_eq!(contrast.get(0, 0).g, 0);
        // Transparent pixels neither count nor change.
        let mut with_hole = r.clone();
        with_hole.set(50, 0, Rgba::TRANSPARENT);
        auto_levels(&mut with_hole, &all, true);
        assert_eq!(with_hole.get(50, 0), Rgba::TRANSPARENT);
    }
}
