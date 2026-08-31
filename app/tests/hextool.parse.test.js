/**
 * The parsing behind the hex tool: what a pasted literal means, how wide it is,
 * and what a Verilog bit select picks out of it.
 */
import {
  applySelection,
  asciiValue,
  bitsOf,
  floatValue,
  groupFromRight,
  parseInput,
  render,
  signedValue,
  sliceValue,
} from "../src/components/pages/hextool/parse";

describe("literal parsing", () => {
  it("reads a prefixed hex word and sizes it by its digits", () => {
    const result = parseInput("0xDEADBEEF");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0xdeadbeefn);
    expect(result.width).toBe(32);
    expect(result.base).toBe("hex");
  });

  it("reads binary, octal and Verilog literals", () => {
    expect(parseInput("0b1011").value).toBe(0b1011n);
    expect(parseInput("0b1011").width).toBe(4);
    expect(parseInput("0o777").value).toBe(0o777n);
    expect(parseInput("0o777").width).toBe(9);
    expect(parseInput("32'hCAFE").value).toBe(0xcafen);
    expect(parseInput("32'hCAFE").width).toBe(32);
    expect(parseInput("'b1010").width).toBe(4);
    expect(parseInput("16'd4660").value).toBe(4660n);
  });

  it("ignores underscores and surrounding whitespace", () => {
    expect(parseInput("  0xDE_AD_BE_EF  ").value).toBe(0xdeadbeefn);
    expect(parseInput("1011_0110").width).toBe(32);
  });

  it("reads a bare word as hex unless told otherwise", () => {
    expect(parseInput("1011").value).toBe(0x1011n);
    expect(parseInput("1011", { baseHint: "bin" }).value).toBe(0b1011n);
    expect(parseInput("1011", { baseHint: "dec" }).value).toBe(1011n);
  });

  it("lets an explicit prefix win over the base hint", () => {
    const result = parseInput("0xFF", { baseHint: "bin" });
    expect(result.value).toBe(255n);
    expect(result.base).toBe("hex");
  });

  it("rejects digits that do not belong to the base", () => {
    expect(parseInput("0b1021").error).toMatch(/not a valid bin/);
    expect(parseInput("0xZZ").error).toMatch(/not a valid hex/);
    expect(parseInput("12", { baseHint: "bin" }).error).toMatch(/not a valid bin/);
  });

  it("reports an empty input as empty rather than as an error", () => {
    const result = parseInput("   ");
    expect(result.ok).toBe(false);
    expect(result.empty).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

describe("width", () => {
  it("widens to the chosen width without changing the value", () => {
    const result = parseInput("0xFF", { widthOverride: 32 });
    expect(result.width).toBe(32);
    expect(result.value).toBe(255n);
    expect(result.warnings).toHaveLength(0);
  });

  it("truncates and warns when the width cannot hold the literal", () => {
    const result = parseInput("0xDEADBEEF", { widthOverride: 8 });
    expect(result.value).toBe(0xefn);
    expect(result.width).toBe(8);
    expect(result.warnings[0]).toMatch(/truncated/);
  });

  it("truncates to a Verilog literal's declared size", () => {
    const result = parseInput("8'hDEAD");
    expect(result.width).toBe(8);
    expect(result.value).toBe(0xadn);
  });

  it("lets the chosen width override a declared one", () => {
    expect(parseInput("8'hFF", { widthOverride: 16 }).width).toBe(16);
  });
});

describe("bit selects", () => {
  it("picks out a single bit", () => {
    const result = parseInput("0xDEADBEEF[13]");
    expect(result.selection).toEqual({ msb: 13, lsb: 13 });
    expect(result.slice).toMatchObject({ msb: 13, lsb: 13, width: 1, value: 1n });
  });

  it("picks out a range", () => {
    const result = parseInput("0xDEADBEEF[31:16]");
    expect(result.slice).toMatchObject({ width: 16, value: 0xdeadn });
  });

  it("reads an ascending range the same way as a descending one", () => {
    expect(parseInput("0xDEADBEEF[16:31]").slice.value).toBe(0xdeadn);
  });

  it("handles the indexed part selects", () => {
    expect(parseInput("0xDEADBEEF[16 +: 16]").slice).toMatchObject({
      msb: 31,
      lsb: 16,
      value: 0xdeadn,
    });
    expect(parseInput("0xDEADBEEF[31 -: 16]").slice).toMatchObject({
      msb: 31,
      lsb: 16,
      value: 0xdeadn,
    });
  });

  it("warns about bits above the top of the value but still shows the rest", () => {
    const result = parseInput("0xFF[15:4]");
    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toMatch(/outside/);
    expect(result.slice.value).toBe(0xfn);
  });

  it("rejects a select that runs below bit 0 or is not a select at all", () => {
    expect(parseInput("0xFF[2 -: 8]").error).toMatch(/past bit 0/);
    expect(parseInput("0xFF[a:b]").error).toMatch(/not a bit select/);
    expect(parseInput("0xFF[]").error).toMatch(/empty bit select/);
  });

  it("keeps a stray bracket out of the literal", () => {
    expect(parseInput("0x[FF]").error).toBeDefined();
  });
});

describe("formatting helpers", () => {
  it("renders zero padded to the width", () => {
    expect(render(0xffn, 32, "hex")).toBe("000000FF");
    expect(render(0b101n, 8, "bin")).toBe("00000101");
  });

  it("reads a value as two's complement", () => {
    expect(signedValue(0xffn, 8)).toBe(-1n);
    expect(signedValue(0x7fn, 8)).toBe(127n);
    expect(signedValue(0xdeadbeefn, 32)).toBe(-559038737n);
  });

  it("slices right-aligned", () => {
    expect(sliceValue(0xdeadbeefn, 15, 8)).toBe(0xben);
    expect(sliceValue(0xdeadbeefn, 13, 13)).toBe(1n);
  });

  it("lists bits most significant first", () => {
    expect(bitsOf(0b1010n, 4)).toEqual([1, 0, 1, 0]);
    expect(bitsOf(0b1n, 5)).toEqual([0, 0, 0, 0, 1]);
  });

  it("groups from the right so a ragged group ends up on the left", () => {
    expect(groupFromRight("1011011", 4)).toEqual(["101", "1011"]);
    expect(groupFromRight("DEADBEEF", 4)).toEqual(["DEAD", "BEEF"]);
  });

  it("reads the pattern as an IEEE 754 float at the two native widths", () => {
    expect(floatValue(0x3f800000n, 32)).toBe(1);
    expect(floatValue(0xc0000000n, 32)).toBe(-2);
    expect(floatValue(0x3ff0000000000000n, 64)).toBe(1);
    expect(Number.isNaN(floatValue(0x7fc00000n, 32))).toBe(true);
    // Nothing sensible to say about a width the format does not have.
    expect(floatValue(0xffn, 8)).toBeNull();
    expect(floatValue(0n, 12)).toBeNull();
  });

  it("reads the pattern as bytes of text, unprintables dotted", () => {
    expect(asciiValue(0x48656c6cn, 32)).toEqual(["H", "e", "l", "l"]);
    expect(asciiValue(0x0041n, 16)).toEqual(["·", "A"]);
    expect(asciiValue(0b10110n, 5)).toBeNull();
  });

  it("rewrites only the trailing bit select", () => {
    expect(applySelection("0xDEADBEEF[13]", 31, 16)).toBe("0xDEADBEEF[31:16]");
    expect(applySelection("0xDEADBEEF", 4, 4)).toBe("0xDEADBEEF[4]");
    expect(applySelection("0xDEADBEEF[13]", null)).toBe("0xDEADBEEF");
  });
});
