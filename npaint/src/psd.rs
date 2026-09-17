//! Photoshop's `.psd`, so that a document can arrive from somewhere other
//! than NPaint and leave for somewhere else.
//!
//! This is not an implementation of the format. What the reader takes
//! is the part everyone's files are made of: an 8-bit RGB or greyscale
//! document, its layers with their names, positions, opacity, blend mode,
//! visibility, clipping and layer masks, stored raw or run-length encoded. What it
//! does not take, it says so about rather than guessing.
//!
//! **The fallback is the point.** Almost every `.psd` in the world carries a
//! flattened composite of itself in the last section, because Photoshop's
//! "maximize compatibility" writes one. So when the layers cannot be read —
//! a zip-compressed channel, an arrangement this reader does not know — the
//! answer is not an error message but the flattened picture, with a note
//! saying that is what happened. A user who wanted their artwork open gets
//! their artwork open.
//!
//! What is knowingly left out, and why:
//!
//! * **16- and 32-bit files, CMYK, Lab, duotone and indexed colour.** The
//!   engine is 8-bit straight RGBA throughout; there is nothing honest to
//!   convert those into. They are refused by name.
//! * **`.psb`**, the large-document format, whose section lengths are eight
//!   bytes where a `.psd`'s are four.
//! * **Zip-compressed channels.** Inflating needs a decompressor, and the
//!   engine's only dependency is `wasm-bindgen`. Such a file opens
//!   flattened. (The page *could* hand back an inflated copy — it has
//!   `DecompressionStream` — which is the obvious way to lift this if it
//!   turns out to matter.)
//! * **A group's *knockout* and *blend interior* settings.** A group comes
//!   in pass-through or in whatever blend mode it was set to, which is the
//!   part that shows.
//! * **Layer effects, adjustment layers, text as text, vector shapes and
//!   smart objects**, which arrive as the pixels Photoshop last rendered
//!   for them — which is what the layer's channels hold anyway.
//!
//! [`save`] goes the other way, and the asymmetry is the whole of it: a
//! reader may ignore what it does not understand, and a writer may not.
//! So it writes the same part of the format the reader takes — an 8-bit RGB
//! document, its layers, groups, masks, blend modes, opacity, visibility and
//! clipping, run-length encoded — and anything with no place there is turned
//! into pixels rather than dropped, with [`export_note`] saying what that
//! cost. Every file ends with a flattened copy of the picture, so even a
//! reader that gives up on the layers opens the artwork; this one's own
//! round trip is what the tests check the writer with.

use crate::blend::BlendMode;
use crate::color::Rgba;
use crate::document::Document;
use crate::geometry::Rect;
use crate::layer::{Layer, LayerId, LayerKind};
use crate::raster::Raster;

const SIGNATURE: &[u8] = b"8BPS";
/// The block signature Photoshop puts in front of a blend mode and of each
/// piece of additional layer information.
const BIM: &[u8] = b"8BIM";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PsdError {
    NotPsd,
    /// A `.psb` (version 2), or something newer.
    Version(u16),
    /// Bits per channel, when it is not 8.
    Depth(u16),
    /// A colour mode with no 8-bit RGBA reading of it.
    ColorMode(&'static str),
    /// Bigger than a document may be here.
    TooBig(u32, u32),
    /// Neither the layers nor the flattened copy could be read.
    NoPixels,
    Corrupt(&'static str),
}

impl std::fmt::Display for PsdError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PsdError::NotPsd => f.write_str("not a Photoshop file"),
            PsdError::Version(v) => write!(
                f,
                "this is a version {v} Photoshop file (a .psb large document); NPaint reads .psd files"
            ),
            PsdError::Depth(d) => write!(f, "this file is {d} bits a channel; NPaint reads 8-bit files"),
            PsdError::ColorMode(mode) => write!(f, "this file is in {mode}; NPaint reads RGB and greyscale files"),
            PsdError::TooBig(w, h) => write!(f, "{w} × {h} px is larger than NPaint can open"),
            PsdError::NoPixels => f.write_str("this file holds neither readable layers nor a flattened copy"),
            PsdError::Corrupt(what) => write!(f, "this Photoshop file is damaged: {what}"),
        }
    }
}

impl std::error::Error for PsdError {}

/// What came out of a file: the document, and anything the user should be
/// told about how it got here.
pub struct Import {
    pub document: Document,
    /// One sentence for the status bar, when something was approximated.
    pub note: Option<String>,
}

/// Reads a `.psd` into a document.
pub fn load(bytes: &[u8]) -> Result<Import, PsdError> {
    let mut r = Reader::new(bytes);
    // Too short to hold a header is not a damaged Photoshop file; it is
    // some other file altogether, and saying so is more use.
    if bytes.len() < 26 || r.take(4)? != SIGNATURE {
        return Err(PsdError::NotPsd);
    }
    let version = r.u16()?;
    if version != 1 {
        return Err(PsdError::Version(version));
    }
    r.skip(6)?; // reserved, always zero
    let channels = r.u16()?;
    let height = r.u32()?;
    let width = r.u32()?;
    let depth = r.u16()?;
    let mode = r.u16()?;
    if depth != 8 {
        return Err(PsdError::Depth(depth));
    }
    let mode = ColorMode::of(mode)?;
    if width == 0 || height == 0 {
        return Err(PsdError::Corrupt("the document has no size"));
    }
    if !crate::editor::canvas_fits(width, height) {
        return Err(PsdError::TooBig(width, height));
    }

    r.skip_section()?; // colour mode data: palettes, for the modes we refuse
    r.skip_section()?; // image resources: guides, paths, thumbnails, slices

    let mut notes: Vec<String> = Vec::new();
    let layer_block = r.section()?;
    let layers = read_layers(layer_block, width, height, mode, &mut notes).unwrap_or_else(|why| {
        notes.push(why.to_owned());
        Vec::new()
    });
    // Whatever is left is the flattened copy of the whole picture.
    let flattened = read_composite(&mut r, width, height, channels, mode).ok();

    if !layers.is_empty() {
        // The layers already carry this document's ids and their grouping,
        // so they go in as a stack rather than one at a time: `from_parts`
        // is also what checks that the nesting came out sound.
        let top = layers.len() - 1;
        match Document::from_parts(width, height, layers, top) {
            Some(document) => return Ok(Import { document, note: join(notes) }),
            None => notes.push("Its layers could not be arranged, so it".to_owned()),
        }
    }

    let raster = flattened.ok_or(PsdError::NoPixels)?;
    notes.push("It has opened flattened, as one layer.".to_owned());
    Ok(Import { document: Document::from_raster("Background", raster), note: join(notes) })
}

fn join(notes: Vec<String>) -> Option<String> {
    if notes.is_empty() {
        None
    } else {
        Some(notes.join(" "))
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ColorMode {
    Grey,
    Rgb,
}

impl ColorMode {
    fn of(mode: u16) -> Result<ColorMode, PsdError> {
        match mode {
            1 => Ok(ColorMode::Grey),
            3 => Ok(ColorMode::Rgb),
            0 => Err(PsdError::ColorMode("bitmap")),
            2 => Err(PsdError::ColorMode("indexed colour")),
            4 => Err(PsdError::ColorMode("CMYK")),
            7 => Err(PsdError::ColorMode("multichannel")),
            8 => Err(PsdError::ColorMode("duotone")),
            9 => Err(PsdError::ColorMode("Lab colour")),
            _ => Err(PsdError::ColorMode("an unknown colour mode")),
        }
    }
}

// ---- Layers ---------------------------------------------------------------------

/// Reads the layer and mask information block into layers, bottom-first.
///
/// An `Err` here is not fatal: [`load`] falls back to the flattened copy and
/// passes the reason on to the user.
fn read_layers(block: &[u8], width: u32, height: u32, mode: ColorMode, notes: &mut Vec<String>) -> Result<Vec<Layer>, &'static str> {
    if block.is_empty() {
        return Ok(Vec::new());
    }
    let mut r = Reader::new(block);
    let info = r.section().map_err(|_| "Its layer section is damaged, so it")?;
    if info.is_empty() {
        return Ok(Vec::new());
    }
    let mut r = Reader::new(info);
    // Negative means the first alpha channel holds the merged transparency;
    // either way the count is what matters here.
    let count = r.i16().map_err(|_| "Its layer section is damaged, so it")?.unsigned_abs() as usize;
    let mut records = Vec::with_capacity(count);
    for _ in 0..count {
        records.push(read_record(&mut r).map_err(|_| "Its layer records are damaged, so it")?);
    }

    // The stack being built, bottom-first, and the groups still open above
    // it. Photoshop writes a group as an opening marker, then its contents,
    // then the folder's own record — which is exactly the arrangement the
    // document keeps, so the layers land in order and only the ids and the
    // parent links have to be filled in.
    let mut layers: Vec<Layer> = Vec::with_capacity(records.len());
    let mut open: Vec<usize> = Vec::new();
    let mut next_id = 1u32;
    let mut unclosed = false;
    let mut flattened_modes = false;
    for record in &records {
        // The channel data follows in the same order as the records, and
        // has to be read whether or not the layer is kept, so that the next
        // layer's data starts where this one's ended.
        let planes = read_channels(&mut r, record)?;
        if record.unknown_blend {
            flattened_modes = true;
        }
        match record.divider {
            // The marker that a folder's contents start here.
            Some(Divider::Open) => {
                open.push(layers.len());
                continue;
            }
            // The folder's own record, which closes it and names it.
            Some(Divider::Close { collapsed }) => {
                let Some(from) = open.pop() else {
                    // A folder that was never opened: its contents are
                    // whatever came before, which is not something to guess
                    // at. The group is dropped and its layers stay where
                    // they are.
                    unclosed = true;
                    continue;
                };
                let id = LayerId(next_id);
                next_id += 1;
                let mut group = build_group(record, id, width, height, planes.iter().find(|(c, _)| *c == -2).map(|(_, p)| p));
                group.collapsed = collapsed;
                for layer in &mut layers[from..] {
                    if layer.parent.is_none() {
                        layer.parent = Some(id);
                    }
                }
                layers.push(group);
                continue;
            }
            None => {}
        }
        let Some(mut layer) = build_layer(record, &planes, width, height, mode) else { continue };
        layer = layer.with_id(LayerId(next_id));
        next_id += 1;
        layers.push(layer);
    }
    // A folder left open at the top of the file has no record to name it;
    // its contents stay where they are, at the level they were read at.
    if !open.is_empty() || unclosed {
        notes.push("Some of its layer groups were not written whole, and those layers have come in loose.".to_owned());
    }
    if flattened_modes {
        notes.push("Some layers used blend modes NPaint does not have and are set to Normal.".to_owned());
    }
    Ok(layers)
}

/// One layer's record: everything but its pixels.
struct Record {
    rect: Rect,
    /// `(channel id, byte length)` in the order the data follows in.
    channels: Vec<(i16, usize)>,
    blend: BlendMode,
    unknown_blend: bool,
    opacity: f32,
    /// Photoshop's "clipping" byte: the layer is clipped to the one below.
    clipped: bool,
    visible: bool,
    name: String,
    /// Which end of a folder this record is, when it is one. Either way it
    /// has no pixels of its own.
    divider: Option<Divider>,
    mask: Option<MaskInfo>,
}

/// The two ends of a group, in the order a `.psd` writes them: the marker
/// that its contents begin, and then the folder's own record above them.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Divider {
    /// Photoshop's "bounding section divider" (3), under the contents.
    Open,
    /// The folder itself (1 open, 2 closed), over them.
    Close { collapsed: bool },
}

