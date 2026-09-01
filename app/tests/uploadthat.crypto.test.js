/**
 * The client-side cryptography, exercised against the browser API for real —
 * Node's WebCrypto is the same implementation, so nothing here is mocked.
 */
import {
  completeHandshake,
  decrypt,
  decryptJson,
  decryptText,
  encrypt,
  encryptJson,
  encryptText,
  exportPublicKey,
  fromBase64,
  generateKeyPair,
  generateSessionKey,
  handshakeTranscript,
  isSupported,
  toBase64,
  unwrapSessionKey,
  wrapSessionKey,
} from "../src/components/pages/uploadthat/crypto";

const bytes = (...values) => new Uint8Array(values);

describe("symmetric encryption", () => {
  it("is available at all", () => {
    expect(isSupported()).toBe(true);
  });

  it("round-trips bytes", async () => {
    const key = await generateSessionKey();
    const plain = bytes(1, 2, 3, 250, 0, 128);
    const sealed = await encrypt(key, plain);
    expect(Array.from(await decrypt(key, sealed))).toEqual(Array.from(plain));
  });

  it("carries its IV with it, so nothing else has to keep them together", async () => {
    const key = await generateSessionKey();
    const sealed = await encrypt(key, bytes(1, 2, 3));
    // Twelve bytes of IV, then the ciphertext and its 16-byte tag.
    expect(sealed.length).toBe(12 + 3 + 16);
  });

  it("never produces the same ciphertext twice", async () => {
    const key = await generateSessionKey();
    const once = await encrypt(key, bytes(7, 7, 7));
    const twice = await encrypt(key, bytes(7, 7, 7));
    expect(toBase64(once)).not.toBe(toBase64(twice));
  });

  it("refuses a different key rather than returning rubbish", async () => {
    const sealed = await encrypt(await generateSessionKey(), bytes(1, 2, 3));
    await expect(decrypt(await generateSessionKey(), sealed)).rejects.toThrow();
  });

  it("detects a tampered ciphertext", async () => {
    const key = await generateSessionKey();
    const sealed = await encrypt(key, bytes(1, 2, 3));
    sealed[sealed.length - 1] ^= 0xff;
    await expect(decrypt(key, sealed)).rejects.toThrow();
  });

  it("round-trips text and JSON, including names btoa alone would choke on", async () => {
    const key = await generateSessionKey();
    expect(await decryptText(key, await encryptText(key, "hello"))).toBe("hello");

    const meta = { name: "résumé — 履歴書.pdf", type: "application/pdf" };
    expect(await decryptJson(key, await encryptJson(key, meta))).toEqual(meta);
  });

  it("base64 survives a payload large enough to blow the stack unchunked", () => {
    const big = new Uint8Array(200000).map((_, index) => index % 251);
    expect(Array.from(fromBase64(toBase64(big)))).toEqual(Array.from(big));
  });
});

describe("the handshake", () => {
  /** What the two devices would exchange through the server. */
  const meet = async (sessionId = "session-1") => {
    const owner = await generateKeyPair();
    const joiner = await generateKeyPair();
    const ownerPublic = await exportPublicKey(owner);
    const joinerPublic = await exportPublicKey(joiner);
    const transcript = handshakeTranscript(sessionId, ownerPublic, joinerPublic);

    return {
      owner: await completeHandshake({
        privateKey: owner.privateKey,
        peerPublic: joinerPublic,
        transcript,
      }),
      joiner: await completeHandshake({
        privateKey: joiner.privateKey,
        peerPublic: ownerPublic,
        transcript,
      }),
      ownerPublic,
      joinerPublic,
    };
  };

  it("lets both sides reach the same secret without it crossing the wire", async () => {
    const { owner, joiner } = await meet();
    const sessionKey = await generateSessionKey();

    // Only the wrapped key is ever sent, and the joiner opens it.
    const wrapped = await wrapSessionKey(owner.wrappingKey, sessionKey);
    const recovered = await unwrapSessionKey(joiner.wrappingKey, wrapped);

    const sealed = await encrypt(sessionKey, bytes(9, 8, 7));
    expect(Array.from(await decrypt(recovered, sealed))).toEqual([9, 8, 7]);
  });

  it("shows both devices the same four digits", async () => {
    const { owner, joiner } = await meet();
    expect(owner.sas).toMatch(/^\d{4}$/);
    expect(owner.sas).toBe(joiner.sas);
  });

  it("shows different digits if the keys were swapped in transit", async () => {
    // A server relaying its own keys ends up with two different exchanges, so
    // the two devices cannot both be shown the same number. That is the whole
    // point of asking a person to compare them.
    const honest = await meet();
    const attacker = await generateKeyPair();
    const attackerPublic = await exportPublicKey(attacker);

    const tampered = await completeHandshake({
      privateKey: attacker.privateKey,
      peerPublic: honest.joinerPublic,
      transcript: handshakeTranscript("session-1", attackerPublic, honest.joinerPublic),
    });

    expect(tampered.sas).not.toBe(honest.owner.sas);
  });

  it("binds the digits to the session, not just to the secret", async () => {
    const first = await meet("session-1");
    const second = await meet("session-2");
    expect(first.owner.sas).not.toBe(second.owner.sas);
  });

  it("will not unwrap with the wrong side's key", async () => {
    const { owner } = await meet();
    const stranger = await meet();
    const wrapped = await wrapSessionKey(owner.wrappingKey, await generateSessionKey());
    await expect(unwrapSessionKey(stranger.joiner.wrappingKey, wrapped)).rejects.toThrow();
  });
});
