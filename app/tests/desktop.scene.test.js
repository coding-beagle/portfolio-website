/**
 * The desktop scene: that the shortcuts are the subdomain registry plus the
 * scenes folder, that opening takes two clicks, and that the folder is a real
 * window on the taskbar.
 */
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "../src/themes/ThemeProvider";
import { MobileContext } from "../src/contexts/MobileContext";
import Desktop from "../src/components/pages/title/scenes/desktop";
import {
  eyeHeight,
  faceProjection,
  litHemispherePath,
  mouthPath,
  spinEase,
} from "../src/components/pages/title/utilities/desktopElements/CelestialSphere";
import { nightFraction } from "../src/components/pages/title/utilities/desktopElements/Wallpaper";
import StarField from "../src/components/pages/title/utilities/desktopElements/StarField";
import { ridgeSlope, ridgeY } from "../src/components/pages/title/utilities/desktopElements/hill";
import { SUBDOMAIN_APPS, appHref } from "../src/subdomains";

const SCENES = ["snow", "rain", "hyperspace", "desktop"];

const mount = ({ mobile = false, ...props } = {}) => {
  const onLaunch = jest.fn();
  const onOpenScene = jest.fn();
  const onToggleTheme = jest.fn();
  const onToggleVisibleUI = jest.fn();
  const view = render(
    <MobileContext.Provider value={mobile}>
      <ThemeProvider>
        <Desktop
          sceneNames={SCENES}
          currentSceneName="desktop"
          onLaunch={onLaunch}
          onOpenScene={onOpenScene}
          onToggleTheme={onToggleTheme}
          onToggleVisibleUI={onToggleVisibleUI}
          {...props}
        />
      </ThemeProvider>
    </MobileContext.Provider>
  );
  return { ...view, onLaunch, onOpenScene, onToggleTheme, onToggleVisibleUI };
};

const shortcut = (label) => screen.getByTitle(label);

// The shortcuts stack in one column below the subdomain apps, so a hard-coded
// position breaks every time a utility is added to the registry.
const GRID_TOP = 16;
const CELL_HEIGHT = 92 + 6;
const GRID_LEFT = 16;
const CELL_WIDTH = 84 + 6;
const homeTop = (index) => `${GRID_TOP + index * CELL_HEIGHT}px`;
const SCENES_INDEX = SUBDOMAIN_APPS.length;

/** jsdom fixes the viewport at 1024x768, so a phone has to be declared. */
const setViewport = (width, height) => {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
};
/**
 * `hidden: true` because a minimised window is still mounted, only display:none
 * — which the role queries would otherwise treat as not being there at all, and
 * the point of minimising is that the window survives it.
 */
const folderWindow = () => screen.queryByRole("dialog", { hidden: true });
const taskbar = () => within(screen.getByRole("toolbar", { name: "Taskbar" }));

afterEach(() => setViewport(1024, 768));

/**
 * jsdom has no 2D context, so the star field would silently skip drawing.
 * Recording the calls instead lets the wallpaper actually be tested.
 */
function stubCanvas() {
  const calls = { arc: 0, stroke: 0 };
  HTMLCanvasElement.prototype.getContext = () => ({
    setTransform: () => {},
    clearRect: () => {},
    beginPath: () => {},
    arc: () => {
      calls.arc += 1;
    },
    fill: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {
      calls.stroke += 1;
    },
    set globalAlpha(value) {},
    set fillStyle(value) {},
    set strokeStyle(value) {},
    set lineWidth(value) {},
  });
  return calls;
}

