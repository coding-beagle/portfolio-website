import React from "react";
import {
  render,
  waitFor,
  cleanup,
  fireEvent,
  screen,
} from "@testing-library/react";
import Mandelbrot from "../src/components/pages/title/scenes/mandelbrot";

/**
 * The scene is driven with the real worker source running in process (see
 * ./helpers/workerHarness), so these cover the wiring the worker unit tests
 * cannot: orbit hand-off to the pool, redraw on the orbit arriving, painting,
 * and the teardown paths. Reference replies are given a delay, which is what
 * makes a StrictMode remount land mid-request the way it does in a browser.
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

/** jsdom's viewport drives the canvas size; keep it small so a full-resolution
 *  pass is cheap enough to actually run to completion in a test. */
const VIEW_WIDTH = 80;
const VIEW_HEIGHT = 60;
const PIXELS = VIEW_WIDTH * VIEW_HEIGHT;

let canvas;

/**
 * Stands in for a 2d context. The scene assembles frames in an ImageData
 * buffer and blits dirty strips out of it, so the stub keeps the buffer and
 * records, per pixel, the block size it was last painted at — which is how a
 * test can tell a coarse progressive pass from the final one.
 */
function installCanvasStub() {
  canvas = {
    image: null,
    blits: 0,
    blockSize: new Uint8Array(PIXELS),
  };

  HTMLCanvasElement.prototype.getContext = () => ({
    createImageData: (width, height) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData: (image, _dx, _dy, dirtyX, dirtyY, dirtyWidth, dirtyHeight) => {
      canvas.image = image;
      canvas.blits += 1;
      for (let y = dirtyY; y < dirtyY + dirtyHeight; y++) {
        for (let x = dirtyX; x < dirtyX + dirtyWidth; x++) {
          canvas.blockSize[y * image.width + x] = Math.min(dirtyHeight, 255);
        }
      }
    },
    clearRect: () => { },
  });
}

/** Colours currently in the buffer, as packed pixels, painted ones only. */
function paintedColours() {
  if (!canvas.image) return [];
  const pixels = new Uint32Array(canvas.image.data.buffer);
  const painted = [];
  for (let i = 0; i < PIXELS; i++) {
    if (canvas.blockSize[i] > 0) painted.push(pixels[i]);
  }
  return painted;
}

const paintedCount = () => canvas.blockSize.reduce((n, b) => n + (b > 0), 0);

/** Forget what has been painted, keeping the buffer, to watch the next frame. */
const watchNextFrame = () => canvas.blockSize.fill(0);

async function expectSomethingDrawn() {
  await waitFor(
    () => {
      expect(paintedCount()).toBeGreaterThan(PIXELS / 2);
      // Structure, not a flat fill: the set and its surroundings differ.
      expect(new Set(paintedColours()).size).toBeGreaterThan(5);
    },
    { timeout: 5000 }
  );
}

/** The progressive passes end at one canvas pixel per block, covering it all. */
async function expectFullResolutionFrame() {
  await waitFor(
    () => expect(canvas.blockSize.every((block) => block === 1)).toBe(true),
    { timeout: 15000 }
  );
}

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

test("paints whole strips per reply rather than per pixel", async () => {
  // The frame is assembled in a buffer and blitted a strip at a time; a blit
  // per pixel would put the cost of a frame back on the main thread.
  render(<Mandelbrot visibleUI={false} />);
  await expectFullResolutionFrame();
  expect(canvas.blits).toBeLessThan(PIXELS / 10);
});

test("unmounting mid-draw neither throws nor keeps drawing", async () => {
  const { unmount } = render(<Mandelbrot visibleUI={false} />);
  await expectSomethingDrawn();
  unmount();
  const blitsAtUnmount = canvas.blits;
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(canvas.blits).toBe(blitsAtUnmount);
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

  watchNextFrame();
  await expectFullResolutionFrame();
});

test("refines to full resolution after a pan", async () => {
  render(<Mandelbrot visibleUI={false} />);
  await expectSomethingDrawn();

  // jsdom has no PointerEvent; a MouseEvent under the pointer type names is
  // enough for the listeners the scene installs.
  const element = document.querySelector("canvas");
  element.dispatchEvent(
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
  element.dispatchEvent(
    new MouseEvent("pointerup", { clientX: 64, clientY: 42, bubbles: true })
  );

  watchNextFrame();
  await expectFullResolutionFrame();
});

test("asking for extra iterations does not restyle the frame", async () => {
  // The gradient is spread over a span fixed by the view, not over the
  // iteration budget. Spreading it over the budget meant turning the budget up
  // squeezed every colour towards the low end: the frame kept its shape but
  // lost its gradient, which reads as everything going dark.
  render(<Mandelbrot visibleUI={true} />);
  await expectFullResolutionFrame();
  const before = paintedColours();

  const slider = screen
    .getByText("Extra Iterations:")
    .parentElement.querySelector('input[type="range"]');
  fireEvent.change(slider, { target: { value: "10" } });

  watchNextFrame();
  await expectFullResolutionFrame();
  const after = paintedColours();

  // Only pixels that needed the extra iterations to escape may move.
  const changed = before.filter((colour, i) => after[i] !== colour).length;
  expect(changed).toBeLessThan(PIXELS * 0.01);

  // And the gradient must not collapse into a handful of bands.
  expect(new Set(after).size).toBeGreaterThanOrEqual(new Set(before).size);
});
