/**
 * The uploadthat API client.
 *
 * Kept free of React so the awkward parts — the metadata encoding, the error
 * shape, the conditional manifest fetch — can be tested directly.
 *
 * One contract detail matters more than it looks: `meta` is a base64 string the
 * server stores and returns without ever decoding. Phase 1 puts JSON in it.
 * Phase 2 puts ciphertext in it, and nothing on the server changes.
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

/** Base64 that survives non-ASCII filenames, which `btoa` alone does not. */
export function encodeMeta(meta) {
  const bytes = new TextEncoder().encode(JSON.stringify(meta));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function decodeMeta(encoded) {
  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    // A file whose description will not decode is still a file; showing it as
    // unnamed beats blanking the whole list.
    return { name: "Unreadable file", type: "" };
  }
}

const authHeaders = (session) => ({ Authorization: `Bearer ${session.token}` });

async function request(path, { method = "GET", body, session, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(session ? authHeaders(session) : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
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

export async function createSession({ operatorKey } = {}) {
  const { data } = await request("/session", {
    method: "POST",
    body: operatorKey ? { operatorKey } : {},
  });
  return data;
}

export async function joinSession(code) {
  const { data } = await request(`/join/${code}`, { method: "POST" });
  return data;
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
  return {
    etag: response.headers.get("ETag"),
    ...data,
    files: (data.files || []).map((file) => ({
      ...file,
      ...decodeMeta(file.meta),
    })),
  };
}

/**
 * Uploads one file. XHR rather than fetch because fetch still cannot report
 * upload progress, and a progress bar is most of what makes a slow phone
 * upload bearable.
 */
export function uploadFile(session, file, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("meta", encodeMeta({ name: file.name, type: file.type || "" }));
    form.append("file", file, "blob");

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

export async function downloadFile(session, fileId) {
  const response = await fetch(`${BASE}/session/${session.sessionId}/files/${fileId}`, {
    headers: authHeaders(session),
  });
  if (!response.ok) {
    throw new ApiError("no_file", "That file is no longer in the session.", response.status);
  }
  return response.blob();
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
