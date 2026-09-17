//! Image adjustments: per-pixel colour operations on a layer.
//!
//! An [`Adjustment`] is a pure function from one colour to another, applied
//! to every pixel inside a clip. Alpha is never touched. Each variant is
//! built from a name and a flat list of parameters so the page can describe
//! an adjustment dialog as data and the engine can stay the only place that
//! knows what the numbers mean.
//!
//! [`Adjustment::Dither`] is the one that is not a function of the colour
//! alone: where the pixel is decides the threshold, and an error-diffused
//! dither depends on its neighbours besides. It goes through the same
//! [`Adjustment::apply`] funnel — and so gets the dialog, the preview, the
//! undo step, the selection and the adjustment layer's mask for free — but
//! [`Adjustment::map`], which has only a colour to work with, answers with
//! the plain rounding. See [`crate::dither`].

use crate::color::Rgba;
use crate::dither::{Dither, DitherMethod, MAX_LEVELS, MAX_SCALE, MIN_LEVELS};
use crate::palette::Palette;
use crate::filter;
use crate::geometry::Rect;
use crate::raster::Raster;

/// Which of the colour's channels an adjustment is allowed to change.
///
/// The per-channel adjustments — the ones that are a lookup table, and so do
/// the same thing to red as to green — can be pointed at one channel alone,
/// which is how a colour cast is corrected: pull the blue channel's white
/// point down and the picture warms up. The other channels are left as they
/// were.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Channel {
    #[default]
    All,
    Red,
    Green,
    Blue,
}

impl Channel {
    /// In the order the page's dropdown lists them; the index is what
    /// travels as the adjustment's first parameter.
    pub const ALL: &'static [Channel] = &[Channel::All, Channel::Red, Channel::Green, Channel::Blue];

    /// The channel at `index`, clamped to the list.
    pub fn from_index(index: f32) -> Channel {
        let i = if index.is_finite() { index.round().clamp(0.0, (Self::ALL.len() - 1) as f32) as usize } else { 0 };
        Self::ALL[i]
    }

    pub fn index(self) -> f32 {
        Self::ALL.iter().position(|c| *c == self).unwrap_or(0) as f32
    }

    pub fn label(self) -> &'static str {
        match self {
            Channel::All => "RGB",
            Channel::Red => "Red",
            Channel::Green => "Green",
            Channel::Blue => "Blue",
        }
    }

    /// `new` in the channel this targets, `old` in the rest. Alpha comes
    /// from `old` either way: no adjustment touches it.
    pub fn pick(self, new: Rgba, old: Rgba) -> Rgba {
        match self {
            Channel::All => new,
            Channel::Red => Rgba::new(new.r, old.g, old.b, old.a),
            Channel::Green => Rgba::new(old.r, new.g, old.b, old.a),
            Channel::Blue => Rgba::new(old.r, old.g, new.b, old.a),
        }
    }
}

/// What an adjustment does. Which channels it does it to is
/// [`Adjustment::channel`], not part of the operation itself.
#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
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
    /// Quantise to `levels` per channel and hide the error with a dither
    /// pattern. `strength` and `scale` are the pattern's amount and cell
    /// size; `mono` greys the picture first. See [`crate::dither`].
    Dither { method: DitherMethod, levels: f32, strength: f32, scale: f32, mono: bool },
    /// A Gaussian-ish blur of `radius` pixels. See [`crate::filter`].
    Blur { radius: f32 },
    /// Unsharp mask: `amount` percent of what a blur of `radius` threw away,
    /// put back.
    Sharpen { radius: f32, amount: f32 },
    /// Grain: colours scattered by up to `amount` percent of the range,
    /// keyed to where the pixel is. `mono` moves the channels together.
    Noise { amount: f32, mono: bool },
    /// The middle colour of the `radius`-square around each pixel: speckles
    /// go, edges stay. See [`crate::filter`].
    Median { radius: f32 },
    /// A smear `distance` pixels long in the direction `angle` names.
    MotionBlur { angle: f32, distance: f32 },
    /// Squared off into cells of `size` pixels, each its own average.
    Pixelate { size: f32 },
    /// Relief lit from `angle`, `amount` percent deep.
    Emboss { angle: f32, amount: f32 },
    /// The Sobel gradient, `amount` percent of it, as dark lines on white.
    FindEdges { amount: f32 },
    /// Every colour replaced by the nearest in a palette, with the error
    /// hidden by `method` — `None` for a plain nearest match.
    /// `strength` and `scale` are the pattern's amount and cell size, as
    /// they are for a dither. See [`crate::palette`].
    Palette { method: Option<DitherMethod>, strength: f32, scale: f32, palette: Palette },
}


