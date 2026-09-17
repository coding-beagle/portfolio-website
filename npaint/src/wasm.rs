//! The JavaScript-facing surface.
//!
//! One exported class, [`NPaint`], wrapping an [`Editor`]. Every method is a
//! straight translation: JavaScript numbers and strings in, the same out,
//! and errors as thrown strings. Nothing in here makes a decision — if a
//! method needs logic, that logic belongs in the editor, where it is tested.
//!
//! The rendered frame is handed over as a pointer into wasm memory rather
//! than copied: the page wraps it in a `Uint8ClampedArray` view and builds an
//! `ImageData` from it, so a redraw moves no bytes across the boundary.

use wasm_bindgen::prelude::*;

use crate::adjust::Adjustment;
use crate::autoselect::SampleMode;
use crate::blend::BlendMode;
use crate::brush::BrushTip;
use crate::color::Rgba;
use crate::document::Drop;
use crate::editor::Editor;
use crate::geometry::{Point, Rect};
use crate::gradient::{GradientShape, GradientStops};
use crate::layer::{mask_cover, Target};
use crate::mask::SelectMode;
use crate::palette::Palette;
use crate::raster::Raster;
use crate::transform::{Handle, Hit};
use crate::text::TextAlign;
use crate::tools::{Symmetry, ToolKind, MAX_RADIAL};

#[wasm_bindgen]
pub struct NPaint {
    editor: Editor,
    frame: Raster,
    frame_bytes: Vec<u8>,
    /// The reduced frame a dialog previews into while the canvas is zoomed
    /// out. Kept apart from the frame, which is left as the last full
    /// render made it.
    preview_frame: Raster,
    preview_bytes: Vec<u8>,
}

