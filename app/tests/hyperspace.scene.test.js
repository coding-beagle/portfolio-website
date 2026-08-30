import React from "react";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import Hyperspace from "../src/components/pages/title/scenes/hyperspace";

/**
 * The scene wiring: that every star is drawn as a streak radiating out of the
 * vanishing point, that the sliders reach the running loop, and that the loop
 * stops when the scene goes away.
 */

const VIEW_WIDTH = 400;
const VIEW_HEIGHT = 300;

let frames;

/**
 * A 2d context that records the line segments it is asked to stroke, one frame
 * per clear. Each star is one moveTo/lineTo pair, so a frame's segment count is
 * the number of stars on screen.
 */
function installCanvasStub() {
  frames = [];
  const openFrame = () => {
    frames.push({ segments: [], strokes: [] });
    return frames[frames.length - 1];
  };
  openFrame();
  const current = () => frames[frames.length - 1];
  let pen = { x: 0, y: 0 };

  HTMLCanvasElement.prototype.getContext = () => ({
    clearRect: () => openFrame(),
    beginPath: () => {},
    closePath: () => {},
    moveTo: (x, y) => {
      pen = { x, y };
    },
    lineTo: (x, y) => {
      current().segments.push({ from: pen, to: { x, y } });
    },
    stroke: () => {},
    fill: () => {},
    fillRect: () => {},
    save: () => {},
    restore: () => {},
    createRadialGradient: () => ({ addColorStop: () => {} }),
    set strokeStyle(value) {
      current().strokes.push(value);
    },
  });
}

/** The most recent frame that actually drew something. */
const lastDrawnFrame = () => [...frames].reverse().find((frame) => frame.segments.length > 0);

const sliderFor = (label) =>
  screen.getByText(label).parentElement.querySelector('input[type="range"]');

const lengthOf = ({ from, to }) => Math.hypot(to.x - from.x, to.y - from.y);

/** Let the loop run on, so a slider change has reached the frames being measured. */
const afterFrames = async (count) => {
  const start = frames.length;
  await waitFor(() => expect(frames.length).toBeGreaterThan(start + count));
};

/** Steadier than the longest streak, which swings about with the nearest star. */
const medianStreak = () => {
  const lengths = lastDrawnFrame().segments.map(lengthOf).sort((a, b) => a - b);
  return lengths[Math.floor(lengths.length / 2)];
};

const distanceFromCentre = ({ x, y }) =>
  Math.hypot(x - VIEW_WIDTH / 2, y - VIEW_HEIGHT / 2);

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: VIEW_WIDTH, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: VIEW_HEIGHT, configurable: true });
  installCanvasStub();
});

afterEach(cleanup);

