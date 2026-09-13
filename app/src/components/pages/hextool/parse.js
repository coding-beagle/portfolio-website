/**
 * Parsing and formatting for the hex tool.
 *
 * Kept free of React so the awkward parts — width inference, Verilog part
 * selects, shifts, two's complement — can be unit tested directly. Everything
 * numeric runs through BigInt, so a 512-bit register is no different from a
 * nibble.
 */

const BASES = {
  hex: { radix: 16, prefix: "0x", bitsPerDigit: 4, digits: /^[0-9a-fA-F]+$/ },
  bin: { radix: 2, prefix: "0b", bitsPerDigit: 1, digits: /^[01]+$/ },
  oct: { radix: 8, prefix: "0o", bitsPerDigit: 3, digits: /^[0-7]+$/ },
  dec: { radix: 10, prefix: "", bitsPerDigit: 0, digits: /^[0-9]+$/ },
};

const VERILOG_BASE = { h: "hex", b: "bin", o: "oct", d: "dec" };

/** Bit width a literal of `count` digits in `base` occupies, as written. */
const widthOfDigits = (base, digits) =>
  base === "dec"
    ? Math.max(1, valueOfDigits("dec", digits).toString(2).length)
    : digits.length * BASES[base].bitsPerDigit;

const valueOfDigits = (base, digits) =>
  base === "dec"
    ? BigInt(digits)
    : BigInt(`${BASES[base].prefix}${digits}`);

/**
 * Splits `0xDEAD[15:8]` into its literal and its selector. The selector is only
 * ever the *trailing* bracket group, so a stray `[` inside the literal fails
 * literal validation rather than being silently swallowed.
 */
function splitSelector(input) {
  const match = /\[([^[\]]*)\]\s*$/.exec(input);
  if (!match) return { literal: input.trim(), selector: null };
  return {
    literal: input.slice(0, match.index).trim(),
    selector: match[1].trim(),
  };
}

/**
 * Reads the literal's base and digits.
 *
 * `baseHint` only decides what an unprefixed run of digits means — an explicit
 * `0x`, `0b`, `0o` or Verilog `'h` always wins, so a hint of "bin" still reads
 * `0xFF` as hex.
 */
function parseLiteral(literal, baseHint) {
  const cleaned = literal.replace(/[_\s]/g, "");
  if (!cleaned) return { error: "empty" };

  // Verilog sized/unsized literal: 32'hDEAD, 'b1010, 8'sd12
  const verilog = /^(\d+)?'([sS])?([hHbBoOdD])(.+)$/.exec(cleaned);
  if (verilog) {
    const [, size, signed, letter, digits] = verilog;
    const base = VERILOG_BASE[letter.toLowerCase()];
    if (!BASES[base].digits.test(digits))
      return { error: `"${digits}" is not a valid ${base} literal` };
    return {
      base,
      digits,
      declaredWidth: size ? Number(size) : null,
      signed: Boolean(signed),
    };
  }

  const prefixed = /^0([xXbBoO])(.+)$/.exec(cleaned);
  if (prefixed) {
    const base = { x: "hex", b: "bin", o: "oct" }[prefixed[1].toLowerCase()];
    const digits = prefixed[2];
    if (!BASES[base].digits.test(digits))
      return { error: `"${digits}" is not a valid ${base} literal` };
    return { base, digits, declaredWidth: null, signed: false };
  }

  // Bare digits. "auto" reads them as hex: it is what gets pasted, and a
  // binary word is one 0b away from being unambiguous.
  const base = baseHint === "auto" ? "hex" : baseHint;
  if (!BASES[base].digits.test(cleaned))
    return { error: `"${cleaned}" is not a valid ${base} literal` };
  return { base, digits: cleaned, declaredWidth: null, signed: false };
}

/** How far a single shift may move, to keep a typo from asking for a megabit. */
const MAX_SHIFT = 4096;