/// An adjustment: what to do, and which channels to do it to.
#[derive(Clone, Debug, PartialEq)]
pub struct Adjustment {
    pub kind: Kind,
    pub channel: Channel,
}

impl From<Kind> for Adjustment {
    /// The whole colour, which is what every adjustment did before there was
    /// a choice.
    fn from(kind: Kind) -> Adjustment {
        Adjustment { kind, channel: Channel::All }
    }
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
        "dither",
        "blur",
        "sharpen",
        "noise",
        "median",
        "motion-blur",
        "pixelate",
        "emboss",
        "find-edges",
        "palette",
    ];

    /// Builds an adjustment from its name and parameters.
    ///
    /// The channel rides one past the kind's own parameters, which is both
    /// where the curve's variable-length list of points has ended and where
    /// a file written before there was a choice has nothing at all — so an
    /// older document simply comes back on RGB.
    pub fn from_params(name: &str, params: &[f32]) -> Result<Adjustment, AdjustmentError> {
        let kind = Kind::from_params(name, params)?;
        if !kind.takes_channel() {
            return Ok(kind.into());
        }
        let at = kind.params().len();
        Ok(Adjustment { kind, channel: Channel::from_index(params.get(at).copied().unwrap_or(0.0)) })
    }

    pub fn name(&self) -> &'static str {
        self.kind.name()
    }

    /// What to call it: the name an adjustment layer is created under, and
    /// the history step's name for the ones applied in one go. It says the
    /// channel when there is one to say.
    pub fn label(&self) -> String {
        match self.channel {
            Channel::All => self.kind.label().to_owned(),
            c => format!("{} ({})", self.kind.label(), c.label()),
        }
    }

    /// The parameters in the order [`Adjustment::from_params`] takes them,
    /// so an adjustment layer's dialog can open showing what it has.
    pub fn params(&self) -> Vec<f32> {
        let mut params = self.kind.params();
        if self.kind.takes_channel() {
            params.push(self.channel.index());
        }
        params
    }

    /// Whether the adjustment has anything worth a dialog.
    pub fn has_params(&self) -> bool {
        self.kind.has_params()
    }

    /// Applies the adjustment to every pixel of `raster` inside `clip`,
    /// leaving the channels it is not aimed at as they were.
    pub fn apply(&self, raster: &mut Raster, clip: &Rect) {
        match self.pixel_map() {
            Some(f) => raster.map_in(clip, |p| f.map(p)),
            None => {
                // A dither, a blur and the two filters built on it are
                // decided by where the pixel is and by its neighbours, so
                // none of them can be written as a function of one colour:
                // each runs over a copy, and the targeted channel is taken
                // back out of it.
                if self.channel == Channel::All {
                    self.kind.apply_spatial(raster, clip);
                } else {
                    let mut worked = raster.clone();
                    self.kind.apply_spatial(&mut worked, clip);
                    let channel = self.channel;
                    raster.map_at(clip, |p, x, y| channel.pick(worked.get(x, y), p));
                }
            }
        }
    }

    /// The adjustment applied to one colour.
    pub fn map(&self, p: Rgba) -> Rgba {
        self.channel.pick(self.kind.map(p), p)
    }

    /// The adjustment as a function of one colour, with everything it can
    /// work out in advance — the lookup table — worked out once.
    ///
    /// A loop over a whole document wants this rather than
    /// [`Adjustment::map`], which rebuilds the table for every pixel it is
    /// handed: at 4K that is eight million tables. `None` for an adjustment
    /// that needs more than the colour to answer, which is the dither.
    pub fn pixel_map(&self) -> Option<PixelMap<'_>> {
        if self.kind.is_spatial() {
            return None;
        }
        Some(PixelMap { kind: &self.kind, channel: self.channel, lut: self.kind.lut() })
    }
}

/// One adjustment, ready to be applied a pixel at a time. From
/// [`Adjustment::pixel_map`].
pub struct PixelMap<'a> {
    kind: &'a Kind,
    channel: Channel,
    lut: Option<[u8; 256]>,
}

impl PixelMap<'_> {
    pub fn map(&self, p: Rgba) -> Rgba {
        let new = match &self.lut {
            Some(lut) => Rgba::new(lut[p.r as usize], lut[p.g as usize], lut[p.b as usize], p.a),
            None => self.kind.map(p),
        };
        self.channel.pick(new, p)
    }
}

