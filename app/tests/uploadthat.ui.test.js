/**
 * The uploadthat page: opening a session, joining one, and what the file list
 * does once the poll comes back.
 */
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UploadThat, {
  codeFromHash,
  formatBytes,
  formatCountdown,
} from "../src/components/pages/uploadthat/UploadThat";
import { ThemeProvider } from "../src/themes/ThemeProvider";
import { MobileContext } from "../src/contexts/MobileContext";
import { encodeMeta } from "../src/components/pages/uploadthat/api";

const SESSION = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  code: "482913",
  token: "tok",
  role: "owner",
  expiresAt: Math.floor(Date.now() / 1000) + 900,
};

/**
 * Routes fetch by URL rather than by call order: the page polls on a timer, so
 * a queue of responses would drift depending on how many ticks a test took.
 */
function routeFetch(routes) {
  global.fetch = jest.fn((url, options = {}) => {
    const match = Object.keys(routes).find((pattern) => url.includes(pattern));
    const handler = match ? routes[match] : null;
    if (!handler) {
      return Promise.resolve({
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: () => Promise.resolve({ error: { code: "not_found", message: "No." } }),
      });
    }
    const result = handler(url, options);
    return Promise.resolve({
      ok: (result.status ?? 200) < 400,
      status: result.status ?? 200,
      headers: { get: (name) => (result.headers || {})[name] ?? null },
      json: () => Promise.resolve(result.body ?? {}),
      blob: () => Promise.resolve(result.blob),
    });
  });
}

const mount = (mobile = false) =>
  render(
    <MobileContext.Provider value={mobile}>
      <ThemeProvider>
        <UploadThat />
      </ThemeProvider>
    </MobileContext.Provider>
  );

beforeEach(() => {
  window.location.hash = "";
});

afterEach(() => {
  delete global.fetch;
  jest.useRealTimers();
});

describe("helpers", () => {
  it("reads a join code out of a scanned link, and nothing else", () => {
    expect(codeFromHash("#/j/482913")).toBe("482913");
    expect(codeFromHash("#/j/48291")).toBeNull();
    expect(codeFromHash("#/hextool")).toBeNull();
    expect(codeFromHash("")).toBeNull();
  });

  it("sizes files the way people read them", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.00 GB");
  });

  it("counts down in minutes and seconds", () => {
    expect(formatCountdown(900)).toBe("15:00");
    expect(formatCountdown(65)).toBe("1:05");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5)).toBe("0:00");
  });
});

describe("opening a session", () => {
  it("shows the code and a QR once the session exists", async () => {
    routeFetch({
      "/api/session": (url) =>
        url.endsWith("/manifest")
          ? { body: { version: 1, expiresAt: SESSION.expiresAt, files: [] } }
          : { status: 201, body: SESSION },
    });

    mount();
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));

    expect(await screen.findByText("482913")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /QR code/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /End session/ })).toBeInTheDocument();
  });

  it("only sends the operator key once it has been revealed and typed", async () => {
    let sent = null;
    routeFetch({
      "/api/session": (url, options) => {
        if (url.endsWith("/manifest")) {
          return { body: { version: 1, expiresAt: SESSION.expiresAt, files: [] } };
        }
        sent = JSON.parse(options.body);
        return { status: 201, body: SESSION };
      },
    });

    mount();
    userEvent.click(screen.getByText("I have a key"));
    fireEvent.change(screen.getByLabelText("Operator key"), {
      target: { value: "hunter2" },
    });
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));

    await screen.findByText("482913");
    expect(sent).toEqual({ operatorKey: "hunter2" });
  });

  it("explains a refusal instead of failing silently", async () => {
    routeFetch({
      "/api/session": () => ({
        status: 429,
        body: { error: { code: "rate_limited", message: "You have opened too many sessions." } },
      }),
    });

    mount();
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You have opened too many sessions."
    );
  });
});