struct MaskInfo {
    rect: Rect,
    /// What the mask is outside its own rectangle.
    default: u8,
    /// A mask that is there but switched off.
    disabled: bool,
}

fn read_record(r: &mut Reader) -> Result<Record, PsdError> {
    let top = r.i32()?;
    let left = r.i32()?;
    let bottom = r.i32()?;
    let right = r.i32()?;
    // Photoshop's bounds are half-open — the right and bottom edges are
    // one past the last pixel — where `Rect::from_corners` takes both
    // corners as pixels that are in.
    let rect = Rect::new(left, top, right - left, bottom - top);
    let channel_count = r.u16()?;
    let mut channels = Vec::with_capacity(channel_count as usize);
    for _ in 0..channel_count {
        let id = r.i16()?;
        let len = r.u32()? as usize;
        channels.push((id, len));
    }
    if r.take(4)? != BIM {
        return Err(PsdError::Corrupt("a layer has no blend mode"));
    }
    let key: [u8; 4] = r.take(4)?.try_into().expect("four bytes");
    let (blend, unknown_blend) = blend_of(&key);
    let opacity = f32::from(r.u8()?) / 255.0;
    let clipped = r.u8()? != 0;
    let flags = r.u8()?;
    r.skip(1)?; // filler

    let extra = r.section()?;
    let mut e = Reader::new(extra);
    let mask = read_mask_info(&mut e)?;
    let _ranges = e.section()?;
    let pascal = e.pascal_padded(4)?;
    let mut name = String::from_utf8_lossy(pascal).into_owned();
    let mut divider = None;
    // What is left is a run of extra blocks by four-letter key. Two matter:
    // the Unicode name, which is the real one, and the section divider that
    // marks a group.
    while let Ok(Some((key, data))) = e.additional() {
        match &key {
            b"luni" => {
                if let Some(text) = unicode_name(data) {
                    name = text;
                }
            }
            b"lsct" | b"lsdk" => {
                let kind = data.get(..4).map(|b| u32::from_be_bytes(b.try_into().expect("four bytes")));
                // 1 is an open folder and 2 a closed one, both written
                // *above* their contents; 3 is the marker underneath them.
                divider = match kind {
                    Some(1) => Some(Divider::Close { collapsed: false }),
                    Some(2) => Some(Divider::Close { collapsed: true }),
                    Some(3) => Some(Divider::Open),
                    _ => None,
                };
            }
            _ => {}
        }
    }
    if name.is_empty() {
        name = "Layer".to_owned();
    }
    Ok(Record {
        rect,
        channels,
        blend,
        unknown_blend,
        opacity,
        clipped,
        // Bit 1 is "hidden", so the sense is the other way about.
        visible: flags & 0x02 == 0,
        name,
        divider,
        mask,
    })
}

fn read_mask_info(e: &mut Reader) -> Result<Option<MaskInfo>, PsdError> {
    let data = e.section()?;
    if data.len() < 18 {
        return Ok(None);
    }
    let mut m = Reader::new(data);
    let top = m.i32()?;
    let left = m.i32()?;
    let bottom = m.i32()?;
    let right = m.i32()?;
    let default = m.u8()?;
    // Bit 1 is the mask switched off; the rest are positioning and invert,
    // neither of which the engine's document-sized masks can be.
    let disabled = m.u8()? & 0x02 != 0;
    let rect = Rect::new(left, top, right - left, bottom - top);
    if rect.is_empty() {
        return Ok(None);
    }
    Ok(Some(MaskInfo { rect, default, disabled }))
}

/// The layer's channels, decoded and keyed by channel id.
fn read_channels(r: &mut Reader, record: &Record) -> Result<Vec<(i16, Vec<u8>)>, &'static str> {
    let mut planes = Vec::with_capacity(record.channels.len());
    for (id, len) in &record.channels {
        let raw = r.take(*len).map_err(|_| "Its layer pixels are damaged, so it")?;
        // A layer mask has its own rectangle; everything else has the
        // layer's.
        let rect = if *id == -2 {
            record.mask.as_ref().map_or(record.rect, |m| m.rect)
        } else {
            record.rect
        };
        let plane = decode_channel(raw, rect.w as usize, rect.h as usize)?;
        planes.push((*id, plane));
    }
    Ok(planes)
}

/// One channel's bytes, whatever they were packed with.
fn decode_channel(raw: &[u8], width: usize, height: usize) -> Result<Vec<u8>, &'static str> {
    let expected = width.checked_mul(height).ok_or("Its layers are impossibly large, so it")?;
    if expected == 0 {
        return Ok(Vec::new());
    }
    let mut r = Reader::new(raw);
    let compression = r.u16().map_err(|_| "Its layer pixels are damaged, so it")?;
    match compression {
        0 => {
            let bytes = r.take(expected).map_err(|_| "Its layer pixels are damaged, so it")?;
            Ok(bytes.to_vec())
        }
        1 => {
            let mut counts = Vec::with_capacity(height);
            for _ in 0..height {
                counts.push(r.u16().map_err(|_| "Its layer pixels are damaged, so it")? as usize);
            }
            let mut out = Vec::with_capacity(expected);
            for count in counts {
                let row = r.take(count).map_err(|_| "Its layer pixels are damaged, so it")?;
                unpack_bits(row, width, &mut out);
            }
            out.resize(expected, 0);
            Ok(out)
        }
        // Zip, with and without prediction. See the module comment: there
        // is no decompressor in here to do it with.
        2 | 3 => Err("It uses zip-compressed layers, which NPaint cannot unpack, so it"),
        _ => Err("Its layer pixels are packed in a way NPaint does not know, so it"),
    }
}

/// PackBits: a run-length encoding of alternating literal and repeated runs.
fn unpack_bits(src: &[u8], row_len: usize, out: &mut Vec<u8>) {
    let end = out.len() + row_len;
    let mut i = 0;
    while i < src.len() && out.len() < end {
        let n = src[i] as i8;
        i += 1;
        if n >= 0 {
            let run = (n as usize) + 1;
            let take = run.min(src.len().saturating_sub(i)).min(end - out.len());
            out.extend_from_slice(&src[i..i + take]);
            i += run;
        } else if n != -128 {
            let run = (1 - i32::from(n)) as usize;
            let Some(&byte) = src.get(i) else { break };
            i += 1;
            for _ in 0..run.min(end - out.len()) {
                out.push(byte);
            }
        }
        // -128 is a no-op, as the format says.
    }
    out.resize(end, 0);
}

/// Turns one layer's decoded channels into a layer of the document.
fn build_layer(record: &Record, planes: &[(i16, Vec<u8>)], width: u32, height: u32, mode: ColorMode) -> Option<Layer> {
    let rect = record.rect;
    if rect.is_empty() {
        return None;
    }
    let (w, h) = (rect.w as u32, rect.h as u32);
    let plane = |id: i16| planes.iter().find(|(c, _)| *c == id).map(|(_, p)| p);
    let alpha = plane(-1);
    let mut raster = Raster::new(w, h);
    let n = (w as usize) * (h as usize);
    let at = |p: Option<&Vec<u8>>, i: usize, fallback: u8| p.and_then(|v| v.get(i).copied()).unwrap_or(fallback);
    let (red, green, blue) = match mode {
        ColorMode::Rgb => (plane(0), plane(1), plane(2)),
        // Greyscale: one channel standing in for all three.
        ColorMode::Grey => (plane(0), plane(0), plane(0)),
    };
    if red.is_none() && alpha.is_none() {
        return None;
    }
    for i in 0..n {
        let x = (i % w as usize) as i32;
        let y = (i / w as usize) as i32;
        let colour = Rgba::new(at(red, i, 0), at(green, i, 0), at(blue, i, 0), at(alpha, i, 255));
        raster.set(x, y, colour);
    }
    // Placed at its own corner, cropped to the canvas — which is what
    // Photoshop shows, since the canvas is the document.
    let placed = raster.resized(width, height, rect.x, rect.y);
    let mut layer = Layer::new(crate::layer::LayerId(0), record.name.clone(), placed);
    layer.visible = record.visible;
    layer.blend = record.blend;
    layer.set_opacity(record.opacity);
    layer.clipped = record.clipped;
    if let (Some(info), Some(bytes)) = (record.mask.as_ref(), plane(-2)) {
        layer.mask = Some(mask_raster(info, bytes, width, height));
        layer.mask_enabled = !info.disabled;
    }
    Some(layer)
}

/// A folder's own record as a group layer. A group has no channels worth
/// keeping — Photoshop writes it an empty or one-pixel rectangle — but it
/// does carry the name, opacity, blend mode, visibility and, when there is
/// one, a mask that holds back everything inside it.
fn build_group(record: &Record, id: LayerId, width: u32, height: u32, mask: Option<&Vec<u8>>) -> Layer {
    let mut group = Layer::new_group(id, record.name.clone());
    group.visible = record.visible;
    group.blend = record.blend;
    group.set_opacity(record.opacity);
    group.clipped = record.clipped;
    if let (Some(info), Some(bytes)) = (record.mask.as_ref(), mask) {
        group.mask = Some(mask_raster(info, bytes, width, height));
        group.mask_enabled = !info.disabled;
    }
    group
}

/// A layer mask as the document-sized grey raster the engine keeps.
fn mask_raster(info: &MaskInfo, bytes: &[u8], width: u32, height: u32) -> Raster {
    // Outside its own rectangle a Photoshop mask is its default colour,
    // which is usually black — hiding everything the mask does not reach.
    let grey = |v: u8| Rgba::new(v, v, v, 255);
    let mut mask = Raster::filled(width, height, grey(info.default));
    let (w, h) = (info.rect.w as usize, info.rect.h as usize);
    for y in 0..h {
        for x in 0..w {
            let Some(&v) = bytes.get(y * w + x) else { continue };
            mask.set(info.rect.x + x as i32, info.rect.y + y as i32, grey(v));
        }
    }
    mask
}

/// Photoshop's four-letter blend keys. The second value is whether the mode
/// was one this engine does not have, and so came back as Normal.
fn blend_of(key: &[u8; 4]) -> (BlendMode, bool) {
    match key {
        b"norm" => (BlendMode::Normal, false),
        b"dark" => (BlendMode::Darken, false),
        b"mul " => (BlendMode::Multiply, false),
        b"idiv" => (BlendMode::ColorBurn, false),
        b"lite" => (BlendMode::Lighten, false),
        b"scrn" => (BlendMode::Screen, false),
        b"div " => (BlendMode::ColorDodge, false),
        b"over" => (BlendMode::Overlay, false),
        b"sLit" => (BlendMode::SoftLight, false),
        b"hLit" => (BlendMode::HardLight, false),
        b"diff" => (BlendMode::Difference, false),
        b"smud" => (BlendMode::Exclusion, false),
        b"hue " => (BlendMode::Hue, false),
        b"sat " => (BlendMode::Saturation, false),
        b"colr" => (BlendMode::Color, false),
        b"lum " => (BlendMode::Luminosity, false),
        // A group's default, and the one a group opens in: its contents
        // draw straight onto what is under the group.
        b"pass" => (BlendMode::PassThrough, false),
        _ => (BlendMode::Normal, true),
    }
}

