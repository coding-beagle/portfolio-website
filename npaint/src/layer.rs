//! One layer of a document: a raster plus the properties the layers panel
//! shows.

use crate::raster::Raster;

/// Identifies a layer for as long as the document lives, independent of its
/// position in the stack. The page keys its layer list on this so a reorder
/// does not rebuild every row.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct LayerId(pub u32);

/// How a layer combines with what is below it. Only `Normal` exists yet; the
/// enum is here so a second mode is an arm in [`Raster::composite_over`]'s
/// caller rather than a redesign.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum BlendMode {
    #[default]
    Normal,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Layer {
    id: LayerId,
    pub name: String,
    pub visible: bool,
    /// `0.0..=1.0`.
    pub opacity: f32,
    pub blend: BlendMode,
    pub raster: Raster,
}

impl Layer {
    pub fn new(id: LayerId, name: impl Into<String>, raster: Raster) -> Layer {
        Layer {
            id,
            name: name.into(),
            visible: true,
            opacity: 1.0,
            blend: BlendMode::Normal,
            raster,
        }
    }

    pub fn id(&self) -> LayerId {
        self.id
    }

    pub fn set_opacity(&mut self, opacity: f32) {
        self.opacity = opacity.clamp(0.0, 1.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opacity_is_clamped() {
        let mut layer = Layer::new(LayerId(1), "a", Raster::new(1, 1));
        layer.set_opacity(3.0);
        assert_eq!(layer.opacity, 1.0);
        layer.set_opacity(-3.0);
        assert_eq!(layer.opacity, 0.0);
    }
}
