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

mod movetool;
mod select;
mod shape;
mod stroke;
mod view;
mod wand;

pub use movetool::MoveTool;
pub use select::MarqueeTool;
pub use shape::{Shape, ShapeTool};
pub use stroke::{StrokeMode, StrokeTool};
pub use view::{HandTool, ZoomTool};
pub use wand::{MagicWandTool, QuickSelectTool, RefineTool};

use crate::autoselect::SampleMode;
use crate::color::Rgba;
use crate::document::Document;
use crate::geometry::Point;
use crate::selection::Selection;
use crate::viewport::Viewport;

/// Every tool the editor offers, by name. The names are the strings the page
/// uses, so they are part of the wasm API.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ToolKind {
    Select,
    Wand,
    QuickSelect,
    Refine,
    Move,
    Brush,
    Pencil,
    Eraser,
    Line,
    Rectangle,
    Ellipse,
    Zoom,
    Hand,
}

impl ToolKind {
    pub const ALL: &'static [ToolKind] = &[
        ToolKind::Select,
        ToolKind::Wand,
        ToolKind::QuickSelect,
        ToolKind::Refine,
        ToolKind::Move,
        ToolKind::Brush,
        ToolKind::Pencil,
        ToolKind::Eraser,
        ToolKind::Line,
        ToolKind::Rectangle,
        ToolKind::Ellipse,
        ToolKind::Zoom,
        ToolKind::Hand,
    ];

    pub fn name(self) -> &'static str {
        match self {
            ToolKind::Select => "select",
            ToolKind::Wand => "wand",
            ToolKind::QuickSelect => "quickselect",
            ToolKind::Refine => "refine",
            ToolKind::Move => "move",
            ToolKind::Brush => "brush",
            ToolKind::Pencil => "pencil",
            ToolKind::Eraser => "eraser",
            ToolKind::Line => "line",
            ToolKind::Rectangle => "rectangle",
            ToolKind::Ellipse => "ellipse",
            ToolKind::Zoom => "zoom",
            ToolKind::Hand => "hand",
        }
    }

    /// Whether the tool changes the document at all. The others only move
    /// the view or the selection, and may be used on a hidden layer.
    pub fn edits_pixels(self) -> bool {
        !matches!(
            self,
            ToolKind::Select
                | ToolKind::Wand
                | ToolKind::QuickSelect
                | ToolKind::Refine
                | ToolKind::Zoom
                | ToolKind::Hand
        )
    }

    /// Whether the tool's edits must stay inside the selection. The move
    /// tool is the exception: moving pixels *out* of the selection is what it
    /// is for, and it carries the selection along with them.
    pub fn confined_to_selection(self) -> bool {
        self.edits_pixels() && self != ToolKind::Move
    }

    pub fn from_name(name: &str) -> Option<ToolKind> {
        ToolKind::ALL.iter().copied().find(|k| k.name() == name)
    }

    pub fn instantiate(self) -> Box<dyn Tool> {
        match self {
            ToolKind::Select => Box::new(MarqueeTool::default()),
            ToolKind::Wand => Box::new(MagicWandTool),
            ToolKind::QuickSelect => Box::new(QuickSelectTool::default()),
            ToolKind::Refine => Box::new(RefineTool::default()),
            ToolKind::Move => Box::new(MoveTool::default()),
            ToolKind::Zoom => Box::new(ZoomTool::default()),
            ToolKind::Hand => Box::new(HandTool::default()),
            ToolKind::Brush => Box::new(StrokeTool::new(StrokeMode::Brush)),
            ToolKind::Pencil => Box::new(StrokeTool::new(StrokeMode::Pencil)),
            ToolKind::Eraser => Box::new(StrokeTool::new(StrokeMode::Eraser)),
            ToolKind::Line => Box::new(ShapeTool::new(Shape::Line)),
            ToolKind::Rectangle => Box::new(ShapeTool::new(Shape::Rectangle)),
            ToolKind::Ellipse => Box::new(ShapeTool::new(Shape::Ellipse)),
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
    /// Brush opacity, `0.0..=1.0`. The pencil ignores it.
    pub opacity: f32,
    /// Whether the shape tools fill their shape or stroke its outline.
    pub fill: bool,
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
}

impl Default for ToolSettings {
    fn default() -> ToolSettings {
        ToolSettings {
            color: Rgba::BLACK,
            background: Rgba::WHITE,
            size: 8,
            opacity: 1.0,
            fill: true,
            scrubby_zoom: true,
            tolerance: 32,
            sample_mode: SampleMode::Contiguous,
            sample_all_layers: false,
            antialias: true,
        }
    }
}

/// A pointer position in document space plus the modifier keys held.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
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
}

impl PointerEvent {
    pub fn at(x: f64, y: f64) -> PointerEvent {
        PointerEvent { pos: Point::new(x, y), screen: Point::new(x, y), ..PointerEvent::default() }
    }
}

/// What a tool gets to work with during a gesture.
pub struct ToolContext<'a> {
    pub document: &'a mut Document,
    pub selection: &'a mut Selection,
    pub viewport: &'a mut Viewport,
    pub settings: &'a ToolSettings,
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
        assert_eq!(ToolKind::from_name("lasso"), None);
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
