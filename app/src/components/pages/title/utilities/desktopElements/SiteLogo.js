import React from "react";

// The artwork sits inside about 73% of the image; the rest is transparent
// padding. Scaling by the inverse means callers can ask for the height they
// want the *glyph* to be and get it.
const GLYPH_FRACTION = 0.73;

/**
 * The site's own NT mark, standing in for the Windows flag on the start button.
 *
 * It is the favicon's artwork rather than a redrawn SVG so the logo stays in
 * one place: change `public/logo192.png` and everything that shows it follows.
 */
export default function SiteLogo({ size = 20, style = {} }) {
  const box = Math.round(size / GLYPH_FRACTION);
  return (
    <img
      src={`${process.env.PUBLIC_URL ?? ""}/logo192.png`}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-site-logo="true"
      style={{
        width: box,
        height: box,
        // The mark is drawn with a black keyline, which needs a little lift to
        // read against the gloss it is sitting on.
        filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.45))",
        flex: "0 0 auto",
        ...style,
      }}
    />
  );
}
