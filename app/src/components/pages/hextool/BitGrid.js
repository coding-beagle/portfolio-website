import React, { useContext, useEffect, useState } from "react";
import { useTheme } from "../../../themes/ThemeProvider";
import { MobileContext } from "../../../contexts/MobileContext";
import { noSelect } from "../title/utilities/valueChangerElements/styles";

/**
 * How many nibbles fit on one line. Bits are grouped into nibbles by absolute
 * index (`i >> 2`) rather than by position in the string, so a value whose
 * width is not a multiple of four keeps its hex digits aligned with the columns
 * they actually belong to.
 */
const NIBBLE_CAP = 8;

function useNibblesPerRow(cellWidth) {
  const [count, setCount] = useState(NIBBLE_CAP);

  useEffect(() => {
    const measure = () => {
      // 4 cells plus the gap that separates one nibble from the next.
      const nibbleWidth = cellWidth * 4 + 14;
      const usable = window.innerWidth - 64;
      setCount(
        Math.max(1, Math.min(NIBBLE_CAP, Math.floor(usable / nibbleWidth)))
      );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [cellWidth]);

  return count;
}

/** Chunks `items` into arrays of at most `size`. */
const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * The column display: every bit of the value with its index above it and the
 * hex digit its nibble spells out below it, most significant bit first.
 *
 * Clicking a bit selects it; shift-clicking extends the selection into a range,
 * which is how the bit select in the input box gets written for you.
 */
export default function BitGrid({ bits, width, selection, onSelectBit }) {
  const { theme } = useTheme();
  const mobile = useContext(MobileContext);
  const cell = mobile ? 22 : 27;
  const nibblesPerRow = useNibblesPerRow(cell);

  // Descending bit indices, grouped into nibbles, then into rows of nibbles.
  const indices = Array.from({ length: width }, (_, i) => width - 1 - i);
  const nibbles = [];
  indices.forEach((index) => {
    const last = nibbles[nibbles.length - 1];
    if (last && (last[0] >> 2) === (index >> 2)) last.push(index);
    else nibbles.push([index]);
  });
  const rows = chunk(nibbles, nibblesPerRow);

  const isSelected = (index) =>
    selection && index <= selection.msb && index >= selection.lsb;

  const bitAt = (index) => bits[width - 1 - index];

  const hexDigitOf = (group) =>
    group
      .reduce((acc, index) => acc + bitAt(index) * (1 << (index % 4)), 0)
      .toString(16)
      .toUpperCase();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9em" }}>
      {rows.map((row) => (
        <div
          key={row[0][0]}
          style={{ display: "flex", gap: 14, flexWrap: "nowrap" }}
        >
          {row.map((group) => {
            // A nibble counts as selected only when every one of its bits is,
            // so the hex digit underneath is never highlighted while it still
            // has bits outside the slice.
            const groupSelected = group.every((index) => isSelected(index));
            return (
              <div
                key={group[0]}
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${group.length}, ${cell}px)`,
                  rowGap: 2,
                }}
              >
                {group.map((index) => (
                  <div
                    key={`i${index}`}
                    style={{
                      ...noSelect,
                      textAlign: "center",
                      fontSize: mobile ? "0.55rem" : "0.6rem",
                      fontFamily: "monospace",
                      color: theme.accent,
                      opacity: isSelected(index) ? 1 : 0.45,
                      transition: "opacity 0.2s ease",
                    }}
                  >
                    {index}
                  </div>
                ))}
                {group.map((index) => {
                  const selected = isSelected(index);
                  return (
                    <button
                      key={`b${index}`}
                      className="hexBit"
                      onClick={(event) => onSelectBit(index, event.shiftKey)}
                      title={`bit ${index}`}
                      style={{
                        ...noSelect,
                        height: cell + 6,
                        padding: 0,
                        fontFamily: "monospace",
                        fontSize: mobile ? "0.95rem" : "1.05rem",
                        cursor: "pointer",
                        borderRadius: 4,
                        border: `1px solid ${
                          selected ? theme.secondary : `${theme.accent}26`
                        }`,
                        background: selected
                          ? `${theme.secondary}33`
                          : "transparent",
                        // A cleared bit is dimmed so the set ones read as a
                        // pattern; inside the selection everything stays bright.
                        color:
                          selected || bitAt(index)
                            ? theme.accent
                            : `${theme.accent}59`,
                        transition:
                          "background 0.2s ease, border-color 0.2s ease, color 0.2s ease",
                      }}
                    >
                      {bitAt(index)}
                    </button>
                  );
                })}
                <div
                  style={{
                    ...noSelect,
                    gridColumn: `span ${group.length}`,
                    textAlign: "center",
                    fontFamily: "monospace",
                    fontSize: mobile ? "0.75rem" : "0.8rem",
                    marginTop: 2,
                    color: theme.accent,
                    opacity: groupSelected ? 1 : 0.6,
                    transition: "opacity 0.2s ease",
                  }}
                >
                  {hexDigitOf(group)}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * Focus ring for the bit buttons — :focus-visible cannot be written inline, and
 * the grid is meant to be walkable by keyboard.
 */
export function BitGridStyles() {
  return (
    <style>{`
      .hexBit:focus-visible {
        outline: 2px solid currentColor;
        outline-offset: 2px;
      }
    `}</style>
  );
}
