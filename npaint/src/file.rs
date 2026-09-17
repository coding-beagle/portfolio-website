//! NPaint's own file: the whole document, layers and all, so that work can
//! be put down and picked up again. A flattened PNG loses the layers; this
//! keeps them.
//!
//! The format is a plain little-endian binary stream — a magic, a version,
//! the document's size, then each layer with everything in it — rather
//! than JSON or a zip, because the engine has no parser for either and the
//! pixels are the bulk of it anyway. The page compresses the stream on the
//! way to disk and inflates it on the way back, which is where the size
//! saving lives.
//!
//! Any field a future version adds goes at the end of the layer record,
//! after a length the reader can skip by; anything a reader does not
//! understand it can leave, so a field added there costs no version bump
//! and older builds still open the file. The first such field is the
//! clipping flag (one byte, non-zero for a layer clipped to the one below);
//! a file written before it has an empty block and reads back unclipped.
//! The second is the pixels the layer keeps off the canvas (one byte, and
//! if it is set the buffer's place as four `i32` and then the buffer); a
//! file written before it has none, which is what a layer that has never
//! been moved off the edge holds anyway.
//! After the layers comes a trailer with the guides, and after those, where
//! the symmetry axes were placed: one byte for whether they were placed at
//! all, then their crossing point and angle. The trailer is read as far as
//! the bytes go, so a file written before either part simply has none of it
//! — the first files have no trailer, and a reader from before the trailer
//! stops after the layers.
//!
//! # The version
//!
//! [`VERSION`] is written into every file and checked on the way back in: a
//! file from a *newer* NPaint is refused with [`FileError::Version`] rather
//! than misread. Older files are read by this build, so anything that
//! changes what the bytes mean bumps the number and says so here, and
//! [`load`] branches on the version it read.
//!
//! * **1** — the original: magic, version, size, the layers, the guides
//!   trailer.
//! * **2** — an adjustment layer's parameters may carry the colour channel
//!   it is aimed at, after the ones belonging to the adjustment itself. A
//!   format-1 adjustment has no such value and comes back aimed at RGB,
//!   which is what it always did, so nothing else changed on the wire.
//! * **3** — a fourth layer kind, `3`, the text layer: a smart object's
//!   source and placement as kind `2` writes them, then the text, its font
//!   name, size, bold, italic, alignment, colour and origin. Kind `2` is
//!   unchanged; a format-2 file simply has no kind `3` in it.
//! * **4** — the Character panel: after a text layer's origin come its
//!   tracking, leading, horizontal and vertical scale, caps, underline,
//!   strikethrough, outline width and colour, and shadow. A format-3 text
//!   layer has none of these and comes back with the defaults.
//! * **5** — layer groups. Each layer record carries, after its target
//!   flag, the id of the group it is in (0 for none) and whether that
//!   group is collapsed in the panel; and a fifth layer kind, `4`, the
//!   group itself, which has no pixels and writes nothing after the kind
//!   byte. A format-4 file has no groups, so every layer reads back at the
//!   top level, which is exactly what it was.
//! * **6** — a smart object's placement is a projective transform, written
//!   as the nine numbers of its matrix rather than the six of an affine, so
//!   that an object put in perspective by a 3D transform keeps it. A
//!   format-5 placement is those six, read as the affine it was.

use crate::adjust::Adjustment;
use crate::blend::BlendMode;
use crate::document::Document;
use crate::geometry::{Point, Rect};
use crate::layer::{Layer, LayerId, LayerKind, Offscreen, SmartObject, Target};
use crate::raster::Raster;
use crate::snap::Guides;
use crate::text::{TextAlign, TextObject, TextStyle};
use crate::tools::SymmetryFrame;
use crate::transform::{Affine, Projective};

const MAGIC: &[u8; 6] = b"NPAINT";
/// The format this build writes. See the module's version history.
pub const VERSION: u16 = 6;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FileError {
    /// Not an NPaint file at all.
    NotNPaint,
    /// A newer version than this build reads.
    Version(u16),
    /// The stream ended, or a field made no sense.
    Corrupt(&'static str),
}

impl std::fmt::Display for FileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FileError::NotNPaint => f.write_str("this is not an NPaint file"),
            FileError::Version(v) => write!(f, "this file was saved by a newer NPaint (format {v})"),
            FileError::Corrupt(what) => write!(f, "the file is damaged ({what})"),
        }
    }
}