impl Kind {
    /// Builds a kind from its name and parameters, in the order the
    /// variant's fields are declared. Missing parameters take their neutral
    /// value; extra ones are ignored. The channel is not among them:
    /// [`Adjustment::from_params`] takes it off the front first.
    pub fn from_params(name: &str, params: &[f32]) -> Result<Kind, AdjustmentError> {
        let p = |i: usize, default: f32| params.get(i).copied().unwrap_or(default);
        Ok(match name {
            "brightness-contrast" => Kind::BrightnessContrast {
                brightness: p(0, 0.0).clamp(-100.0, 100.0),
                contrast: p(1, 0.0).clamp(-100.0, 100.0),
            },
            "hue-saturation" => Kind::HueSaturation {
                hue: p(0, 0.0).clamp(-180.0, 180.0),
                saturation: p(1, 0.0).clamp(-100.0, 100.0),
                lightness: p(2, 0.0).clamp(-100.0, 100.0),
            },
            "levels" => Kind::Levels {
                black: p(0, 0.0).clamp(0.0, 254.0),
                white: p(1, 255.0).clamp(1.0, 255.0),
                gamma: p(2, 1.0).clamp(0.1, 10.0),
            },
            "curves" => Kind::Curves { points: curve_points(params) },
            "color-balance" => {
                let c = |i: usize| p(i, 0.0).clamp(-100.0, 100.0);
                Kind::ColorBalance {
                    shadows: [c(0), c(1), c(2)],
                    midtones: [c(3), c(4), c(5)],
                    highlights: [c(6), c(7), c(8)],
                }
            }
            "invert" => Kind::Invert,
            "desaturate" => Kind::Desaturate,
            "posterize" => Kind::Posterize { levels: p(0, 4.0).clamp(2.0, 255.0) },
            "threshold" => Kind::Threshold { level: p(0, 128.0).clamp(0.0, 255.0) },
            "dither" => Kind::Dither {
                // Floyd–Steinberg by default, as the page's dialog opens,
                // so a dither layer made with no parameters at all is the
                // one most people mean by the word.
                method: DitherMethod::from_index(p(0, DitherMethod::FloydSteinberg.index())),
                levels: p(1, 2.0).round().clamp(MIN_LEVELS, MAX_LEVELS),
                strength: p(2, 100.0).clamp(0.0, 100.0),
                scale: p(3, 1.0).round().clamp(1.0, MAX_SCALE),
                mono: p(4, 0.0) >= 0.5,
            },
            "blur" => Kind::Blur { radius: p(0, 2.0).clamp(0.0, filter::MAX_BLUR_RADIUS) },
            "sharpen" => Kind::Sharpen {
                radius: p(0, 1.0).clamp(1.0, filter::MAX_BLUR_RADIUS),
                amount: p(1, 100.0).clamp(0.0, 300.0),
            },
            "noise" => Kind::Noise { amount: p(0, 10.0).clamp(0.0, 100.0), mono: p(1, 0.0) >= 0.5 },
            "median" => Kind::Median { radius: p(0, 2.0).round().clamp(0.0, filter::MAX_MEDIAN_RADIUS) },
            "motion-blur" => Kind::MotionBlur {
                angle: p(0, 0.0).clamp(-180.0, 180.0),
                distance: p(1, 20.0).clamp(0.0, filter::MAX_MOTION_DISTANCE),
            },
            "pixelate" => Kind::Pixelate { size: p(0, 8.0).round().clamp(1.0, filter::MAX_CELL) },
            "emboss" => Kind::Emboss {
                angle: p(0, 135.0).clamp(-180.0, 180.0),
                amount: p(1, 100.0).clamp(0.0, 300.0),
            },
            "find-edges" => Kind::FindEdges { amount: p(0, 100.0).clamp(0.0, 300.0) },
            // The palette's colours are variable-length and so ride last,
            // where the curve's points do. Zero for the pattern is no
            // dither at all, so the ladder of methods starts at one.
            "palette" => Kind::Palette {
                method: match p(0, 0.0) {
                    v if v < 0.5 => None,
                    v => Some(DitherMethod::from_index(v - 1.0)),
                },
                strength: p(1, 100.0).clamp(0.0, 100.0),
                scale: p(2, 1.0).round().clamp(1.0, MAX_SCALE),
                palette: Palette::from_flat(params.get(3..).unwrap_or_default()),
            },
            other => return Err(AdjustmentError(format!("unknown adjustment: {other}"))),
        })
    }