test("draws one streak per star, every frame", async () => {
  render(<Hyperspace visibleUI={true} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  fireEvent.change(sliderFor("Star Count:"), { target: { value: "120" } });
  await waitFor(() => expect(lastDrawnFrame().segments.length).toBe(120));

  fireEvent.change(sliderFor("Star Count:"), { target: { value: "50" } });
  await waitFor(() => expect(lastDrawnFrame().segments.length).toBe(50));
});

test("every streak trails behind its star, pointing back at the vanishing point", async () => {
  render(<Hyperspace visibleUI={false} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  lastDrawnFrame().segments.forEach(({ from, to }) => {
    expect(Number.isFinite(from.x) && Number.isFinite(from.y)).toBe(true);
    expect(Number.isFinite(to.x) && Number.isFinite(to.y)).toBe(true);

    // The head of the streak is always further out than its tail: the star is
    // travelling away from the vanishing point, towards the viewer.
    expect(distanceFromCentre(to)).toBeGreaterThanOrEqual(distanceFromCentre(from));

    // Tail, head and vanishing point are colinear — the streak lies along the
    // ray the star is flying down.
    const cross =
      (from.x - VIEW_WIDTH / 2) * (to.y - VIEW_HEIGHT / 2) -
      (from.y - VIEW_HEIGHT / 2) * (to.x - VIEW_WIDTH / 2);
    expect(Math.abs(cross)).toBeLessThan(1e-6);
  });
});

test("the warp speed slider stretches the streaks", async () => {
  render(<Hyperspace visibleUI={true} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  fireEvent.change(sliderFor("Warp Speed:"), { target: { value: "10" } });
  await afterFrames(2);
  const slow = medianStreak();
  expect(slow).toBeGreaterThan(0);

  fireEvent.change(sliderFor("Warp Speed:"), { target: { value: "200" } });
  await afterFrames(2);
  expect(medianStreak()).toBeGreaterThan(slow * 3);
});

test("stars are streaked and drawn individually, not as one combed field", async () => {
  render(<Hyperspace visibleUI={false} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  // Trail length and thickness belong to the star, so two stars at the same
  // depth are not the same streak. Comparing streaks against the distance
  // their star has travelled from the vanishing point takes the depth out.
  const shapes = lastDrawnFrame().segments.map(
    (segment) => lengthOf(segment) / Math.max(distanceFromCentre(segment.to), 1)
  );
  const spread = Math.max(...shapes) / Math.min(...shapes.filter((s) => s > 0));
  expect(spread).toBeGreaterThan(2);
});

test("the doppler slider colours the tunnel by depth", async () => {
  render(<Hyperspace visibleUI={true} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  fireEvent.change(sliderFor("Doppler Shift:"), { target: { value: "0" } });
  await afterFrames(2);
  const plain = new Set(lastDrawnFrame().strokes).size;

  // Every shade of starlight now runs through a blue-to-red ramp as its star
  // comes down the tunnel, so the field uses far more colours than it has
  // shades of star.
  fireEvent.change(sliderFor("Doppler Shift:"), { target: { value: "100" } });
  await afterFrames(2);
  expect(new Set(lastDrawnFrame().strokes).size).toBeGreaterThan(plain * 2);
});

test("the field opens mid-flight rather than bunched at the far plane", async () => {
  render(<Hyperspace visibleUI={false} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  // The very first frame is already moving at the speed it settles at, and
  // already covers the screen — a fifth of the field would be a suspiciously
  // sparse opening.
  const opening = medianStreak();
  expect(opening).toBeGreaterThan(0);

  const onScreen = lastDrawnFrame().segments.filter(
    ({ to }) => to.x >= 0 && to.x <= VIEW_WIDTH && to.y >= 0 && to.y <= VIEW_HEIGHT
  );
  expect(onScreen.length).toBeGreaterThan(lastDrawnFrame().segments.length / 5);

  await waitFor(() => expect(frames.length).toBeGreaterThan(20));
  expect(medianStreak()).toBeGreaterThan(opening / 2);
});

test("punching it accelerates the field", async () => {
  render(<Hyperspace visibleUI={true} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  const cruising = medianStreak();
  fireEvent.click(screen.getByText("Punch it!"));

  await waitFor(() => expect(medianStreak()).toBeGreaterThan(cruising * 2));
});

test("holding the pointer opens the throttle, releasing it eases off", async () => {
  render(<Hyperspace visibleUI={false} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  const cruising = medianStreak();

  fireEvent.pointerDown(window, { clientX: VIEW_WIDTH / 2, clientY: VIEW_HEIGHT / 2 });
  await waitFor(() => expect(medianStreak()).toBeGreaterThan(cruising * 1.5));

  fireEvent.pointerUp(window, { clientX: VIEW_WIDTH / 2, clientY: VIEW_HEIGHT / 2 });
  await waitFor(() => expect(medianStreak()).toBeLessThan(cruising * 1.5));
});

test("paints the stars in theme colours", async () => {
  render(<Hyperspace visibleUI={false} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  const strokes = new Set(lastDrawnFrame().strokes);
  expect(strokes.size).toBeGreaterThan(0);
  strokes.forEach((stroke) => expect(stroke).toMatch(/^#[0-9a-f]{6}$/i));
});

test("stops drawing once it is unmounted", async () => {
  const { unmount } = render(<Hyperspace visibleUI={false} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  unmount();
  const framesAtUnmount = frames.length;
  await new Promise((resolve) => setTimeout(resolve, 120));

  expect(frames.length).toBe(framesAtUnmount);
});

test("survives a StrictMode remount", async () => {
  render(
    <React.StrictMode>
      <Hyperspace visibleUI={false} />
    </React.StrictMode>
  );

  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());
  expect(lastDrawnFrame().segments.length).toBeGreaterThan(0);
});
