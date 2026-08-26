import { useContext, useEffect } from "react";
import { useTheme } from "../../../../../themes/ThemeProvider";
import { MobileContext } from "../../../../../contexts/MobileContext";
import { noSelect } from "./styles";

export function DisplayEntity({
  rerenderSetter,
  title,
  valueRef,
  isState = false,
  maxPerLine = 3,
}) {
  const { theme } = useTheme();
  const mobile = useContext(MobileContext);
  let value = isState ? valueRef : valueRef.current;
  let displayValue;

  // Periodically force rerender to update UI for ref changes
  useEffect(() => {
    const interval = setInterval(() => {
      rerenderSetter((prev) => prev + 1);
    }, 100); // 100ms is responsive but not too aggressive
    return () => clearInterval(interval);
  }, [rerenderSetter]);

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    // Pack fewer pairs per line on mobile so the row doesn't overflow.
    const perLine = mobile ? Math.min(maxPerLine, 2) : maxPerLine;
    const lines = [];
    for (let i = 0; i < entries.length; i += perLine) {
      const slice = entries.slice(i, i + perLine);
      lines.push(
        slice
          .map(
            ([k, v]) =>
              `${k}: ${
                typeof v === "object" && v !== null ? "[object]" : String(v)
              }`
          )
          .join("    ") // 4 spaces between pairs, no commas
      );
    }
    displayValue = (
      <div
        style={{
          textAlign: "left",
          fontFamily: "monospace",
          fontSize: 13,
          ...noSelect,
        }}
      >
        {lines.map((line, idx) => (
          <div key={idx}>{line}</div>
        ))}
      </div>
    );
  } else {
    displayValue = value;
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: mobile ? "space-between" : "flex-start",
        gap: mobile ? "0.6em" : 0,
        width: mobile ? "100%" : undefined,
        marginBottom: "0.3em",
      }}
    >
      {title && (
        <span
          style={{
            minWidth: 0,
            marginRight: mobile ? 0 : "1em",
            fontSize: mobile ? 15 : undefined,
            ...noSelect,
          }}
        >
          {title}
        </span>
      )}
      <span
        style={{
          padding: "0.35em 1.1em",
          fontSize: 15,
          borderRadius: 6,
          border: `1px solid ${theme.secondaryAccent}`,
          background: theme.background,
          color: theme.text,
          fontWeight: 500,
          fontFamily: theme.font,
          minWidth: 40,
          maxWidth: mobile ? "62%" : undefined,
          overflowX: "auto",
          textAlign: "center",
          display: "flex",
          alignItems: "center",
          ...noSelect,
        }}
      >
        {displayValue}
      </span>
    </div>
  );
}

export default DisplayEntity;
