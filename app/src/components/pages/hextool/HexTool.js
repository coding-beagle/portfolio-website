import React, { useContext, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faCopy } from "@fortawesome/free-solid-svg-icons";
import { useTheme } from "../../../themes/ThemeProvider";
import { MobileContext } from "../../../contexts/MobileContext";
import { noSelect } from "../title/utilities/valueChangerElements/styles";
import BitGrid, { BitGridStyles } from "./BitGrid";
import {
  applySelection,
  asciiValue,
  bitsOf,
  floatValue,
  groupFromRight,
  parseInput,
  render,
  signedValue,
} from "./parse";

const BASE_HINTS = [
  ["auto", "auto"],
  ["hex", "hex"],
  ["bin", "bin"],
  ["dec", "dec"],
];

const WIDTHS = [
  ["auto", null],
  ["8", 8],
  ["16", 16],
  ["32", 32],
  ["64", 64],
];

/**
 * The readings a word can be given. `available` keeps out the ones a width
 * cannot support — there is no float in 12 bits, and no bytes in 5.
 */
const FORMATS = [
  { key: "hex", label: "hex" },
  { key: "bin", label: "bin" },
  { key: "dec", label: "dec" },
  { key: "signed", label: "signed" },
  { key: "float", label: "float", available: (w) => w === 32 || w === 64 },
  { key: "ascii", label: "ascii", available: (w) => w % 8 === 0 },
  { key: "verilog", label: "verilog" },
];

const formatsFor = (width) =>
  FORMATS.filter((format) => !format.available || format.available(width));

/**
 * Renders a float without the digits it does not actually have. A float32
 * carries about 9 significant decimal digits, so printing the double it widens
 * to would spell out `-6259853398707798000` for what is really -6.2598534e18.
 */
function formatFloat(float, width) {
  if (!Number.isFinite(float)) return String(float);
  if (float === 0) return Object.is(float, -0) ? "-0" : "0";
  const rounded = Number(float.toPrecision(width === 32 ? 9 : 17));
  const magnitude = Math.abs(rounded);
  return magnitude >= 1e7 || magnitude < 1e-4
    ? rounded.toExponential()
    : String(rounded);
}

/**
 * One reading of `value`: how it should be shown, and how it should be copied.
 * The two differ where the display is grouped for legibility.
 */
function formatValue(value, width, key) {
  switch (key) {
    case "bin": {
      const bin = render(value, width, "bin");
      return { display: `0b${groupFromRight(bin, 4).join("_")}`, copy: `0b${bin}` };
    }
    case "dec":
      return { display: value.toString(10) };
    case "signed":
      return { display: signedValue(value, width).toString(10) };
    case "float": {
      const float = floatValue(value, width);
      return { display: float === null ? "—" : formatFloat(float, width) };
    }
    case "ascii": {
      const bytes = asciiValue(value, width) ?? [];
      return { display: bytes.join(" "), copy: bytes.join("") };
    }
    case "verilog":
      return { display: `${width}'h${render(value, width, "hex")}` };
    case "hex":
    default: {
      const hex = render(value, width, "hex");
      return { display: `0x${groupFromRight(hex, 4).join("_")}`, copy: `0x${hex}` };
    }
  }
}

