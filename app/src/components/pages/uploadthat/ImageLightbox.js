import React, { useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { useTheme } from "../../../themes/ThemeProvider";
import { noSelect } from "../title/utilities/valueChangerElements/styles";

/**
 * A file's image, filling the screen.
 *
 * The bytes are already downloaded by the time a thumbnail exists, so opening
 * one costs nothing more than rendering the same object URL larger.
 *
 * Closing works the three ways people expect — the button, the backdrop and
 * Escape — and focus goes to the close button on open and back where it came
 * from on close, so the keyboard is not left stranded behind the overlay.
 */
export default function ImageLightbox({ url, name, onClose }) {
  const { theme } = useTheme();
  const closeButton = useRef(null);
  const returnFocusTo = useRef(null);

  useEffect(() => {
    returnFocusTo.current = document.activeElement;
    closeButton.current?.focus();

    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (returnFocusTo.current instanceof HTMLElement) {
        returnFocusTo.current.focus();
      }
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1em",
        padding: "2em 1em",
        boxSizing: "border-box",
        background: `${theme.primary}F2`,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      <style>{`
        @keyframes utLightboxIn { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: none; } }
        .utLightboxImage { animation: utLightboxIn 0.18s ease-out; }
        @media (prefers-reduced-motion: reduce) { .utLightboxImage { animation: none; } }
      `}</style>

      <button
        ref={closeButton}
        className="utControl"
        onClick={onClose}
        aria-label="Close preview"
        title="Close preview"
        style={{
          ...noSelect,
          position: "absolute",
          top: "1em",
          right: "1em",
          width: "2.6em",
          height: "2.6em",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          fontSize: "1.1rem",
          color: theme.accent,
          background: `${theme.accent}1A`,
          border: `1px solid ${theme.accent}33`,
        }}
      >
        <FontAwesomeIcon icon={faXmark} />
      </button>

      <img
        className="utLightboxImage"
        src={url}
        alt={name}
        // The image itself is not a way out, so a click on it does not close.
        onClick={(event) => event.stopPropagation()}
        style={{
          maxWidth: "100%",
          maxHeight: "calc(100% - 3em)",
          objectFit: "contain",
          borderRadius: 4,
        }}
      />
      <p
        style={{
          ...noSelect,
          margin: 0,
          fontSize: "0.82rem",
          opacity: 0.7,
          textAlign: "center",
          wordBreak: "break-all",
        }}
      >
        {name}
      </p>
    </div>
  );
}
