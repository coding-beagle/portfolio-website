import React from "react";
import { render, cleanup, fireEvent, screen, waitFor, act } from "@testing-library/react";
import Hexapod from "../src/components/pages/title/scenes/hexapod";

/**
 * The hearts the hexapods give back when you pet them.
 *
 * Two things were wrong and are pinned down here: the heart took its width
 * from the canvas width and its height from the canvas height, so it stretched
 * with the shape of the window; and it could only appear on the frame the walk
 * cycle rolled over, which tied how soon you saw one to the Walking Speed
 * slider.
 */

let frames;

/**
 * A 2d context that records paths, one frame per clear. The hexapods are drawn
 * with `lineTo` and the hearts with `bezierCurveTo`, which is what separates
 * them here.
 */
function installCanvasStub() {
  frames = [];
  const openFrame = () => {
    frames.push([]);
    return frames[frames.length - 1];
  };
  openFrame();
  const current = () => frames[frames.length - 1];
  let path = null;

  const record = (x, y) => {
    if (path) path.points.push({ x, y });
  };

  HTMLCanvasElement.prototype.getContext = () => ({
    clearRect: () => {
      openFrame();
      path = null;
    },
    beginPath: () => {
      path = { curved: false, points: [] };
      current().push(path);
    },
    closePath: () => {},
    moveTo: record,
    lineTo: record,
    bezierCurveTo: (cp1x, cp1y, cp2x, cp2y, x, y) => {
      if (!path) return;
      path.curved = true;
      // The lobes bulge out to the control points, so they are part of the
      // shape's extent, not just its construction.
      record(cp1x, cp1y);
      record(cp2x, cp2y);
      record(x, y);
    },
    stroke: () => {},
    fill: () => {},
    save: () => {},
    restore: () => {},
    arc: () => {},
  });
}

const setViewport = (width, height) => {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
};

const lastFrame = () => [...frames].reverse().find((frame) => frame.length > 0) ?? [];

const heartsIn = (frame) => frame.filter((path) => path.curved);

const boxOf = (path) => {
  const xs = path.points.map((point) => point.x);
  const ys = path.points.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return {
    width: right - left,
    height: bottom - top,
    x: (left + right) / 2,
    y: (top + bottom) / 2,
  };
};

/**
 * jsdom has no PointerEvent, so `fireEvent.pointerDown` dispatches an event
 * with no coordinates on it — and where the pointer is, is the whole point
 * here. A MouseEvent under the pointer event's name carries them.
 */
const pointerEvent = (type, { x, y }) =>
  fireEvent(window, new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));

/** Somewhere a hexapod is standing, so the petting lands. */
const onAHexapod = () => {
  const leg = lastFrame().find((path) => !path.curved && path.points.length > 1);
  return leg.points[0];
};

/**
 * Frames come from requestAnimationFrame, so a long wait is real seconds — and
 * they stretch further when the suites run in parallel. Both this and the
 * tests that lean on it are given room accordingly.
 */
const FRAME_BUDGET = 20000;

const advance = async (count) => {
  const start = frames.length;
  await waitFor(() => expect(frames.length).toBeGreaterThan(start + count), {
    timeout: FRAME_BUDGET,
  });
};

/** Hold the pointer down over a hexapod for `frames` frames. */
const petFor = async (count) => {
  const spot = onAHexapod();
  pointerEvent("pointermove", spot);
  pointerEvent("pointerdown", spot);
  await advance(count);
  return spot;
};

const releasePointer = (spot) => pointerEvent("pointerup", spot);

/**
 * Let go and let the last heart finish growing, so what is measured is a
 * settled heart rather than one caught mid-pop.
 */
const settledHeartBox = async (spot) => {
  releasePointer(spot);
  await advance(16);
  return boxOf(heartsIn(lastFrame())[0]);
};

const sliderFor = (label) =>
  screen.getByText(label).parentElement.querySelector('input[type="range"]');

beforeEach(() => {
  setViewport(900, 600);
  installCanvasStub();
});

afterEach(cleanup);

test("a heart is as wide as it is tall, whatever shape the window is", async () => {
  // The same viewport laid on its side. The old pair of divisors made the
  // first heart a squat blob and the second a needle.
  const boxes = [];

  for (const [width, height] of [[1600, 700], [700, 1600]]) {
    setViewport(width, height);
    installCanvasStub();

    render(<Hexapod visibleUI={true} />);
    await waitFor(() => expect(lastFrame().length).toBeGreaterThan(0));

    const spot = await petFor(4);
    const box = await settledHeartBox(spot);

    expect(box.width).toBeGreaterThan(0);
    expect(Math.abs(box.width - box.height)).toBeLessThan(1);
    // Sized off the shorter side, so it is never a sliver of the long one.
    expect(box.width).toBeCloseTo(700 / 25, 0);

    boxes.push(box);
    cleanup();
  }

  expect(boxes[0].width).toBeCloseTo(boxes[1].width, 5);
}, FRAME_BUDGET);

