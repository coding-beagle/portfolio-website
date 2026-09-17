//! Times the healing brush's blend at the sizes a stroke can reach.
//!
//! The cost is the region's area: a dab is nothing, and a scribble over a
//! whole 4K canvas is the one case worth knowing the number for, since the
//! blend runs in one go when the pointer comes up.

use npaint::heal::harmonic_fill;
use std::time::Instant;

/// A dab, a long stroke, and a scribble over most of a large canvas.
const REGIONS: &[(usize, usize)] = &[(120, 120), (600, 200), (2000, 1500)];

/// How far the edge of the region is from the edge of the grid.
const MARGIN: usize = 3;

fn main() {
    for &(width, height) in REGIONS {
        // Boundary data with some structure to it, so the solve is not
        // answering a constant.
        let known: Vec<[f32; 3]> = (0..width * height)
            .map(|i| {
                let level = ((i % 37) as f32) - 18.0;
                [level, -level, level * 0.5]
            })
            .collect();
        let unknown: Vec<bool> = (0..width * height)
            .map(|i| {
                let (x, y) = (i % width, i / width);
                x >= MARGIN && y >= MARGIN && x < width - MARGIN && y < height - MARGIN
            })
            .collect();
        let start = Instant::now();
        let filled = harmonic_fill(&known, &unknown, width, height);
        println!("{width}x{height}: {:?} ({} cells)", start.elapsed(), filled.len());
    }
}
