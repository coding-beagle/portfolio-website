import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  closeSession,
  createSession,
  deleteFile,
  fetchManifest,
  heartbeat,
  joinSession,
  uploadFile,
} from "./api";

const POLL_VISIBLE = 2000;
const POLL_HIDDEN = 30000;
const HEARTBEAT = 30000;

/**
 * Everything stateful about a bridge session: opening or joining one, the poll
 * that keeps two devices in step, the heartbeat that holds the clock open, and
 * the uploads in flight.
 *
 * The session is deliberately not persisted anywhere. In phase 2 the encryption
 * key lives only in memory, so a reload will end the session then; behaving the
 * same way now means the behaviour does not change under people later.
 */
export default function useBridge() {
  const [session, setSession] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [transfers, setTransfers] = useState([]);

  const etag = useRef(null);
  const sessionRef = useRef(null);
  sessionRef.current = session;

  const reset = useCallback(() => {
    etag.current = null;
    sessionRef.current = null;
    setSession(null);
    setManifest(null);
    setTransfers([]);
  }, []);

  const open = useCallback(async (operatorKey) => {
    setBusy(true);
    setError(null);
    try {
      setSession(await createSession({ operatorKey: operatorKey || undefined }));
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }, []);

  const join = useCallback(async (code) => {
    setBusy(true);
    setError(null);
    try {
      setSession(await joinSession(code));
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }, []);

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

  // --- the poll ---------------------------------------------------------
  useEffect(() => {
    if (!session) return undefined;

    let timer = null;
    let stopped = false;

    const tick = async () => {
      try {
        const next = await fetchManifest(session, etag.current);
        if (stopped) return;
        if (next) {
          etag.current = next.etag;
          setManifest(next);
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

  // --- the heartbeat, owner only ---------------------------------------
  useEffect(() => {
    if (!session || session.role !== "owner") return undefined;
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

  const send = useCallback(
    async (files) => {
      const current = sessionRef.current;
      if (!current) return;

      for (const file of Array.from(files)) {
        const id = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`;
        setTransfers((previous) => [
          ...previous,
          { id, name: file.name, size: file.size, progress: 0 },
        ]);
        try {
          await uploadFile(current, file, {
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
    },
    []
  );

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
    open,
    join,
    leave,
    send,
    remove,
    dismissError: () => setError(null),
  };
}
