/**
 * The colour the page's own furniture — the title, the scene label, the row of
 * icons — is written in.
 *
 * Normally that is the theme's accent. A scene can take it over for as long as
 * it is on screen by setting this custom property, which is how the desktop's
 * title keeps up with a sky that darkens over the whole turn of the sun rather
 * than in the instant the theme flips. A custom property rather than state
 * because the title is a sibling of the scene rather than a child of it, and
 * re-rendering the page every frame to carry one colour is not worth it.
 */
export const INK_VAR = "--scene-ink";

/** The accent, unless the scene on screen has something else to say. */
export const inkColour = (theme) => `var(${INK_VAR}, ${theme.accent})`;
