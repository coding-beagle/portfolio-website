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

/** The widest result the tool will lay out, for the same reason. */
const MAX_WIDTH = 8192;

/**
 * Splits an expression into values and operators. A value is any run of word
 * characters (and `'`, for Verilog literals); whether it is a valid literal is
 * decided later, once the parser knows which base a bare word should be read
 * in. Two values separated only by whitespace are one value, so a word pasted
 * from a dump as `DEAD BEEF` still reads as 0xDEADBEEF.
 */
function tokenize(text) {
  const tokens = [];
  let i = 0;
  let gap = false;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      gap = true;
      i += 1;
      continue;
    }
    const word = /^[0-9A-Za-z_']+/.exec(text.slice(i));
    if (word) {
      const last = tokens[tokens.length - 1];
      if (last && last.type === "value" && gap) last.text += word[0];
      else tokens.push({ type: "value", text: word[0] });
      i += word[0].length;
    } else {
      const op = /^(<<|>>|[-+*/%&|^~()])/.exec(text.slice(i));
      if (!op) return { error: `"${ch}" is not an operator` };
      tokens.push({ type: "op", text: op[0] });
      i += op[0].length;
    }
    gap = false;
  }
  return { tokens };
}

/** Bits needed to hold `value`, with a sign bit if it is negative. */
function bitsNeeded(value) {
  if (value === 0n) return 0;
  return value > 0n ? value.toString(2).length : (-value - 1n).toString(2).length + 1;
}

/** Binary operators by precedence, loosest first, as in C and Verilog. */
const LEVELS = [["|"], ["^"], ["&"], ["<<", ">>"], ["+", "-"], ["*", "/", "%"]];

class ParseError extends Error {}

/**
 * Evaluates an expression of literals, arithmetic and bitwise operators.
 *
 * Values are carried as exact (possibly negative) BigInts alongside the width
 * they occupy, and only wrapped into a register at the very end — so `-1` is
 * all ones at whatever width is picked, not 0xF zero extended. Widths grow the
 * way a careful designer would size the result: an operation is as wide as its
 * widest operand, or as wide as its result needs if that is more, and a left
 * shift widens by what it shifts by. `>>` and `~` are the exceptions that act
 * on the register rather than the number, since that is what they mean.
 *
 * A shift amount is read in decimal unless it says otherwise, which is how
 * `<< 10` is always written.
 */
