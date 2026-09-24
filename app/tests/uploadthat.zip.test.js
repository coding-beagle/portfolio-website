/**
 * The zip behind "Download all", read back by walking its own central
 * directory the way an unzipper would.
 */
import { crc32, uniqueNames, zipFiles } from "../src/components/pages/uploadthat/zip";
import { blobBytes, unzip } from "./helpers/unzip";

describe("zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("packs files that read back byte for byte", async () => {
    const encode = (text) => new TextEncoder().encode(text);
    const blob = zipFiles([
      { name: "notes.txt", bytes: encode("hello there") },
      { name: "résumé.md", bytes: encode("# hi") },
      { name: "empty", bytes: new Uint8Array() },
    ]);
    expect(blob.type).toBe("application/zip");
    expect(unzip(await blobBytes(blob))).toEqual([
      { name: "notes.txt", text: "hello there" },
      { name: "résumé.md", text: "# hi" },
      { name: "empty", text: "" },
    ]);
  });

  it("numbers repeated names and keeps entries out of other folders", () => {
    expect(uniqueNames(["a.txt", "A.txt", "a.txt", "b", "b", "../x/y.png", ""])).toEqual([
      "a.txt",
      "A (2).txt",
      "a (3).txt",
      "b",
      "b (2)",
      ".._x_y.png",
      "file",
    ]);
  });
});
