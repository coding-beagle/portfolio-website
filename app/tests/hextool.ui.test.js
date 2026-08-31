/**
 * The hex tool as it is actually used: what a pasted value renders as, and what
 * clicking the columns does back to the input.
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HexApp from "../src/HexApp";

const input = () => screen.getByLabelText("Value to decode");
const bit = (index) => screen.getByTitle(`bit ${index}`);

/**
 * Replaces whatever is in the box with `text`. Set rather than typed: this
 * user-event reads `[` as the start of a key descriptor, so a bit select would
 * never survive being typed out.
 */
const retype = (text) => {
  fireEvent.change(input(), { target: { value: text } });
};

const panel = (title) =>
  screen.getByRole("heading", { name: new RegExp(title, "i") }).closest("section");

/** Reads one panel as `format`, and gives back the value it shows. */
const readAs = (title, format) => {
  const section = panel(title);
  userEvent.click(within(section).getByRole("button", { name: format }));
  return section.textContent;
};

describe("hex tool", () => {
  it("starts empty, with nothing to show", () => {
    render(<HexApp />);
    expect(input()).toHaveValue("");
    expect(screen.queryAllByTitle(/^bit \d+$/)).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: /whole word/i })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders one column per bit, most significant first", () => {
    render(<HexApp />);
    retype("0xDEADBEEF");
    // 0xDEADBEEF is eight hex digits, so a 32-bit word.
    expect(screen.getAllByTitle(/^bit \d+$/)).toHaveLength(32);
    expect(bit(31)).toHaveTextContent("1");
    expect(bit(0)).toHaveTextContent("1");
    expect(bit(1)).toHaveTextContent("1");
    expect(bit(4)).toHaveTextContent("0");
  });

  it("opens showing the opposite of what was pasted", () => {
    render(<HexApp />);
    retype("0xDEADBEEF");
    // Hex in, so binary out — without having to ask for it.
    expect(panel("whole word")).toHaveTextContent(
      "1101_1110_1010_1101_1011_1110_1110_1111"
    );

    retype("0b1011_0110");
    expect(panel("whole word")).toHaveTextContent("0xB6");
  });

  it("reads the whole word in whichever format is picked", () => {
    render(<HexApp />);
    retype("0xDEADBEEF");
    expect(readAs("whole word", "hex")).toContain("0xDEAD_BEEF");
    expect(readAs("whole word", "dec")).toContain("3735928559");
    expect(readAs("whole word", "signed")).toContain("-559038737");
    expect(readAs("whole word", "verilog")).toContain("32'hDEADBEEF");
    expect(readAs("whole word", "float")).toContain("-6.2598534e+18");
  });

  it("only offers the formats a width can support", () => {
    render(<HexApp />);
    retype("0xDEADBEEF");
    const wide = within(panel("whole word"));
    expect(wide.getByRole("button", { name: "float" })).toBeInTheDocument();
    expect(wide.getByRole("button", { name: "ascii" })).toBeInTheDocument();

    // A 13-bit slice is neither a float nor a whole number of bytes.
    retype("0xDEADBEEF[12:0]");
    const narrow = within(panel("slice"));
    expect(narrow.queryByRole("button", { name: "float" })).toBeNull();
    expect(narrow.queryByRole("button", { name: "ascii" })).toBeNull();
  });

  it("keeps the slice's format independent of the whole word's", () => {
    render(<HexApp />);
    retype("0xDEADBEEF[31:16]");
    expect(readAs("slice", "hex")).toContain("0xDEAD");
    // Picking hex for the slice leaves the word on its automatic binary.
    expect(panel("whole word")).toHaveTextContent("1101_1110");
  });

  it("resolves the bit select into its own panel", () => {
    render(<HexApp />);
    retype("0xDEADBEEF[13]");
    expect(panel("slice \\[13\\]")).toHaveTextContent("1 bit");
  });

  it("writes the bit select for you when a column is clicked", () => {
    render(<HexApp />);
    retype("0xDEADBEEF");

    userEvent.click(bit(5));
    expect(input()).toHaveValue("0xDEADBEEF[5]");

    // Shift-click takes the range back to where the last plain click landed.
    userEvent.click(bit(12), { shiftKey: true });
    expect(input()).toHaveValue("0xDEADBEEF[12:5]");

    expect(panel("slice \\[12:5\\]")).toHaveTextContent("8 bits");
  });

  it("clears the select when the only selected bit is clicked again", () => {
    render(<HexApp />);
    retype("0xDEADBEEF[13]");

    // Bit 13 is already the whole selection, so one click takes it away.
    userEvent.click(bit(13));
    expect(input()).toHaveValue("0xDEADBEEF");
    expect(screen.queryByRole("heading", { name: /slice/i })).toBeNull();

    userEvent.click(bit(13));
    expect(input()).toHaveValue("0xDEADBEEF[13]");
  });

  it("pads the value out to a chosen width", () => {
    render(<HexApp />);
    retype("0xFF");
    expect(screen.getAllByTitle(/^bit \d+$/)).toHaveLength(8);

    const widths = screen.getByText("width").parentElement;
    userEvent.click(within(widths).getByRole("button", { name: "32" }));
    expect(screen.getAllByTitle(/^bit \d+$/)).toHaveLength(32);
    expect(readAs("whole word", "hex")).toContain("0x0000_00FF");
  });

  it("offers a way back to the site the tool is a subdomain of", () => {
    render(<HexApp />);
    const home = screen.getByRole("link", { name: /nteague\.com/i });
    // jsdom serves the page from localhost, where the portfolio is a hash away.
    expect(home).toHaveAttribute("href", "#/?scene=desktop");
  });

  it("puts the theme toggle beside the link back to the site", () => {
    render(<HexApp />);
    const home = screen.getByRole("link", { name: /nteague\.com/i });
    const toggle = screen.getByRole("button", { name: /Switch to (light|dark) mode/i });
    expect(home.parentElement).toContainElement(toggle);
  });

  it("explains a literal it cannot read", () => {
    render(<HexApp />);
    retype("0b1021");
    expect(screen.getByRole("alert")).toHaveTextContent(/not a valid bin/);
  });
});
