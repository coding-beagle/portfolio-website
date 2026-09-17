//! The healing brush's blend: a cloned patch made to match where it lands.
//!
//! A copied patch is right in its *texture* and wrong in its *tone* — the
//! pixels came from somewhere else in the picture, so the seam shows wherever
//! the two places differ in brightness or colour. The cure is to keep the
//! patch's derivatives and solve for its intensities, which is Poisson's
//! equation with the surroundings as the boundary condition.
//!
//! Written here as a *correction* rather than as a solve of the pixels
//! themselves. If the answer keeps the patch's Laplacian exactly then the
//! difference between answer and patch has a Laplacian of zero, so all that
//! is wanted is the function that is harmonic inside the stroke and equals
//! (surroundings - patch) at its edge. Add that to the patch and the seam is
//! gone, and because it is smooth it carries the patch's detail through
//! untouched. That is what [`harmonic_fill`] works out.
//!
//! Gauss-Seidel on its own is no use here: it settles the fine detail in a
//! few sweeps and the long wavelengths at a rate that goes as the square of
//! the region's width, so a brush stroke a thousand pixels long would need
//! millions of them. So the answer is worked out on a halved grid first —
//! and that one on a halved grid again, down to a few cells across, where a
//! sweep crosses the whole region — and each level starts from the one below
//! it and needs only a few sweeps of its own to add the detail its
//! resolution brings. Axes are halved separately, so a long thin stroke is
//! coarsened along its length rather than stopping at its width.

/// One colour's worth of difference, kept as floats because the correction
/// is a signed quantity that has to stay smooth well below a level.
pub type Rgb = [f32; 3];

/// Grids are coarsened until both sides are down to this, which is small
/// enough that a sweep carries information from one edge to the other.
const COARSEST: usize = 8;

/// Sweeps at each level on the way up. The coarse answer already holds the
/// long wavelengths; these add what the finer grid can say and no more.
const SWEEPS: usize = 8;

/// Sweeps at the coarsest grid, which is where the answer is really found.
/// At `COARSEST` cells across, that is a few thousand operations.
const COARSEST_SWEEPS: usize = 200;

/// A grid of the values that are known, and which cells are not.
struct Grid {
    width: usize,
    height: usize,
    /// The boundary condition where `unknown` is false. Where it is true the
    /// entry is ignored by the solve, but still averaged into the coarser
    /// grids, so it should be the best guess there is.
    known: Vec<Rgb>,
    unknown: Vec<bool>,
}

/// The function that equals `known` wherever `unknown` is false and is the
/// average of its four neighbours everywhere else — the smoothest surface
/// that meets the given edge, and the correction a healing brush adds to its
/// cloned patch.
///
/// Every cell on the grid's border must be known, or the problem has no
/// boundary to be pinned to; a caller builds the grid one cell wider than
/// the region it is filling, which guarantees it.
///
/// Exact for a grid whose sides halve evenly all the way down. Any other
/// size leaves the coarse grids with a half-width block at one end, whose
/// centre is not where the others' are, and the answer comes back tilted by
/// a fraction of a percent of the range of its edge. The fine grid's own
/// boundary is met exactly either way, which is what decides whether a seam
/// shows.
pub fn harmonic_fill(known: &[Rgb], unknown: &[bool], width: usize, height: usize) -> Vec<Rgb> {
    debug_assert_eq!(known.len(), width * height);
    debug_assert_eq!(unknown.len(), width * height);
    let mut levels = vec![Grid { width, height, known: known.to_vec(), unknown: unknown.to_vec() }];
    while levels.last().is_some_and(|g| g.width > COARSEST || g.height > COARSEST) {
        levels.push(coarsen(levels.last().unwrap()));
    }
    let coarsest = levels.last().unwrap();
    let mut values = coarsest.known.clone();
    relax(&mut values, coarsest, COARSEST_SWEEPS);
    for level in (0..levels.len() - 1).rev() {
        values = prolongate(&values, &levels[level + 1], &levels[level]);
        relax(&mut values, &levels[level], SWEEPS);
    }
    values
}

