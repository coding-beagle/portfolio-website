import React from "react";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import WindTunnel from "../src/components/pages/title/scenes/windtunnel";

/**
 * The scene wiring: that the motes are carried by the solver rather than by a
 * hard-coded shove to the right, that the page furniture actually blocks the
 * air, and that the controls reach the running loop. The solver itself is
 * covered in fluid.test.js.
 */

const VIEW_WIDTH = 400;
const VIEW_HEIGHT = 300;

let frames;
let images;
let paints;

/**
 * A 2d context that records the paths it is asked to draw, one frame per
 * clear. A mote is a path of one segment; the wing outline is the one path
 * with many, which is what separates them here.
 */
function installCanvasStub() {
  frames = [];
  images = 0;
  paints = [];
  const openFrame = () => {
    frames.push([]);
    return frames[frames.length - 1];
  };
  openFrame();
  const current = () => frames[frames.length - 1];
  let pen = { x: 0, y: 0 };
  let path = null;

  HTMLCanvasElement.prototype.getContext = () => ({
    clearRect: () => {
      openFrame();
      path = null;
    },
    beginPath: () => {
      path = [];
      current().push(path);
    },
    closePath: () => {},
    moveTo: (x, y) => {
      pen = { x, y };
    },
    lineTo: (x, y) => {
      if (path) path.push({ from: pen, to: { x, y } });
      pen = { x, y };
    },
    stroke: () => {},
    fill: () => {},
    fillRect: () => {},
    save: () => {},
    restore: () => {},
    drawImage: () => {
      images += 1;
    },
    createImageData: (width, height) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    }),
    // The scene paints into one reused buffer, so each frame is copied out.
    putImageData: (image) => {
      paints.push(Uint8ClampedArray.from(image.data));
    },
  });
}

/**
 * One of the page's bodies for the airflow to break around. The scene sizes a
 * body from the layout box and takes its place from the rect, so both are
 * stubbed here.
 */
function installBody(id, rect) {
  const element = document.createElement("div");
  element.id = id;
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  element.getBoundingClientRect = () => ({ ...rect, width, height });
  Object.defineProperty(element, "offsetWidth", { value: width });
  Object.defineProperty(element, "offsetHeight", { value: height });
  document.body.appendChild(element);
  return element;
}

const installTitle = (rect) => installBody("title", rect);

/** The whole wing: the title with the scene label and icon row beneath it. */
const WING_RECTS = {
  title: { left: 120, right: 320, top: 100, bottom: 160 },
  sceneLabel: { left: 160, right: 280, top: 180, bottom: 200 },
  linkIcons: { left: 150, right: 290, top: 220, bottom: 250 },
};

/** The last value the scene set for one CSS property on an element. */
const lastSet = (calls, property) => {
  const call = [...calls].reverse().find(([action, name]) => action === "set" && name === property);
  return call ? call[2] : null;
};

const parseOrigin = (value) => {
  const [x, y] = value.split(" ").map((part) => Number.parseFloat(part));
  return { x, y };
};

const TITLE_RECT = { left: 120, right: 220, top: 100, bottom: 200 };

/**
 * Record what the scene does to an element's inline style. `rotate` is a
 * standalone CSS property that jsdom's style engine does not implement, so
 * what it is asked to set is what can be checked here.
 */
function watchStyle(element) {
  const calls = [];
  const style = element.style;
  const setProperty = style.setProperty.bind(style);
  const removeProperty = style.removeProperty.bind(style);

  style.setProperty = (name, value) => {
    calls.push(["set", name, value]);
    return setProperty(name, value);
  };
  style.removeProperty = (name) => {
    calls.push(["remove", name]);
    return removeProperty(name);
  };

  return calls;
}

/** Every one-segment path in a frame: one per mote. */
const motesIn = (frame) => frame.filter((path) => path.length === 1).map(([segment]) => segment);

/** The many-segment paths: the wing outline. */
const outlinesIn = (frame) => frame.filter((path) => path.length > 1);

const lastDrawnFrame = () => [...frames].reverse().find((frame) => motesIn(frame).length > 0);

const lastMotes = () => motesIn(lastDrawnFrame());