function evaluate(expression, baseHint) {
  const lexed = tokenize(expression);
  if (lexed.error) throw new ParseError(lexed.error);
  const { tokens } = lexed;
  const literals = [];
  const warnings = [];
  let pos = 0;
  let hint = baseHint;

  const peek = () => tokens[pos];
  const isOp = (token, ops) => token && token.type === "op" && ops.includes(token.text);

  const literal = (text) => {
    const parsed = parseLiteral(text, hint);
    if (parsed.error) throw new ParseError(parsed.error);
    const natural = widthOfDigits(parsed.base, parsed.digits);
    let value = valueOfDigits(parsed.base, parsed.digits);
    const width = parsed.declaredWidth ?? natural;
    if (value > maskOf(width)) {
      value &= maskOf(width);
      warnings.push(`Literal needs ${natural} bits and was truncated to ${width}.`);
    }
    literals.push(parsed);
    return { value, width };
  };

  const unary = () => {
    const token = peek();
    if (!token) {
      const prev = tokens[pos - 1];
      throw new ParseError(prev ? `expected a value after "${prev.text}"` : "empty");
    }
    pos += 1;
    if (token.type === "value") return literal(token.text);
    if (token.text === "(") {
      const inner = binary(0);
      if (!isOp(peek(), [")"])) throw new ParseError('missing ")"');
      pos += 1;
      return inner;
    }
    if (token.text === "-" || token.text === "+" || token.text === "~") {
      const operand = unary();
      if (token.text === "+") return operand;
      if (token.text === "-") return { value: -operand.value, width: operand.width };
      return {
        value: BigInt.asUintN(operand.width, operand.value) ^ maskOf(operand.width),
        width: operand.width,
      };
    }
    if (token.text === ")") throw new ParseError('unexpected ")"');
    throw new ParseError(
      token.text === "<<" || token.text === ">>"
        ? "nothing to shift"
        : `"${token.text}" needs a value on its left`
    );
  };

  const shiftAmount = (operand) => {
    if (operand.value < 0n) throw new ParseError("shift amount cannot be negative");
    if (operand.value > BigInt(MAX_SHIFT))
      throw new ParseError(`shift amount must be at most ${MAX_SHIFT}`);
    return Number(operand.value);
  };

  const apply = (op, a, b) => {
    const width = Math.max(a.width, b.width);
    const sized = (value) => ({ value, width: Math.max(width, bitsNeeded(value)) });
    switch (op) {
      case "+":
        return sized(a.value + b.value);
      case "-":
        return sized(a.value - b.value);
      case "*":
        return sized(a.value * b.value);
      case "/":
      case "%":
        if (b.value === 0n) throw new ParseError("division by zero");
        return sized(op === "/" ? a.value / b.value : a.value % b.value);
      case "&":
        return sized(a.value & b.value);
      case "|":
        return sized(a.value | b.value);
      case "^":
        return sized(a.value ^ b.value);
      case "<<": {
        const amount = shiftAmount(b);
        return { value: a.value << BigInt(amount), width: a.width + amount };
      }
      case ">>":
      default:
        return {
          value: BigInt.asUintN(a.width, a.value) >> BigInt(shiftAmount(b)),
          width: a.width,
        };
    }
  };

  const binary = (level) => {
    if (level === LEVELS.length) return unary();
    let left = binary(level + 1);
    while (isOp(peek(), LEVELS[level])) {
      const op = tokens[pos].text;
      pos += 1;
      let right;
      if (op === "<<" || op === ">>") {
        const outer = hint;
        hint = "dec";
        right = binary(level + 1);
        hint = outer;
      } else {
        right = binary(level + 1);
      }
      left = apply(op, left, right);
      if (left.width > MAX_WIDTH)
        throw new ParseError(`result must be at most ${MAX_WIDTH} bits wide`);
    }
    return left;
  };

  const result = binary(0);
  if (pos < tokens.length) {
    const token = tokens[pos];
    throw new ParseError(
      token.text === ")" ? 'unexpected ")"' : `expected an operator before "${token.text}"`
    );
  }
  return { ...result, literals, compound: tokens.length > 1, warnings };
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
 * The input can be an expression (see `evaluate`). A left shift widens the word
 * by what it shifts by, so `0b1001 << 5` keeps all nine bits rather than
 * dropping four off the top — picking a width is how you ask for the
 * truncating, fixed-width reading instead.
 */
export function parseInput(input, { baseHint = "auto", widthOverride = null } = {}) {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, empty: true, warnings: [] };

  const { literal: expression, selector } = splitSelector(raw);
  let evaluated;
  try {
    evaluated = evaluate(expression, baseHint);
  } catch (error) {
    if (!(error instanceof ParseError)) throw error;
    const empty = error.message === "empty";
    return { ok: false, empty, error: empty ? undefined : error.message, warnings: [] };
  }

  const { warnings, literals, compound } = evaluated;
  const natural = evaluated.width;
  const width = widthOverride ?? natural;
  if (width < 1) return { ok: false, error: "width must be at least 1", warnings };

  // Wrapping into the register is where a negative result becomes its two's
  // complement, and where a too-narrow width drops the top bits.
  const value = BigInt.asUintN(width, evaluated.value);
  if (bitsNeeded(evaluated.value) > width)
    warnings.push(
      `${compound ? "Result" : "Literal"} needs ${natural} bits and was truncated to ${width}.`
    );

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
    base: literals[0].base,
    signed: literals[0].signed,
    compound,
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