/// Errors cross the boundary as plain strings, which JavaScript receives as a
/// thrown value. `JsError` would do the same but cannot be constructed off
/// wasm, and this module's tests run natively.
/// The three places the layers panel can show a drop at.
fn drop_of(where_: &str) -> Option<Drop> {
    match where_ {
        "above" => Some(Drop::Above),
        "below" => Some(Drop::Below),
        "inside" => Some(Drop::Inside),
        _ => None,
    }
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[wasm_bindgen]
impl NPaint {
    /// A new editor with a document of the given size. `background` is a hex
    /// colour, or an empty string for a transparent canvas.
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32, background: &str) -> Result<NPaint, String> {
        let bg = parse_background(background)?;
        Ok(NPaint {
            editor: Editor::new(width, height, bg),
            frame: Raster::new(width, height),
            frame_bytes: vec![0; (width as usize) * (height as usize) * 4],
            preview_frame: Raster::new(0, 0),
            preview_bytes: Vec::new(),
        })
    }

    pub fn new_document(&mut self, width: u32, height: u32, background: &str) -> Result<(), String> {
        let bg = parse_background(background)?;
        self.editor.new_document(width, height, bg);
        self.frame = Raster::new(width, height);
        self.frame_bytes = vec![0; (width as usize) * (height as usize) * 4];
        Ok(())
    }

    /// Re-allocates the frame after anything that changes the document size.
    fn resize_frame(&mut self) {
        let (w, h) = (self.editor.document().width(), self.editor.document().height());
        if self.frame.width() != w || self.frame.height() != h {
            self.frame = Raster::new(w, h);
            self.frame_bytes = vec![0; (w as usize) * (h as usize) * 4];
        }
    }

    pub fn width(&self) -> u32 {
        self.editor.document().width()
    }

    pub fn height(&self) -> u32 {
        self.editor.document().height()
    }

    // ---- Rendering -----------------------------------------------------------

    /// Recomposites whatever has changed since the last call and says what
    /// that was, as `[x, y, w, h]` in document pixels — empty when nothing
    /// has, so the page can skip the upload entirely.
    ///
    /// Only the rectangle is redrawn, in the frame and in the bytes behind
    /// it; the rest of both is left as the last call made it. The page must
    /// therefore upload the same rectangle, and must not assume the frame it
    /// holds was built in one go.
    pub fn render(&mut self) -> Vec<i32> {
        let Some(mut rect) = self.editor.take_dirty() else {
            return Vec::new();
        };
        // A frame that has just been resized is blank, so whatever the
        // engine says changed is not enough to fill it.
        if (self.frame.width(), self.frame.height()) != (self.width(), self.height()) {
            self.resize_frame();
            rect = self.editor.document().bounds();
        }
        self.editor.composite_into(&mut self.frame, &rect);
        self.frame.write_rgba_bytes_in(&mut self.frame_bytes, &rect);
        vec![rect.x, rect.y, rect.w, rect.h]
    }

    /// Pointer to the current frame's RGBA bytes. Only valid until the next
    /// call into the module that could reallocate, which is why the page
    /// re-reads it on every draw rather than keeping the view around.
    pub fn frame_ptr(&self) -> *const u8 {
        self.frame_bytes.as_ptr()
    }

    pub fn frame_len(&self) -> usize {
        self.frame_bytes.len()
    }

    /// Composites the reduced preview a dialog is running, and says what
    /// size it came out as: `[width, height, step]`, or empty when there is
    /// no reduced preview — no session, or the canvas is zoomed in far
    /// enough that there is nothing to save.
    ///
    /// The page draws this stretched over the canvas in place of the frame,
    /// and goes back to [`NPaint::render`] when the session ends. The frame
    /// itself is left alone while a preview runs, so the page must not mix
    /// the two.
    pub fn render_preview(&mut self) -> Vec<i32> {
        let Some(redrawn) = self.editor.preview_into(&mut self.preview_frame) else {
            return Vec::new();
        };
        let (w, h) = (self.preview_frame.width(), self.preview_frame.height());
        if !redrawn {
            return vec![w as i32, h as i32, 0];
        }
        // The frame itself is deliberately left behind while this runs, so
        // the dirty rectangle it would have used is cleared here.
        self.editor.take_dirty();
        if self.preview_bytes.len() != (w as usize) * (h as usize) * 4 {
            self.preview_bytes = vec![0; (w as usize) * (h as usize) * 4];
        }
        self.preview_frame.write_rgba_bytes(&mut self.preview_bytes);
        vec![w as i32, h as i32, 1]
    }

    pub fn preview_ptr(&self) -> *const u8 {
        self.preview_bytes.as_ptr()
    }

    pub fn preview_len(&self) -> usize {
        self.preview_bytes.len()
    }

    /// The composite as a fresh byte array, for export.
    pub fn frame_copy(&mut self) -> Vec<u8> {
        self.editor.take_dirty();
        let all = self.editor.document().bounds();
        self.editor.composite_into(&mut self.frame, &all);
        self.frame.to_rgba_bytes()
    }

    // ---- Tools ---------------------------------------------------------------

    pub fn set_tool(&mut self, name: &str) -> Result<(), String> {
        let kind = ToolKind::from_name(name).ok_or_else(|| format!("unknown tool: {name}"))?;
        self.editor.set_tool(kind);
        Ok(())
    }

    pub fn tool(&self) -> String {
        self.editor.tool().name().to_owned()
    }

    pub fn tool_names() -> Vec<String> {
        ToolKind::ALL.iter().map(|k| k.name().to_owned()).collect()
    }

    pub fn set_color(&mut self, hex: &str) -> Result<(), String> {
        self.editor.settings_mut().color = Rgba::from_hex(hex).map_err(err)?;
        Ok(())
    }

    pub fn color(&self) -> String {
        self.editor.settings().color.to_hex()
    }

    pub fn set_background(&mut self, hex: &str) -> Result<(), String> {
        self.editor.settings_mut().background = Rgba::from_hex(hex).map_err(err)?;
        Ok(())
    }

    pub fn background(&self) -> String {
        self.editor.settings().background.to_hex()
    }

    pub fn swap_colors(&mut self) {
        self.editor.swap_colors();
    }

    pub fn reset_colors(&mut self) {
        self.editor.reset_colors();
    }

    pub fn set_size(&mut self, size: u32) {
        self.editor.settings_mut().size = size.clamp(1, 500);
    }

    pub fn size(&self) -> u32 {
        self.editor.settings().size
    }

    pub fn set_opacity(&mut self, opacity: f32) {
        self.editor.settings_mut().opacity = opacity.clamp(0.0, 1.0);
    }

    pub fn opacity(&self) -> f32 {
        self.editor.settings().opacity
    }

    /// How far out a brush dab is solid before it fades, `0.0..=1.0`.
    pub fn set_hardness(&mut self, hardness: f32) {
        self.editor.settings_mut().hardness = hardness.clamp(0.0, 1.0);
    }

    pub fn hardness(&self) -> f32 {
        self.editor.settings().hardness
    }

    /// The shape of the brush's dab, by name: see [`BrushTip::name`].
    pub fn set_brush_tip(&mut self, name: &str) -> Result<(), String> {
        let tip = BrushTip::from_name(name).ok_or_else(|| format!("no brush tip called \"{name}\""))?;
        self.editor.settings_mut().tip = tip;
        Ok(())
    }

    pub fn brush_tip(&self) -> String {
        self.editor.settings().tip.name().to_owned()
    }

    /// Whether the hardness slider means anything to the current tip.
    pub fn brush_tip_has_hardness(&self) -> bool {
        self.editor.settings().tip.has_hardness()
    }

    /// Paint symmetry: mirrors in the canvas's vertical and horizontal
    /// axes, and how many ways the stroke is turned about the centre (1
    /// for none).
    pub fn set_symmetry(&mut self, mirror_x: bool, mirror_y: bool, radial: u32) {
        self.editor.settings_mut().symmetry = Symmetry { mirror_x, mirror_y, radial: radial.clamp(1, MAX_RADIAL) };
    }

    /// The symmetry as `[mirror_x, mirror_y, radial]`.
    pub fn symmetry(&self) -> Vec<u32> {
        let s = self.editor.settings().symmetry;
        vec![u32::from(s.mirror_x), u32::from(s.mirror_y), s.radial]
    }

    pub fn set_smoothing(&mut self, smoothing: f32) {
        self.editor.settings_mut().smoothing = smoothing.clamp(0.0, 1.0);
    }

    pub fn smoothing(&self) -> f32 {
        self.editor.settings().smoothing
    }

    pub fn set_pressure_size(&mut self, on: bool) {
        self.editor.settings_mut().pressure_size = on;
    }

    pub fn pressure_size(&self) -> bool {
        self.editor.settings().pressure_size
    }

    pub fn brush_tip_names() -> Vec<String> {
        BrushTip::ALL.iter().map(|t| t.name().to_owned()).collect()
    }

    pub fn brush_tip_labels() -> Vec<String> {
        BrushTip::ALL.iter().map(|t| t.label().to_owned()).collect()
    }

    // ---- Text -------------------------------------------------------------------
    //
    // The type settings the text tool uses, and the text session. The page
    // draws the text (it has the fonts) and hands the picture over; see
    // `Editor::preview_text`.

    pub fn set_text_font(&mut self, font: &str) {
        self.editor.settings_mut().text.font = font.to_owned();
    }

    pub fn text_font(&self) -> String {
        self.editor.settings().text.font.clone()
    }

    pub fn set_text_size(&mut self, size: f64) {
        self.editor.settings_mut().text.set_size(size);
    }

    pub fn text_size(&self) -> f64 {
        self.editor.settings().text.size
    }

    pub fn set_text_bold(&mut self, bold: bool) {
        self.editor.settings_mut().text.bold = bold;
    }

    pub fn text_bold(&self) -> bool {
        self.editor.settings().text.bold
    }

    pub fn set_text_italic(&mut self, italic: bool) {
        self.editor.settings_mut().text.italic = italic;
    }

    pub fn text_italic(&self) -> bool {
        self.editor.settings().text.italic
    }

    /// "left", "center" or "right".
    pub fn set_text_align(&mut self, name: &str) -> Result<(), String> {
        let align = TextAlign::from_name(name).ok_or_else(|| format!("no alignment called \"{name}\""))?;
        self.editor.settings_mut().text.align = align;
        Ok(())
    }

    pub fn text_align(&self) -> String {
        self.editor.settings().text.align.name().to_owned()
    }

    /// The Character panel's settings by name — see `text::PARAMS`; a flag
    /// is 0 or 1. Setting one clamps it to its range.
    pub fn set_text_param(&mut self, name: &str, value: f64) -> Result<(), String> {
        self.editor.settings_mut().text.set_param(name, value).map_err(err)
    }

    pub fn text_param(&self, name: &str) -> Result<f64, String> {
        self.editor.settings().text.param(name).ok_or_else(|| format!("no text setting called \"{name}\""))
    }

    /// The names of the Character panel's settings, with `[min, max]` for
    /// each in `text_param_ranges`.
    pub fn text_param_names() -> Vec<String> {
        crate::text::PARAMS.iter().map(|(n, ..)| (*n).to_owned()).collect()
    }

    pub fn text_param_ranges() -> Vec<f64> {
        crate::text::PARAMS.iter().flat_map(|(_, lo, hi)| [*lo, *hi]).collect()
    }

    pub fn set_text_outline_color(&mut self, hex: &str) -> Result<(), String> {
        self.editor.settings_mut().text.outline_color = Rgba::from_hex(hex).map_err(err)?;
        Ok(())
    }

    pub fn text_outline_color(&self) -> String {
        self.editor.settings().text.outline_color.to_hex()
    }

    /// Starts a new text layer with its text's corner at a screen point.
    /// Returns the layer's index.
    pub fn begin_text_layer(&mut self, x: f64, y: f64) -> Result<usize, String> {
        self.editor.begin_text_layer(Point::new(x, y)).map_err(err)
    }

    /// Starts editing the text of layer `index`.
    pub fn begin_text_edit(&mut self, index: usize) -> Result<(), String> {
        self.editor.begin_text_edit(index).map_err(err)
    }

    /// Sets the text being edited: the text itself, and its rendering as
    /// straight-alpha RGBA bytes of `width` by `height`, with the block of
    /// text starting at (`ox`, `oy`) inside it.
    pub fn preview_text(&mut self, text: &str, ox: f64, oy: f64, width: u32, height: u32, bytes: &[u8]) -> Result<bool, String> {
        let raster = Raster::from_rgba_bytes(width, height, bytes)
            .ok_or_else(|| "image bytes do not match the size given".to_owned())?;
        Ok(self.editor.preview_text(text, Point::new(ox, oy), raster))
    }

    pub fn is_editing_text(&self) -> bool {
        self.editor.is_editing_text()
    }

    /// The text layer under a screen point, or -1.
    pub fn text_layer_at(&self, x: f64, y: f64) -> i32 {
        self.editor.text_layer_at(Point::new(x, y)).map_or(-1, |i| i as i32)
    }

    /// A text layer's text, or an empty string for any other layer.
    pub fn layer_text(&self, index: usize) -> Result<String, String> {
        self.layer(index)?;
        Ok(self.editor.layer_text(index).map(|t| t.text.clone()).unwrap_or_default())
    }

    /// Where the block of text starts within a text layer's source, as
    /// `[x, y]`; empty for any other layer.
    pub fn layer_text_origin(&self, index: usize) -> Result<Vec<f64>, String> {
        self.layer(index)?;
        Ok(self.editor.layer_text(index).map(|t| vec![t.origin.x, t.origin.y]).unwrap_or_default())
    }

    /// A smart object's or text layer's placement, source pixels →
    /// document pixels, as the nine numbers of its matrix, row by row;
    /// empty for any other layer. It is projective rather than affine
    /// because a 3D transform can put one in perspective, so the page
    /// builds a CSS `matrix3d` from it rather than a `matrix`.
    pub fn layer_placement(&self, index: usize) -> Result<Vec<f64>, String> {
        self.layer(index)?;
        Ok(self.editor.layer_placement(index).map(|m| m.m.to_vec()).unwrap_or_default())
    }

    pub fn set_tolerance(&mut self, tolerance: u8) {
        self.editor.settings_mut().tolerance = tolerance;
    }

    pub fn tolerance(&self) -> u8 {
        self.editor.settings().tolerance
    }

    /// "contiguous" or "global": whether the wand may reach across the image.
    pub fn set_sample_mode(&mut self, name: &str) -> Result<(), String> {
        let mode = SampleMode::from_name(name).ok_or_else(|| format!("no sample mode called \"{name}\""))?;
        self.editor.settings_mut().sample_mode = mode;
        Ok(())
    }

    pub fn sample_mode(&self) -> String {
        self.editor.settings().sample_mode.name().to_owned()
    }

    pub fn set_sample_all_layers(&mut self, all: bool) {
        self.editor.settings_mut().sample_all_layers = all;
    }

    pub fn sample_all_layers(&self) -> bool {
        self.editor.settings().sample_all_layers
    }

    pub fn set_clone_aligned(&mut self, on: bool) {
        self.editor.settings_mut().clone_aligned = on;
    }

    pub fn clone_aligned(&self) -> bool {
        self.editor.settings().clone_aligned
    }

    /// Where the clone stamp copies from, as `[x, y]` in document pixels,
    /// or empty when no source has been set. The page draws a mark there.
    pub fn clone_anchor(&self) -> Vec<f64> {
        match self.editor.settings().clone_anchor {
            Some(p) => vec![p.x, p.y],
            None => Vec::new(),
        }
    }

    /// How far the clone stamp's source is from a pointer at a document
    /// point, as `[dx, dy]`, or empty when nothing has been anchored.
    pub fn clone_source_offset(&self, x: f64, y: f64) -> Vec<i32> {
        match self.editor.clone_source_offset(Point::new(x, y)) {
            Some((dx, dy)) => vec![dx, dy],
            None => Vec::new(),
        }
    }

    /// The source pixels the clone stamp would copy from a rectangle, as
    /// RGBA bytes, for the preview the page draws inside the brush ring.
    pub fn clone_source_patch(&self, x: i32, y: i32, w: i32, h: i32) -> Vec<u8> {
        self.editor.clone_source_patch(Rect::new(x, y, w, h)).to_rgba_bytes()
    }

    pub fn set_antialias(&mut self, on: bool) {
        self.editor.settings_mut().antialias = on;
    }

    pub fn antialias(&self) -> bool {
        self.editor.settings().antialias
    }

    pub fn set_scrubby_zoom(&mut self, scrubby: bool) {
        self.editor.settings_mut().scrubby_zoom = scrubby;
    }

    pub fn scrubby_zoom(&self) -> bool {
        self.editor.settings().scrubby_zoom
    }

    /// The guides the page draws, in document pixels, for the move tool and
    /// transforms to snap to. Call whenever they change.
    pub fn set_guides(&mut self, h: &[f64], v: &[f64]) {
        let guides = &mut self.editor.settings_mut().guides;
        guides.h = h.to_vec();
        guides.v = v.to_vec();
    }

    /// The guides as the engine has them: what an opened file brought in.
    pub fn guides_h(&self) -> Vec<f64> {
        self.editor.settings().guides.h.clone()
    }

    pub fn guides_v(&self) -> Vec<f64> {
        self.editor.settings().guides.v.clone()
    }

    /// Replaces the guides as an undo step labelled `label` — the page's
    /// "Add Guide", "Move Guide", "Remove Guide" or "Clear Guides".
    pub fn edit_guides(&mut self, h: &[f64], v: &[f64], label: &str) -> bool {
        self.editor.edit_guides(h.to_vec(), v.to_vec(), label)
    }

    pub fn set_snap(&mut self, on: bool) {
        self.editor.settings_mut().guides.enabled = on;
    }

    pub fn snap(&self) -> bool {
        self.editor.settings().guides.enabled
    }

    pub fn set_fill(&mut self, fill: bool) {
        self.editor.settings_mut().fill = fill;
    }

    pub fn fill(&self) -> bool {
        self.editor.settings().fill
    }

    /// How the gradient tool lays its colours out, by name: see
    /// [`GradientShape::name`].
    pub fn set_gradient_shape(&mut self, name: &str) -> Result<(), String> {
        let shape = GradientShape::from_name(name).ok_or_else(|| format!("no gradient called \"{name}\""))?;
        self.editor.settings_mut().gradient_shape = shape;
        Ok(())
    }

    pub fn gradient_shape(&self) -> String {
        self.editor.settings().gradient_shape.name().to_owned()
    }

    pub fn set_gradient_reverse(&mut self, on: bool) {
        self.editor.settings_mut().gradient_reverse = on;
    }

    pub fn gradient_reverse(&self) -> bool {
        self.editor.settings().gradient_reverse
    }

    /// The stops the gradient tool runs through, as `[position, r, g, b, a]`
    /// each — what the page's gradient editor holds. An empty list puts it
    /// back on the foreground and background swatches.
    pub fn set_gradient_stops(&mut self, flat: &[f32]) {
        let stops = GradientStops::from_flat(flat);
        self.editor.settings_mut().gradient_stops = if stops.is_empty() { None } else { Some(stops) };
    }

    pub fn gradient_stops(&self) -> Vec<f32> {
        match &self.editor.settings().gradient_stops {
            Some(stops) => stops.to_flat(),
            None => Vec::new(),
        }
    }

    /// The distinct colours of the flattened picture, the ones covering most
    /// of it first, as `[r, g, b]` each: the palette panel's "From image".
    /// `separation` is `0.0..=1.0` of how far apart they are made to be.
    pub fn image_palette(&self, max: usize, separation: f32) -> Vec<f32> {
        Palette::from_image(&self.editor.document().composite(), max, separation).to_flat()
    }

    pub fn gradient_shape_names() -> Vec<String> {
        GradientShape::ALL.iter().map(|s| s.name().to_owned()).collect()
    }

    pub fn gradient_shape_labels() -> Vec<String> {
        GradientShape::ALL.iter().map(|s| s.label().to_owned()).collect()
    }

    // ---- Pointer -------------------------------------------------------------
    //
    // Screen coordinates, in CSS pixels relative to the canvas.

    /// `pressure` is the pen's, `0.0..=1.0`; pass 1 for a mouse.
    pub fn pointer_down(&mut self, x: f64, y: f64, shift: bool, alt: bool, pressure: f64) -> bool {
        self.editor.set_pressure(pressure);
        self.editor.pointer_down(Point::new(x, y), shift, alt)
    }

    pub fn pointer_move(&mut self, x: f64, y: f64, shift: bool, alt: bool, ctrl: bool, pressure: f64) -> bool {
        self.editor.set_pressure(pressure);
        self.editor.pointer_move(Point::new(x, y), shift, alt, ctrl)
    }

    pub fn pointer_up(&mut self, x: f64, y: f64, shift: bool, alt: bool, pressure: f64) -> bool {
        self.editor.set_pressure(pressure);
        self.editor.pointer_up(Point::new(x, y), shift, alt)
    }

    pub fn cancel_gesture(&mut self) -> bool {
        self.editor.cancel_gesture()
    }

    pub fn is_gesturing(&self) -> bool {
        self.editor.is_gesturing()
    }

    // ---- History -------------------------------------------------------------

    pub fn undo(&mut self) -> bool {
        let done = self.editor.undo();
        self.resize_frame();
        done
    }

    pub fn redo(&mut self) -> bool {
        let done = self.editor.redo();
        self.resize_frame();
        done
    }

    pub fn can_undo(&self) -> bool {
        self.editor.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.editor.can_redo()
    }

    /// Every step in the history, oldest first, done and undone alike.
    pub fn history_labels(&self) -> Vec<String> {
        self.editor.history_labels()
    }

    /// How many of those steps are applied.
    pub fn history_position(&self) -> usize {
        self.editor.history_position()
    }

    /// Jumps to having `steps` of the history applied.
    pub fn history_go_to(&mut self, steps: usize) -> bool {
        let moved = self.editor.history_go_to(steps);
        self.resize_frame();
        moved
    }

    pub fn history_limit(&self) -> usize {
        self.editor.history_limit()
    }

    pub fn set_history_limit(&mut self, limit: usize) {
        self.editor.set_history_limit(limit);
    }

    /// Whether the document differs from what was last saved or opened.
    pub fn is_modified(&self) -> bool {
        self.editor.is_modified()
    }

    /// The document as an NPaint file, and from now on it counts as saved.
    pub fn save_document(&mut self) -> Vec<u8> {
        self.editor.save_document()
    }

    /// A number that changes whenever the document does: what the page's
    /// autosave watches to know there is something new to keep. It crosses
    /// as a double, which counts document states exactly for as long as any
    /// session could last.
    pub fn document_state(&self) -> f64 {
        self.editor.document_state() as f64
    }

    /// Marks the document as never saved — for a document restored from
    /// the page's crash-recovery store, which is unsaved work however new
    /// its history is.
    pub fn mark_unsaved(&mut self) {
        self.editor.mark_unsaved();
    }

    /// The document as an NPaint file, leaving it counting as unsaved:
    /// what the page's autosave keeps for crash recovery.
    pub fn snapshot_document(&mut self) -> Vec<u8> {
        self.editor.snapshot_document()
    }

    /// Replaces the document with an NPaint file's.
    pub fn open_document(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.editor.open_document(bytes).map_err(err)?;
        self.resize_frame();
        Ok(())
    }

    /// Opens a Photoshop file, replacing the document. Returns a sentence
    /// about anything that had to be approximated, or an empty string when
    /// nothing did.
    pub fn open_psd(&mut self, bytes: &[u8]) -> Result<String, String> {
        let note = self.editor.open_psd(bytes).map_err(err)?;
        self.resize_frame();
        Ok(note.unwrap_or_default())
    }

    // ---- Layers --------------------------------------------------------------
    //
    // Indices are bottom-first, as the document stores them.

    pub fn layer_count(&self) -> usize {
        self.editor.document().layers().len()
    }

    pub fn active_layer(&self) -> usize {
        self.editor.document().active_index()
    }

    pub fn layer_id(&self, index: usize) -> Result<u32, String> {
        Ok(self.layer(index)?.id().0)
    }

    pub fn layer_name(&self, index: usize) -> Result<String, String> {
        Ok(self.layer(index)?.name.clone())
    }

    pub fn layer_visible(&self, index: usize) -> Result<bool, String> {
        Ok(self.layer(index)?.visible)
    }

    pub fn layer_opacity(&self, index: usize) -> Result<f32, String> {
        Ok(self.layer(index)?.opacity)
    }

    /// The blend mode's name, as `blend_mode_names` lists them.
    pub fn layer_blend(&self, index: usize) -> Result<String, String> {
        Ok(self.layer(index)?.blend.name().to_owned())
    }

    pub fn set_layer_blend(&mut self, index: usize, name: &str) -> Result<(), String> {
        let mode = BlendMode::from_name(name).ok_or_else(|| format!("no blend mode called \"{name}\""))?;
        self.editor.set_layer_blend(index, mode).map_err(err)
    }

    pub fn blend_mode_names() -> Vec<String> {
        BlendMode::ALL.iter().map(|m| m.name().to_owned()).collect()
    }

    /// The blend modes a *group* may be set to, pass-through first. The
    /// panel offers these instead when the layer is a group.
    pub fn group_blend_mode_names() -> Vec<String> {
        BlendMode::GROUP.iter().map(|m| m.name().to_owned()).collect()
    }

    pub fn group_blend_mode_labels() -> Vec<String> {
        BlendMode::GROUP.iter().map(|m| m.label().to_owned()).collect()
    }

    pub fn blend_mode_labels() -> Vec<String> {
        BlendMode::ALL.iter().map(|m| m.label().to_owned()).collect()
    }

    pub fn layer_locked(&self, index: usize) -> Result<bool, String> {
        Ok(self.layer(index)?.locked)
    }

    pub fn set_layer_locked(&mut self, index: usize, locked: bool) -> Result<(), String> {
        self.editor.set_layer_locked(index, locked).map_err(err)
    }

    pub fn layer_lock_alpha(&self, index: usize) -> Result<bool, String> {
        Ok(self.layer(index)?.lock_alpha)
    }

    pub fn set_layer_lock_alpha(&mut self, index: usize, locked: bool) -> Result<(), String> {
        self.editor.set_layer_lock_alpha(index, locked).map_err(err)
    }

    /// A small RGBA thumbnail of one layer's pixels, `w` by `h`,
    /// nearest-neighbour. Transparent for an adjustment layer, which has none.
    pub fn layer_thumbnail(&self, index: usize, w: u32, h: u32) -> Result<Vec<u8>, String> {
        Ok(thumbnail(&self.layer(index)?.raster, w, h, |p| p))
    }

    /// The same for a layer's mask, as grey. Empty when it has no mask.
    pub fn layer_mask_thumbnail(&self, index: usize, w: u32, h: u32) -> Result<Vec<u8>, String> {
        Ok(match &self.layer(index)?.mask {
            Some(mask) => thumbnail(mask, w, h, |p| {
                let v = mask_cover(p);
                Rgba::opaque(v, v, v)
            }),
            None => Vec::new(),
        })
    }

    /// `"pixels"`, `"adjustment"` or `"smart"`.
    pub fn layer_kind(&self, index: usize) -> Result<String, String> {
        Ok(self.layer(index)?.kind.name().to_owned())
    }

    pub fn layer_has_mask(&self, index: usize) -> Result<bool, String> {
        Ok(self.layer(index)?.mask.is_some())
    }

    pub fn layer_mask_enabled(&self, index: usize) -> Result<bool, String> {
        Ok(self.layer(index)?.mask_enabled)
    }

    /// Whether the tools are painting on the layer's mask rather than its
    /// pixels.
    pub fn layer_editing_mask(&self, index: usize) -> Result<bool, String> {
        Ok(self.layer(index)?.editing_mask())
    }

    /// Points the tools at the layer's mask (`true`) or its pixels.
    pub fn set_layer_target(&mut self, index: usize, mask: bool) -> Result<(), String> {
        let target = if mask { Target::Mask } else { Target::Pixels };
        self.editor.set_layer_target(index, target).map_err(err)
    }

    /// Why the current tool cannot paint on the active layer, or an empty
    /// string when it can — the message the page shows when a click on the
    /// canvas is declined.
    pub fn edit_refusal(&self) -> String {
        self.editor.edit_refusal().map(|why| why.to_string()).unwrap_or_default()
    }

    fn layer(&self, index: usize) -> Result<&crate::layer::Layer, String> {
        self.editor.document().layer(index).ok_or_else(|| "no such layer".to_owned())
    }

    // ---- Layer masks ---------------------------------------------------------------

    /// Gives a layer a mask from the selection — revealing it, or hiding it
    /// when `hide` is set — or one revealing everything when nothing is
    /// selected.
    pub fn add_layer_mask(&mut self, index: usize, hide: bool) -> Result<(), String> {
        self.editor.add_layer_mask(index, hide).map_err(err)
    }

    pub fn remove_layer_mask(&mut self, index: usize) -> Result<(), String> {
        self.editor.remove_layer_mask(index).map_err(err)
    }

    /// Bakes the mask into the layer and drops it.
    pub fn apply_layer_mask(&mut self, index: usize) -> Result<(), String> {
        self.editor.apply_layer_mask(index).map_err(err)
    }

    pub fn set_layer_mask_enabled(&mut self, index: usize, enabled: bool) -> Result<(), String> {
        self.editor.set_layer_mask_enabled(index, enabled).map_err(err)
    }

    /// Loads a layer's mask as the selection.
    pub fn select_layer_mask(&mut self, index: usize) -> Result<bool, String> {
        self.editor.select_layer_mask(index, SelectMode::Replace).map_err(err)
    }

    // ---- Adjustment layers ----------------------------------------------------------

    /// A new adjustment layer above the active one, with `params` (as the
    /// adjustment's dialog gives them; empty for neutral). Returns its index.
    pub fn add_adjustment_layer(&mut self, name: &str, params: &[f32]) -> Result<usize, String> {
        self.editor.add_adjustment_layer(name, params).map_err(err)
    }

    /// The adjustment an adjustment layer applies, or an empty string.
    pub fn layer_adjustment_name(&self, index: usize) -> Result<String, String> {
        self.layer(index)?;
        Ok(self.editor.layer_adjustment(index).map(|a| a.name().to_owned()).unwrap_or_default())
    }

    /// Its parameters, in the order the dialog shows them.
    pub fn layer_adjustment_params(&self, index: usize) -> Result<Vec<f32>, String> {
        self.layer(index)?;
        Ok(self.editor.layer_adjustment(index).map(|a| a.params()).unwrap_or_default())
    }

    /// Opens an adjustment layer's settings as a session: `preview_adjustment`
    /// then changes the layer live, and `commit_session` keeps it.
    pub fn begin_adjustment_layer(&mut self, index: usize) -> Result<(), String> {
        self.editor.begin_adjustment_layer(index).map_err(err)
    }

    // ---- Smart objects -----------------------------------------------------------------

    /// Places an image as a smart object above the active layer, fitted to
    /// the document and centred. The bytes are straight-alpha RGBA of
    /// `width` by `height`, at whatever size the picture is.
    pub fn place_smart_object(&mut self, name: &str, width: u32, height: u32, bytes: &[u8]) -> Result<usize, String> {
        let raster = Raster::from_rgba_bytes(width, height, bytes)
            .ok_or_else(|| "image bytes do not match the size given".to_owned())?;
        Ok(self.editor.place_smart_object(name, raster))
    }

    pub fn convert_to_smart_object(&mut self, index: usize) -> Result<(), String> {
        self.editor.convert_to_smart_object(index).map_err(err)
    }

    pub fn rasterize_layer(&mut self, index: usize) -> Result<(), String> {
        self.editor.rasterize_layer(index).map_err(err)
    }

    /// Swaps a smart object's picture for another, keeping its place.
    pub fn replace_smart_contents(&mut self, index: usize, width: u32, height: u32, bytes: &[u8]) -> Result<(), String> {
        let raster = Raster::from_rgba_bytes(width, height, bytes)
            .ok_or_else(|| "image bytes do not match the size given".to_owned())?;
        self.editor.replace_smart_contents(index, raster).map_err(err)
    }

    pub fn add_layer(&mut self) -> usize {
        self.editor.add_layer()
    }

    /// Adds a layer from straight-alpha RGBA bytes of the document's size —
    /// what `getImageData` on a decoded image gives.
    pub fn add_layer_from_rgba(&mut self, name: &str, width: u32, height: u32, bytes: &[u8]) -> Result<usize, String> {
        let raster = Raster::from_rgba_bytes(width, height, bytes)
            .ok_or_else(|| "image bytes do not match the size given".to_owned())?;
        self.editor.add_layer_from(name, raster).map_err(err)
    }

    /// Replaces the document with an image, as Open does. The bytes are
    /// straight-alpha RGBA of `width` by `height`.
    pub fn open_image(&mut self, name: &str, width: u32, height: u32, bytes: &[u8]) -> Result<(), String> {
        let raster = Raster::from_rgba_bytes(width, height, bytes)
            .ok_or_else(|| "image bytes do not match the size given".to_owned())?;
        self.editor.open_image(name, raster);
        self.frame = Raster::new(width, height);
        self.frame_bytes = vec![0; (width as usize) * (height as usize) * 4];
        Ok(())
    }

    /// Adds a picture of any size as a layer at its own resolution, centred
    /// — Open as Layer.
    pub fn add_layer_centred(&mut self, name: &str, width: u32, height: u32, bytes: &[u8]) -> Result<usize, String> {
        let raster = Raster::from_rgba_bytes(width, height, bytes)
            .ok_or_else(|| "image bytes do not match the size given".to_owned())?;
        Ok(self.editor.add_layer_centred(name, &raster))
    }

    // ---- Clipboard --------------------------------------------------------------

    /// Copies the selected pixels of the active surface, or of the whole
    /// picture when `merged`. False when there is nothing to copy.
    pub fn copy_selection(&mut self, merged: bool) -> bool {
        self.editor.copy_selection(merged)
    }

    pub fn cut_selection(&mut self) -> bool {
        self.editor.cut_selection()
    }

    pub fn has_clipboard(&self) -> bool {
        self.editor.clipboard().is_some()
    }

    /// `[width, height]` of what the clipboard holds, or empty.
    pub fn clipboard_size(&self) -> Vec<u32> {
        match self.editor.clipboard() {
            Some(clip) => vec![clip.raster.width(), clip.raster.height()],
            None => Vec::new(),
        }
    }

    /// The clipboard's pixels as straight-alpha RGBA, for the page to hand
    /// to the system clipboard.
    pub fn clipboard_rgba(&self) -> Vec<u8> {
        self.editor.clipboard().map(|clip| clip.raster.to_rgba_bytes()).unwrap_or_default()
    }

    /// Pastes the clipboard as a new layer. The layer's index, or none when
    /// the clipboard is empty.
    pub fn paste(&mut self) -> Option<usize> {
        self.editor.paste()
    }

    /// Pastes a picture from outside — the system clipboard, a dropped file
    /// — as a new layer, centred.
    pub fn paste_external(&mut self, name: &str, width: u32, height: u32, bytes: &[u8]) -> Result<usize, String> {
        let raster = Raster::from_rgba_bytes(width, height, bytes)
            .ok_or_else(|| "image bytes do not match the size given".to_owned())?;
        Ok(self.editor.paste_external(name, &raster))
    }

    pub fn duplicate_layer(&mut self, index: usize) -> Result<usize, String> {
        self.editor.duplicate_layer(index).map_err(err)
    }

    pub fn remove_layer(&mut self, index: usize) -> Result<(), String> {
        self.editor.remove_layer(index).map_err(err)
    }

    /// Drops a layer on another one — what a drag in the layers panel ends
    /// with. `where_` is `"above"`, `"below"` or `"inside"`; a group brings
    /// its contents. Returns where the layer ended up.
    pub fn move_layer_to(&mut self, from: usize, to: usize, where_: &str) -> Result<usize, String> {
        let drop = drop_of(where_).ok_or_else(|| format!("no such drop: {where_}"))?;
        self.editor.move_layer_to(from, to, drop).map_err(err)
    }

    /// Moves a layer one row up (`up`) or down the panel. Returns where it
    /// ended up, or -1 if there was nowhere to go.
    pub fn reorder_layer(&mut self, index: usize, up: bool) -> Result<i32, String> {
        Ok(self.editor.reorder_layer(index, up).map_err(err)?.map_or(-1, |i| i as i32))
    }

    // ---- The panel's selection -----------------------------------------------

    /// Whether the panel has this row picked out. The active layer always
    /// is; the others are what Shift- and Ctrl-clicking added.
    pub fn layer_selected(&self, index: usize) -> bool {
        self.editor.layer_is_selected(index)
    }

    /// How many rows are selected. One means the active layer alone.
    pub fn selected_layer_count(&self) -> usize {
        self.editor.selected_layers().len()
    }

    /// Ctrl-clicking a row: adds it to the selection, or takes it out.
    pub fn toggle_layer_selected(&mut self, index: usize) -> Result<(), String> {
        self.editor.toggle_layer_selected(index).map_err(err)
    }

    /// Clicking the empty part of the panel: back to the active layer
    /// alone. One layer is always active — the tools need something to
    /// paint on — so this is as far as unselecting goes.
    pub fn clear_layer_selection(&mut self) {
        self.editor.clear_layer_selection();
    }

    /// Shift-clicking a row: everything between the active layer and it.
    pub fn select_layer_range(&mut self, index: usize) -> Result<(), String> {
        self.editor.select_layer_range(index).map_err(err)
    }

    // ---- Groups --------------------------------------------------------------

    /// A new, empty group where a new layer would go.
    pub fn add_group(&mut self) -> usize {
        self.editor.add_group()
    }

    /// Puts a layer into a new group in its place. Nothing changes on
    /// screen: a new group is pass-through.
    pub fn group_layer(&mut self, index: usize) -> Result<usize, String> {
        self.editor.group_layer(index).map_err(err)
    }

    /// The same for everything the panel has selected, into one group.
    pub fn group_selected_layers(&mut self) -> Result<usize, String> {
        self.editor.group_selected_layers().map_err(err)
    }

    /// Deletes every selected layer, or just the active one when that is
    /// all there is.
    pub fn remove_selected_layers(&mut self) -> Result<(), String> {
        self.editor.remove_selected_layers().map_err(err)
    }

    /// Duplicates every selected layer.
    pub fn duplicate_selected_layers(&mut self) -> Result<usize, String> {
        self.editor.duplicate_selected_layers().map_err(err)
    }

    /// Dissolves a group, leaving its contents at the level it was on.
    pub fn ungroup(&mut self, index: usize) -> Result<(), String> {
        self.editor.ungroup(index).map_err(err)
    }

    /// Replaces a group with one layer holding what it drew.
    pub fn merge_group(&mut self, index: usize) -> Result<(), String> {
        self.editor.flatten_group(index).map_err(err)
    }

    /// The group a layer is in, as its index, or -1 at the top level.
    pub fn layer_parent(&self, index: usize) -> Result<i32, String> {
        self.layer(index)?;
        Ok(self.editor.document().parent_index(index).map_or(-1, |i| i as i32))
    }

    /// How deep in the groups a layer sits: 0 at the top level.
    pub fn layer_depth(&self, index: usize) -> Result<usize, String> {
        self.layer(index)?;
        Ok(self.editor.document().depth(index))
    }

    /// Whether a group's contents are folded away in the panel.
    pub fn layer_collapsed(&self, index: usize) -> Result<bool, String> {
        Ok(self.layer(index)?.collapsed)
    }

    pub fn set_layer_collapsed(&mut self, index: usize, collapsed: bool) -> Result<(), String> {
        self.editor.set_layer_collapsed(index, collapsed).map_err(err)
    }

    /// Whether a group above this layer is switched off, so that it is not
    /// on screen however its own eye is set.
    pub fn layer_hidden_by_group(&self, index: usize) -> Result<bool, String> {
        self.layer(index)?;
        Ok(self.editor.document().hidden_by_group(index))
    }

    /// Whether a drop would actually move the layer. The panel asks before
    /// it draws the line, so that a line is only ever shown where letting
    /// go really does something.
    pub fn move_would_change(&self, from: usize, to: usize, where_: &str) -> bool {
        let Some(drop) = drop_of(where_) else { return false };
        self.editor.document().move_layers_would_change(&self.editor.dragged_layers(from), to, drop)
    }

    /// Whether moving a layer one row that way would do anything, which is
    /// what greys out the panel's up and down buttons.
    pub fn can_reorder_layer(&self, index: usize, up: bool) -> bool {
        self.editor.document().reorder_target(index, up).is_some()
    }

    /// The layer directly below this one at the same level, or -1 when it
    /// is at the bottom of the group it is in. What Merge Down works on.
    pub fn sibling_below(&self, index: usize) -> i32 {
        self.editor.document().sibling_below(index).map_or(-1, |i| i as i32)
    }

    /// Whether `index` is the group at `group`, or inside it — what the
    /// panel checks before it offers a drop.
    pub fn layer_is_inside(&self, index: usize, group: usize) -> bool {
        self.editor.document().is_inside(index, group)
    }

    pub fn merge_down(&mut self, index: usize) -> Result<(), String> {
        self.editor.merge_down(index).map_err(err)
    }

    pub fn set_active_layer(&mut self, index: usize) -> Result<(), String> {
        self.editor.set_active_layer(index).map_err(err)
    }

    pub fn set_layer_visible(&mut self, index: usize, visible: bool) -> Result<(), String> {
        self.editor.set_layer_visible(index, visible).map_err(err)
    }

    pub fn set_layer_opacity(&mut self, index: usize, opacity: f32) -> Result<(), String> {
        self.editor.set_layer_opacity(index, opacity).map_err(err)
    }

    pub fn rename_layer(&mut self, index: usize, name: &str) -> Result<(), String> {
        self.editor.rename_layer(index, name).map_err(err)
    }

    pub fn clear_selection(&mut self) -> bool {
        self.editor.clear_selection()
    }

    pub fn fill_selection(&mut self) -> bool {
        self.editor.fill_selection()
    }

    pub fn fill_selection_background(&mut self) -> bool {
        self.editor.fill_selection_background()
    }

    /// Paints a line `width` wide along the selection's edge in the
    /// foreground colour.
    pub fn stroke_selection(&mut self, width: u32) -> bool {
        self.editor.stroke_selection(width)
    }

    /// Auto Levels (`per_channel`) or Auto Contrast on the selected pixels.
    pub fn auto_levels(&mut self, per_channel: bool) -> bool {
        self.editor.auto_levels(per_channel)
    }

    /// Makes a checkerboard baked into the active layer transparent. False
    /// when its edges show no board.
    pub fn remove_checkerboard(&mut self) -> bool {
        self.editor.remove_checkerboard()
    }

    /// Moves the selected pixels (or the whole layer) by whole pixels; a run
    /// of nudges is one undo step.
    pub fn nudge_layer(&mut self, dx: i32, dy: i32) -> bool {
        self.editor.nudge_layer(dx, dy)
    }

    /// Moves the selection outline by whole pixels.
    pub fn nudge_selection(&mut self, dx: i32, dy: i32) -> bool {
        self.editor.nudge_selection(dx, dy)
    }

    pub fn flip_layer_horizontal(&mut self) -> bool {
        self.editor.flip_layer_horizontal()
    }

    pub fn flip_layer_vertical(&mut self) -> bool {
        self.editor.flip_layer_vertical()
    }

    /// Quarter turns clockwise; negative for anticlockwise.
    pub fn rotate_layer(&mut self, turns: i32) -> bool {
        self.editor.rotate_layer(turns)
    }

    pub fn rotate_canvas(&mut self, turns: i32) {
        self.editor.rotate_canvas(turns);
        self.resize_frame();
    }

    /// The biggest canvas the engine will make, for the page to clamp a drag
    /// with rather than asking for something that cannot be allocated.
    pub fn max_side(&self) -> u32 {
        crate::editor::MAX_SIDE
    }

    pub fn max_pixels(&self) -> f64 {
        crate::editor::MAX_PIXELS as f64
    }

    /// Resizes the canvas, keeping the current pixels at `(dx, dy)`.
    pub fn resize_canvas(&mut self, width: u32, height: u32, dx: i32, dy: i32) -> bool {
        let done = self.editor.resize_canvas(width, height, dx, dy);
        // The frame the page reads is the size of the document; leaving it
        // behind hands the page a byte count that does not match the
        // dimensions it asks for, and `ImageData` refuses it.
        self.resize_frame();
        done
    }

    /// Grows the canvas to hold everything the layers have, including the
    /// parts of a smart object hanging outside it — Image > Reveal All.
    /// False when there is nothing outside to reveal.
    pub fn reveal_all(&mut self) -> bool {
        let done = self.editor.reveal_all();
        self.resize_frame();
        done
    }

    /// `[width, height]` the canvas would need to hold everything, which is
    /// the canvas it has when nothing hangs outside it.
    pub fn content_size(&self) -> Vec<u32> {
        let all = self.editor.document().content_bounds();
        vec![all.w as u32, all.h as u32]
    }

    /// Crops the canvas to the selection's bounding box.
    pub fn crop_to_selection(&mut self) -> bool {
        let done = self.editor.crop_to_selection();
        self.resize_frame();
        done
    }

    /// Scales the whole picture to a new size.
    pub fn resize_image(&mut self, width: u32, height: u32) -> bool {
        let done = self.editor.resize_image(width, height);
        self.resize_frame();
        done
    }

    pub fn flip_canvas_horizontal(&mut self) {
        self.editor.flip_canvas_horizontal();
    }

    pub fn flip_canvas_vertical(&mut self) {
        self.editor.flip_canvas_vertical();
    }

    pub fn flatten(&mut self) {
        self.editor.flatten();
    }

    pub fn layer_via_copy(&mut self) -> usize {
        self.editor.layer_via_copy()
    }

    // ---- Adjustments -------------------------------------------------------------

    pub fn adjustment_names() -> Vec<String> {
        Adjustment::NAMES.iter().map(|n| (*n).to_owned()).collect()
    }

    /// Applies a parameterless adjustment (invert, desaturate) in one step.
    pub fn apply_adjustment(&mut self, name: &str) -> Result<bool, String> {
        let adjustment = Adjustment::from_params(name, &[]).map_err(err)?;
        Ok(self.editor.apply_adjustment(adjustment))
    }

    pub fn begin_adjustment(&mut self) -> Result<(), String> {
        self.editor.begin_adjustment().map_err(err)
    }

    /// Previews `name` with `params` (a Float32Array in the order the
    /// adjustment's fields are declared) on the original pixels.
    pub fn preview_adjustment(&mut self, name: &str, params: &[f32]) -> Result<(), String> {
        self.editor.preview_adjustment(name, params).map_err(err)
    }

    pub fn commit_session(&mut self) -> bool {
        self.editor.commit_session()
    }

    pub fn cancel_session(&mut self) -> bool {
        self.editor.cancel_session()
    }

    pub fn has_session(&self) -> bool {
        self.editor.has_session()
    }

    pub fn is_adjusting(&self) -> bool {
        self.editor.is_adjusting()
    }

    // ---- Free transform ------------------------------------------------------------

    pub fn begin_transform(&mut self) -> Result<(), String> {
        self.editor.begin_transform().map_err(err)
    }

    pub fn is_transforming(&self) -> bool {
        self.editor.is_transforming()
    }

    /// Starts a free transform of the selection outline rather than pixels.
    pub fn begin_transform_selection(&mut self) -> Result<(), String> {
        self.editor.begin_transform_selection().map_err(err)
    }

    pub fn is_transforming_selection(&self) -> bool {
        self.editor.is_transforming_selection()
    }

    pub fn transform_set_position(&mut self, x: f64, y: f64) -> bool {
        self.editor.transform_set_position(x, y)
    }

    pub fn transform_set_size(&mut self, width: f64, height: f64) -> bool {
        self.editor.transform_set_size(width, height)
    }

    pub fn transform_set_angle(&mut self, degrees: f64) -> bool {
        self.editor.transform_set_angle(degrees)
    }

    /// The eight handles as `[x0, y0, x1, y1, ...]` in screen pixels, in the
    /// order top-left, top, top-right, right, bottom-right, bottom,
    /// bottom-left, left. Empty when not transforming.
    pub fn transform_handles(&self) -> Vec<f64> {
        match self.editor.transform_handles() {
            Some(h) => h.iter().flat_map(|p| [p.x, p.y]).collect(),
            None => Vec::new(),
        }
    }

    /// The rotation wheel's centre as `[x, y]` in screen pixels, or empty
    /// when not transforming. The page draws it; grabbing it turns the box.
    pub fn transform_wheel(&self) -> Vec<f64> {
        match self.editor.transform_wheel() {
            Some(p) => vec![p.x, p.y],
            None => Vec::new(),
        }
    }

    /// `[x, y, width, height, scale_x, scale_y, angle_degrees]`, or empty.
    pub fn transform_info(&self) -> Vec<f64> {
        match self.editor.transform_info() {
            Some(i) => vec![i.x, i.y, i.width, i.height, i.scale_x, i.scale_y, i.angle_degrees],
            None => Vec::new(),
        }
    }

    /// What the pointer would grab at a screen position: a handle name
    /// (`"top-left"`, `"top"`, ...), `"inside"`, or `"rotate"` for anywhere
    /// outside the box. Empty when not transforming.
    pub fn transform_hit(&self, x: f64, y: f64) -> String {
        match self.editor.transform_hit(Point::new(x, y)) {
            None => String::new(),
            Some(Hit::Inside) => "inside".to_owned(),
            Some(Hit::Wheel) => "wheel".to_owned(),
            Some(Hit::Rotate) => "rotate".to_owned(),
            Some(Hit::Handle(h)) => match h {
                Handle::TopLeft => "top-left",
                Handle::Top => "top",
                Handle::TopRight => "top-right",
                Handle::Right => "right",
                Handle::BottomRight => "bottom-right",
                Handle::Bottom => "bottom",
                Handle::BottomLeft => "bottom-left",
                Handle::Left => "left",
            }
            .to_owned(),
        }
    }

    pub fn transform_nudge(&mut self, dx: f64, dy: f64) -> bool {
        self.editor.transform_nudge(dx, dy)
    }

    pub fn transform_rotate(&mut self, degrees: f64) -> bool {
        self.editor.transform_rotate(degrees)
    }

    pub fn transform_flip_horizontal(&mut self) -> bool {
        self.editor.transform_flip_horizontal()
    }

    pub fn transform_flip_vertical(&mut self) -> bool {
        self.editor.transform_flip_vertical()
    }

    // ---- Selection -----------------------------------------------------------

    pub fn select_all(&mut self) {
        self.editor.select_all();
    }

    pub fn deselect(&mut self) {
        self.editor.deselect();
    }

    /// `[x, y, w, h]` in screen pixels for the rubber band the current
    /// gesture wants drawn, or empty when there is none.
    pub fn tool_overlay(&self) -> Vec<f64> {
        match self.editor.tool_overlay() {
            Some(r) => r.to_vec(),
            None => Vec::new(),
        }
    }

    /// The marching ants as closed loops in document coordinates, flattened:
    /// each loop is its point count followed by that many x, y pairs.
    pub fn selection_contours(&self) -> Vec<f64> {
        let mut out = Vec::new();
        for loop_ in self.editor.selection_contours() {
            out.push(loop_.len() as f64);
            for point in loop_ {
                out.push(point.x);
                out.push(point.y);
            }
        }
        out
    }

    /// How many pixels are selected.
    pub fn selection_area(&self) -> usize {
        self.editor.selection_area()
    }

    pub fn select_invert(&mut self) -> bool {
        self.editor.invert_selection()
    }

    pub fn select_expand(&mut self, pixels: u32) -> bool {
        self.editor.expand_selection(pixels)
    }

    pub fn select_contract(&mut self, pixels: u32) -> bool {
        self.editor.contract_selection(pixels)
    }

    pub fn select_feather(&mut self, pixels: u32) -> bool {
        self.editor.feather_selection(pixels)
    }

    pub fn select_smooth(&mut self, pixels: u32) -> bool {
        self.editor.smooth_selection(pixels)
    }

    /// Selects the pixels the layer actually draws.
    pub fn select_opaque(&mut self) -> bool {
        self.editor.select_opaque(SelectMode::Replace)
    }

    /// Selects everything one particular layer draws — Ctrl-clicking its
    /// thumbnail — without making it the active layer.
    pub fn select_layer_opaque(&mut self, index: usize) -> Result<bool, String> {
        self.editor.select_layer_opaque(index, SelectMode::Replace).map_err(err)
    }

    /// Extends the selection to matching pixels anywhere in the image.
    pub fn select_similar(&mut self) -> bool {
        self.editor.select_similar()
    }

    /// Finds and selects the subject. False when there is nothing that stands
    /// out enough to call one.
    pub fn select_subject(&mut self) -> bool {
        self.editor.select_subject(SelectMode::Replace)
    }

    /// Selects the subject from a matte the page worked out with the model:
    /// `matte_w` x `matte_h` bytes of coverage, one per pixel, at whatever
    /// resolution the model runs at.
    pub fn select_subject_from_matte(&mut self, matte: &[u8], matte_w: u32, matte_h: u32) -> bool {
        self.editor.select_subject_from_matte(matte, matte_w, matte_h, SelectMode::Replace)
    }

    /// The subject tool's box as `[x, y, w, h]`, or empty when there is none.
    pub fn subject_box(&self) -> Vec<i32> {
        match self.editor.subject_box() {
            Some(r) => vec![r.x, r.y, r.w, r.h],
            None => Vec::new(),
        }
    }

    pub fn clear_subject_box(&mut self) {
        self.editor.clear_subject_box();
    }

    /// The flattened picture inside a rectangle, as RGBA bytes, for the
    /// subject model.
    pub fn frame_crop(&self, x: i32, y: i32, w: i32, h: i32) -> Vec<u8> {
        self.editor.composite_crop(Rect::new(x, y, w, h)).to_rgba_bytes()
    }

    /// Selects the subject the model found in the box: `matte` is the
    /// model's coverage of the box alone. Shift adds to the selection and
    /// Alt takes away, as with the other selection tools.
    #[allow(clippy::too_many_arguments)]
    pub fn select_subject_in_box(&mut self, x: i32, y: i32, w: i32, h: i32, matte: &[u8], matte_w: u32, matte_h: u32, shift: bool, alt: bool) -> bool {
        self.editor.select_subject_in_box(Rect::new(x, y, w, h), matte, matte_w, matte_h, SelectMode::from_modifiers(shift, alt))
    }

    /// The built-in finder over the box, for when the model is not there.
    pub fn select_subject_builtin_in_box(&mut self, x: i32, y: i32, w: i32, h: i32, shift: bool, alt: bool) -> bool {
        self.editor.select_subject_builtin_in_box(Rect::new(x, y, w, h), SelectMode::from_modifiers(shift, alt))
    }

    /// `[x, y, w, h]` in document pixels, or an empty array when nothing is
    /// selected.
    pub fn selection_rect(&self) -> Vec<i32> {
        match self.editor.selection_rect() {
            Some(r) => vec![r.x, r.y, r.w, r.h],
            None => Vec::new(),
        }
    }

    // ---- Viewport ------------------------------------------------------------

    pub fn zoom(&self) -> f64 {
        self.editor.zoom()
    }

    pub fn pan_x(&self) -> f64 {
        self.editor.pan().x
    }

    pub fn pan_y(&self) -> f64 {
        self.editor.pan().y
    }

    pub fn pan_by(&mut self, dx: f64, dy: f64) {
        self.editor.pan_by(dx, dy);
    }

    pub fn set_zoom_about(&mut self, zoom: f64, x: f64, y: f64) {
        self.editor.set_zoom_about(zoom, Point::new(x, y));
    }

    pub fn zoom_by_about(&mut self, factor: f64, x: f64, y: f64) {
        self.editor.zoom_by_about(factor, Point::new(x, y));
    }

    pub fn zoom_in_about(&mut self, x: f64, y: f64) {
        self.editor.zoom_in_about(Point::new(x, y));
    }

    pub fn zoom_out_about(&mut self, x: f64, y: f64) {
        self.editor.zoom_out_about(Point::new(x, y));
    }

    pub fn set_view_size(&mut self, view_w: f64, view_h: f64) {
        self.editor.set_view_size(view_w, view_h);
    }

    pub fn fit_to_view(&mut self, view_w: f64, view_h: f64) {
        self.editor.fit_to_view(view_w, view_h);
    }

    pub fn zoom_to_actual_size(&mut self, view_w: f64, view_h: f64) {
        self.editor.zoom_to_actual_size(view_w, view_h);
    }

    /// `[x, y]` document coordinates for a screen position, for the status
    /// bar's cursor readout.
    pub fn screen_to_doc(&self, x: f64, y: f64) -> Vec<f64> {
        let p = self.editor.screen_to_doc(Point::new(x, y));
        vec![p.x, p.y]
    }
}

