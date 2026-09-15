//! The text tool. It has no pointer gesture of its own: a click with it
//! asks the page to open a text session (`Editor::begin_text_layer`, or
//! `begin_text_edit` on a text layer under the click), and the page's text
//! box drives the session from there. What is here is the tool's place in
//! the toolbox — a kind with a name and a hint — and a gesture that does
//! nothing, so that a stray pointer event changes nothing.

use super::{Gesture, PointerEvent, Tool, ToolContext, ToolKind};

#[derive(Debug, Default)]
pub struct TextTool;

impl Tool for TextTool {
    fn kind(&self) -> ToolKind {
        ToolKind::Text
    }

    fn begin(&mut self, _ctx: &mut ToolContext, _ev: PointerEvent) -> Gesture {
        Gesture::Passive
    }

    fn update(&mut self, _ctx: &mut ToolContext, _ev: PointerEvent) -> bool {
        false
    }

    fn finish(&mut self, _ctx: &mut ToolContext, _ev: PointerEvent) -> bool {
        false
    }

    fn cancel(&mut self, _ctx: &mut ToolContext) {}
}
