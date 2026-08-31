import React, { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDownload, faFile, faImage, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { useTheme } from "../../../themes/ThemeProvider";
import { downloadFile, saveBlob } from "./api";
import { canPreview, loadPreview } from "./preview";

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

/** The thumbnail, or the icon that stands in for one. */
function Thumbnail({ session, file }) {
  const { theme } = useTheme();
  const [url, setUrl] = useState(null);
  const previewable = canPreview(file);
  const isImage = typeof file.type === "string" && file.type.startsWith("image/");

  useEffect(() => {
    if (!previewable) return undefined;
    let live = true;
    loadPreview(session, file).then((next) => {
      if (live) setUrl(next);
    });
    return () => {
      live = false;
    };
    // The bytes behind an id never change, so the id is the whole dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionId, file.id, previewable]);

  const box = {
    width: 44,
    height: 44,
    flex: "0 0 44px",
    borderRadius: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    background: `${theme.accent}14`,
    color: `${theme.accent}80`,
  };

  if (url) {
    return (
      <span style={box}>
        <img
          src={url}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </span>
    );
  }

  return (
    <span style={box}>
      <FontAwesomeIcon icon={isImage ? faImage : faFile} />
    </span>
  );
}

/** One file in the session: what it is, and the two things you can do to it. */
export default function FileRow({ session, file, onRemove }) {
  const { theme } = useTheme();
  const [busy, setBusy] = useState(false);

  const action = {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: "1rem",
    // A comfortable tap target, which a bare glyph is not.
    minWidth: 44,
    minHeight: 44,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };

  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.8em",
        padding: "0.6em 0",
        borderBottom: `1px solid ${theme.accent}14`,
      }}
    >
      <Thumbnail session={session} file={file} />
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
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            saveBlob(await downloadFile(session, file.id), file.name);
          } finally {
            setBusy(false);
          }
        }}
        style={{ ...action, color: theme.accent, opacity: busy ? 0.4 : 1 }}
      >
        <FontAwesomeIcon icon={faDownload} />
      </button>
      <button
        className="utControl"
        aria-label={`Remove ${file.name}`}
        title="Remove"
        onClick={() => onRemove(file.id)}
        style={{ ...action, color: `${theme.accent}99`, fontSize: "0.95rem" }}
      >
        <FontAwesomeIcon icon={faTrashCan} />
      </button>
    </li>
  );
}

export { formatBytes };
