/**
 * A minimal zip writer, for handing over every file in a session at once.
 *
 * Entries are stored, not deflated: most of what gets shared (photos, video,
 * PDFs, archives) is compressed already, and the bytes are in memory anyway
 * because they had to be decrypted. Names are written as UTF-8 with the flag
 * that says so, which every current unzipper honours.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1)
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Date and time in the two 16-bit DOS fields a zip header wants. */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * Makes every name unique, the way a file manager would: a second `notes.txt`
 * becomes `notes (2).txt`. Slashes are replaced so no entry can land outside
 * the folder it is unzipped into.
 */
export function uniqueNames(names) {
  const taken = new Set();
  return names.map((raw) => {
    const name = (raw || "file").replace(/[/\\]/g, "_");
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n += 1)
      candidate = `${stem} (${n})${ext}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

/**
 * Packs `entries` ({ name, bytes: Uint8Array }) into a zip Blob. Names are
 * taken as given; run them through `uniqueNames` first.
 */
export function zipFiles(entries, date = new Date()) {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(date);
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, bytes } of entries) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(bytes);
    if (offset + bytes.length > 0xffffffff)
      throw new Error("Too much to zip in one go (over 4 GB)");

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(local, nameBytes, bytes);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true); // version made by
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, day, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, bytes.length, true);
    entry.setUint32(24, bytes.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(entry, nameBytes);

    offset += 30 + nameBytes.length + bytes.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