/// The `luni` block: a big-endian UTF-16 string behind its length.
fn unicode_name(data: &[u8]) -> Option<String> {
    let len = u32::from_be_bytes(data.get(..4)?.try_into().ok()?) as usize;
    let units: Vec<u16> = data
        .get(4..4 + len * 2)?
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| u16::from_be_bytes(*c))
        .collect();
    let text = String::from_utf16(&units).ok()?;
    let trimmed = text.trim_end_matches('\0').to_owned();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

// ---- The flattened copy ----------------------------------------------------------

/// The image data section: the whole picture, every channel in turn.
fn read_composite(r: &mut Reader, width: u32, height: u32, channels: u16, mode: ColorMode) -> Result<Raster, PsdError> {
    let compression = r.u16()?;
    let (w, h) = (width as usize, height as usize);
    let n = w.checked_mul(h).ok_or(PsdError::Corrupt("the document is impossibly large"))?;
    let count = channels as usize;
    let mut planes: Vec<Vec<u8>> = Vec::with_capacity(count);
    match compression {
        0 => {
            for _ in 0..count {
                planes.push(r.take(n)?.to_vec());
            }
        }
        1 => {
            // One table of row lengths for every row of every channel,
            // then all the packed rows behind it.
            let mut counts = Vec::with_capacity(count * h);
            for _ in 0..count * h {
                counts.push(r.u16()? as usize);
            }
            for c in 0..count {
                let mut plane = Vec::with_capacity(n);
                for y in 0..h {
                    let row = r.take(counts[c * h + y])?;
                    unpack_bits(row, w, &mut plane);
                }
                planes.push(plane);
            }
        }
        _ => return Err(PsdError::Corrupt("the flattened copy is packed in a way NPaint does not know")),
    }
    let plane = |i: usize| planes.get(i);
    let (red, green, blue, alpha) = match mode {
        ColorMode::Rgb => (plane(0), plane(1), plane(2), plane(3)),
        ColorMode::Grey => (plane(0), plane(0), plane(0), plane(1)),
    };
    let red = red.ok_or(PsdError::NoPixels)?;
    let mut raster = Raster::new(width, height);
    let at = |p: Option<&Vec<u8>>, i: usize, fallback: u8| p.and_then(|v| v.get(i).copied()).unwrap_or(fallback);
    for i in 0..n {
        let x = (i % w) as i32;
        let y = (i / w) as i32;
        raster.set(
            x,
            y,
            Rgba::new(
                at(Some(red), i, 0),
                at(green, i, 0),
                at(blue, i, 0),
                // A flattened copy with no alpha channel is opaque, which
                // is what the composite of a whole document usually is.
                at(alpha, i, 255),
            ),
        );
    }
    Ok(raster)
}

// ---- Reading --------------------------------------------------------------------

/// A cursor over big-endian bytes — the other way round from
/// [`crate::file`], because that is how Photoshop writes.
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

/// One extra block after a layer's name: its four-letter key and its bytes.
type Extra<'a> = ([u8; 4], &'a [u8]);

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Reader<'a> {
        Reader { bytes, at: 0 }
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8], PsdError> {
        let end = self.at.checked_add(n).ok_or(PsdError::Corrupt("a length ran off the end"))?;
        let slice = self.bytes.get(self.at..end).ok_or(PsdError::Corrupt("it ends in the middle of something"))?;
        self.at = end;
        Ok(slice)
    }

    fn skip(&mut self, n: usize) -> Result<(), PsdError> {
        self.take(n).map(|_| ())
    }

    fn u8(&mut self) -> Result<u8, PsdError> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, PsdError> {
        Ok(u16::from_be_bytes(self.take(2)?.try_into().expect("two bytes")))
    }

    fn i16(&mut self) -> Result<i16, PsdError> {
        Ok(i16::from_be_bytes(self.take(2)?.try_into().expect("two bytes")))
    }

    fn u32(&mut self) -> Result<u32, PsdError> {
        Ok(u32::from_be_bytes(self.take(4)?.try_into().expect("four bytes")))
    }

    fn i32(&mut self) -> Result<i32, PsdError> {
        Ok(i32::from_be_bytes(self.take(4)?.try_into().expect("four bytes")))
    }

    /// A length-prefixed block, returned as its own slice.
    fn section(&mut self) -> Result<&'a [u8], PsdError> {
        let len = self.u32()? as usize;
        self.take(len)
    }

    fn skip_section(&mut self) -> Result<(), PsdError> {
        self.section().map(|_| ())
    }

    /// A Pascal string — one length byte, then the characters — padded out
    /// so the whole thing is a multiple of `to`.
    fn pascal_padded(&mut self, to: usize) -> Result<&'a [u8], PsdError> {
        let len = self.u8()? as usize;
        let text = self.take(len)?;
        let used = len + 1;
        let pad = (to - used % to) % to;
        self.skip(pad)?;
        Ok(text)
    }

    /// The next `8BIM`-tagged extra block, as its key and its data, or
    /// `None` at the end of them.
    fn additional(&mut self) -> Result<Option<Extra<'a>>, PsdError> {
        if self.bytes.len().saturating_sub(self.at) < 12 {
            return Ok(None);
        }
        let signature = self.take(4)?;
        if signature != BIM && signature != b"8B64" {
            return Ok(None);
        }
        let key: [u8; 4] = self.take(4)?.try_into().expect("four bytes");
        let len = self.u32()? as usize;
        // These are padded to an even length.
        let data = self.take(len)?;
        if len % 2 == 1 {
            let _ = self.skip(1);
        }
        Ok(Some((key, data)))
    }
}

// ---- Writing --------------------------------------------------------------------

/// A document written out as a `.psd`, and anything the user should be told
/// about what the format could not hold. The counterpart of [`Import`].
pub struct Export {
    pub bytes: Vec<u8>,
    /// One sentence for the status bar, when something was given up.
    pub note: Option<String>,
}

/// Writes a document as an 8-bit RGB `.psd`.
///
/// Layers, groups, masks, blend modes, opacity, visibility and clipping go
/// out as themselves. What has no place in the format is resolved into
/// pixels rather than dropped — an adjustment layer is flattened into what
/// it was doing — and the file ends with a flattened copy of the whole
/// picture, so a reader that gives up on the layers still opens the
/// artwork. Everything is run-length encoded: raw channels would be four
/// bytes a pixel a layer. [`export_note`] is what the user should be told.
pub fn save(document: &Document) -> Export {
    let baked;
    let layers: &[Layer] = match bake_adjustments(document) {
        Some(flat) => {
            baked = flat;
            &baked
        }
        None => document.layers(),
    };

    let mut w = Writer::new();
    w.bytes(SIGNATURE);
    w.u16(1); // a .psd; 2 would be a .psb
    w.bytes(&[0; 6]); // reserved
    w.u16(4); // RGBA
    w.u32(document.height());
    w.u32(document.width());
    w.u16(8);
    w.u16(3); // RGB
    w.section(&[]); // colour mode data: nothing for an RGB file
    w.section(&[]); // image resources: guides and thumbnails, none of which go out
    w.section(&layer_section(layers));
    w.bytes(&composite_section(&document.composite()));
    Export { bytes: w.bytes, note: export_note(document) }
}

/// What a `.psd` of this document cannot hold, as the sentences [`save`]
/// would come back with — without writing the file, so that the page can
/// warn before it asks for one.
pub fn export_note(document: &Document) -> Option<String> {
    let mut notes = Vec::new();
    if document.layers().iter().any(Layer::is_adjustment) {
        notes.push(
            "Photoshop's adjustment layers are not something NPaint can write, so everything under the topmost one goes out as a single flattened layer.".to_owned(),
        );
    }
    if document.layers().iter().any(|layer| matches!(layer.kind, LayerKind::Smart(_))) {
        notes.push("Smart objects and text layers go out as the pixels they show.".to_owned());
    }
    if document.layers().iter().any(|layer| layer.offscreen.is_some()) {
        notes.push("Pixels held outside the canvas are not in the file.".to_owned());
    }
    join(notes)
}

/// A document's layers with its adjustment layers resolved into pixels, or
/// `None` when there were none and nothing had to be given up.
///
/// An adjustment layer in a `.psd` is a Photoshop descriptor, a format of
/// its own that this writer has no way to build — and leaving one out would
/// change the picture, since what it does is change everything under it. So
/// it is flattened instead: everything up to and including the topmost
/// adjustment layer becomes one layer holding what those layers composited
/// to, and the layers above it go out as themselves. The picture is exact;
/// what is lost is the separation underneath.
fn bake_adjustments(document: &Document) -> Option<Vec<Layer>> {
    let highest = document.layers().iter().rposition(Layer::is_adjustment)?;
    // The cut may only fall between whole top-level items, and not between
    // a clipping base and the layers clipped to it — see
    // `Document::split_point`, which is the same rule from the other end.
    let mut at = highest;
    while let Some(parent) = document.parent_index(at) {
        at = parent;
    }
    let mut cut = at + 1;
    while document.layers().get(cut).is_some_and(Layer::clips_below) {
        cut = document.subtree(cut).end;
    }

    let mut flat = Raster::new(document.width(), document.height());
    document.composite_below(cut, &mut flat, &document.bounds());
    let free = document.layers().iter().map(|layer| layer.id().0).max().unwrap_or(0) + 1;
    let mut layers = Vec::with_capacity(document.layers().len() - cut + 1);
    layers.push(Layer::new(LayerId(free), "Background", flat));
    layers.extend(document.layers()[cut..].iter().cloned());
    Some(layers)
}

/// One row of the layer section, in the order a `.psd` writes them: a
/// folder is its opening marker, its contents, and then its own record.
enum Entry<'a> {
    /// The "bounding section divider" that goes under a folder's contents.
    Open,
    /// The folder itself, over them.
    Close(&'a Layer),
    Layer(&'a Layer),
}

/// The layer and mask information section: every record, then every
/// record's channels in the same order.
fn layer_section(layers: &[Layer]) -> Vec<u8> {
    let mut entries = Vec::new();
    order(layers, None, 0..layers.len(), &mut entries);
    if entries.is_empty() {
        return Vec::new();
    }
    let written: Vec<(Vec<u8>, Vec<u8>)> = entries.iter().map(write_entry).collect();

    let mut info = Writer::new();
    // Negative says the first alpha channel of the flattened copy is the
    // picture's own transparency, which is what this writer's is.
    info.i16(-(written.len() as i16));
    for (record, _) in &written {
        info.bytes(record);
    }
    for (_, data) in &written {
        info.bytes(data);
    }
    info.pad(2);

    let mut out = Writer::new();
    out.section(&info.bytes);
    out.u32(0); // no global layer mask
    out.bytes
}

/// The entries for the layers inside `parent` that lie in `range`,
/// bottom-first. A group's contents are the run between the previous
/// sibling and the group's own row, which is how the document stores them
/// and how a `.psd` writes them.
fn order<'a>(layers: &'a [Layer], parent: Option<LayerId>, range: std::ops::Range<usize>, out: &mut Vec<Entry<'a>>) {
    let mut cursor = range.start;
    for index in range {
        let layer = &layers[index];
        if layer.parent != parent {
            continue;
        }
        let contents = cursor..index;
        cursor = index + 1;
        if layer.is_group() {
            out.push(Entry::Open);
            order(layers, Some(layer.id()), contents, out);
            out.push(Entry::Close(layer));
        } else {
            out.push(Entry::Layer(layer));
        }
    }
}

