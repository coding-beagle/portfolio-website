//! The eyedropper: click to make the colour under the pointer the
//! foreground colour, Alt-click for the background. Dragging keeps
//! sampling, so the swatch follows the pointer across the picture.
//!
//! It reads the flattened image, which is what the eye sees, so a colour
//! picked off a translucent layer is the colour on screen. A fully
//! transparent pixel has no colour to give and is ignored.

use super::{Gesture, PointerEvent, Tool, ToolContext, ToolKind};
use crate::color::Rgba;
use crate::geometry::Point;
use crate::raster::Raster;

#[derive(Debug, Default)]
pub struct EyedropperTool;

/// The colour at `at` in `source`, if there is one, as an opaque colour: a
/// swatch has no alpha, so a half-transparent pixel gives its own colour
/// at full strength rather than a darker one.
pub fn sample_color(source: &Raster, at: Point) -> Option<Rgba> {
    let (x, y) = at.round();
    let p = source.get(x, y);
    (p.a > 0).then(|| p.with_alpha(255))
}

/// Samples the composite at `at` into the foreground colour, or the
/// background when `background` is set. Returns whether a colour was found.
pub fn pick(ctx: &mut ToolContext, at: Point, background: bool) -> bool {
    let Some(color) = sample_color(&ctx.document.composite(), at) else { return false };
    if background {
        ctx.settings.background = color;
    } else {
        ctx.settings.color = color;
    }
    true
}

impl Tool for EyedropperTool {
    fn kind(&self) -> ToolKind {
        ToolKind::Eyedropper
    }

    fn begin(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> Gesture {
        pick(ctx, ev.pos, ev.alt);
        Gesture::Passive
    }

    fn update(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        pick(ctx, ev.pos, ev.alt)
    }

    fn finish(&mut self, ctx: &mut ToolContext, ev: PointerEvent) -> bool {
        pick(ctx, ev.pos, ev.alt)
    }

    fn cancel(&mut self, _ctx: &mut ToolContext) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::Document;
    use crate::selection::Selection;
    use crate::tools::ToolSettings;
    use crate::viewport::Viewport;

    const RED: Rgba = Rgba::opaque(255, 0, 0);

    #[test]
    fn a_click_takes_the_colour_and_alt_gives_it_to_the_background() {
        let mut doc = Document::new(4, 4, Rgba::TRANSPARENT);
        doc.active_layer_mut().raster.set(1, 1, RED);
        doc.active_layer_mut().raster.set(2, 2, Rgba::new(0, 0, 255, 100));
        let mut sel = Selection::None;
        let mut vp = Viewport::default();
        let mut settings = ToolSettings::default();
        let mut tool = EyedropperTool;
        let mut ctx = ToolContext { document: &mut doc, selection: &mut sel, viewport: &mut vp, settings: &mut settings };
        tool.begin(&mut ctx, PointerEvent::at(1.0, 1.0));
        assert_eq!(settings.color, RED);
        assert_eq!(settings.background, Rgba::WHITE, "untouched");

        let mut ctx = ToolContext { document: &mut doc, selection: &mut sel, viewport: &mut vp, settings: &mut settings };
        let alt = PointerEvent { alt: true, ..PointerEvent::at(2.0, 2.0) };
        tool.begin(&mut ctx, alt);
        assert_eq!(settings.background, Rgba::opaque(0, 0, 255), "opaque, whatever the pixel's alpha");
        assert_eq!(settings.color, RED);

        let mut ctx = ToolContext { document: &mut doc, selection: &mut sel, viewport: &mut vp, settings: &mut settings };
        assert!(!tool.update(&mut ctx, PointerEvent::at(3.0, 3.0)), "nothing there to pick");
        assert_eq!(settings.color, RED);
    }

    #[test]
    fn it_reads_what_is_on_screen_not_the_active_layer() {
        let mut doc = Document::new(2, 2, Rgba::WHITE);
        doc.add_layer();
        doc.active_layer_mut().raster.set(0, 0, RED);
        doc.set_active(0).unwrap();
        let mut sel = Selection::None;
        let mut vp = Viewport::default();
        let mut settings = ToolSettings::default();
        let mut ctx = ToolContext { document: &mut doc, selection: &mut sel, viewport: &mut vp, settings: &mut settings };
        assert!(pick(&mut ctx, Point::new(0.0, 0.0), false));
        assert_eq!(settings.color, RED, "the layer above shows");
    }
}
