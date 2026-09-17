# Tool demo clips

One silent, looping WebM per tool, shown in the card that appears when the
pointer rests on a tool button.

The filename is the tool's name as `ToolKind::name` gives it in
`src/tools/mod.rs` — `brush.webm`, `ellipse-select.webm`, `quickselect.webm`.
There is no manifest: a tool with a file here gets a clip, a tool without one
gets the same card with only its name and hint. Nothing has to be registered.

## Recording one

```
make build_npaint     # record mode serves build/, so it has to exist
make record_npaint    # http://localhost:8791/?record=1
```

Pick the tool in the toolbox — the panel in the bottom right follows the
selection — press **Record**, do the thing the tool does, press **Stop**.

The take then loops in the panel with a trim bar under it. Drag the handle at
either end to cut the false start and the dead air off the end; the preview
loops over what you have kept, so what plays is what ships. **Save** writes
it, **Discard** throws it away. The tool's card picks a saved clip up on the
next hover, so a retake is: record, trim, hover, judge, record again.

**Framing.** The dashed box over the viewport is what gets recorded. Drag any
of its four edges to move it, the corner handle to resize it, or **Full** in
the panel to go back to the whole viewport. Its middle does not take the
pointer, so the canvas underneath can still be painted on with the box in
place — frame the shot first, then record through it. The region is kept in
`localStorage`, so retakes and reloads frame up the same way.

The cut itself is ffmpeg's, back on the server, so it is exact and costs
nothing — the file is being re-encoded anyway. Without ffmpeg there is nothing
to cut with, and the panel says so rather than leaving you with a clip that
still has the false start you thought you had removed.

What is captured is the viewport canvas cropped to that box, not the window:
no toolbar, no cursor, and no screen-capture permission prompt. Recordings run
at 60fps and stop themselves after 30 seconds. Do not resize the window
mid-take — the canvas is resized with it and the capture does not survive
that.

The server re-encodes each clip through ffmpeg to 480px wide, VP9, CRF 36. A
three- to five-second take lands somewhere around 60-80 KB, so a clip for
every tool costs under 2 MB. Without ffmpeg on the PATH the raw MediaRecorder
output is kept instead, which is roughly ten times that.

Record mode is development-only: `?record=1` has to be asked for by hand, and
`record.js` is not fetched without it. A plain static host has nowhere to PUT
to, so there the panel downloads the clip and it can be moved here by hand.

## What makes a good one

- **Three to five seconds.** The card loops, so a clip only has to show the
  gesture once. Length is what the demo set costs; nothing else comes close —
  which is what the trim bar is for. Record loosely, then cut.
- **Trim to the gesture.** Reaching for the canvas at the start and pausing at
  the end both read as the clip being broken.
- **One idea.** The brush's clip is a stroke, not a painting.
- **Start on something.** An empty white canvas reads as a broken clip; open
  or paint a picture before recording a tool that alters one.
- **Finish where it started**, roughly, so the loop does not jump.