/// A `w` by `h` nearest-neighbour thumbnail of `raster`, each pixel through
/// `map`, as RGBA bytes.
fn thumbnail(raster: &Raster, w: u32, h: u32, map: impl Fn(Rgba) -> Rgba) -> Vec<u8> {
    let mut out = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        let sy = (u64::from(y) * u64::from(raster.height()) / u64::from(h.max(1))) as i32;
        for x in 0..w {
            let sx = (u64::from(x) * u64::from(raster.width()) / u64::from(w.max(1))) as i32;
            let p = map(raster.get(sx, sy));
            out.extend_from_slice(&[p.r, p.g, p.b, p.a]);
        }
    }
    out
}

fn parse_background(text: &str) -> Result<Rgba, String> {
    if text.trim().is_empty() {
        Ok(Rgba::TRANSPARENT)
    } else {
        Rgba::from_hex(text).map_err(err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_parsing() {
        assert_eq!(parse_background("").unwrap(), Rgba::TRANSPARENT);
        assert_eq!(parse_background("  ").unwrap(), Rgba::TRANSPARENT);
        assert_eq!(parse_background("#ffffff").unwrap(), Rgba::WHITE);
        assert!(parse_background("nope").is_err());
    }

    #[test]
    fn frame_bytes_track_the_document() {
        let mut np = NPaint::new(2, 2, "#ff0000").unwrap();
        assert!(!np.render().is_empty());
        assert!(np.render().is_empty(), "nothing changed");
        assert_eq!(np.frame_len(), 16);
        assert_eq!(np.frame_copy()[..4], [255, 0, 0, 255]);
        np.set_tool("pencil").unwrap();
        np.set_color("#0000ff").unwrap();
        np.set_size(1);
        np.pointer_down(0.0, 0.0, false, false, 1.0);
        np.pointer_up(0.0, 0.0, false, false, 1.0);
        assert!(!np.render().is_empty());
        assert_eq!(np.frame_copy()[..4], [0, 0, 255, 255]);
    }

    #[test]
    fn thumbnail_samples_the_layer() {
        let np = NPaint::new(10, 10, "#00ff00").unwrap();
        let thumb = np.layer_thumbnail(0, 2, 2).unwrap();
        assert_eq!(thumb.len(), 16);
        assert_eq!(thumb[..4], [0, 255, 0, 255]);
    }

    #[test]
    fn unknown_tool_is_an_error() {
        let mut np = NPaint::new(1, 1, "").unwrap();
        assert!(np.set_tool("nothing-of-the-sort").is_err());
        assert_eq!(np.tool(), "brush");
    }

    #[test]
    fn rotating_the_canvas_resizes_the_frame_and_undo_restores_it() {
        let mut np = NPaint::new(3, 2, "#ffffff").unwrap();
        np.rotate_canvas(1);
        assert_eq!((np.width(), np.height()), (2, 3));
        assert!(!np.render().is_empty());
        assert_eq!(np.frame_len(), 24);
        np.undo();
        assert_eq!(np.frame_len(), 24);
        assert_eq!((np.width(), np.height()), (3, 2));
    }

    #[test]
    fn transform_surface_is_flat_arrays_and_strings() {
        let mut np = NPaint::new(10, 10, "").unwrap();
        assert!(np.transform_handles().is_empty());
        assert_eq!(np.transform_hit(0.0, 0.0), "");
        assert!(np.begin_transform().is_err(), "nothing to transform");
        np.set_tool("pencil").unwrap();
        np.set_size(1);
        np.pointer_down(5.0, 5.0, false, false, 1.0);
        np.pointer_up(5.0, 5.0, false, false, 1.0);
        np.begin_transform().unwrap();
        assert_eq!(np.transform_handles().len(), 16);
        assert_eq!(np.transform_wheel().len(), 2);
        assert_eq!(np.transform_info().len(), 7);
        assert_eq!(np.transform_hit(5.5, 5.5), "top-left");
        assert!(np.transform_nudge(1.0, 0.0));
        assert!(np.commit_session());
        assert!(!np.is_transforming());
    }

    #[test]
    fn adjustment_surface() {
        let mut np = NPaint::new(1, 1, "#ffffff").unwrap();
        assert_eq!(NPaint::adjustment_names().len(), Adjustment::NAMES.len());
        np.begin_adjustment().unwrap();
        np.preview_adjustment("invert", &[]).unwrap();
        assert!(np.preview_adjustment("nope", &[]).is_err());
        np.commit_session();
        assert_eq!(np.frame_copy()[..3], [0, 0, 0]);
        assert!(np.apply_adjustment("invert").unwrap());
        assert_eq!(np.frame_copy()[..3], [255, 255, 255]);
    }

    #[test]
    fn the_zoom_marquee_crosses_the_boundary_as_a_flat_array() {
        let mut np = NPaint::new(40, 40, "#ffffff").unwrap();
        np.set_view_size(400.0, 400.0);
        np.set_tool("zoom").unwrap();
        np.set_scrubby_zoom(false); // the marquee is the option now
        assert!(np.tool_overlay().is_empty());
        np.pointer_down(10.0, 10.0, false, false, 1.0);
        np.pointer_move(50.0, 30.0, false, false, false, 1.0);
        assert_eq!(np.tool_overlay(), vec![10.0, 10.0, 40.0, 20.0]);
        np.pointer_up(50.0, 30.0, false, false, 1.0);
        assert!(np.tool_overlay().is_empty());
        assert!(np.zoom() > 1.0, "the drag zoomed in on the box");
    }

    #[test]
    fn scrubby_zoom_is_on_unless_turned_off() {
        let mut np = NPaint::new(4, 4, "").unwrap();
        assert!(np.scrubby_zoom());
        np.set_scrubby_zoom(false);
        assert!(!np.scrubby_zoom());
    }

    #[test]
    fn the_wand_and_the_selection_commands_cross_the_boundary() {
        let mut np = NPaint::new(20, 20, "#ffffff").unwrap();
        np.set_tool("wand").unwrap();
        assert_eq!(np.tolerance(), 32);
        np.set_tolerance(0);
        np.pointer_down(5.0, 5.0, false, false, 1.0);
        np.pointer_up(5.0, 5.0, false, false, 1.0);
        // A blank sheet is all one colour, so the wand takes the lot — which
        // is the same as nothing being selected.
        assert!(np.selection_rect().is_empty());

        np.select_all();
        assert_eq!(np.selection_area(), 400);
        assert!(np.select_contract(4));
        assert_eq!(np.selection_rect(), vec![4, 4, 12, 12]);
        assert!(np.select_expand(2));
        // The edge moves out by two in every direction, so the corners come
        // back rounded — the bounding box grows by two, the area by less.
        assert_eq!(np.selection_rect(), vec![2, 2, 16, 16]);
        let inside = np.selection_area();
        assert!(inside > 12 * 12 && inside < 16 * 16);
        assert!(np.select_invert());
        assert_eq!(np.selection_area(), 400 - inside);
        assert!(!np.selection_contours().is_empty(), "there are ants to draw");
        assert!(np.select_feather(2));
        assert!(np.select_smooth(1));
    }

    #[test]
    fn sample_settings_round_trip_and_reject_nonsense() {
        let mut np = NPaint::new(4, 4, "#ffffff").unwrap();
        assert_eq!(np.sample_mode(), "contiguous");
        np.set_sample_mode("global").unwrap();
        assert_eq!(np.sample_mode(), "global");
        assert!(np.set_sample_mode("psychic").is_err());
        assert!(np.antialias());
        np.set_antialias(false);
        assert!(!np.antialias());
        assert!(!np.sample_all_layers());
        np.set_sample_all_layers(true);
        assert!(np.sample_all_layers());
        assert!(np.clone_aligned());
        np.set_clone_aligned(false);
        assert!(!np.clone_aligned());
        assert!(np.clone_anchor().is_empty(), "nothing to clone from yet");
    }

    #[test]
    fn selecting_the_subject_reports_whether_it_found_one() {
        let mut np = NPaint::new(80, 80, "#f0f0ee").unwrap();
        assert!(!np.select_subject(), "a blank sheet has no subject");
        let mut red = vec![0u8; 80 * 80 * 4];
        for y in 25..55 {
            for x in 25..55 {
                let i = (y * 80 + x) * 4;
                red[i] = 200;
                red[i + 1] = 60;
                red[i + 2] = 50;
                red[i + 3] = 255;
            }
        }
        np.add_layer_from_rgba("blob", 80, 80, &red).unwrap();
        np.set_sample_all_layers(true);
        assert!(np.select_subject());
        assert!(!np.selection_rect().is_empty());
    }

    /// Every operation that changes the document's size must leave the frame
    /// matching it: the page builds an `ImageData` of `width x height` from
    /// exactly these bytes, and a mismatch is a dead render loop.
    #[test]
    fn the_frame_always_matches_the_document_size() {
        let mut np = NPaint::new(20, 10, "#ffffff").unwrap();
        let matches = |np: &NPaint| np.frame_len() == (np.width() as usize) * (np.height() as usize) * 4;
        np.render();
        assert!(matches(&np));

        assert!(np.resize_canvas(40, 30, 5, 5));
        np.render();
        assert!(matches(&np), "after resizing the canvas");

        assert!(np.undo());
        np.render();
        assert!(matches(&np), "and after undoing it");

        np.rotate_canvas(1);
        np.render();
        assert!(matches(&np), "after rotating");

        np.new_document(7, 13, "#000000").unwrap();
        np.render();
        assert!(matches(&np), "after a new document");

        assert!(np.resize_image(14, 26));
        np.render();
        assert!(matches(&np), "after scaling the image");

        np.select_all();
        assert!(np.select_contract(2));
        assert!(np.crop_to_selection());
        np.render();
        assert!(matches(&np), "after cropping");

        assert!(np.history_go_to(0));
        np.render();
        assert!(matches(&np), "after jumping through the history");

        let saved = np.save_document();
        np.new_document(3, 3, "").unwrap();
        np.open_document(&saved).unwrap();
        np.render();
        assert!(matches(&np), "after opening a file");
        assert_eq!((np.width(), np.height()), (7, 13));
    }

    #[test]
    fn the_new_settings_and_commands_cross_the_boundary() {
        let mut np = NPaint::new(8, 8, "#ffffff").unwrap();
        assert_eq!(np.hardness(), 1.0);
        np.set_hardness(0.5);
        assert_eq!(np.hardness(), 0.5);
        assert_eq!(NPaint::blend_mode_names().len(), NPaint::blend_mode_labels().len());
        assert_eq!(np.layer_blend(0).unwrap(), "normal");
        np.set_layer_blend(0, "multiply").unwrap();
        assert_eq!(np.layer_blend(0).unwrap(), "multiply");
        assert!(np.set_layer_blend(0, "dissolve").is_err());
        np.set_layer_locked(0, true).unwrap();
        assert!(np.layer_locked(0).unwrap());
        np.set_layer_locked(0, false).unwrap();
        np.set_layer_lock_alpha(0, true).unwrap();
        assert!(np.layer_lock_alpha(0).unwrap());
        np.set_layer_lock_alpha(0, false).unwrap();
        assert!(np.is_modified());
        assert!(np.history_labels().len() >= 5);
        assert_eq!(np.history_position(), np.history_labels().len());
        np.set_history_limit(3);
        assert_eq!(np.history_limit(), 3);
        assert_eq!(np.history_labels().len(), 3);

        assert!(!np.has_clipboard());
        assert!(np.clipboard_size().is_empty());
        assert!(np.paste().is_none());
        np.select_all();
        assert!(np.copy_selection(true));
        assert_eq!(np.clipboard_size(), vec![8, 8]);
        assert_eq!(np.clipboard_rgba().len(), 8 * 8 * 4);
        assert_eq!(np.paste(), Some(1));
        assert!(np.cut_selection());
        assert!(np.paste_external("x", 2, 2, &[0u8; 16]).is_ok());
        assert!(np.paste_external("x", 2, 2, &[0u8; 3]).is_err());
        assert!(np.add_layer_centred("y", 1, 1, &[0u8; 4]).is_ok());

        np.select_all();
        assert!(np.stroke_selection(1));
        assert!(np.auto_levels(true));
        assert!(np.nudge_layer(1, 0));
        assert!(np.nudge_selection(1, 0));
        assert!(np.begin_transform_selection().is_ok());
        assert!(np.is_transforming_selection());
        assert!(np.transform_set_position(1.0, 1.0));
        assert!(np.transform_set_size(4.0, 4.0));
        assert!(np.transform_set_angle(0.0));
        assert!(np.commit_session());
        np.deselect();
        assert!(np.begin_transform_selection().is_err());
    }

    #[test]
    fn the_size_limits_reach_the_page() {
        let np = NPaint::new(4, 4, "#ffffff").unwrap();
        assert_eq!(np.max_side(), crate::editor::MAX_SIDE);
        assert!(np.max_pixels() > 1e6);
    }

    #[test]
    fn a_matte_crosses_the_boundary_as_bytes() {
        let mut np = NPaint::new(32, 32, "#ffffff").unwrap();
        let mut matte = vec![0u8; 8 * 8];
        for y in 2..6 {
            for x in 2..6 {
                matte[y * 8 + x] = 255;
            }
        }
        assert!(np.select_subject_from_matte(&matte, 8, 8));
        assert!(!np.selection_rect().is_empty());
        assert!(!np.select_subject_from_matte(&[7u8; 4], 8, 8), "a matte that is not the size it claims");
    }

    #[test]
    fn masks_cross_the_boundary() {
        let mut np = NPaint::new(2, 2, "#ff0000").unwrap();
        assert!(!np.layer_has_mask(0).unwrap());
        assert!(np.layer_mask_thumbnail(0, 2, 2).unwrap().is_empty());
        assert!(np.remove_layer_mask(0).is_err());
        np.select_all();
        np.select_contract(1);
        assert!(np.selection_rect().is_empty(), "a 2x2 contracted by one is nothing");
        np.add_layer_mask(0, false).unwrap();
        assert!(np.layer_has_mask(0).unwrap());
        assert!(np.layer_editing_mask(0).unwrap());
        assert_eq!(np.layer_mask_thumbnail(0, 1, 1).unwrap(), vec![255, 255, 255, 255]);
        np.set_layer_target(0, false).unwrap();
        assert!(!np.layer_editing_mask(0).unwrap());
        np.set_layer_target(0, true).unwrap();
        np.apply_adjustment("invert").unwrap();
        assert_eq!(np.frame_copy()[3], 0, "an all-black mask hides the layer");
        assert!(np.select_layer_mask(0).is_ok());
        np.set_layer_mask_enabled(0, false).unwrap();
        assert!(!np.layer_mask_enabled(0).unwrap());
        assert_eq!(np.frame_copy()[3], 255);
        np.apply_layer_mask(0).unwrap();
        assert!(!np.layer_has_mask(0).unwrap());
    }

    #[test]
    fn adjustment_layers_cross_the_boundary() {
        let mut np = NPaint::new(1, 1, "#ffffff").unwrap();
        assert_eq!(np.layer_kind(0).unwrap(), "pixels");
        assert_eq!(np.layer_adjustment_name(0).unwrap(), "");
        let i = np.add_adjustment_layer("levels", &[]).unwrap();
        assert_eq!(np.layer_kind(i).unwrap(), "adjustment");
        assert_eq!(np.layer_adjustment_name(i).unwrap(), "levels");
        assert_eq!(np.layer_adjustment_params(i).unwrap(), vec![0.0, 255.0, 1.0, 0.0], "black, white, gamma, and the channel");
        assert!(np.layer_thumbnail(i, 2, 2).unwrap().iter().all(|b| *b == 0), "no pixels to show");
        np.begin_adjustment_layer(i).unwrap();
        assert!(np.is_adjusting());
        np.preview_adjustment("invert", &[]).unwrap();
        assert!(np.commit_session());
        assert_eq!(np.layer_adjustment_name(i).unwrap(), "invert");
        assert_eq!(np.frame_copy()[..3], [0, 0, 0]);
        assert!(np.begin_adjustment_layer(0).is_err());
        assert!(np.add_adjustment_layer("sepia", &[]).is_err());
        np.set_tool("brush").unwrap();
        assert_eq!(np.edit_refusal(), "", "the mask is the target");
        np.set_layer_target(i, false).unwrap();
        assert!(!np.edit_refusal().is_empty());
    }

    #[test]
    fn smart_objects_cross_the_boundary() {
        let mut np = NPaint::new(4, 4, "").unwrap();
        let red = [255u8, 0, 0, 255].repeat(4);
        let i = np.place_smart_object("photo", 2, 2, &red).unwrap();
        assert_eq!(np.layer_kind(i).unwrap(), "smart");
        assert!(np.place_smart_object("x", 3, 3, &red).is_err(), "bytes that do not match");
        np.set_tool("brush").unwrap();
        assert!(!np.edit_refusal().is_empty());
        assert!(!np.pointer_down(2.0, 2.0, false, false, 1.0));
        np.begin_transform().unwrap();
        assert!(np.transform_nudge(1.0, 0.0));
        assert!(np.commit_session());
        assert_eq!(np.layer_kind(i).unwrap(), "smart");
        np.replace_smart_contents(i, 1, 1, &[0, 0, 255, 255]).unwrap();
        assert!(np.replace_smart_contents(0, 1, 1, &[0, 0, 255, 255]).is_err());
        np.rasterize_layer(i).unwrap();
        assert_eq!(np.layer_kind(i).unwrap(), "pixels");
        assert_eq!(np.edit_refusal(), "");
        np.convert_to_smart_object(i).unwrap();
        assert_eq!(np.layer_kind(i).unwrap(), "smart");
    }

    #[test]
    fn brush_tips_cross_the_boundary() {
        let mut np = NPaint::new(4, 4, "").unwrap();
        assert_eq!(np.brush_tip(), "round");
        assert!(np.brush_tip_has_hardness());
        np.set_brush_tip("spatter").unwrap();
        assert_eq!(np.brush_tip(), "spatter");
        assert!(!np.brush_tip_has_hardness());
        assert!(np.set_brush_tip("fan").is_err());
        assert_eq!(NPaint::brush_tip_names().len(), NPaint::brush_tip_labels().len());
        assert!(NPaint::brush_tip_names().contains(&"calligraphy".to_owned()));
    }

    #[test]
    fn gradient_settings_cross_the_boundary() {
        let mut np = NPaint::new(4, 4, "#ffffff").unwrap();
        assert_eq!(np.gradient_shape(), "linear");
        assert!(!np.gradient_reverse());
        np.set_gradient_shape("radial").unwrap();
        np.set_gradient_reverse(true);
        assert_eq!(np.gradient_shape(), "radial");
        assert!(np.gradient_reverse());
        assert!(np.set_gradient_shape("spiral").is_err());
        assert_eq!(NPaint::gradient_shape_names().len(), NPaint::gradient_shape_labels().len());
        assert!(NPaint::gradient_shape_names().contains(&"reflected".to_owned()));
    }

    #[test]
    fn the_gradient_editor_s_stops_cross_the_boundary() {
        let mut np = NPaint::new(4, 4, "#ffffff").unwrap();
        assert!(np.gradient_stops().is_empty(), "the swatches until the editor says otherwise");
        let stops = vec![0.0, 255.0, 0.0, 0.0, 255.0, 0.5, 0.0, 255.0, 0.0, 255.0, 1.0, 0.0, 0.0, 255.0, 0.0];
        np.set_gradient_stops(&stops);
        assert_eq!(np.gradient_stops(), stops);
        np.set_gradient_stops(&[]);
        assert!(np.gradient_stops().is_empty(), "emptied, it is the swatches again");
    }

    #[test]
    fn a_palette_can_be_taken_from_the_picture() {
        let mut np = NPaint::new(4, 4, "#ffffff").unwrap();
        np.set_color("#ff0000").unwrap();
        np.set_tool("pencil").unwrap();
        np.set_size(2);
        np.pointer_down(1.0, 1.0, false, false, 1.0);
        np.pointer_up(1.0, 1.0, false, false, 1.0);
        let palette = np.image_palette(8, 0.0);
        assert_eq!(palette.len() % 3, 0);
        assert_eq!(&palette[0..3], &[255.0, 255.0, 255.0], "most of the canvas is still white");
        assert!(palette[3..].as_chunks::<3>().0.iter().any(|c| c[0] > 240.0 && c[1] < 16.0), "and the red is in it: {palette:?}");
    }

    #[test]
    fn a_snapshot_is_the_file_without_the_save() {
        let mut np = NPaint::new(3, 3, "#ffffff").unwrap();
        np.set_tool("pencil").unwrap();
        np.pointer_down(1.0, 1.0, false, false, 1.0);
        np.pointer_up(1.0, 1.0, false, false, 1.0);
        assert!(np.is_modified());

        let snapshot = np.snapshot_document();
        assert!(np.is_modified(), "a recovery copy is not a save");

        let saved = np.save_document();
        assert!(!np.is_modified());
        assert_eq!(snapshot, saved, "and it is the same file either way");

        // And it opens.
        let mut other = NPaint::new(1, 1, "#000000").unwrap();
        other.open_document(&snapshot).unwrap();
        assert_eq!(other.width(), 3);
    }

    #[test]
    fn a_photoshop_file_crosses_the_boundary() {
        let mut np = NPaint::new(2, 2, "#ffffff").unwrap();
        assert!(np.open_psd(b"not one").unwrap_err().contains("not a Photoshop file"));
        // The frame still matches the document it refused to replace.
        assert_eq!(np.frame_len(), 2 * 2 * 4);
    }

    #[test]
    fn the_stroke_settings_and_character_settings_cross_the_boundary() {
        let mut np = NPaint::new(4, 4, "").unwrap();
        assert_eq!(np.symmetry(), vec![0, 0, 1]);
        np.set_symmetry(true, false, 99);
        assert_eq!(np.symmetry(), vec![1, 0, MAX_RADIAL]);
        np.set_smoothing(2.0);
        assert_eq!(np.smoothing(), 1.0);
        assert!(np.pressure_size());
        np.set_pressure_size(false);
        assert!(!np.pressure_size());
        assert_eq!(NPaint::text_param_names().len() * 2, NPaint::text_param_ranges().len());
        np.set_text_param("tracking", 100.0).unwrap();
        assert_eq!(np.text_param("tracking").unwrap(), 100.0);
        np.set_text_param("caps", 1.0).unwrap();
        assert_eq!(np.text_param("caps").unwrap(), 1.0);
        assert!(np.set_text_param("kerning", 1.0).is_err());
        assert!(np.text_param("kerning").is_err());
        np.set_text_outline_color("#ff0000").unwrap();
        assert_eq!(np.text_outline_color(), "#ff0000");
    }

    #[test]
    fn text_crosses_the_boundary() {
        let mut np = NPaint::new(8, 8, "").unwrap();
        np.set_text_font("serif");
        np.set_text_size(12.0);
        np.set_text_bold(true);
        np.set_text_italic(true);
        np.set_text_align("center").unwrap();
        assert!(np.set_text_align("justify").is_err());
        assert_eq!((np.text_font(), np.text_size(), np.text_bold(), np.text_italic(), np.text_align().as_str()), ("serif".to_owned(), 12.0, true, true, "center"));

        assert_eq!(np.text_layer_at(2.0, 2.0), -1);
        let i = np.begin_text_layer(2.0, 2.0).unwrap();
        assert_eq!(i, 1);
        assert!(np.is_editing_text());
        let red = [255u8, 0, 0, 255].repeat(4);
        assert!(np.preview_text("ab", 0.0, 0.0, 2, 2, &red).unwrap());
        assert!(np.preview_text("ab", 0.0, 0.0, 3, 3, &red).is_err(), "bytes that do not match");
        assert!(np.commit_session());
        assert!(!np.is_editing_text());
        assert_eq!(np.layer_kind(i).unwrap(), "text");
        assert_eq!(np.layer_text(i).unwrap(), "ab");
        assert_eq!(np.layer_text(0).unwrap(), "");
        assert_eq!(np.layer_text_origin(i).unwrap(), vec![0.0, 0.0]);
        assert!(np.layer_text_origin(0).unwrap().is_empty());
        assert_eq!(np.layer_placement(i).unwrap(), vec![1.0, 0.0, 1.0, 0.0, 1.0, 2.0, 0.0, 0.0, 1.0], "centred on the click");
        assert!(np.layer_placement(0).unwrap().is_empty());
        assert_eq!(np.text_layer_at(2.5, 2.5), 1);
        assert_eq!(np.text_layer_at(3.5, 3.5), -1, "past its right edge");
        assert!(np.layer_text(9).is_err());

        np.set_text_size(30.0);
        np.begin_text_edit(i).unwrap();
        assert_eq!(np.text_size(), 12.0, "the layer's style takes over");
        assert!(np.cancel_session());
        assert!(np.begin_text_edit(0).is_err(), "not a text layer");
        np.set_tool("text").unwrap();
        assert_eq!(np.tool(), "text");
        assert_eq!(np.edit_refusal(), "", "the text tool paints nothing, so nothing is refused");
    }

    #[test]
    fn reveal_all_grows_the_canvas_to_the_smart_object() {
        let mut np = NPaint::new(4, 4, "").unwrap();
        let red = [255u8, 0, 0, 255].repeat(4);
        np.place_smart_object("photo", 2, 2, &red).unwrap();
        assert!(!np.reveal_all(), "it starts wholly inside the canvas");
        np.begin_transform().unwrap();
        assert!(np.transform_nudge(3.0, 0.0));
        assert!(np.commit_session());
        assert_eq!(np.content_size(), vec![6, 4], "two columns of it hang off the right");
        assert!(np.reveal_all());
        assert_eq!((np.width(), np.height()), (6, 4));
        assert_eq!(np.frame_copy().len(), 6 * 4 * 4, "the frame follows the document");
        assert!(!np.reveal_all(), "nothing left outside");
    }

    #[test]
    fn opening_an_image_keeps_it_as_a_smart_object() {
        let mut np = NPaint::new(2, 2, "").unwrap();
        np.open_image("cat", 3, 2, &[255u8, 0, 0, 255].repeat(6)).unwrap();
        assert_eq!((np.width(), np.height()), (3, 2));
        assert_eq!(np.layer_kind(0).unwrap(), "smart");
        assert_eq!(np.frame_copy().len(), 3 * 2 * 4);
    }

    #[test]
    fn selection_rect_is_flat() {
        let mut np = NPaint::new(4, 4, "").unwrap();
        assert!(np.selection_rect().is_empty());
        np.select_all();
        assert_eq!(np.selection_rect(), vec![0, 0, 4, 4]);
    }
}
