/**
 * The uploadthat API client.
 *
 * Kept free of React so the awkward parts — the metadata encoding, the error
 * shape, the conditional manifest fetch — can be tested directly.
 *
 * Nothing here knows what any of it means. File bodies, their descriptions and
 * the shared note are ciphertext by the time they get here and stay that way
 * until they are back in the hook that holds the key — this layer only moves
 * opaque bytes, which is the same thing the server does with them.
 */

const BASE = "/api";

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

const authHeaders = (session) => ({ Authorization: `Bearer ${session.token}` });

async function request(path, { method = "GET", body, session, headers = {} } = {}) {
  // A POST always carries a body, even an empty one. Browsers send
  // `Content-Length: 0` for a bodiless POST and the server is happy with that,
  // but ModSecurity on this host rejects a POST with no Content-Length at all
  // with a 403 that never reaches PHP — so there is no reason to leave the
  // heartbeat and the close call one proxy quirk away from silent failure.
  const payload = method === "POST" ? JSON.stringify(body ?? {}) : undefined;

  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
        ...(session ? authHeaders(session) : {}),
        ...headers,
      },
      body: payload,
    });
  } catch (error) {
    throw new ApiError("offline", "Could not reach the server.", 0);
  }

  if (response.status === 204 || response.status === 304) {
    return { status: response.status, data: null, response };
  }

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    const detail = data && data.error ? data.error : {};
    throw new ApiError(
      detail.code || "server_error",
      detail.message || "Something went wrong.",
      response.status
    );
  }

  return { status: response.status, data, response };
}

export async function createSession({ operatorKey, publicKey } = {}) {
  const { data } = await request("/session", {
    method: "POST",
    body: operatorKey ? { operatorKey, publicKey } : { publicKey },
  });
  return data;
}

export async function joinSession(code, publicKey) {
  const { data } = await request(`/join/${code}`, {
    method: "POST",
    body: { publicKey },
  });
  return data;
}

/** What a device that has joined is waiting for: whether it is in yet. */
export async function fetchHandshake(session) {
  const { data } = await request(`/session/${session.sessionId}/handshake`, { session });
  return data;
}

export async function approveJoin(session, joinId, wrappedKey) {
  await request(`/session/${session.sessionId}/joins/${joinId}`, {
    method: "POST",
    session,
    body: { wrappedKey },
  });
}

export async function rejectJoin(session, joinId) {
  await request(`/session/${session.sessionId}/joins/${joinId}`, {
    method: "DELETE",
    session,
  });
}

export async function saveNote(session, note) {
  await request(`/session/${session.sessionId}/note`, {
    method: "POST",
    session,
    body: { note },
  });
}

export async function heartbeat(session) {
  const { data } = await request(`/session/${session.sessionId}/heartbeat`, {
    method: "POST",
    session,
  });
  return data;
}

export async function closeSession(session) {
  await request(`/session/${session.sessionId}/close`, { method: "POST", session });
}

/**
 * The polled endpoint. Returns null when the session has not changed since
 * `etag`, so a quiet session costs a 304 and no parsing.
 */
export async function fetchManifest(session, etag) {
  const { status, data, response } = await request(
    `/session/${session.sessionId}/manifest`,
    { session, headers: etag ? { "If-None-Match": etag } : {} }
  );
  if (status === 304) {
    return null;
  }
  // Descriptions come back as they went out: ciphertext. Turning them into
  // names is the hook's job, because only the hook has the key.
  return { etag: response.headers.get("ETag"), ...data };
}

/**
 * Uploads one already-encrypted body. XHR rather than fetch because fetch still
 * cannot report upload progress, and a progress bar is most of what makes a
 * slow phone upload bearable.
 */
export function uploadFile(session, body, meta, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("meta", meta);
    form.append("file", new Blob([body]), "blob");

    const request_ = new XMLHttpRequest();
    request_.open("POST", `${BASE}/session/${session.sessionId}/files`);
    request_.setRequestHeader("Authorization", `Bearer ${session.token}`);

    request_.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable) {
        onProgress(event.loaded / event.total);
      }
    };

    request_.onload = () => {
      let payload = null;
      try {
        payload = JSON.parse(request_.responseText);
      } catch (error) {
        payload = null;
      }
      if (request_.status >= 200 && request_.status < 300) {
        resolve(payload);
        return;
      }
      const detail = (payload && payload.error) || {};
      reject(
        new ApiError(
          detail.code || "upload_failed",
          detail.message || "The upload did not complete.",
          request_.status
        )
      );
    };

    request_.onerror = () =>
      reject(new ApiError("offline", "Could not reach the server.", 0));
    request_.onabort = () =>
      reject(new ApiError("aborted", "The upload was cancelled.", 0));

    request_.send(form);
  });
}

/** The stored ciphertext, for the hook to decrypt. */
export async function downloadFile(session, fileId) {
  const response = await fetch(`${BASE}/session/${session.sessionId}/files/${fileId}`, {
    headers: authHeaders(session),
  });
  if (!response.ok) {
    throw new ApiError("no_file", "That file is no longer in the session.", response.status);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function deleteFile(session, fileId) {
  await request(`/session/${session.sessionId}/files/${fileId}`, {
    method: "DELETE",
    session,
  });
}

/** Hands the browser a blob to save under the name the uploader gave it. */
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name || "download";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick: revoking synchronously races the click in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
