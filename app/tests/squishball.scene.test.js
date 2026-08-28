import React from "react";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import SquishBall from "../src/components/pages/title/scenes/squishball";

/**
 * The scene wiring: that the world is driven by the animation loop, that the
 * ball count slider reaches it, and that it stops when the scene goes away.
 * The physics itself is covered in softBody.test.js.
 */

const VIEW_WIDTH = 400;
const VIEW_HEIGHT = 300;

let frames;

/**
 * A 2d context that records the outlines it is asked to draw, one frame per
 * clear. Each ball is drawn as a single closed curve, so a frame's `moveTo`
 * count is the number of balls on screen.
 */
function installCanvasStub() {
  frames = [];
  const openFrame = () => {
    frames.push({ outlines: 0, curves: 0, fills: [] });
    return frames[frames.length - 1];
  };
  openFrame();
  const current = () => frames[frames.length - 1];

  HTMLCanvasElement.prototype.getContext = () => ({
    clearRect: () => openFrame(),
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {
      current().outlines += 1;
    },
    quadraticCurveTo: () => {
      current().curves += 1;
    },
    arc: () => {},
    fill: () => {},
    save: () => {},
    restore: () => {},
    set fillStyle(value) {
      current().fills.push(value);
    },
  });
}

/** The most recent frame that actually drew something. */
const lastDrawnFrame = () => [...frames].reverse().find((frame) => frame.outlines > 0);

const ballCountSlider = () =>
  screen.getByText("Ball Count:").parentElement.querySelector('input[type="range"]');

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: VIEW_WIDTH, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: VIEW_HEIGHT, configurable: true });
  installCanvasStub();
});

afterEach(cleanup);

test("draws every ball, every frame", async () => {
  render(<SquishBall visibleUI={false} />);

  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  const frame = lastDrawnFrame();
  expect(frame.outlines).toBeGreaterThan(1); // more than the one hard-coded ball
  expect(frame.curves).toBe(frame.outlines * 8);
});

test("the ball count slider adds and removes balls", async () => {
  render(<SquishBall visibleUI={true} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  fireEvent.change(ballCountSlider(), { target: { value: "7" } });
  await waitFor(() => expect(lastDrawnFrame().outlines).toBe(7));

  fireEvent.change(ballCountSlider(), { target: { value: "1" } });
  await waitFor(() => expect(lastDrawnFrame().outlines).toBe(1));
});

test("paints the balls in the theme colour", async () => {
  render(<SquishBall visibleUI={false} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  const fills = new Set(lastDrawnFrame().fills);
  expect(fills.size).toBe(1);
  expect([...fills][0]).toMatch(/^#/);
});

test("stops drawing once it is unmounted", async () => {
  const { unmount } = render(<SquishBall visibleUI={false} />);
  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());

  unmount();
  const framesAtUnmount = frames.length;
  await new Promise((resolve) => setTimeout(resolve, 120));

  expect(frames.length).toBe(framesAtUnmount);
});

test("survives a StrictMode remount", async () => {
  render(
    <React.StrictMode>
      <SquishBall visibleUI={false} />
    </React.StrictMode>
  );

  await waitFor(() => expect(lastDrawnFrame()).toBeDefined());
  expect(lastDrawnFrame().outlines).toBeGreaterThan(0);
});
