import { useContext, useEffect, useId, useRef, useState } from "react";
import { useTheme } from "../../../../../themes/ThemeProvider";
import { MobileContext } from "../../../../../contexts/MobileContext";
import { noSelect } from "./styles";

export function Slider({
  rerenderSetter,
  title,
  valueRef,
  minValue,
  maxValue,
  callback = null,
  isState = false,
  valueSetter = null,
}) {
  const { theme } = useTheme();
  const mobile = useContext(MobileContext);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);

  // Each slider gets its own class so one instance's drag state can't restyle
  // every other slider on the page.
  const className = `modern-slider-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  // A drag that ends outside the input (or over another element) still has to
  // clear the highlight, so the release is listened for on the window.
  useEffect(() => {
    const endDrag = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
    };
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, []);

  const handleChange = (e) => {
    if (!isState) {
      valueRef.current = Number(e.target.value);
    } else {
      valueSetter(Number(e.target.value));
    }
    if (callback) {
      callback();
    }
    rerenderSetter((prev) => prev + 1);
  };

  const startDrag = () => {
    draggingRef.current = true;
    setDragging(true);
  };

  const value = isState ? valueRef : valueRef.current;
  // While dragging the thumb stays highlighted wherever the pointer goes.
  const active = hovered || dragging;
  const thumbSize = mobile ? 26 : 18;
  const trackHeight = mobile ? 8 : 6;
  const thumbOffset = -(thumbSize - trackHeight) / 2;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: mobile ? "0.6em" : 0,
        width: mobile ? "100%" : undefined,
        minHeight: mobile ? 44 : undefined,
        marginBottom: "0.5em",
        fontFamily: theme.font,
        color: theme.accent,
      }}
    >
      <span
        style={{
          minWidth: mobile ? 0 : 90,
          flex: mobile ? "0 0 38%" : undefined,
          fontSize: mobile ? 15 : undefined,
          ...noSelect,
        }}
      >
        {title}
      </span>
      <input
        type="range"
        min={minValue}
        max={maxValue}
        value={value}
        onChange={handleChange}
        onPointerDown={startDrag}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        style={{
          marginLeft: mobile ? 0 : "0.5em",
          accentColor: theme.secondary,
          background: "transparent",
          border: "none",
          flex: mobile ? 1 : undefined,
          width: mobile ? undefined : 130,
          minWidth: 0,
          height: thumbSize,
          outline: "none",
          WebkitAppearance: "none",
          appearance: "none",
          cursor: "pointer",
          position: "relative",
          zIndex: 2,
          // stop a slider drag from scrolling the sheet behind it
          touchAction: "none",
        }}
        className={active ? `${className} active` : className}
      />
      <span
        style={{
          marginLeft: mobile ? 0 : 10,
          minWidth: mobile ? 40 : 32,
          textAlign: "right",
          color: theme.secondaryAccent,
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
          ...noSelect,
        }}
      >
        {value}
      </span>
      <style>{`
        .${className} {
          height: ${thumbSize}px;
          background: transparent;
        }
        .${className}:focus {
          outline: none;
        }
        .${className}::-webkit-slider-runnable-track {
          height: ${trackHeight}px;
          background: linear-gradient(90deg, ${theme.secondaryAccent} 0%, ${theme.secondary} 100%);
          border-radius: ${trackHeight}px;
          box-shadow: 0 1px 4px ${theme.secondaryAccent}33;
        }
        .${className}::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: ${thumbSize}px;
          height: ${thumbSize}px;
          border-radius: 50%;
          background: ${theme.secondary};
          border: 2px solid ${theme.primary};
          box-shadow: 0 2px 8px ${theme.secondaryAccent}55;
          margin-top: ${thumbOffset}px;
          transition: background 0.15s, transform 0.15s;
        }
        .${className}.active::-webkit-slider-thumb {
          background: ${theme.tertiaryAccent};
          transform: scale(1.12);
        }
        .${className}::-moz-range-track {
          height: ${trackHeight}px;
          background: linear-gradient(90deg, ${theme.secondaryAccent} 0%, ${theme.secondary} 100%);
          border-radius: ${trackHeight}px;
          box-shadow: 0 1px 4px ${theme.secondaryAccent}33;
        }
        .${className}::-moz-range-thumb {
          width: ${thumbSize}px;
          height: ${thumbSize}px;
          border-radius: 50%;
          background: ${theme.secondary};
          border: 2px solid ${theme.primary};
          box-shadow: 0 2px 8px ${theme.secondaryAccent}55;
          transition: background 0.15s, transform 0.15s;
        }
        .${className}.active::-moz-range-thumb {
          background: ${theme.tertiaryAccent};
          transform: scale(1.12);
        }
        .${className}::-ms-fill-lower {
          background: ${theme.secondaryAccent};
          border-radius: ${trackHeight}px;
        }
        .${className}::-ms-fill-upper {
          background: ${theme.secondary};
          border-radius: ${trackHeight}px;
        }
        .${className}::-ms-thumb {
          width: ${thumbSize}px;
          height: ${thumbSize}px;
          border-radius: 50%;
          background: ${theme.secondary};
          border: 2px solid ${theme.primary};
          box-shadow: 0 2px 8px ${theme.secondaryAccent}55;
          transition: background 0.15s, transform 0.15s;
        }
        .${className}.active::-ms-thumb {
          background: ${theme.tertiaryAccent};
        }
        .${className}::-ms-tooltip {
          display: none;
        }
      `}</style>
    </div>
  );
}

export default Slider;