/** A row of mutually exclusive options, styled like the rest of the site. */
function Segmented({ label, options, value, onChange }) {
  const { theme } = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.6em",
        flexWrap: "wrap",
      }}
    >
      {label && (
        <span
          style={{
            ...noSelect,
            fontSize: "0.7rem",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            opacity: 0.55,
          }}
        >
          {label}
        </span>
      )}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {options.map(([text, option]) => {
          const active = option === value;
          return (
            <button
              key={text}
              className="hexSeg"
              onClick={() => onChange(option)}
              style={{
                ...noSelect,
                padding: "0.3em 0.7em",
                fontFamily: "monospace",
                fontSize: "0.8rem",
                borderRadius: 4,
                cursor: "pointer",
                border: `1px solid ${active ? theme.secondary : `${theme.accent}33`}`,
                background: active ? `${theme.secondary}26` : "transparent",
                color: active ? theme.secondary : theme.accent,
                transition:
                  "background 0.2s ease, border-color 0.2s ease, color 0.2s ease",
              }}
            >
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A word — the whole value, or the slice picked out of it — shown as one
 * reading at a time, with the reading picked from the row of formats.
 *
 * `autoFormat` is what to show until a format is chosen: the opposite of
 * whatever was typed, which is the point of pasting a word in here. A chosen
 * format then sticks, unless the width changes to one that cannot support it.
 */
function OutputPanel({ title, value, width, autoFormat }) {
  const { theme } = useTheme();
  const mobile = useContext(MobileContext);
  const [chosen, setChosen] = useState(null);
  const [copied, setCopied] = useState(false);

  const options = formatsFor(width);
  const format = options.some((option) => option.key === chosen)
    ? chosen
    : autoFormat;
  const { display, copy } = formatValue(value, width, format);

  const onCopy = () => {
    navigator.clipboard?.writeText(copy ?? display);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <section
      style={{
        border: `1px solid ${theme.accent}26`,
        borderRadius: 8,
        padding: mobile ? "0.9em" : "1.1em 1.2em",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.8em",
          marginBottom: "0.8em",
        }}
      >
        <h2
          style={{
            ...noSelect,
            fontSize: "0.75rem",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            opacity: 0.5,
            margin: 0,
            fontWeight: 500,
          }}
        >
          {title}
        </h2>
        <Segmented
          options={options.map((option) => [option.label, option.key])}
          value={format}
          onChange={setChosen}
        />
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.6em" }}>
        <span
          style={{
            flex: 1,
            fontFamily: "monospace",
            fontSize: mobile ? "1rem" : "1.25rem",
            wordBreak: "break-all",
          }}
        >
          {display}
        </span>
        <button
          className="hexCopy"
          onClick={onCopy}
          aria-label={`Copy ${title}`}
          title={`Copy ${title}`}
          style={{
            background: "none",
            border: "none",
            padding: "0 0.2em",
            cursor: "pointer",
            fontSize: "0.95rem",
            color: copied ? theme.secondaryAccent : `${theme.accent}80`,
            transition: "color 0.2s ease",
          }}
        >
          <FontAwesomeIcon icon={copied ? faCheck : faCopy} />
        </button>
      </div>
    </section>
  );
}

/**
 * The hex tool: paste a hex or binary word and read it back in the other base,
 * column by column, with Verilog bit selects resolved against it.
 */
export default function HexTool() {
  const { theme } = useTheme();
  const mobile = useContext(MobileContext);
  const [input, setInput] = useState("");
  const [baseHint, setBaseHint] = useState("auto");
  const [widthOverride, setWidthOverride] = useState(null);
  // Where a shift-click measures its range from.
  const anchor = useRef(null);

  const parsed = useMemo(
    () => parseInput(input, { baseHint, widthOverride }),
    [input, baseHint, widthOverride]
  );

  const bits = useMemo(
    () => (parsed.ok ? bitsOf(parsed.value, parsed.width) : []),
    [parsed]
  );

  // "The opposite of what was typed" — binary for a hex paste, hex otherwise.
  const autoFormat = parsed.base === "bin" ? "hex" : "bin";

  const selectBit = (index, extend) => {
    if (extend && anchor.current !== null) {
      const msb = Math.max(anchor.current, index);
      const lsb = Math.min(anchor.current, index);
      setInput((prev) => applySelection(prev, msb, lsb));
      return;
    }
    // Clicking the bit that is already the whole selection clears it.
    const only =
      parsed.selection &&
      parsed.selection.msb === index &&
      parsed.selection.lsb === index;
    anchor.current = only ? null : index;
    setInput((prev) =>
      only ? applySelection(prev, null) : applySelection(prev, index, index)
    );
  };

  return (
    <div
      style={{
        minHeight: "100%",
        boxSizing: "border-box",
        padding: mobile ? "1.5em 1em 4em" : "3em 2em 5em",
        maxWidth: 980,
        margin: "0 auto",
      }}
    >
      <BitGridStyles />
      <style>{`
        .hexSeg:focus-visible, .hexCopy:focus-visible {
          outline: 2px solid currentColor;
          outline-offset: 2px;
        }
      `}</style>

      <header style={{ marginBottom: "1.5em" }}>
        <h1
          style={{
            margin: 0,
            fontSize: mobile ? "1.6rem" : "2rem",
            fontWeight: 400,
            letterSpacing: "0.04em",
          }}
        >
          hex tool
        </h1>
        <p style={{ margin: "0.4em 0 0", opacity: 0.6, fontSize: "0.9rem" }}>
          Paste a hex or binary word to read it back the other way round, with
          Verilog bit selects.
        </p>
      </header>

      <input
        value={input}
        onChange={(event) => setInput(event.target.value)}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Value to decode"
        placeholder="word input"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "0.7em 0.8em",
          fontFamily: "monospace",
          fontSize: mobile ? "1rem" : "1.15rem",
          color: theme.accent,
          background: `${theme.accent}0D`,
          border: `1px solid ${
            parsed.error ? theme.tertiaryAccent : `${theme.accent}33`
          }`,
          borderRadius: 6,
          outline: "none",
          transition: "border-color 0.2s ease",
        }}
      />

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: mobile ? "0.8em 1.4em" : "0.8em 2em",
          margin: "0.9em 0 1.4em",
        }}
      >
        <Segmented
          label="read as"
          options={BASE_HINTS}
          value={baseHint}
          onChange={setBaseHint}
        />
        <Segmented
          label="width"
          options={WIDTHS}
          value={widthOverride}
          onChange={setWidthOverride}
        />
      </div>

      {parsed.error && (
        <p
          role="alert"
          style={{
            color: theme.tertiaryAccent,
            fontFamily: "monospace",
            fontSize: "0.9rem",
            margin: "0 0 1em",
          }}
        >
          {parsed.error}
        </p>
      )}
      {parsed.warnings.map((warning) => (
        <p
          key={warning}
          style={{
            // The warning yellow is unreadable as text on the light theme's
            // cream background, so it marks the edge and the text stays accent.
            borderLeft: `3px solid ${theme.quarternaryAccent}`,
            paddingLeft: "0.7em",
            fontSize: "0.85rem",
            opacity: 0.8,
            margin: "0 0 0.6em",
          }}
        >
          {warning}
        </p>
      ))}

      {parsed.ok && (
        <>
          <div
            style={{
              overflowX: "auto",
              paddingBottom: "0.5em",
              marginBottom: "1.8em",
            }}
          >
            <BitGrid
              bits={bits}
              width={parsed.width}
              selection={parsed.selection}
              onSelectBit={selectBit}
            />
          </div>

          <p
            style={{
              ...noSelect,
              margin: "0 0 1.6em",
              fontSize: "0.8rem",
              opacity: 0.45,
            }}
          >
            Click a bit to select it, shift-click another to take the range
            between them.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "1em" }}>
            {parsed.slice && (
              <OutputPanel
                value={parsed.slice.value}
                width={parsed.slice.width}
                autoFormat={autoFormat}
                title={`slice [${
                  parsed.slice.msb === parsed.slice.lsb
                    ? parsed.slice.msb
                    : `${parsed.slice.msb}:${parsed.slice.lsb}`
                }] — ${parsed.slice.width} ${
                  parsed.slice.width === 1 ? "bit" : "bits"
                }`}
              />
            )}
            <OutputPanel
              value={parsed.value}
              width={parsed.width}
              autoFormat={autoFormat}
              title={`whole word — ${parsed.width} bits`}
            />
          </div>
        </>
      )}
    </div>
  );
}