describe("poking the sun and moon", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  const grab = () => document.querySelector("[data-celestial-grab]");
  const body = () => document.querySelector(".celestialBody");
  const mouth = () => document.querySelector("[data-mouth]").getAttribute("d");
  const SIZE = 132;
  /** Where it is now, which is where you would actually take hold of it. */
  const centre = () => ({
    clientX: parseFloat(body().style.left) + SIZE / 2,
    clientY: parseFloat(body().style.top) + SIZE / 2,
  });

  /** A press and a release in the same place, which is a poke and not a drag. */
  const prod = (at = { clientX: 900, clientY: 90 }) => {
    fireEvent.mouseDown(grab(), { ...at, button: 0 });
    fireEvent.mouseUp(window, at);
  };

  it("scowls when it is prodded", () => {
    stubCanvas();
    mount();
    const calm = mouth();
    expect(document.querySelector("[data-brow]")).toBeNull();

    prod();
    // The same arc turned over: the control point rises past the corners.
    expect(mouth()).not.toBe(calm);
    expect(document.querySelectorAll("[data-brow]")).toHaveLength(2);
  });

  it("shakes on each prod, and restarts the shake on the next one", () => {
    stubCanvas();
    mount();
    const shake = () => document.querySelector(".celestialShake").style.animationName;
    expect(shake()).toBe("none");

    prod();
    const first = shake();
    expect(first).not.toBe("none");

    // A different animation of the same shape, because re-applying the one
    // already on the element would not play it a second time.
    prod();
    expect(shake()).not.toBe(first);
    expect(shake()).not.toBe("none");
  });

  it("leaves the pointer alone", () => {
    stubCanvas();
    mount();
    expect(grab()).toHaveStyle({ cursor: "default" });
  });

  it("gives up on the sky if it is prodded enough", () => {
    stubCanvas();
    mount();
    // In its place: pinned to the corner by the percentages it is placed with.
    expect(body().style.right).not.toBe("");
    expect(body().style.left).toBe("");

    for (let i = 0; i < 5; i += 1) prod();

    // Out of it: carrying a position of its own, and put out about it.
    expect(body().style.left).not.toBe("");
    expect(body().style.right).toBe("");
    expect(document.querySelectorAll("[data-brow]")).toHaveLength(2);
  });

  it("can be pushed around once it is on the ground", () => {
    stubCanvas();
    mount();
    for (let i = 0; i < 5; i += 1) prod();

    const from = parseFloat(body().style.left);
    fireEvent.mouseDown(grab(), { ...centre(), button: 0 });
    fireEvent.mouseMove(window, { clientX: 400, clientY: 500 });

    expect(parseFloat(body().style.left)).toBeLessThan(from);
    // And where it goes back to is offered while it is being carried.
    expect(document.querySelector("[data-celestial-home]")).toBeInTheDocument();

    fireEvent.mouseUp(window, { clientX: 400, clientY: 500 });
    expect(document.querySelector("[data-celestial-home]")).toBeNull();
  });

  it("goes back to being the sky's again when it is put back", () => {
    stubCanvas();
    mount();
    for (let i = 0; i < 5; i += 1) prod();
    expect(body().style.left).not.toBe("");

    // Its place is the top-right corner, by the fractions it is placed with.
    const home = {
      clientX: window.innerWidth * (1 - 0.09) - SIZE / 2,
      clientY: window.innerHeight * 0.07 + SIZE / 2,
    };
    // Taken hold of, carried off somewhere else, and then put back.
    fireEvent.mouseDown(grab(), { ...centre(), button: 0 });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 600 });
    fireEvent.mouseMove(window, { clientX: home.clientX, clientY: home.clientY });
    fireEvent.mouseUp(window, { clientX: home.clientX, clientY: home.clientY });

    // Back on its percentages, and over whatever it was sulking about.
    expect(body().style.right).not.toBe("");
    expect(body().style.left).toBe("");
    expect(document.querySelector("[data-brow]")).toBeNull();
  });
});

describe("the hill it lands on", () => {
  it("is the same curve the wallpaper draws", () => {
    // Both ends of the ridge, off the path the sky is painted with.
    expect(ridgeY(0)).toBeCloseTo(206);
    expect(ridgeY(1200)).toBeCloseTo(172);
  });

  it("crests left of centre and falls away to the right", () => {
    // Smaller y is higher up, so the crest is the lowest number.
    expect(ridgeY(500)).toBeLessThan(ridgeY(0));
    expect(ridgeY(500)).toBeLessThan(ridgeY(1200));
    // Which is a ball rolling backwards on the near slope and forwards on the
    // far one, rather than off in one direction whatever it is dropped on.
    expect(ridgeSlope(100)).toBeLessThan(0);
    expect(ridgeSlope(900)).toBeGreaterThan(0);
  });
});

