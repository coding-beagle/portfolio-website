import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  approveJoin,
  closeSession,
  createSession,
  deleteFile,
  downloadFile,
  fetchHandshake,
  fetchManifest,
  heartbeat,
  joinSession,
  rejectJoin,
  saveNote,
  uploadFile,
} from "./api";
import {
  completeHandshake,
  decryptJson,
  decryptText,
  decrypt,
  encrypt,
  encryptJson,
  encryptText,
  exportPublicKey,
  generateKeyPair,
  generateSessionKey,
  handshakeTranscript,
  unwrapSessionKey,
  wrapSessionKey,
} from "./crypto";

const POLL_VISIBLE = 2000;
const POLL_HIDDEN = 30000;
const HEARTBEAT = 30000;
// Long enough that ordinary typing is one request rather than thirty, short
// enough that the other device does not feel like it is lagging.
export const NOTE_DEBOUNCE = 900;

/**
 * Everything stateful about a bridge session, and the only place the session
 * key exists.
 *
 * Files, their names and the shared note are encrypted here on the way out and
 * decrypted here on the way in; nothing below this — not the API layer, not the
 * server — ever sees plaintext. The key itself is generated in the browser and
 * never sent: a joining device gets it wrapped to a secret the two devices
 * derive between them, which is what `completeHandshake` is for.
 *
 * The session is deliberately not persisted anywhere. The key lives in memory
 * only, so a reload ends the session — storing it would put it on disk, which
 * is the one thing this design is trying to avoid.
 */
