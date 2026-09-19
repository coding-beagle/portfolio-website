//! NPaint — a layer-based image editor in the style of Photoshop and Photopea.
//!
//! The crate is split into two halves:
//!
//! * **The engine**: [`editor::Editor`] and everything under it. Plain Rust,
//!   no browser types, fully unit-tested with `cargo test` on the host.
//! * **The wasm surface**: [`wasm::NPaint`], a thin `wasm_bindgen` wrapper the
//!   page in `www/` talks to. It converts between JavaScript types and the
//!   engine's, and nothing else.
//!
//! Coordinates come in two flavours. *Document* coordinates are pixels of the
//! image, origin top-left. *Screen* coordinates are CSS pixels of the canvas
//! element. [`viewport::Viewport`] maps between them; the engine's pointer
//! entry points take screen coordinates so that the page never has to know
//! about zoom.

pub mod adjust;
pub mod age;
pub mod autoselect;
pub mod blend;
pub mod brush;
pub mod checker;
pub mod color;
pub mod dither;
pub mod document;
pub mod editor;
pub mod file;
pub mod filter;
pub mod geometry;
pub mod gradient;
pub mod heal;
pub mod history;
pub mod layer;
pub mod mask;
pub mod palette;
pub mod psd;
pub mod raster;
pub mod selection;
pub mod snap;
pub mod text;
pub mod tools;
pub mod transform;
pub mod viewport;
pub mod wet;
pub mod wasm;
