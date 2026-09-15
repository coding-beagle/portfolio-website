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
//! understand it can leave. After the layers comes a trailer with the
//! guides; a file without one (the first files written) simply has none,
//! and a reader from before the trailer stops after the layers.
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

use crate::adjust::Adjustment;
use crate::blend::BlendMode;
use crate::document::Document;
use crate::layer::{Layer, LayerId, LayerKind, SmartObject, Target};
use crate::raster::Raster;
use crate::snap::Guides;
use crate::text::{TextAlign, TextObject, TextStyle};
use crate::transform::Affine;

const MAGIC: &[u8; 6] = b"NPAINT";
/// The format this build writes. See the module's version history.
pub const VERSION: u16 = 4;

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

    fn affine(&mut self, m: &Affine) {
        for v in [m.a, m.b, m.c, m.d, m.e, m.f] {
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

/// The document and its guides as NPaint file bytes.
pub fn save(doc: &Document, guides: &Guides) -> Vec<u8> {
    save_as(doc, guides, VERSION)
}

/// [`save`] in an older format, for testing that older files still open;
/// what an older version cannot carry is left out.
fn save_as(doc: &Document, guides: &Guides, version: u16) -> Vec<u8> {
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
            LayerKind::Smart(object) => {
                w.u8(if object.text.is_some() { 3 } else { 2 });
                w.raster(&object.source);
                w.affine(&object.transform);
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
        // Room for later: a block a reader can skip.
        w.u32(0);
    }
    for axis in [&guides.h, &guides.v] {
        w.u32(axis.len() as u32);
        for &at in axis {
            w.f64(at);
        }
    }
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

    fn affine(&mut self) -> Result<Affine, FileError> {
        Ok(Affine { a: self.f64()?, b: self.f64()?, c: self.f64()?, d: self.f64()?, e: self.f64()?, f: self.f64()? })
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

/// A document and its guides from NPaint file bytes. The guides come back
/// with snapping off; that is the editor's setting, not the file's.
pub fn load(bytes: &[u8]) -> Result<(Document, Guides), FileError> {
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
                let transform = r.affine()?;
                let mut object = SmartObject::new(source, transform);
                if kind == 3 {
                    object.text = Some(r.text(version)?);
                }
                let raster = object.render(width, height);
                (LayerKind::Smart(object), raster)
            }
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
        let extra = r.u32()? as usize;
        r.take(extra)?;

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
        layers.push(layer);
    }
    let doc = Document::from_parts(width, height, layers, active).ok_or(FileError::Corrupt("layer ids"))?;
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
    Ok((doc, guides))
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
        doc.set_smart_transform(3, Affine::translation(3.0, 1.0)).unwrap();
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
        doc.set_active(1).unwrap();
        doc
    }

    #[test]
    fn a_document_survives_the_round_trip_exactly() {
        let doc = document();
        let guides = Guides { h: vec![10.0, 25.5], v: vec![3.0], enabled: true };
        let bytes = save(&doc, &guides);
        assert_eq!(&bytes[..6], b"NPAINT");
        let (back, back_guides) = load(&bytes).unwrap();
        assert_eq!(back, doc);
        let adjustment = back.layers()[2].adjustment().expect("the adjustment layer");
        assert_eq!(adjustment.channel, crate::adjust::Channel::Green, "the channel came back with it");
        assert_eq!((back_guides.h, back_guides.v), (guides.h, guides.v));
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
        let first = save(&document(), &guides);
        let (doc, guides) = load(&first).unwrap();
        let second = save(&doc, &guides);
        assert_eq!(second, first);
        let (again, _) = load(&second).unwrap();
        assert_eq!(again, doc);
    }

    #[test]
    fn a_file_from_before_guides_opens_with_none() {
        let bytes = save(&document(), &Guides::default());
        // The trailer is two empty counts; a first-version file ends before it.
        let older = &bytes[..bytes.len() - 8];
        let (_, guides) = load(older).unwrap();
        assert!(guides.h.is_empty() && guides.v.is_empty());
    }

    #[test]
    fn a_file_from_an_older_format_still_opens() {
        let bytes = save(&document(), &Guides::default());
        assert_eq!(u16::from_le_bytes([bytes[6], bytes[7]]), VERSION, "the version is written where the reader looks");
        // Every format up to this one is still read. What changed between 1
        // and 2 is only what an adjustment's parameters may say, and an
        // older one that says nothing about a channel comes back on RGB
        // (see `adjust`); 3 added a layer kind; 4 added the Character
        // panel's settings after a text layer, which come back as the
        // defaults from a format-3 file.
        for older in 1..VERSION {
            let bytes = save_as(&document(), &Guides::default(), older);
            let (doc, _) = load(&bytes).expect("an older file still opens");
            assert_eq!(doc.layers().len(), document().layers().len(), "format {older}");
            let text = doc.layers()[4].text().expect("the text layer");
            assert_eq!(text.text, "Hi\nthere ✓", "format {older}");
            assert_eq!(text.style.leading, 1.2, "format {older}: the default, not the 1.5 a newer file keeps");
        }
        let (doc, _) = load(&bytes).unwrap();
        assert_eq!(doc.layers()[4].text().unwrap().style.leading, 1.5);
    }

    #[test]
    fn other_files_and_broken_ones_are_refused_politely() {
        assert_eq!(load(b"\x89PNG\r\n"), Err(FileError::NotNPaint));
        assert_eq!(load(b""), Err(FileError::NotNPaint));
        let bytes = save(&document(), &Guides::default());
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