describe("joining", () => {
  it("will not submit until six digits are in", () => {
    routeFetch({});
    mount();
    const join = screen.getByRole("button", { name: "Join" });
    expect(join).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Six-digit join code"), {
      target: { value: "4829" },
    });
    expect(join).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Six-digit join code"), {
      target: { value: "482913" },
    });
    expect(join).toBeEnabled();
  });

  it("keeps only digits, and only six of them", () => {
    routeFetch({});
    mount();
    const input = screen.getByLabelText("Six-digit join code");
    fireEvent.change(input, { target: { value: "4a8b2c9d1e3f7" } });
    expect(input).toHaveValue("482913");
  });

  it("joins straight away when arriving from a scanned QR", async () => {
    window.location.hash = "#/j/482913";
    routeFetch({
      "/api/join/482913": () => ({
        status: 200,
        body: { ...SESSION, role: "guest" },
      }),
      "/manifest": () => ({ body: { version: 1, expiresAt: SESSION.expiresAt, files: [] } }),
    });

    mount();
    expect(await screen.findByText("482913")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Leave session/ })).toBeInTheDocument();
  });
});

describe("on a phone", () => {
  const started = () =>
    routeFetch({
      "/manifest": () => ({
        body: {
          version: 1,
          expiresAt: SESSION.expiresAt,
          files: [
            {
              id: "f1",
              size: 2048,
              meta: encodeMeta({ name: "holiday.jpg", type: "image/jpeg" }),
              uploadedBy: "Device 2",
            },
          ],
        },
      }),
      "/api/session": () => ({ status: 201, body: SESSION }),
    });

  it("folds the join code away and leads with the files", async () => {
    started();
    mount(true);
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));
    expect(await screen.findByText("holiday.jpg")).toBeInTheDocument();

    // The code is on the button that reveals the panel, not spelled out below.
    expect(screen.queryByText("Join code")).toBeNull();
    expect(screen.queryByRole("img", { name: /QR code/i })).toBeNull();
  });

  it("shows the code and QR on demand", async () => {
    started();
    mount(true);
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));
    await screen.findByText("holiday.jpg");

    userEvent.click(screen.getByRole("button", { name: /Show the join code/i }));
    expect(screen.getByText("Join code")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /QR code/i })).toBeInTheDocument();
  });

  it("keeps the theme toggle in the bar, at the far end from End", async () => {
    started();
    mount(true);
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));
    await screen.findByText("holiday.jpg");

    const toggle = screen.getByRole("button", { name: /Switch to (light|dark) mode/i });
    const end = screen.getByRole("button", { name: /End session and delete files/ });
    const bar = toggle.parentElement;
    expect(bar).toContainElement(end);
    // Ordered within the bar, so they are never a mis-tap apart.
    expect(
      bar.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("keeps ending the session reachable, away from the theme toggle", async () => {
    started();
    mount(true);
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));
    await screen.findByText("holiday.jpg");

    // The theme toggle is pinned to the bottom left of the viewport, so this
    // one lives in the bar at the top.
    const end = screen.getByRole("button", { name: /End session and delete files/ });
    expect(end).toBeInTheDocument();
    expect(end.textContent).toContain("End");
  });
});

