// Select Subject's model, run off the main thread.
//
// The model takes seconds — nine of them for the biggest one — and wasm has
// no way of yielding partway through. On the main thread that is a frozen
// page: no throbber, no menus, no cursor. In here it is just a message that
// arrives later, and the page carries on while it does.
//
// The work itself is `subject-model.js`, unchanged and shared: this file is
// only the postbox. Asset paths inside it resolve against its own URL, which
// is this same directory, so nothing has to be told where anything is.

import { matte } from "./subject-model.js";

self.onmessage = async (event) => {
  const { rgba, width, height, id } = event.data;
  try {
    const out = await matte(rgba, width, height, id, (fraction) =>
      self.postMessage({ type: "progress", fraction })
    );
    // The matte is handed over rather than copied; nothing here needs it
    // afterwards.
    self.postMessage({ type: "done", matte: out.matte, width: out.width, height: out.height }, [
      out.matte.buffer,
    ]);
  } catch (e) {
    self.postMessage({ type: "error", message: String(e?.message ?? e) });
  }
};