export default function useBridge() {
  const [session, setSession] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [transfers, setTransfers] = useState([]);
  // What the two devices have to agree on before either can read anything.
  const [handshake, setHandshake] = useState(null);
  const [note, setNote] = useState("");

  const etag = useRef(null);
  const sessionRef = useRef(null);
  const keyRef = useRef(null);
  const keyPairRef = useRef(null);
  const publicKeyRef = useRef(null);
  const noteSentRef = useRef("");
  const noteDirtyRef = useRef(false);
  // Joins already answered. The manifest that still lists one is up to two
  // seconds stale, and without this the gate reappears the moment it is
  // dismissed — cleared and then immediately rebuilt from the old poll.
  const handledJoins = useRef(new Set());
  sessionRef.current = session;

  const reset = useCallback(() => {
    etag.current = null;
    sessionRef.current = null;
    keyRef.current = null;
    keyPairRef.current = null;
    publicKeyRef.current = null;
    noteSentRef.current = "";
    noteDirtyRef.current = false;
    handledJoins.current = new Set();
    setSession(null);
    setManifest(null);
    setHandshake(null);
    setNote("");
  }, []);

  /** A fresh keypair for this device, whichever end of the session it is. */
  const freshKeyPair = useCallback(async () => {
    const pair = await generateKeyPair();
    keyPairRef.current = pair;
    publicKeyRef.current = await exportPublicKey(pair);
    return publicKeyRef.current;
  }, []);

  const open = useCallback(
    async (operatorKey) => {
      setBusy(true);
      setError(null);
      try {
        const publicKey = await freshKeyPair();
        const opened = await createSession({
          operatorKey: operatorKey || undefined,
          publicKey,
        });
        keyRef.current = await generateSessionKey();
        setSession(opened);
      } catch (failure) {
        setError(failure);
      } finally {
        setBusy(false);
      }
    },
    [freshKeyPair]
  );

  const join = useCallback(
    async (code) => {
      setBusy(true);
      setError(null);
      try {
        const publicKey = await freshKeyPair();
        const joined = await joinSession(code, publicKey);
        // Both sides work out the same four digits from the same transcript.
        // If anything altered the keys in transit, they will not match.
        const agreed = await completeHandshake({
          privateKey: keyPairRef.current.privateKey,
          peerPublic: joined.ownerPublicKey,
          transcript: handshakeTranscript(
            joined.sessionId,
            joined.ownerPublicKey,
            publicKey
          ),
        });
        setHandshake({ role: "guest", sas: agreed.sas, wrappingKey: agreed.wrappingKey });
        setSession(joined);
      } catch (failure) {
        setError(failure);
      } finally {
        setBusy(false);
      }
    },
    [freshKeyPair]
  );

  const leave = useCallback(async () => {
    const current = sessionRef.current;
    reset();
    if (current && current.role === "owner") {
      try {
        await closeSession(current);
      } catch (failure) {
        // The session expires on its own within the window; a failed close is
        // not worth showing anyone an error over.
      }
    }
  }, [reset]);

  // --- waiting to be let in --------------------------------------------
  useEffect(() => {
    if (!session || session.status !== "pending") return undefined;

    let stopped = false;
    let timer = null;

    const tick = async () => {
      try {
        const state = await fetchHandshake(session);
        if (stopped) return;
        if (state.status === "active" && state.wrappedKey) {
          keyRef.current = await unwrapSessionKey(
            handshake.wrappingKey,
            state.wrappedKey
          );
          setHandshake(null);
          setSession((previous) => ({ ...previous, status: "active" }));
          return;
        }
      } catch (failure) {
        if (stopped) return;
        if (failure instanceof ApiError && failure.status === 401) {
          reset();
          setError(failure);
          return;
        }
      }
      if (!stopped) timer = setTimeout(tick, POLL_VISIBLE);
    };

    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [session, handshake, reset]);

  // --- the poll ---------------------------------------------------------
  useEffect(() => {
    if (!session || session.status === "pending") return undefined;

    let timer = null;
    let stopped = false;

    const tick = async () => {
      try {
        const next = await fetchManifest(session, etag.current);
        if (stopped) return;
        if (next) {
          etag.current = next.etag;
          // Names are ciphertext on the wire; they become names here.
          const files = await Promise.all(
            (next.files || []).map(async (file) => {
              try {
                return { ...file, ...(await decryptJson(keyRef.current, file.meta)) };
              } catch (failure) {
                // One unreadable description is still a file; blanking the
                // whole list over it would be worse.
                return { ...file, name: "Unreadable file", type: "" };
              }
            })
          );
          if (stopped) return;
          setManifest({ ...next, files });

          // Do not overwrite what is being typed right now.
          if (!noteDirtyRef.current && next.note !== noteSentRef.current) {
            noteSentRef.current = next.note;
            setNote(next.note ? await decryptText(keyRef.current, next.note) : "");
          }
        }
        setError((previous) =>
          previous && previous.code === "offline" ? null : previous
        );
      } catch (failure) {
        if (stopped) return;
        if (failure instanceof ApiError && failure.status === 401) {
          // The session ended underneath us — expired, or closed by the owner.
          reset();
          setError(failure);
          return;
        }
        setError(failure);
      }
      if (!stopped) {
        timer = setTimeout(
          tick,
          document.visibilityState === "hidden" ? POLL_HIDDEN : POLL_VISIBLE
        );
      }
    };

    tick();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !stopped) {
        clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session, reset]);

  // --- the owner deciding who gets in ----------------------------------
  const pending =
    (manifest?.joins ?? []).find((join) => !handledJoins.current.has(join.id)) ?? null;
  useEffect(() => {
    if (!pending || !session || session.role !== "owner") return;
    if (handshake?.join?.id === pending.id) return;

    let stale = false;
    completeHandshake({
      privateKey: keyPairRef.current.privateKey,
      peerPublic: pending.publicKey,
      transcript: handshakeTranscript(
        session.sessionId,
        publicKeyRef.current,
        pending.publicKey
      ),
    }).then((agreed) => {
      if (!stale) {
        setHandshake({
          role: "owner",
          sas: agreed.sas,
          wrappingKey: agreed.wrappingKey,
          join: pending,
        });
      }
    });
    return () => {
      stale = true;
    };
  }, [pending, session, handshake]);

  const admit = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || !handshake?.join) return;
    handledJoins.current.add(handshake.join.id);
    try {
      const wrapped = await wrapSessionKey(handshake.wrappingKey, keyRef.current);
      await approveJoin(current, handshake.join.id, wrapped);
      setHandshake(null);
      etag.current = null;
    } catch (failure) {
      setError(failure);
    }
  }, [handshake]);

  const turnAway = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || !handshake?.join) return;
    handledJoins.current.add(handshake.join.id);
    try {
      await rejectJoin(current, handshake.join.id);
      setHandshake(null);
      etag.current = null;
    } catch (failure) {
      setError(failure);
    }
  }, [handshake]);

  // --- the heartbeat, owner only ---------------------------------------
  useEffect(() => {
    if (!session || session.role !== "owner" || session.status === "pending") {
      return undefined;
    }
    const timer = setInterval(() => {
      heartbeat(session).catch(() => {});
    }, HEARTBEAT);
    return () => clearInterval(timer);
  }, [session]);

  // --- a best-effort close when the tab goes away ----------------------
  useEffect(() => {
    if (!session || session.role !== "owner") return undefined;
    const onPageHide = () => {
      // sendBeacon survives the page going away where fetch does not. It is a
      // courtesy, not the mechanism: expiry is what actually ends a session.
      const url = `/api/session/${session.sessionId}/close`;
      const payload = new Blob([JSON.stringify({ token: session.token })], {
        type: "application/json",
      });
      if (navigator.sendBeacon) navigator.sendBeacon(url, payload);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [session]);

  // --- the shared note --------------------------------------------------
  const editNote = useCallback((text) => {
    noteDirtyRef.current = true;
    setNote(text);
  }, []);

  useEffect(() => {
    if (!session || session.status === "pending" || !noteDirtyRef.current) {
      return undefined;
    }
    // Debounced rather than sent per keystroke: typing a sentence should be
    // one request, not thirty.
    const timer = setTimeout(async () => {
      try {
        const sealed = note === "" ? "" : await encryptText(keyRef.current, note);
        noteSentRef.current = sealed;
        await saveNote(sessionRef.current, sealed);
        noteDirtyRef.current = false;
        etag.current = null;
      } catch (failure) {
        setError(failure);
      }
    }, NOTE_DEBOUNCE);
    return () => clearTimeout(timer);
  }, [note, session]);

  const send = useCallback(async (files) => {
    const current = sessionRef.current;
    if (!current || !keyRef.current) return;

    for (const file of Array.from(files)) {
      const id = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`;
      setTransfers((previous) => [
        ...previous,
        { id, name: file.name, size: file.size, progress: 0 },
      ]);
      try {
        const sealed = await encrypt(keyRef.current, new Uint8Array(await file.arrayBuffer()));
        const meta = await encryptJson(keyRef.current, {
          name: file.name,
          type: file.type || "",
        });
        await uploadFile(current, sealed, meta, {
          onProgress: (progress) =>
            setTransfers((previous) =>
              previous.map((transfer) =>
                transfer.id === id ? { ...transfer, progress } : transfer
              )
            ),
        });
        etag.current = null; // force the next poll to actually return the list
      } catch (failure) {
        setError(failure);
      } finally {
        setTransfers((previous) => previous.filter((transfer) => transfer.id !== id));
      }
    }
  }, []);

  /** A file's real bytes: fetched as ciphertext, handed back as a usable Blob. */
  const getFile = useCallback(async (file) => {
    const current = sessionRef.current;
    if (!current || !keyRef.current) throw new Error("No session");
    const sealed = await downloadFile(current, file.id);
    const plain = await decrypt(keyRef.current, sealed);
    return new Blob([plain], { type: file.type || "application/octet-stream" });
  }, []);

  const remove = useCallback(async (fileId) => {
    const current = sessionRef.current;
    if (!current) return;
    try {
      await deleteFile(current, fileId);
      etag.current = null;
    } catch (failure) {
      setError(failure);
    }
  }, []);

  return {
    session,
    manifest,
    error,
    busy,
    transfers,
    handshake,
    note,
    open,
    join,
    leave,
    send,
    getFile,
    remove,
    admit,
    turnAway,
    editNote,
    dismissError: () => setError(null),
  };
}
