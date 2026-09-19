//! Tools: what a pointer gesture does to the document.
//!
//! A tool is a state machine driven by [`Tool::begin`], [`Tool::update`] and
//! [`Tool::finish`], one gesture at a time, with document-space positions.
//! Everything a tool may touch is handed to it through [`ToolContext`], so a
//! tool never holds a reference to the editor and a new tool is a new file
//! here plus one arm in [`ToolKind::instantiate`].
//!
//! Undo is not the tool's job: [`Tool::begin`] says whether the gesture is
//! going to edit the active layer and the editor snapshots it beforehand.

mod bucket;
mod erode;
mod eyedropper;
mod gradient;
mod lasso;
pub mod movetool;
mod select;
mod shape;
mod stroke;
mod subjectbox;
mod text;
mod view;
mod wand;
mod wetbrush;

pub use bucket::BucketTool;
pub use erode::ErodeTool;
pub use eyedropper::{sample_color, EyedropperTool};
pub use gradient::GradientTool;
pub use lasso::LassoTool;
pub use movetool::MoveTool;
pub use select::{MarqueeShape, MarqueeTool};
pub use shape::{Shape, ShapeTool};
pub use stroke::{clone_offset_for, StrokeMode, StrokeTool};
pub use subjectbox::SubjectBoxTool;
pub use text::TextTool;
pub use view::{HandTool, ZoomTool};
pub use wand::{MagicWandTool, QuickSelectTool, RefineTool};
pub use wetbrush::WetBrushTool;

use crate::autoselect::SampleMode;
use crate::brush::BrushTip;
use crate::color::Rgba;
use crate::document::Document;
use crate::geometry::{Point, Rect};
use crate::selection::Selection;
use crate::snap::Guides;
use crate::viewport::Viewport;

/// Every tool the editor offers, by name. The names are the strings the page
/// uses, so they are part of the wasm API.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ToolKind {
    Select,
    EllipseSelect,
    Lasso,
    Crop,
    Wand,
    QuickSelect,
    SubjectBox,
    Refine,
    Move,
    Brush,
    Pencil,
    Eraser,
    Clone,
    Heal,
    WetBrush,
    Erode,
    Bucket,
    Gradient,
    Eyedropper,
    Line,
    Rectangle,
    Ellipse,
    Text,
    Zoom,
    Hand,
}

