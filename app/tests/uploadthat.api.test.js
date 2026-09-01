/**
 * The uploadthat API client: the metadata encoding both phases depend on, the
 * error shape the UI switches on, and the conditional manifest fetch.
 */
import {
  ApiError,
  fetchManifest,
  createSession,
  joinSession,
} from "../src/components/pages/uploadthat/api";

const session = { sessionId: "11111111-1111-4111-8111-111111111111", token: "tok" };

/** A fetch stub that records what it was called with. */
function stubFetch(responses) {
  const calls = [];
  global.fetch = jest.fn((url, options = {}) => {
    calls.push({ url, options });
    const next = responses.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({
      ok: next.status < 400,
      status: next.status,
      headers: { get: (name) => (next.headers || {})[name] ?? null },
      json: () =>
        next.body === undefined
          ? Promise.reject(new Error("no body"))
          : Promise.resolve(next.body),
      blob: () => Promise.resolve(next.blob),
    });
  });
  return calls;
}

afterEach(() => {
  delete global.fetch;
});

describe("errors", () => {
  it("carries the server's code so the UI can act on it", async () => {
    stubFetch([{ status: 429, body: { error: { code: "rate_limited", message: "Too many." } } }]);
    await expect(createSession()).rejects.toMatchObject({
      code: "rate_limited",
      message: "Too many.",
      status: 429,
    });
  });

  it("reports an unreachable server as offline rather than a crash", async () => {
    stubFetch([new TypeError("Failed to fetch")]);
    const failure = await createSession().catch((error) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.code).toBe("offline");
  });

  it("still fails cleanly when the body is not JSON", async () => {
    stubFetch([{ status: 500 }]);
    await expect(createSession()).rejects.toMatchObject({ code: "server_error" });
  });
});

describe("session calls", () => {
  it("always sends a public key, and an operator key only when there is one", async () => {
    const calls = stubFetch([{ status: 201, body: { sessionId: "s" } }]);
    await createSession({ publicKey: "pubA" });
    expect(JSON.parse(calls[0].options.body)).toEqual({ publicKey: "pubA" });

    const withKey = stubFetch([{ status: 201, body: { sessionId: "s" } }]);
    await createSession({ operatorKey: "hunter2", publicKey: "pubA" });
    expect(JSON.parse(withKey[0].options.body)).toEqual({
      operatorKey: "hunter2",
      publicKey: "pubA",
    });
  });

  it("posts the code and the joining device's key", async () => {
    const calls = stubFetch([{ status: 200, body: { sessionId: "s", token: "t" } }]);
    await joinSession("482913", "pubB");
    expect(calls[0].url).toBe("/api/join/482913");
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual({ publicKey: "pubB" });
  });
});

describe("the polled manifest", () => {
  it("passes descriptions through untouched — they are ciphertext here", async () => {
    stubFetch([
      {
        status: 200,
        headers: { ETag: '"v3-1111"' },
        body: {
          version: 3,
          expiresAt: 100,
          files: [{ id: "f1", size: 12, meta: "c2VhbGVk", uploadedBy: "Device 2" }],
        },
      },
    ]);

    const manifest = await fetchManifest(session);
    expect(manifest.etag).toBe('"v3-1111"');
    // No decoding here: only the hook has the key.
    expect(manifest.files[0].meta).toBe("c2VhbGVk");
    expect(manifest.files[0].name).toBeUndefined();
  });

  it("sends the etag back and reports an unchanged session as null", async () => {
    const calls = stubFetch([{ status: 304 }]);
    const result = await fetchManifest(session, '"v3-1111"');
    expect(result).toBeNull();
    expect(calls[0].options.headers["If-None-Match"]).toBe('"v3-1111"');
  });

  it("authenticates with the session token", async () => {
    const calls = stubFetch([{ status: 200, headers: {}, body: { version: 1, files: [] } }]);
    await fetchManifest(session);
    expect(calls[0].options.headers.Authorization).toBe("Bearer tok");
  });
});
