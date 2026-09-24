/**
 * Reads back a zip the uploadthat page wrote, walking its central directory the
 * way an unzipper would.
 */
import { crc32 } from "../../src/components/pages/uploadthat/zip";

export const blobBytes = (blob) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.readAsArrayBuffer(blob);
  });

/** Entries of a stored zip, found through the central directory. */
export function unzip(bytes) {
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const crc = view.getUint32(at + 16, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.slice(at + 46, at + 46 + nameLength));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true);
    const data = bytes.slice(start, start + size);
    expect(crc32(data)).toBe(crc);
    entries.push({ name, text: new TextDecoder().decode(data) });
    at += 46 + nameLength;
  }
  return entries;
}
