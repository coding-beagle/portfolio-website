/**
 * The blog list is rendered straight from the generated index, so the
 * frontmatter parser is the piece worth pinning down.
 */
const { parseFrontmatter, slugFromFilename } = require("../scripts/build-posts");

describe("parseFrontmatter", () => {
  it("reads scalars, inline lists and dash lists", () => {
    const source = [
      "---",
      "title: Hello, World",
      "date: 2026-08-27",
      'summary: "Quoted: with a colon"',
      "tags: [meta, react]",
      "extra:",
      "  - one",
      "  - two",
      "---",
      "",
      "body",
    ].join("\n");

    expect(parseFrontmatter(source)).toEqual({
      title: "Hello, World",
      date: "2026-08-27",
      summary: "Quoted: with a colon",
      tags: ["meta", "react"],
      extra: ["one", "two"],
    });
  });

  it("handles CRLF line endings", () => {
    expect(parseFrontmatter("---\r\ntitle: Windows\r\n---\r\nbody")).toEqual({
      title: "Windows",
    });
  });

  it("returns nothing when there is no frontmatter block", () => {
    expect(parseFrontmatter("# Just a heading\n")).toEqual({});
  });

  it("ignores a fence that does not start the file", () => {
    expect(parseFrontmatter("intro\n---\ntitle: Nope\n---\n")).toEqual({});
  });
});

describe("slugFromFilename", () => {
  it("drops the date prefix and the extension", () => {
    expect(slugFromFilename("2026-08-27-fpga-mandelbrot.md")).toBe("fpga-mandelbrot");
  });

  it("leaves an undated filename alone", () => {
    expect(slugFromFilename("about.md")).toBe("about");
  });

  it("keeps digits that are not a date prefix", () => {
    expect(slugFromFilename("16-bit-cpu.md")).toBe("16-bit-cpu");
  });
});
