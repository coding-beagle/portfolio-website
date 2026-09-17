// Record mode: the panel that turns a gesture in the editor into the hover
// clip for a tool. Reached with `?record=1`, which the makefile's
// `record_npaint` target serves — see `demos/README.md`.
//
// The source is the viewport canvas, taken with `captureStream`, so a clip is
// the picture and nothing else: no toolbar, no cursor, no screen-capture
// prompt. What a tool's demo shows is the tool's effect, which is what is on
// the canvas.
//
// The frame is cropped to a region the user drags out over the viewport,
// because most tools act on a corner of the picture and a clip of the whole
// canvas would show that corner about six pixels across. Cropping cannot be
// asked of `captureStream`, so the region is blitted into a scratch canvas
// every frame and that canvas is what gets captured.
//
// A take is reviewed before it is kept: the clip loops in the panel with a
// trim bar under it, and the in and out points ride along with the `PUT` for
// ffmpeg to cut on the server. Cutting there rather than in the browser keeps
// the trim exact and costs nothing — the file is being re-encoded anyway.
//
// Saving is a `PUT` back to the server that served the page, which writes the
// file into `www/demos/` and re-encodes it small. That only works under the
// record server; anywhere else the PUT fails and the panel offers the clip as
// a download instead, so record mode is still usable against a plain static
// host.

/** Recordings stop themselves here, so a forgotten Stop cannot fill the disk. */
const MAX_SECONDS = 30;

/** Frame rate of the capture. Brush strokes are worth the smoothness. */
const FPS = 60;

/** Headroom for 60fps; the server's re-encode is what sets the shipped size. */
const BITS_PER_SECOND = 2_500_000;

/**
 * Longest edge of the recording, in pixels. The card shows a clip about 276px
 * wide and the server re-encodes to 480, so recording a 4K region at 60fps
 * would only be throwing frames at the encoder for it to throw away.
 */
const MAX_CAPTURE_EDGE = 1280;

/** Below this a region is too small to aim at, let alone to read. */
const MIN_REGION_W = 80;
const MIN_REGION_H = 60;

/** The region outlives a reload, so retakes frame up the same way. */
const REGION_KEY = "npaint.record.region";

/** No trim may leave less clip than this. */
const MIN_CLIP_SECONDS = 0.2;

const MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
const pickMime = () => MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "";

/** VP9 and yuv420 both want even dimensions. */
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

/**
 * Builds the record panel and the region box, and adds them to the page.
 *
 * `canvas` is the viewport canvas to capture and `viewport` the element it
 * fills, which the region is measured against. `currentTool` returns the name
 * of the selected tool, and `onSaved` is called with that name once a clip has
 * been written, so the hover card can pick it up without a reload.
 */
