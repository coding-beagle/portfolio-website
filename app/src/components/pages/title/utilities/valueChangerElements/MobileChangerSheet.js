import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../../../../../themes/ThemeProvider";
import { ChangerList } from "./registry";
import { noSelect } from "./styles";

// Above every other fixed overlay on the page (theme toggle, UI toggle, title).
const SHEET_Z_INDEX = 20000;

/**
 * Mobile presentation: a bottom sheet that can be dragged/swiped away, with
 * full-width rows and touch-sized controls.
 *
 * The sheet is portalled to `document.body` so that no transformed ancestor in
 * the scene tree can trap it in a stacking context underneath the theme
 * changer or the other page-level buttons.
 */
export function MobileChangerSheet({ rerenderSetter, valueArrays }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef(null);

  // Don't let the page behind the sheet scroll while it is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setDragOffset(0);
  };

  const onTouchStart = (e) => {
    dragStart.current = e.touches[0].clientY;
    setDragging(true);
  };

  const onTouchMove = (e) => {
    if (dragStart.current === null) return;
    const delta = e.touches[0].clientY - dragStart.current;
    setDragOffset(Math.max(0, delta));
  };

  const onTouchEnd = () => {
    if (dragStart.current === null) return;
    dragStart.current = null;
    setDragging(false);
    // A long enough drag dismisses; anything shorter snaps back.
    if (dragOffset > 90) close();
    else setDragOffset(0);
  };

  const sheet = (
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          zIndex: SHEET_Z_INDEX,
          opacity: open ? Math.max(0, 1 - dragOffset / 300) : 0,
          pointerEvents: open ? "auto" : "none",
          transition: dragging ? "none" : "opacity 0.25s ease",
        }}
        onClick={close}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Simulation options"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: SHEET_Z_INDEX + 1,
          background: theme.primary,
          color: theme.accent,
          fontFamily: theme.font,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          boxShadow: "0 -4px 24px rgba(0,0,0,0.25)",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          transform: open ? `translateY(${dragOffset}px)` : "translateY(110%)",
          transition: dragging
            ? "none"
            : "transform 0.28s cubic-bezier(.32,.72,0,1)",
          touchAction: "pan-y",
        }}
      >
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
          style={{
            padding: "0.6em 1em 0.5em 1em",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.5em",
            flexDirection: "column",
            cursor: "grab",
            ...noSelect,
          }}
        >
          <div
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              background: theme.accent,
              opacity: 0.35,
            }}
          />
          <div
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: "1.05em" }}>
              Simulation Options
            </span>
            <button
              onClick={close}
              aria-label="Close simulation options"
              style={{
                width: 40,
                height: 40,
                fontSize: "1.4em",
                lineHeight: 1,
                background: "none",
                border: "none",
                color: theme.accent,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
        </div>

        <div
          style={{
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
            padding: "0 1em calc(1em + env(safe-area-inset-bottom)) 1em",
            display: "flex",
            flexDirection: "column",
            gap: "0.35em",
          }}
        >
          <ChangerList
            valueArrays={valueArrays}
            rerenderSetter={rerenderSetter}
          />
        </div>
      </div>
    </>
  );

  return (
    <>
      <button
        id="changerGroup"
        style={{
          position: "fixed",
          // 1em from the corner, like the theme / show-HUD buttons. The popover
          // icon row uses the same inset and is padded to this button's 44px
          // height, so the two top rows line up.
          top: "calc(1em + env(safe-area-inset-top, 0px))",
          left: "1em",
          margin: 0,
          fontSize: 16,
          minHeight: 44,
          padding: "0 1em",
          display: "flex",
          alignItems: "center",
          gap: "0.45em",
          borderRadius: 22,
          border: "none",
          background: theme.accent,
          color: theme.primary,
          fontFamily: theme.font,
          fontWeight: "bold",
          cursor: "pointer",
          zIndex: 11001, // ensure above title
          boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
          opacity: open ? 0 : 1,
          pointerEvents: open ? "none" : "auto",
          transition: "opacity 0.2s ease",
          ...noSelect,
        }}
        onClick={() => setOpen(true)}
        aria-label="Show simulation options"
      >
        <span aria-hidden="true">⚙</span>
        Options
      </button>
      {createPortal(sheet, document.body)}
    </>
  );
}

export default MobileChangerSheet;
