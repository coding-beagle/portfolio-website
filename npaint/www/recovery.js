// Crash recovery: a copy of the document in the browser's own store, so that
// a closed tab, a reload or a wasm that ran out of memory does not take the
// afternoon's work with it.
//
// The record is one row in IndexedDB — the same gzipped `.npaint` stream
// `File > Save` writes, plus the document's name and when it was taken.
// IndexedDB rather than localStorage because the stream is megabytes and
// binary, and neither of those is what localStorage is for.
//
// **Nothing here may throw.** Every browser has a way to make this fail:
// a private window with the store switched off, a user who has blocked site
// data, a quota that a big document does not fit in. All of that has to end
// with an editor that works exactly as it did before, only without the
// safety net — so each entry point resolves to `null`/`false` instead of
// rejecting, and the page treats a failure as "no recovery available".
//
// It is *one* record, not a history: the point is the last state of the one
// document, and keeping more would mean asking the user which of six
// unlabelled copies they meant.

const DB_NAME = "npaint";
const DB_VERSION = 1;
const STORE = "recovery";
const KEY = "current";

/** Whether the browser has given us a store at all. */
export const supported = () => typeof indexedDB !== "undefined";

function openDb() {
  return new Promise((resolve, reject) => {
    if (!supported()) {
      reject(new Error("no IndexedDB"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("blocked"));
  });
}

/** Runs one transaction and closes the connection behind it. */
async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("aborted"));
    });
  } finally {
    db.close();
  }
}

/**
 * Keeps `bytes` (a gzipped `.npaint` stream) as the recovery copy.
 * Returns whether it got there.
 */
export async function writeRecovery(bytes, name) {
  try {
    await withStore("readwrite", (store) =>
      store.put({ bytes, name, savedAt: Date.now() }, KEY),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * The recovery copy, as `{ bytes, name, savedAt }`, or `null` if there is
 * none or the store cannot be read.
 */
export async function readRecovery() {
  try {
    const found = await withStore("readonly", (store) => store.get(KEY));
    if (!found || !found.bytes) return null;
    return found;
  } catch {
    return null;
  }
}

/** Throws the recovery copy away. */
export async function clearRecovery() {
  try {
    await withStore("readwrite", (store) => store.delete(KEY));
    return true;
  } catch {
    return false;
  }
}
