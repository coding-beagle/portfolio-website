import React from "react";

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
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        marginBottom: "0.5em",
      }}
    >
      {title}
      <input
        type="range"
        min={minValue}
        max={maxValue}
        value={valueRef.current}
        onChange={(e) => {
          if (!isState) {
            valueRef.current = Number(e.target.value);
          } else {
            valueSetter(Number(e.target.value));
          }
          if (callback) {
            callback();
          }
          rerenderSetter((prev) => prev + 1); // Force re-render to update slider UI
        }}
        style={{ marginLeft: "0.5em" }}
      />
    </div>
  );
}

export function SliderGroup({ rerenderSetter, valueArrays }) {
  return (
    <div style={{ position: "absolute", top: "1em", left: "1em" }}>
      {valueArrays.map((element, index) => (
        <Slider key={index} {...element} rerenderSetter={rerenderSetter} />
      ))}
    </div>
  );
}
