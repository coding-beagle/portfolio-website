/**
 * Thumbnails for image files.
 *
 * There is no URL a browser can put straight into an `<img>`: downloads need an
 * Authorization header, so a preview means fetching the bytes and building an
 * object URL from them. That is the same shape phase 2 will need — fetch, then
 * decrypt, then build the URL — so nothing here has to change when encryption
 * lands, only what happens in between.
 *
 * Because a preview costs a full download, they are capped and cached: without
 * the cache the two-second manifest poll would re-fetch every image on every
 * tick.
 */
import { downloadFile } from "./api";

// Beyond this, fetching a thumbnail nobody asked for is not worth the download,
// least of all on a phone using mobile data. It is a cap on what loads *by
// itself*, not on what can be looked at — a larger image still opens on demand.
export const PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

const cache = new Map();

/** Anything that can be shown as a picture, at any size. */
export const isImage = (file) =>
  typeof file.type === "string" && file.type.startsWith("image/") && file.size > 0;

/** Small enough that its thumbnail is worth loading without being asked. */
export const canPreview = (file) => isImage(file) && file.size <= PREVIEW_MAX_BYTES;

const keyOf = (session, file) => `${session.sessionId}:${file.id}`;

/**
 * The object URL for a file's preview, fetching it once and reusing it after.
 * No size check here: that is the caller's decision, and an image opened
 * deliberately should load however big it is.
 *
 * The blob is rebuilt with the type from the file's own description rather than
 * the response's, because downloads deliberately come back as
 * application/octet-stream so nothing can render inline on the domain. Only
 * `image/*` is honoured, and only ever inside an `<img>`.
 */
export function loadPreview(session, file) {
  const key = keyOf(session, file);
  if (cache.has(key)) {
    return cache.get(key);
  }

  const pending = downloadFile(session, file.id)
    .then((blob) => blob.arrayBuffer())
    .then((bytes) => URL.createObjectURL(new Blob([bytes], { type: file.type })))
    .catch(() => null);

  cache.set(key, pending);
  return pending;
}

/** Drops every preview for a session and gives the object URLs back. */
export function releasePreviews(sessionId) {
  const prefix = `${sessionId}:`;
  cache.forEach((pending, key) => {
    if (!key.startsWith(prefix)) return;
    Promise.resolve(pending).then((url) => {
      if (url) URL.revokeObjectURL(url);
    });
    cache.delete(key);
  });
}