    pub fn name(&self) -> &'static str {
        match self {
            Kind::BrightnessContrast { .. } => "brightness-contrast",
            Kind::HueSaturation { .. } => "hue-saturation",
            Kind::Levels { .. } => "levels",
            Kind::Curves { .. } => "curves",
            Kind::ColorBalance { .. } => "color-balance",
            Kind::Invert => "invert",
            Kind::Desaturate => "desaturate",
            Kind::Posterize { .. } => "posterize",
            Kind::Threshold { .. } => "threshold",
            Kind::Dither { .. } => "dither",
            Kind::Blur { .. } => "blur",
            Kind::Sharpen { .. } => "sharpen",
            Kind::Noise { .. } => "noise",
            Kind::Median { .. } => "median",
            Kind::MotionBlur { .. } => "motion-blur",
            Kind::Pixelate { .. } => "pixelate",
            Kind::Emboss { .. } => "emboss",
            Kind::FindEdges { .. } => "find-edges",
            Kind::Palette { .. } => "palette",
        }
    }

    /// The name the layers panel shows an adjustment layer under.
    pub fn label(&self) -> &'static str {
        match self {
            Kind::BrightnessContrast { .. } => "Brightness/Contrast",
            Kind::HueSaturation { .. } => "Hue/Saturation",
            Kind::Levels { .. } => "Levels",
            Kind::Curves { .. } => "Curves",
            Kind::ColorBalance { .. } => "Colour Balance",
            Kind::Invert => "Invert",
            Kind::Desaturate => "Desaturate",
            Kind::Posterize { .. } => "Posterize",
            Kind::Threshold { .. } => "Threshold",
            Kind::Dither { .. } => "Dither",
            Kind::Blur { .. } => "Blur",
            Kind::Sharpen { .. } => "Sharpen",
            Kind::Noise { .. } => "Noise",
            Kind::Median { .. } => "Median",
            Kind::MotionBlur { .. } => "Motion Blur",
            Kind::Pixelate { .. } => "Pixelate",
            Kind::Emboss { .. } => "Emboss",
            Kind::FindEdges { .. } => "Find Edges",
            Kind::Palette { .. } => "Palette",
        }
    }

    /// The parameters in the order [`Kind::from_params`] takes them.
    pub fn params(&self) -> Vec<f32> {
        match self {
            Kind::BrightnessContrast { brightness, contrast } => vec![*brightness, *contrast],
            Kind::HueSaturation { hue, saturation, lightness } => vec![*hue, *saturation, *lightness],
            Kind::Levels { black, white, gamma } => vec![*black, *white, *gamma],
            Kind::Curves { points } => points.iter().flat_map(|(x, y)| [*x, *y]).collect(),
            Kind::ColorBalance { shadows, midtones, highlights } => {
                shadows.iter().chain(midtones).chain(highlights).copied().collect()
            }
            Kind::Invert | Kind::Desaturate => Vec::new(),
            Kind::Posterize { levels } => vec![*levels],
            Kind::Threshold { level } => vec![*level],
            Kind::Dither { method, levels, strength, scale, mono } => {
                vec![method.index(), *levels, *strength, *scale, if *mono { 1.0 } else { 0.0 }]
            }
            Kind::Blur { radius } => vec![*radius],
            Kind::Sharpen { radius, amount } => vec![*radius, *amount],
            Kind::Noise { amount, mono } => vec![*amount, if *mono { 1.0 } else { 0.0 }],
            Kind::Median { radius } => vec![*radius],
            Kind::MotionBlur { angle, distance } => vec![*angle, *distance],
            Kind::Pixelate { size } => vec![*size],
            Kind::Emboss { angle, amount } => vec![*angle, *amount],
            Kind::FindEdges { amount } => vec![*amount],
            Kind::Palette { method, strength, scale, palette } => {
                let pattern = method.map_or(0.0, |m| m.index() + 1.0);
                let mut params = vec![pattern, *strength, *scale];
                params.extend(palette.to_flat());
                params
            }
        }
    }

    /// Whether the adjustment has parameters worth a dialog.
    pub fn has_params(&self) -> bool {
        !matches!(self, Kind::Invert | Kind::Desaturate)
    }

    /// Whether this adjustment can be pointed at a single colour channel.
    /// The per-channel family can: what they do to red they do to green the
    /// same way, so doing it to one alone means something. The ones that
    /// read the whole colour (hue, colour balance, threshold) or the picture
    /// around it (dither) cannot, and nor can the two that have no dialog to
    /// put the choice in.
    pub fn takes_channel(&self) -> bool {
        matches!(self, Kind::BrightnessContrast { .. } | Kind::Levels { .. } | Kind::Curves { .. } | Kind::Posterize { .. })
    }

    /// Whether the adjustment needs more than the colour to answer: where
    /// the pixel is, or what is around it. Those go through
    /// [`Kind::apply_spatial`] rather than a lookup table, and
    /// [`Adjustment::pixel_map`] has nothing to offer for them.
    pub fn is_spatial(&self) -> bool {
        match self {
            // A palette map with no dither is a function of the colour
            // alone, and takes the cheaper path through [`PixelMap`].
            Kind::Palette { method, .. } => method.is_some(),
            _ => matches!(
                self,
                Kind::Dither { .. }
                    | Kind::Blur { .. }
                    | Kind::Sharpen { .. }
                    | Kind::Noise { .. }
                    | Kind::Median { .. }
                    | Kind::MotionBlur { .. }
                    | Kind::Pixelate { .. }
                    | Kind::Emboss { .. }
                    | Kind::FindEdges { .. }
            ),
        }
    }

    /// The adjustments that read more than one pixel, applied to the clip.
    ///
    /// Each of these must give a pixel the same answer whatever clip it was
    /// asked for — a preview through a selection composites a rectangle at a
    /// time. [`crate::filter`] says how they manage it.
    fn apply_spatial(&self, raster: &mut Raster, clip: &Rect) {
        match self {
            Kind::Dither { .. } => self.dither().apply(raster, clip),
            Kind::Blur { radius } => filter::blur(raster, clip, *radius),
            Kind::Sharpen { radius, amount } => filter::sharpen(raster, clip, *radius, *amount),
            Kind::Noise { amount, mono } => filter::noise(raster, clip, *amount, *mono),
            Kind::Median { radius } => filter::median(raster, clip, *radius),
            Kind::MotionBlur { angle, distance } => filter::motion_blur(raster, clip, *angle, *distance),
            Kind::Pixelate { size } => filter::pixelate(raster, clip, *size),
            Kind::Emboss { angle, amount } => filter::emboss(raster, clip, *angle, *amount),
            Kind::FindEdges { amount } => filter::find_edges(raster, clip, *amount),
            Kind::Palette { method, strength, scale, palette } => {
                palette.map(raster, clip, *method, strength / 100.0, *scale as i32)
            }
            _ => unreachable!("only a spatial adjustment asks for one"),
        }
    }

    /// The kind applied to one colour, every channel of it. The spatial ones
    /// have no neighbours and no position here: a dither answers with the
    /// rounding it would have dithered around, and the three filters answer
    /// with the colour untouched, since a blur of one pixel on its own is
    /// that pixel. [`Adjustment::apply`] is the real thing.
    pub fn map(&self, p: Rgba) -> Rgba {
        match self {
            Kind::Dither { .. } => self.dither().quantize(p),
            Kind::Palette { palette, .. } => palette.nearest(p),
            // A filter has no neighbours here, and a pixel on its own is
            // what it already was: an emboss of a flat field is flat, a
            // median of one pixel is that pixel.
            Kind::Blur { .. }
            | Kind::Sharpen { .. }
            | Kind::Noise { .. }
            | Kind::Median { .. }
            | Kind::MotionBlur { .. }
            | Kind::Pixelate { .. }
            | Kind::Emboss { .. }
            | Kind::FindEdges { .. } => p,
            Kind::HueSaturation { hue, saturation, lightness } => {
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
            Kind::ColorBalance { shadows, midtones, highlights } => {
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
            Kind::Desaturate => {
                let y = luminance(p);
                Rgba::new(y, y, y, p.a)
            }
            Kind::Threshold { level } => {
                let v = if f32::from(luminance(p)) >= *level { 255 } else { 0 };
                Rgba::new(v, v, v, p.a)
            }
            _ => {
                let lut = self.lut().expect("every other adjustment is per-channel");
                Rgba::new(lut[p.r as usize], lut[p.g as usize], lut[p.b as usize], p.a)
            }
        }
    }

    /// The dither this adjustment describes, with the dialog's `0..=100`
    /// strength as a fraction.
    fn dither(&self) -> Dither {
        match self {
            Kind::Dither { method, levels, strength, scale, mono } => Dither {
                method: *method,
                levels: *levels,
                strength: strength / 100.0,
                scale: *scale,
                mono: *mono,
            },
            _ => unreachable!("only a dither asks for one"),
        }
    }

    /// A per-channel lookup table, for the adjustments that treat each
    /// channel independently. `None` for the ones that need the whole colour.
    fn lut(&self) -> Option<[u8; 256]> {
        let f: Box<dyn Fn(f32) -> f32> = match self {
            Kind::BrightnessContrast { brightness, contrast } => {
                let b = brightness / 100.0;
                // Contrast as a slope about mid-grey; +100 is a slope of 3,
                // -100 flattens to grey.
                let c = if *contrast >= 0.0 { 1.0 + contrast / 50.0 } else { 1.0 + contrast / 100.0 };
                Box::new(move |v| (v - 0.5) * c + 0.5 + b)
            }
            Kind::Levels { black, white, gamma } => {
                let lo = black / 255.0;
                let hi = (white / 255.0).max(lo + 1.0 / 255.0);
                let gamma = *gamma;
                Box::new(move |v| ((v - lo) / (hi - lo)).clamp(0.0, 1.0).powf(1.0 / gamma))
            }
            Kind::Curves { points } => {
                let curve = curve_lut(points);
                return Some(curve);
            }
            Kind::Invert => Box::new(|v| 1.0 - v),
            Kind::Posterize { levels } => {
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
            if matches!(
                adj.kind,
                Kind::Invert | Kind::Desaturate | Kind::Posterize { .. } | Kind::Threshold { .. } | Kind::Dither { .. }
            ) {
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
    fn the_filters_go_through_the_same_funnel() {
        // They are adjustments like any other: named, built from numbers,
        // and applied to a clip. What sets them apart is that they read
        // their neighbours, so they have no pixel map.
        for name in ["blur", "sharpen", "noise"] {
            let adj = Adjustment::from_params(name, &[3.0, 50.0]).unwrap();
            assert!(adj.kind.is_spatial(), "{name}");
            assert!(adj.pixel_map().is_none(), "{name}");
            assert!(!adj.kind.takes_channel(), "{name} reads the picture, not a channel");
            assert!(adj.has_params(), "{name}");
            assert_eq!(adj.map(RED), RED, "one colour on its own has no neighbours to be changed by");
        }
    }

    #[test]
    fn a_blur_adjustment_softens_and_a_sharpen_hardens() {
        let mut edge = Raster::filled(16, 16, GREY);
        let bounds = edge.bounds();
        edge.fill_rect(Rect::new(8, 0, 8, 16), Rgba::opaque(200, 200, 200), &bounds);

        let mut blurred = edge.clone();
        Adjustment::from_params("blur", &[3.0]).unwrap().apply(&mut blurred, &bounds);
        assert!(blurred.get(7, 8).r > 128, "the edge has bled across");
        assert!(blurred.get(8, 8).r < 200);

        let mut sharpened = edge.clone();
        Adjustment::from_params("sharpen", &[2.0, 100.0]).unwrap().apply(&mut sharpened, &bounds);
        assert!(sharpened.get(7, 8).r < 128, "and here it has been pulled apart");
        assert!(sharpened.get(8, 8).r > 200);
    }

    #[test]
    fn noise_grains_the_picture_and_stays_put() {
        let flat = Raster::filled(12, 12, GREY);
        let bounds = flat.bounds();
        let adj = Adjustment::from_params("noise", &[50.0, 0.0]).unwrap();
        let mut once = flat.clone();
        adj.apply(&mut once, &bounds);
        let mut twice = flat.clone();
        adj.apply(&mut twice, &bounds);
        assert_ne!(once, flat);
        assert_eq!(once, twice, "an adjustment layer of noise must not boil");
    }

    #[test]
    fn invert_and_desaturate() {
        assert_eq!(Adjustment::from(Kind::Invert).map(RED), Rgba::opaque(0, 255, 255));
        let d = Adjustment::from(Kind::Desaturate).map(RED);
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
        assert_eq!(backwards.params(), vec![0.0, 10.0, 255.0, 200.0, 0.0], "the channel rides at the end");
        assert_eq!(Adjustment::from_params("curves", &[9.0, 9.0]).unwrap().params(), vec![0.0, 0.0, 255.0, 255.0, 0.0]);
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
    fn dither_quantises_through_the_adjustment_and_reads_its_numbers_back() {
        // The dialog's numbers: ordered 4x4, four levels, full strength,
        // two-pixel cells, in colour.
        let adj = Adjustment::from_params("dither", &[1.0, 4.0, 100.0, 2.0, 0.0]).unwrap();
        assert_eq!(adj.label(), "Dither");
        assert_eq!(adj.params(), vec![1.0, 4.0, 100.0, 2.0, 0.0]);
        let mut r = Raster::filled(8, 8, GREY);
        let all = r.bounds();
        adj.apply(&mut r, &all);
        assert!(r.pixels().iter().all(|p| matches!(p.r, 0 | 85 | 170 | 255)), "off the four-level ramp");
        assert!(r.pixels().iter().any(|p| p.r != r.get(0, 0).r), "a flat grey came out flat");
        // With no position to go on, `map` gives the rounding it would have
        // dithered around.
        assert_eq!(adj.map(GREY), Rgba::opaque(170, 170, 170), "mid-grey is nearest the third of four levels");
        assert_eq!(adj.map(Rgba::new(10, 10, 10, 40)), Rgba::new(0, 0, 0, 40));
        // Defaults are the ones the dialog opens with.
        let default = Adjustment::from_params("dither", &[]).unwrap();
        assert_eq!(default.params(), vec![4.0, 2.0, 100.0, 1.0, 0.0]);
        // Greyscale throws the colour away; the strength at zero is a plain
        // posterize.
        let mono = Adjustment::from_params("dither", &[1.0, 2.0, 100.0, 1.0, 1.0]).unwrap();
        let mut colour = Raster::filled(8, 8, Rgba::opaque(200, 40, 40));
        let all = colour.bounds();
        mono.apply(&mut colour, &all);
        assert!(colour.pixels().iter().all(|p| p.r == p.g && p.g == p.b));
        let flat = Adjustment::from_params("dither", &[1.0, 2.0, 0.0, 1.0, 0.0]).unwrap();
        let mut plain = Raster::filled(4, 4, Rgba::opaque(100, 200, 100));
        let all = plain.bounds();
        flat.apply(&mut plain, &all);
        assert!(plain.pixels().iter().all(|p| *p == Rgba::opaque(0, 255, 0)));
    }

    #[test]
    fn an_adjustment_can_be_pointed_at_one_channel() {
        // Levels on blue alone: the blue channel is stretched, the other two
        // and the alpha are left exactly as they were.
        let blue_only = Adjustment::from_params("levels", &[0.0, 128.0, 1.0, Channel::Blue.index()]).unwrap();
        assert_eq!(blue_only.channel, Channel::Blue);
        assert_eq!(blue_only.label(), "Levels (Blue)");
        let p = Rgba::new(40, 80, 128, 90);
        assert_eq!(blue_only.map(p), Rgba::new(40, 80, 255, 90));
        // The same numbers on RGB move all three.
        let all = Adjustment::from_params("levels", &[0.0, 128.0, 1.0]).unwrap();
        assert_eq!(all.channel, Channel::All);
        assert_eq!(all.label(), "Levels");
        assert_eq!(all.map(p), Rgba::new(80, 159, 255, 90));
        // And through a raster, which is the path the dialog takes.
        let mut r = Raster::filled(2, 1, p);
        let bounds = r.bounds();
        blue_only.apply(&mut r, &bounds);
        assert_eq!(r.get(0, 0), Rgba::new(40, 80, 255, 90));
    }

    #[test]
    fn a_palette_adjustment_maps_the_picture_onto_its_colours() {
        // Black and white, no dither: a plain nearest match, and cheap
        // enough to go through the lookup path rather than the spatial one.
        let mono = Adjustment::from_params("palette", &[0.0, 100.0, 1.0, 0.0, 0.0, 0.0, 255.0, 255.0, 255.0]).unwrap();
        assert_eq!(mono.label(), "Palette");
        assert!(!mono.kind.is_spatial(), "nothing but the colour is needed to answer");
        assert_eq!(mono.map(Rgba::opaque(200, 200, 200)), Rgba::WHITE);
        assert_eq!(mono.map(Rgba::opaque(40, 40, 40)), Rgba::BLACK);

        let mut r = Raster::filled(4, 4, Rgba::opaque(200, 10, 10));
        let bounds = r.bounds();
        mono.apply(&mut r, &bounds);
        assert_eq!(r.get(0, 0), Rgba::BLACK, "nearer black than white");

        // The same palette dithered reads the pixel's position, so it is
        // spatial and its parameters carry the pattern.
        let dithered = Adjustment::from_params("palette", &[5.0, 100.0, 1.0, 0.0, 0.0, 0.0, 255.0, 255.0, 255.0]).unwrap();
        assert!(dithered.kind.is_spatial());
        assert_eq!(dithered.params()[0], 5.0, "one past the pattern's own index, since zero is none");
        assert_eq!(Adjustment::from_params("palette", &dithered.params()).unwrap(), dithered);

        // A palette of nothing has nothing to map to and leaves the picture
        // as it found it.
        let empty = Adjustment::from_params("palette", &[0.0, 100.0, 1.0]).unwrap();
        assert_eq!(empty.map(Rgba::opaque(200, 10, 10)), Rgba::opaque(200, 10, 10));
    }

    #[test]
    fn the_channel_rides_at_the_end_and_is_rgb_when_it_is_not_there() {
        for name in Adjustment::NAMES {
            let plain = Adjustment::from_params(name, &[30.0, 200.0, 2.0, 40.0]).unwrap();
            // What an older file holds: the kind's parameters and nothing
            // after them.
            let older: Vec<f32> = plain.kind.params();
            let reread = Adjustment::from_params(name, &older).unwrap();
            assert_eq!(reread.channel, Channel::All, "{name} did not default to RGB");
            assert_eq!(reread.kind, plain.kind, "{name} lost its settings");
            if !plain.kind.takes_channel() {
                // A trailing number means nothing to the rest, and none of
                // them grows one in `params`.
                assert_eq!(plain.params(), plain.kind.params(), "{name}");
                continue;
            }
            for channel in Channel::ALL {
                let mut params = plain.kind.params();
                params.push(channel.index());
                let adj = Adjustment::from_params(name, &params).unwrap();
                assert_eq!(adj.channel, *channel, "{name}");
                assert_eq!(adj.kind, plain.kind, "{name} lost its settings to the channel");
                assert_eq!(adj.params(), params, "{name} does not round-trip");
                assert_eq!(Adjustment::from_params(name, &adj.params()).unwrap(), adj, "{name}");
            }
        }
    }

    #[test]
    fn a_curve_finds_its_channel_after_its_points() {
        // Three points and then the channel, which is what the dialog sends.
        let params = vec![0.0, 0.0, 128.0, 200.0, 255.0, 255.0, Channel::Green.index()];
        let adj = Adjustment::from_params("curves", &params).unwrap();
        assert_eq!(adj.channel, Channel::Green);
        assert_eq!(adj.params(), params);
        let lifted = adj.map(Rgba::opaque(128, 128, 128));
        assert_eq!(lifted, Rgba::opaque(128, 200, 128));
    }

    #[test]
    fn only_the_per_channel_family_takes_a_channel() {
        let takes: Vec<&str> = Adjustment::NAMES
            .iter()
            .filter(|n| Adjustment::from_params(n, &[]).unwrap().kind.takes_channel())
            .copied()
            .collect();
        assert_eq!(takes, vec!["brightness-contrast", "levels", "curves", "posterize"]);
        // The ones that read the whole colour stay on RGB whatever is passed.
        for name in ["hue-saturation", "color-balance", "threshold", "invert", "desaturate", "dither"] {
            let adj = Adjustment::from_params(name, &[3.0, 3.0, 3.0, 3.0, 3.0, 3.0]).unwrap();
            assert_eq!(adj.channel, Channel::All, "{name}");
        }
    }

    #[test]
    fn a_channel_keeps_the_other_channels_and_the_alpha() {
        let new = Rgba::new(1, 2, 3, 4);
        let old = Rgba::new(10, 20, 30, 40);
        assert_eq!(Channel::All.pick(new, old), new);
        assert_eq!(Channel::Red.pick(new, old), Rgba::new(1, 20, 30, 40));
        assert_eq!(Channel::Green.pick(new, old), Rgba::new(10, 2, 30, 40));
        assert_eq!(Channel::Blue.pick(new, old), Rgba::new(10, 20, 3, 40));
        for channel in Channel::ALL {
            assert_eq!(Channel::from_index(channel.index()), *channel);
            assert!(!channel.label().is_empty());
        }
        assert_eq!(Channel::from_index(-1.0), Channel::All);
        assert_eq!(Channel::from_index(99.0), Channel::Blue);
        assert_eq!(Channel::from_index(f32::NAN), Channel::All);
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
        Adjustment::from(Kind::Invert).apply(&mut r, &Rect::new(1, 0, 1, 1));
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
