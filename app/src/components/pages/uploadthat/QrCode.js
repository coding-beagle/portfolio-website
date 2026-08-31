import React, { useMemo } from "react";
import qrcode from "qrcode-generator";

/**
 * A QR code as SVG.
 *
 * The library gives back a module matrix; drawing it here rather than taking
 * its own table or GIF output means the code stays crisp at any size, follows
 * the theme, and costs no images.
 */
export default function QrCode({ value, size = 168, dark, light, quiet = 2 }) {
  const { path, extent } = useMemo(() => {
    // Type 0 lets the library pick the smallest version that fits; medium error
    // correction is the usual balance for a short URL.
    const code = qrcode(0, "M");
    code.addData(value);
    code.make();

    const count = code.getModuleCount();
    const commands = [];
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (code.isDark(row, column)) {
          commands.push(`M${column + quiet} ${row + quiet}h1v1h-1z`);
        }
      }
    }
    return { path: commands.join(""), extent: count + quiet * 2 };
  }, [value, quiet]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${extent} ${extent}`}
      role="img"
      aria-label="QR code for this session"
      shapeRendering="crispEdges"
      style={{ display: "block", borderRadius: 4 }}
    >
      <rect width={extent} height={extent} fill={light} />
      <path d={path} fill={dark} />
    </svg>
  );
}
