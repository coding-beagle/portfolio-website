import React, { useRef, useEffect, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";

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
  const [showAccent, setShowAccent] = useState(false);
  const fadeTimeout = useRef(null);

  // Show accent when user interacts, then fade out after 1.2s
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
    setShowAccent(true);
    if (fadeTimeout.current) clearTimeout(fadeTimeout.current);
    fadeTimeout.current = setTimeout(() => setShowAccent(false), 1200);
  };

  useEffect(() => {
    return () => {
      if (fadeTimeout.current) clearTimeout(fadeTimeout.current);
    };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        marginBottom: "0.5em",
        fontFamily: theme.font,
        color: theme.accent,
      }}
    >
      <span style={{ minWidth: 90 }}>{title}</span>
      <input
        type="range"
        min={minValue}
        max={maxValue}
        value={valueRef.current}
        onChange={handleChange}
        style={{
          marginLeft: "0.5em",
          accentColor: theme.secondary,
          background: "transparent",
          border: "none",
          width: 130,
          height: 6,
          outline: "none",
          WebkitAppearance: "none",
          appearance: "none",
          cursor: "pointer",
          position: "relative",
          zIndex: 2,
        }}
        className={showAccent ? "modern-slider accent-fade" : "modern-slider"}
      />
      <span
        style={{
          marginLeft: 10,
          minWidth: 32,
          textAlign: "right",
          color: theme.secondaryAccent,
          fontWeight: 500,
        }}
      >
        {valueRef.current}
      </span>
      <style>{`
        .modern-slider::-webkit-slider-runnable-track {
          height: 6px;
          background: linear-gradient(90deg, ${theme.secondaryAccent} 0%, ${theme.secondary} 100%);
          border-radius: 6px;
          box-shadow: 0 1px 4px ${theme.secondaryAccent}33;
        }
        .modern-slider.accent-fade::-webkit-slider-runnable-track {
          opacity: 1;
        }
        .modern-slider:not(.accent-fade)::-webkit-slider-runnable-track {
          opacity: 0.3;
        }
        .modern-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: ${theme.secondary};
          border: 2px solid ${theme.primary};
          box-shadow: 0 2px 8px ${theme.secondaryAccent}55;
          margin-top: -6px;
          transition: background 0.2s, border 0.2s;
        }
        .modern-slider:focus::-webkit-slider-thumb {
          border: 2px solid ${theme.tertiaryAccent};
        }
        .modern-slider::-moz-range-track {
          height: 6px;
          background: linear-gradient(90deg, ${theme.secondaryAccent} 0%, ${theme.secondary} 100%);
          border-radius: 6px;
          box-shadow: 0 1px 4px ${theme.secondaryAccent}33;
        }
        .modern-slider.accent-fade::-moz-range-track {
          opacity: 1;
        }
        .modern-slider:not(.accent-fade)::-moz-range-track {
          opacity: 0.3;
        }
        .modern-slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: ${theme.secondary};
          border: 2px solid ${theme.primary};
          box-shadow: 0 2px 8px ${theme.secondaryAccent}55;
          transition: background 0.2s, border 0.2s;
        }
        .modern-slider:focus::-moz-range-thumb {
          border: 2px solid ${theme.tertiaryAccent};
        }
        .modern-slider::-ms-fill-lower {
          background: ${theme.secondaryAccent};
          border-radius: 6px;
        }
        .modern-slider::-ms-fill-upper {
          background: ${theme.secondary};
          border-radius: 6px;
        }
        .modern-slider::-ms-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: ${theme.secondary};
          border: 2px solid ${theme.primary};
          box-shadow: 0 2px 8px ${theme.secondaryAccent}55;
          transition: background 0.2s, border 0.2s;
        }
        .modern-slider:focus::-ms-thumb {
          border: 2px solid ${theme.tertiaryAccent};
        }
        .modern-slider:focus {
          outline: none;
        }
        .modern-slider::-webkit-slider-thumb:hover {
          background: ${theme.tertiaryAccent};
        }
        .modern-slider::-moz-range-thumb:hover {
          background: ${theme.tertiaryAccent};
        }
        .modern-slider::-ms-thumb:hover {
          background: ${theme.tertiaryAccent};
        }
        .modern-slider::-ms-tooltip {
          display: none;
        }
        .modern-slider {
          width: 130px;
          height: 6px;
          background: transparent;
        }
      `}</style>
    </div>
  );
}

export function ChangerButton({ rerenderSetter, title, buttonText, callback }) {
  return (
    <div>
      {title}{" "}
      <button
        onClick={() => {
          rerenderSetter((prev) => prev + 1);
          callback();
        }}
      >
        {buttonText}
      </button>
    </div>
  );
}

export function ChangerGroup({ rerenderSetter, valueArrays }) {
  return (
    <div style={{ position: "absolute", top: "1em", left: "1em" }}>
      {valueArrays.map((element, index) => {
        if (Array.isArray(element)) {
          // Render any number of value changers side by side
          return (
            <div
              key={index}
              style={{
                display: "flex",
                gap: "0.5em",
                alignItems: "center",
                marginBottom: "0.5em",
              }}
            >
              {element.map((subElement, subIndex) => {
                if (subElement.type === "slider")
                  return (
                    <Slider
                      key={subIndex}
                      {...subElement}
                      rerenderSetter={rerenderSetter}
                    />
                  );
                if (subElement.type === "button")
                  return (
                    <ChangerButton
                      key={subIndex}
                      {...subElement}
                      rerenderSetter={rerenderSetter}
                    />
                  );
                return null;
              })}
            </div>
          );
        }
        if (element.type === "slider")
          return (
            <Slider key={index} {...element} rerenderSetter={rerenderSetter} />
          );
        if (element.type === "button")
          return (
            <ChangerButton
              key={index}
              {...element}
              rerenderSetter={rerenderSetter}
            />
          );
        return null;
      })}
    </div>
  );
}