impl ToolKind {
    pub const ALL: &'static [ToolKind] = &[
        ToolKind::Select,
        ToolKind::EllipseSelect,
        ToolKind::Lasso,
        ToolKind::Crop,
        ToolKind::Wand,
        ToolKind::QuickSelect,
        ToolKind::SubjectBox,
        ToolKind::Refine,
        ToolKind::Move,
        ToolKind::Brush,
        ToolKind::Pencil,
        ToolKind::Eraser,
        ToolKind::Clone,
        ToolKind::Heal,
        ToolKind::WetBrush,
        ToolKind::Erode,
        ToolKind::Bucket,
        ToolKind::Gradient,
        ToolKind::Eyedropper,
        ToolKind::Line,
        ToolKind::Rectangle,
        ToolKind::Ellipse,
        ToolKind::Text,
        ToolKind::Zoom,
        ToolKind::Hand,
    ];

    pub fn name(self) -> &'static str {
        match self {
            ToolKind::Select => "select",
            ToolKind::EllipseSelect => "ellipse-select",
            ToolKind::Lasso => "lasso",
            ToolKind::Crop => "crop",
            ToolKind::Wand => "wand",
            ToolKind::QuickSelect => "quickselect",
            ToolKind::SubjectBox => "subject",
            ToolKind::Refine => "refine",
            ToolKind::Move => "move",
            ToolKind::Brush => "brush",
            ToolKind::Pencil => "pencil",
            ToolKind::Eraser => "eraser",
            ToolKind::Clone => "clone",
            ToolKind::Heal => "heal",
            ToolKind::WetBrush => "wetbrush",
            ToolKind::Erode => "erode",
            ToolKind::Bucket => "bucket",
            ToolKind::Gradient => "gradient",
            ToolKind::Eyedropper => "eyedropper",
            ToolKind::Line => "line",
            ToolKind::Rectangle => "rectangle",
            ToolKind::Ellipse => "ellipse",
            ToolKind::Text => "text",
            ToolKind::Zoom => "zoom",
            ToolKind::Hand => "hand",
        }
    }

    /// What the history panel calls a gesture made with the tool.
    pub fn label(self) -> &'static str {
        match self {
            ToolKind::Select | ToolKind::EllipseSelect | ToolKind::Lasso | ToolKind::Crop => "Select",
            ToolKind::Wand => "Magic Wand",
            ToolKind::QuickSelect => "Quick Select",
            ToolKind::SubjectBox => "Select Subject",
            ToolKind::Refine => "Refine Selection",
            ToolKind::Move => "Move",
            ToolKind::Brush => "Brush",
            ToolKind::Pencil => "Pencil",
            ToolKind::Eraser => "Eraser",
            ToolKind::Clone => "Clone Stamp",
            ToolKind::Heal => "Healing Brush",
            ToolKind::WetBrush => "Wet Brush",
            ToolKind::Erode => "Erosion Brush",
            ToolKind::Bucket => "Paint Bucket",
            ToolKind::Gradient => "Gradient",
            ToolKind::Eyedropper => "Eyedropper",
            ToolKind::Line => "Line",
            ToolKind::Rectangle => "Rectangle",
            ToolKind::Ellipse => "Ellipse",
            ToolKind::Text => "Text",
            ToolKind::Zoom => "Zoom",
            ToolKind::Hand => "Hand",
        }
    }

    /// Whether the tool changes the document at all. The others only move
    /// the view or the selection, and may be used on a hidden layer. The
    /// text tool is among the others because its gesture is not a pointer
    /// gesture at all: a click opens a text session (see `editor.rs`), and
    /// the page drives that.
    pub fn edits_pixels(self) -> bool {
        !matches!(
            self,
            ToolKind::Select
                | ToolKind::EllipseSelect
                | ToolKind::Lasso
                | ToolKind::Crop
                | ToolKind::Wand
                | ToolKind::QuickSelect
                | ToolKind::SubjectBox
                | ToolKind::Refine
                | ToolKind::Eyedropper
                | ToolKind::Text
                | ToolKind::Zoom
                | ToolKind::Hand
        )
    }

    /// Whether Alt-clicking with the tool samples a colour instead —
    /// the eyedropper that lives under every painting tool.
    pub fn alt_picks_color(self) -> bool {
        matches!(self, ToolKind::Brush | ToolKind::Pencil | ToolKind::WetBrush | ToolKind::Bucket | ToolKind::Gradient)
    }

    /// Whether the tool's edits must stay inside the selection. The move
    /// tool is the exception: moving pixels *out* of the selection is what it
    /// is for, and it carries the selection along with them.
    pub fn confined_to_selection(self) -> bool {
        self.edits_pixels() && self != ToolKind::Move
    }

    /// Whether a drag with this tool can be shown on the reduced copy while
    /// the canvas is zoomed out. The gradient repaints the whole clip on
    /// every pointer event and has no small dirty rectangle to save it, so
    /// at a quarter zoom a drag costs sixteen times what the screen shows.
    /// A tool qualifies only if its gesture is decided by where it began and
    /// where the pointer is now, since the drag is replayed on release as
    /// one `begin`/`finish` pair against the document itself.
    pub fn previews_on_the_reduced_copy(self) -> bool {
        self == ToolKind::Gradient
    }

    pub fn from_name(name: &str) -> Option<ToolKind> {
        ToolKind::ALL.iter().copied().find(|k| k.name() == name)
    }

    pub fn instantiate(self) -> Box<dyn Tool> {
        match self {
            ToolKind::Select => Box::new(MarqueeTool::new(MarqueeShape::Rectangle, false)),
            ToolKind::EllipseSelect => Box::new(MarqueeTool::new(MarqueeShape::Ellipse, false)),
            ToolKind::Lasso => Box::new(LassoTool::default()),
            ToolKind::Crop => Box::new(MarqueeTool::new(MarqueeShape::Rectangle, true)),
            ToolKind::Wand => Box::new(MagicWandTool),
            ToolKind::QuickSelect => Box::new(QuickSelectTool::default()),
            ToolKind::SubjectBox => Box::new(SubjectBoxTool::default()),
            ToolKind::Refine => Box::new(RefineTool::default()),
            ToolKind::Move => Box::new(MoveTool::default()),
            ToolKind::Zoom => Box::new(ZoomTool::default()),
            ToolKind::Hand => Box::new(HandTool::default()),
            ToolKind::Brush => Box::new(StrokeTool::new(StrokeMode::Brush)),
            ToolKind::Pencil => Box::new(StrokeTool::new(StrokeMode::Pencil)),
            ToolKind::Eraser => Box::new(StrokeTool::new(StrokeMode::Eraser)),
            ToolKind::Clone => Box::new(StrokeTool::new(StrokeMode::Clone)),
            ToolKind::Heal => Box::new(StrokeTool::new(StrokeMode::Heal)),
            ToolKind::WetBrush => Box::new(WetBrushTool::default()),
            ToolKind::Erode => Box::new(ErodeTool::default()),
            ToolKind::Bucket => Box::new(BucketTool::default()),
            ToolKind::Gradient => Box::new(GradientTool::default()),
            ToolKind::Eyedropper => Box::new(EyedropperTool),
            ToolKind::Line => Box::new(ShapeTool::new(Shape::Line)),
            ToolKind::Rectangle => Box::new(ShapeTool::new(Shape::Rectangle)),
            ToolKind::Ellipse => Box::new(ShapeTool::new(Shape::Ellipse)),
            ToolKind::Text => Box::new(TextTool),
        }
    }
}

