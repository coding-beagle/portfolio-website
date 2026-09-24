import React from "react";

/**
 * The site's mark: the NT monogram.
 *
 * It is drawn from `public/logo192.png`, the same image the favicon and the
 * web manifest are cut from (all generated from `public/NT.png`), so the mark
 * stays in one place. The image is square, so `size` is the size of the mark.
 */
export default function SiteLogo({ size = 20, style = {} }) {
  return (
    <img
      src={`${process.env.PUBLIC_URL ?? ""}/logo192.png`}
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