const sliderFor = (label) =>
  screen.getByText(label).parentElement.querySelector('input[type="range"]');

/**
 * Let the loop run on, so a control change has reached the frames measured.
 * A solver frame is dear enough that the default one-second budget does not
 * cover many of them, and dearer still when the suites run in parallel — hence
 * the budget the longer tests below are given too.
 */
const FRAME_BUDGET = 20000;

const afterFrames = async (count) => {
  const start = frames.length;
  await waitFor(() => expect(frames.length).toBeGreaterThan(start + count), {
    timeout: FRAME_BUDGET,
  });
};

const travelOf = ({ from, to }) => Math.hypot(to.x - from.x, to.y - from.y);

/**
 * Motes are released with a jitter, so how many are in any one patch of air on
 * any one frame wobbles. Summing over a run of frames is steady enough to
 * compare two states by.
 */
const countOverFrames = async (count, predicate) => {
  let total = 0;
  for (let frame = 0; frame < count; frame++) {
    await afterFrames(0);
    total += lastMotes().filter(predicate).length;
  }
  return total;
};

const medianTravel = () => {
  const travels = lastMotes().map(travelOf).sort((a, b) => a - b);
  return travels[Math.floor(travels.length / 2)];
};

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: VIEW_WIDTH, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: VIEW_HEIGHT, configurable: true });
  installCanvasStub();
});

afterEach(() => {
  cleanup();
  ["title", "sceneLabel", "linkIcons"].forEach((id) => {
    document.getElementById(id)?.remove();
  });
});