/// The options bar: settings shared by every tool that wants them.
#[derive(Clone, Debug, PartialEq)]
pub struct ToolSettings {
    /// The foreground colour: what painting uses.
    pub color: Rgba,
    /// The background colour, for Ctrl+Backspace fills and the swap.
    pub background: Rgba,
    /// Brush diameter and line/outline thickness, in document pixels.
    pub size: u32,
    /// The shape of the brush's dab. The brush, pencil and eraser share it.
    pub tip: BrushTip,
    /// Where else every dab lands: mirrored, turned about the centre, or
    /// nowhere else.
    pub symmetry: Symmetry,
    /// How much the pointer's path is smoothed before it is painted,
    /// `0.0..=1.0`: 0 follows the pointer exactly, 1 trails well behind it.
    pub smoothing: f32,
    /// Whether a pen's pressure sets the dab's size.
    pub pressure_size: bool,
    /// Brush opacity, `0.0..=1.0`. The pencil ignores it.
    pub opacity: f32,
    /// How far out from the centre a brush dab is solid before it fades,
    /// `0.0..=1.0`. `1.0` is a hard edge. The pencil ignores it.
    pub hardness: f32,
    /// Whether the shape tools fill their shape or stroke its outline.
    pub fill: bool,
    /// The colours the gradient tool runs through, as the page's gradient
    /// editor left them. `None` — and an empty run, which is what an editor
    /// emptied of stops gives — means the foreground and background
    /// swatches, the plain two-colour blend.
    pub gradient_stops: Option<crate::gradient::GradientStops>,
    /// How the gradient tool lays its colours out.
    pub gradient_shape: crate::gradient::GradientShape,
    /// Whether the gradient runs the other way round.
    pub gradient_reverse: bool,
    /// Whether dragging with the zoom tool scrubs the zoom continuously
    /// rather than marking out the rectangle to zoom into.
    pub scrubby_zoom: bool,
    /// How far a colour may be from the one sampled and still be selected,
    /// `0..=255`. The automatic selection tools share it.
    pub tolerance: u8,
    /// Whether the wand takes only the patch it was clicked on.
    pub sample_mode: SampleMode,
    /// Whether the automatic tools read the flattened image rather than the
    /// active layer alone.
    pub sample_all_layers: bool,
    /// Whether an automatic selection gets a soft one-pixel edge.
    pub antialias: bool,
    /// The guides the move tool and transforms snap to, and whether they do.
    pub guides: Guides,
    /// The box the subject tool has drawn out, in document pixels, waiting
    /// for the page to run the model over it.
    pub subject_box: Option<Rect>,
    /// Where the clone stamp and the healing brush copy from, in document
    /// pixels, as the last Alt-click left it. The page draws a mark there;
    /// `None` is a clone stamp with nothing to clone yet.
    pub clone_anchor: Option<Point>,
    /// Whether the clone stamp keeps one offset across separate strokes
    /// rather than starting again from the anchor each time.
    pub clone_aligned: bool,
    /// How far the clone stamp's source is from the pointer, in whole
    /// pixels, as the last stroke fixed it. It lives here rather than in the
    /// tool so that the preview and the stamp read one answer, and so that
    /// an aligned copy survives a trip to another tool and back. Cleared
    /// whenever a new anchor is set.
    pub clone_offset: Option<(i32, i32)>,
    /// The type settings for the text tool, and for the text layer being
    /// edited, which takes them over while it is.
    pub text: crate::text::TextStyle,
    /// How wet the wet brush's paint still is, pixel by pixel, on the one
    /// layer it was last used on. `None` is a dry canvas. Not part of the
    /// document — see [`crate::wet`].
    pub wet: Option<crate::wet::WetPaint>,
    /// How far the canvas is tilted on each axis, `-1.0..=1.0`: which way
    /// wet paint runs, and how fast. Flat by default.
    pub tilt: (f32, f32),
    /// How long wet paint takes to dry, in seconds.
    pub dry_seconds: f32,
}

