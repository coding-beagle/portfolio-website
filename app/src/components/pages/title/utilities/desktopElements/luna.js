/**
 * Luna — the Windows XP look.
 *
 * These colours are XP's own rather than the site theme's, and deliberately so:
 * Luna *is* its palette. The taskbar blue, the green start button and the beige
 * window face are the whole recognition, and rebuilding them out of the theme's
 * cyan produced something that read as a generic blue desktop instead. The one
 * concession to the light/dark toggle is the wallpaper, which goes to dusk.
 */

import { scaleColour } from "../usefulFunctions";

const BLACK = "#000000";
const WHITE = "#ffffff";

const DAY = { skyTop: "#1E5FB4", skyMid: "#59A2E5", skyLow: "#AFD8F5" };
const DUSK = { skyTop: "#07142B", skyMid: "#1B3A66", skyLow: "#3E6288" };

/**
 * The Bliss hill, shaded from the theme's own green so the one part of the
 * wallpaper that is not sky still belongs to the site.
 */
export function hillColours(green, dusk) {
  const base = dusk ? scaleColour(green, BLACK, 0.5) : green;
  return {
    rim: scaleColour(base, WHITE, dusk ? 0.25 : 0.55),
    crest: scaleColour(base, WHITE, dusk ? 0.12 : 0.32),
    body: base,
    foot: scaleColour(base, BLACK, 0.45),
  };
}

/** The sky, for either time of day — both are needed at once to cross-fade. */
export function skyGradient(dusk) {
  const sky = dusk ? DUSK : DAY;
  return `linear-gradient(180deg, ${sky.skyTop} 0%, ${sky.skyMid} 52%, ${sky.skyLow} 100%)`;
}

export function lunaPalette(themeName) {
  const dusk = themeName !== "light";

  return {
    dusk,

    // Bliss' sky: deep at the top, washing out towards the horizon. The hill
    // that sits under it is drawn separately, in Wallpaper.
    sky: skyGradient(dusk),

    // The taskbar: a bright band across the top, the body, a dark foot.
    barGradient:
      "linear-gradient(180deg, #4E96F0 0%, #2E6FDF 8%, #245EDC 42%, #2159D4 88%, #1941A5 100%)",
    barTopLine: "#8FC1F7",
    barFoot: "#12307A",

    // The start button, the one green thing on the bar.
    startGradient:
      "linear-gradient(180deg, #83CB77 0%, #55A94F 18%, #3C8B37 55%, #2C7028 100%)",
    startHoverGradient:
      "linear-gradient(180deg, #9BDA8E 0%, #6ABE62 18%, #4C9F45 55%, #3A8433 100%)",
    startEdge: "#1D5A1A",
    startText: "#FFFFFF",

    // Title bars and the window frame around the body.
    titleGradient:
      "linear-gradient(180deg, #4B92F5 0%, #1360E8 8%, #0A5BE0 42%, #0450DB 88%, #003FC4 100%)",
    frame: "#0054E3",
    titleText: "#FFFFFF",

    // The sunken notification area at the end of the bar.
    tray: "#0B4CB8",
    trayEdge: "#1E62D0",

    // Window interiors: XP's beige face, with white where content sits.
    face: "#ECE9D8",
    content: "#FFFFFF",
    text: "#000000",
    dimText: "#5A5A50",
    edge: "#919B9C",

    // The pale blue column down the right of the start menu.
    menuSide: "#D3E5FA",
    menuHover: "#316AC5",
    menuHoverText: "#FFFFFF",

    // The title-bar buttons.
    buttonGradient:
      "linear-gradient(180deg, #82B6F8 0%, #2F76E8 45%, #14479F 100%)",
    closeGradient:
      "linear-gradient(180deg, #F2A08E 0%, #DC5A3C 45%, #A62A11 100%)",
    buttonEdge: "#0A3C9E",

    selection: "rgba(51, 153, 255, 0.4)",
    selectionEdge: "#3399FF",
    hover: "rgba(255, 255, 255, 0.22)",

    // Desktop labels sit on the sky in both wallpapers, so they are white with
    // the shadow XP gave them rather than following the theme's text colour.
    desktopText: "#FFFFFF",
    desktopTextShadow: "1px 1px 2px rgba(0,0,0,0.85)",
  };
}