/// The same grid at half the resolution along whichever axes are still
/// bigger than [`COARSEST`]. A coarse cell is the average of the block of
/// fine cells under it, and is unknown only when every one of them is, which
/// keeps the grid's border known at every level.
fn coarsen(fine: &Grid) -> Grid {
    let (step_x, step_y) = steps(fine.width, fine.height);
    let width = fine.width.div_ceil(step_x);
    let height = fine.height.div_ceil(step_y);
    let mut known = vec![[0.0; 3]; width * height];
    let mut unknown = vec![false; width * height];
    for y in 0..height {
        for x in 0..width {
            let mut sum = [0.0f32; 3];
            let mut count = 0.0;
            let mut all_unknown = true;
            for fy in y * step_y..((y + 1) * step_y).min(fine.height) {
                for fx in x * step_x..((x + 1) * step_x).min(fine.width) {
                    let f = fy * fine.width + fx;
                    for (total, value) in sum.iter_mut().zip(fine.known[f]) {
                        *total += value;
                    }
                    count += 1.0;
                    all_unknown &= fine.unknown[f];
                }
            }
            let i = y * width + x;
            known[i] = [sum[0] / count, sum[1] / count, sum[2] / count];
            unknown[i] = all_unknown;
        }
    }
    Grid { width, height, known, unknown }
}

/// How much each axis shrinks on the way to the next grid: an axis already
/// down to [`COARSEST`] stays as it is, so a long thin region goes on being
/// coarsened along its length.
fn steps(width: usize, height: usize) -> (usize, usize) {
    (if width > COARSEST { 2 } else { 1 }, if height > COARSEST { 2 } else { 1 })
}

/// Gauss-Seidel: replace every unknown cell with the average of its four
/// neighbours, in place, so a sweep carries the new values along with it.
fn relax(values: &mut [Rgb], grid: &Grid, sweeps: usize) {
    if grid.width < 3 || grid.height < 3 {
        return;
    }
    for _ in 0..sweeps {
        for y in 1..grid.height - 1 {
            for x in 1..grid.width - 1 {
                let i = y * grid.width + x;
                if !grid.unknown[i] {
                    continue;
                }
                let neighbours =
                    [values[i - 1], values[i + 1], values[i - grid.width], values[i + grid.width]];
                let mut sum = [0.0f32; 3];
                for neighbour in neighbours {
                    for (total, value) in sum.iter_mut().zip(neighbour) {
                        *total += value;
                    }
                }
                values[i] = sum.map(|total| total * 0.25);
            }
        }
    }
}

/// A coarse answer as the fine grid's starting point: bilinear between the
/// coarse cells' centres for the unknowns, and the exact boundary condition
/// for the rest, since a known value must never be diluted by the coarse
/// grid's averaging.
fn prolongate(coarse: &[Rgb], from: &Grid, to: &Grid) -> Vec<Rgb> {
    let mut out = to.known.clone();
    let rows: Vec<_> = (0..to.height).map(|y| between(y, to.height, from.height)).collect();
    let columns: Vec<_> = (0..to.width).map(|x| between(x, to.width, from.width)).collect();
    for (y, &(top, bottom, ty)) in rows.iter().enumerate() {
        for (x, &(left, right, tx)) in columns.iter().enumerate() {
            let i = y * to.width + x;
            if !to.unknown[i] {
                continue;
            }
            let at = |cx: usize, cy: usize| coarse[cy * from.width + cx];
            let (top_left, top_right) = (at(left, top), at(right, top));
            let (bottom_left, bottom_right) = (at(left, bottom), at(right, bottom));
            out[i] = std::array::from_fn(|c| {
                let above = mix(top_left[c], top_right[c], tx);
                let below = mix(bottom_left[c], bottom_right[c], tx);
                mix(above, below, ty)
            });
        }
    }
    out
}