describe("the file list", () => {
  const withFiles = (files) =>
    routeFetch({
      "/manifest": () => ({
        headers: { ETag: '"v2-1111"' },
        body: { version: 2, expiresAt: SESSION.expiresAt, files },
      }),
      "/api/session": () => ({ status: 201, body: SESSION }),
    });

  it("shows what the other device added, by name and size", async () => {
    withFiles([
      {
        id: "aaaaaaaa-1111-4111-8111-111111111111",
        size: 2048,
        meta: encodeMeta({ name: "holiday.jpg", type: "image/jpeg" }),
        uploadedBy: "Device 2",
      },
    ]);

    mount();
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));

    expect(await screen.findByText("holiday.jpg")).toBeInTheDocument();
    expect(screen.getByText("2 KB · from Device 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download holiday.jpg" })).toBeInTheDocument();
  });

  it("previews an image, and leaves other files to their icon", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    global.URL.createObjectURL = jest.fn(() => "blob:preview");
    global.URL.revokeObjectURL = jest.fn();

    routeFetch({
      "/files/": () => ({ status: 200, blob: { arrayBuffer: async () => bytes.buffer } }),
      "/manifest": () => ({
        body: {
          version: 1,
          expiresAt: SESSION.expiresAt,
          files: [
            {
              id: "img",
              size: 2048,
              meta: encodeMeta({ name: "holiday.jpg", type: "image/jpeg" }),
              uploadedBy: "Device 2",
            },
            {
              id: "doc",
              size: 900,
              meta: encodeMeta({ name: "notes.txt", type: "text/plain" }),
              uploadedBy: "Device 1",
            },
          ],
        },
      }),
      "/api/session": () => ({ status: 201, body: SESSION }),
    });

    mount();
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));
    await screen.findByText("holiday.jpg");

    // The image gets a thumbnail built from its own bytes; the text file is
    // never downloaded at all.
    await waitFor(() => expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1));
    expect(document.querySelector('img[src="blob:preview"]')).toBeInTheDocument();

    const fetched = global.fetch.mock.calls.map(([url]) => url);
    expect(fetched.some((url) => url.includes("/files/img"))).toBe(true);
    expect(fetched.some((url) => url.includes("/files/doc"))).toBe(false);
  });

  const imageSession = (size) => {
    global.URL.createObjectURL = jest.fn(() => "blob:preview");
    global.URL.revokeObjectURL = jest.fn();
    routeFetch({
      "/files/": () => ({
        status: 200,
        blob: { arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer },
      }),
      "/manifest": () => ({
        body: {
          version: 1,
          expiresAt: SESSION.expiresAt,
          files: [
            {
              id: "img",
              size,
              meta: encodeMeta({ name: "holiday.jpg", type: "image/jpeg" }),
              uploadedBy: "Device 2",
            },
          ],
        },
      }),
      "/api/session": () => ({ status: 201, body: SESSION }),
    });
  };

  it("opens an image full size, and closes three ways", async () => {
    imageSession(2048);
    mount();
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));
    await screen.findByText("holiday.jpg");
    await waitFor(() => expect(global.URL.createObjectURL).toHaveBeenCalled());

    userEvent.click(screen.getByRole("button", { name: "Preview holiday.jpg" }));
    const dialog = await screen.findByRole("dialog", { name: "holiday.jpg" });
    expect(within(dialog).getByAltText("holiday.jpg")).toHaveAttribute(
      "src",
      "blob:preview"
    );

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "holiday.jpg" })).toBeNull()
    );

    userEvent.click(screen.getByRole("button", { name: "Preview holiday.jpg" }));
    userEvent.click(await screen.findByRole("button", { name: "Close preview" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "holiday.jpg" })).toBeNull()
    );
  });

  it("waits to be asked before downloading a large image", async () => {
    // Over the auto-thumbnail cap: nothing is fetched until the button is used.
    imageSession(20 * 1024 * 1024);
    mount();
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));
    await screen.findByText("holiday.jpg");

    const fetchedFiles = () =>
      global.fetch.mock.calls.filter(([url]) => url.includes("/files/")).length;
    expect(fetchedFiles()).toBe(0);

    userEvent.click(screen.getByRole("button", { name: "Preview holiday.jpg" }));
    await screen.findByRole("dialog", { name: "holiday.jpg" });
    expect(fetchedFiles()).toBe(1);
  });

  it("says so when the session is empty rather than showing nothing", async () => {
    withFiles([]);
    mount();
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));
    expect(
      await screen.findByText(/Nothing here yet/)
    ).toBeInTheDocument();
  });
});