export function createRecorder({ canvas, viewport, currentTool, onSaved }) {
  if (typeof MediaRecorder === "undefined") {
    console.warn("Record mode needs MediaRecorder, which this browser has not got.");
    return;
  }

  // Declared up here because the panel, built below, asks whether a recording
  // is in progress the moment it appears.
  const scratch = document.createElement("canvas");
  const scratchCtx = scratch.getContext("2d", { alpha: false });
  let recorder = null;
  let chunks = [];
  let target = "";
  let startedAt = 0;
  let tick = 0;
  let stopTimer = 0;
  let frameId = 0;
  let fullButton = null;
  /** The take under review: `{ blob, url, duration }`, or null. */
  let clip = null;
  /** In and out points in seconds, within the take under review. */
  let trim = { start: 0, end: 0 };

  // ---- Region ----------------------------------------------------------

  /** The area to record, in CSS pixels from the viewport's top left. */
  let region = loadRegion() ?? fullRegion();

  const box = document.createElement("div");
  box.className = "record-region";
  box.innerHTML = `
    <div class="record-region-edge n"></div>
    <div class="record-region-edge e"></div>
    <div class="record-region-edge s"></div>
    <div class="record-region-edge w"></div>
    <div class="record-region-grab"></div>
    <div class="record-region-size"></div>
  `;
  viewport.appendChild(box);
  const sizeLabel = box.querySelector(".record-region-size");

  function fullRegion() {
    return { x: 0, y: 0, w: viewport.clientWidth, h: viewport.clientHeight };
  }

  function loadRegion() {
    // A stored region is a convenience; a browser that refuses storage, or a
    // stale entry from a differently sized window, must not stop record mode.
    try {
      const saved = JSON.parse(localStorage.getItem(REGION_KEY) ?? "null");
      if (!saved || ["x", "y", "w", "h"].some((k) => typeof saved[k] !== "number")) return null;
      return saved;
    } catch {
      return null;
    }
  }

  function saveRegion() {
    try {
      localStorage.setItem(REGION_KEY, JSON.stringify(region));
    } catch {
      /* Private window, blocked site data: the region just will not persist. */
    }
  }

  /** Keeps the region inside the viewport and big enough to be worth taking. */
  function clampRegion() {
    const maxW = Math.max(MIN_REGION_W, viewport.clientWidth);
    const maxH = Math.max(MIN_REGION_H, viewport.clientHeight);
    region.w = clamp(region.w, MIN_REGION_W, maxW);
    region.h = clamp(region.h, MIN_REGION_H, maxH);
    region.x = clamp(region.x, 0, maxW - region.w);
    region.y = clamp(region.y, 0, maxH - region.h);
  }

  /** Whether the region already covers the whole viewport. */
  function isFullRegion() {
    const full = fullRegion();
    return (
      Math.round(region.x) === 0 &&
      Math.round(region.y) === 0 &&
      Math.round(region.w) === full.w &&
      Math.round(region.h) === full.h
    );
  }

  function drawRegion() {
    clampRegion();
    box.style.left = `${region.x}px`;
    box.style.top = `${region.y}px`;
    box.style.width = `${region.w}px`;
    box.style.height = `${region.h}px`;
    const text = `${Math.round(region.w)} × ${Math.round(region.h)}`;
    sizeLabel.textContent = text;
    regionLabel.textContent = text;
    // A region restored from a bigger window is clamped down to this one on
    // load, which can leave it already full — so Reset says it has nothing to
    // do rather than looking broken when clicking it changes nothing.
    if (fullButton) fullButton.disabled = isFullRegion();
  }

  // Dragging an edge moves the region, dragging the corner resizes it. The
  // interior is left alone (`pointer-events: none` in the stylesheet) so the
  // canvas underneath can still be painted on with the box in place.
  let drag = null;
  box.addEventListener("pointerdown", (e) => {
    const resizing = e.target.classList.contains("record-region-grab");
    if (!resizing && !e.target.classList.contains("record-region-edge")) return;
    // The canvas must not also see this as the start of a brush stroke.
    e.preventDefault();
    e.stopPropagation();
    e.target.setPointerCapture(e.pointerId);
    drag = { resizing, startX: e.clientX, startY: e.clientY, ...region };
  });
  box.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (drag.resizing) {
      region.w = drag.w + dx;
      region.h = drag.h + dy;
    } else {
      region.x = drag.x + dx;
      region.y = drag.y + dy;
    }
    drawRegion();
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    saveRegion();
  };
  box.addEventListener("pointerup", endDrag);
  box.addEventListener("pointercancel", endDrag);

  // The region is in viewport coordinates, so a resized window can leave it
  // hanging off the edge.
  const observer = new ResizeObserver(() => drawRegion());
  observer.observe(viewport);

  // ---- Panel -----------------------------------------------------------

  const panel = document.createElement("div");
  panel.className = "recorder";
  panel.innerHTML = `
    <div class="recorder-title">Record demo</div>
    <div class="recorder-tool">for <b class="recorder-tool-name"></b></div>
    <div class="recorder-region">
      <span class="recorder-region-size"></span>
      <button class="recorder-full" title="Record the whole viewport">Reset</button>
    </div>
    <button class="recorder-go primary">● Record</button>
    <div class="recorder-review" hidden>
      <video class="recorder-preview" muted playsinline></video>
      <div class="recorder-trim">
        <div class="recorder-trim-range"></div>
        <div class="recorder-trim-handle start"></div>
        <div class="recorder-trim-handle end"></div>
      </div>
      <div class="recorder-trim-time"></div>
      <div class="recorder-review-actions">
        <button class="recorder-discard">Discard</button>
        <button class="recorder-save primary">Save</button>
      </div>
    </div>
    <div class="recorder-status"></div>
  `;
  document.body.appendChild(panel);

  const toolName = panel.querySelector(".recorder-tool-name");
  const regionLabel = panel.querySelector(".recorder-region-size");
  const button = panel.querySelector(".recorder-go");
  const status = panel.querySelector(".recorder-status");
  const review = panel.querySelector(".recorder-review");
  const preview = panel.querySelector(".recorder-preview");
  const trimBar = panel.querySelector(".recorder-trim");
  const trimRange = panel.querySelector(".recorder-trim-range");
  const trimTime = panel.querySelector(".recorder-trim-time");

  fullButton = panel.querySelector(".recorder-full");
  fullButton.addEventListener("click", () => {
    region = fullRegion();
    drawRegion();
    saveRegion();
  });

  drawRegion();

  const say = (text, kind = "") => {
    status.textContent = text;
    status.className = `recorder-status ${kind}`;
  };

  // The panel follows the toolbox: whatever is selected is what gets recorded,
  // so choosing the tool and recording it are the same gesture.
  const followTool = () => {
    if (!recorder) toolName.textContent = currentTool();
  };
  const follow = setInterval(followTool, 200);
  followTool();

  // ---- Recording -------------------------------------------------------

  function start() {
    target = currentTool();
    chunks = [];

    // The canvas is sized in device pixels and the region in CSS pixels.
    const scale = canvas.width / Math.max(1, viewport.clientWidth);
    const src = {
      x: region.x * scale,
      y: region.y * scale,
      w: region.w * scale,
      h: region.h * scale,
    };
    const fit = Math.min(1, MAX_CAPTURE_EDGE / Math.max(src.w, src.h));
    scratch.width = even(src.w * fit);
    scratch.height = even(src.h * fit);

    // The viewport canvas is cleared to transparent and only the document
    // rect is painted on it, so on screen the workspace around the picture is
    // the element's own background showing through. `drawImage` composites
    // source-over, so blitting those transparent pixels would leave whatever
    // the scratch canvas held before — the picture would smear across the
    // workspace the moment the document got smaller than the region, which is
    // every crop. Laying the backdrop down first is what the screen does.
    const backdrop = getComputedStyle(viewport).backgroundColor || "#1e1e1e";

    const blit = () => {
      scratchCtx.fillStyle = backdrop;
      scratchCtx.fillRect(0, 0, scratch.width, scratch.height);
      scratchCtx.drawImage(canvas, src.x, src.y, src.w, src.h, 0, 0, scratch.width, scratch.height);
      frameId = requestAnimationFrame(blit);
    };
    blit();

    const stream = scratch.captureStream(FPS);
    recorder = new MediaRecorder(stream, {
      mimeType: pickMime(),
      videoBitsPerSecond: BITS_PER_SECOND,
    });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      const measured = (performance.now() - startedAt) / 1000;
      finish(new Blob(chunks, { type: "video/webm" }), measured);
    };
    recorder.start();

    startedAt = performance.now();
    panel.classList.add("recording");
    box.classList.add("recording");
    button.textContent = "■ Stop";
    tick = setInterval(() => {
      say(`${((performance.now() - startedAt) / 1000).toFixed(1)}s · ${scratch.width}×${scratch.height}`);
    }, 100);
    stopTimer = setTimeout(stop, MAX_SECONDS * 1000);
  }

  function stop() {
    clearInterval(tick);
    clearTimeout(stopTimer);
    cancelAnimationFrame(frameId);
    panel.classList.remove("recording");
    box.classList.remove("recording");
    button.textContent = "● Record";
    button.disabled = true;
    say("Finishing…");
    recorder?.stop();
  }

  // ---- Review and trim -------------------------------------------------

  /**
   * MediaRecorder writes a stream, not a file, so its WebM has no duration in
   * the header and `video.duration` comes back `Infinity` — which leaves the
   * trim bar with nothing to scale against and the preview unseekable. Asking
   * for an impossible time makes the browser walk to the end and work the
   * real duration out. `measured` is the wall-clock length of the take, used
   * if even that does not settle.
   */
  function realDuration(video, measured) {
    return new Promise((resolve) => {
      if (Number.isFinite(video.duration) && video.duration > 0) return resolve(video.duration);
      const give_up = setTimeout(() => resolve(measured), 2000);
      video.addEventListener("timeupdate", function seek() {
        if (!Number.isFinite(video.duration)) return;
        video.removeEventListener("timeupdate", seek);
        clearTimeout(give_up);
        video.currentTime = 0;
        resolve(video.duration);
      });
      video.currentTime = 1e101;
    });
  }

  async function finish(blob, measured) {
    recorder = null;
    releaseClip();
    clip = { blob, url: URL.createObjectURL(blob), duration: measured };
    preview.src = clip.url;
    clip.duration = await realDuration(preview, measured);
    trim = { start: 0, end: clip.duration };
    drawTrim();

    button.hidden = true;
    review.hidden = false;
    say(`${clip.duration.toFixed(1)}s — trim and save`);
    preview.currentTime = 0;
    preview.play().catch(() => {});
  }

  /** Keeps the preview looping over the trimmed span, so what plays is what ships. */
  preview.addEventListener("timeupdate", () => {
    if (!clip) return;
    if (preview.currentTime >= trim.end || preview.currentTime < trim.start - 0.05) {
      preview.currentTime = trim.start;
      preview.play().catch(() => {});
    }
  });

  function drawTrim() {
    if (!clip) return;
    const span = Math.max(0.001, clip.duration);
    const left = (trim.start / span) * 100;
    const right = (trim.end / span) * 100;
    trimRange.style.left = `${left}%`;
    trimRange.style.width = `${Math.max(0, right - left)}%`;
    trimBar.querySelector(".start").style.left = `${left}%`;
    trimBar.querySelector(".end").style.left = `${right}%`;
    const kept = trim.end - trim.start;
    trimTime.textContent = `${trim.start.toFixed(1)}s – ${trim.end.toFixed(1)}s · keeps ${kept.toFixed(1)}s`;
  }

  // Dragging either handle sets that end of the clip; the preview follows so
  // the frame under the handle is the frame being chosen.
  let trimming = null;
  trimBar.addEventListener("pointerdown", (e) => {
    const which = e.target.classList.contains("start") ? "start"
      : e.target.classList.contains("end") ? "end"
      : null;
    if (!which || !clip) return;
    e.preventDefault();
    e.target.setPointerCapture(e.pointerId);
    trimming = which;
    preview.pause();
  });
  trimBar.addEventListener("pointermove", (e) => {
    if (!trimming || !clip) return;
    const bar = trimBar.getBoundingClientRect();
    const at = clamp(((e.clientX - bar.left) / bar.width) * clip.duration, 0, clip.duration);
    if (trimming === "start") trim.start = Math.min(at, trim.end - MIN_CLIP_SECONDS);
    else trim.end = Math.max(at, trim.start + MIN_CLIP_SECONDS);
    trim.start = Math.max(0, trim.start);
    trim.end = Math.min(clip.duration, trim.end);
    preview.currentTime = trim[trimming];
    drawTrim();
  });
  const endTrim = () => {
    if (!trimming) return;
    trimming = null;
    preview.currentTime = trim.start;
    preview.play().catch(() => {});
  };
  trimBar.addEventListener("pointerup", endTrim);
  trimBar.addEventListener("pointercancel", endTrim);

  function releaseClip() {
    if (clip) URL.revokeObjectURL(clip.url);
    clip = null;
  }

  function closeReview() {
    preview.pause();
    preview.removeAttribute("src");
    review.hidden = true;
    button.hidden = false;
    button.disabled = false;
    releaseClip();
  }

  panel.querySelector(".recorder-discard").addEventListener("click", () => {
    closeReview();
    say("Discarded");
  });

  panel.querySelector(".recorder-save").addEventListener("click", save);

  async function save() {
    if (!clip) return;
    const { blob } = clip;
    const trimmed = trim.start > 0 || trim.end < clip.duration - 0.01;
    // The cut is ffmpeg's: the browser would have to re-encode to do it, and
    // the server is re-encoding regardless.
    const query = trimmed ? `?in=${trim.start.toFixed(3)}&out=${trim.end.toFixed(3)}` : "";
    say("Saving…");
    try {
      const res = await fetch(`demos/${target}.webm${query}`, {
        method: "PUT",
        headers: { "Content-Type": "video/webm" },
        body: blob,
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const saved = await res.json().catch(() => ({}));
      const size = saved.bytes ? ` · ${(saved.bytes / 1024).toFixed(0)} KB` : "";
      // Without ffmpeg the server keeps the take whole, and saying so beats
      // leaving a clip that quietly still has its false start in it.
      const cut = trimmed && saved.trimmed === false ? " · NOT trimmed (no ffmpeg)" : "";
      closeReview();
      say(`Saved ${target}.webm${size}${cut}`, cut ? "warn" : "ok");
      onSaved?.(target);
    } catch (e) {
      // No record server: hand the take over so it can be dropped into
      // www/demos/ by hand. Nothing here can cut it, so it goes over whole.
      download(blob, `${target}.webm`);
      closeReview();
      say(`Not saved (${e.message}) — downloaded whole, untrimmed`, "warn");
    }
  }

  button.addEventListener("click", () => (recorder ? stop() : start()));
  panel.addEventListener("pointerdown", (e) => e.stopPropagation());

  return {
    stop,
    destroy() {
      clearInterval(follow);
      observer.disconnect();
      stop();
      releaseClip();
      panel.remove();
      box.remove();
    },
  };
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