/// The shortest and longest a drying time may be set to, in seconds.
pub const MIN_DRY_SECONDS: f32 = 1.0;
pub const MAX_DRY_SECONDS: f32 = 120.0;
/// How long paint stays wet unless the options bar says otherwise.
pub const DEFAULT_DRY_SECONDS: f32 = 10.0;

impl Default for ToolSettings {
    fn default() -> ToolSettings {
        ToolSettings {
            color: Rgba::BLACK,
            background: Rgba::WHITE,
            size: 8,
            tip: BrushTip::Round,
            symmetry: Symmetry::default(),
            smoothing: 0.0,
            pressure_size: true,
            opacity: 1.0,
            hardness: 1.0,
            fill: true,
            gradient_stops: None,
            gradient_shape: crate::gradient::GradientShape::default(),
            gradient_reverse: false,
            scrubby_zoom: true,
            tolerance: 32,
            sample_mode: SampleMode::Contiguous,
            sample_all_layers: false,
            antialias: true,
            guides: Guides::default(),
            subject_box: None,
            clone_anchor: None,
            clone_aligned: true,
            clone_offset: None,
            text: crate::text::TextStyle::default(),
            wet: None,
            tilt: (0.0, 0.0),
            dry_seconds: DEFAULT_DRY_SECONDS,
        }
    }
}

/// A pointer position in document space plus the modifier keys held.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PointerEvent {
    /// In document pixels.
    pub pos: Point,
    /// The same position in screen pixels, for the tools that work on the
    /// view rather than the document.
    pub screen: Point,
    /// Constrains proportions: square, circle, 45° line.
    pub shift: bool,
    /// Draws shapes from their centre.
    pub alt: bool,
    /// How hard a pen is pressing, `0.0..=1.0`; a mouse is always 1.
    pub pressure: f64,
}

impl Default for PointerEvent {
    fn default() -> PointerEvent {
        PointerEvent { pos: Point::default(), screen: Point::default(), shift: false, alt: false, pressure: 1.0 }
    }
}

impl PointerEvent {
    pub fn at(x: f64, y: f64) -> PointerEvent {
        PointerEvent { pos: Point::new(x, y), screen: Point::new(x, y), ..PointerEvent::default() }
    }
}