/// One entry as its record and its channel data.
fn write_entry(entry: &Entry) -> (Vec<u8>, Vec<u8>) {
    let (layer, divider) = match entry {
        // The marker has no layer of its own: it is a row of nothing whose
        // only job is to say where the folder above it begins.
        Entry::Open => return group_marker(),
        Entry::Close(layer) => (*layer, Some(if layer.collapsed { 2u32 } else { 1 })),
        Entry::Layer(layer) => (*layer, None),
    };

    // A folder has no pixels of its own, so its record carries an empty
    // rectangle and four empty channels — which is what Photoshop writes.
    let rect = if divider.is_some() {
        Rect::default()
    } else {
        // A layer with nothing on it still has to be a layer when the file
        // is read back, and an empty rectangle would not be one.
        layer.raster.content_bounds().unwrap_or(Rect::new(0, 0, 1, 1))
    };
    let mask = layer.mask.as_ref().map(|mask| (mask.bounds(), mask_plane(mask)));

    let mut channels: Vec<(i16, Vec<u8>)> = Vec::with_capacity(5);
    // Alpha first, then the colours, in the order Photoshop writes them.
    for id in [-1i16, 0, 1, 2] {
        channels.push((id, channel_bytes(&plane(&layer.raster, rect, id), rect.w as usize, rect.h as usize)));
    }
    if let Some((bounds, bytes)) = &mask {
        channels.push((-2, channel_bytes(bytes, bounds.w as usize, bounds.h as usize)));
    }

    let mut record = Writer::new();
    record.rect(rect);
    record.u16(channels.len() as u16);
    for (id, bytes) in &channels {
        record.i16(*id);
        record.u32(bytes.len() as u32);
    }
    record.bytes(BIM);
    record.bytes(&blend_key(layer.blend));
    record.u8((layer.opacity.clamp(0.0, 1.0) * 255.0).round() as u8);
    record.u8(u8::from(layer.clipped));
    // Bit 1 is "hidden", so the sense is the other way about; bit 3 says
    // the two bits above it are meaningful, which Photoshop always sets.
    record.u8(if layer.visible { 0x08 } else { 0x0a });
    record.u8(0); // filler

    let mut extra = Writer::new();
    match &mask {
        Some((bounds, _)) => extra.section(&mask_info(*bounds, layer.mask_enabled)),
        None => extra.u32(0),
    }
    extra.u32(0); // blending ranges
    extra.pascal_padded(&layer.name, 4);
    extra.additional(b"luni", &unicode_bytes(&layer.name));
    if let Some(kind) = divider {
        extra.additional(b"lsct", &kind.to_be_bytes());
    }
    extra.pad(2);
    record.section(&extra.bytes);

    let mut data = Writer::new();
    for (_, bytes) in &channels {
        data.bytes(bytes);
    }
    (record.bytes, data.bytes)
}

/// The row under a folder's contents that says where the folder begins: no
/// pixels, no mask, and a section divider of kind 3. Photoshop names it
/// `</Layer group>` and so does this.
fn group_marker() -> (Vec<u8>, Vec<u8>) {
    let mut record = Writer::new();
    record.rect(Rect::default());
    record.u16(4);
    let mut data = Writer::new();
    for id in [-1i16, 0, 1, 2] {
        record.i16(id);
        record.u32(2); // the compression tag alone: there are no rows
        data.u16(1);
    }
    record.bytes(BIM);
    record.bytes(b"norm");
    record.u8(255);
    record.u8(0);
    record.u8(0x08);
    record.u8(0);
    let mut extra = Writer::new();
    extra.u32(0); // no mask
    extra.u32(0); // no blending ranges
    extra.pascal_padded("</Layer group>", 4);
    extra.additional(b"lsct", &3u32.to_be_bytes());
    extra.pad(2);
    record.section(&extra.bytes);
    (record.bytes, data.bytes)
}

/// The layer mask record: where the mask is, what it is outside that, and
/// whether it is switched on.
fn mask_info(bounds: Rect, enabled: bool) -> Vec<u8> {
    let mut m = Writer::new();
    m.rect(bounds);
    m.u8(0); // black outside the rectangle — but the rectangle is the canvas
    m.u8(if enabled { 0 } else { 0x02 });
    m.u16(0); // padding, so the record is the 20 bytes a reader expects
    m.bytes
}

/// One channel of `raster` inside `rect`, row-major. Anything outside the
/// raster reads as transparent, which is what `Raster::get` gives.
fn plane(raster: &Raster, rect: Rect, channel: i16) -> Vec<u8> {
    let mut out = Vec::with_capacity(rect.area() as usize);
    for y in rect.y..rect.bottom() {
        for x in rect.x..rect.right() {
            let pixel = raster.get(x, y);
            out.push(match channel {
                0 => pixel.r,
                1 => pixel.g,
                2 => pixel.b,
                _ => pixel.a,
            });
        }
    }
    out
}

/// A layer mask as the single grey channel a `.psd` holds it in.
fn mask_plane(mask: &Raster) -> Vec<u8> {
    mask.pixels().iter().map(|&pixel| crate::layer::mask_cover(pixel)).collect()
}

/// One channel as the file holds it: run-length encoded a row at a time,
/// behind the table of row lengths.
fn channel_bytes(plane: &[u8], width: usize, height: usize) -> Vec<u8> {
    let mut lengths = Vec::with_capacity(height);
    let mut packed = Vec::new();
    for y in 0..height {
        lengths.push(pack_bits(&plane[y * width..(y + 1) * width], &mut packed) as u16);
    }
    let mut out = Writer::new();
    out.u16(1); // run-length encoded
    for length in lengths {
        out.u16(length);
    }
    out.bytes(&packed);
    out.bytes
}

/// The image data section: the flattened picture, every channel in turn,
/// behind one table of row lengths for all of them.
fn composite_section(raster: &Raster) -> Vec<u8> {
    let rect = raster.bounds();
    let height = rect.h as usize;
    let mut lengths = Vec::with_capacity(4 * height);
    let mut packed = Vec::new();
    for channel in [0i16, 1, 2, -1] {
        let plane = plane(raster, rect, channel);
        for y in 0..height {
            lengths.push(pack_bits(&plane[y * rect.w as usize..(y + 1) * rect.w as usize], &mut packed) as u16);
        }
    }
    let mut out = Writer::new();
    out.u16(1);
    for length in lengths {
        out.u16(length);
    }
    out.bytes(&packed);
    out.bytes
}

/// PackBits: repeated runs as a count and a byte, everything else copied
/// through. The inverse of [`unpack_bits`]; returns how many bytes it added.
fn pack_bits(src: &[u8], out: &mut Vec<u8>) -> usize {
    let was = out.len();
    let mut at = 0;
    while at < src.len() {
        // Two identical bytes cost the same either way, so a run has to be
        // three before it is worth breaking the literals for.
        let run = run_at(src, at);
        if run >= 3 {
            out.push((1 - run as i32) as u8);
            out.push(src[at]);
            at += run;
            continue;
        }
        let mut end = at;
        while end < src.len() && end - at < 128 && run_at(src, end) < 3 {
            end += 1;
        }
        out.push((end - at - 1) as u8);
        out.extend_from_slice(&src[at..end]);
        at = end;
    }
    out.len() - was
}

/// How many times the byte at `at` repeats, up to the 128 one run may hold.
fn run_at(src: &[u8], at: usize) -> usize {
    src[at..].iter().take_while(|&&byte| byte == src[at]).count().min(128)
}

/// Photoshop's four-letter key for a blend mode — the inverse of
/// [`blend_of`], which is why every mode here has to stay in step with it.
fn blend_key(mode: BlendMode) -> [u8; 4] {
    *match mode {
        BlendMode::Normal => b"norm",
        BlendMode::Darken => b"dark",
        BlendMode::Multiply => b"mul ",
        BlendMode::ColorBurn => b"idiv",
        BlendMode::Lighten => b"lite",
        BlendMode::Screen => b"scrn",
        BlendMode::ColorDodge => b"div ",
        BlendMode::Overlay => b"over",
        BlendMode::SoftLight => b"sLit",
        BlendMode::HardLight => b"hLit",
        BlendMode::Difference => b"diff",
        BlendMode::Exclusion => b"smud",
        BlendMode::Hue => b"hue ",
        BlendMode::Saturation => b"sat ",
        BlendMode::Color => b"colr",
        BlendMode::Luminosity => b"lum ",
        BlendMode::PassThrough => b"pass",
    }
}

/// The body of a `luni` block: a big-endian UTF-16 string behind its length
/// in code units.
fn unicode_bytes(name: &str) -> Vec<u8> {
    let units: Vec<u16> = name.encode_utf16().collect();
    let mut out = Vec::with_capacity(4 + units.len() * 2);
    out.extend_from_slice(&(units.len() as u32).to_be_bytes());
    for unit in units {
        out.extend_from_slice(&unit.to_be_bytes());
    }
    out
}

/// A cursor's worth of big-endian bytes going the other way — the
/// counterpart of [`Reader`].
struct Writer {
    bytes: Vec<u8>,
}

impl Writer {
    fn new() -> Writer {
        Writer { bytes: Vec::new() }
    }

    fn bytes(&mut self, bytes: &[u8]) {
        self.bytes.extend_from_slice(bytes);
    }

    fn u8(&mut self, value: u8) {
        self.bytes.push(value);
    }

    fn u16(&mut self, value: u16) {
        self.bytes(&value.to_be_bytes());
    }

    fn i16(&mut self, value: i16) {
        self.bytes(&value.to_be_bytes());
    }

    fn u32(&mut self, value: u32) {
        self.bytes(&value.to_be_bytes());
    }

    fn i32(&mut self, value: i32) {
        self.bytes(&value.to_be_bytes());
    }

    /// A rectangle as Photoshop's four bounds, whose right and bottom edges
    /// are one past the last pixel.
    fn rect(&mut self, rect: Rect) {
        self.i32(rect.y);
        self.i32(rect.x);
        self.i32(rect.bottom());
        self.i32(rect.right());
    }

    /// `body` behind its own length.
    fn section(&mut self, body: &[u8]) {
        self.u32(body.len() as u32);
        self.bytes(body);
    }

    /// Zeroes until the length is a multiple of `to`.
    fn pad(&mut self, to: usize) {
        while !self.bytes.len().is_multiple_of(to) {
            self.u8(0);
        }
    }

