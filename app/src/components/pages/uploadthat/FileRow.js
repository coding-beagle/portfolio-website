import React, { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faDownload,
  faFile,
  faImage,
  faSpinner,
  faTrashCan,
} from "@fortawesome/free-solid-svg-icons";
import { useTheme } from "../../../themes/ThemeProvider";
import { saveBlob } from "./api";
import { canPreview, isImage, loadPreview } from "./preview";
import ImageLightbox from "./ImageLightbox";

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

/**
 * The thumbnail, or the icon that stands in for one — and, for a picture, the
 * way into a full-size look at it.
 *
 * Small images load their thumbnail on their own; a large one waits to be asked,
 * so nothing downloads megabytes over mobile data that nobody wanted to see.
 * Either way the bytes are fetched once and reused for both sizes.
 */
function Thumbnail({ session, file, getFile }) {
  const { theme } = useTheme();
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const previewable = canPreview(file);
  const picture = isImage(file);

  useEffect(() => {
    if (!previewable) return undefined;
    let live = true;
    loadPreview(session, file, getFile).then((next) => {
      if (live) setUrl(next);
    });
    return () => {
      live = false;
    };
    // The bytes behind an id never change, so the id is the whole dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionId, file.id, previewable]);

  const expand = async () => {
    if (url) {
      setOpen(true);
      return;
    }
    setLoading(true);
    const next = await loadPreview(session, file, getFile);
    setLoading(false);
    if (next) {
      setUrl(next);
      setOpen(true);
    }
  };

  const box = {
    width: 44,
    height: 44,
    flex: "0 0 44px",
    padding: 0,
    borderRadius: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    background: `${theme.accent}14`,
    color: `${theme.accent}80`,
    border: "none",
  };

  const inside = url ? (
    <img
      src={url}
      alt=""
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  ) : (
    <FontAwesomeIcon
      icon={loading ? faSpinner : picture ? faImage : faFile}
      spin={loading}
    />
  );

  if (!picture) {
    return <span style={box}>{inside}</span>;
  }

  return (
    <>
      <button
        className="utControl"
        onClick={expand}
        aria-label={`Preview ${file.name}`}
        title="Preview"
        style={{ ...box, cursor: "zoom-in" }}
      >
        {inside}
      </button>
      {open && url && (
        <ImageLightbox url={url} name={file.name} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/** One file in the session: what it is, and the two things you can do to it. */
export default function FileRow({ session, file, getFile, onRemove }) {
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
      <Thumbnail session={session} file={file} getFile={getFile} />
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
            saveBlob(await getFile(file), file.name);
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
