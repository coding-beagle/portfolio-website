import { useContext, useEffect, useRef } from "react";
import { useTheme } from "../../../../../themes/ThemeProvider";
import { MobileContext } from "../../../../../contexts/MobileContext";
import { noSelect } from "./styles";

export function ChangerButton({
  rerenderSetter,
  title,
  buttonText,
  callback,
  enabled = true,
}) {
  const { theme } = useTheme();
  const mobile = useContext(MobileContext);
  const btnRef = useRef();
  const timeouts = useRef([]);
  const isPressed = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      timeouts.current.forEach((t) => clearTimeout(t));
      timeouts.current = [];
    };
  }, []);

  // Helper to reset scale and clear timeouts
  const resetButton = () => {
    if (btnRef.current) {
      btnRef.current.style.transition =
        "transform 0.12s cubic-bezier(.4,2,.6,1)";
      btnRef.current.style.transform = "scale(1)";
    }
    timeouts.current.forEach((t) => clearTimeout(t));
    timeouts.current = [];
    isPressed.current = false;
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: mobile ? "0.6em" : 0,
        width: mobile ? "100%" : undefined,
        marginBottom: "0.3em",
      }}
    >
      {title && (
        <span
          style={{
            minWidth: mobile ? 0 : 120,
            flex: mobile ? "0 0 38%" : undefined,
            marginRight: mobile ? 0 : 6,
            fontSize: mobile ? 15 : undefined,
            ...noSelect,
          }}
        >
          {title}
        </span>
      )}
      <button
        ref={btnRef}
        onClick={(e) => {
          rerenderSetter((prev) => prev + 1);
          callback();
          if (!btnRef.current) return;
          isPressed.current = true;
          btnRef.current.style.transition =
            "transform 0.08s cubic-bezier(.4,2,.6,1)";
          btnRef.current.style.transform = "scale(0.93)";
          // Animate up only if still pressed
          const t1 = setTimeout(() => {
            if (!btnRef.current || !isPressed.current) return;
            btnRef.current.style.transition =
              "transform 0.18s cubic-bezier(.4,2,.6,1)";
            btnRef.current.style.transform = "scale(1.07)";
            const t2 = setTimeout(() => {
              if (!btnRef.current || !isPressed.current) return;
              btnRef.current.style.transition =
                "transform 0.12s cubic-bezier(.4,2,.6,1)";
              btnRef.current.style.transform = "scale(1)";
              isPressed.current = false;
            }, 120);
            timeouts.current.push(t2);
          }, 80);
          timeouts.current.push(t1);
        }}
        onMouseUp={resetButton}
        onMouseLeave={resetButton}
        onTouchEnd={resetButton}
        onTouchCancel={resetButton}
        style={{
          flex: mobile ? 1 : undefined,
          minHeight: mobile ? 44 : undefined,
          padding: mobile ? "0.6em 1em" : "0.35em 1.1em",
          fontSize: mobile ? 16 : 15,
          borderRadius: mobile ? 10 : 6,
          border: `0px solid ${theme.accent}`,
          background: enabled
            ? `linear-gradient(45deg, ${theme.secondary} 0%, ${theme.secondaryAccent} 100%)`
            : `linear-gradient(45deg, #bbb 0%, #eee 100%)`,
          color: enabled ? theme.text : "#888",
          fontWeight: 500,
          cursor: "pointer",
          transition:
            "background 0.15s, border 0.15s, color 0.15s, transform 0.12s cubic-bezier(.4,2,.6,1)",
          boxShadow: `0 1px 6px ${theme.secondaryAccent}22`,
          fontFamily: theme.font,
          opacity: enabled ? 1 : 0.6,
          touchAction: "manipulation",
          ...noSelect,
        }}
        onMouseOver={(e) => {
          if (mobile || !btnRef.current) return;
          btnRef.current.style.transform = "scale(1.07)";
          btnRef.current.style.background = enabled
            ? `linear-gradient(45deg, ${theme.secondaryAccent} 0%, ${theme.secondary} 100%)`
            : `linear-gradient(45deg, #bbb 0%, #eee 100%)`;
        }}
        onMouseOut={(e) => {
          if (mobile || !btnRef.current) return;
          btnRef.current.style.transform = "scale(1)";
          btnRef.current.style.background = enabled
            ? `linear-gradient(90deg, ${theme.secondary} 0%, ${theme.secondaryAccent} 100%)`
            : `linear-gradient(90deg, #bbb 0%, #eee 100%)`;
        }}
      >
        {buttonText}
      </button>
    </div>
  );
}

export default ChangerButton;