    /// A Pascal string — one length byte, then the characters — padded out
    /// so the whole thing is a multiple of `to`.
    ///
    /// This one is the legacy name, which is a single byte a character and
    /// at most 255 of them; the real name goes out in the `luni` block
    /// beside it, and that is the one a reader should prefer.
    fn pascal_padded(&mut self, text: &str, to: usize) {
        let ascii: Vec<u8> = text.chars().map(|c| if c.is_ascii() { c as u8 } else { b'?' }).take(255).collect();
        self.u8(ascii.len() as u8);
        self.bytes(&ascii);
        let used = ascii.len() + 1;
        for _ in 0..(to - used % to) % to {
            self.u8(0);
        }
    }

    /// An `8BIM`-tagged extra block, padded out to an even length.
    fn additional(&mut self, key: &[u8; 4], body: &[u8]) {
        self.bytes(BIM);
        self.bytes(key);
        self.section(body);
        if !body.len().is_multiple_of(2) {
            self.u8(0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Building files to read ---------------------------------------------
    //
    // Small `.psd`s written by hand, so that what a test is about is the one
    // thing it changes. `Builder` writes the sections in the order the format
    // puts them in, and every length is worked out from what it wraps rather
    // than written down twice.

    const RGB: u16 = 3;
    const GREY: u16 = 1;

    fn be16(v: u16) -> [u8; 2] {
        v.to_be_bytes()
    }

    fn be32(v: u32) -> [u8; 4] {
        v.to_be_bytes()
    }

    /// A length-prefixed block.
    fn section(body: &[u8]) -> Vec<u8> {
        let mut out = be32(body.len() as u32).to_vec();
        out.extend_from_slice(body);
        out
    }

    /// A Pascal string padded so its whole length is a multiple of four.
    fn pascal(name: &str) -> Vec<u8> {
        let mut out = vec![name.len() as u8];
        out.extend_from_slice(name.as_bytes());
        while out.len() % 4 != 0 {
            out.push(0);
        }
        out
    }

    /// PackBits, in literal runs of up to 128 bytes — what the decoder has
    /// to cope with, written the simple way round.
    fn pack_row(row: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        for chunk in row.chunks(128) {
            out.push((chunk.len() - 1) as u8);
            out.extend_from_slice(chunk);
        }
        out
    }

    /// One channel's bytes as the file holds them: raw, or run-length
    /// encoded a row at a time behind a table of row lengths.
    fn channel(plane: &[u8], width: usize, height: usize, rle: bool) -> Vec<u8> {
        if !rle {
            let mut out = be16(0).to_vec();
            out.extend_from_slice(plane);
            return out;
        }
        let rows: Vec<Vec<u8>> = (0..height).map(|y| pack_row(&plane[y * width..(y + 1) * width])).collect();
        let mut out = be16(1).to_vec();
        for row in &rows {
            out.extend_from_slice(&be16(row.len() as u16));
        }
        for row in &rows {
            out.extend_from_slice(row);
        }
        out
    }

    struct TestLayer {
        rect: (i32, i32, i32, i32), // top, left, bottom, right
        /// `(channel id, plane)`, in the order they are written.
        channels: Vec<(i16, Vec<u8>)>,
        blend: [u8; 4],
        opacity: u8,
        clipping: u8,
        flags: u8,
        name: String,
        unicode_name: Option<String>,
        divider: Option<u32>,
        /// `(top, left, bottom, right, default)` of a layer mask.
        mask: Option<(i32, i32, i32, i32, u8)>,
        rle: bool,
        /// Claim a compression this reader cannot unpack.
        zipped: bool,
    }

    impl TestLayer {
        fn new(rect: (i32, i32, i32, i32), name: &str) -> TestLayer {
            TestLayer {
                rect,
                channels: Vec::new(),
                blend: *b"norm",
                opacity: 255,
                clipping: 0,
                flags: 0,
                name: name.to_owned(),
                unicode_name: None,
                divider: None,
                mask: None,
                rle: false,
                zipped: false,
            }
        }

        fn size(&self) -> (usize, usize) {
            let (top, left, bottom, right) = self.rect;
            ((right - left) as usize, (bottom - top) as usize)
        }

        /// A solid colour over the whole layer, with an alpha channel.
        fn solid(mut self, colour: (u8, u8, u8), alpha: u8) -> TestLayer {
            let (w, h) = self.size();
            let n = w * h;
            self.channels = vec![
                (-1, vec![alpha; n]),
                (0, vec![colour.0; n]),
                (1, vec![colour.1; n]),
                (2, vec![colour.2; n]),
            ];
            self
        }

        fn data(&self) -> Vec<u8> {
            let (w, h) = self.size();
            let mut out = Vec::new();
            for (id, plane) in &self.channels {
                let (cw, ch) = if *id == -2 {
                    let (top, left, bottom, right) = self.mask.map(|m| (m.0, m.1, m.2, m.3)).unwrap_or_default();
                    ((right - left) as usize, (bottom - top) as usize)
                } else {
                    (w, h)
                };
                if self.zipped {
                    out.extend_from_slice(&be16(2));
                    out.extend_from_slice(plane);
                } else {
                    out.extend_from_slice(&channel(plane, cw, ch, self.rle));
                }
            }
            out
        }

        fn record(&self) -> Vec<u8> {
            let (top, left, bottom, right) = self.rect;
            let (w, h) = self.size();
            let mut out = Vec::new();
            for v in [top, left, bottom, right] {
                out.extend_from_slice(&v.to_be_bytes());
            }
            out.extend_from_slice(&be16(self.channels.len() as u16));
            for (id, plane) in &self.channels {
                out.extend_from_slice(&id.to_be_bytes());
                let len = if self.zipped {
                    2 + plane.len()
                } else {
                    let (cw, ch) = if *id == -2 {
                        let m = self.mask.unwrap_or_default();
                        ((m.3 - m.1) as usize, (m.2 - m.0) as usize)
                    } else {
                        (w, h)
                    };
                    channel(plane, cw, ch, self.rle).len()
                };
                out.extend_from_slice(&be32(len as u32));
            }
            out.extend_from_slice(BIM);
            out.extend_from_slice(&self.blend);
            out.push(self.opacity);
            out.push(self.clipping);
            out.push(self.flags);
            out.push(0); // filler

            let mut extra = Vec::new();
            extra.extend_from_slice(&section(&match self.mask {
                Some((top, left, bottom, right, default)) => {
                    let mut m = Vec::new();
                    for v in [top, left, bottom, right] {
                        m.extend_from_slice(&v.to_be_bytes());
                    }
                    m.push(default);
                    m.push(0); // flags
                    m.extend_from_slice(&[0, 0]); // padding to the 20 bytes Photoshop writes
                    m
                }
                None => Vec::new(),
            }));
            extra.extend_from_slice(&section(&[])); // blending ranges
            extra.extend_from_slice(&pascal(&self.name));
            if let Some(text) = &self.unicode_name {
                let units: Vec<u16> = text.encode_utf16().collect();
                let mut body = be32(units.len() as u32).to_vec();
                for unit in units {
                    body.extend_from_slice(&unit.to_be_bytes());
                }
                extra.extend_from_slice(BIM);
                extra.extend_from_slice(b"luni");
                extra.extend_from_slice(&section(&body));
                if body.len() % 2 == 1 {
                    extra.push(0);
                }
            }
            if let Some(kind) = self.divider {
                extra.extend_from_slice(BIM);
                extra.extend_from_slice(b"lsct");
                extra.extend_from_slice(&section(&be32(kind)));
            }
            out.extend_from_slice(&section(&extra));
            out
        }
    }

    struct Builder {
        width: u32,
        height: u32,
        mode: u16,
        depth: u16,
        version: u16,
        channels: u16,
        layers: Vec<TestLayer>,
        /// The flattened copy's planes, in channel order.
        composite: Option<Vec<Vec<u8>>>,
    }

    impl Builder {
        fn new(width: u32, height: u32) -> Builder {
            Builder { width, height, mode: RGB, depth: 8, version: 1, channels: 3, layers: Vec::new(), composite: None }
        }

        /// A flat colour as the flattened copy, which is what "maximize
        /// compatibility" leaves in a real file.
        fn flattened(mut self, colour: (u8, u8, u8)) -> Builder {
            let n = (self.width * self.height) as usize;
            self.composite = Some(vec![vec![colour.0; n], vec![colour.1; n], vec![colour.2; n]]);
            self
        }

        fn build(&self) -> Vec<u8> {
            let mut out = Vec::new();
            out.extend_from_slice(SIGNATURE);
            out.extend_from_slice(&be16(self.version));
            out.extend_from_slice(&[0; 6]);
            out.extend_from_slice(&be16(self.channels));
            out.extend_from_slice(&be32(self.height));
            out.extend_from_slice(&be32(self.width));
            out.extend_from_slice(&be16(self.depth));
            out.extend_from_slice(&be16(self.mode));
            out.extend_from_slice(&section(&[])); // colour mode data
            out.extend_from_slice(&section(&[])); // image resources

            let mut info = Vec::new();
            if !self.layers.is_empty() {
                info.extend_from_slice(&(self.layers.len() as i16).to_be_bytes());
                for layer in &self.layers {
                    info.extend_from_slice(&layer.record());
                }
                for layer in &self.layers {
                    info.extend_from_slice(&layer.data());
                }
            }
            let mut block = section(&info);
            block.extend_from_slice(&section(&[])); // global layer mask info
            out.extend_from_slice(&section(&block));

            if let Some(planes) = &self.composite {
                out.extend_from_slice(&be16(0));
                for plane in planes {
                    out.extend_from_slice(plane);
                }
            }
            out
        }
    }

    // ---- The tests ------------------------------------------------------------

    /// The error a file comes back with. `Import` holds a whole document
    /// and is not worth a `Debug` just so `unwrap_err` can print it.
    fn refusal(bytes: &[u8]) -> PsdError {
        match load(bytes) {
            Err(e) => e,
            Ok(_) => panic!("that file was supposed to be refused"),
        }
    }

    fn layer_named<'a>(import: &'a Import, name: &str) -> &'a Layer {
        import.document.layers().iter().find(|l| l.name == name).unwrap_or_else(|| panic!("no layer called {name}"))
    }

    #[test]
    fn layers_come_in_bottom_first_with_what_they_were_set_to() {
        let mut b = Builder::new(8, 8);
        b.layers.push(TestLayer::new((0, 0, 8, 8), "Bottom").solid((255, 0, 0), 255));
        let mut top = TestLayer::new((2, 2, 6, 6), "Top").solid((0, 0, 255), 255);
        top.blend = *b"mul ";
        top.opacity = 128;
        top.flags = 0x02; // hidden
        b.layers.push(top);
        let import = load(&b.build()).unwrap();

        let layers = import.document.layers();
        assert_eq!(layers.len(), 2, "and no leftover background");
        assert_eq!(layers[0].name, "Bottom", "layers are stored bottom-first, as the file writes them");
        assert_eq!(layers[1].name, "Top");

        let bottom = &layers[0];
        assert_eq!(bottom.raster.get(0, 0), Rgba::opaque(255, 0, 0));
        assert!(bottom.visible);
        assert_eq!(bottom.blend, BlendMode::Normal);

        let top = &layers[1];
        assert_eq!(top.blend, BlendMode::Multiply);
        assert!((top.opacity - 128.0 / 255.0).abs() < 0.01);
        assert!(!top.visible, "a hidden layer comes in hidden");
        // It sat at (2,2) and is 4x4, so the rest of the canvas is empty.
        assert_eq!(top.raster.get(3, 3), Rgba::opaque(0, 0, 255));
        assert_eq!(top.raster.get(0, 0), Rgba::TRANSPARENT);
        assert_eq!(top.raster.get(7, 7), Rgba::TRANSPARENT);
        assert_eq!(import.note, None, "nothing had to be approximated");
    }

    #[test]
    fn a_clipped_layer_comes_in_clipped_to_the_one_below() {
        let mut b = Builder::new(8, 8);
        b.layers.push(TestLayer::new((0, 0, 8, 8), "Base").solid((255, 0, 0), 255));
        let mut over = TestLayer::new((0, 0, 8, 8), "Over").solid((0, 0, 255), 255);
        over.clipping = 1;
        b.layers.push(over);
        let import = load(&b.build()).unwrap();
        assert!(!layer_named(&import, "Base").clipped);
        assert!(layer_named(&import, "Over").clipped);
        assert_eq!(import.document.clip_base(1), Some(0));
        assert_eq!(import.note, None, "nothing had to be approximated");
    }

    #[test]
    fn run_length_encoded_channels_come_out_the_same() {
        let mut raw = Builder::new(6, 4);
        raw.layers.push(TestLayer::new((0, 0, 4, 6), "L").solid((10, 200, 30), 255));
        let mut packed = Builder::new(6, 4);
        let mut layer = TestLayer::new((0, 0, 4, 6), "L").solid((10, 200, 30), 255);
        layer.rle = true;
        packed.layers.push(layer);

        let a = load(&raw.build()).unwrap();
        let b = load(&packed.build()).unwrap();
        assert_eq!(layer_named(&a, "L").raster, layer_named(&b, "L").raster);
        assert_eq!(layer_named(&b, "L").raster.get(3, 2), Rgba::opaque(10, 200, 30));
    }

    #[test]
    fn a_file_whose_layers_cannot_be_read_opens_flattened() {
        let mut b = Builder::new(4, 4).flattened((20, 40, 60));
        let mut layer = TestLayer::new((0, 0, 4, 4), "Unreadable").solid((1, 2, 3), 255);
        layer.zipped = true;
        b.layers.push(layer);
        let import = load(&b.build()).unwrap();

        assert_eq!(import.document.layers().len(), 1);
        assert_eq!(import.document.layers()[0].raster.get(2, 2), Rgba::opaque(20, 40, 60));
        let note = import.note.expect("the user is told what happened");
        assert!(note.contains("zip-compressed"), "{note}");
        assert!(note.contains("flattened"), "{note}");
    }

    #[test]
    fn a_file_with_neither_is_an_error() {
        let mut b = Builder::new(4, 4); // no composite section at all
        let mut layer = TestLayer::new((0, 0, 4, 4), "Unreadable").solid((1, 2, 3), 255);
        layer.zipped = true;
        b.layers.push(layer);
        assert_eq!(refusal(&b.build()), PsdError::NoPixels);
    }

    /// A folder, written the way Photoshop writes one: the marker that its
    /// contents begin, then the contents bottom-first, then the folder's
    /// own record above them. `kind` is 1 for an open folder, 2 for a
    /// folder that was left folded shut.
    fn folder(b: &mut Builder, name: &str, kind: u32, contents: Vec<TestLayer>) {
        let mut open = TestLayer::new((0, 0, 0, 0), "</Layer group>");
        open.divider = Some(3);
        b.layers.push(open);
        b.layers.extend(contents);
        let mut close = TestLayer::new((0, 0, 0, 0), name);
        close.divider = Some(kind);
        close.blend = *b"pass";
        b.layers.push(close);
    }

    #[test]
    fn a_folder_comes_in_as_a_group_with_its_layers_inside_it() {
        let mut b = Builder::new(4, 4);
        b.layers.push(TestLayer::new((0, 0, 4, 4), "Background").solid((9, 9, 9), 255));
        let contents = vec![
            TestLayer::new((0, 0, 4, 4), "Trunk").solid((1, 1, 1), 255),
            TestLayer::new((0, 0, 4, 4), "Leaves").solid((2, 2, 2), 255),
        ];
        folder(&mut b, "Tree", 1, contents);
        b.layers.push(TestLayer::new((0, 0, 4, 4), "Sky").solid((3, 3, 3), 255));
        let import = load(&b.build()).unwrap();
        let doc = &import.document;

        // Bottom-first, with the folder's own row over its contents — the
        // arrangement the document keeps, so nothing had to be rearranged.
        let names: Vec<&str> = doc.layers().iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["Background", "Trunk", "Leaves", "Tree", "Sky"]);
        assert_eq!(doc.layer(3).unwrap().kind.name(), "group");
        assert_eq!(doc.depth(1), 1, "Trunk is inside the group");
        assert_eq!(doc.depth(2), 1);
        assert_eq!(doc.depth(4), 0, "Sky is not");
        assert_eq!(doc.children_of(3), 1..3);
        assert_eq!(doc.layer(3).unwrap().blend, BlendMode::PassThrough, "a pass-through folder stays pass-through");
        assert!(!doc.layer(3).unwrap().collapsed, "kind 1 is an open folder");
        assert_eq!(import.note, None, "nothing had to be approximated");
    }

