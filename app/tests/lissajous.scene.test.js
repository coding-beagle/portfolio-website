import React from "react";
import {
  render,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import Lissajous from "../src/components/pages/title/scenes/lissajous";

/**
 * The scene wiring: that the figure is driven by the animation loop, that the
 * mode and grid controls reach it, and that it stops when the scene goes away.
 */

const VIEW_WIDTH = 400;
const VIEW_HEIGHT = 300;

let frames;

/**
 * A 2d context that records the paths it is asked to stroke, one frame per
 * clear. Each figure strokes twice — the whole curve, then the tracer — and
 * fills one dot at its head, so a frame's `fills` count is the figure count.
 */
function installCanvasStub() {
  frames = [];
  const openFrame = () => {
    frames.push({ strokes: 0, fills: 0 });
    return frames[frames.length - 1];
  };
  openFrame();
  const current = () => frames[frames.length - 1];

  HTMLCanvasElement.prototype.getContext = () => ({
    clearRect: () => openFrame(),
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    stroke: () => {
      current().strokes += 1;
    },
    fill: () => {
      current().fills += 1;
    },
    save: () => {},
    restore: () => {},
  });
}

/** The most recent frame that actually drew something. */
const lastDrawnFrame = () =>
  [...frames].reverse().find((frame) => frame.fills > 0);

const sliderFor = (label) =>
  screen.getByText(label).parentElement.querySelector('input[type="range"]');

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    value: VIEW_WIDTH,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: VIEW_HEIGHT,
    configurable: true,
  });
  installCanvasStub();
});

afterEach(cleanup);

test("draws the figure, every frame", async () => {
  render(<Lissajous visibleUI={false} />);

  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  const frame = lastDrawnFrame();
  expect(frame.fills).toBe(1); // the single figure the scene opens on
  expect(frame.strokes).toBe(2); // curve plus tracer
});

test("table mode puts the whole family on screen", async () => {
  render(<Lissajous visibleUI={true} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  fireEvent.click(screen.getByText("Table"));

  await waitFor(() => expect(lastDrawnFrame().fills).toBe(16)); // the 4x4 default
  expect(lastDrawnFrame().strokes).toBe(32);
});

test("the grid size slider rebuilds the table", async () => {
  render(<Lissajous visibleUI={true} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());
  fireEvent.click(screen.getByText("Table"));

  fireEvent.change(sliderFor("Grid Size:"), { target: { value: "6" } });
  await waitFor(() => expect(lastDrawnFrame().fills).toBe(36));

  fireEvent.change(sliderFor("Grid Size:"), { target: { value: "2" } });
  await waitFor(() => expect(lastDrawnFrame().fills).toBe(4));
});

test("each mode shows only its own controls", async () => {
  render(<Lissajous visibleUI={true} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  expect(screen.queryByText("Grid Size:")).toBeNull();
  expect(sliderFor("X Frequency:")).toBeDefined();
  expect(sliderFor("Y Frequency:")).toBeDefined();

  fireEvent.click(screen.getByText("Table"));

  await waitFor(() => expect(lastDrawnFrame().fills).toBe(16));
  expect(screen.queryByText("X Frequency:")).toBeNull();
  expect(sliderFor("Grid Size:")).toBeDefined();

  fireEvent.click(screen.getByText("Single"));
  await waitFor(() => expect(lastDrawnFrame().fills).toBe(1));
});

test("stops drawing once it is unmounted", async () => {
  const { unmount } = render(<Lissajous visibleUI={false} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  unmount();
  const framesAtUnmount = frames.length;
  await new Promise((resolve) => setTimeout(resolve, 120));

  expect(frames.length).toBe(framesAtUnmount);
});

test("survives a StrictMode remount", async () => {
  render(
    <React.StrictMode>
      <Lissajous visibleUI={false} />
    </React.StrictMode>
  );

  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());
  expect(lastDrawnFrame().fills).toBeGreaterThan(0);
});
