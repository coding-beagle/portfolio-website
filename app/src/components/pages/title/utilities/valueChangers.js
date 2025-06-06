import React, { useRef, useEffect, useState, useContext } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { MobileContext } from "../../../../contexts/MobileContext";

export default function ValueChangers({ rerenderSetter, valueArrays }) {
  const { theme } = useTheme();
  const mobile = useContext(MobileContext);
  const [showMenu, setShowMenu] = useState(false);

  return (
    <>
      {mobile ? (
        <>
          <button
            style={{
              position: "fixed",
              top: 12,
              left: 12,
              margin: 0,
              fontSize: "1em",
              padding: "0.35em 1em",
              borderRadius: "7px",
              border: "none",
              background: theme.accent,
              color: theme.primary,
              fontWeight: "bold",
              cursor: "pointer",
              zIndex: 11001, // ensure above title
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }}
            onClick={() => setShowMenu(true)}
          >
            Show Simulation Options
          </button>
          {showMenu && (
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                width: "100vw",
                height: "100vh",
                background: "rgba(0,0,0,0.5)",
                zIndex: 12000, // ensure above everything else
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.3s cubic-bezier(.4,0,.2,1)",
              }}
              onClick={() => setShowMenu(false)}
            >
              <div
                style={{
                  background: theme.primary,
                  color: theme.accent,
                  borderRadius: "18px",
                  padding: "2em 1.5em 1.5em 1.5em",
                  minWidth: "70vw",
                  maxWidth: "90vw",
                  maxHeight: "80vh",
                  overflowY: "auto",
                  boxShadow: "0 4px 24px rgba(0,0,0,0.2)",
                  position: "relative",
                  zIndex: 12001,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  animation: "fadeInModal 0.22s cubic-bezier(.4,0,.2,1)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 16,
                    fontSize: "1.5em",
                    background: "none",
                    border: "none",
                    color: theme.accent,
                    cursor: "pointer",
                    zIndex: 1,
                  }}
                  onClick={() => setShowMenu(false)}
                  tabIndex={0}
                  aria-label="Close simulation options"
                >
                  ×
                </button>
                <div
                  style={{
                    paddingBottom: "0.5em",
                    fontWeight: 600,
                    fontSize: "1.1em",
                  }}
                >
                  Simulation Options
                </div>
                <div style={{ width: "100%" }}>
                  {valueArrays.map((element, index) => {
                    if (Array.isArray(element)) {
                      return (
                        <div
                          key={index}
                          style={{
                            display: "flex",
                            gap: "0.5em",
                            alignItems: "center",
                            flexWrap: "wrap",
                            justifyContent: "center",
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
                            if (subElement.type === "color")
                              return (
                                <ChangerColor
                                  key={subIndex}
                                  {...subElement}
                                  rerenderSetter={rerenderSetter}
                                />
                              );
                            if (subElement.type === "display")
                              return (
                                <DisplayEntity
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
                        <Slider
                          key={index}
                          {...element}
                          rerenderSetter={rerenderSetter}
                        />
                      );
                    if (element.type === "button")
                      return (
                        <ChangerButton
                          key={index}
                          {...element}
                          rerenderSetter={rerenderSetter}
                        />
                      );
                    if (element.type === "color")
                      return (
                        <ChangerColor
                          key={index}
                          {...element}
                          rerenderSetter={rerenderSetter}
                        />
                      );
                    if (element.type === "display")
                      return (
                        <DisplayEntity
                          key={index}
                          {...element}
                          rerenderSetter={rerenderSetter}
                        />
                      );
                    return null;
                  })}
                </div>
                <style>{`
                  @keyframes fadeInModal {
                    from { opacity: 0; transform: scale(0.97); }
                    to { opacity: 1; transform: scale(1); }
                  }
                `}</style>
              </div>
            </div>
          )}
        </>
      ) : (
        <div>
          <ChangerGroup
            rerenderSetter={rerenderSetter}
            valueArrays={valueArrays}
          />
        </div>
      )}
    </>
  );
}

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
      <span
        style={{
          minWidth: 90,
          WebkitUserSelect: "none",
          WebkitTouchCallout: "none",
          KhtmlUserSelect: "none",
          MozUserSelect: "none",
          userSelect: "none",
          msUserSelect: "none",
        }}
      >
        {title}
      </span>
      <input
        type="range"
        min={minValue}
        max={maxValue}
        value={isState ? valueRef : valueRef.current}
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
        {isState ? valueRef : valueRef.current}
      </span>
      <style>{`
        .modern-slider::-webkit-slider-runnable-track {
          height: 6px;
          background: linear-gradient(90deg, ${theme.secondaryAccent} 0%, ${theme.secondary} 100%);
          border-radius: 6px;
          box-shadow: 0 1px 4px ${theme.secondaryAccent}33;
          transition: opacity 0.5s cubic-bezier(.4,0,.2,1);
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
          border: 0px solid ${theme.tertiaryAccent};
        }
        .modern-slider::-moz-range-track {
          height: 6px;
          background: linear-gradient(90deg, ${theme.secondaryAccent} 0%, ${theme.secondary} 100%);
          border-radius: 6px;
          box-shadow: 0 1px 4px ${theme.secondaryAccent}33;
          transition: opacity 0.5s cubic-bezier(.4,0,.2,1);
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
          border: 0px solid ${theme.tertiaryAccent};
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
          border: 0px solid ${theme.tertiaryAccent};
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
  const { theme } = useTheme();
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
      style={{ display: "flex", alignItems: "center", marginBottom: "0.3em" }}
    >
      {title && (
        <span
          style={{
            minWidth: 120,
            marginRight: 6,
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
            KhtmlUserSelect: "none",
            MozUserSelect: "none",
            userSelect: "none",
            msUserSelect: "none",
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
        style={{
          padding: "0.35em 1.1em",
          fontSize: 15,
          borderRadius: 6,
          border: `0px solid ${theme.accent}`,
          background: `linear-gradient(45deg, ${theme.secondary} 0%, ${theme.secondaryAccent} 100%)`,
          color: theme.text,
          fontWeight: 500,
          cursor: "pointer",
          transition:
            "background 0.15s, border 0.15s, color 0.15s, transform 0.12s cubic-bezier(.4,2,.6,1)",
          marginLeft: title ? 0 : 0,
          boxShadow: `0 1px 6px ${theme.secondaryAccent}22`,
          fontFamily: theme.font,
        }}
        onMouseOver={(e) => {
          if (btnRef.current) {
            btnRef.current.style.transform = "scale(1.07)";
            btnRef.current.style.background = `linear-gradient(45deg, ${theme.secondaryAccent} 0%, ${theme.secondary} 100%)`;
          }
        }}
        onMouseOut={(e) => {
          if (btnRef.current) {
            btnRef.current.style.transform = "scale(1)";
            btnRef.current.style.background = `linear-gradient(90deg, ${theme.secondary} 0%, ${theme.secondaryAccent} 100%)`;
          }
        }}
      >
        {buttonText}
      </button>
    </div>
  );
}

export function ChangerColor({ rerenderSetter, title, colorValue, onChange }) {
  const { theme } = useTheme();
  return (
    <div
      style={{ display: "flex", alignItems: "center", marginBottom: "0.3em" }}
    >
      <span style={{ minWidth: 120 }}>{title}</span>
      <input
        type="color"
        value={colorValue}
        onChange={(e) => {
          onChange(e.target.value);
          rerenderSetter((prev) => prev + 1);
        }}
        style={{
          marginLeft: "0.5em",
          width: 32,
          height: 32,
          border: `0px solid ${theme.secondaryAccent}`,
          borderRadius: 6,
          background: `linear-gradient(45deg, ${theme.secondary} 0%, ${theme.secondaryAccent} 100%)`,
          boxShadow: `0 1px 6px ${theme.secondaryAccent}22`,
          fontFamily: theme.font,
          fontWeight: 500,
          transition: "background 0.15s, border 0.15s, box-shadow 0.15s",
          cursor: "pointer",
        }}
        onMouseOver={(e) => {
          e.target.style.background = `linear-gradient(45deg, ${theme.secondaryAccent} 0%, ${theme.secondary} 100%)`;
          e.target.style.boxShadow = `0 2px 10px ${theme.secondaryAccent}44`;
        }}
        onMouseOut={(e) => {
          e.target.style.background = `linear-gradient(45deg, ${theme.secondary} 0%, ${theme.secondaryAccent} 100%)`;
          e.target.style.boxShadow = `0 1px 6px ${theme.secondaryAccent}22`;
        }}
      />
    </div>
  );
}

export function DisplayEntity({
  rerenderSetter,
  title,
  valueRef,
  isState = false,
  maxPerLine = 3,
}) {
  const { theme } = useTheme();
  let value = isState ? valueRef : valueRef.current;
  let displayValue;

  // Periodically force rerender to update UI for ref changes
  React.useEffect(() => {
    const interval = setInterval(() => {
      rerenderSetter((prev) => prev + 1);
    }, 100); // 100ms is responsive but not too aggressive
    return () => clearInterval(interval);
  }, [rerenderSetter]);

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    const lines = [];
    for (let i = 0; i < entries.length; i += maxPerLine) {
      const slice = entries.slice(i, i + maxPerLine);
      lines.push(
        slice
          .map(
            ([k, v]) =>
              `${k}: ${
                typeof v === "object" && v !== null ? "[object]" : String(v)
              }`
          )
          .join("    ") // 4 spaces between pairs, no commas
      );
    }
    displayValue = (
      <div
        style={{
          textAlign: "left",
          fontFamily: "monospace",
          fontSize: 13,
          WebkitUserSelect: "none",
          WebkitTouchCallout: "none",
          KhtmlUserSelect: "none",
          MozUserSelect: "none",
          userSelect: "none",
          msUserSelect: "none",
        }}
      >
        {lines.map((line, idx) => (
          <div key={idx}>{line}</div>
        ))}
      </div>
    );
  } else {
    displayValue = value;
  }
  return (
    <div
      style={{ display: "flex", alignItems: "center", marginBottom: "0.3em" }}
    >
      {title && (
        <span
          style={{
            minWidth: 0,
            marginRight: "1em",
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
            KhtmlUserSelect: "none",
            MozUserSelect: "none",
            userSelect: "none",
            msUserSelect: "none",
          }}
        >
          {title}
        </span>
      )}
      <span
        style={{
          padding: "0.35em 1.1em",
          fontSize: 15,
          borderRadius: 6,
          border: `1px solid ${theme.secondaryAccent}`,
          background: theme.background,
          color: theme.text,
          fontWeight: 500,
          fontFamily: theme.font,
          minWidth: 40,
          textAlign: "center",
          display: "flex",
          alignItems: "center",
          WebkitUserSelect: "none",
          WebkitTouchCallout: "none",
          KhtmlUserSelect: "none",
          MozUserSelect: "none",
          userSelect: "none",
          msUserSelect: "none",
        }}
      >
        {displayValue}
      </span>
    </div>
  );
}

export function ChangerGroup({ rerenderSetter, valueArrays }) {
  const { theme } = useTheme();
  const mobile = useContext(MobileContext);
  const [showMenu, setShowMenu] = useState(false);

  if (mobile) {
    return (
      <>
        <button
          style={{
            position: "fixed",
            top: 12,
            left: 12,
            margin: 0,
            fontSize: "1em",
            padding: "0.35em 1em",
            borderRadius: "7px",
            border: "none",
            background: theme.accent,
            color: theme.primary,
            fontWeight: "bold",
            cursor: "pointer",
            zIndex: 11001, // ensure above title
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}
          onClick={() => setShowMenu(true)}
        >
          Show Simulation Options
        </button>
        {showMenu && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100vw",
              height: "100vh",
              background: "rgba(0,0,0,0.5)",
              zIndex: 12000, // ensure above everything else
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.3s cubic-bezier(.4,0,.2,1)",
            }}
            onClick={() => setShowMenu(false)}
          >
            <div
              style={{
                background: theme.primary,
                color: theme.accent,
                borderRadius: "18px",
                padding: "2em 1.5em 1.5em 1.5em",
                minWidth: "70vw",
                maxWidth: "90vw",
                maxHeight: "80vh",
                overflowY: "auto",
                boxShadow: "0 4px 24px rgba(0,0,0,0.2)",
                position: "relative",
                zIndex: 12001,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                animation: "fadeInModal 0.22s cubic-bezier(.4,0,.2,1)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                style={{
                  position: "absolute",
                  top: 10,
                  right: 16,
                  fontSize: "1.5em",
                  background: "none",
                  border: "none",
                  color: theme.accent,
                  cursor: "pointer",
                  zIndex: 1,
                }}
                onClick={() => setShowMenu(false)}
                tabIndex={0}
                aria-label="Close simulation options"
              >
                ×
              </button>
              <div
                style={{
                  paddingBottom: "0.5em",
                  fontWeight: 600,
                  fontSize: "1.1em",
                }}
              >
                Simulation Options
              </div>
              <div style={{ width: "100%" }}>
                {/* Render the value changers UI here for mobile */}
                {valueArrays.map((element, index) => {
                  if (Array.isArray(element)) {
                    return (
                      <div
                        key={index}
                        style={{
                          display: "flex",
                          gap: "0.5em",
                          alignItems: "center",
                          flexWrap: "wrap",
                          justifyContent: "center",
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
                          if (subElement.type === "color")
                            return (
                              <ChangerColor
                                key={subIndex}
                                {...subElement}
                                rerenderSetter={rerenderSetter}
                              />
                            );
                          if (subElement.type === "display")
                            return (
                              <DisplayEntity
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
                      <Slider
                        key={index}
                        {...element}
                        rerenderSetter={rerenderSetter}
                      />
                    );
                  if (element.type === "button")
                    return (
                      <ChangerButton
                        key={index}
                        {...element}
                        rerenderSetter={rerenderSetter}
                      />
                    );
                  if (element.type === "color")
                    return (
                      <ChangerColor
                        key={index}
                        {...element}
                        rerenderSetter={rerenderSetter}
                      />
                    );
                  if (element.type === "display")
                    return (
                      <DisplayEntity
                        key={index}
                        {...element}
                        rerenderSetter={rerenderSetter}
                      />
                    );
                  return null;
                })}
              </div>
              <style>{`
                @keyframes fadeInModal {
                  from { opacity: 0; transform: scale(0.97); }
                  to { opacity: 1; transform: scale(1); }
                }
              `}</style>
            </div>
          </div>
        )}
      </>
    );
  }
  // Desktop: render inline as before
  return (
    <div style={{ position: "absolute", top: "1em", left: "1em" }}>
      {valueArrays.map((element, index) => {
        if (Array.isArray(element)) {
          return (
            <div
              key={index}
              style={{
                display: "flex",
                gap: "0.5em",
                alignItems: "center",
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
                if (subElement.type === "color")
                  return (
                    <ChangerColor
                      key={subIndex}
                      {...subElement}
                      rerenderSetter={rerenderSetter}
                    />
                  );
                if (subElement.type === "display")
                  return (
                    <DisplayEntity
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
        if (element.type === "color")
          return (
            <ChangerColor
              key={index}
              {...element}
              rerenderSetter={rerenderSetter}
            />
          );
        if (element.type === "display")
          return (
            <DisplayEntity
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