describe("the wallpaper", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it("draws a sky for both times of day so the toggle can cross-fade", () => {
    stubCanvas();
    const { container } = mount();
    // Both layers stay mounted; only their opacity differs.
    expect(container.querySelectorAll(".utWallpaperLayer")).toHaveLength(2);
  });

  it("puts stars in the night sky", () => {
    const calls = stubCanvas();
    mount();
    // The dark theme is the default, so the night layer is the live one.
    expect(calls.arc).toBeGreaterThan(50);
    // Comets are drawn as circles too, like the stars scene's — a streak drawn
    // with lineTo/stroke would mean the old, wrong one had come back.
    expect(calls.stroke).toBe(0);
  });

  it("takes the light in the sky from how far the sphere has turned", () => {
    // Sun facing us is full day; turned right away is full night; and the limb
    // in between is halfway, so the sky is mid-fade exactly as the sun sets.
    expect(nightFraction(0)).toBeCloseTo(0);
    expect(nightFraction(-Math.PI)).toBeCloseTo(1);
    expect(nightFraction(-Math.PI / 2)).toBeCloseTo(0.5);
    // Which way it turns cannot matter — the sun is as gone either way round.
    expect(nightFraction(Math.PI)).toBeCloseTo(nightFraction(-Math.PI));
  });

  it("keeps day underneath so the hill never goes pale mid-fade", () => {
    stubCanvas();
    const { container } = mount();
    const [day, dusk] = container.querySelectorAll(".utWallpaperLayer");

    // Dark theme by default: the sphere starts turned to the moon, so the night
    // sky is fully drawn over a day that is always at full strength.
    expect(day).toHaveStyle({ opacity: "1" });
    expect(dusk).toHaveStyle({ opacity: "1" });
  });

  /**
   * The title and the icon row sit over this wallpaper, and the theme flips in
   * an instant while the sky takes the sphere's whole turn to follow. The
   * colour they are written in is published here so they can go with the sky.
   */
  it("writes the sky's ink onto the page for the title to take", () => {
    stubCanvas();
    const { unmount } = mount();

    // Dark theme by default: the sphere is turned to the moon, so the ink has
    // arrived at the accent the dark theme would have used anyway.
    expect(document.documentElement.style.getPropertyValue("--scene-ink")).toBe(
      "#f4e9cd"
    );

    // And handed back on the way out, so every other scene is written in its
    // own theme's accent again.
    unmount();
    expect(document.documentElement.style.getPropertyValue("--scene-ink")).toBe("");
  });

  it("keeps the same stars and comets when the sky changes hands", () => {
    // Positions come out as zero without a laid-out canvas; the radii are what
    // a regenerated field would change, which is what this is watching for.
    const arcs = [];
    HTMLCanvasElement.prototype.getContext = () => ({
      setTransform: () => {},
      clearRect: () => {},
      beginPath: () => {},
      arc: (x, y, r) => arcs.push([x, y, r]),
      fill: () => {},
      set globalAlpha(value) {},
      set fillStyle(value) {},
    });

    const { rerender } = render(<StarField colour="#FFFFFF" active={false} />);
    const before = arcs.splice(0);

    // Toggling the theme is what flips this, and it used to rebuild the field.
    rerender(<StarField colour="#FFFFFF" active />);
    const after = arcs.splice(0);

    expect(before.length).toBeGreaterThan(100);
    expect(after.slice(0, 110)).toEqual(before.slice(0, 110));
  });

  it("puts clouds in the day sky and only there", () => {
    stubCanvas();
    const { container } = mount();
    const [day, dusk] = container.querySelectorAll(".utWallpaperLayer");

    expect(day.querySelectorAll("[data-cloud]").length).toBeGreaterThan(2);
    // Night gets the stars instead; a cloud drawn there would sit over them.
    expect(dusk.querySelectorAll("[data-cloud]")).toHaveLength(0);
  });

  it("holds the clouds back until the sky is properly light", () => {
    stubCanvas();
    const { container } = mount();
    // Dark theme by default. Day is drawn underneath night rather than beside
    // it, so without this the clouds show through the moment night starts to
    // thin — long before the sky looks like daytime.
    expect(container.querySelector("[data-clouds]")).toHaveStyle({ opacity: "0" });
  });

  it("builds every cloud differently rather than resizing one shape", () => {
    stubCanvas();
    const { container } = mount();

    const clouds = [...container.querySelectorAll("[data-cloud]")];
    expect(clouds.length).toBeGreaterThan(2);

    // No two the same size overall...
    expect(new Set(clouds.map((cloud) => cloud.style.width)).size).toBe(clouds.length);

    clouds.forEach((cloud) => {
      const balls = [...cloud.children];
      expect(balls.length).toBeGreaterThanOrEqual(3);
      // ...and no cloud built out of one ball repeated, which is what the
      // swell towards the middle of the run is there to prevent.
      expect(new Set(balls.map((ball) => ball.style.width)).size).toBe(balls.length);
    });
  });

  it("starts each cloud part-way across so the sky is not empty at first", () => {
    stubCanvas();
    const { container } = mount();

    const delays = [...container.querySelectorAll(".utCloudTrack")].map((track) =>
      parseFloat(track.style.animationDelay)
    );
    expect(delays.length).toBeGreaterThan(2);
    delays.forEach((delay) => expect(delay).toBeLessThan(0));
    // Spread rather than stacked: no two clouds arrive at the same moment.
    expect(new Set(delays).size).toBe(delays.length);
  });

  it("shows one sphere whose two hemispheres are sun and moon", () => {
    stubCanvas();
    const { container } = mount();

    // One body, not two stacked discs and not a flipping plane.
    expect(container.querySelectorAll('[data-celestial="sphere"]')).toHaveLength(1);

    // Dark theme by default, so the sphere is turned to its moon side: the moon
    // is facing us and the sun's markings are round the back.
    expect(container.querySelector('[data-face="moon"]')).toBeInTheDocument();
    expect(container.querySelector('[data-face="sun"]')).toBeNull();
  });

  it("projects the faces onto the sphere rather than sliding them flat", () => {
    // Facing us at the front, gone at the back, and squashed to nothing at the
    // limb — which is what a marking on a turning ball does.
    expect(faceProjection(0, 0).facing).toBe(true);
    expect(faceProjection(Math.PI, 0).facing).toBe(false);
    expect(faceProjection(Math.PI / 2, 0).facing).toBe(false);

    // Halfway to the limb it has moved out and narrowed by the same cosine.
    const quarter = faceProjection(Math.PI / 4, 0);
    expect(quarter.transform).toContain("translate(71.213 50)");
    expect(quarter.transform).toContain("scale(0.707 1)");
  });

  it("draws the terminator as an ellipse that flattens through the turn", () => {
    // Facing the sun: the boundary lies on the limb, so the lit half covers all.
    expect(litHemispherePath(0)).toContain("A 30 30 0 0 0");
    // Halfway: an arc of zero width, which SVG draws as the straight meridian.
    expect(litHemispherePath(Math.PI / 2)).toContain("A 0 30");
  });

  it("puts the terminator on the correct side whichever way it turns", () => {
    // Only one of the sun's two bounding meridians is on the near side, and
    // which one swaps with the direction of travel. Getting this wrong is
    // invisible in one direction and badly wrong in the other.
    const right = litHemispherePath(Math.PI / 3);
    const left = litHemispherePath(-Math.PI / 3);
    expect(right).not.toBe(left);
    // Mirrored: same arc widths, opposite limb.
    expect(right).toContain("A 15 30");
    expect(left).toContain("A 15 30");
    expect(right.endsWith("0 0 0 50 20")).toBe(true);
    expect(left.endsWith("0 0 1 50 20")).toBe(true);
  });

  it("strains the face while it is turning", () => {
    // At rest the mouth curves up and the eyes are open.
    expect(mouthPath(0)).toBe("M43 58 Q50 64 57 58");
    expect(eyeHeight(0, false)).toBe(6);

    // Under load it inverts into a grimace and the eyes narrow.
    expect(mouthPath(1)).toBe("M43 60 Q50 55 57 60");
    expect(eyeHeight(1, false)).toBeLessThan(3);

    // A blink still shuts them regardless.
    expect(eyeHeight(0, true)).toBe(0.7);
  });

  it("winds back before it turns, then eases through on a cubic", () => {
    expect(spinEase(0)).toBeCloseTo(0, 5);
    expect(spinEase(1)).toBeCloseTo(1, 5);
    // Goes the wrong way first, and by a good margin.
    expect(spinEase(0.3)).toBeLessThan(-0.15);
    // Still behind where it started a third of the way in, then quickest
    // through the middle of the twist.
    expect(spinEase(0.35)).toBeLessThan(0);
    const early = spinEase(0.5) - spinEase(0.45);
    const middle = spinEase(0.7) - spinEase(0.65);
    const late = spinEase(0.95) - spinEase(0.9);
    expect(middle).toBeGreaterThan(early);
    expect(middle).toBeGreaterThan(late);
  });

  it("carries on without a canvas rather than taking the scene down", () => {
    HTMLCanvasElement.prototype.getContext = () => null;
    expect(() => mount()).not.toThrow();
    expect(shortcut("Scenes")).toBeInTheDocument();
  });
});

