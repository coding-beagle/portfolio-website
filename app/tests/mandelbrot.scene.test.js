import React from "react";
import { render, waitFor, cleanup, fireEvent, screen } from "@testing-library/react";
import Mandelbrot from "../src/components/pages/title/scenes/mandelbrot";

/**
 * The scene is driven with the real worker source running in process (see
 * ./helpers/workerHarness), so these cover the wiring the worker unit tests
 * cannot: orbit hand-off to the pool, redraw on the orbit arriving, and the
 * teardown paths. Reference replies are given a delay, which is what makes a
 * StrictMode remount land mid-request the way it does in a browser.
 */
jest.mock("../src/components/pages/title/utilities/workerFactory", () => {
  const { createInProcessWorker } = require("./helpers/workerHarness");
  return {
    __esModule: true,
    default: function FakeWorkerFactory(workerFunction, libFunctions) {
      return createInProcessWorker(workerFunction, libFunctions, {
        // Real workers take real time; tiles overlapping across draws is what
        // a scroll gesture produces.
        latency: (message) => (message.type === "reference" ? 40 : 2),
      });
    },
  };
});

let fills;

/** jsdom's viewport drives the canvas size; keep it small so a full-resolution
 *  pass is cheap enough to actually run to completion in a test. */
const VIEW_WIDTH = 80;
const VIEW_HEIGHT = 60;

function setViewport(width, height) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
}

beforeEach(() => {
  setViewport(VIEW_WIDTH, VIEW_HEIGHT);
  fills = [];
  HTMLCanvasElement.prototype.getContext = () => ({
    fillStyle: "#000000",
    clearRect: () => { },
    fillRect(x, y, w, h) {
      fills.push({ x, y, w, h, style: this.fillStyle });
    },
  });
});

afterEach(cleanup);

/** The progressive passes end at one canvas pixel per block, covering it all. */
async function expectFullResolutionFrame() {
  await waitFor(
    () => {
      const covered = new Set(
        fills.filter((f) => f.w === 1).map((f) => `${f.x},${f.y}`)
      );
      expect(covered.size).toBe(VIEW_WIDTH * VIEW_HEIGHT);
    },
    { timeout: 15000 }
  );
}

async function expectSomethingDrawn() {
  await waitFor(() => expect(fills.length).toBeGreaterThan(100), {
    timeout: 5000,
  });
  // Structure, not a flat fill: the set and its surroundings differ.
  expect(new Set(fills.map((f) => f.style)).size).toBeGreaterThan(5);
}

test("draws once the reference orbit arrives", async () => {
  render(<Mandelbrot visibleUI={false} />);
  await expectSomethingDrawn();
});

test("draws again after a StrictMode remount", async () => {
  // Regression: the first mount's in-flight orbit request used to stay latched
  // after its worker was terminated, so the second mount never asked for an
  // orbit and nothing was ever drawn.
  render(
    <React.StrictMode>
      <Mandelbrot visibleUI={false} />
    </React.StrictMode>
  );
  await expectSomethingDrawn();
});

test("draws with the control UI mounted", async () => {
  render(<Mandelbrot visibleUI={true} />);
  await expectSomethingDrawn();
});

test("unmounting mid-draw neither throws nor keeps drawing", async () => {
  const { unmount } = render(<Mandelbrot visibleUI={false} />);
  await expectSomethingDrawn();
  unmount();
  const drawnAtUnmount = fills.length;
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(fills.length).toBe(drawnAtUnmount);
});

test("refines to full resolution after a zoom", async () => {
  // The progressive passes step the block size down to 1; a zoom mid-refinement
  // used to leave a draw waiting on a reply that had been handed to a later
  // draw, so the pass never finished and the preview was all you ever saw.
  render(<Mandelbrot visibleUI={false} />);
  await expectSomethingDrawn();

  // A scroll gesture is a burst of events, each kicking off its own draw.
  for (let i = 0; i < 6; i++) {
    window.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -100, clientX: 40, clientY: 30 })
    );
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  await expectFullResolutionFrame();
});

test("refines to full resolution after a pan", async () => {
  render(<Mandelbrot visibleUI={false} />);
  await expectSomethingDrawn();

  // jsdom has no PointerEvent; a MouseEvent under the pointer type names is
  // enough for the listeners the scene installs.
  const canvas = document.querySelector("canvas");
  canvas.dispatchEvent(
    new MouseEvent("pointerdown", { clientX: 40, clientY: 30, bubbles: true })
  );
  for (let i = 1; i <= 6; i++) {
    window.dispatchEvent(
      new MouseEvent("pointermove", {
        clientX: 40 + i * 4,
        clientY: 30 + i * 2,
        bubbles: true,
      })
    );
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  canvas.dispatchEvent(
    new MouseEvent("pointerup", { clientX: 64, clientY: 42, bubbles: true })
  );

  await expectFullResolutionFrame();
});

/** The completed full-resolution frame, as a position -> colour map. */
function frameColours() {
  const byPixel = new Map();
  fills
    .filter((f) => f.w === 1)
    .forEach((f) => byPixel.set(`${f.x},${f.y}`, f.style));
  return byPixel;
}

test("asking for extra iterations does not restyle the frame", async () => {
  // The gradient is spread over a span fixed by the view, not over the
  // iteration budget. Spreading it over the budget meant turning the budget up
  // squeezed every colour towards the low end: the frame kept its shape but
  // lost its gradient, which reads as everything going dark.
  render(<Mandelbrot visibleUI={true} />);
  await expectFullResolutionFrame();
  const before = frameColours();

  const slider = screen
    .getByText("Extra Iterations:")
    .parentElement.querySelector('input[type="range"]');
  fills = [];
  fireEvent.change(slider, { target: { value: "10" } });

  await expectFullResolutionFrame();
  const after = frameColours();

  // Only pixels that needed the extra iterations to escape may move.
  let changed = 0;
  before.forEach((colour, position) => {
    if (after.get(position) !== colour) changed += 1;
  });
  expect(changed).toBeLessThan(before.size * 0.01);

  // And the gradient must not collapse into a handful of bands.
  expect(new Set(after.values()).size).toBeGreaterThanOrEqual(
    new Set(before.values()).size
  );
});