test("draws one streak per mote, every frame", async () => {
  render(<WindTunnel visibleUI={true} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  fireEvent.change(sliderFor("Smoke Motes:"), { target: { value: "300" } });
  await waitFor(() => expect(lastMotes().length).toBe(300));

  fireEvent.change(sliderFor("Smoke Motes:"), { target: { value: "120" } });
  await waitFor(() => expect(lastMotes().length).toBe(120));
});

test("the air blows downstream", async () => {
  render(<WindTunnel visibleUI={false} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());
  await afterFrames(30);

  const motes = lastMotes();
  const drift = motes.reduce((total, { from, to }) => total + (to.x - from.x), 0);
  expect(drift / motes.length).toBeGreaterThan(0);

  // Streaks lie along the flow, so in an undisturbed tunnel they are near
  // enough horizontal.
  const rise = motes.reduce((total, { from, to }) => total + Math.abs(to.y - from.y), 0);
  const run = motes.reduce((total, { from, to }) => total + Math.abs(to.x - from.x), 0);
  expect(rise).toBeLessThan(run);
}, FRAME_BUDGET);

test("the wind speed slider sets how far the air moves in a frame", async () => {
  render(<WindTunnel visibleUI={true} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  fireEvent.change(sliderFor("Wind Speed:"), { target: { value: "100" } });
  await afterFrames(20);
  const gentle = medianTravel();
  expect(gentle).toBeGreaterThan(0);

  fireEvent.change(sliderFor("Wind Speed:"), { target: { value: "700" } });
  await afterFrames(20);
  expect(medianTravel()).toBeGreaterThan(gentle * 2);
}, FRAME_BUDGET);

test("the air goes around the title rather than through it", async () => {
  installTitle(TITLE_RECT);
  render(<WindTunnel visibleUI={true} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());
  await afterFrames(60);

  const inside = ({ to }) =>
    to.x > TITLE_RECT.left &&
    to.x < TITLE_RECT.right &&
    to.y > TITLE_RECT.top &&
    to.y < TITLE_RECT.bottom;

  // The same sized patch of clear air downstream, as a control: the title is
  // not merely in a quiet corner of the tunnel.
  const control = ({ to }) =>
    to.x > TITLE_RECT.left + 160 &&
    to.x < TITLE_RECT.right + 160 &&
    to.y > TITLE_RECT.top &&
    to.y < TITLE_RECT.bottom;

  const motes = lastMotes();
  expect(motes.filter(control).length).toBeGreaterThan(5);
  expect(motes.filter(inside).length).toBeLessThan(
    motes.filter(control).length / 4
  );
}, FRAME_BUDGET);

test("pitching the title tips its leading edge into the wind", async () => {
  installTitle(TITLE_RECT);
  render(<WindTunnel visibleUI={true} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  // Just above the upstream half of the title: open air when the leading edge
  // drops, and shut when it lifts.
  const aboveLeadingEdge = ({ to }) =>
    to.x > TITLE_RECT.left + 5 &&
    to.x < (TITLE_RECT.left + TITLE_RECT.right) / 2 &&
    to.y > TITLE_RECT.top - 25 &&
    to.y < TITLE_RECT.top - 2;

  const pitch = sliderFor("Angle Of Attack:");

  fireEvent.change(pitch, { target: { value: "-20" } });
  await afterFrames(80);
  const noseDown = await countOverFrames(10, aboveLeadingEdge);
  expect(noseDown).toBeGreaterThan(40);

  fireEvent.change(pitch, { target: { value: "20" } });
  await afterFrames(80);
  expect(await countOverFrames(10, aboveLeadingEdge)).toBeLessThan(noseDown / 3);
}, FRAME_BUDGET);

test("the three bodies pitch about one point, a quarter along the wing", async () => {
  const bodies = Object.entries(WING_RECTS).map(([id, rect]) => {
    const element = installBody(id, rect);
    return { id, rect, calls: watchStyle(element) };
  });

  render(<WindTunnel visibleUI={true} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());
  await afterFrames(3);

  // A transform origin is measured from the element's own corner, so the
  // shared point is a different pair of numbers on each body. Putting each one
  // back where it came from should land on the same place on the page.
  const pivots = bodies.map(({ rect, calls }) => {
    const origin = parseOrigin(lastSet(calls, "transform-origin"));
    return { x: origin.x + rect.left, y: origin.y + rect.top };
  });

  pivots.forEach((point) => {
    expect(point.x).toBeCloseTo(pivots[0].x, 1);
    expect(point.y).toBeCloseTo(pivots[0].y, 1);
  });

  // And that place is the quarter chord of the three together: a quarter of
  // the way back from the leading edge, halfway down.
  const rects = Object.values(WING_RECTS);
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));

  expect(pivots[0].x).toBeCloseTo(left + (right - left) / 4, 1);
  expect(pivots[0].y).toBeCloseTo((top + bottom) / 2, 1);
}, FRAME_BUDGET);

test("the whole wing turns together, and is left upright afterwards", async () => {
  const bodies = Object.entries(WING_RECTS).map(([id, rect]) => {
    const element = installBody(id, rect);
    return { id, rect, calls: watchStyle(element) };
  });

  const { unmount } = render(<WindTunnel visibleUI={true} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  fireEvent.change(sliderFor("Angle Of Attack:"), { target: { value: "-15" } });
  await afterFrames(3);

  // One angle across all three: they are one body, not three that each happen
  // to be tilted.
  bodies.forEach(({ calls }) => {
    expect(lastSet(calls, "rotate")).toBe("-15deg");
  });

  unmount();
  bodies.forEach(({ calls }) => {
    expect(calls).toContainEqual(["remove", "rotate"]);
    expect(calls).toContainEqual(["remove", "transform-origin"]);
  });
}, FRAME_BUDGET);

test("the flow field is picked from a row, and the one that is on is lit", async () => {
  render(<WindTunnel visibleUI={true} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  const button = (name) => screen.getByRole("button", { name });
  // The selected one is painted in the theme; the rest are dimmed.
  const isLit = (name) => Number(button(name).style.opacity) === 1;

  // Nothing but the motes to start with, and "Off" is the one lit.
  await afterFrames(2);
  expect(images).toBe(0);
  expect(isLit("Off")).toBe(true);
  ["Smoke", "Speed", "Pressure"].forEach((name) =>
    expect(isLit(name)).toBe(false)
  );

  for (const name of ["Smoke", "Speed", "Pressure"]) {
    fireEvent.click(button(name));
    await waitFor(() => expect(isLit(name)).toBe(true));
    expect(isLit("Off")).toBe(false);

    const painted = images;
    await afterFrames(2);
    expect(images).toBeGreaterThan(painted);
  }

  // Any of them can be gone back on directly, without cycling through.
  fireEvent.click(button("Off"));
  await waitFor(() => expect(isLit("Off")).toBe(true));
  const painted = images;
  await afterFrames(2);
  expect(images).toBe(painted);
}, FRAME_BUDGET);

/** Overall brightness of a painted field. */
const brightnessOf = (paint) => {
  let total = 0;
  for (let index = 0; index < paint.length; index += 4) {
    total += (paint[index] + paint[index + 1] + paint[index + 2]) / 3;
  }
  return total / (paint.length / 4);
};

/** How much of the picture is structure rather than one flat wash. */
const contrastOf = (paint) => {
  const mean = brightnessOf(paint);
  let total = 0;
  for (let index = 0; index < paint.length; index += 4) {
    const shade = (paint[index] + paint[index + 1] + paint[index + 2]) / 3;
    total += (shade - mean) ** 2;
  }
  return Math.sqrt(total / (paint.length / 4));
};

/**
 * The whole field lifting and dropping between frames is what reads as a
 * strobe. A probe moving through the air changes the picture too, but locally —
 * it barely moves the average.
 */
const medianBrightnessJump = () => {
  const jumps = [];
  for (let index = 1; index < paints.length; index++) {
    jumps.push(
      Math.abs(brightnessOf(paints[index]) - brightnessOf(paints[index - 1]))
    );
  }
  jumps.sort((a, b) => a - b);
  return jumps[Math.floor(jumps.length / 2)];
};

/** Drag a probe across the tunnel, recording what gets painted. */
const dragProbeAcross = async (steps) => {
  fireEvent(
    window,
    new MouseEvent("pointerdown", { clientX: 80, clientY: 150, bubbles: true })
  );

  paints.length = 0;
  for (let step = 0; step < steps; step++) {
    fireEvent(
      window,
      new MouseEvent("pointermove", {
        clientX: 80 + step * 8,
        clientY: 150 + Math.sin(step / 3) * 40,
        bubbles: true,
      })
    );
    await afterFrames(0);
  }

  fireEvent(
    window,
    new MouseEvent("pointerup", { clientX: 320, clientY: 150, bubbles: true })
  );
};

test("the pressure view holds still while a probe is dragged through it", async () => {
  installTitle(TITLE_RECT);
  render(<WindTunnel visibleUI={true} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  fireEvent.click(screen.getByRole("button", { name: "Pressure" }));
  await afterFrames(50);

  // Left alone it should be perfectly still.
  paints.length = 0;
  await afterFrames(10);
  expect(medianBrightnessJump()).toBeLessThan(0.5);

  // And dragging a probe through it — which used to set the whole field
  // strobing, since the cells under the probe ran far past anything the open
  // air did and the picture was scaled to them — should not lift and drop it
  // either.
  await dragProbeAcross(30);
  expect(paints.length).toBeGreaterThan(20);
  expect(medianBrightnessJump()).toBeLessThan(6);

  // Holding still is easy if everything is washed out to one flat tone, so
  // that has to be ruled out.
  expect(contrastOf(paints[paints.length - 1])).toBeGreaterThan(20);
}, FRAME_BUDGET);

test("the grid detail slider rebuilds the tunnel without stopping it", async () => {
  render(<WindTunnel visibleUI={true} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  fireEvent.change(sliderFor("Grid Detail:"), { target: { value: "0" } });
  await afterFrames(5);
  expect(lastMotes().length).toBeGreaterThan(0);

  fireEvent.change(sliderFor("Grid Detail:"), { target: { value: "100" } });
  await afterFrames(5);
  expect(lastMotes().length).toBeGreaterThan(0);
  expect(
    lastMotes().every(({ to }) => Number.isFinite(to.x) && Number.isFinite(to.y))
  ).toBe(true);
});

test("stops drawing once it is unmounted", async () => {
  const { unmount } = render(<WindTunnel visibleUI={false} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  unmount();
  const framesAtUnmount = frames.length;
  await new Promise((resolve) => setTimeout(resolve, 120));

  expect(frames.length).toBe(framesAtUnmount);
});

test("survives a StrictMode remount", async () => {
  render(
    <React.StrictMode>
      <WindTunnel visibleUI={false} />
    </React.StrictMode>
  );

  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());
  expect(lastMotes().length).toBeGreaterThan(0);
});
