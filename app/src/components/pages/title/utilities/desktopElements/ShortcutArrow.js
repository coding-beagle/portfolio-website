import React from "react";

/**
 * The little arrow Windows stamped on the corner of every shortcut: a white
 * tile with a black arrow curling up and to the right out of it.
 *
 * It sits over the bottom-left of the glyph it belongs to, so whatever it is
 * pinned to has to establish a positioning context of its own.
 */
export default function ShortcutArrow({ size = 14 }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      data-shortcut-arrow=""
      style={{
        position: "absolute",
        left: -2,
        bottom: -2,
        // The glyph underneath carries a drop shadow; without one of its own
        // the tile reads as a hole punched in it rather than a badge on top.
        filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.45))",
      }}
    >
      <rect
        x="0.5"
        y="0.5"
        width="15"
        height="15"
        fill="#FFFFFF"
        stroke="#5A5A50"
      />
      {/* Shaft out of the bottom-left corner, meeting the head's back edge. */}
      <path d="M4 12.5 L10 6" stroke="#000000" strokeWidth="2" fill="none" />
      {/* A right triangle for the head, its point in the top-right corner. */}
      <path d="M13 3 L13 9.4 L6.6 3 Z" fill="#000000" />
    </svg>
  );
}
