/**
 * Pointer and touch plumbing shared by every interactive scene.
 *
 * Near enough every scene grew its own copy of the same six handlers —
 * pointermove/down/up plus touchmove/start/end — each one converting client
 * coordinates to canvas coordinates and poking the same two refs. The copies
 * had drifted: some listened on the window, some on the canvas, some forgot to
 * suppress touch-drag scrolling, some forgot to remove a listener on unmount.
 * `createPointerTracker` is the single version, with the drift expressed as
 * options rather than as divergent code.
 */

/** Convert client coordinates into canvas-local coordinates. */
export const toCanvasPosition = (canvas, clientX, clientY) => {
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
};

/**
 * Wire up pointer and touch tracking for a scene.
 *
 * Every ref is optional — pass only the ones the scene actually reads:
 *   posRef          {x, y} in canvas coordinates, updated by pointer and touch
 *   downRef         true while the primary pointer is held
 *   rightDownRef    true while the right mouse button is held
 *   touchActiveRef  true while at least one finger is on the screen
 *
 * The `on*` callbacks fire after the refs are updated and receive
 * `(position, event)` so a scene can spawn particles on a swipe without
 * re-deriving coordinates.
 *
 * @returns {() => void} dispose — removes every listener it added
 */
export const createPointerTracker = (canvas, options = {}) => {
  const {
    target = window,
    posRef = null,
    downRef = null,
    rightDownRef = null,
    touchActiveRef = null,
    preventScroll = true,
    blockContextMenu = false,
    touch = true,
    onMove = null,
    onDown = null,
    onUp = null,
    onTouchStart = null,
    onTouchMove = null,
    onTouchEnd = null,
  } = options;

  const positionOf = (clientX, clientY) =>
    toCanvasPosition(canvas, clientX, clientY);

  const handlePointerMove = (event) => {
    const pos = positionOf(event.clientX, event.clientY);
    if (posRef) posRef.current = pos;
    if (onMove) onMove(pos, event);
  };

  const handlePointerDown = (event) => {
    // `buttons` is a bitmask; bit 1 is the secondary (right) button.
    const isRight = event.buttons === 2 || event.button === 2;
    if (isRight && rightDownRef) {
      rightDownRef.current = true;
    } else if (downRef) {
      downRef.current = true;
    }
    const pos = positionOf(event.clientX, event.clientY);
    if (posRef) posRef.current = pos;
    if (onDown) onDown(pos, event);
  };

  const handlePointerUp = (event) => {
    if (downRef) downRef.current = false;
    if (rightDownRef) rightDownRef.current = false;
    if (onUp) onUp(positionOf(event.clientX, event.clientY), event);
  };

  const handleContextMenu = (event) => event.preventDefault();

  const firstTouchPosition = (event) => {
    const point = event.touches?.[0] ?? event.changedTouches?.[0];
    return point ? positionOf(point.clientX, point.clientY) : null;
  };

  const handleTouchStart = (event) => {
    if (touchActiveRef) touchActiveRef.current = true;
    const pos = firstTouchPosition(event);
    if (pos && posRef) posRef.current = pos;
    if (onTouchStart) onTouchStart(pos, event);
  };

  const handleTouchMove = (event) => {
    const pos = firstTouchPosition(event);
    if (pos && posRef) posRef.current = pos;
    if (pos && onTouchMove) onTouchMove(pos, event);
  };

  const handleTouchEnd = (event) => {
    if (touchActiveRef) touchActiveRef.current = false;
    if (onTouchEnd) onTouchEnd(firstTouchPosition(event), event);
  };

  // Dragging a finger across the canvas should move the scene, not scroll the
  // page. Non-passive so preventDefault is actually honoured.
  const handleDragScroll = (event) => {
    if (event.touches && event.touches.length > 0) event.preventDefault();
  };

  target.addEventListener("pointermove", handlePointerMove);
  target.addEventListener("pointerdown", handlePointerDown);
  target.addEventListener("pointerup", handlePointerUp);

  if (touch) {
    target.addEventListener("touchmove", handleTouchMove);
    target.addEventListener("touchstart", handleTouchStart);
    target.addEventListener("touchend", handleTouchEnd);
  }

  if (blockContextMenu) {
    target.addEventListener("contextmenu", handleContextMenu);
  }

  if (preventScroll && canvas) {
    canvas.addEventListener("touchmove", handleDragScroll, { passive: false });
  }

  return () => {
    target.removeEventListener("pointermove", handlePointerMove);
    target.removeEventListener("pointerdown", handlePointerDown);
    target.removeEventListener("pointerup", handlePointerUp);

    if (touch) {
      target.removeEventListener("touchmove", handleTouchMove);
      target.removeEventListener("touchstart", handleTouchStart);
      target.removeEventListener("touchend", handleTouchEnd);
    }

    if (blockContextMenu) {
      target.removeEventListener("contextmenu", handleContextMenu);
    }

    if (preventScroll && canvas) {
      canvas.removeEventListener("touchmove", handleDragScroll);
    }
  };
};

/**
 * Attach a batch of listeners and get back a single disposer that removes
 * exactly what was added.
 *
 * The scenes with bespoke input — panning, pinch-zoom, brushes — cannot use
 * `createPointerTracker`, but they all had the same problem: a hand-written
 * cleanup listing every handler again, which is where the copies drifted
 * (removing the wrong handler, or forgetting one entirely). Declaring the
 * bindings once removes the chance to get the second list wrong.
 *
 * @param {Array<[EventTarget, string, EventListener, (object|boolean)=]>} bindings
 * @returns {() => void} dispose
 */
export const attachListeners = (bindings) => {
  bindings.forEach(([target, type, handler, options]) =>
    target.addEventListener(type, handler, options)
  );

  return () => {
    bindings.forEach(([target, type, handler, options]) =>
      target.removeEventListener(type, handler, options)
    );
  };
};
