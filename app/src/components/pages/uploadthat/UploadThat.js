import React, { useContext, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faDownload,
  faPowerOff,
  faTrashCan,
} from "@fortawesome/free-solid-svg-icons";
import { useTheme } from "../../../themes/ThemeProvider";
import { MobileContext } from "../../../contexts/MobileContext";
import { noSelect } from "../title/utilities/valueChangerElements/styles";
import { homeHref } from "../../../subdomains";
import { downloadFile, saveBlob } from "./api";
import useBridge from "./useBridge";
import QrCode from "./QrCode";
import DropZone from "./DropZone";

/** The code in the address bar, if someone arrived from a QR scan. */
export function codeFromHash(hash) {
  const match = /^#\/j\/(\d{6})$/.exec(hash || "");
  return match ? match[1] : null;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatCountdown(seconds) {
  if (seconds <= 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Seconds left on the session, ticking. */
function useCountdown(expiresAt) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return expiresAt ? Math.max(0, expiresAt - now) : null;
}

export default function UploadThat() {
  const { theme } = useTheme();
  const mobile = useContext(MobileContext);
  const bridge = useBridge();
  const { session, manifest, error, busy, transfers } = bridge;

  const [code, setCode] = useState("");
  const [operatorKey, setOperatorKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  // Arriving from a QR scan lands on #/j/<code>; fill it in and join.
  useEffect(() => {
    const scanned = codeFromHash(window.location.hash);
    if (scanned) {
      setCode(scanned);
      bridge.join(scanned);
      window.history.replaceState(null, "", window.location.pathname);
    }
    // Only on mount: a later hash change is the user navigating, not a scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remaining = useCountdown(manifest?.expiresAt ?? session?.expiresAt);
  const joinUrl = useMemo(
    () => (session ? `${window.location.origin}/#/j/${session.code}` : ""),
    [session]
  );

  const label = {
    ...noSelect,
    fontSize: "0.7rem",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    opacity: 0.55,
  };

  const button = (extra = {}) => ({
    ...noSelect,
    padding: "0.65em 1.2em",
    fontFamily: "inherit",
    fontSize: "0.95rem",
    borderRadius: 6,
    cursor: "pointer",
    border: `1px solid ${theme.secondary}`,
    background: `${theme.secondary}1F`,
    color: theme.accent,
    transition: "background 0.2s ease",
    ...extra,
  });

  return (
    <div
      style={{
        minHeight: "100%",
        boxSizing: "border-box",
        padding: mobile ? "1.5em 1em 4em" : "3em 2em 5em",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <style>{`
        .utControl:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
        .utHome:hover { opacity: 1; color: ${theme.secondary}; }
      `}</style>

      <header style={{ marginBottom: "1.8em" }}>
        <a
          className="utHome utControl"
          href={homeHref()}
          style={{
            ...noSelect,
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5em",
            marginBottom: "0.9em",
            fontSize: "0.8rem",
            color: theme.accent,
            opacity: 0.65,
            textDecoration: "none",
          }}
        >
          <FontAwesomeIcon icon={faArrowLeft} />
          nteague.com
        </a>
        <h1
          style={{
            margin: 0,
            fontSize: mobile ? "1.6rem" : "2rem",
            fontWeight: 400,
            letterSpacing: "0.04em",
          }}
        >
          uploadthat
        </h1>
        <p style={{ margin: "0.4em 0 0", opacity: 0.6, fontSize: "0.9rem" }}>
          Open a session here, join it from another device, and drag files across.
          Everything is deleted when the session ends.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          style={{
            color: theme.tertiaryAccent,
            fontSize: "0.9rem",
            border: `1px solid ${theme.tertiaryAccent}66`,
            borderRadius: 6,
            padding: "0.7em 0.9em",
            margin: "0 0 1.4em",
          }}
        >
          {error.message}
        </p>
      )}

      {!session && (
        <>
          <section style={{ marginBottom: "2.4em" }}>
            <h2 style={{ ...label, margin: "0 0 0.8em" }}>Start a session</h2>
            <button
              className="utControl"
              onClick={() => bridge.open(operatorKey)}
              disabled={busy}
              style={button({ opacity: busy ? 0.6 : 1 })}
            >
              {busy ? "Opening…" : "Start a session"}
            </button>
            <div style={{ marginTop: "0.9em" }}>
              {showKey ? (
                <input
                  value={operatorKey}
                  onChange={(event) => setOperatorKey(event.target.value)}
                  type="password"
                  placeholder="operator key"
                  aria-label="Operator key"
                  style={{
                    width: "100%",
                    maxWidth: 280,
                    boxSizing: "border-box",
                    padding: "0.55em 0.7em",
                    fontFamily: "monospace",
                    fontSize: "0.9rem",
                    color: theme.accent,
                    background: `${theme.accent}0D`,
                    border: `1px solid ${theme.accent}33`,
                    borderRadius: 6,
                    outline: "none",
                  }}
                />
              ) : (
                <button
                  className="utControl"
                  onClick={() => setShowKey(true)}
                  style={{
                    ...noSelect,
                    background: "none",
                    border: "none",
                    padding: 0,
                    fontSize: "0.78rem",
                    color: theme.accent,
                    opacity: 0.6,
                    textDecoration: "underline dotted",
                    textUnderlineOffset: "0.3em",
                    cursor: "pointer",
                  }}
                >
                  I have a key
                </button>
              )}
            </div>
          </section>

          <section>
            <h2 style={{ ...label, margin: "0 0 0.8em" }}>Or join one</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (/^\d{6}$/.test(code)) bridge.join(code);
              }}
              style={{ display: "flex", flexWrap: "wrap", gap: "0.6em" }}
            >
              <input
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                aria-label="Six-digit join code"
                style={{
                  width: "6.5em",
                  padding: "0.55em 0.7em",
                  fontFamily: "monospace",
                  fontSize: "1.3rem",
                  letterSpacing: "0.2em",
                  textAlign: "center",
                  color: theme.accent,
                  background: `${theme.accent}0D`,
                  border: `1px solid ${theme.accent}33`,
                  borderRadius: 6,
                  outline: "none",
                }}
              />
              <button
                className="utControl"
                type="submit"
                disabled={busy || !/^\d{6}$/.test(code)}
                style={button({ opacity: busy || !/^\d{6}$/.test(code) ? 0.5 : 1 })}
              >
                Join
              </button>
            </form>
          </section>
        </>
      )}

      {session && (
        <>
          <section
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: mobile ? "1.4em" : "2em",
              alignItems: "center",
              padding: "1.2em",
              border: `1px solid ${theme.accent}26`,
              borderRadius: 8,
              marginBottom: "1.6em",
            }}
          >
            <div style={{ flex: "1 1 200px" }}>
              <p style={{ ...label, margin: "0 0 0.3em" }}>Join code</p>
              <p
                style={{
                  margin: 0,
                  fontFamily: "monospace",
                  fontSize: mobile ? "2rem" : "2.6rem",
                  letterSpacing: "0.12em",
                  color: theme.secondary,
                }}
              >
                {session.code}
              </p>
              <p style={{ margin: "0.6em 0 0", fontSize: "0.82rem", opacity: 0.6 }}>
                {remaining !== null && (
                  <>
                    Ends in{" "}
                    <span
                      style={{
                        fontFamily: "monospace",
                        color: remaining < 60 ? theme.tertiaryAccent : "inherit",
                      }}
                    >
                      {formatCountdown(remaining)}
                    </span>
                    {session.role === "owner" && " · kept alive while this tab is open"}
                  </>
                )}
              </p>
            </div>
            <QrCode value={joinUrl} dark={theme.accent} light={theme.primary} size={mobile ? 132 : 156} />
          </section>

          <DropZone onFiles={bridge.send} />

          {transfers.map((transfer) => (
            <div key={transfer.id} style={{ marginTop: "0.8em" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem" }}>
                <span>{transfer.name}</span>
                <span style={{ fontFamily: "monospace", opacity: 0.7 }}>
                  {Math.round(transfer.progress * 100)}%
                </span>
              </div>
              <div
                style={{
                  height: 4,
                  marginTop: 5,
                  borderRadius: 2,
                  background: `${theme.accent}1F`,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${transfer.progress * 100}%`,
                    height: "100%",
                    background: theme.secondary,
                    transition: "width 0.2s ease",
                  }}
                />
              </div>
            </div>
          ))}

          <section style={{ marginTop: "2em" }}>
            <h2 style={{ ...label, margin: "0 0 0.6em" }}>
              Files{manifest ? ` · ${manifest.files.length}` : ""}
            </h2>
            {manifest && manifest.files.length === 0 && (
              <p style={{ opacity: 0.5, fontSize: "0.9rem", margin: 0 }}>
                Nothing here yet. Drop something in, on either device.
              </p>
            )}
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {(manifest?.files ?? []).map((file) => (
                <li
                  key={file.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.8em",
                    padding: "0.7em 0",
                    borderBottom: `1px solid ${theme.accent}14`,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {file.name}
                    </span>
                    <span style={{ fontSize: "0.75rem", opacity: 0.55 }}>
                      {formatBytes(file.size)} · from {file.uploadedBy}
                    </span>
                  </span>
                  <button
                    className="utControl"
                    aria-label={`Download ${file.name}`}
                    title="Download"
                    onClick={async () => {
                      const blob = await downloadFile(session, file.id);
                      saveBlob(blob, file.name);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: theme.accent,
                      fontSize: "1rem",
                      padding: "0.3em",
                    }}
                  >
                    <FontAwesomeIcon icon={faDownload} />
                  </button>
                  <button
                    className="utControl"
                    aria-label={`Remove ${file.name}`}
                    title="Remove"
                    onClick={() => bridge.remove(file.id)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: `${theme.accent}99`,
                      fontSize: "0.95rem",
                      padding: "0.3em",
                    }}
                  >
                    <FontAwesomeIcon icon={faTrashCan} />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <button
            className="utControl"
            onClick={bridge.leave}
            style={button({
              marginTop: "2em",
              border: `1px solid ${theme.tertiaryAccent}`,
              background: `${theme.tertiaryAccent}1A`,
              display: "inline-flex",
              alignItems: "center",
              gap: "0.6em",
            })}
          >
            <FontAwesomeIcon icon={faPowerOff} />
            {session.role === "owner" ? "End session and delete files" : "Leave session"}
          </button>
        </>
      )}
    </div>
  );
}