impl std::error::Error for FileError {}

// ---- Writing --------------------------------------------------------------------

struct Writer {
    out: Vec<u8>,
}

impl Writer {
    fn u8(&mut self, v: u8) {
        self.out.push(v);
    }

    fn u16(&mut self, v: u16) {
        self.out.extend_from_slice(&v.to_le_bytes());
    }

    fn u32(&mut self, v: u32) {
        self.out.extend_from_slice(&v.to_le_bytes());
    }

    fn i32(&mut self, v: i32) {
        self.out.extend_from_slice(&v.to_le_bytes());
    }

    fn f32(&mut self, v: f32) {
        self.out.extend_from_slice(&v.to_le_bytes());
    }

    fn f64(&mut self, v: f64) {
        self.out.extend_from_slice(&v.to_le_bytes());
    }

    fn str(&mut self, s: &str) {
        self.u32(s.len() as u32);
        self.out.extend_from_slice(s.as_bytes());
    }

    fn raster(&mut self, r: &Raster) {
        self.u32(r.width());
        self.u32(r.height());
        self.out.extend_from_slice(&r.to_rgba_bytes());
    }

    /// A placement. Format 5 and before could only say affine things, so a
    /// file written as one of those loses whatever perspective it had.
    fn placement(&mut self, m: &Projective, version: u16) {
        if version >= 6 {
            for v in m.m {
                self.f64(v);
            }
            return;
        }
        let a = m.as_affine().unwrap_or(Affine::IDENTITY);
        for v in [a.a, a.b, a.c, a.d, a.e, a.f] {
            self.f64(v);
        }
    }

    fn text(&mut self, t: &TextObject, version: u16) {
        self.str(&t.text);
        self.str(&t.style.font);
        self.f64(t.style.size);
        self.u8(u8::from(t.style.bold));
        self.u8(u8::from(t.style.italic));
        self.u8(t.style.align.anchor_index());
        for v in [t.color.r, t.color.g, t.color.b, t.color.a] {
            self.u8(v);
        }
        self.f64(t.origin.x);
        self.f64(t.origin.y);
        if version < 4 {
            return;
        }
        let s = &t.style;
        for v in [s.tracking, s.leading, s.scale_x, s.scale_y] {
            self.f64(v);
        }
        for v in [s.caps, s.underline, s.strike] {
            self.u8(u8::from(v));
        }
        self.f64(s.outline);
        for v in [s.outline_color.r, s.outline_color.g, s.outline_color.b, s.outline_color.a] {
            self.u8(v);
        }
        self.f64(s.shadow);
    }
}

/// The document, its guides and its symmetry axes as NPaint file bytes.
pub fn save(doc: &Document, guides: &Guides, symmetry: SymmetryFrame) -> Vec<u8> {
    save_as(doc, guides, symmetry, VERSION)
}

