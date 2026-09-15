//! Times the passes a 4K document goes through for one brush dab.
use npaint::adjust::Adjustment;
use npaint::color::Rgba;
use npaint::document::Document;
use npaint::geometry::Rect;
use npaint::mask::Mask;
use npaint::raster::Raster;
use std::time::Instant;

fn ms(label: &str, runs: u32, mut f: impl FnMut()) {
    f(); // warm
    let t = Instant::now();
    for _ in 0..runs {
        f();
    }
    println!("{:38} {:8.2} ms", label, t.elapsed().as_secs_f64() * 1000.0 / f64::from(runs));
}

fn main() {
    let (w, h) = (3840u32, 2160u32);
    println!("document {w}x{h} = {:.1} Mpx, {:.0} MB per layer\n", f64::from(w) * f64::from(h) / 1e6, f64::from(w) * f64::from(h) * 4.0 / 1e6);

    let mut doc = Document::new(w, h, Rgba::WHITE);
    // A photo-ish background.
    for y in 0..h as i32 {
        for x in 0..w as i32 {
            doc.active_layer_mut().raster.set(x, y, Rgba::opaque((x % 256) as u8, (y % 256) as u8, 128));
        }
    }
    let mut frame = Raster::new(w, h);
    let all = Rect::new(0, 0, w as i32, h as i32);
    let mut bytes = vec![0u8; (w as usize) * (h as usize) * 4];

    ms("composite: 1 plain layer", 10, || doc.composite_into(&mut frame, &all));

    doc.add_layer();
    doc.active_layer_mut().raster.set(10, 10, Rgba::BLACK);
    ms("composite: 2 plain layers", 10, || doc.composite_into(&mut frame, &all));

    doc.add_mask(1, Some(Mask::from_rect(w, h, Rect::new(0, 0, w as i32 / 2, h as i32))), false).unwrap();
    ms("composite: 2 layers, one masked", 10, || doc.composite_into(&mut frame, &all));

    doc.add_adjustment_layer(Adjustment::from_params("levels", &[0.0, 200.0, 1.0]).unwrap(), None);
    ms("composite: + a levels adjustment layer", 10, || doc.composite_into(&mut frame, &all));

    ms("write_rgba_bytes (Raster -> [u8])", 20, || {
        frame.write_rgba_bytes(&mut bytes);
        std::hint::black_box(&bytes);
    });
    ms("clear the frame", 20, || frame.clear());

    let dab = Rect::new(1900, 1000, 64, 64);
    ms("composite: the same stack, a 64x64 rect", 200, || doc.composite_into(&mut frame, &dab));
    ms("write_rgba_bytes_in, a 64x64 rect", 200, || {
        frame.write_rgba_bytes_in(&mut bytes, &dab);
        std::hint::black_box(&bytes);
    });

    // What the same work costs if it is limited to a brush dab.
    ms("a 64x64 dab's worth of pixels", 100, || {
        let mut out = Raster::new(dab.w as u32, dab.h as u32);
        out.composite_over(&Raster::filled(dab.w as u32, dab.h as u32, Rgba::WHITE), 1.0);
        std::hint::black_box(&out);
    });
}
