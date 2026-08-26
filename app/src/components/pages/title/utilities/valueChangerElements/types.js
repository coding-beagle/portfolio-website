/**
 * Named types for the entries in a `valueArrays` config.
 *
 * A config is an array whose entries are either a single changer descriptor or
 * an array of descriptors (rendered as one row on desktop, stacked on mobile).
 * Each descriptor is `{ type: CHANGER_TYPE.*, ...props for that component }`.
 */
export const CHANGER_TYPE = Object.freeze({
  SLIDER: "slider",
  BUTTON: "button",
  COLOR: "color",
  DISPLAY: "display",
  DATE: "date",
});

/**
 * Typed constructors. Prefer these over hand-written object literals so the
 * shape of each changer is documented in one place.
 */
export const changers = {
  slider: (props) => ({ type: CHANGER_TYPE.SLIDER, ...props }),
  button: (props) => ({ type: CHANGER_TYPE.BUTTON, ...props }),
  color: (props) => ({ type: CHANGER_TYPE.COLOR, ...props }),
  display: (props) => ({ type: CHANGER_TYPE.DISPLAY, ...props }),
  date: (props) => ({ type: CHANGER_TYPE.DATE, ...props }),
};