/// [`save`] in an older format, for testing that older files still open;
/// what an older version cannot carry is left out.
fn save_as(doc: &Document, guides: &Guides, symmetry: SymmetryFrame, version: u16) -> Vec<u8> {
    let mut w = Writer { out: Vec::new() };
    w.out.extend_from_slice(MAGIC);
    w.u16(version);
    w.u32(doc.width());
    w.u32(doc.height());
    w.u32(doc.active_index() as u32);
    w.u32(doc.layers().len() as u32);
    for layer in doc.layers() {
        w.u32(layer.id().0);
        w.str(&layer.name);
        w.u8(u8::from(layer.visible));
        w.f32(layer.opacity);
        w.str(layer.blend.name());
        w.u8(u8::from(layer.locked));
        w.u8(u8::from(layer.lock_alpha));
        w.u8(u8::from(layer.mask_enabled));
        w.u8(u8::from(layer.target == Target::Mask));
        if version >= 5 {
            // 0 is not a layer id — they are handed out from 1 — so it is
            // free to mean "not in a group".
            w.u32(layer.parent.map_or(0, |id| id.0));
            w.u8(u8::from(layer.collapsed));
        }
        match &layer.kind {
            LayerKind::Pixels => {
                w.u8(0);
                w.raster(&layer.raster);
            }
            LayerKind::Adjustment(adjustment) => {
                w.u8(1);
                w.str(adjustment.name());
                let params = adjustment.params();
                w.u32(params.len() as u32);
                for p in params {
                    w.f32(p);
                }
            }
            // A group is its own row and its children's `parent`; there is
            // nothing else to write. A format before groups has no kind for
            // one, so it goes down as the empty layer it draws as.
            LayerKind::Group if version >= 5 => w.u8(4),
            LayerKind::Group => {
                w.u8(0);
                w.raster(&Raster::new(doc.width(), doc.height()));
            }
            LayerKind::Smart(object) => {
                w.u8(if object.text.is_some() { 3 } else { 2 });
                w.raster(&object.source);
                w.placement(&object.transform, version);
                if let Some(text) = &object.text {
                    w.text(text, version);
                }
            }
        }
        match &layer.mask {
            Some(mask) => {
                w.u8(1);
                w.raster(mask);
            }
            None => w.u8(0),
        }
        // The block a reader too old for these may skip; see the module.
        let mut extra = Writer { out: Vec::new() };
        extra.u8(u8::from(layer.clipped));
        match &layer.offscreen {
            Some(offscreen) => {
                extra.u8(1);
                extra.i32(offscreen.rect.x);
                extra.i32(offscreen.rect.y);
                extra.i32(offscreen.rect.w);
                extra.i32(offscreen.rect.h);
                extra.raster(&offscreen.raster);
            }
            None => extra.u8(0),
        }
        w.u32(extra.out.len() as u32);
        w.out.extend_from_slice(&extra.out);
    }
    for axis in [&guides.h, &guides.v] {
        w.u32(axis.len() as u32);
        for &at in axis {
            w.f64(at);
        }
    }
    let origin = symmetry.origin.unwrap_or_default();
    w.u8(u8::from(symmetry.origin.is_some()));
    w.f64(origin.x);
    w.f64(origin.y);
    w.f64(symmetry.angle);
    w.out
}

// ---- Reading --------------------------------------------------------------------

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn take(&mut self, n: usize) -> Result<&[u8], FileError> {
        let end = self.at.checked_add(n).ok_or(FileError::Corrupt("length overflow"))?;
        let slice = self.bytes.get(self.at..end).ok_or(FileError::Corrupt("unexpected end of file"))?;
        self.at = end;
        Ok(slice)
    }

    fn u8(&mut self) -> Result<u8, FileError> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, FileError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().expect("two bytes")))
    }

    fn u32(&mut self) -> Result<u32, FileError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().expect("four bytes")))
    }

    fn i32(&mut self) -> Result<i32, FileError> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().expect("four bytes")))
    }

    fn f32(&mut self) -> Result<f32, FileError> {
        Ok(f32::from_le_bytes(self.take(4)?.try_into().expect("four bytes")))
    }

    fn f64(&mut self) -> Result<f64, FileError> {
        Ok(f64::from_le_bytes(self.take(8)?.try_into().expect("eight bytes")))
    }

    fn str(&mut self) -> Result<String, FileError> {
        let n = self.u32()? as usize;
        String::from_utf8(self.take(n)?.to_vec()).map_err(|_| FileError::Corrupt("text is not UTF-8"))
    }

    fn raster(&mut self) -> Result<Raster, FileError> {
        let w = self.u32()?;
        let h = self.u32()?;
        let n = (w as usize).checked_mul(h as usize).and_then(|n| n.checked_mul(4)).ok_or(FileError::Corrupt("raster too big"))?;
        Raster::from_rgba_bytes(w, h, self.take(n)?).ok_or(FileError::Corrupt("raster bytes"))
    }

    fn placement(&mut self, version: u16) -> Result<Projective, FileError> {
        if version >= 6 {
            let mut m = [0.0; 9];
            for v in m.iter_mut() {
                *v = self.f64()?;
            }
            return Ok(Projective { m });
        }
        let a = Affine { a: self.f64()?, b: self.f64()?, c: self.f64()?, d: self.f64()?, e: self.f64()?, f: self.f64()? };
        Ok(a.into())
    }

    fn text(&mut self, version: u16) -> Result<TextObject, FileError> {
        let text = self.str()?;
        let font = self.str()?;
        let mut style = TextStyle { font, ..TextStyle::default() };
        style.set_size(self.f64()?);
        style.bold = self.u8()? != 0;
        style.italic = self.u8()? != 0;
        style.align = TextAlign::from_anchor_index(self.u8()?).ok_or(FileError::Corrupt("text alignment"))?;
        let color = crate::color::Rgba::new(self.u8()?, self.u8()?, self.u8()?, self.u8()?);
        let origin = crate::geometry::Point::new(self.f64()?, self.f64()?);
        if !origin.x.is_finite() || !origin.y.is_finite() {
            return Err(FileError::Corrupt("text origin"));
        }
        if version >= 4 {
            for name in ["tracking", "leading", "scale_x", "scale_y"] {
                let v = self.f64()?;
                style.set_param(name, v).expect("a known setting");
            }
            for name in ["caps", "underline", "strike"] {
                let v = self.u8()?;
                style.set_param(name, f64::from(v)).expect("a known setting");
            }
            let outline = self.f64()?;
            style.set_param("outline", outline).expect("a known setting");
            style.outline_color = crate::color::Rgba::new(self.u8()?, self.u8()?, self.u8()?, self.u8()?);
            let shadow = self.f64()?;
            style.set_param("shadow", shadow).expect("a known setting");
        }
        Ok(TextObject { text, style, color, origin })
    }
}