test("the heart sits on the pointer rather than hanging below it", async () => {
  render(<Hexapod visibleUI={true} />);
  await waitFor(() => expect(lastFrame().length).toBeGreaterThan(0));

  const spot = await petFor(4);
  const box = boxOf(heartsIn(lastFrame())[0]);

  expect(Math.abs(box.x - spot.x)).toBeLessThan(2);
  expect(Math.abs(box.y - spot.y)).toBeLessThan(2);
});

test("a heart grows into place instead of appearing whole", async () => {
  render(<Hexapod visibleUI={true} />);
  await waitFor(() => expect(lastFrame().length).toBeGreaterThan(0));

  const spot = await petFor(2);
  const early = boxOf(heartsIn(lastFrame())[0]).width;
  releasePointer(spot);

  await advance(20);
  const settled = boxOf(heartsIn(lastFrame())[0]).width;

  expect(early).toBeGreaterThan(0);
  expect(settled).toBeGreaterThan(early);
  expect(settled).toBeCloseTo(600 / 25, 0);
});

test("a heart appears as soon as you press, at any walking speed", async () => {
  /*
   * The first press always landed, because the gate started open. What it cost
   * was every press after it: the gate only reopened when the walk cycle
   * rolled over, so the next heart was up to a full cycle away — five seconds
   * at the slow end of the slider.
   *
   * Changing the slider restarts the cycle, so the presses below are a known
   * short way into one and nowhere near the rollover at either end.
   */
  for (const speed of ["45", "330"]) {
    installCanvasStub();
    render(<Hexapod visibleUI={true} />);
    await waitFor(() => expect(lastFrame().length).toBeGreaterThan(0));

    fireEvent.change(sliderFor("Walking Speed:"), { target: { value: speed } });
    await advance(2);

    const spot = await petFor(3);
    expect(heartsIn(lastFrame()).length).toBe(1);

    releasePointer(spot);
    await advance(5);

    pointerEvent("pointerdown", spot);
    await advance(3);
    expect(heartsIn(lastFrame()).length).toBe(2);

    cleanup();
  }
}, FRAME_BUDGET);

test("holding drops hearts at its own steady rate, not the gait's", async () => {
  const counts = [];

  for (const speed of ["45", "330"]) {
    installCanvasStub();
    render(<Hexapod visibleUI={true} />);
    await waitFor(() => expect(lastFrame().length).toBeGreaterThan(0));

    fireEvent.change(sliderFor("Walking Speed:"), { target: { value: speed } });
    await advance(2);

    await petFor(70);
    counts.push(heartsIn(lastFrame()).length);

    cleanup();
  }

  // Roughly one every fifteen frames, and the same at both ends of the slider.
  counts.forEach((count) => expect(count).toBeGreaterThan(2));
  expect(Math.abs(counts[0] - counts[1])).toBeLessThanOrEqual(1);
}, FRAME_BUDGET);

test("pressing again drops another heart without waiting out the cooldown", async () => {
  render(<Hexapod visibleUI={true} />);
  await waitFor(() => expect(lastFrame().length).toBeGreaterThan(0));

  const spot = await petFor(2);
  expect(heartsIn(lastFrame()).length).toBe(1);

  releasePointer(spot);
  await advance(1);

  pointerEvent("pointerdown", spot);
  await advance(2);
  expect(heartsIn(lastFrame()).length).toBe(2);
});

test("the heart resizes with the window", async () => {
  render(<Hexapod visibleUI={true} />);
  await waitFor(() => expect(lastFrame().length).toBeGreaterThan(0));

  const spot = await petFor(4);
  expect((await settledHeartBox(spot)).width).toBeCloseTo(600 / 25, 0);

  setViewport(1000, 1400);
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
  });
  await advance(2);

  const bigger = await petFor(4);
  expect((await settledHeartBox(bigger)).width).toBeCloseTo(1000 / 25, 0);
}, FRAME_BUDGET);

test("spent hearts are all cleared, not every other one", async () => {
  render(<Hexapod visibleUI={true} />);
  await waitFor(() => expect(lastFrame().length).toBeGreaterThan(0));

  const spot = await petFor(40);
  const held = heartsIn(lastFrame()).length;
  expect(held).toBeGreaterThan(2);

  releasePointer(spot);
  // A heart lives 150 frames; past the last one's, none should be left behind.
  await advance(160);
  expect(heartsIn(lastFrame()).length).toBe(0);
}, FRAME_BUDGET);
