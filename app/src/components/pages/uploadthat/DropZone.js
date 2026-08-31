import React, { useCallback, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowUpFromBracket } from "@fortawesome/free-solid-svg-icons";
import { useTheme } from "../../../themes/ThemeProvider";
import { noSelect } from "../title/utilities/valueChangerElements/styles";

/**
 * Drop files here, or click to pick them.
 *
 * `dragenter`/`dragleave` fire for every child element the pointer crosses, so
 * a plain boolean flickers as you move over the label inside. Counting the
 * enters and leaves instead is what keeps the highlight steady.
 */
export default function DropZone({ onFiles, disabled = false }) {
  const { theme } = useTheme();
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  const input = useRef(null);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      depth.current = 0;
      setActive(false);
      if (disabled) return;
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) onFiles(files);
    },
    [onFiles, disabled]
  );

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        depth.current += 1;
        if (!disabled) setActive(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setActive(false);
      }}
      onDrop={onDrop}
      onClick={() => !disabled && input.current?.click()}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Add files"
      aria-disabled={disabled}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!disabled) input.current?.click();
        }
      }}
      style={{
        ...noSelect,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.6em",
        padding: "2.2em 1em",
        borderRadius: 8,
        border: `2px dashed ${active ? theme.secondary : `${theme.accent}40`}`,
        background: active ? `${theme.secondary}14` : `${theme.accent}08`,
        color: active ? theme.secondary : theme.accent,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "border-color 0.2s ease, background 0.2s ease, color 0.2s ease",
      }}
    >
      <FontAwesomeIcon icon={faArrowUpFromBracket} style={{ fontSize: "1.5rem" }} />
      <span style={{ fontSize: "0.95rem" }}>
        {active ? "Drop to send" : "Drop files here, or click to choose"}
      </span>
      <input
        ref={input}
        type="file"
        multiple
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          if (event.target.files?.length) onFiles(event.target.files);
          event.target.value = "";
        }}
        style={{ display: "none" }}
      />
    </div>
  );
}