/// Where a symmetry's axes are: the point they cross, and how far they are
/// turned from the canvas's own. Kept apart from the flags because it is the
/// part an undo step carries — placing the axes is a step, switching a
/// mirror on is only a tool setting.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SymmetryFrame {
    /// Where the axes cross, in document pixels. `None` is the canvas
    /// centre, which follows a resize instead of being left behind by one.
    pub origin: Option<Point>,
    /// How far the axes are turned from the canvas's own, in radians.
    pub angle: f64,
}

/// A reflection lands a pixel's centre on a pixel's centre only when the
/// axis sits on a whole or a half pixel: `2m - (i + 0.5)` is another pixel
/// centre exactly when `m` is a multiple of a half. Anywhere else and the
/// mirrored stroke lands half a pixel out, which shows as a doubled or a
/// bald column down the axis, so a placed origin is held to halves.
pub const ORIGIN_STEP: f64 = 0.5;

impl SymmetryFrame {
    /// Where the axes actually cross, with the canvas centre standing in for
    /// an origin that has never been placed.
    pub fn origin_or(self, centre: Point) -> Point {
        self.origin.unwrap_or(centre)
    }

    /// The frame as it is worth storing: the origin held to [`ORIGIN_STEP`]
    /// and the angle brought into `-PI..=PI`, so that two frames a full turn
    /// apart compare equal and no undo step is recorded for the difference.
    pub fn tidied(self) -> SymmetryFrame {
        let step = |v: f64| (v / ORIGIN_STEP).round() * ORIGIN_STEP;
        let mut angle = self.angle.rem_euclid(std::f64::consts::TAU);
        if angle > std::f64::consts::PI {
            angle -= std::f64::consts::TAU;
        }
        SymmetryFrame { origin: self.origin.map(|p| Point::new(step(p.x), step(p.y))), angle }
    }
}

/// Paint symmetry: every dab of a stroke is laid down again at its images
/// under a mirror in each of the axes of a [`SymmetryFrame`], and turned
/// `radial` times about where they cross. The two combine: a four-fold turn
/// with a mirror is eight dabs.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Symmetry {
    /// Whether the frame's x coordinate is flipped — the mirror whose axis
    /// is the frame's *y* axis, drawn as the line the strokes fold across.
    pub mirror_x: bool,
    /// Whether the frame's y coordinate is flipped.
    pub mirror_y: bool,
    /// How many ways about the origin; 1 is none.
    pub radial: u32,
    /// Where the axes are. The default puts them square to the canvas,
    /// crossing at its centre.
    pub frame: SymmetryFrame,
}

/// The most ways a stroke is turned about the centre.
pub const MAX_RADIAL: u32 = 24;

/// What the pointer has hold of on the symmetry gizmo.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SymmetryHit {
    /// The dot where the axes cross: moves the whole frame.
    Origin,
    /// The line the `mirror_x` fold happens across: moves the frame along
    /// its own x axis, so the fold stays where it was put in the other one.
    AxisX,
    /// The line the `mirror_y` fold happens across.
    AxisY,
    /// The arm out along the frame's x axis: turns the frame.
    Rotate,
}

impl Default for Symmetry {
    fn default() -> Symmetry {
        Symmetry { mirror_x: false, mirror_y: false, radial: 1, frame: SymmetryFrame::default() }
    }
}

impl Symmetry {
    pub fn is_off(self) -> bool {
        !self.mirror_x && !self.mirror_y && self.radial <= 1
    }

    /// `centre` stands in for an origin that has never been placed.
    pub fn origin(self, centre: Point) -> Point {
        self.frame.origin_or(centre)
    }

    /// A document position in the frame's own coordinates: the offset from
    /// the origin, turned back by the frame's angle, where the mirrors are
    /// plain sign flips.
    pub fn to_frame(self, p: Point, centre: Point) -> Point {
        let origin = self.origin(centre);
        let (sa, ca) = self.frame.angle.sin_cos();
        let (dx, dy) = (p.x - origin.x, p.y - origin.y);
        Point::new(dx * ca + dy * sa, dy * ca - dx * sa)
    }

    /// The other way: a position in frame coordinates, back in the document.
    pub fn from_frame(self, p: Point, centre: Point) -> Point {
        let origin = self.origin(centre);
        let (sa, ca) = self.frame.angle.sin_cos();
        Point::new(origin.x + p.x * ca - p.y * sa, origin.y + p.x * sa + p.y * ca)
    }

