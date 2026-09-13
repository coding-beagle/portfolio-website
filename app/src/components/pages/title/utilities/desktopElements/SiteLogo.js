import React from "react";

/**
 * The site's mark: a 3:2 Lissajous figure with one arc of it picked out.
 *
 * It is the same file the favicon uses (`public/lissajous.svg`) rather than a
 * redrawn copy, so the mark stays in one place — change that file and
 * everything showing it follows. The SVG fills its box, so `size` is the size
 * of the mark itself.
 */
export default function SiteLogo({ size = 20, style = {} }) {
  return (
    <img
      src={`${process.env.PUBLIC_URL ?? ""}/lissajous.svg`}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-site-logo="true"
      style={{
        width: size,
        height: size,
        // A little lift so the keyline reads against the gloss it sits on.
        filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.45))",
        flex: "0 0 auto",
        ...style,
      }}
    />
  );
}