describe("desktop scene", () => {
  it("puts every subdomain app on the desktop, plus the scenes folder", () => {
    mount();
    SUBDOMAIN_APPS.forEach((app) => {
      expect(shortcut(app.name)).toBeInTheDocument();
    });
    expect(shortcut("Scenes")).toBeInTheDocument();
  });

  it("gives each app a real link so it can be opened in a tab", () => {
    mount();
    const app = SUBDOMAIN_APPS[0];
    expect(shortcut(app.name)).toHaveAttribute("href", appHref(app));
  });

  it("selects on the first click and launches on the second", () => {
    const { onLaunch } = mount();
    const app = SUBDOMAIN_APPS[0];

    userEvent.click(shortcut(app.name));
    expect(onLaunch).not.toHaveBeenCalled();

    fireEvent.doubleClick(shortcut(app.name));
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ key: app.key }));
  });

  it("opens on a single tap when there is no mouse to double-click with", () => {
    const { onLaunch } = mount({ mobile: true });
    userEvent.click(shortcut(SUBDOMAIN_APPS[0].name));
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it("opens the scenes folder as a window and lists every scene", () => {
    const { onOpenScene } = mount();
    expect(folderWindow()).toBeNull();

    fireEvent.doubleClick(shortcut("Scenes"));
    const window_ = folderWindow();
    SCENES.forEach((name) => {
      expect(within(window_).getByText(name)).toBeInTheDocument();
    });

    fireEvent.doubleClick(within(window_).getByTitle("hyperspace"));
    expect(onOpenScene).toHaveBeenCalledWith("hyperspace");
  });

  it("marks the scene that is already showing", () => {
    mount();
    fireEvent.doubleClick(shortcut("Scenes"));
    expect(
      within(folderWindow()).getByTitle("desktop (current scene)")
    ).toBeInTheDocument();
  });

  it("minimises the folder to the taskbar and back", () => {
    mount();
    fireEvent.doubleClick(shortcut("Scenes"));
    expect(folderWindow()).toBeVisible();

    userEvent.click(screen.getByLabelText("Minimise"));
    expect(folderWindow()).not.toBeVisible();

    // The taskbar keeps the window, so clicking its button brings it back.
    userEvent.click(taskbar().getByRole("button", { name: /Scenes/ }));
    expect(folderWindow()).toBeVisible();
  });

  it("closes the folder for good", () => {
    mount();
    fireEvent.doubleClick(shortcut("Scenes"));
    userEvent.click(screen.getByLabelText("Close"));
    expect(folderWindow()).toBeNull();
  });

  it("stacks the shortcuts down the screen on a desktop", () => {
    mount();
    // A column at a time, the way Windows fills a desktop.
    expect(shortcut(SUBDOMAIN_APPS[0].name)).toHaveStyle({
      left: "16px",
      top: homeTop(0),
    });
    expect(shortcut("Scenes")).toHaveStyle({
      left: "16px",
      top: homeTop(SCENES_INDEX),
    });
  });

  it("runs them across the screen on a phone instead", () => {
    // Tall and narrow: a single column would run off the bottom while the whole
    // width went unused.
    setViewport(390, 720);
    mount({ mobile: true });

    expect(shortcut(SUBDOMAIN_APPS[0].name)).toHaveStyle({
      left: `${GRID_LEFT}px`,
      top: homeTop(0),
    });
    // The second shortcut sits beside the first, not below it.
    expect(shortcut(SUBDOMAIN_APPS[1].name)).toHaveStyle({
      left: `${GRID_LEFT + CELL_WIDTH}px`,
      top: homeTop(0),
    });
  });

  /**
   * The sun and moon hangs in the top-right corner, so the row stops short of
   * it — three across and the rest wrapped onto the next row — even on a phone
   * wide enough to fit a fourth.
   */
  it("stops the phone's row before the sun and moon", () => {
    setViewport(430, 900);
    mount({ mobile: true });
    expect(Math.floor((430 - GRID_LEFT + 6) / CELL_WIDTH)).toBeGreaterThan(3);

    const tops = [...SUBDOMAIN_APPS.map((app) => app.name), "Scenes", "Change Theme", "Show Desktop"]
      .map((name) => parseInt(shortcut(name).style.top, 10));

    expect(tops.filter((top) => top === GRID_TOP)).toHaveLength(3);
    expect(tops.filter((top) => top === GRID_TOP + CELL_HEIGHT)).toHaveLength(
      tops.length - 3
    );
  });

  it("selects what the band covers, and keeps it after the mouse comes up", () => {
    const { container } = mount();
    const surface = container.firstChild;
    const first = shortcut(SUBDOMAIN_APPS[0].name);
    const second = shortcut(SUBDOMAIN_APPS[1].name);

    const isLit = (icon) => icon.style.borderColor !== "transparent";
    expect(isLit(first)).toBe(false);

    // A band over the top two icons in the column.
    fireEvent.mouseDown(surface, { clientX: 8, clientY: 8, button: 0 });
    fireEvent.mouseMove(window, { clientX: 120, clientY: 130 });
    expect(isLit(first)).toBe(true);
    expect(isLit(second)).toBe(true);
    expect(isLit(shortcut("Show Desktop"))).toBe(false);

    // And it survives the release — this is what was broken.
    fireEvent.mouseUp(window);
    expect(isLit(shortcut(SUBDOMAIN_APPS[0].name))).toBe(true);
    expect(isLit(shortcut(SUBDOMAIN_APPS[1].name))).toBe(true);

    // Clicking bare desktop clears it again.
    fireEvent.mouseDown(surface, { clientX: 600, clientY: 400, button: 0 });
    fireEvent.mouseUp(window);
    expect(isLit(shortcut(SUBDOMAIN_APPS[0].name))).toBe(false);
  });

  it("hides the selection band when it collapses onto its own axis", () => {
    const { container } = mount();
    const band = () => container.querySelector(".desktopMarquee");
    const surface = container.firstChild;

    fireEvent.mouseDown(surface, { clientX: 300, clientY: 300, button: 0 });
    fireEvent.mouseMove(window, { clientX: 420, clientY: 400 });
    expect(band()).toBeInTheDocument();

    // Back onto the x it started from: no width left, so nothing to draw.
    fireEvent.mouseMove(window, { clientX: 300, clientY: 400 });
    expect(band()).toBeNull();

    // And onto the y instead.
    fireEvent.mouseMove(window, { clientX: 420, clientY: 300 });
    expect(band()).toBeNull();

    // It comes back the moment the drag has area again, on either side of the
    // origin — dragging up and left is still a selection.
    fireEvent.mouseMove(window, { clientX: 180, clientY: 200 });
    expect(band()).toBeInTheDocument();

    fireEvent.mouseUp(window);
    expect(band()).toBeNull();
  });

  it("drags every selected shortcut together", () => {
    const { container } = mount();
    const surface = container.firstChild;
    const first = () => shortcut(SUBDOMAIN_APPS[0].name);
    const second = () => shortcut(SUBDOMAIN_APPS[1].name);

    // Band over the top two, then drag one of them.
    fireEvent.mouseDown(surface, { clientX: 8, clientY: 8, button: 0 });
    fireEvent.mouseMove(window, { clientX: 120, clientY: 130 });
    fireEvent.mouseUp(window);

    fireEvent.mouseDown(first(), { clientX: 40, clientY: 40, button: 0 });
    fireEvent.mouseMove(window, { clientX: 220, clientY: 240 });
    fireEvent.mouseUp(window);

    // Both moved, and by the same amount — the group keeps its shape.
    expect(first()).toHaveStyle({ left: "196px", top: homeTop(2) });
    expect(second()).toHaveStyle({ left: "196px", top: homeTop(3) });
  });

  it("drags only the pressed shortcut when it was not selected", () => {
    const { container } = mount();
    const surface = container.firstChild;

    fireEvent.mouseDown(surface, { clientX: 8, clientY: 8, button: 0 });
    fireEvent.mouseMove(window, { clientX: 120, clientY: 130 });
    fireEvent.mouseUp(window);

    // "Show Desktop" is outside that band, so pressing it takes over the
    // selection rather than dragging the other two along with it.
    const outsider = () => shortcut("Show Desktop");
    const before = shortcut(SUBDOMAIN_APPS[0].name).style.top;
    fireEvent.mouseDown(outsider(), { clientX: 40, clientY: 420, button: 0 });
    fireEvent.mouseMove(window, { clientX: 220, clientY: 430 });
    fireEvent.mouseUp(window);

    expect(outsider()).toHaveStyle({ left: "196px" });
    expect(shortcut(SUBDOMAIN_APPS[0].name).style.top).toBe(before);
  });

  it("lets a shortcut be dragged, and drops it on the grid", () => {
    mount();
    const icon = shortcut("Scenes");
    expect(icon).toHaveStyle({ left: "16px", top: homeTop(SCENES_INDEX) });


    const from = GRID_TOP + SCENES_INDEX * CELL_HEIGHT;
    fireEvent.mouseDown(icon, { clientX: 16, clientY: from, button: 0 });
    fireEvent.mouseMove(window, { clientX: 216, clientY: from + 100 });
    fireEvent.mouseUp(window);

    // Dropped between grid cells, so it lands on the nearest one: two columns
    // across, and one row further down than it started.
    expect(icon).toHaveStyle({
      left: "196px",
      top: homeTop(SCENES_INDEX + 1),
    });
  });

  it("does not move a shortcut on a press that never travels", () => {
    const { onLaunch } = mount();
    const icon = shortcut(SUBDOMAIN_APPS[0].name);

    fireEvent.mouseDown(icon, { clientX: 16, clientY: 16, button: 0 });
    fireEvent.mouseMove(window, { clientX: 18, clientY: 17 });
    fireEvent.mouseUp(window);

    expect(icon).toHaveStyle({ left: "16px", top: "16px" });
    // And it is still an ordinary double-click away from opening.
    fireEvent.doubleClick(icon);
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  /**
   * A phone sends no mouse event until the finger has already lifted, so the
   * gesture has to be followed in touch events or nothing can be dragged.
   */
  it("drags a shortcut with a finger, without opening it", () => {
    setViewport(390, 720);
    const { onLaunch } = mount({ mobile: true });
    const icon = shortcut(SUBDOMAIN_APPS[0].name);
    const from = {
      x: parseInt(icon.style.left, 10),
      y: parseInt(icon.style.top, 10),
    };

    // One cell across and one down, which lands on a square rather than
    // between two, so what the drop snaps to is not what is being tested here.
    const to = { x: from.x + CELL_WIDTH, y: from.y + CELL_HEIGHT };
    fireEvent.touchStart(icon, { touches: [{ clientX: from.x, clientY: from.y }] });
    fireEvent.touchMove(window, { touches: [{ clientX: to.x, clientY: to.y }] });
    fireEvent.touchEnd(window, { changedTouches: [{ clientX: to.x, clientY: to.y }] });

    expect(icon).toHaveStyle({ left: `${to.x}px`, top: `${to.y}px` });

    // The finger only moved it. The mouse press a phone sends afterwards must
    // not be taken for a fresh tap and open what was being dragged.
    fireEvent.mouseDown(icon, { clientX: to.x, clientY: to.y, button: 0 });
    fireEvent.mouseUp(icon);
    fireEvent.click(icon, { detail: 1 });
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("still opens on a tap that never travels", () => {
    const { onLaunch } = mount({ mobile: true });
    const icon = shortcut(SUBDOMAIN_APPS[0].name);

    fireEvent.touchStart(icon, { touches: [{ clientX: 20, clientY: 20 }] });
    fireEvent.touchMove(window, { touches: [{ clientX: 21, clientY: 21 }] });
    fireEvent.touchEnd(window, { changedTouches: [{ clientX: 21, clientY: 21 }] });

    // The tap arrives as the mouse sequence the phone echoes it with.
    fireEvent.mouseDown(icon, { clientX: 21, clientY: 21, button: 0 });
    fireEvent.mouseUp(icon);
    fireEvent.click(icon, { detail: 1 });
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it("resizes the folder from its corner gripper", () => {
    mount();
    fireEvent.doubleClick(shortcut("Scenes"));
    const window_ = folderWindow();
    expect(window_).toHaveStyle({ width: "520px", height: "380px" });

    fireEvent.mouseDown(screen.getByTitle("Resize"), {
      clientX: 500,
      clientY: 400,
      button: 0,
    });
    fireEvent.mouseMove(window, { clientX: 560, clientY: 440 });
    fireEvent.mouseUp(window);
    expect(window_).toHaveStyle({ width: "580px", height: "420px" });

    // It will not be dragged smaller than something usable.
    fireEvent.mouseDown(screen.getByTitle("Resize"), {
      clientX: 560,
      clientY: 440,
      button: 0,
    });
    fireEvent.mouseMove(window, { clientX: 0, clientY: 0 });
    fireEvent.mouseUp(window);
    expect(window_).toHaveStyle({ width: "240px", height: "160px" });
  });

  it("carries the page's own theme and hide-UI controls as programs", () => {
    const { onToggleTheme, onToggleVisibleUI } = mount();

    fireEvent.doubleClick(shortcut("Change Theme"));
    expect(onToggleTheme).toHaveBeenCalledTimes(1);

    fireEvent.doubleClick(shortcut("Show Desktop"));
    expect(onToggleVisibleUI).toHaveBeenCalledTimes(1);
  });

  it("offers the theme it would switch to, not the one in force", () => {
    // Dark by default, so the shortcut holds out the sun.
    const { container } = mount();
    const icon = shortcut("Change Theme");
    expect(icon.querySelector("svg")).toHaveAttribute("data-icon", "sun");
    expect(container).toBeTruthy();
  });

  it("names the hide-UI program for whichever way it will go", () => {
    mount({ visibleUI: false });
    expect(shortcut("Show Page")).toBeInTheDocument();
    expect(screen.queryByTitle("Show Desktop")).toBeNull();
  });

  it("wears the site's own mark where Windows had its flag", () => {
    mount();
    const logo = screen
      .getByLabelText("Start")
      .querySelector("[data-site-logo]");
    expect(logo).toHaveAttribute("src", "/logo192.png");
  });

  it("opens apps from the start menu on one click", () => {
    const { onLaunch } = mount();
    expect(screen.queryByRole("menu", { name: "Start menu" })).toBeNull();

    userEvent.click(screen.getByLabelText("Start"));
    const menu = screen.getByRole("menu", { name: "Start menu" });

    userEvent.click(within(menu).getByText(SUBDOMAIN_APPS[0].name));
    expect(onLaunch).toHaveBeenCalledTimes(1);
    // Launching something puts the menu away.
    expect(screen.queryByRole("menu", { name: "Start menu" })).toBeNull();
  });

  it("turns the computer off by leaving for another scene", () => {
    const { onOpenScene } = mount();
    userEvent.click(screen.getByLabelText("Start"));
    userEvent.click(screen.getByText("Turn Off Computer"));

    expect(onOpenScene).toHaveBeenCalledTimes(1);
    // Anywhere but here.
    expect(onOpenScene.mock.calls[0][0]).not.toBe("desktop");
    expect(SCENES).toContain(onOpenScene.mock.calls[0][0]);
  });

  it("stamps the apps with the shortcut arrow, and nothing that stays here", () => {
    mount();
    SUBDOMAIN_APPS.forEach((app) => {
      expect(
        shortcut(app.name).querySelector("[data-shortcut-arrow]")
      ).toBeInTheDocument();
    });
    // A folder and two controls are not shortcuts to anywhere else.
    ["Scenes", "Change Theme", "Show Desktop"].forEach((name) => {
      expect(shortcut(name).querySelector("[data-shortcut-arrow]")).toBeNull();
    });
  });

  it("stamps every scene in the folder with the shortcut arrow", () => {
    mount();
    fireEvent.doubleClick(shortcut("Scenes"));

    const folder = within(folderWindow());
    SCENES.forEach((name) => {
      expect(
        folder.getByTitle(new RegExp(`^${name}`)).querySelector("[data-shortcut-arrow]")
      ).toBeInTheDocument();
    });
  });

  it("closes the start menu on escape", () => {
    mount();
    userEvent.click(screen.getByLabelText("Start"));
    expect(screen.getByRole("menu", { name: "Start menu" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Start menu" })).toBeNull();
  });
});

describe("the balloon tip", () => {
  const balloon = () =>
    screen.queryByText(/change scenes by clicking the title button/i);

  it("stays away until the page asks for the nudge", () => {
    mount();
    expect(balloon()).toBeNull();
  });

  it("delivers the title's nudge as a notification instead", () => {
    mount({ showHint: true });
    expect(balloon()).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Tip");
  });

  it("has nothing to point at once the page is hidden", () => {
    mount({ showHint: true, visibleUI: false });
    expect(balloon()).toBeNull();
  });

  it("wears the theme's accent rather than XP's cream", () => {
    mount({ showHint: true });
    // Dark theme by default: the accent is the face and the primary it sits
    // against is the border and the text.
    expect(screen.getByRole("status")).toHaveStyle({
      background: "#f4e9cd",
      border: "1px solid #031926",
      color: "#031926",
    });
  });

  it("hands the dismissal back to the page that owns the nudge", () => {
    const onDismissHint = jest.fn();
    mount({ showHint: true, onDismissHint });

    userEvent.click(screen.getByLabelText("Close notification"));
    expect(onDismissHint).toHaveBeenCalledTimes(1);
  });
});