    /// Where the arm that turns the frame sits: `reach` document pixels out
    /// along the frame's x axis.
    pub fn rotate_handle(self, centre: Point, reach: f64) -> Point {
        self.from_frame(Point::new(reach, 0.0), centre)
    }

    /// What the gizmo offers at a document position, within `tolerance`
    /// document pixels. The origin and the arm win over the lines they sit
    /// on, and a line is only there to be grabbed while its mirror is on.
    pub fn hit(self, p: Point, centre: Point, reach: f64, tolerance: f64) -> Option<SymmetryHit> {
        if self.is_off() {
            return None;
        }
        let f = self.to_frame(p, centre);
        if f.x.hypot(f.y) <= tolerance {
            return Some(SymmetryHit::Origin);
        }
        if (f.x - reach).hypot(f.y) <= tolerance {
            return Some(SymmetryHit::Rotate);
        }
        if self.mirror_x && f.x.abs() <= tolerance {
            return Some(SymmetryHit::AxisX);
        }
        if self.mirror_y && f.y.abs() <= tolerance {
            return Some(SymmetryHit::AxisY);
        }
        None
    }

    /// `p` and every image of it, `p` first. `centre` is the canvas centre,
    /// which is where the axes cross until they are placed somewhere else.
    pub fn images(self, p: Point, centre: Point) -> Vec<Point> {
        let n = self.radial.clamp(1, MAX_RADIAL);
        let mut out = Vec::with_capacity(n as usize * 4);
        let origin = self.origin(centre);
        let (sa, ca) = self.frame.angle.sin_cos();
        // Positions are floored into pixels, so a quarter turn that landed
        // at 14.999999999999998 would be a pixel off: snap the noise away.
        let snap = |v: f64| (v * 1e6).round() / 1e6;
        let place = |x: f64, y: f64| {
            Point::new(snap(origin.x + x * ca - y * sa), snap(origin.y + x * sa + y * ca))
        };
        let f = self.to_frame(p, centre);
        for k in 0..n {
            let (s, c) = (std::f64::consts::TAU * f64::from(k) / f64::from(n)).sin_cos();
            let (rx, ry) = (f.x * c - f.y * s, f.x * s + f.y * c);
            out.push(place(rx, ry));
            if self.mirror_x {
                out.push(place(-rx, ry));
            }
            if self.mirror_y {
                out.push(place(rx, -ry));
            }
            if self.mirror_x && self.mirror_y {
                out.push(place(-rx, -ry));
            }
        }
        out
    }
}

/// What a tool gets to work with during a gesture.
pub struct ToolContext<'a> {
    pub document: &'a mut Document,
    pub selection: &'a mut Selection,
    pub viewport: &'a mut Viewport,
    /// Mutable for the eyedropper alone, which sets the colours.
    pub settings: &'a mut ToolSettings,
}

impl ToolContext<'_> {
    /// The pixels the automatic selection tools should read: the active
    /// layer, or the flattened image when the options bar asks for it.
    pub fn sample(&self) -> crate::raster::Raster {
        if self.settings.sample_all_layers {
            self.document.composite()
        } else {
            self.document.active_surface().clone()
        }
    }

    /// The rectangle painting may touch: the active layer's bounds cut down
    /// by the selection.
    pub fn clip(&self) -> crate::geometry::Rect {
        self.selection.clip(self.document.bounds())
    }
}

/// What kind of gesture [`Tool::begin`] has started.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Gesture {
    /// The gesture will change the active layer's pixels; the editor snapshots
    /// them for undo before anything else happens.
    EditsActiveLayer,
    /// The gesture changes something else (the selection, say) or nothing.
    Passive,
}

pub trait Tool {
    fn kind(&self) -> ToolKind;

    /// The pointer went down. Returns what the gesture is going to do.
    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture;