    #[test]
    fn folders_nest_and_a_shut_one_comes_in_shut() {
        let mut b = Builder::new(4, 4);
        let mut inner = Builder::new(4, 4);
        folder(&mut inner, "Inner", 2, vec![TestLayer::new((0, 0, 4, 4), "Deep").solid((1, 1, 1), 255)]);
        folder(&mut b, "Outer", 1, inner.layers);
        let import = load(&b.build()).unwrap();
        let doc = &import.document;

        let names: Vec<&str> = doc.layers().iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["Deep", "Inner", "Outer"]);
        assert_eq!(doc.depth(0), 2, "two folders deep");
        assert_eq!(doc.depth(1), 1);
        assert_eq!(doc.depth(2), 0);
        assert!(doc.layer(1).unwrap().collapsed, "kind 2 is a folder left shut");
        assert_eq!(import.note, None);
    }

    #[test]
    fn a_folder_that_was_not_written_whole_leaves_its_layers_loose() {
        let mut b = Builder::new(4, 4);
        b.layers.push(TestLayer::new((0, 0, 4, 4), "Art").solid((9, 9, 9), 255));
        // A folder record with no opening marker under it: there is no
        // saying what it was meant to hold.
        let mut close = TestLayer::new((0, 0, 0, 0), "Group 1");
        close.divider = Some(1);
        b.layers.push(close);
        let import = load(&b.build()).unwrap();

        let names: Vec<&str> = import.document.layers().iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["Art"]);
        assert!(import.note.unwrap().contains("groups"));
    }

    #[test]
    fn a_folders_own_settings_come_in_with_it() {
        let mut b = Builder::new(8, 8);
        folder(&mut b, "Dimmed", 1, vec![TestLayer::new((0, 0, 8, 8), "Art").solid((9, 9, 9), 255)]);
        // The folder's record is the last one; give it half opacity, a
        // blend mode of its own and a mask.
        let close = b.layers.last_mut().expect("the folder");
        close.opacity = 128;
        close.blend = *b"mul ";
        close.flags = 0x02; // hidden
        close.mask = Some((2, 2, 6, 6, 0));
        close.channels.push((-2, vec![255; 16]));
        let import = load(&b.build()).unwrap();

        let group = import.document.layer(1).expect("the group");
        assert_eq!(group.kind.name(), "group");
        assert_eq!(group.blend, BlendMode::Multiply);
        assert!((group.opacity - 128.0 / 255.0).abs() < 0.01);
        assert!(!group.visible);
        let mask = group.mask.as_ref().expect("the group's mask");
        assert_eq!(mask.get(3, 3), Rgba::opaque(255, 255, 255));
        assert_eq!(mask.get(0, 0), Rgba::opaque(0, 0, 0));
    }

    #[test]
    fn a_blend_mode_with_no_equivalent_becomes_normal_and_says_so() {
        let mut b = Builder::new(4, 4);
        let mut layer = TestLayer::new((0, 0, 4, 4), "Vivid").solid((9, 9, 9), 255);
        layer.blend = *b"vLit"; // vivid light, which this engine has not got
        b.layers.push(layer);
        let import = load(&b.build()).unwrap();
        assert_eq!(import.document.layers()[0].blend, BlendMode::Normal);
        assert!(import.note.unwrap().contains("blend modes"));
    }

    #[test]
    fn the_unicode_name_wins_over_the_old_one() {
        let mut b = Builder::new(4, 4);
        let mut layer = TestLayer::new((0, 0, 4, 4), "Layer 1").solid((9, 9, 9), 255);
        layer.unicode_name = Some("Café — sketch".to_owned());
        b.layers.push(layer);
        let import = load(&b.build()).unwrap();
        assert_eq!(import.document.layers()[0].name, "Café — sketch");
    }

    #[test]
    fn a_layer_mask_comes_in_as_a_mask() {
        let mut b = Builder::new(8, 8);
        let mut layer = TestLayer::new((0, 0, 8, 8), "Masked").solid((255, 255, 255), 255);
        // A 4x4 mask at (2,2), white inside, black everywhere else.
        layer.mask = Some((2, 2, 6, 6, 0));
        layer.channels.push((-2, vec![255; 16]));
        b.layers.push(layer);
        let import = load(&b.build()).unwrap();

        let mask = import.document.layers()[0].mask.as_ref().expect("a mask");
        assert!(import.document.layers()[0].mask_enabled);
        assert_eq!(mask.get(3, 3), Rgba::opaque(255, 255, 255), "inside the mask's rectangle it reveals");
        assert_eq!(mask.get(0, 0), Rgba::opaque(0, 0, 0), "and outside it takes the default colour");
    }

    #[test]
    fn a_greyscale_file_comes_in_grey() {
        let mut b = Builder::new(4, 4);
        b.mode = GREY;
        b.channels = 1;
        let mut layer = TestLayer::new((0, 0, 4, 4), "Grey");
        layer.channels = vec![(-1, vec![255; 16]), (0, vec![90; 16])];
        b.layers.push(layer);
        let import = load(&b.build()).unwrap();
        assert_eq!(import.document.layers()[0].raster.get(1, 1), Rgba::opaque(90, 90, 90));
    }

    #[test]
    fn the_flattened_copy_can_be_run_length_encoded_too() {
        // Straight from `read_composite`: one table of row lengths for
        // every row of every channel, then the packed rows.
        let (w, h) = (5usize, 3usize);
        let planes: Vec<Vec<u8>> = vec![vec![11; w * h], vec![22; w * h], vec![33; w * h]];
        let mut body = Vec::new();
        let mut rows = Vec::new();
        for plane in &planes {
            for y in 0..h {
                rows.push(pack_row(&plane[y * w..(y + 1) * w]));
            }
        }
        for row in &rows {
            body.extend_from_slice(&be16(row.len() as u16));
        }
        for row in &rows {
            body.extend_from_slice(row);
        }

        let b = Builder::new(w as u32, h as u32);
        let mut bytes = b.build();
        bytes.extend_from_slice(&be16(1));
        bytes.extend_from_slice(&body);
        let import = load(&bytes).unwrap();
        assert_eq!(import.document.layers()[0].raster.get(4, 2), Rgba::opaque(11, 22, 33));
    }

    #[test]
    fn what_it_refuses_it_says_why() {
        assert_eq!(refusal(b"not a psd at all"), PsdError::NotPsd);
        assert_eq!(refusal(&[]), PsdError::NotPsd);

        let mut psb = Builder::new(4, 4);
        psb.version = 2;
        assert_eq!(refusal(&psb.build()), PsdError::Version(2));

        let mut deep = Builder::new(4, 4);
        deep.depth = 16;
        assert_eq!(refusal(&deep.build()), PsdError::Depth(16));

        let mut cmyk = Builder::new(4, 4);
        cmyk.mode = 4;
        assert_eq!(refusal(&cmyk.build()), PsdError::ColorMode("CMYK"));

        let mut huge = Builder::new(30_000, 30_000);
        huge.composite = None;
        assert_eq!(refusal(&huge.build()), PsdError::TooBig(30_000, 30_000));

        // And every one of them says something a person could act on.
        for error in [PsdError::NotPsd, PsdError::Version(2), PsdError::Depth(16), PsdError::ColorMode("CMYK"), PsdError::TooBig(9, 9), PsdError::NoPixels, PsdError::Corrupt("x")] {
            assert!(!error.to_string().is_empty());
        }
    }

    // ---- Real files ------------------------------------------------------------
    //
    // Everything above builds its own `.psd`, which only ever proves that the
    // reader copes with what this file *thinks* Photoshop writes. Files that
    // Photoshop actually wrote are the other half of it, and they are far too
    // big to keep in the repository — so this test reads whatever is in
    // `npaint/test_psds/` and says nothing at all when there is nothing there.
    //
    // Drop a `.psd` in that directory and it is covered from then on. There
    // is no expected output to keep up to date: what is checked is that the
    // file reads, and that what comes out is a document the rest of the
    // engine will accept — every raster the size the document says, a
    // composite that does not fall over, and a round trip through
    // `file::save`/`file::load` that comes back the same. Those are the
    // invariants a hand-built file cannot vouch for, because a hand-built
    // file was built to satisfy them.
    //
    // `NPAINT_PSD_DIR` points it somewhere else, for a folder of files kept
    // outside the working copy. `npaint/test_psds/` is gitignored, for the
    // same reason the models are.
    //
    // It is the one slow test in the crate — a real file is tens of
    // megabytes and this build is unoptimised. `cargo test --release` makes
    // it disappear if it starts getting in the way.

    /// Where the sample files live, if they live anywhere.
    fn fixture_dir() -> std::path::PathBuf {
        match std::env::var_os("NPAINT_PSD_DIR") {
            Some(dir) => std::path::PathBuf::from(dir),
            None => std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("test_psds"),
        }
    }

    fn fixtures() -> Vec<std::path::PathBuf> {
        let Ok(entries) = std::fs::read_dir(fixture_dir()) else { return Vec::new() };
        let mut found: Vec<std::path::PathBuf> = entries
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("psd")))
            .collect();
        found.sort();
        found
    }

    #[test]
    fn files_photoshop_actually_wrote() {
        let files = fixtures();
        if files.is_empty() {
            // A clean checkout has none of these, and that is not a failure.
            println!("no .psd fixtures in {}; skipping", fixture_dir().display());
            return;
        }
        for path in files {
            let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
            let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("{name}: {e}"));
            let import = match load(&bytes) {
                Ok(import) => import,
                Err(e) => panic!("{name} would not open: {e}"),
            };
            let document = import.document;
            let (w, h) = (document.width(), document.height());
            println!(
                "{name}: {w} x {h}, {} layers, note {:?}",
                document.layers().len(),
                import.note
            );
            assert!(w > 0 && h > 0, "{name} came back with no size");
            assert!(crate::editor::canvas_fits(w, h), "{name} came back larger than a document may be");
            assert!(!document.layers().is_empty(), "{name} came back with no layers");

            for (i, layer) in document.layers().iter().enumerate() {
                if layer.has_pixels() {
                    assert_eq!(
                        (layer.raster.width(), layer.raster.height()),
                        (w, h),
                        "{name}: layer {:?} is not the size of the document",
                        layer.name
                    );
                }
                // A group that came in must hold the run of layers below
                // its own row, and nothing else; `from_parts` has checked
                // the arrangement, so this is what it amounts to.
                if layer.is_group() {
                    let children = document.children_of(i);
                    assert!(
                        children.clone().all(|c| document.depth(c) > document.depth(i)),
                        "{name}: the group {:?} does not hold what is under it",
                        layer.name
                    );
                }
                if let Some(parent) = layer.parent {
                    let at = document.index_of(parent).unwrap_or_else(|| panic!("{name}: {:?} is in a group that is not there", layer.name));
                    assert!(document.layers()[at].is_group() && at > i, "{name}: {:?}'s group is not above it", layer.name);
                }
                if let Some(mask) = &layer.mask {
                    assert_eq!((mask.width(), mask.height()), (w, h), "{name}: {:?} has a mask of the wrong size", layer.name);
                }
                assert!((0.0..=1.0).contains(&layer.opacity), "{name}: {:?} has an opacity of {}", layer.name, layer.opacity);
            }

            let composite = document.composite();
            assert_eq!((composite.width(), composite.height()), (w, h), "{name}: the composite is the wrong size");

            // And what the writer makes of it is a file this reader opens
            // again unchanged. Nothing Photoshop wrote arrives as an
            // adjustment layer or a smart object, so there is nothing here
            // the writer has to give up and the two stacks must match.
            let export = save(&document);
            assert_eq!(export.note, None, "{name}: writing it gave something up");
            let there_and_back = match load(&export.bytes) {
                Ok(import) => import.document,
                Err(e) => panic!("{name}: what the writer wrote would not open: {e}"),
            };
            assert_eq!(there_and_back.layers().len(), document.layers().len(), "{name}: lost a layer through the .psd writer");
            for (before, after) in document.layers().iter().zip(there_and_back.layers()) {
                assert_eq!(before.name, after.name, "{name}: through the .psd writer");
                assert_eq!(before.blend, after.blend, "{name}: {:?} through the .psd writer", before.name);
                assert_eq!(before.visible, after.visible, "{name}: {:?} through the .psd writer", before.name);
                assert_eq!(before.clipped, after.clipped, "{name}: {:?} through the .psd writer", before.name);
                assert_eq!(before.raster, after.raster, "{name}: {:?} came back different through the .psd writer", before.name);
                assert_eq!(before.mask, after.mask, "{name}: {:?}'s mask came back different through the .psd writer", before.name);
                assert_eq!(before.kind.name(), after.kind.name(), "{name}: {:?} through the .psd writer", before.name);
            }
            assert_eq!(described(&there_and_back), described(&document), "{name}: the stack came back arranged differently");

            // And it is a document the rest of the engine accepts: NPaint's
            // own file writes it and reads it back unchanged.
            let guides = crate::snap::Guides::default();
            let saved = crate::file::save(&document, &guides);
            let (reread, _) = crate::file::load(&saved).unwrap_or_else(|e| panic!("{name}: saving it made a file NPaint cannot open: {e}"));
            assert_eq!(reread.layers().len(), document.layers().len(), "{name}: lost a layer on the way through the file");
            for (before, after) in document.layers().iter().zip(reread.layers()) {
                assert_eq!(before.name, after.name, "{name}");
                assert_eq!(before.blend, after.blend, "{name}: {:?}", before.name);
                assert_eq!(before.visible, after.visible, "{name}: {:?}", before.name);
                assert_eq!(before.raster, after.raster, "{name}: {:?} came back different", before.name);
                assert_eq!(before.mask, after.mask, "{name}: {:?}'s mask came back different", before.name);
                assert_eq!(before.parent, after.parent, "{name}: {:?} came back in a different group", before.name);
                assert_eq!(before.kind.name(), after.kind.name(), "{name}: {:?}", before.name);
            }
        }
    }

    #[test]
    fn packbits_copes_with_a_damaged_row() {
        // A run that claims more bytes than are there, and the no-op byte.
        let mut out = Vec::new();
        unpack_bits(&[0x02, 1, 2], 8, &mut out);
        assert_eq!(out, vec![1, 2, 0, 0, 0, 0, 0, 0], "short data is padded, not a panic");

        let mut out = Vec::new();
        unpack_bits(&[0x80, 0xFE, 7], 4, &mut out);
        assert_eq!(out, vec![7, 7, 7, 0], "-128 does nothing; -2 repeats three times");
    }

    // ---- Writing ----------------------------------------------------------------
    //
    // The reader above is what checks the writer: a document that goes out
    // and comes back the same has been written in a way this reader — and
    // so, in the shape of the format, Photoshop — understands.

    use crate::adjust::Kind;
    use crate::layer::Target;

    fn pixel_layer(id: u32, name: &str, colour: Rgba, width: u32, height: u32) -> Layer {
        Layer::new(LayerId(id), name, Raster::filled(width, height, colour))
    }

    fn document_of(width: u32, height: u32, layers: Vec<Layer>) -> Document {
        let top = layers.len() - 1;
        Document::from_parts(width, height, layers, top).expect("a sound stack")
    }

    /// Everything the writer says about a layer, for comparing two stacks
    /// without a page of assertions each time. The group a layer is in is
    /// named rather than numbered: ids are the document's own and a file
    /// hands out fresh ones on the way back in.
    fn described(document: &Document) -> Vec<String> {
        document
            .layers()
            .iter()
            .map(|layer| {
                let parent = layer.parent.and_then(|id| document.index_of(id)).map(|at| document.layers()[at].name.as_str());
                format!(
                    "{} {} {:?} {} {} {} {} {}",
                    layer.name,
                    layer.kind.name(),
                    layer.blend,
                    (layer.opacity * 255.0).round(),
                    layer.visible,
                    layer.clipped,
                    parent.unwrap_or("-"),
                    layer.mask.is_some(),
                )
            })
            .collect()
    }

    fn round_trip(document: &Document) -> Import {
        let export = save(document);
        load(&export.bytes).expect("what the writer wrote, the reader reads")
    }

    #[test]
    fn a_stack_of_layers_goes_out_and_comes_back_the_same() {
        let mut bottom = pixel_layer(1, "Background", Rgba::opaque(200, 30, 30), 8, 8);
        bottom.opacity = 0.5;
        let mut top = pixel_layer(2, "Caf\u{e9} \u{2014} sketch", Rgba::opaque(0, 0, 255), 8, 8);
        top.blend = BlendMode::Multiply;
        top.visible = false;
        let mut clipped = pixel_layer(3, "Clipped", Rgba::opaque(0, 255, 0), 8, 8);
        clipped.clipped = true;
        let document = document_of(8, 8, vec![bottom, top, clipped]);

        let import = round_trip(&document);
        assert_eq!(import.note, None, "nothing had to be given up");
        assert_eq!(described(&import.document), described(&document));
        for (before, after) in document.layers().iter().zip(import.document.layers()) {
            assert_eq!(before.raster, after.raster, "{:?} came back with different pixels", before.name);
        }
        assert_eq!(import.document.composite(), document.composite());
    }

    #[test]
    fn a_layer_smaller_than_the_canvas_keeps_where_it_sat() {
        // Written at its own rectangle, as a `.psd` layer is, and placed
        // back at that corner on the way in.
        let mut layer = pixel_layer(1, "Patch", Rgba::TRANSPARENT, 8, 8);
        layer.raster.fill_rect(Rect::new(2, 3, 3, 2), Rgba::opaque(10, 20, 30), &Rect::new(0, 0, 8, 8));
        let document = document_of(8, 8, vec![layer]);

        let import = round_trip(&document);
        let back = &import.document.layers()[0].raster;
        assert_eq!(back.get(2, 3), Rgba::opaque(10, 20, 30));
        assert_eq!(back.get(4, 4), Rgba::opaque(10, 20, 30));
        assert_eq!(back.get(1, 3), Rgba::TRANSPARENT);
        assert_eq!(back.get(5, 4), Rgba::TRANSPARENT);
    }

    #[test]
    fn an_empty_layer_is_still_a_layer_when_it_comes_back() {
        let document = document_of(4, 4, vec![pixel_layer(1, "Nothing on it", Rgba::TRANSPARENT, 4, 4)]);
        let import = round_trip(&document);
        assert_eq!(import.document.layers().len(), 1);
        assert_eq!(import.document.layers()[0].name, "Nothing on it");
        assert_eq!(import.document.layers()[0].raster, Raster::new(4, 4));
    }

    #[test]
    fn groups_go_out_as_folders_and_come_back_nested() {
        // Outer { Inner { Deep }, Beside }, with a plain layer under it all.
        let mut inner = Layer::new_group(LayerId(4), "Inner");
        inner.blend = BlendMode::Screen;
        let mut outer = Layer::new_group(LayerId(5), "Outer");
        outer.collapsed = true;
        outer.opacity = 0.25;
        let mut deep = pixel_layer(2, "Deep", Rgba::opaque(0, 128, 0), 8, 8);
        deep.parent = Some(LayerId(4));
        let mut beside = pixel_layer(3, "Beside", Rgba::opaque(0, 0, 128), 8, 8);
        beside.parent = Some(LayerId(5));
        inner.parent = Some(LayerId(5));
        let document = document_of(8, 8, vec![pixel_layer(1, "Floor", Rgba::opaque(9, 9, 9), 8, 8), deep, inner, beside, outer]);

        let import = round_trip(&document);
        assert_eq!(import.note, None);
        assert_eq!(described(&import.document), described(&document), "the nesting and the settings both came back");
        assert!(layer_named(&import, "Outer").collapsed, "a shut folder comes back shut");
        assert_eq!(layer_named(&import, "Outer").blend, BlendMode::PassThrough, "which is what a group defaults to");
        assert_eq!(import.document.composite(), document.composite());
    }

    #[test]
    fn a_mask_goes_out_with_its_layer_switched_on_or_off() {
        let mut on = pixel_layer(1, "Masked", Rgba::opaque(255, 255, 255), 6, 6);
        let mut mask = Raster::filled(6, 6, Rgba::opaque(0, 0, 0));
        mask.fill_rect(Rect::new(1, 1, 3, 3), Rgba::opaque(255, 255, 255), &Rect::new(0, 0, 6, 6));
        on.mask = Some(mask.clone());
        let mut off = pixel_layer(2, "Mask off", Rgba::opaque(0, 0, 0), 6, 6);
        off.mask = Some(mask.clone());
        off.mask_enabled = false;
        let document = document_of(6, 6, vec![on, off]);

        let import = round_trip(&document);
        let back = layer_named(&import, "Masked");
        assert_eq!(back.mask.as_ref().expect("a mask"), &mask);
        assert!(back.mask_enabled);
        assert!(!layer_named(&import, "Mask off").mask_enabled, "a mask that was switched off comes back switched off");
        assert_eq!(import.document.composite(), document.composite());
    }

    #[test]
    fn an_adjustment_layer_is_flattened_and_the_note_says_so() {
        let mut document = document_of(
            8,
            8,
            vec![pixel_layer(1, "Floor", Rgba::opaque(200, 100, 50), 8, 8), pixel_layer(2, "Over", Rgba::opaque(0, 0, 60), 8, 8)],
        );
        document.add_adjustment_layer(Kind::Invert.into(), None);
        let over = document.add_layer_from("Above it", Raster::filled(8, 8, Rgba::new(255, 255, 255, 40))).unwrap();
        assert!(over > 0);
        let before = document.composite();

        let export = save(&document);
        let import = load(&export.bytes).unwrap();
        assert!(export.note.unwrap_or_default().contains("adjustment layers"), "the user is told what was given up");
        assert_eq!(import.document.composite(), before, "the picture is exactly what it was");
        assert_eq!(import.document.layers().len(), 2, "everything under the adjustment became one layer");
        assert_eq!(import.document.layers()[0].name, "Background");
        assert_eq!(import.document.layers()[1].name, "Above it");
    }

    #[test]
    fn an_adjustment_layer_at_the_top_of_the_stack_flattens_the_lot() {
        let mut document = document_of(4, 4, vec![pixel_layer(1, "Floor", Rgba::opaque(200, 100, 50), 4, 4)]);
        document.add_adjustment_layer(Kind::Invert.into(), None);
        let before = document.composite();

        let import = load(&save(&document).bytes).unwrap();
        assert_eq!(import.document.layers().len(), 1);
        assert_eq!(import.document.composite(), before);
    }

    #[test]
    fn an_adjustment_layer_inside_a_group_takes_the_whole_group_with_it() {
        // The cut may only fall between top-level items, so an adjustment
        // anywhere inside a group flattens the group it is in as well.
        let mut deep = pixel_layer(2, "Deep", Rgba::opaque(0, 128, 0), 8, 8);
        deep.parent = Some(LayerId(3));
        let mut document = document_of(
            8,
            8,
            vec![
                pixel_layer(1, "Floor", Rgba::opaque(200, 100, 50), 8, 8),
                deep,
                Layer::new_group(LayerId(3), "Folder"),
                pixel_layer(4, "Above it", Rgba::new(0, 0, 255, 60), 8, 8),
            ],
        );
        document.set_active(1).unwrap();
        document.add_adjustment_layer(Kind::Invert.into(), None);
        assert_eq!(document.layers()[2].parent, Some(LayerId(3)), "the adjustment went inside the folder");
        let before = document.composite();

        let import = load(&save(&document).bytes).unwrap();
        assert_eq!(import.document.composite(), before, "the picture is exactly what it was");
        assert_eq!(
            import.document.layers().iter().map(|layer| layer.name.as_str()).collect::<Vec<_>>(),
            vec!["Background", "Above it"]
        );
    }

    #[test]
    fn a_layer_clipped_to_what_the_adjustment_flattened_is_flattened_with_it() {
        // Cutting between a clipping base and what is clipped to it would
        // leave neither side a picture, so the cut moves up past them.
        // The folder holding the adjustment is what the layer above clips
        // to, so the cut cannot fall between them.
        let mut deep = pixel_layer(2, "Deep", Rgba::new(0, 0, 255, 200), 8, 8);
        deep.parent = Some(LayerId(3));
        let mut clipped = pixel_layer(4, "Clipped", Rgba::opaque(0, 255, 0), 8, 8);
        clipped.clipped = true;
        let mut document = document_of(
            8,
            8,
            vec![pixel_layer(1, "Floor", Rgba::opaque(200, 100, 50), 8, 8), deep, Layer::new_group(LayerId(3), "Folder"), clipped],
        );
        document.set_active(1).unwrap();
        document.add_adjustment_layer(Kind::Invert.into(), None);
        let before = document.composite();

        let import = load(&save(&document).bytes).unwrap();
        assert_eq!(import.document.composite(), before, "the picture is exactly what it was");
        assert_eq!(import.document.layers().len(), 1, "the base and what clips to it came down together");
    }

    #[test]
    fn a_smart_object_goes_out_as_its_pixels() {
        let mut document = document_of(8, 8, vec![pixel_layer(1, "Floor", Rgba::opaque(1, 2, 3), 8, 8)]);
        document.place_smart_object("Placed", Raster::filled(4, 4, Rgba::opaque(7, 8, 9)));
        let export = save(&document);
        let import = load(&export.bytes).unwrap();
        assert!(export.note.unwrap_or_default().contains("Smart objects"));
        assert_eq!(layer_named(&import, "Placed").kind.name(), "pixels");
        assert_eq!(import.document.composite(), document.composite());
    }

    /// The file with its layer section emptied: what a reader that cannot
    /// make sense of the layers is left with.
    fn without_layers(bytes: &[u8]) -> Vec<u8> {
        let at = 26 + 4 + 4; // the header, the colour mode data, the image resources
        let len = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        let mut out = bytes[..at].to_vec();
        out.extend_from_slice(&be32(0));
        out.extend_from_slice(&bytes[at + 4 + len..]);
        out
    }

    #[test]
    fn the_file_carries_a_flattened_copy_of_the_whole_picture() {
        let mut top = pixel_layer(2, "Over", Rgba::new(0, 0, 255, 128), 8, 8);
        top.blend = BlendMode::Multiply;
        let document = document_of(8, 8, vec![pixel_layer(1, "Floor", Rgba::opaque(200, 100, 50), 8, 8), top]);

        let import = load(&without_layers(&save(&document).bytes)).unwrap();
        assert_eq!(import.document.layers().len(), 1, "it opened flattened");
        assert_eq!(import.document.layers()[0].raster, document.composite());
    }

    #[test]
    fn a_mask_being_edited_is_written_as_a_mask_and_not_as_pixels() {
        // The target says which raster the tools are pointed at; it is the
        // editor's business and has nothing to do with what a file holds.
        let mut layer = pixel_layer(1, "Masked", Rgba::opaque(255, 0, 0), 4, 4);
        layer.mask = Some(Raster::filled(4, 4, Rgba::opaque(128, 128, 128)));
        layer.set_target(Target::Mask);
        let document = document_of(4, 4, vec![layer]);
        let import = round_trip(&document);
        assert_eq!(import.document.layers()[0].raster.get(0, 0), Rgba::opaque(255, 0, 0));
        assert_eq!(import.document.layers()[0].mask.as_ref().unwrap().get(0, 0), Rgba::opaque(128, 128, 128));
    }

    #[test]
    fn packbits_packs_what_it_unpacks() {
        let cases: Vec<Vec<u8>> = vec![
            vec![],
            vec![7],
            vec![1, 2, 3, 4, 5],
            vec![9; 300],                                        // longer than one run may be
            (0..255u8).collect(),                                // no run anywhere
            [vec![4; 5], vec![1, 2, 3], vec![8; 129]].concat(),   // runs and literals together
        ];
        for case in cases {
            let mut packed = Vec::new();
            let len = pack_bits(&case, &mut packed);
            assert_eq!(len, packed.len());
            let mut out = Vec::new();
            unpack_bits(&packed, case.len(), &mut out);
            assert_eq!(out, case, "{} bytes did not survive packing", case.len());
            assert!(packed.len() <= case.len() + case.len() / 128 + 1, "packing made it bigger");
        }
    }
}