fn mix(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// The two coarse cells a fine cell sits between along one axis, and how far
/// it is from the first to the second.
///
/// The last block of an axis that did not divide evenly is half the width of
/// the others, so its centre is not where a plain halving would put it;
/// interpolating between the centres themselves is what keeps a coarse
/// answer from arriving shifted, which shows up as a tilt in the correction.
fn between(fine: usize, fine_len: usize, coarse_len: usize) -> (usize, usize, f32) {
    if coarse_len == fine_len {
        return (fine, fine, 0.0);
    }
    let centre = |cell: usize| {
        let start = cell * 2;
        let end = (start + 2).min(fine_len);
        (start + end - 1) as f32 / 2.0
    };
    let here = fine / 2;
    let (first, second) = if (fine as f32) < centre(here) {
        (here.saturating_sub(1), here)
    } else {
        (here, (here + 1).min(coarse_len - 1))
    };
    if first == second {
        return (first, second, 0.0);
    }
    let t = (fine as f32 - centre(first)) / (centre(second) - centre(first));
    (first, second, t.clamp(0.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A grid with a hole in the middle, its known values set by `edge`.
    fn with_hole(
        width: usize,
        height: usize,
        margin: usize,
        edge: impl Fn(usize, usize) -> f32,
    ) -> (Vec<Rgb>, Vec<bool>) {
        let mut known = vec![[0.0; 3]; width * height];
        let mut unknown = vec![false; width * height];
        for y in 0..height {
            for x in 0..width {
                let i = y * width + x;
                let value = edge(x, y);
                known[i] = [value, value * 0.5, -value];
                let inside = x >= margin && y >= margin;
                unknown[i] = inside && x < width - margin && y < height - margin;
            }
        }
        (known, unknown)
    }

    /// How far the first channel strays from the plane it should be.
    fn off_the_plane(out: &[Rgb], width: usize, plane: impl Fn(usize, usize) -> f32) -> f32 {
        out.iter()
            .enumerate()
            .map(|(i, v)| (v[0] - plane(i % width, i / width)).abs())
            .fold(0.0f32, f32::max)
    }

    #[test]
    fn a_constant_edge_fills_with_that_constant() {
        let (known, unknown) = with_hole(40, 30, 3, |_, _| 7.0);
        let out = harmonic_fill(&known, &unknown, 40, 30);
        for (i, value) in out.iter().enumerate() {
            assert!((value[0] - 7.0).abs() < 0.01, "cell {i}: {value:?}");
            assert!((value[2] + 7.0).abs() < 0.01, "cell {i}: {value:?}");
        }
    }

    /// A plane is harmonic, so the fill has to reproduce it exactly — which
    /// exercises the whole solver, boundary conditions and the transfers
    /// between grids included. Sides that halve evenly all the way down are
    /// the case where "exactly" is the right word; see the test below it.
    #[test]
    fn a_sloping_edge_fills_with_the_plane_that_meets_it() {
        let slope = |x: usize, y: usize| 2.0 * x as f32 - 3.0 * y as f32 + 5.0;
        let (width, height) = (64, 48);
        let (known, unknown) = with_hole(width, height, 2, slope);
        let out = harmonic_fill(&known, &unknown, width, height);
        let worst = off_the_plane(&out, width, slope);
        assert!(worst < 0.01, "off the plane by {worst}");
    }

    /// A grid that does not halve evenly is coarsened into blocks that are
    /// not all the same size, and the five-point Laplacian over centres that
    /// are not evenly spaced does not leave a ramp quite alone. The fine
    /// grid's own boundary is still met exactly — which is what a seam is —
    /// so what is left is a slight tilt across the middle, well under a
    /// level for corrections of the size a photograph gives.
    #[test]
    fn an_awkward_size_comes_back_slightly_tilted_and_no_worse() {
        let slope = |x: usize, y: usize| 2.0 * x as f32 - 3.0 * y as f32 + 5.0;
        let (width, height) = (70, 50);
        let (known, unknown) = with_hole(width, height, 2, slope);
        let out = harmonic_fill(&known, &unknown, width, height);
        let range = 2.0 * width as f32 + 3.0 * height as f32;
        let worst = off_the_plane(&out, width, slope);
        assert!(worst < range / 100.0, "off the plane by {worst} of a range of {range}");
    }

    /// The case the cascade is for: a region far longer than it is wide,
    /// where a plain relaxation would still be crawling.
    #[test]
    fn a_long_thin_region_is_filled_end_to_end() {
        let slope = |x: usize, _y: usize| x as f32;
        let (width, height) = (600, 12);
        let (known, unknown) = with_hole(width, height, 1, slope);
        let out = harmonic_fill(&known, &unknown, width, height);
        let middle = out[(height / 2) * width + width / 2][0];
        assert!((middle - (width / 2) as f32).abs() < 1.0, "middle came out {middle}");
    }

    #[test]
    fn a_grid_with_nothing_unknown_comes_back_as_it_went_in() {
        let (known, unknown) = with_hole(20, 20, 20, |x, y| (x + y) as f32);
        let out = harmonic_fill(&known, &unknown, 20, 20);
        assert_eq!(out, known);
    }

    #[test]
    fn a_grid_too_small_to_have_an_inside_is_left_alone() {
        let known = vec![[1.0, 2.0, 3.0]; 2 * 2];
        let out = harmonic_fill(&known, &[false; 4], 2, 2);
        assert_eq!(out, known);
    }
}

