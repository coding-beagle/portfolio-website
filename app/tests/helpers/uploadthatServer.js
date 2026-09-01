/**
 * A small in-memory stand-in for the uploadthat API.
 *
 * The client encrypts everything before it leaves, so a stub that returns
 * canned responses cannot produce a manifest the app is able to read — only the
 * app knows the key. Storing what it is given and handing it back is both
 * simpler and a much better test: the names in the file list are names the app
 * itself encrypted and then decrypted again.
 *
 * It also stands in for the second device, which cannot be a second React tree
 * in the same test. `joinAsOtherDevice` does what a phone would do — generate a
 * keypair, present the code — so the owner's screen has a real handshake to
 * confirm.
 */
import {
  completeHandshake,
  exportPublicKey,
  generateKeyPair,
  handshakeTranscript,
  unwrapSessionKey,
} from "../../src/components/pages/uploadthat/crypto";

/** jsdom's Blob has no `arrayBuffer()`, but it does have FileReader. */
const blobBytes = (blob) =>
  typeof blob.arrayBuffer === "function"
    ? blob.arrayBuffer().then((buffer) => new Uint8Array(buffer))
    : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result));
        reader.onerror = reject;
        reader.readAsArrayBuffer(blob);
      });

const CODE = "482913";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

export function installUploadthatServer({ tier = "anon" } = {}) {
  const state = {
    session: null,
    files: [],
    note: "",
    joins: [],
    members: new Map(),
    requests: [],
    nextFileId: 0,
  };

  const json = (status, body, headers = {}) => ({
    ok: status < 400,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  });

  const manifest = () => ({
    version: state.files.length + (state.note ? 1 : 0) + state.joins.length,
    expiresAt: Math.floor(Date.now() / 1000) + 900,
    bytesUsed: state.files.reduce((total, file) => total + file.size, 0),
    note: state.note,
    files: state.files.map(({ body, ...rest }) => rest),
    joins: state.joins.filter((join) => join.status === "pending"),
    you: { memberId: "owner", label: "Device 1", role: "owner", status: "active" },
  });

  global.fetch = jest.fn(async (url, options = {}) => {
    const method = options.method || "GET";
    state.requests.push({ url, method });
    const body = options.body ? JSON.parse(options.body) : {};

    if (url === "/api/session" && method === "POST") {
      state.session = { ownerPublicKey: body.publicKey };
      return json(201, {
        sessionId: SESSION_ID,
        code: CODE,
        token: "owner-token",
        memberId: "owner",
        role: "owner",
        status: "active",
        tier: body.operatorKey ? "operator" : tier,
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        limits: {},
      });
    }

    if (url.startsWith("/api/join/") && method === "POST") {
      return json(200, {
        sessionId: SESSION_ID,
        code: CODE,
        token: "guest-token",
        memberId: "guest",
        role: "guest",
        status: "pending",
        ownerPublicKey: state.session.ownerPublicKey,
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        limits: {},
      });
    }

    if (url.endsWith("/manifest")) return json(200, manifest(), { ETag: `"v${Date.now()}"` });

    if (url.endsWith("/note") && method === "POST") {
      state.note = body.note;
      return json(200, { saved: true });
    }

    if (url.includes("/joins/") && method === "POST") {
      const id = url.split("/joins/")[1];
      const join = state.joins.find((candidate) => candidate.id === id);
      if (join) {
        join.status = "active";
        join.wrappedKey = body.wrappedKey;
      }
      return json(200, { approved: true });
    }

    if (url.includes("/joins/") && method === "DELETE") {
      const id = url.split("/joins/")[1];
      state.joins = state.joins.filter((candidate) => candidate.id !== id);
      return json(200, { rejected: true });
    }

    if (url.includes("/files/")) {
      const id = url.split("/files/")[1];
      const file = state.files.find((candidate) => candidate.id === id);
      if (method === "DELETE") {
        state.files = state.files.filter((candidate) => candidate.id !== id);
        return json(200, { deleted: true });
      }
      if (!file) return json(404, { error: { code: "no_file", message: "Gone." } });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => file.body.buffer.slice(
          file.body.byteOffset,
          file.body.byteOffset + file.body.byteLength
        ),
      };
    }

    return json(404, { error: { code: "not_found", message: "No such endpoint." } });
  });

  // Uploads go through XHR, for the progress events fetch still cannot give.
  class FakeXHR {
    constructor() {
      this.upload = {};
      this.status = 201;
      this.responseText = "{}";
    }
    open(method, url) {
      this.url = url;
    }
    setRequestHeader() {}
    async send(form) {
      const blob = form.get("file");
      const bytes = await blobBytes(blob);
      const id = `file-${state.nextFileId++}`;
      state.files.push({
        id,
        size: bytes.length,
        meta: form.get("meta"),
        uploadedBy: "Device 1",
        createdAt: Math.floor(Date.now() / 1000),
        body: bytes,
      });
      this.responseText = JSON.stringify({ id, size: bytes.length });
      this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 });
      this.onload?.();
    }
  }
  global.XMLHttpRequest = FakeXHR;

  /**
   * What a phone does when it scans the code: its own keypair, its own side of
   * the handshake. Returns the digits it would be showing, so a test can check
   * the owner's screen agrees.
   */
  async function joinAsOtherDevice() {
    const pair = await generateKeyPair();
    const publicKey = await exportPublicKey(pair);
    const id = `join-${state.joins.length}`;
    state.joins.push({ id, label: "Device 2", publicKey, status: "pending" });

    const agreed = await completeHandshake({
      privateKey: pair.privateKey,
      peerPublic: state.session.ownerPublicKey,
      transcript: handshakeTranscript(SESSION_ID, state.session.ownerPublicKey, publicKey),
    });

    return {
      id,
      sas: agreed.sas,
      /** The session key, once the owner has handed it over. */
      async sessionKey() {
        const join = state.joins.find((candidate) => candidate.id === id);
        if (!join?.wrappedKey) return null;
        return unwrapSessionKey(agreed.wrappingKey, join.wrappedKey);
      },
    };
  }

  return { state, joinAsOtherDevice, CODE, SESSION_ID };
}

export function uninstallUploadthatServer() {
  delete global.fetch;
  delete global.XMLHttpRequest;
}