/**
 * Splits `0b1001 << 5` into the literal and the shifts applied to it. Shifts
 * read left to right, so `0xFF << 8 >> 4` is the two steps in that order.
 */
function splitShifts(literal) {
  const parts = literal.split(/(<<|>>)/);
  const shifts = [];
  for (let i = 1; i < parts.length; i += 2) {
    const amount = parts[i + 1].replace(/[_\s]/g, "");
    if (!/^\d+$/.test(amount))
      return { error: `"${amount.trim() || parts[i]}" is not a shift amount` };
    if (Number(amount) > MAX_SHIFT)
      return { error: `shift amount must be at most ${MAX_SHIFT}` };
    shifts.push({ op: parts[i], amount: Number(amount) });
  }
  return { literal: parts[0].trim(), shifts };
}

/**
 * Reads a Verilog part select. Accepts the three forms — `[n]`, `[msb:lsb]`,
 * and the indexed selects `[base +: width]` / `[base -: width]` — and returns
 * them normalised to an inclusive msb/lsb pair.
 */
function parseSelector(selector) {
  const text = selector.replace(/\s/g, "");
  if (!text) return { error: "empty bit select" };

  const single = /^(\d+)$/.exec(text);
  if (single) {
    const bit = Number(single[1]);
    return { msb: bit, lsb: bit };
  }

  const indexed = /^(\d+)([+-]):(\d+)$/.exec(text);
  if (indexed) {
    const start = Number(indexed[1]);
    const count = Number(indexed[3]);
    if (count < 1) return { error: "part select width must be at least 1" };
    return indexed[2] === "+"
      ? { msb: start + count - 1, lsb: start }
      : { msb: start, lsb: start - count + 1 };
  }

  const range = /^(\d+):(\d+)$/.exec(text);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    // Verilog wants msb:lsb, but an ascending range is an obvious enough
    // typo that reading it the other way round beats an error.
    return { msb: Math.max(a, b), lsb: Math.min(a, b) };
  }

  return { error: `"${selector}" is not a bit select` };
}

const maskOf = (width) => (1n << BigInt(width)) - 1n;

/** Extracts bits [msb:lsb] of `value` as a right-aligned BigInt. */
export function sliceValue(value, msb, lsb) {
  return (value >> BigInt(lsb)) & maskOf(msb - lsb + 1);
}

/** Two's complement reading of a `width`-bit `value`. */
export function signedValue(value, width) {
  return value >= 1n << BigInt(width - 1) ? value - (1n << BigInt(width)) : value;
}

/** Splits a string into fixed-size groups counted from the right. */
export function groupFromRight(text, size) {
  const groups = [];
  for (let end = text.length; end > 0; end -= size)
    groups.unshift(text.slice(Math.max(0, end - size), end));
  return groups;
}

/** Renders `value` in `base`, zero padded to cover `width` bits. */
export function render(value, width, base) {
  if (base === "dec") return value.toString(10);
  const { radix, bitsPerDigit } = BASES[base];
  const pad = Math.ceil(width / bitsPerDigit);
  const text = value.toString(radix).toUpperCase().padStart(pad, "0");
  return text;
}

/** Bits of `value`, most significant first, as 0/1 numbers. */
export function bitsOf(value, width) {
  const bits = new Array(width);
  for (let i = 0; i < width; i += 1)
    bits[width - 1 - i] = Number((value >> BigInt(i)) & 1n);
  return bits;
}

/**
 * Parses one input line into everything the display needs.
 *
 * `widthOverride` is the width picked in the UI (null for "auto"); it wins over
 * both the digit count and a Verilog size, and truncates the value when it is
 * narrower, the way an assignment to a too-small reg would.
 *
 * A left shift widens the word by what it shifts by, so `0b1001 << 5` keeps all
 * nine bits rather than dropping four off the top — picking a width is how you
 * ask for the truncating, fixed-width reading instead.
 */
