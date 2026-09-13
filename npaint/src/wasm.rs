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
use crate::color::Rgba;
use crate::editor::Editor;
use crate::transform::{Handle, Hit};
use crate::geometry::Point;
use crate::raster::Raster;
use crate::tools::ToolKind;

#[wasm_bindgen]
pub struct NPaint {
    editor: Editor,
    frame: Raster,
    frame_bytes: Vec<u8>,
}

/// Errors cross the boundary as plain strings, which JavaScript receives as a
/// thrown value. `JsError` would do the same but cannot be constructed off
/// wasm, and this module's tests run natively.
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

    /// Recomposites if anything changed since the last call. Returns whether
    /// it did, so the page can skip the `putImageData`.
    pub fn render(&mut self) -> bool {
        if !self.editor.take_dirty() {
            return false;
        }
        self.editor.composite_into(&mut self.frame);
        self.frame.write_rgba_bytes(&mut self.frame_bytes);
        true
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

    /// The composite as a fresh byte array, for export.
    pub fn frame_copy(&mut self) -> Vec<u8> {
        self.editor.take_dirty();
        self.editor.composite_into(&mut self.frame);
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

    pub fn set_fill(&mut self, fill: bool) {
        self.editor.settings_mut().fill = fill;
    }

    pub fn fill(&self) -> bool {
        self.editor.settings().fill
    }

    // ---- Pointer -------------------------------------------------------------
    //
    // Screen coordinates, in CSS pixels relative to the canvas.

    pub fn pointer_down(&mut self, x: f64, y: f64, shift: bool, alt: bool) -> bool {
        self.editor.pointer_down(Point::new(x, y), shift, alt)
    }

    pub fn pointer_move(&mut self, x: f64, y: f64, shift: bool, alt: bool) -> bool {
        self.editor.pointer_move(Point::new(x, y), shift, alt)
    }

    pub fn pointer_up(&mut self, x: f64, y: f64, shift: bool, alt: bool) -> bool {
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

    /// A small RGBA thumbnail of one layer, `w` by `h`, nearest-neighbour.
    pub fn layer_thumbnail(&self, index: usize, w: u32, h: u32) -> Result<Vec<u8>, String> {
        let raster = &self.layer(index)?.raster;
        let mut out = Vec::with_capacity((w * h * 4) as usize);
        for y in 0..h {
            let sy = (u64::from(y) * u64::from(raster.height()) / u64::from(h.max(1))) as i32;
            for x in 0..w {
                let sx = (u64::from(x) * u64::from(raster.width()) / u64::from(w.max(1))) as i32;
                let p = raster.get(sx, sy);
                out.extend_from_slice(&[p.r, p.g, p.b, p.a]);
            }
        }
        Ok(out)
    }

    fn layer(&self, index: usize) -> Result<&crate::layer::Layer, String> {
        self.editor.document().layer(index).ok_or_else(|| "no such layer".to_owned())
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

    pub fn duplicate_layer(&mut self, index: usize) -> Result<usize, String> {
        self.editor.duplicate_layer(index).map_err(err)
    }

    pub fn remove_layer(&mut self, index: usize) -> Result<(), String> {
        self.editor.remove_layer(index).map_err(err)
    }

    pub fn move_layer(&mut self, from: usize, to: usize) -> Result<(), String> {
        self.editor.move_layer(from, to).map_err(err)
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

    /// The eight handles as `[x0, y0, x1, y1, ...]` in screen pixels, in the
    /// order top-left, top, top-right, right, bottom-right, bottom,
    /// bottom-left, left. Empty when not transforming.
    pub fn transform_handles(&self) -> Vec<f64> {
        match self.editor.transform_handles() {
            Some(h) => h.iter().flat_map(|p| [p.x, p.y]).collect(),
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
    /// (`"top-left"`, `"top"`, ...), `"inside"`, `"rotate"` or `"outside"`.
    /// Empty when not transforming.
    pub fn transform_hit(&self, x: f64, y: f64) -> String {
        match self.editor.transform_hit(Point::new(x, y)) {
            None => String::new(),
            Some(Hit::Inside) => "inside".to_owned(),
            Some(Hit::Rotate) => "rotate".to_owned(),
            Some(Hit::Outside) => "outside".to_owned(),
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
        assert!(np.render());
        assert!(!np.render(), "nothing changed");
        assert_eq!(np.frame_len(), 16);
        assert_eq!(np.frame_copy()[..4], [255, 0, 0, 255]);
        np.set_tool("pencil").unwrap();
        np.set_color("#0000ff").unwrap();
        np.set_size(1);
        np.pointer_down(0.0, 0.0, false, false);
        np.pointer_up(0.0, 0.0, false, false);
        assert!(np.render());
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
        assert!(np.set_tool("lasso").is_err());
        assert_eq!(np.tool(), "brush");
    }

    #[test]
    fn rotating_the_canvas_resizes_the_frame_and_undo_restores_it() {
        let mut np = NPaint::new(3, 2, "#ffffff").unwrap();
        np.rotate_canvas(1);
        assert_eq!((np.width(), np.height()), (2, 3));
        assert!(np.render());
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
        np.pointer_down(5.0, 5.0, false, false);
        np.pointer_up(5.0, 5.0, false, false);
        np.begin_transform().unwrap();
        assert_eq!(np.transform_handles().len(), 16);
        assert_eq!(np.transform_info().len(), 7);
        assert_eq!(np.transform_hit(5.5, 5.5), "top-left");
        assert!(np.transform_nudge(1.0, 0.0));
        assert!(np.commit_session());
        assert!(!np.is_transforming());
    }

    #[test]
    fn adjustment_surface() {
        let mut np = NPaint::new(1, 1, "#ffffff").unwrap();
        assert_eq!(NPaint::adjustment_names().len(), 7);
        np.begin_adjustment().unwrap();
        np.preview_adjustment("invert", &[]).unwrap();
        assert!(np.preview_adjustment("nope", &[]).is_err());
        np.commit_session();
        assert_eq!(np.frame_copy()[..3], [0, 0, 0]);
        assert!(np.apply_adjustment("invert").unwrap());
        assert_eq!(np.frame_copy()[..3], [255, 255, 255]);
    }

    #[test]
    fn selection_rect_is_flat() {
        let mut np = NPaint::new(4, 4, "").unwrap();
        assert!(np.selection_rect().is_empty());
        np.select_all();
        assert_eq!(np.selection_rect(), vec![0, 0, 4, 4]);
    }
}
