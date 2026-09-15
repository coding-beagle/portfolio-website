//! Where the time goes when an adjustment layer's settings are being dragged
//! on a 4K document: the whole canvas changes, so there is no dirty
//! rectangle to save it.
use npaint::adjust::Adjustment;
use npaint::color::Rgba;
use npaint::document::Document;
use npaint::geometry::Rect;
use npaint::layer::mask_cover;
use npaint::raster::Raster;
use std::time::Instant;

fn ms(label: &str, runs: u32, mut f: impl FnMut()) {
    f();
    let t = Instant::now();
    for _ in 0..runs {
        f();
    }
    println!("{:46} {:7.2} ms", label, t.elapsed().as_secs_f64() * 1000.0 / f64::from(runs));
}

fn main() {
    let (w, h) = (3840u32, 2160u32);
    let mut doc = Document::new(w, h, Rgba::WHITE);
    for y in 0..h as i32 {
        for x in 0..w as i32 {
            doc.active_layer_mut().raster.set(x, y, Rgba::opaque((x % 256) as u8, (y % 256) as u8, 128));
        }
    }
    doc.add_layer();
    doc.active_layer_mut().raster.set(10, 10, Rgba::BLACK);
    let levels = Adjustment::from_params("levels", &[0.0, 200.0, 1.0]).unwrap();
    doc.add_adjustment_layer(levels.clone(), None);
    let all = Rect::new(0, 0, w as i32, h as i32);
    let mut frame = Raster::new(w, h);

    println!("a 3840x2160 document: two pixel layers and a levels adjustment layer\n");
    ms("the bare composite", 10, || doc.composite_into(&mut frame, &all));

    // What a tick of the dialog's slider really costs, through the editor:
    // the engine's preview plus the recomposite the page then asks for.
    {
        let mut e = npaint::editor::Editor::new(w, h, Rgba::WHITE);
        e.add_layer_from("photo", doc.layers()[0].raster.clone()).unwrap();
        e.add_layer_from("over", doc.layers()[1].raster.clone()).unwrap();
        e.add_adjustment_layer("levels", &[0.0, 200.0, 1.0]).unwrap();
        let index = e.document().active_index();
        let mut out = Raster::new(w, h);
        let mut n = 0.0f32;
        e.begin_adjustment_layer(index).unwrap();
        ms("a slider tick, through the editor", 10, || {
            n = (n + 7.0) % 90.0;
            e.preview_adjustment("levels", &[0.0, 160.0 + n, 1.0]).unwrap();
            let rect = e.take_dirty().unwrap_or(all);
            e.composite_into(&mut out, &rect);
        });
        e.cancel_session();

        // The same drag with the canvas zoomed out, where the preview is
        // composited at the size the screen is showing.
        for (zoom, label) in [(0.5, "zoomed to 50%"), (0.25, "zoomed to 25%"), (0.125, "zoomed to 12%")] {
            e.set_zoom_about(zoom, npaint::geometry::Point::new(0.0, 0.0));
            e.begin_adjustment_layer(index).unwrap();
            let size = e.preview_size().expect("a reduced preview");
            let mut small = Raster::new(1, 1);
            ms(&format!("a slider tick, {label} ({}x{})", size[0], size[1]), 20, || {
                n = (n + 7.0) % 90.0;
                e.preview_adjustment("levels", &[0.0, 160.0 + n, 1.0]).unwrap();
                e.preview_into(&mut small);
            });
            e.cancel_session();
        }
    }

    // (a) The layers below the adjustment do not change while its settings
    // do, so composite them once and keep the answer.
    let mut below = Raster::new(w, h);
    {
        let mut only_below = doc.clone();
        only_below.remove_layer(2).unwrap();
        only_below.composite_into(&mut below, &all);
    }
    let f = levels.pixel_map().unwrap();
    let mask = doc.layers()[2].mask.clone().unwrap();
    ms("from a cached composite of the layers below", 10, || {
        frame.copy_from(&below, &all);
        frame.map_at(&all, |p, x, y| {
            let t = f32::from(mask_cover(mask.get(x, y))) / 255.0;
            if t >= 1.0 { f.map(p) } else { p.lerp(f.map(p), t) }
        });
    });
    ms("  ... and with a mask known to be plain white", 10, || {
        frame.copy_from(&below, &all);
        frame.map_in(&all, |p| f.map(p));
    });
    ms("  the copy alone", 10, || frame.copy_from(&below, &all));

    // (b) At a quarter resolution — what a 4K document fitted to a 1080p
    // window actually shows.
    for step in [2usize, 4] {
        let (sw, sh) = (w as usize / step, h as usize / step);
        let mut small = Raster::new(sw as u32, sh as u32);
        let area = small.bounds();
        ms(&format!("a preview at 1/{step} resolution ({sw}x{sh})"), 10, || {
            // Nearest subsampling of every layer is the same picture as
            // nearest subsampling of the composite: blending is per pixel.
            small.clear_in(&area);
            for y in 0..sh as i32 {
                for x in 0..sw as i32 {
                    small.set(x, y, below.get(x * step as i32, y * step as i32));
                }
            }
            small.map_in(&area, |p| f.map(p));
        });
    }
}