export function parseInput(input, { baseHint = "auto", widthOverride = null } = {}) {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, empty: true, warnings: [] };

  const { literal: expression, selector } = splitSelector(raw);
  const split = splitShifts(expression);
  if (split.error) return { ok: false, empty: false, error: split.error, warnings: [] };
  if (split.shifts.length && !split.literal)
    return { ok: false, empty: false, error: "nothing to shift", warnings: [] };
  const parsed = parseLiteral(split.literal, baseHint);
  if (parsed.error)
    return {
      ok: false,
      empty: parsed.error === "empty",
      error: parsed.error === "empty" ? undefined : parsed.error,
      warnings: [],
    };

  const warnings = [];
  const natural = widthOfDigits(parsed.base, parsed.digits);
  let value = valueOfDigits(parsed.base, parsed.digits);
  let shifted = parsed.declaredWidth ?? natural;

  // A shifted literal is cut to its own declared size first: `8'hDEAD << 4` is
  // 0xAD moved up, not 0xDEAD.
  if (split.shifts.length && value > maskOf(shifted)) {
    value &= maskOf(shifted);
    warnings.push(`Literal needs ${natural} bits and was truncated to ${shifted}.`);
  }
  for (const { op, amount } of split.shifts) {
    if (op === "<<") {
      value <<= BigInt(amount);
      shifted += amount;
    } else {
      value >>= BigInt(amount);
    }
  }

  const width = widthOverride ?? shifted;
  if (width < 1) return { ok: false, error: "width must be at least 1", warnings };

  if (value > maskOf(width)) {
    value &= maskOf(width);
    warnings.push(
      split.shifts.length
        ? `Result needs ${shifted} bits and was truncated to ${width}.`
        : `Literal needs ${natural} bits and was truncated to ${width}.`
    );
  }

  let selection = null;
  if (selector !== null) {
    const sel = parseSelector(selector);
    if (sel.error) return { ok: false, error: sel.error, value, width, warnings };
    if (sel.lsb < 0)
      return { ok: false, error: "bit select runs past bit 0", value, width, warnings };
    if (sel.msb > width - 1)
      warnings.push(
        `Bits above ${width - 1} are outside the ${width}-bit value.`
      );
    selection = sel;
  }

  const result = {
    ok: true,
    empty: false,
    value,
    width,
    base: parsed.base,
    signed: parsed.signed,
    shifts: split.shifts,
    selection,
    warnings,
  };

  if (selection) {
    const clampedMsb = Math.min(selection.msb, width - 1);
    if (clampedMsb >= selection.lsb) {
      result.slice = {
        msb: selection.msb,
        lsb: selection.lsb,
        width: selection.msb - selection.lsb + 1,
        value: sliceValue(value, clampedMsb, selection.lsb),
      };
    }
  }

  return result;
}

/**
 * Rewrites the trailing bit select of `input`, leaving the literal (and the way
 * the user chose to write it) alone. Passing a null `msb` drops the select.
 */
export function applySelection(input, msb, lsb) {
  const { literal } = splitSelector((input ?? "").trim());
  if (msb === null) return literal;
  return `${literal}[${msb === lsb ? msb : `${msb}:${lsb}`}]`;
}

/**
 * The bit pattern read as an IEEE 754 float. Only the two widths that have a
 * native reading are supported; anything else returns null so the caller can
 * leave the option out.
 */
export function floatValue(value, width) {
  if (width !== 32 && width !== 64) return null;
  const view = new DataView(new ArrayBuffer(width / 8));
  if (width === 32) {
    view.setUint32(0, Number(value));
    return view.getFloat32(0);
  }
  view.setBigUint64(0, value);
  return view.getFloat64(0);
}

/**
 * The bit pattern read as bytes of text, most significant byte first. Null for
 * a width that is not a whole number of bytes.
 */
export function asciiValue(value, width) {
  if (width % 8 !== 0) return null;
  return groupFromRight(render(value, width, "hex"), 2).map((byte) => {
    const code = parseInt(byte, 16);
    return code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : "·";
  });
}