/// The pixels a layer keeps off the canvas, out of the layer record's extra
/// block, or `None` from a file written before there were any. A block that
/// does not parse is not worth refusing the whole file over — the picture
/// itself is in the fields ahead of it — so it comes back empty instead.
fn read_offscreen(extra: &[u8]) -> Option<Offscreen> {
    // Byte 0 is the clipping flag, which the caller has already read.
    let mut r = Reader { bytes: extra, at: 1 };
    if r.u8().ok()? == 0 {
        return None;
    }
    let rect = Rect::new(r.i32().ok()?, r.i32().ok()?, r.i32().ok()?, r.i32().ok()?);
    let raster = r.raster().ok()?;
    let size = (raster.width() as i32, raster.height() as i32);
    ((rect.w, rect.h) == size).then(|| Offscreen::new(rect, raster))
}

/// A document, its guides and its symmetry axes from NPaint file bytes. The
/// guides come back with snapping off; that is the editor's setting, not the
/// file's.
pub fn load(bytes: &[u8]) -> Result<(Document, Guides, SymmetryFrame), FileError> {
    let mut r = Reader { bytes, at: 0 };
    if r.take(MAGIC.len()).map_err(|_| FileError::NotNPaint)? != MAGIC {
        return Err(FileError::NotNPaint);
    }
    let version = r.u16()?;
    if version > VERSION {
        return Err(FileError::Version(version));
    }
    let width = r.u32()?;
    let height = r.u32()?;
    if !crate::editor::canvas_fits(width, height) {
        return Err(FileError::Corrupt("document size"));
    }
    let active = r.u32()? as usize;
    let count = r.u32()? as usize;
    if count == 0 || count > 10_000 {
        return Err(FileError::Corrupt("layer count"));
    }
    let mut layers = Vec::with_capacity(count);
    for _ in 0..count {
        let id = LayerId(r.u32()?);
        let name = r.str()?;
        let visible = r.u8()? != 0;
        let opacity = r.f32()?;
        let blend = BlendMode::from_name(&r.str()?).unwrap_or_default();
        let locked = r.u8()? != 0;
        let lock_alpha = r.u8()? != 0;
        let mask_enabled = r.u8()? != 0;
        let on_mask = r.u8()? != 0;
        let (parent, collapsed) = if version >= 5 {
            let parent = r.u32()?;
            (if parent == 0 { None } else { Some(LayerId(parent)) }, r.u8()? != 0)
        } else {
            (None, false)
        };
        let (kind, raster) = match r.u8()? {
            0 => {
                let raster = r.raster()?;
                (LayerKind::Pixels, raster)
            }
            1 => {
                let name = r.str()?;
                let n = r.u32()? as usize;
                let mut params = Vec::with_capacity(n.min(1024));
                for _ in 0..n {
                    params.push(r.f32()?);
                }
                let adjustment = Adjustment::from_params(&name, &params).map_err(|_| FileError::Corrupt("adjustment"))?;
                (LayerKind::Adjustment(adjustment), Raster::new(0, 0))
            }
            kind @ (2 | 3) => {
                let source = r.raster()?;
                let transform = r.placement(version)?;
                let mut object = SmartObject::new(source, transform);
                if kind == 3 {
                    object.text = Some(r.text(version)?);
                }
                let raster = object.render(width, height);
                (LayerKind::Smart(object), raster)
            }
            4 => (LayerKind::Group, Raster::new(0, 0)),
            _ => return Err(FileError::Corrupt("layer kind")),
        };
        if matches!(kind, LayerKind::Pixels) && (raster.width(), raster.height()) != (width, height) {
            return Err(FileError::Corrupt("layer size"));
        }
        let mask = if r.u8()? != 0 {
            let mask = r.raster()?;
            if (mask.width(), mask.height()) != (width, height) {
                return Err(FileError::Corrupt("mask size"));
            }
            Some(mask)
        } else {
            None
        };
        let extra_len = r.u32()? as usize;
        let extra = r.take(extra_len)?;
        let clipped = extra.first().is_some_and(|&b| b != 0);
        let offscreen = read_offscreen(extra);

        let mut layer = Layer::new(id, name, raster);
        layer.visible = visible;
        layer.set_opacity(opacity);
        layer.blend = blend;
        layer.locked = locked;
        layer.lock_alpha = lock_alpha;
        layer.kind = kind;
        layer.mask = mask;
        layer.mask_enabled = mask_enabled;
        layer.set_target(if on_mask { Target::Mask } else { Target::Pixels });
        layer.parent = parent;
        layer.collapsed = collapsed;
        layer.clipped = clipped;
        layer.offscreen = offscreen;
        layers.push(layer);
    }
    // `from_parts` also checks that the groups nest the way the stack
    // expects: a file whose parents point anywhere else is damaged.
    let doc = Document::from_parts(width, height, layers, active).ok_or(FileError::Corrupt("layer ids or grouping"))?;
    let mut guides = Guides::default();
    if r.at < bytes.len() {
        for axis in [&mut guides.h, &mut guides.v] {
            let n = r.u32()? as usize;
            if n > 10_000 {
                return Err(FileError::Corrupt("guide count"));
            }
            for _ in 0..n {
                axis.push(r.f64()?);
            }
        }
    }
    let mut symmetry = SymmetryFrame::default();
    if r.at < bytes.len() {
        let placed = r.u8()? != 0;
        let origin = Point::new(r.f64()?, r.f64()?);
        symmetry = SymmetryFrame { origin: placed.then_some(origin), angle: r.f64()? };
    }
    Ok((doc, guides, symmetry))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::Rgba;
    use crate::geometry::Rect;
    use crate::mask::Mask;

    const RED: Rgba = Rgba::opaque(255, 0, 0);

    /// One of everything: pixels with a mask and a lock, an adjustment
    /// layer with settings, a smart object moved off its start. When a
    /// feature adds something to the file, add it here too: the round-trip
    /// and fixed-point tests below then cover it without further work.
    fn document() -> Document {
        let mut doc = Document::new(6, 4, Rgba::WHITE);
        doc.active_layer_mut().raster.set(1, 1, RED);
        doc.active_layer_mut().lock_alpha = true;
        doc.add_layer();
        doc.active_layer_mut().raster.set(2, 2, Rgba::new(0, 0, 255, 77));
        doc.active_layer_mut().name = "Ünïcode ✓".to_owned();
        doc.active_layer_mut().blend = BlendMode::Multiply;
        doc.active_layer_mut().set_opacity(0.4);
        doc.active_layer_mut().visible = false;
        doc.active_layer_mut().locked = true;
        doc.add_mask(1, Some(Mask::from_rect(6, 4, Rect::new(0, 0, 3, 4))), false).unwrap();
        doc.set_mask_enabled(1, false).unwrap();
        // A curve aimed at one channel: the points and then the channel.
        doc.add_adjustment_layer(Adjustment::from_params("curves", &[0.0, 0.0, 100.0, 150.0, 255.0, 255.0, 2.0]).unwrap(), None);
        doc.place_smart_object("photo", Raster::filled(2, 2, Rgba::BLACK));
        doc.set_smart_transform(3, Affine::translation(3.0, 1.0).into()).unwrap();
        // A text layer, in a style that is nothing like the default.
        let text = TextObject {
            text: "Hi\nthere ✓".to_owned(),
            style: TextStyle {
                font: "Georgia, serif".to_owned(),
                size: 13.5,
                bold: true,
                italic: true,
                align: TextAlign::Center,
                tracking: 50.0,
                leading: 1.5,
                scale_x: 1.25,
                scale_y: 0.8,
                caps: true,
                underline: true,
                strike: false,
                outline: 2.0,
                outline_color: Rgba::new(1, 2, 3, 4),
                shadow: 3.0,
            },
            color: Rgba::new(10, 20, 30, 200),
            origin: crate::geometry::Point::new(2.0, 3.0),
        };
        doc.add_text_layer(text, Raster::filled(3, 2, RED), crate::geometry::Point::new(1.0, 1.0));
        // A group over the top two layers, folded shut, so the round trip
        // covers the nesting as well as the layers.
        let group = doc.group_layer(4, Some("Folder")).unwrap();
        doc.set_collapsed(group, true).unwrap();
        doc.layer_mut(group).unwrap().set_opacity(0.4);
        // A clipped layer, so the round trip covers the flag in the layer
        // record's extra block, and pixels kept off the canvas, which are
        // the rest of that block.
        doc.layer_mut(1).unwrap().clipped = true;
        doc.layer_mut(0).unwrap().offscreen = Some(Offscreen::new(Rect::new(-3, 2, 2, 1), Raster::filled(2, 1, RED)));
        doc.set_active(1).unwrap();
        doc
    }

    #[test]
    fn a_document_survives_the_round_trip_exactly() {
        let doc = document();
        let guides = Guides { h: vec![10.0, 25.5], v: vec![3.0], enabled: true };
        let axes = SymmetryFrame { origin: Some(Point::new(3.5, 4.0)), angle: 0.5 };
        let bytes = save(&doc, &guides, axes);
        assert_eq!(&bytes[..6], b"NPAINT");
        let (back, back_guides, back_axes) = load(&bytes).unwrap();
        assert_eq!(back, doc);
        let adjustment = back.layers()[2].adjustment().expect("the adjustment layer");
        assert_eq!(adjustment.channel, crate::adjust::Channel::Green, "the channel came back with it");
        assert_eq!((back_guides.h, back_guides.v), (guides.h, guides.v));
        assert_eq!(back_axes, axes, "where the symmetry axes were placed travels with the file");
        // And it keeps working as a document: new ids do not collide.
        let mut back = back;
        let i = back.add_layer();
        let ids: Vec<u32> = back.layers().iter().map(|l| l.id().0).collect();
        let fresh = ids[i];
        assert_eq!(ids.iter().filter(|id| **id == fresh).count(), 1);
    }

    /// Load then save must give the bytes back unchanged, so that opening a
    /// file and saving it again never drifts, however many times it happens.
    #[test]
    fn opening_and_resaving_is_a_fixed_point() {
        let guides = Guides { h: vec![10.0, 25.5], v: vec![3.0], enabled: false };
        let axes = SymmetryFrame { origin: Some(Point::new(1.0, 2.0)), angle: -0.25 };
        let first = save(&document(), &guides, axes);
        let (doc, guides, axes) = load(&first).unwrap();
        let second = save(&doc, &guides, axes);
        assert_eq!(second, first);
        let (again, ..) = load(&second).unwrap();
        assert_eq!(again, doc);
    }

    #[test]
    fn a_file_from_before_the_trailer_opens_without_it() {
        let axes = SymmetryFrame { origin: Some(Point::new(1.0, 2.0)), angle: 0.0 };
        let bytes = save(&document(), &Guides::default(), axes);
        // The trailer is two empty guide counts and then the axes; a file
        // from before either part ends where that part starts.
        const AXES_BYTES: usize = 1 + 8 * 3;
        let without_axes = &bytes[..bytes.len() - AXES_BYTES];
        let (_, _, none) = load(without_axes).unwrap();
        assert_eq!(none, SymmetryFrame::default(), "axes that were never written are not placed");
        let first_version = &without_axes[..without_axes.len() - 8];
        let (_, guides, _) = load(first_version).unwrap();
        assert!(guides.h.is_empty() && guides.v.is_empty());
    }

    #[test]
    fn a_placement_in_perspective_survives_the_round_trip() {
        use crate::geometry::Point;
        use crate::transform::Projective;
        let mut doc = document();
        let object = doc.layer(3).unwrap().smart_object().expect("the smart object");
        let (w, h) = (f64::from(object.source.width()), f64::from(object.source.height()));
        let square = [Point::new(0.0, 0.0), Point::new(w, 0.0), Point::new(w, h), Point::new(0.0, h)];
        // A trapezoid: the top edge pulled in, as a plane turned away would
        // leave it. Nothing affine can say this.
        let quad = [Point::new(2.0, 0.0), Point::new(w - 2.0, 0.0), Point::new(w, h), Point::new(0.0, h)];
        let placement = Projective::from_quad(square, quad).unwrap();
        assert!(placement.as_affine().is_none());
        doc.set_smart_transform(3, placement).unwrap();
        let (back, ..) = load(&save(&doc, &Guides::default(), SymmetryFrame::default())).unwrap();
        assert_eq!(back.layer(3).unwrap().smart_object().unwrap().transform, placement);
        // Written as a format-5 file there is nowhere to put it, and the
        // object comes back placed as squarely as that format could say.
        let (older, ..) = load(&save_as(&doc, &Guides::default(), SymmetryFrame::default(), 5)).unwrap();
        assert!(older.layer(3).unwrap().smart_object().unwrap().transform.as_affine().is_some());
    }

    #[test]
    fn a_file_from_an_older_format_still_opens() {
        let bytes = save(&document(), &Guides::default(), SymmetryFrame::default());
        assert_eq!(u16::from_le_bytes([bytes[6], bytes[7]]), VERSION, "the version is written where the reader looks");
        // Every format up to this one is still read. What changed between 1
        // and 2 is only what an adjustment's parameters may say, and an
        // older one that says nothing about a channel comes back on RGB
        // (see `adjust`); 3 added a layer kind; 4 added the Character
        // panel's settings after a text layer, which come back as the
        // defaults from a format-3 file; 5 added groups, and a file older
        // than that has none, so every layer comes back at the top level;
        // 6 made a placement projective, and an older one is the affine it
        // always was.
        for older in 1..VERSION {
            let bytes = save_as(&document(), &Guides::default(), SymmetryFrame::default(), older);
            let (doc, ..) = load(&bytes).expect("an older file still opens");
            assert_eq!(doc.layers().len(), document().layers().len(), "format {older}");
            let text = doc.layers()[4].text().expect("the text layer");
            assert_eq!(text.text, "Hi\nthere ✓", "format {older}");
            if older < 4 {
                assert_eq!(text.style.leading, 1.2, "format {older}: the default, not the 1.5 a newer file keeps");
            }
            if older < 5 {
                assert!(doc.layers().iter().all(|l| l.parent.is_none()), "format {older} has no groups in it");
            }
            let placed = doc.layers()[3].smart_object().expect("the smart object");
            assert!(placed.transform.as_affine().is_some(), "format {older} places affinely");
        }
        let (doc, ..) = load(&bytes).unwrap();
        assert_eq!(doc.layers()[4].text().unwrap().style.leading, 1.5);
    }

    #[test]
    fn other_files_and_broken_ones_are_refused_politely() {
        assert_eq!(load(b"\x89PNG\r\n"), Err(FileError::NotNPaint));
        assert_eq!(load(b""), Err(FileError::NotNPaint));
        let bytes = save(&document(), &Guides::default(), SymmetryFrame::default());
        assert!(matches!(load(&bytes[..bytes.len() / 2]), Err(FileError::Corrupt(_))), "cut short");
        let mut newer = bytes.clone();
        newer[6] = 99;
        assert_eq!(load(&newer), Err(FileError::Version(99)));
        let mut wrong_size = bytes.clone();
        wrong_size[8] = 0; // width low byte: a 0-wide document
        assert!(load(&wrong_size).is_err());
        assert!(!FileError::Corrupt("x").to_string().is_empty());
    }
}
