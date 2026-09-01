/**
 * The client-side cryptography.
 *
 * The server carries the bytes and never holds the key. Files, their names and
 * the shared note are encrypted here before they leave, and decrypted here
 * after they come back; what the server stores is opaque to it.
 *
 * The awkward part is that six digits cannot carry a 256-bit key, so a device
 * joining by code has to arrive at it another way. It does that with an
 * ephemeral ECDH exchange: each side sends a public key, the owner wraps the
 * session key to the shared secret, and the server relays two public keys and
 * one ciphertext — none of which help it. The four-digit check is what stops it
 * relaying keys of its own instead; see `shortAuthString`.
 *
 * Everything here needs `crypto.subtle`, which only exists in a secure context.
 * Over plain HTTP none of it runs at all.
 */

const IV_BYTES = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const subtle = () => {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error(
      "Encryption is unavailable. This page has to be served over HTTPS."
    );
  }
  return crypto.subtle;
};

export const isSupported = () =>
  typeof crypto !== "undefined" && Boolean(crypto.subtle);

/** Base64 in chunks: `fromCharCode(...bytes)` blows the stack on a big array. */
export function toBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(at, at + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

// --- symmetric ---------------------------------------------------------

export const generateSessionKey = () =>
  subtle().generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);

/**
 * Encrypts to `iv || ciphertext`.
 *
 * The IV travels with the ciphertext rather than in a column of its own: it is
 * not a secret, it is useless without the key, and one blob is one thing to get
 * right instead of two things to keep together.
 */
export async function encrypt(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await subtle().encrypt({ name: "AES-GCM", iv }, key, bytes);
  const payload = new Uint8Array(IV_BYTES + sealed.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(sealed), IV_BYTES);
  return payload;
}

export async function decrypt(key, payload) {
  const iv = payload.subarray(0, IV_BYTES);
  const body = payload.subarray(IV_BYTES);
  const plain = await subtle().decrypt({ name: "AES-GCM", iv }, key, body);
  return new Uint8Array(plain);
}

export const encryptText = async (key, text) =>
  toBase64(await encrypt(key, encoder.encode(text)));

export const decryptText = async (key, encoded) =>
  decoder.decode(await decrypt(key, fromBase64(encoded)));

export const encryptJson = (key, value) => encryptText(key, JSON.stringify(value));

export const decryptJson = async (key, encoded) =>
  JSON.parse(await decryptText(key, encoded));

// --- key agreement -----------------------------------------------------

export const generateKeyPair = () =>
  subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveBits",
  ]);

export const exportPublicKey = async (keyPair) =>
  toBase64(new Uint8Array(await subtle().exportKey("raw", keyPair.publicKey)));

const importPublicKey = (encoded) =>
  subtle().importKey(
    "raw",
    fromBase64(encoded),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

/** The raw ECDH secret, which is never used directly — HKDF separates it. */
async function sharedSecret(privateKey, peerPublic) {
  const peer = await importPublicKey(peerPublic);
  return subtle().deriveBits({ name: "ECDH", public: peer }, privateKey, 256);
}

const hkdf = async (secret, info, bits) => {
  const material = await subtle().importKey("raw", secret, "HKDF", false, [
    "deriveBits",
  ]);
  return subtle().deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: encoder.encode(info),
    },
    material,
    bits
  );
};

/**
 * Everything a completed handshake produces: the key that wraps the session
 * key, and the four digits both devices show so a person can confirm the
 * exchange was not tampered with.
 */
export async function completeHandshake({ privateKey, peerPublic, transcript }) {
  const secret = await sharedSecret(privateKey, peerPublic);
  const wrappingBits = await hkdf(secret, `uploadthat/wrap/v1|${transcript}`, 256);
  const wrappingKey = await subtle().importKey(
    "raw",
    wrappingBits,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"]
  );
  const sasBits = await hkdf(secret, `uploadthat/sas/v1|${transcript}`, 32);
  return { wrappingKey, sas: digitsFrom(sasBits) };
}

/**
 * The transcript both sides hash: the session and both public keys, in a fixed
 * order. It is what makes the four digits a check on the exchange rather than
 * on the secret alone — a server that substituted its own keys would have to
 * make two different transcripts agree, and it cannot.
 */
export const handshakeTranscript = (sessionId, ownerPublic, joinerPublic) =>
  `${sessionId}|${ownerPublic}|${joinerPublic}`;

/** Four digits, which is what a person can be asked to compare at a glance. */
function digitsFrom(bits) {
  const bytes = new Uint8Array(bits);
  const value = ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
  return String(value % 10000).padStart(4, "0");
}

export async function wrapSessionKey(wrappingKey, sessionKey) {
  const raw = await subtle().exportKey("raw", sessionKey);
  return toBase64(await encrypt(wrappingKey, new Uint8Array(raw)));
}

export async function unwrapSessionKey(wrappingKey, wrapped) {
  const raw = await decrypt(wrappingKey, fromBase64(wrapped));
  return subtle().importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
}