    /// The pointer moved with the button held. Returns whether the document
    /// or selection changed and the view needs redrawing.
    fn update(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool;

    /// The pointer was released. Returns whether the view needs redrawing.
    fn finish(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool;

    /// The gesture was abandoned (Escape, or the pointer left the window).
    /// The tool should put the document back the way it was.
    fn cancel(&mut self, ctx: &mut ToolContext);

    /// What the call that just returned changed, in document pixels, or
    /// `None` for "assume the worst".
    ///
    /// The editor uses this to recomposite and re-upload only the part of
    /// the picture that moved: on a 4K canvas a brush dab is a few hundred
    /// pixels out of eight million. It accumulates the answers until the
    /// page draws, so a tool reports only its latest stamp, not the whole
    /// gesture. Saying nothing is always correct and always slow; saying
    /// *less* than was touched leaves stale pixels on screen, so grow the
    /// rectangle by whatever the brush's edge or the antialiasing may reach.
    fn dirtied(&self) -> Option<Rect> {
        None
    }

    /// A rubber band the page should draw over the canvas while the gesture
    /// runs, as `[x, y, w, h]` in screen pixels. Only for gestures that show
    /// nothing in the document itself — the zoom marquee; tools that draw
    /// what they are doing say nothing here.
    fn overlay(&self) -> Option<[f64; 4]> {
        None
    }
}

/// Snaps `end` so the vector from `start` is a square (equal magnitudes on
/// each axis), keeping the direction of each component.
pub(crate) fn constrain_square(start: Point, end: Point) -> Point {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let m = dx.abs().max(dy.abs());
    Point::new(start.x + m * dx.signum(), start.y + m * dy.signum())
}

/// Snaps `end` so the line from `start` lies on a multiple of 45°.
pub(crate) fn constrain_angle(start: Point, end: Point) -> Point {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    if dx == 0.0 && dy == 0.0 {
        return end;
    }
    let len = dx.hypot(dy);
    let angle = dy.atan2(dx);
    let step = std::f64::consts::FRAC_PI_4;
    let snapped = (angle / step).round() * step;
    Point::new(
        (start.x + len * snapped.cos()).round(),
        (start.y + len * snapped.sin()).round(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_tool_round_trips_its_name() {
        for kind in ToolKind::ALL {
            assert_eq!(ToolKind::from_name(kind.name()), Some(*kind));
            assert_eq!(kind.instantiate().kind(), *kind);
        }
        assert_eq!(ToolKind::from_name("nothing-of-the-sort"), None);
    }

    #[test]
    fn symmetry_images_a_point_about_the_centre() {
        let c = Point::new(10.0, 10.0);
        let p = Point::new(13.0, 11.0);
        assert_eq!(Symmetry::default().images(p, c), vec![p]);
        assert!(Symmetry::default().is_off());
        let mirror = Symmetry { mirror_x: true, ..Symmetry::default() };
        assert_eq!(mirror.images(p, c), vec![p, Point::new(7.0, 11.0)]);
        let both = Symmetry { mirror_x: true, mirror_y: true, ..Symmetry::default() };
        assert_eq!(both.images(p, c).len(), 4);
        assert!(both.images(p, c).contains(&Point::new(7.0, 9.0)));
        let four = Symmetry { radial: 4, ..Symmetry::default() };
        let imgs = four.images(p, c);
        assert_eq!(imgs.len(), 4);
        assert_eq!(imgs[0], p);
        // A quarter turn about (10,10) takes (13,11) to (9,13).
        assert!((imgs[1].x - 9.0).abs() < 1e-9 && (imgs[1].y - 13.0).abs() < 1e-9, "{:?}", imgs[1]);
        let eight = Symmetry { mirror_x: true, radial: 4, ..Symmetry::default() };
        assert_eq!(eight.images(p, c).len(), 8);
        let too_many = Symmetry { radial: 99, ..Symmetry::default() };
        assert_eq!(too_many.images(p, c).len(), MAX_RADIAL as usize);
    }

    #[test]
    fn symmetry_mirrors_about_a_placed_axis_rather_than_the_centre() {
        let c = Point::new(10.0, 10.0);
        let p = Point::new(13.0, 11.0);
        let frame = SymmetryFrame { origin: Some(Point::new(4.0, 4.0)), angle: 0.0 };
        let sym = Symmetry { mirror_x: true, frame, ..Symmetry::default() };
        // Folded about x = 4, not about the canvas centre, and the other
        // coordinate is left alone.
        assert_eq!(sym.images(p, c), vec![p, Point::new(-5.0, 11.0)]);
    }

    #[test]
    fn a_turned_frame_folds_about_a_tilted_line() {
        let c = Point::new(0.0, 0.0);
        let frame = SymmetryFrame { origin: Some(c), angle: std::f64::consts::FRAC_PI_4 };
        let sym = Symmetry { mirror_x: true, frame, ..Symmetry::default() };
        // Turning the frame by 45° turns the line the fold happens across
        // with it: `mirror_x` folds across the frame's y axis, which is now
        // the line y = -x, so the point four to the right comes back four
        // below.
        let images = sym.images(Point::new(4.0, 0.0), c);
        assert_eq!(images[0], Point::new(4.0, 0.0));
        assert!((images[1].x).abs() < 1e-6 && (images[1].y + 4.0).abs() < 1e-6, "{:?}", images[1]);
    }

    #[test]
    fn the_frame_is_tidied_to_half_pixels_and_a_single_turn() {
        let frame = SymmetryFrame {
            origin: Some(Point::new(10.3, 7.9)),
            angle: std::f64::consts::TAU + std::f64::consts::FRAC_PI_2,
        };
        let tidy = frame.tidied();
        assert_eq!(tidy.origin, Some(Point::new(10.5, 8.0)));
        assert!((tidy.angle - std::f64::consts::FRAC_PI_2).abs() < 1e-9, "{}", tidy.angle);
        // A half turn one way and the other are the same frame, so placing
        // one where the other is changes nothing.
        let half = SymmetryFrame { origin: None, angle: -std::f64::consts::PI }.tidied();
        assert!((half.angle - std::f64::consts::PI).abs() < 1e-9, "{}", half.angle);
    }

    #[test]
    fn the_gizmo_offers_the_origin_the_arm_and_the_lines_that_are_on() {
        let c = Point::new(10.0, 10.0);
        let sym = Symmetry { mirror_x: true, ..Symmetry::default() };
        let (reach, tolerance) = (20.0, 2.0);
        assert_eq!(sym.hit(Point::new(11.0, 10.0), c, reach, tolerance), Some(SymmetryHit::Origin));
        assert_eq!(sym.hit(Point::new(30.0, 10.0), c, reach, tolerance), Some(SymmetryHit::Rotate));
        assert_eq!(sym.hit(Point::new(10.5, 40.0), c, reach, tolerance), Some(SymmetryHit::AxisX));
        // The horizontal line is not drawn while its mirror is off, so there
        // is nothing there to grab.
        assert_eq!(sym.hit(Point::new(40.0, 10.5), c, reach, tolerance), None);
        assert_eq!(Symmetry::default().hit(c, c, reach, tolerance), None, "nothing to place while it is off");
    }

    #[test]
    fn square_constraint_uses_the_larger_axis() {
        let p = constrain_square(Point::new(0.0, 0.0), Point::new(10.0, -3.0));
        assert_eq!(p, Point::new(10.0, -10.0));
        let p = constrain_square(Point::new(5.0, 5.0), Point::new(3.0, 20.0));
        assert_eq!(p, Point::new(-10.0, 20.0));
    }

    #[test]
    fn angle_constraint_snaps_to_45_degrees() {
        let p = constrain_angle(Point::new(0.0, 0.0), Point::new(10.0, 1.0));
        assert_eq!(p, Point::new(10.0, 0.0));
        let p = constrain_angle(Point::new(0.0, 0.0), Point::new(10.0, 9.0));
        assert_eq!(p, Point::new(10.0, 10.0));
        let p = constrain_angle(Point::new(0.0, 0.0), Point::new(-1.0, 10.0));
        assert_eq!(p, Point::new(0.0, 10.0));
        let same = Point::new(3.0, 3.0);
        assert_eq!(constrain_angle(same, same), same);
    }
}
